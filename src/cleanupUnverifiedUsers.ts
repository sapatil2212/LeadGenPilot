/**
 * Cleanup Unverified Users
 * Automatically removes users who haven't verified their email within 10 minutes
 */

import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

const VERIFICATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Delete unverified users older than 10 minutes
 */
export async function cleanupUnverifiedUsers(): Promise<number> {
  try {
    const cutoffTime = new Date(Date.now() - VERIFICATION_TIMEOUT_MS);

    const result = await prisma.user.deleteMany({
      where: {
        emailVerified: false,
        createdAt: {
          lt: cutoffTime, // Less than cutoff time (older than 10 minutes)
        },
      },
    });

    if (result.count > 0) {
      logger.info(`Cleaned up ${result.count} unverified user(s) older than 10 minutes`);
    }

    return result.count;
  } catch (error) {
    logger.error("Error cleaning up unverified users:", error);
    return 0;
  }
}

/**
 * Start periodic cleanup job
 * Runs every 5 minutes to check for expired unverified accounts
 */
export function startUnverifiedUserCleanup(): NodeJS.Timeout {
  // Run immediately on startup
  cleanupUnverifiedUsers();

  // Then run every 5 minutes
  const interval = setInterval(() => {
    cleanupUnverifiedUsers();
  }, 5 * 60 * 1000); // Every 5 minutes

  logger.info("Started unverified user cleanup job (runs every 5 minutes)");

  return interval;
}

/**
 * Stop the cleanup job
 */
export function stopUnverifiedUserCleanup(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  logger.info("Stopped unverified user cleanup job");
}
