/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-tenant job state.
 *
 * Replaces the process-global singletons that used to represent long-running
 * work:
 *
 *   isScrapingRunning / scraperResult        (server.ts)
 *   stopRequested                            (mapsScraper.ts)
 *   isCampaignRunning / campaignCancelRequested / campaignProgress (server.ts)
 *
 * Those were one slot for the entire deployment. The consequences were not
 * subtle: the second tenant to start a scrape got "Scraping session is already
 * active", GET /api/campaign/status showed them somebody else's progress, and
 * POST /api/campaign/stop cancelled whoever happened to be running. A restart
 * lost the run with no record that it had ever existed.
 *
 * Moving this into rows keyed by tenant fixes all four: concurrency, isolation
 * of progress, ownership of cancellation, and durability.
 *
 * This module owns job STATE, not execution. It is deliberately transport- and
 * worker-agnostic so Phase 6 can put a real queue behind the same rows without
 * touching callers.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "./context";

export type JobKind = "lead_discovery" | "campaign";

export type JobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

/** Statuses that mean "this job still occupies the tenant's slot for its kind". */
export const ACTIVE_JOB_STATUSES: JobStatus[] = ["queued", "running", "cancelling"];

/** Statuses a job can never leave. */
export const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as string[]).includes(status);
}

/**
 * The state machine. A job may only move along these edges, so a late worker
 * callback cannot resurrect a cancelled job or overwrite a recorded failure.
 */
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelling", "cancelled", "failed"],
  running: ["cancelling", "completed", "failed", "cancelled"],
  cancelling: ["cancelled", "completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: string, to: JobStatus): boolean {
  const edges = ALLOWED_TRANSITIONS[from as JobStatus];
  return Array.isArray(edges) && edges.includes(to);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface JobView {
  id: string;
  kind: string;
  status: string;
  params: Record<string, unknown>;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toJobView(job: any): JobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    params: parseJson<Record<string, unknown>>(job.params, {}),
    progress: parseJson<Record<string, unknown>>(job.progress, {}),
    result: job.result ? parseJson<Record<string, unknown>>(job.result, {}) : null,
    error: job.error ?? null,
    cancelRequested: !!job.cancelRequestedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * The tenant's currently-active job of a kind, if any.
 *
 * This is the concurrency check that used to be a process-wide boolean. It is
 * per tenant AND per kind, so one workspace running a scrape no longer blocks a
 * different workspace, and a scrape no longer blocks that same workspace's
 * campaign.
 */
export async function findActiveJob(tenantId: string, kind: JobKind) {
  return prisma.job.findFirst({
    where: { tenantId, kind, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Claims the tenant's slot for a kind of work and returns the new job.
 *
 * Returns `{ job: null, conflict }` when one is already active, so the caller
 * can report which run is in the way instead of a bare refusal.
 *
 * NOTE ON RACING: two simultaneous requests could both observe "no active job".
 * A unique partial index would settle it, but MySQL has no partial indexes and a
 * plain unique on (tenantId, kind, status) would forbid a second COMPLETED job.
 * The exposure is one tenant double-clicking Start, which costs a duplicate run
 * rather than crossing a tenant boundary. Phase 6 closes it properly, when the
 * queue rather than the HTTP handler owns admission.
 */
export async function startJob(
  ctx: TenantContext,
  kind: JobKind,
  params: Record<string, unknown>
): Promise<{ job: any | null; conflict?: any }> {
  const active = await findActiveJob(ctx.tenantId, kind);
  if (active) return { job: null, conflict: active };

  const job = await prisma.job.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      kind,
      status: "running",
      params: JSON.stringify(params ?? {}),
      progress: JSON.stringify({ stage: "starting", current: 0, total: 0 }),
      startedAt: new Date(),
    },
  });

  logger.info(`Job ${job.id} (${kind}) started for workspace ${ctx.tenantId}.`);
  return { job };
}

/**
 * Merges progress into a job. Ignored once the job is terminal, so a worker that
 * finishes a final batch after cancellation cannot reopen it.
 */
export async function updateJobProgress(
  jobId: string,
  progress: Record<string, unknown>
): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true, progress: true } });
  if (!job || isTerminal(job.status)) return;

  const merged = { ...parseJson<Record<string, unknown>>(job.progress, {}), ...progress };
  await prisma.job
    .update({ where: { id: jobId }, data: { progress: JSON.stringify(merged) } })
    .catch((err: any) => logger.warn(`Could not persist progress for job ${jobId}: ${err?.message || err}`));
}

