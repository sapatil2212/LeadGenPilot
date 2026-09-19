/** Dedicated durable campaign worker entry point. */
import crypto from "node:crypto";
import { connectDatabase, disconnectDatabase } from "./prisma";
import { logger } from "./logger";
import { runCampaignWorkerCycle } from "./campaign/campaignExecutor";

const workerId = process.env.WORKER_ID?.trim() || `campaign-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const pollMs = Math.max(250, Number(process.env.CAMPAIGN_WORKER_POLL_MS) || 2_000);
let stopping = false;

async function poll(): Promise<void> {
  if (stopping) return;
  try {
    // Process one durable job per tick. A long campaign remains leased to this
    // process; other replicas continue polling and cannot claim that lease.
    await runCampaignWorkerCycle(workerId);
  } catch (error: any) {
    logger.error(`Campaign worker poll failed: ${error?.message || error}`);
  }
}

async function main(): Promise<void> {
  if (!(await connectDatabase())) throw new Error("Campaign worker requires DATABASE_URL and a reachable MySQL database.");
  logger.info(`Campaign worker ${workerId} started; polling every ${pollMs}ms.`);
  await poll();
  const timer = setInterval(() => void poll(), pollMs);
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    logger.info(`Campaign worker ${workerId} received ${signal}; leases will expire if work is in flight.`);
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error) => { logger.error(`Campaign worker could not start: ${error?.message || error}`); process.exit(1); });
