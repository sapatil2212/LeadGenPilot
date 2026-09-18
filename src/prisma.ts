/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PrismaClient } from "@prisma/client";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Prisma client singleton.
 *
 * A single instance is reused across the process (and preserved across hot
 * reloads in development) to avoid exhausting the database connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ["error"] : ["error", "warn"],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/**
 * Verifies the database connection at startup. Returns true if reachable.
 * Never throws — auth routes guard on env.isDatabaseConfigured() separately.
 */
export async function connectDatabase(): Promise<boolean> {
  if (!env.isDatabaseConfigured()) return false;
  try {
    await prisma.$connect();
    logger.success("Database connection established.");
    return true;
  } catch (err: any) {
    logger.error("Failed to connect to the database", err);
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    /* noop */
  }
}
