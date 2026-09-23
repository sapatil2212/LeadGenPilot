/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plan catalogue, as a database table the operator owns.
 *
 * `src/plans.ts` stays the compiled fallback that entitlement enforcement can
 * always read, including when the database is unreachable. This module is the
 * editable layer on top: the same three tiers, seeded once from those constants,
 * and authoritative afterwards for price, limits and packaging.
 *
 * Seeding is lazy and idempotent (`skipDuplicates`), so the console never opens
 * on an empty pricing table and a fresh deploy needs no separate seed step.
 */

import { prisma } from "../prisma";
import { PLANS } from "../plans";
import { logger } from "../logger";
import { badRequest } from "./shared";

/** Keys that always remain valid even if the table is empty or unreachable. */
export const FALLBACK_PLAN_KEYS = ["free", "pro", "custom"] as const;

/** Feature keys a plan can grant. Mirrors the booleans in src/plans.ts. */
export const PLAN_FEATURE_KEYS = [
  "whatsappOutreach",
  "aiInsights",
  "prioritySupport",
  "customIntegrations",
] as const;

/**
 * Prices the seed starts from, in minor units (paise).
 *
 * `src/plans.ts` carries entitlements but no price — the only figure that ever
 * existed was "₹999/mo" in a source comment. These are that comment, promoted
 * to data the operator can correct in the console.
 */
const SEED_PRICING: Record<string, { monthly: number; yearly: number; trialDays: number; sort: number; highlight: boolean }> = {
  free: { monthly: 0, yearly: 0, trialDays: 0, sort: 0, highlight: false },
  pro: { monthly: 99_900, yearly: 999_000, trialDays: 14, sort: 1, highlight: true },
  custom: { monthly: 0, yearly: 0, trialDays: 0, sort: 2, highlight: false },
};

let seedAttempted = false;

/**
 * Creates the default plan rows if the table is empty.
 *
 * Runs at most once per process and never throws: a catalogue that cannot be
 * seeded is a degraded console, not a broken one, and the fallback keys keep
 * every other endpoint working.
 */
export async function ensurePlansSeeded(): Promise<void> {
  if (seedAttempted) return;
  seedAttempted = true;
  try {
    const existing = await prisma.planDefinition.count();
    if (existing > 0) return;

    const rows = (Object.keys(PLANS) as Array<keyof typeof PLANS>).map((key) => {
      const entitlements = PLANS[key];
      const pricing = SEED_PRICING[key] ?? { monthly: 0, yearly: 0, trialDays: 0, sort: 9, highlight: false };
      const features = PLAN_FEATURE_KEYS.filter((f) => (entitlements as any)[f] === true);
      return {
        key,
        name: entitlements.planName,
        description:
          key === "free"
            ? "Entry tier. Everything needed to evaluate the product on real data."
            : key === "pro"
              ? "Unlimited discovery with WhatsApp outreach and AI copy."
              : "Negotiated volume and terms, priced per account.",
        priceMonthly: pricing.monthly,
        priceYearly: pricing.yearly,
        currency: "INR",
        // Infinity cannot be stored; -1 is this schema's unlimited sentinel.
        monthlyLeadLimit: Number.isFinite(entitlements.monthlyLeadLimit)
          ? entitlements.monthlyLeadLimit
          : -1,
        seats: key === "free" ? 1 : -1,
        trialDays: pricing.trialDays,
        features: JSON.stringify(features),
        highlight: pricing.highlight,
        isActive: true,
        isPublic: key !== "custom",
        sortOrder: pricing.sort,
      };
    });

    await prisma.planDefinition.createMany({ data: rows, skipDuplicates: true });
    logger.info(`Seeded ${rows.length} plan definitions from src/plans.ts defaults.`);
  } catch (err) {
    // A missing table means the migration has not been applied. The caller's
    // own query will surface that as migration_required; do not mask it here.
    seedAttempted = false;
    logger.warn(`Plan catalogue seed skipped: ${(err as Error).message}`);
  }
}

/**
 * Plan keys a user or subscription may be assigned.
 *
 * Union of the catalogue and the fallbacks, so retiring "pro" in the table
 * cannot make existing `users.plan` values fail validation and strand those
 * accounts on a value the API refuses to accept back.
 */
export async function allowedPlanKeys(): Promise<string[]> {
  try {
    await ensurePlansSeeded();
    const rows = await prisma.planDefinition.findMany({ select: { key: true } });
    return [...new Set([...FALLBACK_PLAN_KEYS, ...rows.map((r) => r.key)])];
  } catch {
    return [...FALLBACK_PLAN_KEYS];
  }
}

/** Validates a plan key against the catalogue. Throws a 400 if unknown. */
export async function assertPlanKey(value: unknown, field = "Plan"): Promise<string> {
  const key = String(value ?? "").trim().toLowerCase();
  const allowed = await allowedPlanKeys();
  if (!allowed.includes(key)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return key;
}

export interface PlanPricing {
  key: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  seats: number;
  monthlyLeadLimit: number;
}

/** Pricing for one plan, or null when the catalogue has no such row. */
export async function getPlanPricing(key: string): Promise<PlanPricing | null> {
  try {
    await ensurePlansSeeded();
    const row = await prisma.planDefinition.findUnique({ where: { key } });
    if (!row) return null;
    return {
      key: row.key,
      name: row.name,
      priceMonthly: row.priceMonthly,
      priceYearly: row.priceYearly,
      currency: row.currency,
      trialDays: row.trialDays,
      seats: row.seats,
      monthlyLeadLimit: row.monthlyLeadLimit,
    };
  } catch {
    return null;
  }
}

/** Parses the JSON feature array stored on a plan row, defensively. */
export function parsePlanFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
