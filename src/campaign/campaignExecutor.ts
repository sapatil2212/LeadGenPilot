/**
 * Durable campaign queue and worker.
 *
 * HTTP requests only enqueue work. A separately deployed worker claims the Job
 * and each CampaignMessage with short database leases before invoking a provider.
 *
 * Extended in v2 to support:
 *   - Multiple WhatsApp/Email senders with persistent round-robin rotation.
 *   - Random inter-message delay (configurable min/max seconds per campaign).
 *   - Batch-pause: after N successful sends the worker sleeps M seconds.
 *   - AI template variation rotation.
 *   - Safe {{name}} variable fallback.
 */
import crypto from "node:crypto";
import { prisma } from "../prisma";
import { logger, logContext } from "../logger";
import { sendEmailOutreach } from "../outreachService";
import { sendWhatsAppUnified } from "../whatsappGateway";
import { getUserIntegration } from "../userIntegrationService";
import { syncCampaignOutreachToGoogleSheet } from "../googleSheetsWebhook";
import { assertCampaignReadiness } from "./campaignReadiness";
import { recordCampaignDispatch } from "./dispatchService";
import { recordOutbound } from "../conversations/conversationService";
import { isSuppressed } from "../compliance/suppressionService";
import { determineMessageSender, type SenderChannel } from "./senderRotationService";
import { selectNextVariation, compileVariationForLead } from "./templateVariationService";
import { shuffleMessageContent } from "./contentShuffle";
import type { TenantContext } from "../tenancy/context";

const DEFAULT_DELAY_MIN_S = 10;  // seconds
const DEFAULT_DELAY_MAX_S = 60;  // seconds
/** Legacy compatibility: old campaigns used a fixed ms delay via job params. */
const DEFAULT_DELAY_MS = 5_000;
const MIN_LIVE_DELAY_MS = 1_000; // lowered: campaigns now use their own random range
const DELAY_JITTER_RATIO = 0.4;  // kept for legacy paths only
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

/** Batch-pause progress key inside Job.progress JSON. */
const BATCH_SENT_KEY = "batchSentCount";

export interface ExecutionOptions { delayMs?: number; batchSize?: number }
export interface NormalizedExecutionOptions { delayMs: number; batchSize: number }
export interface EnqueuedCampaignExecution { jobId: string; campaignId: string; status: "queued" }
export interface WorkerRunResult { jobId: string; sent: number; failed: number; skipped: number; cancelled: boolean; deferred: boolean }

interface CampaignMessageSnapshot {
  id: string; campaignId: string; tenantId: string; leadId: string | null;
  businessName: string; recipient: string; channel: string; subject: string | null;
  body: string; attemptCount: number; leaseToken: string | null;
  idempotencyKey?: string | null;
  selectedSenderId?: string | null;
}
interface TenantSmtpConfig { host: string; port: number; secure: boolean; user: string; pass: string; from: string }
interface TenantGoogleSheetConfig { webhookUrl: string }

/** Campaign-level throttle settings read from the Campaign row. */
interface CampaignThrottle {
  delayMinMs: number;
  delayMaxMs: number;
  batchSize: number;
  batchPauseMs: number;
  /** When > 0, pause after this many ms of continuous sending (time-based). */
  pauseEveryMs: number;
  /** When true, reword each message's wording at send time for anti-block. */
  shuffleContent: boolean;
}

/** Progress key for the time-based pause window start (epoch ms). */
const BATCH_WINDOW_KEY = "batchWindowStartedAt";

function parseCampaignChannels(value: string | null | undefined): { email: boolean; whatsapp: boolean } {
  try {
    const parsed = JSON.parse(value || "{}");
    return { email: Boolean(parsed?.email), whatsapp: Boolean(parsed?.whatsapp) };
  } catch {
    return { email: false, whatsapp: false };
  }
}

