/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-job log capture for the dashboard console.
 *
 * WHY THIS EXISTS
 * ---------------
 * The process log (`scraper-log.txt`, served by GET /api/logs) contains every
 * workspace's search queries and discovered business names, so it is
 * operator-only and can never be shown to a tenant. That left the Lead Finder
 * console with nothing to display during a run: it only ever rendered the few
 * optimistic lines the browser wrote itself.
 *
 * WHY AsyncLocalStorage RATHER THAN A GLOBAL SINK
 * ----------------------------------------------
 * `logger` is a module-level singleton shared by the whole process, so a plain
 * subscription would receive the interleaved output of every concurrent run and
 * could not tell which workspace produced a line. Two tenants discovering leads
 * at the same time would each see the other's business names — the exact
 * cross-tenant disclosure the job model was introduced to remove.
 *
 * AsyncLocalStorage propagates through every `await` in a run, so each captured
 * line is attributed to the job that actually emitted it. A line written outside
 * any run (server boot, the email poller) has no context and is not captured.
 *
 * Buffers are in memory and bounded on both axes — lines per job and number of
 * jobs retained — because this is a live console feed, not an audit trail. The
 * durable record of a run remains the Job row's progress/result/error.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface JobLogContext {
  jobId: string;
  tenantId: string;
}

/** Lines kept per job. A discovery run emits roughly 15 lines per lead. */
const MAX_LINES_PER_JOB = 1_000;

/** Jobs retained at once. Oldest buffer is evicted first. */
const MAX_TRACKED_JOBS = 25;

interface JobLogBuffer {
  tenantId: string;
  /** Sequence number of the first line still held in `lines`. */
  firstSeq: number;
  /** Sequence number to assign to the next line appended. */
  nextSeq: number;
  lines: string[];
  updatedAt: number;
}

const storage = new AsyncLocalStorage<JobLogContext>();
const buffers = new Map<string, JobLogBuffer>();

/**
 * Runs `fn` with a log context attached, so every line logged inside it (at any
 * await depth) is captured against this job.
 */
export function runWithJobLogContext<T>(context: JobLogContext, fn: () => Promise<T>): Promise<T> {
  buffers.set(context.jobId, {
    tenantId: context.tenantId,
    firstSeq: 0,
    nextSeq: 0,
    lines: [],
    updatedAt: Date.now(),
  });
  evictOldestBuffers();
  return storage.run(context, fn);
}

/** The job whose run is currently executing, if any. */
export function currentJobLogContext(): JobLogContext | undefined {
  return storage.getStore();
}

/**
 * Records one formatted log line against the running job.
 *
 * Called by the logger for every line it writes. A no-op outside a run, which is
 * what keeps unrelated process output out of tenant-visible buffers.
 */
export function captureJobLogLine(line: string): void {
  const context = storage.getStore();
  if (!context) return;
  const buffer = buffers.get(context.jobId);
  if (!buffer) return;

  buffer.lines.push(line);
  buffer.nextSeq += 1;
  buffer.updatedAt = Date.now();

  // Drop the oldest lines rather than growing without bound. `firstSeq` moves
  // with them so a reader can detect that it missed some.
  if (buffer.lines.length > MAX_LINES_PER_JOB) {
    const overflow = buffer.lines.length - MAX_LINES_PER_JOB;
    buffer.lines.splice(0, overflow);
    buffer.firstSeq += overflow;
  }
}

/**
 * Lines for a job after the caller's last-seen sequence number.
 *
 * Returns null when the job has no buffer in this process (a restart, or an
 * older run that has been evicted) or when it belongs to another workspace, so
 * the caller cannot distinguish "not yours" from "not here".
 */
export function readJobLogLines(
  jobId: string,
  tenantId: string,
  afterSeq = 0
): { lines: string[]; nextSeq: number; firstSeq: number; dropped: boolean } | null {
  const buffer = buffers.get(jobId);
  if (!buffer || buffer.tenantId !== tenantId) return null;

  const from = Math.max(afterSeq, buffer.firstSeq);
  const startIndex = Math.max(0, from - buffer.firstSeq);
  return {
    lines: buffer.lines.slice(startIndex),
    nextSeq: buffer.nextSeq,
    firstSeq: buffer.firstSeq,
    dropped: afterSeq > 0 && afterSeq < buffer.firstSeq,
  };
}

/** Releases a job's buffer. Called when a run reaches a terminal state. */
export function clearJobLogBuffer(jobId: string): void {
  buffers.delete(jobId);
}

function evictOldestBuffers(): void {
  while (buffers.size > MAX_TRACKED_JOBS) {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, buffer] of buffers) {
      if (buffer.updatedAt < oldestAt) {
        oldestAt = buffer.updatedAt;
        oldestId = id;
      }
    }
    if (!oldestId) return;
    buffers.delete(oldestId);
  }
}

/** Test seam: forget every buffer. */
export function resetJobLogBuffers(): void {
  buffers.clear();
}
