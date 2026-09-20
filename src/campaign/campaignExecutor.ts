/**
 * Durable campaign queue and worker.
 *
 * HTTP requests only enqueue work. A separately deployed worker claims the Job
 * and each CampaignMessage with short database leases before invoking a provider.
 */
import crypto from "node:crypto";
import { prisma } from "../prisma";
import { logger, logContext } from "../logger";
import { sendEmailOutreach } from "../outreachService";
import { sendWhatsAppUnified } from "../whatsappGateway";
import { getUserIntegration } from "../userIntegrationService";
import { recordCampaignDispatch } from "./dispatchService";
import { recordOutbound } from "../conversations/conversationService";
import { isSuppressed } from "../compliance/suppressionService";
import type { TenantContext } from "../tenancy/context";

const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_DELAY_MS = 10 * 60 * 1_000;
const MAX_PAGE_SIZE = 100;
const JOB_LEASE_MS = 45_000;
const MESSAGE_LEASE_MS = 45_000;
const MAX_MESSAGE_ATTEMPTS = 3;
/**
 * Leases must be renewed well inside their own window. A provider call can take
 * longer than a lease (an SMTP handshake to a slow host, a WhatsApp Web send),
 * and the inter-message delay is configurable up to ten minutes — far past a
 * 45s lease. Without renewal the lease expires while the work is still in
 * flight, another worker recovers it as stale, and the recipient is contacted
 * twice. Renewing every third of the lease tolerates two lost renewals.
 *
 * Configurable so the renewal behaviour itself can be exercised in tests without
 * waiting 15 real seconds.
 */
const LEASE_RENEW_MS = Math.max(10, Number(process.env.CAMPAIGN_LEASE_RENEW_MS) || 15_000);
/** How many queued jobs a worker will try before concluding the queue is taken. */
const CLAIM_CANDIDATE_LIMIT = 10;

export interface ExecutionOptions { delayMs?: number; batchSize?: number }
export interface NormalizedExecutionOptions { delayMs: number; batchSize: number }
export interface EnqueuedCampaignExecution { jobId: string; campaignId: string; status: "queued" }
export interface WorkerRunResult { jobId: string; sent: number; failed: number; skipped: number; cancelled: boolean; deferred: boolean }

interface CampaignMessageSnapshot {
  id: string; campaignId: string; tenantId: string; leadId: string | null;
  businessName: string; recipient: string; channel: string; subject: string | null;
  body: string; attemptCount: number; leaseToken: string | null;
  idempotencyKey?: string | null;
}
interface TenantSmtpConfig { host: string; port: number; secure: boolean; user: string; pass: string; from: string }

