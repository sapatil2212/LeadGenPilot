/**
 * In-process campaign worker lifecycle manager.
 *
 * Runs the durable campaign worker inside the main Node server process by default,
 * ensuring campaigns immediately execute in local development and single-process
 * PM2 deployments without requiring a separate worker process.
 *
 * Can be disabled by setting DISABLE_IN_PROCESS_WORKER=true when running
 * dedicated worker replicas.
 */
import crypto from "node:crypto";
import { logger, logContext } from "../logger";
import { runCampaignWorkerCycle } from "./campaignExecutor";
import { createWorkerRuntime, type WorkerRuntime } from "../workerRuntime";

let inProcessWorker: WorkerRuntime | null = null;

export function startInProcessCampaignWorker(): WorkerRuntime | null {
  if (process.env.DISABLE_IN_PROCESS_WORKER === "true") {
    logger.info("In-process campaign worker is disabled via DISABLE_IN_PROCESS_WORKER=true.");
    return null;
  }
  if (inProcessWorker) return inProcessWorker;

  const workerId =
    process.env.WORKER_ID?.trim() ||
    `campaign-worker-server-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const pollMs = Math.max(250, Number(process.env.CAMPAIGN_WORKER_POLL_MS) || 2_000);
  const drainTimeoutMs = Math.max(1_000, Number(process.env.CAMPAIGN_WORKER_DRAIN_MS) || 30_000);

  inProcessWorker = createWorkerRuntime({
    workerId,
    pollMs,
    drainTimeoutMs,
    runCycle: () => runCampaignWorkerCycle(workerId),
  });

  logger.info(
    `In-process campaign worker started; polling every ${pollMs}ms.${logContext({
      worker: workerId,
    })}`
  );

  void inProcessWorker.poll();
  inProcessWorker.start();
  return inProcessWorker;
}

export function triggerCampaignWorkerCycle(): void {
  if (inProcessWorker) {
    void inProcessWorker.poll();
  }
}

export async function stopInProcessCampaignWorker(signal: string): Promise<void> {
  if (inProcessWorker) {
    const worker = inProcessWorker;
    inProcessWorker = null;
    await worker.stop(signal);
    logger.info(`In-process campaign worker stopped on ${signal}.`);
  }
}
