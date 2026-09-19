/**
 * Durable campaign queue and worker.
 *
 * HTTP requests only enqueue work. A separately deployed worker claims the Job
 * and each CampaignMessage with short database leases before invoking a provider.
 */
import crypto from "node:crypto";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { sendEmailOutreach } from "../outreachService";
import { sendWhatsAppUnified } from "../whatsappGateway";
import { getUserIntegration } from "../userIntegrationService";
import { recordCampaignDispatch } from "./dispatchService";
import type { TenantContext } from "../tenancy/context";

const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_DELAY_MS = 10 * 60 * 1_000;
const MAX_PAGE_SIZE = 100;
const JOB_LEASE_MS = 45_000;
const MESSAGE_LEASE_MS = 45_000;
const MAX_MESSAGE_ATTEMPTS = 3;

export interface ExecutionOptions { delayMs?: number; batchSize?: number }
export interface NormalizedExecutionOptions { delayMs: number; batchSize: number }
export interface EnqueuedCampaignExecution { jobId: string; campaignId: string; status: "queued" }
export interface WorkerRunResult { jobId: string; sent: number; failed: number; cancelled: boolean; deferred: boolean }

interface CampaignMessageSnapshot {
  id: string; campaignId: string; tenantId: string; leadId: string | null;
  businessName: string; recipient: string; channel: string; subject: string | null;
  body: string; attemptCount: number; leaseToken: string | null;
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
  logger.info(`Queued campaign ${campaignId} as durable job ${job.id} for workspace ${ctx.tenantId}.`);
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
  // A cancelled job must never become runnable after its worker dies.
  await prisma.job.updateMany({
    where: { kind: "campaign", status: "cancelling", leaseExpiresAt: { lt: now } },
    data: { status: "cancelled", finishedAt: now, workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null },
  });
  return { jobs: jobs.count, messages: messages.count };
}

/** A find followed by conditional updateMany is an atomic compare-and-claim. */
export async function claimNextCampaignJob(workerId: string, now = new Date(), leaseMs = JOB_LEASE_MS): Promise<any | null> {
  const candidate = await prisma.job.findFirst({
    where: { kind: "campaign", OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }] },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.job.updateMany({
    where: {
      id: candidate.id, kind: "campaign",
      OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }],
    },
    data: { status: "running", workerId, leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs), heartbeatAt: now, startedAt: candidate.startedAt ?? now, attempt: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;
  return prisma.job.findFirst({ where: { id: candidate.id, workerId, leaseToken, kind: "campaign" } });
}

async function heartbeatJob(job: any, now = new Date()): Promise<boolean> {
  const updated = await prisma.job.updateMany({
    where: { id: job.id, tenantId: job.tenantId, kind: "campaign", status: { in: ["running", "cancelling"] }, workerId: job.workerId, leaseToken: job.leaseToken },
    data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) },
  });
  return updated.count === 1;
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
  return prisma.campaignMessage.findFirst({ where: { id: candidate.id, tenantId: job.tenantId, leaseOwner: job.workerId, leaseToken } }) as Promise<CampaignMessageSnapshot | null>;
}

