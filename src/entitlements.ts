/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma";
import { env } from "./env";
import { verifySessionToken } from "./authService";
import { getEntitlements, ADMIN_ENTITLEMENTS, type Entitlements, type GatedFeature } from "./plans";
import { logger } from "./logger";

// Augment Express Request with resolved auth context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: any;
      entitlements?: Entitlements;
      /** True when auth is disabled (no DB) — treat as unlimited/admin. */
      authDisabled?: boolean;
    }
  }
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

export interface UsageInfo {
  used: number;
  limit: number; // may be Infinity
  remaining: number; // may be Infinity
  period: string;
  unlimited: boolean;
}

export function computeUsage(user: any, ent: Entitlements): UsageInfo {
  const period = currentPeriod();
  const used = user && user.usagePeriod === period ? user.leadsUsed || 0 : 0;
  const limit = ent.monthlyLeadLimit;
  const unlimited = !Number.isFinite(limit);
  return {
    used,
    limit,
    remaining: unlimited ? Infinity : Math.max(0, limit - used),
    period,
    unlimited,
  };
}

/**
 * Increments a user's monthly lead usage, resetting the counter when the
 * billing period rolls over.
 */
export async function consumeLeads(userId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const period = currentPeriod();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const base = user.usagePeriod === period ? user.leadsUsed || 0 : 0;
  await prisma.user.update({
    where: { id: userId },
    data: { leadsUsed: base + count, usagePeriod: period },
  });
}

/**
 * Resolves the signed-in user (if any) and their plan entitlements, attaching
 * them to the request. Non-blocking: unauthenticated requests still proceed
 * (individual routes decide whether auth is required).
 *
 * When the database is not configured, auth is considered disabled and full
 * admin entitlements are granted so the app remains usable.
 */
export async function attachEntitlements(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!env.isDatabaseConfigured()) {
      req.authDisabled = true;
      req.entitlements = ADMIN_ENTITLEMENTS;
      return next();
    }
    const token = req.cookies?.[env.auth.cookieName] || req.cookies?.["nexaleadai_session"];
    const payload = token ? verifySessionToken(token) : null;
    if (payload) {
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        req.authUser = user;
        req.entitlements = getEntitlements(user.plan);
      }
    }
  } catch (err) {
    logger.warn(`Failed to resolve entitlements: ${(err as Error).message}`);
  }
  next();
}

/**
 * Blocks a route unless the current plan includes the given feature.
 * Auth-disabled (admin) contexts always pass.
 */
export function requireFeature(feature: GatedFeature, label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.authDisabled) return next();
    const ent = req.entitlements;
    if (ent && ent[feature]) return next();
    const planName = ent?.planName || "current";
    return res.status(403).json({
      error: `${label} is not included in your ${planName} plan. Upgrade to Pro to unlock it.`,
      code: "plan_restricted",
      feature,
    });
  };
}

/** Convenience accessor with a safe admin fallback. */
export function entOf(req: Request): Entitlements {
  return req.entitlements || ADMIN_ENTITLEMENTS;
}