export function normalizeExecutionOptions(options: ExecutionOptions = {}): NormalizedExecutionOptions {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const batchSize = options.batchSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) throw new Error(`delayMs must be an integer between 0 and ${MAX_DELAY_MS}.`);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_PAGE_SIZE) throw new Error(`batchSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  return { delayMs, batchSize };
}

/** Atomically claim the campaign and create a queued durable job. */
export async function enqueueCampaignExecution(ctx: TenantContext, campaignId: string, options: ExecutionOptions = {}): Promise<EnqueuedCampaignExecution> {
  const execution = normalizeExecutionOptions(options);
  const now = new Date();
  const job = await prisma.$transaction(async (tx: any) => {
    const claim = await tx.campaign.updateMany({
      where: { id: campaignId, tenantId: ctx.tenantId, status: { in: ["approved", "partially_approved"] } },
      data: { status: "sending", startedAt: now, completedAt: null },
    });
    if (claim.count !== 1) {
      const campaign = await tx.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId }, select: { status: true } });
      if (!campaign) throw new Error("Campaign not found");
      if (campaign.status === "sent") throw new Error("Campaign has already been sent");
      throw new Error("Campaign is already queued, sending, or is no longer ready to send");
    }
    return tx.job.create({
      data: {
        tenantId: ctx.tenantId, userId: ctx.userId, kind: "campaign", status: "queued",
        params: JSON.stringify({ campaignId, ...execution }),
        progress: JSON.stringify({ stage: "queued", current: 0, total: 0, sent: 0, failed: 0 }),
      },
    });
  });
  logger.info(`Queued a campaign for durable execution.${logContext({ tenant: ctx.tenantId, user: ctx.userId, campaign: campaignId, job: job.id })}`);
  return { jobId: job.id, campaignId, status: "queued" };
}

/** Requeue only expired work; live workers retain their lease. Safe on every poll. */
export async function recoverStaleCampaignLeases(now = new Date()): Promise<{ jobs: number; messages: number }> {
  const [jobs, messages] = await Promise.all([
    prisma.job.updateMany({
      where: { kind: "campaign", status: "running", leaseExpiresAt: { lt: now } },
      data: { status: "queued", workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null },
    }),
    prisma.campaignMessage.updateMany({
      where: { status: "sending", leaseExpiresAt: { lt: now } },
      data: { status: "retry_wait", nextAttemptAt: now, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, errorMessage: "Recovered after a worker lease expired." },
    }),
  ]);
  // A cancelled job must never become runnable after its worker dies, and must
  // not linger in `cancelling` when no worker ever held it.
  await prisma.job.updateMany({
    where: { kind: "campaign", status: "cancelling", OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }] },
    data: { status: "cancelled", finishedAt: now, workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null },
  });
  return { jobs: jobs.count, messages: messages.count };
}

/**
 * A read followed by a conditional updateMany is an atomic compare-and-claim:
 * the loser of a race sees `count === 0` and moves on to the next candidate
 * instead of giving up for the whole poll. Without that, N workers polling the
 * same oldest row would claim one job per tick between them, so a queue of
 * jobs drained at single-worker speed no matter how many replicas were running.
 */
export async function claimNextCampaignJob(workerId: string, now = new Date(), leaseMs = JOB_LEASE_MS): Promise<any | null> {
  const claimable = { kind: "campaign", OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }] };
  const candidates = await prisma.job.findMany({
    where: claimable,
    orderBy: { createdAt: "asc" },
    take: CLAIM_CANDIDATE_LIMIT,
  });
  for (const candidate of candidates) {
    const leaseToken = crypto.randomUUID();
    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, ...claimable },
      data: { status: "running", workerId, leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs), heartbeatAt: now, startedAt: candidate.startedAt ?? now, attempt: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    return prisma.job.findFirst({ where: { id: candidate.id, workerId, leaseToken, kind: "campaign" } });
  }
  return null;
}

async function heartbeatJob(job: any, now = new Date()): Promise<boolean> {
  const updated = await prisma.job.updateMany({
    where: { id: job.id, tenantId: job.tenantId, kind: "campaign", status: { in: ["running", "cancelling"] }, workerId: job.workerId, leaseToken: job.leaseToken },
    data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) },
  });
  return updated.count === 1;
}

/** Extend this worker's claim on one message while its delivery is in flight. */
async function renewMessageLease(message: CampaignMessageSnapshot, job: any, now = new Date()): Promise<boolean> {
  const updated = await prisma.campaignMessage.updateMany({
    where: { id: message.id, tenantId: job.tenantId, status: "sending", leaseOwner: job.workerId, leaseToken: message.leaseToken },
    data: { leaseExpiresAt: new Date(now.getTime() + MESSAGE_LEASE_MS) },
  });
  return updated.count === 1;
}

/**
 * Runs `operation` while holding both leases open. Renewal failures are ignored
 * on purpose: losing a renewal does not make it correct to abandon a provider
 * call that may already have delivered. The caller's next conditional write is
 * what decides whether this worker still owns the outcome.
 */
async function withLeaseKeepAlive<T>(job: any, message: CampaignMessageSnapshot, operation: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    const now = new Date();
    void Promise.allSettled([heartbeatJob(job, now), renewMessageLease(message, job, now)]);
  }, LEASE_RENEW_MS);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

/** Waits out the pacing delay without letting the job lease lapse. */
async function delayHoldingLease(job: any, ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const slice = Math.min(remaining, LEASE_RENEW_MS);
    await delay(slice);
    remaining -= slice;
    if (remaining > 0) await heartbeatJob(job).catch(() => false);
  }
}

async function claimNextCampaignMessage(job: any, now = new Date()): Promise<CampaignMessageSnapshot | null> {
  const candidate = await prisma.campaignMessage.findFirst({
    where: { campaignId: parseParams(job.params).campaignId, tenantId: job.tenantId, OR: [
      { status: "approved" }, { status: "retry_wait", nextAttemptAt: { lte: now } }, { status: "sending", leaseExpiresAt: { lt: now } },
    ] },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.campaignMessage.updateMany({
    where: { id: candidate.id, campaignId: candidate.campaignId, tenantId: job.tenantId, OR: [
      { status: "approved" }, { status: "retry_wait", nextAttemptAt: { lte: now } }, { status: "sending", leaseExpiresAt: { lt: now } },
    ] },
    data: { status: "sending", leaseOwner: job.workerId, leaseToken, leaseExpiresAt: new Date(now.getTime() + MESSAGE_LEASE_MS), lastAttemptAt: now, nextAttemptAt: null, attemptCount: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;
  const claimedMessage = (await prisma.campaignMessage.findFirst({
    where: { id: candidate.id, tenantId: job.tenantId, leaseOwner: job.workerId, leaseToken },
  })) as CampaignMessageSnapshot | null;
  if (!claimedMessage) return null;

  // Persist the derived key on first use so the value that was sent is auditable
  // from the row itself, not only recomputable from it.
  const idempotencyKey = claimedMessage.idempotencyKey || deliveryIdempotencyKey(job.tenantId, claimedMessage.id);
  if (!claimedMessage.idempotencyKey) {
    await prisma.campaignMessage
      .updateMany({ where: { id: claimedMessage.id, tenantId: job.tenantId, idempotencyKey: null }, data: { idempotencyKey } })
      .catch(() => undefined);
  }
  return { ...claimedMessage, idempotencyKey };
}

async function finishLeasedMessage(message: CampaignMessageSnapshot, job: any, status: "sent" | "failed" | "retry_wait" | "suppressed", error?: string, externalMessageId?: string): Promise<boolean> {
  const retryAt = status === "retry_wait" ? new Date(Date.now() + retryDelayMs(message.attemptCount)) : null;
  const updated = await prisma.campaignMessage.updateMany({
    where: { id: message.id, tenantId: job.tenantId, status: "sending", leaseOwner: job.workerId, leaseToken: message.leaseToken },
    data: { status, sentAt: status === "sent" ? new Date() : undefined, externalMessageId: externalMessageId ?? undefined, errorMessage: error ? error.slice(0, 500) : null, nextAttemptAt: retryAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null },
  });
  return updated.count === 1;
}

function parseParams(value: string | null | undefined): NormalizedExecutionOptions & { campaignId: string } {
  try { return JSON.parse(value || "{}") } catch { return { campaignId: "", delayMs: DEFAULT_DELAY_MS, batchSize: DEFAULT_PAGE_SIZE } }
}

function retryDelayMs(attempt: number): number { return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000); }

/**
 * One stable identity per message, unchanged by retries or recovery.
 *
 * Derived rather than random so that a worker which crashed before it could
 * persist anything computes exactly the same key on the next attempt. The tenant
 * is mixed in so the key is meaningless outside the workspace that produced it.
 */
export function deliveryIdempotencyKey(tenantId: string, messageId: string): string {
  return crypto.createHash("sha256").update(`${tenantId}:${messageId}`).digest("hex").slice(0, 32);
}
function isPermanentError(reason: string): boolean {
  return /not configured|authentication failed|invalid.*(email|recipient|address)|no valid email|no phone recipient|unknown campaign channel|not on whatsapp/i.test(reason);
}

export async function runClaimedCampaignJob(job: any): Promise<WorkerRunResult> {
  const params = parseParams(job.params);
  if (!params.campaignId) throw new Error("Campaign job has no campaignId parameter.");
  const campaign = await prisma.campaign.findFirst({ where: { id: params.campaignId, tenantId: job.tenantId }, select: { id: true, name: true } });
  if (!campaign) return finishOwnedJob(job, "failed", { error: "Campaign no longer exists." });
  const ctx = { tenantId: job.tenantId, userId: job.userId, membershipId: "worker", role: "owner", tenantName: "worker", tenantSlug: "worker", permissions: new Set<string>() } as TenantContext;
  const smtp = await resolveTenantSmtpConfig(ctx);
  let sent = 0; let failed = 0; let skipped = 0;
  const jobFields = { tenant: job.tenantId, job: job.id, campaign: campaign.id, worker: job.workerId };
  const total = await prisma.campaignMessage.count({ where: { campaignId: campaign.id, tenantId: job.tenantId, status: { in: ["approved", "retry_wait", "sending"] } } });

  while (true) {
    if (!(await heartbeatJob(job))) {
      logger.warn(`Campaign worker lost its job lease and stopped processing.${logContext(jobFields)}`);
      return { jobId: job.id, sent, failed, skipped, cancelled: false, deferred: false };
    }
    const state = await prisma.job.findFirst({ where: { id: job.id, tenantId: job.tenantId, workerId: job.workerId, leaseToken: job.leaseToken }, select: { status: true, cancelRequestedAt: true } });
    if (!state || state.status === "cancelling" || state.cancelRequestedAt) {
      await recomputeCampaignCounts(campaign.id, job.tenantId, "cancelled");
      logger.info(`Campaign execution cancelled after ${sent} sent, ${failed} failed, ${skipped} skipped.${logContext(jobFields)}`);
      return finishOwnedJob(job, "cancelled", { result: { campaignId: campaign.id, sent, failed, skipped, cancelled: true } });
    }
    const message = await claimNextCampaignMessage(job);
    if (!message) {
      const waiting = await prisma.campaignMessage.findFirst({ where: { campaignId: campaign.id, tenantId: job.tenantId, status: "retry_wait" }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } });
      if (waiting?.nextAttemptAt) {
        await prisma.job.updateMany({ where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" }, data: { leaseExpiresAt: waiting.nextAttemptAt, heartbeatAt: new Date() } });
        return { jobId: job.id, sent, failed, skipped, cancelled: false, deferred: true };
      }
      await recomputeCampaignCounts(campaign.id, job.tenantId, "complete");
      logger.info(`Campaign execution completed with ${sent} sent, ${failed} failed, ${skipped} skipped.${logContext(jobFields)}`);
      return finishOwnedJob(job, "completed", { result: { campaignId: campaign.id, sent, failed, skipped, cancelled: false } });
    }
    const messageFields = { ...jobFields, message: message.id, channel: message.channel, attempt: message.attemptCount };

    try {
      // Compliance is checked at delivery time, not only at generation time: a
      // contact can opt out after the copy was approved but before it is sent.
      if (await isSuppressedRecipient(job, message)) {
        if (await finishLeasedMessage(message, job, "suppressed", "Recipient is on this workspace's suppression list.")) {
          skipped++;
          logger.info(`Campaign message skipped: the recipient has opted out.${logContext(messageFields)}`);
        }
      } else {
        const externalMessageId = await withLeaseKeepAlive(job, message, () => deliverMessage(ctx, message, smtp));
        if (await finishLeasedMessage(message, job, "sent", undefined, externalMessageId)) {
          sent++;
          await recordCampaignDispatch({ message, campaignName: campaign.name, status: "SENT", externalMessageId }).catch((error) => logger.warn(`Delivery persisted but report repair is needed: ${error?.message || error}${logContext(messageFields)}`));
          await syncDeliveryToCrmAndInbox(job, message, { status: "SENT", externalMessageId });
          logger.info(`Campaign message delivered.${logContext({ ...messageFields, providerMessageId: externalMessageId })}`);
        }
      }
    } catch (error: any) {
      const reason = error instanceof Error ? error.message : String(error);
      const permanent = isPermanentError(reason) || message.attemptCount >= MAX_MESSAGE_ATTEMPTS;
      if (await finishLeasedMessage(message, job, permanent ? "failed" : "retry_wait", reason)) {
        if (permanent) {
          failed++;
          await recordCampaignDispatch({ message, campaignName: campaign.name, status: "FAILED", errorMessage: reason }).catch((reportError) => logger.warn(`Failure persisted but report repair is needed: ${reportError?.message || reportError}${logContext(messageFields)}`));
          await syncDeliveryToCrmAndInbox(job, message, { status: "FAILED" });
        }
      }
      logger.warn(`Campaign message ${permanent ? "failed permanently" : "will retry"}: ${reason}${logContext(messageFields)}`);
    }
    const complete = sent + failed + skipped;
    await prisma.job.updateMany({ where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" }, data: { progress: JSON.stringify({ stage: "sending", current: complete, total, sent, failed, skipped }) } });
    if (params.delayMs > 0) await delayHoldingLease(job, params.delayMs);
  }
}

/**
 * Fails closed. If the suppression lookup itself errors we raise, so the message
 * goes back to retry rather than being delivered to someone who may have opted
 * out — a compliance breach is worse than a late send.
 */
async function isSuppressedRecipient(job: any, message: CampaignMessageSnapshot): Promise<boolean> {
  if (message.channel !== "email" && message.channel !== "whatsapp") return false;
  return isSuppressed(job.tenantId, message.channel, message.recipient);
}

/**
 * Keeps the CRM and the Inbox consistent with what the worker actually did.
 *
 * Without this the worker was the only sender that left the lead row untouched:
 * reports showed a delivery the Leads table denied, and a reply arrived in a
 * thread that had no record of the outreach it answered. Best-effort by design —
 * the delivery already happened and must not be re-attempted because a
 * bookkeeping write failed.
 */
async function syncDeliveryToCrmAndInbox(
  job: any,
  message: CampaignMessageSnapshot,
  options: { status: "SENT" | "FAILED"; externalMessageId?: string }
): Promise<void> {
  if (message.channel !== "email" && message.channel !== "whatsapp") return;
  const today = new Date().toISOString().split("T")[0];
  try {
    if (message.leadId) {
      const data = message.channel === "email"
        ? { emailStatus: options.status, emailSentDate: today }
        : { whatsappStatus: options.status, whatsappSentDate: today };
      await prisma.lead.updateMany({ where: { id: message.leadId, tenantId: job.tenantId }, data });
    }
    if (options.status === "SENT") {
      await recordOutbound({
        tenantId: job.tenantId,
        channel: message.channel,
        email: message.channel === "email" ? message.recipient : undefined,
        phone: message.channel === "whatsapp" ? message.recipient : undefined,
        leadId: message.leadId ?? undefined,
        businessName: message.businessName,
        text: message.body,
        source: "campaign",
        provider: message.channel === "email" ? "smtp" : "whatsapp",
        providerMessageId: options.externalMessageId,
      });
    }
  } catch (error: any) {
    logger.warn(`Delivery recorded but CRM/inbox sync failed: ${error?.message || error}${logContext({ tenant: job.tenantId, job: job.id, message: message.id, lead: message.leadId })}`);
  }
}

async function finishOwnedJob(job: any, status: "completed" | "failed" | "cancelled", payload: { result?: Record<string, unknown>; error?: string }): Promise<WorkerRunResult> {
  await prisma.job.updateMany({
    where: { id: job.id, tenantId: job.tenantId, workerId: job.workerId, leaseToken: job.leaseToken, status: { in: ["running", "cancelling"] } },
    data: { status, result: payload.result ? JSON.stringify(payload.result) : undefined, error: payload.error?.slice(0, 2000), finishedAt: new Date(), leaseExpiresAt: null, heartbeatAt: new Date() },
  });
  return { jobId: job.id, sent: Number(payload.result?.sent || 0), failed: Number(payload.result?.failed || 0), skipped: Number(payload.result?.skipped || 0), cancelled: status === "cancelled", deferred: false };
}

/**
 * Cancellation is cooperative for a running job and immediate for a queued one.
 *
 * A queued job has no worker to observe the request, so marking it `cancelling`
 * and waiting would strand it: nothing claims a cancelling job, and lease-expiry
 * recovery cannot help a job that never held a lease. It is settled here instead,
 * with the same conditional write that guarantees a job already claimed by a
 * worker is not yanked out from under it mid-send.
 */
export async function cancelCampaignExecution(ctx: TenantContext, campaignId: string): Promise<{ ok: boolean; jobId?: string }> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!campaign) return { ok: false };
  const jobs = await prisma.job.findMany({ where: { tenantId: ctx.tenantId, kind: "campaign", status: { in: ["queued", "running", "cancelling"] } }, orderBy: { createdAt: "desc" } });
  const job = jobs.find((row: any) => parseParams(row.params).campaignId === campaignId);
  if (!job) return { ok: false };
  const now = new Date();

  const settledWhileQueued = await prisma.job.updateMany({
    where: { id: job.id, tenantId: ctx.tenantId, kind: "campaign", status: "queued" },
    data: { status: "cancelled", cancelRequestedAt: now, finishedAt: now, workerId: null, leaseToken: null, leaseExpiresAt: null },
  });
  if (settledWhileQueued.count === 1) {
    await recomputeCampaignCounts(campaignId, ctx.tenantId, "cancelled");
    logger.info(`Cancelled a campaign before any worker claimed it.${logContext({ tenant: ctx.tenantId, campaign: campaignId, job: job.id })}`);
    return { ok: true, jobId: job.id };
  }

  const requested = await prisma.job.updateMany({
    where: { id: job.id, tenantId: ctx.tenantId, kind: "campaign", status: { in: ["running", "cancelling"] } },
    data: { status: "cancelling", cancelRequestedAt: now },
  });
  if (requested.count !== 1) return { ok: false };
  logger.info(`Requested cancellation of a running campaign.${logContext({ tenant: ctx.tenantId, campaign: campaignId, job: job.id })}`);
  return { ok: true, jobId: job.id };
}

export async function runCampaignWorkerCycle(workerId: string): Promise<WorkerRunResult | null> {
  await recoverStaleCampaignLeases();
  const job = await claimNextCampaignJob(workerId);
  if (!job) return null;
  try { return await runClaimedCampaignJob(job); }
  catch (error: any) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Campaign worker failed a job: ${reason}${logContext({ tenant: job.tenantId, job: job.id, campaign: parseParams(job.params).campaignId, worker: workerId })}`);
    return finishOwnedJob(job, "failed", { error: reason, result: { campaignId: parseParams(job.params).campaignId, sent: 0, failed: 0, skipped: 0 } });
  }
}