async function finishLeasedMessage(message: CampaignMessageSnapshot, job: any, status: "sent" | "failed" | "retry_wait", error?: string, externalMessageId?: string): Promise<boolean> {
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
  let sent = 0; let failed = 0;
  const total = await prisma.campaignMessage.count({ where: { campaignId: campaign.id, tenantId: job.tenantId, status: { in: ["approved", "retry_wait", "sending"] } } });

  while (true) {
    if (!(await heartbeatJob(job))) return { jobId: job.id, sent, failed, cancelled: false, deferred: false };
    const state = await prisma.job.findFirst({ where: { id: job.id, tenantId: job.tenantId, workerId: job.workerId, leaseToken: job.leaseToken }, select: { status: true, cancelRequestedAt: true } });
    if (!state || state.status === "cancelling" || state.cancelRequestedAt) {
      await recomputeCampaignCounts(campaign.id, job.tenantId, "cancelled");
      return finishOwnedJob(job, "cancelled", { result: { campaignId: campaign.id, sent, failed, cancelled: true } });
    }
    const message = await claimNextCampaignMessage(job);
    if (!message) {
      const waiting = await prisma.campaignMessage.findFirst({ where: { campaignId: campaign.id, tenantId: job.tenantId, status: "retry_wait" }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } });
      if (waiting?.nextAttemptAt) {
        await prisma.job.updateMany({ where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" }, data: { leaseExpiresAt: waiting.nextAttemptAt, heartbeatAt: new Date() } });
        return { jobId: job.id, sent, failed, cancelled: false, deferred: true };
      }
      await recomputeCampaignCounts(campaign.id, job.tenantId, "complete");
      return finishOwnedJob(job, "completed", { result: { campaignId: campaign.id, sent, failed, cancelled: false } });
    }

    try {
      const externalMessageId = await deliverMessage(ctx, message, smtp);
      if (await finishLeasedMessage(message, job, "sent", undefined, externalMessageId)) {
        sent++;
        await recordCampaignDispatch({ message, campaignName: campaign.name, status: "SENT", externalMessageId }).catch((error) => logger.warn(`Delivery ${message.id} persisted but report repair is needed: ${error?.message || error}`));
      }
    } catch (error: any) {
      const reason = error instanceof Error ? error.message : String(error);
      const permanent = isPermanentError(reason) || message.attemptCount >= MAX_MESSAGE_ATTEMPTS;
      if (await finishLeasedMessage(message, job, permanent ? "failed" : "retry_wait", reason)) {
        if (permanent) {
          failed++;
          await recordCampaignDispatch({ message, campaignName: campaign.name, status: "FAILED", errorMessage: reason }).catch((reportError) => logger.warn(`Failure ${message.id} persisted but report repair is needed: ${reportError?.message || reportError}`));
        }
      }
      logger.warn(`Campaign message ${message.id} ${permanent ? "failed permanently" : "will retry"}: ${reason}`);
    }
    const complete = sent + failed;
    await prisma.job.updateMany({ where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" }, data: { progress: JSON.stringify({ stage: "sending", current: complete, total, sent, failed }) } });
    if (params.delayMs > 0) await delay(params.delayMs);
  }
}

async function finishOwnedJob(job: any, status: "completed" | "failed" | "cancelled", payload: { result?: Record<string, unknown>; error?: string }): Promise<WorkerRunResult> {
  await prisma.job.updateMany({
    where: { id: job.id, tenantId: job.tenantId, workerId: job.workerId, leaseToken: job.leaseToken, status: { in: ["running", "cancelling"] } },
    data: { status, result: payload.result ? JSON.stringify(payload.result) : undefined, error: payload.error?.slice(0, 2000), finishedAt: new Date(), leaseExpiresAt: null, heartbeatAt: new Date() },
  });
  return { jobId: job.id, sent: Number(payload.result?.sent || 0), failed: Number(payload.result?.failed || 0), cancelled: status === "cancelled", deferred: false };
}

export async function cancelCampaignExecution(ctx: TenantContext, campaignId: string): Promise<{ ok: boolean; jobId?: string }> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!campaign) return { ok: false };
  const jobs = await prisma.job.findMany({ where: { tenantId: ctx.tenantId, kind: "campaign", status: { in: ["queued", "running", "cancelling"] } }, orderBy: { createdAt: "desc" } });
  const job = jobs.find((row: any) => parseParams(row.params).campaignId === campaignId);
  if (!job) return { ok: false };
  const updated = await prisma.job.updateMany({ where: { id: job.id, tenantId: ctx.tenantId, kind: "campaign", status: { in: ["queued", "running", "cancelling"] } }, data: { status: "cancelling", cancelRequestedAt: new Date() } });
  return updated.count === 1 ? { ok: true, jobId: job.id } : { ok: false };
}

export async function runCampaignWorkerCycle(workerId: string): Promise<WorkerRunResult | null> {
  await recoverStaleCampaignLeases();
  const job = await claimNextCampaignJob(workerId);
  if (!job) return null;
  try { return await runClaimedCampaignJob(job); }
  catch (error: any) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Campaign worker failed job ${job.id}: ${reason}`);
    return finishOwnedJob(job, "failed", { error: reason, result: { campaignId: parseParams(job.params).campaignId, sent: 0, failed: 0 } });
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
    const result = await sendEmailOutreach(message.recipient, message.subject || "Outreach", message.body, smtp);
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
  const status = terminal === "cancelled" ? "cancelled" : terminal === "complete" ? "sent" : pending ? (queued ? "partially_approved" : "pending_review") : queued ? "approved" : "cancelled";
  await prisma.campaign.updateMany({ where: { id: campaignId, tenantId }, data: { status, pendingCount: pending, approvedCount: queued, rejectedCount: rejected, sentCount: sent, failedCount: failed, ...(terminal ? { completedAt: new Date() } : {}) } });
}
function isValidEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
