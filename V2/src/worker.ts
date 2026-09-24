/**
 * Dedicated durable campaign worker entry point.
 *
 * Deployed as its own process (`npm run worker`), so restarting the API never
 * interrupts a send and a slow campaign never occupies a web request. The worker
 * exposes no HTTP surface: its only inputs are the database and signals.
 *
 * The polling behaviour itself lives in ./workerRuntime so single-flight,
 * draining and failure backoff can be tested without starting a process.
 */
import crypto from "node:crypto";
import { connectDatabase, disconnectDatabase } from "./prisma";
import { logger, logContext } from "./logger";
import { runCampaignWorkerCycle } from "./campaign/campaignExecutor";
import { createWorkerRuntime } from "./workerRuntime";

const workerId = process.env.WORKER_ID?.trim() || `campaign-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const pollMs = Math.max(250, Number(process.env.CAMPAIGN_WORKER_POLL_MS) || 2_000);
/** How long shutdown waits for the in-flight cycle before leaving it to lease expiry. */
const drainTimeoutMs = Math.max(1_000, Number(process.env.CAMPAIGN_WORKER_DRAIN_MS) || 30_000);

async function main(): Promise<void> {
  if (!(await connectDatabase())) throw new Error("Campaign worker requires DATABASE_URL and a reachable MySQL database.");

  const runtime = createWorkerRuntime({
    workerId,
    pollMs,
    drainTimeoutMs,
    // One durable job per cycle. A long campaign stays leased to this process;
    // other replicas keep polling and cannot claim that lease.
    runCycle: () => runCampaignWorkerCycle(workerId),
  });

  logger.info(`Campaign worker started; polling every ${pollMs}ms.${logContext({ worker: workerId })}`);
  await runtime.poll();
  runtime.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runtime.stop(signal);
    await disconnectDatabase();
    logger.info(`Campaign worker stopped.${logContext({ worker: workerId })}`);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error) => {
  logger.error(`Campaign worker could not start: ${error?.message || error}`);
  process.exit(1);
});
