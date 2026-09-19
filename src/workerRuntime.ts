/**
 * Polling runtime for the campaign worker.
 *
 * Extracted from the process entry point so the three behaviours that decide
 * whether a deployment is safe can be tested directly:
 *
 *  - single flight: a cycle can outlive its own poll interval (a campaign runs
 *    for minutes), so the timer must not start a second, third, nth cycle in the
 *    same process. Unbounded concurrent cycles means unbounded concurrent leases
 *    and database connections from one replica.
 *  - drain: SIGTERM must wait for the in-flight cycle instead of severing a
 *    provider call and disconnecting the database underneath it.
 *  - backoff: a database outage must not spin the loop at full speed or kill the
 *    process; leases expire on their own and the work is picked up on recovery.
 */
import { logger, logContext } from "./logger";

export interface WorkerRuntimeOptions {
  workerId: string;
  runCycle: () => Promise<unknown>;
  pollMs: number;
  drainTimeoutMs: number;
  maxFailureBackoffMs?: number;
  /** Injectable for tests; defaults to the real timers. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => number;
}

export interface WorkerRuntime {
  start(): void;
  /** Runs one poll immediately, respecting the single-flight and backoff rules. */
  poll(): Promise<void>;
  stop(signal: string): Promise<{ drained: boolean }>;
  isBusy(): boolean;
  consecutiveFailures(): number;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const setTimer = options.setIntervalFn ?? setInterval;
  const clearTimer = options.clearIntervalFn ?? clearInterval;
  const now = options.now ?? (() => Date.now());
  const maxBackoff = options.maxFailureBackoffMs ?? 60_000;

  let timer: any = null;
  let stopping = false;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let backoffUntil = 0;

  async function runOnce(): Promise<void> {
    try {
      await options.runCycle();
      if (failures > 0) {
        logger.info(`Campaign worker recovered after ${failures} failed cycle(s).${logContext({ worker: options.workerId })}`);
      }
      failures = 0;
      backoffUntil = 0;
    } catch (error: any) {
      failures += 1;
      const wait = Math.min(maxBackoff, 1_000 * 2 ** Math.min(6, failures - 1));
      backoffUntil = now() + wait;
      const message = `Campaign worker cycle failed (attempt ${failures}); retrying in ${Math.round(wait / 1_000)}s: ${error?.message || error}`;
      if (failures >= 5) logger.error(`${message}${logContext({ worker: options.workerId })}`);
      else logger.warn(`${message}${logContext({ worker: options.workerId })}`);
    }
  }

  async function poll(): Promise<void> {
    if (stopping || inFlight) return;
    if (now() < backoffUntil) return;
    inFlight = runOnce();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function drain(): Promise<boolean> {
    if (!inFlight) return true;
    let timeout: any;
    const expired = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), options.drainTimeoutMs);
    });
    try {
      return await Promise.race([inFlight.then(() => true), expired]);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setTimer(() => void poll(), options.pollMs);
      if (typeof timer?.unref === "function") timer.unref();
    },
    poll,
    async stop(signal: string) {
      if (stopping) return { drained: true };
      stopping = true;
      if (timer) clearTimer(timer);
      timer = null;
      logger.info(`Campaign worker received ${signal}; draining in-flight work (up to ${Math.round(options.drainTimeoutMs / 1_000)}s).${logContext({ worker: options.workerId })}`);
      const drained = await drain();
      if (!drained) {
        logger.warn(`Campaign worker did not finish in time; the lease will expire and another worker will resume.${logContext({ worker: options.workerId })}`);
      }
      return { drained };
    },
    isBusy: () => inFlight !== null,
    consecutiveFailures: () => failures,
  };
}