/** Moves a job to a terminal state, honouring the state machine. */
export async function finishJob(
  jobId: string,
  status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
  payload: { result?: Record<string, unknown>; error?: string } = {}
): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) return;

  if (!canTransition(job.status, status)) {
    logger.warn(`Ignored illegal job transition ${job.status} -> ${status} for job ${jobId}.`);
    return;
  }

  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        status,
        result: payload.result ? JSON.stringify(payload.result) : undefined,
        // Truncated: this is surfaced to the user, and a stack trace is neither
        // useful to them nor safe to echo.
        error: payload.error ? String(payload.error).slice(0, 2000) : undefined,
        finishedAt: new Date(),
      },
    })
    .catch((err: any) => logger.warn(`Could not finalise job ${jobId}: ${err?.message || err}`));
}

/**
 * Requests cancellation of one of the CALLING workspace's jobs.
 *
 * Scoped by tenant, which is the fix for the old global stop: previously any
 * caller could abort whatever run was in flight.
 */
export async function requestJobCancellation(
  ctx: TenantContext,
  jobId: string
): Promise<{ ok: boolean; reason?: string }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId: ctx.tenantId },
    select: { id: true, status: true },
  });
  if (!job) return { ok: false, reason: "not_found" };
  if (isTerminal(job.status)) return { ok: false, reason: "already_finished" };

  await prisma.job.update({
    where: { id: job.id },
    data: { status: "cancelling", cancelRequestedAt: new Date() },
  });
  logger.warn(`Cancellation requested for job ${job.id} by workspace ${ctx.tenantId}.`);
  return { ok: true };
}

/**
 * Whether a running job has been asked to stop. Workers poll this instead of
 * reading a module-level boolean, so cancellation is per job.
 */
export async function isCancellationRequested(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { cancelRequestedAt: true, status: true },
  });
  if (!job) return true; // the job is gone; stop working on it
  return !!job.cancelRequestedAt || job.status === "cancelling";
}

/** A job by id, scoped to the caller's workspace. */
export async function getJob(ctx: TenantContext, jobId: string): Promise<JobView | null> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId: ctx.tenantId } });
  return job ? toJobView(job) : null;
}

/** The caller's most recent job of a kind, active or finished. */
export async function getLatestJob(ctx: TenantContext, kind: JobKind): Promise<JobView | null> {
  const job = await prisma.job.findFirst({
    where: { tenantId: ctx.tenantId, kind },
    orderBy: { createdAt: "desc" },
  });
  return job ? toJobView(job) : null;
}

export async function listJobs(ctx: TenantContext, kind?: JobKind, limit = 20): Promise<JobView[]> {
  const jobs = await prisma.job.findMany({
    where: { tenantId: ctx.tenantId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return jobs.map(toJobView);
}

/**
 * Marks non-campaign jobs left by a dead web process as failed.
 *
 * Campaign jobs are deliberately excluded: their dedicated worker owns leases,
 * retries, and stale-lease recovery. Reclaiming them when a web replica restarts
 * would destroy durable work that a healthy worker is still processing.
 */
export async function reclaimAbandonedJobs(): Promise<number> {
  const { count } = await prisma.job.updateMany({
    where: { kind: { not: "campaign" }, status: { in: ["running", "cancelling", "queued"] } },
    data: {
      status: "failed",
      error: "Interrupted: the server restarted while this job was in progress.",
      finishedAt: new Date(),
    },
  });
  if (count > 0) {
    logger.warn(`Marked ${count} interrupted job(s) as failed after restart.`);
  }
  return count;
}