export function normalizeExecutionOptions(options: ExecutionOptions = {}): NormalizedExecutionOptions {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const batchSize = options.batchSize ?? DEFAULT_PAGE_SIZE;
  // Unit tests can opt into zero-delay jobs, but live callers cannot remove the
  // pacing barrier. The worker then adds jitter so sends do not form a fixed,
  // bot-like interval.
  const minimumDelay = process.env.NODE_ENV === "test" ? 0 : MIN_LIVE_DELAY_MS;
  if (!Number.isInteger(delayMs) || delayMs < minimumDelay || delayMs > MAX_DELAY_MS) {
    throw new Error(`delayMs must be an integer between ${minimumDelay} and ${MAX_DELAY_MS}.`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_PAGE_SIZE) throw new Error(`batchSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  return { delayMs, batchSize };
}

/**
 * Validate campaign-level delay settings supplied via the API or UI.
 * Returns an error string or null if valid.
 */
export function validateCampaignThrottleSettings(
  messageDelayMin: unknown,
  messageDelayMax: unknown,
  batchSize?: unknown,
  batchPauseSeconds?: unknown
): string | null {
  const min = Number(messageDelayMin);
  const max = Number(messageDelayMax);
  if (!Number.isInteger(min) || min < 0) return "messageDelayMin must be a non-negative integer.";
  if (!Number.isInteger(max) || max < min) return "messageDelayMax must be >= messageDelayMin.";
  if (max > 3600) return "messageDelayMax cannot exceed 3600 seconds (1 hour).";
  if (batchSize !== undefined) {
    const bs = Number(batchSize);
    if (!Number.isInteger(bs) || bs < 1 || bs > 1000) return "batchSize must be an integer between 1 and 1000.";
  }
  if (batchPauseSeconds !== undefined) {
    const bp = Number(batchPauseSeconds);
    if (!Number.isInteger(bp) || bp < 0 || bp > 3600) return "batchPauseSeconds must be between 0 and 3600.";
  }
  return null;
}

/** Atomically claim a fully reviewed campaign and create a queued durable job. */
export async function enqueueCampaignExecution(ctx: TenantContext, campaignId: string, options: ExecutionOptions = {}): Promise<EnqueuedCampaignExecution> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
    select: { status: true, channels: true },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status === "sent") throw new Error("Campaign has already been sent");
  if (campaign.status !== "approved") {
    throw new Error("Campaign is no longer ready to send; finish reviewing every message before starting delivery");
  }

  const channels = parseCampaignChannels(campaign.channels);
  await assertCampaignReadiness(ctx, channels);
  const execution = normalizeExecutionOptions(options);
  const now = new Date();
  const job = await prisma.$transaction(async (tx: any) => {
    const claim = await tx.campaign.updateMany({
      where: { id: campaignId, tenantId: ctx.tenantId, status: "approved" },
      data: { status: "sending", startedAt: now, completedAt: null },
    });
    if (claim.count !== 1) {
      const latest = await tx.campaign.findFirst({ where: { id: campaignId, tenantId: ctx.tenantId }, select: { status: true } });
      if (!latest) throw new Error("Campaign not found");
      if (latest.status === "sent") throw new Error("Campaign has already been sent");
      throw new Error("Campaign is already queued, sending, or is no longer ready to start");
    }
    return tx.job.create({
      data: {
        tenantId: ctx.tenantId, userId: ctx.userId, kind: "campaign", status: "queued",
        params: JSON.stringify({ campaignId, ...execution }),
        progress: JSON.stringify({ stage: "queued", current: 0, total: 0, sent: 0, failed: 0 }),
      },
    });
  });
  logger.info(`Queued a fully reviewed campaign for paced execution.${logContext({ tenant: ctx.tenantId, user: ctx.userId, campaign: campaignId, job: job.id })}`);
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

/** Parse the throttle settings from a Campaign row into unified ms values. */
function parseCampaignThrottle(campaignRow: any): CampaignThrottle {
  const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  const hasCustomDelay = campaignRow?.messageDelayMin != null || campaignRow?.messageDelayMax != null;
  const hasCustomBatchPause = campaignRow?.batchPauseSeconds != null;

  let delayMinMs = 0;
  let delayMaxMs = 0;
  if (hasCustomDelay) {
    delayMinMs = Math.max(0, (Number(campaignRow?.messageDelayMin) || 0) * 1_000);
    delayMaxMs = Math.max(delayMinMs, (Number(campaignRow?.messageDelayMax) || 0) * 1_000);
  } else if (!isTest) {
    delayMinMs = DEFAULT_DELAY_MIN_S * 1_000;
    delayMaxMs = DEFAULT_DELAY_MAX_S * 1_000;
  }

  const batchSize = Math.max(1, Number(campaignRow?.batchSize) || DEFAULT_PAGE_SIZE);
  const batchPauseMs = hasCustomBatchPause
    ? Math.max(0, Number(campaignRow.batchPauseSeconds) * 1_000)
    : (isTest ? 0 : 60 * 1_000);

  const pauseEveryMs = Math.max(0, (Number(campaignRow?.pauseEveryMinutes) || 0) * 60_000);
  const shuffleContent = Boolean(campaignRow?.shuffleContent);

  return { delayMinMs, delayMaxMs, batchSize, batchPauseMs, pauseEveryMs, shuffleContent };
}

/** Read the persisted time-pause window start from Job.progress (epoch ms). */
function readBatchWindowStart(progressJson: string | null | undefined): number {
  try {
    const p = JSON.parse(progressJson || "{}");
    const v = Number(p[BATCH_WINDOW_KEY]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/** Patch the time-pause window start into a progress JSON string. */
function withBatchWindow(progressJson: string | null | undefined, startedAt: number): string {
  try {
    const p = JSON.parse(progressJson || "{}");
    return JSON.stringify({ ...p, [BATCH_WINDOW_KEY]: startedAt });
  } catch {
    return JSON.stringify({ [BATCH_WINDOW_KEY]: startedAt });
  }
}

/** Pick a uniformly-random integer delay in [minMs, maxMs]. */
function randomRangeDelay(minMs: number, maxMs: number): number {
  if (minMs >= maxMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

/** Read the persisted batchSentCount from Job.progress. */
function readBatchSentCount(progressJson: string | null | undefined): number {
  try {
    const p = JSON.parse(progressJson || "{}");
    return Math.max(0, Number(p[BATCH_SENT_KEY] || 0));
  } catch {
    return 0;
  }
}

/** Patch batchSentCount into a progress JSON string. */
function withBatchCount(progressJson: string | null | undefined, count: number): string {
  try {
    const p = JSON.parse(progressJson || "{}");
    return JSON.stringify({ ...p, [BATCH_SENT_KEY]: count });
  } catch {
    return JSON.stringify({ [BATCH_SENT_KEY]: count });
  }
}

export async function runClaimedCampaignJob(job: any): Promise<WorkerRunResult> {
  const params = parseParams(job.params);
  if (!params.campaignId) throw new Error("Campaign job has no campaignId parameter.");
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.campaignId, tenantId: job.tenantId },
    select: {
      id: true, name: true, channels: true,
      // Throttle settings (new; default values applied in parseCampaignThrottle).
      messageDelayMin: true, messageDelayMax: true, batchSize: true, batchPauseSeconds: true,
      // Anti-block controls.
      shuffleContent: true, pauseEveryMinutes: true,
    },
  });
  if (!campaign) return finishOwnedJob(job, "failed", { error: "Campaign no longer exists." });
  const ctx = { tenantId: job.tenantId, userId: job.userId, membershipId: "worker", role: "owner", tenantName: "worker", tenantSlug: "worker", permissions: new Set<string>() } as TenantContext;
  const channels = parseCampaignChannels(campaign.channels);
  const [smtp, googleSheet] = await Promise.all([
    resolveTenantSmtpConfig(ctx),
    resolveTenantGoogleSheetConfig(ctx),
  ]);

  // Throttle settings: use campaign-specific values (may be defaults for old campaigns).
  const throttle = parseCampaignThrottle(campaign);

  // Integrations can be disabled after enqueue and before a worker claims the
  // job. Recheck without sending anything, restore the approved campaign, and
  // let the user reconnect and start it again.
  const readinessError = channels.email && !smtp
    ? "SMTP email is no longer configured for this workspace."
    : null;
  if (readinessError) {
    await prisma.campaign.updateMany({
      where: { id: campaign.id, tenantId: job.tenantId, status: "sending" },
      data: { status: "approved", startedAt: null },
    });
    return finishOwnedJob(job, "failed", { error: readinessError });
  }

  let sent = 0; let failed = 0; let skipped = 0;
  // Restore batch counter from persisted progress so a worker restart doesn't
  // reset it, causing an extra batch pause.
  let batchSentCount = readBatchSentCount(job.progress);
  // Time-based pause window: when the current sending window started. Restored
  // from progress across restarts; initialised lazily on the first send.
  let batchWindowStartedAt = readBatchWindowStart(job.progress);
  const jobFields = { tenant: job.tenantId, job: job.id, campaign: campaign.id, worker: job.workerId };
  const total = await prisma.campaignMessage.count({ where: { campaignId: campaign.id, tenantId: job.tenantId, status: { in: ["approved", "retry_wait", "sending"] } } });

  while (true) {
    if (!(await heartbeatJob(job))) {
      logger.warn(`Campaign worker lost its job lease and stopped processing.${logContext(jobFields)}`);
      return { jobId: job.id, sent, failed, skipped, cancelled: false, deferred: false };
    }
    const jobRow = await prisma.job.findFirst({ where: { id: job.id, tenantId: job.tenantId, workerId: job.workerId, leaseToken: job.leaseToken }, select: { status: true, cancelRequestedAt: true, progress: true } });
    if (!jobRow || jobRow.status === "cancelling" || jobRow.cancelRequestedAt) {
      await recomputeCampaignCounts(campaign.id, job.tenantId, "cancelled");
      logger.info(`Campaign execution cancelled after ${sent} sent, ${failed} failed, ${skipped} skipped.${logContext(jobFields)}`);
      return finishOwnedJob(job, "cancelled", { result: { campaignId: campaign.id, sent, failed, skipped, cancelled: true } });
    }
    // Sync the batch counter from DB in case this worker just started after a restart.
    if (sent === 0) batchSentCount = readBatchSentCount(jobRow.progress);

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

    // ── Feature 1 & 2: Sender selection / rotation ──────────────────────────
    // On a retry, reuse the sender already committed to this message.
    // On a first attempt, select the next sender in the rotation.
    let resolvedSenderId: string | null = message.selectedSenderId ?? null;
    let resolvedSenderConfig: Record<string, unknown> | null = null;
    // The 1-based WhatsApp session slot (1-5) the rotation selected. For email
    // this is unused. Defaults to slot 1 so sending degrades to the primary
    // account if rotation produced nothing.
    let resolvedSenderSlot = 1;

    const senderChannel: SenderChannel = message.channel === "email" ? "email" : "whatsapp";
    const senderResult = await determineMessageSender(
      campaign.id,
      job.tenantId,
      senderChannel,
      resolvedSenderId
    );
    if (senderResult) {
      resolvedSenderId = senderResult.integrationId;
      resolvedSenderConfig = senderResult.config;
      resolvedSenderSlot = senderResult.slot;
      // Persist the selected sender on first attempt so retries use the same one.
      if (!message.selectedSenderId) {
        await prisma.campaignMessage.updateMany({
          where: { id: message.id, tenantId: job.tenantId },
          data: { selectedSenderId: resolvedSenderId },
        }).catch(() => undefined);
      }
    }

    // ── Feature 7: Template variation selection ──────────────────────────────
    // Atomically pick the next approved variation for this campaign+channel.
    const variation = await selectNextVariation(campaign.id, job.tenantId, message.channel).catch(() => null);

    try {
      // Compliance is checked at delivery time, not only at generation time: a
      // contact can opt out after the copy was approved but before it is sent.
      if (await isSuppressedRecipient(job, message)) {
        if (await finishLeasedMessage(message, job, "suppressed", "Recipient is on this workspace's suppression list.")) {
          skipped++;
          logger.info(`Campaign message skipped: the recipient has opted out.${logContext(messageFields)}`);
        }
      } else {
        // Apply template variation content if available, otherwise use message body.
        const baseBody = variation
          ? compileVariationForLead(variation.content, { businessName: message.businessName })
          : message.body;

        // ── Anti-block: per-message AI content shuffle ──────────────────────
        // Reword the final, variable-resolved text so a bulk run is not
        // byte-identical. shuffleMessageContent is self-contained: it returns
        // the original text on any AI failure or unsafe reword, so it can never
        // block or corrupt a send.
        const effectiveBody = throttle.shuffleContent
          ? await shuffleMessageContent(baseBody, { tenantId: job.tenantId, userId: job.userId })
          : baseBody;

        const effectiveSubject = variation?.subject || message.subject;
        const effectiveMessage = { ...message, body: effectiveBody, subject: effectiveSubject ?? null };

        // Resolve SMTP config for this specific sender (may differ from primary).
        const smtpForSender = senderChannel === "email" && resolvedSenderConfig
          ? resolvedSmtpFromConfig(resolvedSenderConfig)
          : smtp;

        const externalMessageId = await withLeaseKeepAlive(job, message, () =>
          deliverMessageWithSender(ctx, effectiveMessage, smtpForSender, resolvedSenderId, resolvedSenderSlot)
        );
        if (await finishLeasedMessage(message, job, "sent", undefined, externalMessageId)) {
          sent++;
          batchSentCount++;
          await recordCampaignDispatch({
            message: effectiveMessage,
            campaignName: campaign.name,
            status: "SENT",
            externalMessageId,
            senderIntegrationId: resolvedSenderId ?? undefined,
            variationId: variation?.variationId,
            variationIndex: variation?.variationIndex,
          }).catch((error) => logger.warn(`Delivery persisted but report repair is needed: ${error?.message || error}${logContext(messageFields)}`));
          await syncDeliveryToCrmAndInbox(job, message, { status: "SENT", externalMessageId }, googleSheet!.webhookUrl);
          logger.info(`Campaign message delivered.${logContext({ ...messageFields, providerMessageId: externalMessageId, sender: resolvedSenderId, variation: variation?.variationIndex })}`);
        }
      }
    } catch (error: any) {
      const reason = error instanceof Error ? error.message : String(error);
      const permanent = isPermanentError(reason) || message.attemptCount >= MAX_MESSAGE_ATTEMPTS;
      if (await finishLeasedMessage(message, job, permanent ? "failed" : "retry_wait", reason)) {
        if (permanent) {
          failed++;
          await recordCampaignDispatch({ message, campaignName: campaign.name, status: "FAILED", errorMessage: reason }).catch((reportError) => logger.warn(`Failure persisted but report repair is needed: ${reportError?.message || reportError}${logContext(messageFields)}`));
          await syncDeliveryToCrmAndInbox(job, message, { status: "FAILED" }, googleSheet!.webhookUrl);
        }
      }
      logger.warn(`Campaign message ${permanent ? "failed permanently" : "will retry"}: ${reason}${logContext(messageFields)}`);
    }
    const complete = sent + failed + skipped;

    // ── Batch pause (time-based or count-based) ──────────────────────────────
    //
    // Time-based (pauseEveryMs > 0): pause after `pauseEveryMinutes` of
    // continuous sending — this is the "pause every 5 minutes" behaviour. The
    // window-start timestamp lives in Job.progress so it survives restarts.
    //
    // Count-based (fallback): pause after `batchSize` successful sends. Both
    // persist their counters in Job.progress.
    //
    // Open the time window on the first send if it is not already running.
    if (throttle.pauseEveryMs > 0 && batchWindowStartedAt === 0) {
      batchWindowStartedAt = Date.now();
    }

    let progressPayload = withBatchCount(
      JSON.stringify({ stage: "sending", current: complete, total, sent, failed, skipped }),
      batchSentCount
    );
    if (throttle.pauseEveryMs > 0) {
      progressPayload = withBatchWindow(progressPayload, batchWindowStartedAt);
    }
    await prisma.job.updateMany({
      where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" },
      data: { progress: progressPayload },
    });

    const timeTriggered =
      throttle.pauseEveryMs > 0 &&
      batchWindowStartedAt > 0 &&
      Date.now() - batchWindowStartedAt >= throttle.pauseEveryMs;
    const countTriggered =
      throttle.pauseEveryMs === 0 &&
      batchSentCount > 0 &&
      batchSentCount % throttle.batchSize === 0;

    if ((timeTriggered || countTriggered) && throttle.batchPauseMs > 0) {
      const moreMessages = await prisma.campaignMessage.findFirst({
        where: { campaignId: campaign.id, tenantId: job.tenantId, status: { in: ["approved", "retry_wait", "sending"] } },
        select: { id: true },
      });
      if (moreMessages) {
        const reason = timeTriggered
          ? `${Math.round(throttle.pauseEveryMs / 60_000)} min of sending elapsed`
          : `${batchSentCount} messages sent`;
        logger.info(`Campaign batch pause: ${reason}. Pausing ${Math.ceil(throttle.batchPauseMs / 1_000)}s before continuing.${logContext(jobFields)}`);
        await delayHoldingLease(job, throttle.batchPauseMs);
        // Reset both counters so the next window/batch triggers another pause.
        batchSentCount = 0;
        batchWindowStartedAt = throttle.pauseEveryMs > 0 ? Date.now() : 0;
        let resetPayload = withBatchCount(progressPayload, 0);
        if (throttle.pauseEveryMs > 0) resetPayload = withBatchWindow(resetPayload, batchWindowStartedAt);
        await prisma.job.updateMany({
          where: { id: job.id, workerId: job.workerId, leaseToken: job.leaseToken, status: "running" },
          data: { progress: resetPayload },
        });
      }
    }

    // ── Feature 4: Random inter-message delay ────────────────────────────────
    // Pick a uniformly-random delay in [delayMinMs, delayMaxMs]. Skip after
    // the final message.
    const delayMs = throttle.delayMinMs > 0 || throttle.delayMaxMs > 0
      ? randomRangeDelay(throttle.delayMinMs, throttle.delayMaxMs)
      : (params.delayMs > 0 ? randomizedPacingDelay(params.delayMs) : 0);
    if (delayMs > 0) {
      const moreMessages = await prisma.campaignMessage.findFirst({
        where: { campaignId: campaign.id, tenantId: job.tenantId, status: { in: ["approved", "retry_wait", "sending"] } },
        select: { id: true },
      });
      if (moreMessages) {
        logger.info(`Campaign pacing: waiting ${Math.ceil(delayMs / 1_000)}s before the next message.${logContext(jobFields)}`);
        await delayHoldingLease(job, delayMs);
      }
    }
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
  options: { status: "SENT" | "FAILED"; externalMessageId?: string },
  sheetWebhookUrl: string
): Promise<void> {
  if (message.channel !== "email" && message.channel !== "whatsapp") return;
  const today = new Date().toISOString().split("T")[0];
  let mapsUrl = "";

  // Database/inbox repair is best-effort because provider delivery has already
  // happened and must never be retried due to a bookkeeping error.
  try {
    if (message.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: message.leadId, tenantId: job.tenantId },
        select: { mapsUrl: true },
      });
      mapsUrl = String(lead?.mapsUrl || "");
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

  // Sheet synchronization is intentionally separate from provider delivery.
  // Its own retries cannot resend the email/WhatsApp message.
  const sheetSynced = await syncCampaignOutreachToGoogleSheet({
    webhookUrl: sheetWebhookUrl,
    businessName: message.businessName,
    mapsUrl,
    channel: message.channel,
    status: options.status,
  }).catch(() => false);
  if (!sheetSynced) {
    logger.warn(`Delivery recorded but Google Sheet sync needs repair.${logContext({ tenant: job.tenantId, job: job.id, message: message.id })}`);
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

async function resolveTenantGoogleSheetConfig(ctx: TenantContext): Promise<TenantGoogleSheetConfig | null> {
  if (ctx.userId) {
    const raw = (await getUserIntegration(ctx.userId, "google_sheet", ctx.tenantId)) as any;
    const webhookUrl = String(raw?.webhookUrl || "").trim();
    if (webhookUrl && webhookUrl !== "YOUR_WEBHOOK_URL") return { webhookUrl };
  }
  const envUrl = String(
    process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SHEET_WEBHOOK_URL || ""
  ).trim();
  if (envUrl && envUrl !== "YOUR_WEBHOOK_URL") return { webhookUrl: envUrl };
  return null;
}

async function resolveTenantSmtpConfig(ctx: TenantContext): Promise<TenantSmtpConfig | null> {
  if (!ctx.userId) return null;
  const raw = (await getUserIntegration(ctx.userId, "smtp", ctx.tenantId)) as any;
  if (!raw?.host || !raw?.user || !raw?.password) return null;
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host: String(raw.host), port, secure: Boolean(raw.secure), user: String(raw.user), pass: String(raw.password), from: String(raw.fromName || raw.fromEmail || raw.user) };
}

/**
 * Convert a generic config object from the integration store into a typed SMTP config.
 * Returns null if required fields are missing.
 */
function resolvedSmtpFromConfig(config: Record<string, unknown>): TenantSmtpConfig | null {
  const port = Number(config.port);
  if (!config.host || !config.user || !config.password) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    host: String(config.host),
    port,
    secure: Boolean(config.secure),
    user: String(config.user),
    pass: String(config.password),
    from: String(config.fromName || config.fromEmail || config.user),
  };
}

/**
 * Core delivery function. Accepts an optional senderId for multi-sender
 * WhatsApp routing (future: pass the specific client/session per sender).
 */
async function deliverMessageWithSender(
  ctx: TenantContext,
  message: CampaignMessageSnapshot,
  smtp: TenantSmtpConfig | null,
  _senderId?: string | null,
  senderSlot?: number
): Promise<string | undefined> {
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
    // `senderSlot` routes the send through the specific linked WhatsApp account
    // picked by the rotation layer, so campaigns spread across all 5 sessions.
    const result = await sendWhatsAppUnified(message.recipient, message.body, { userId: ctx.userId, tenantId: ctx.tenantId, allowTemplateFallback: true, slot: senderSlot });
    if (!result.ok) throw new Error(result.error || "WhatsApp send failed");
    return result.messageId;
  }
  throw new Error(`Unknown campaign channel: ${message.channel}`);
}

/** Backward-compat alias used by tests that import deliverMessage. */
async function deliverMessage(ctx: TenantContext, message: CampaignMessageSnapshot, smtp: TenantSmtpConfig | null): Promise<string | undefined> {
  return deliverMessageWithSender(ctx, message, smtp, null);
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
function randomizedPacingDelay(baseMs: number): number {
  if (baseMs <= 0) return 0;
  const jitter = Math.floor(Math.random() * Math.max(1, baseMs * DELAY_JITTER_RATIO));
  return Math.min(MAX_DELAY_MS, baseMs + jitter);
}
function isValidEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