async function resolveTenantSmtpConfig(ctx: TenantContext): Promise<TenantSmtpConfig | null> {
  if (!ctx.userId) return null;
  const raw = (await getUserIntegration(ctx.userId, "smtp", ctx.tenantId)) as any;
  if (!raw?.host || !raw?.user || !raw?.password) return null;
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host: String(raw.host), port, secure: Boolean(raw.secure), user: String(raw.user), pass: String(raw.password), from: String(raw.fromName || raw.fromEmail || raw.user) };
}

async function deliverMessage(ctx: TenantContext, message: CampaignMessageSnapshot, smtp: TenantSmtpConfig | null): Promise<string | undefined> {
  if (message.channel === "email") {
    if (!smtp) throw new Error("Email is not configured for this workspace. Add an enabled SMTP integration before sending.");
    if (!isValidEmail(message.recipient)) throw new Error("The approved message has no valid email recipient.");
    const result = await sendEmailOutreach(message.recipient, message.subject || "Outreach", message.body, smtp, {
      // Same key on every attempt, so a retry after an unknown outcome carries
      // the Message-ID the first attempt used and receiving servers can collapse
      // the duplicate.
      idempotencyKey: message.idempotencyKey || deliveryIdempotencyKey(message.tenantId, message.id),
    });
    if (!result.success) throw new Error(result.error || "Email send failed");
    return result.messageId;
  }
  if (message.channel === "whatsapp") {
    if (!message.recipient.trim()) throw new Error("The approved message has no phone recipient.");
    const result = await sendWhatsAppUnified(message.recipient, message.body, { userId: ctx.userId, tenantId: ctx.tenantId, allowTemplateFallback: true });
    if (!result.ok) throw new Error(result.error || "WhatsApp send failed");
    return result.messageId;
  }
  throw new Error(`Unknown campaign channel: ${message.channel}`);
}

export async function recomputeCampaignCounts(campaignId: string, tenantId: string, terminal?: "complete" | "cancelled"): Promise<void> {
  const counts = await prisma.campaignMessage.groupBy({ by: ["status"], where: { campaignId, tenantId }, _count: true });
  const countFor = (status: string) => counts.find((row: any) => row.status === status)?._count || 0;
  const pending = countFor("pending_review"); const queued = countFor("approved") + countFor("retry_wait") + countFor("sending");
  const rejected = countFor("rejected"); const sent = countFor("sent"); const failed = countFor("failed");
  const skipped = countFor("suppressed");
  const status = terminal === "cancelled" ? "cancelled" : terminal === "complete" ? "sent" : pending ? (queued ? "partially_approved" : "pending_review") : queued ? "approved" : "cancelled";
  await prisma.campaign.updateMany({ where: { id: campaignId, tenantId }, data: { status, pendingCount: pending, approvedCount: queued, rejectedCount: rejected, sentCount: sent, failedCount: failed, skippedCount: skipped, ...(terminal ? { completedAt: new Date() } : {}) } });
}
function isValidEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
