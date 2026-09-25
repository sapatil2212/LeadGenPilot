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
import { PLANS, getEntitlements, type Entitlements } from "../plans";
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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC PROJECTION + RUNTIME ENTITLEMENTS
//
// Everything above this line serves the operator console. Everything below
// serves the two consumers that made the catalogue worth editing in the first
// place: the pricing sections a visitor sees, and the entitlement check that
// decides what a subscriber can actually do.
//
// Without the resolver below, editing "Monthly lead limit" in the console
// changed the number printed on the pricing card but not the number enforced at
// runtime — the card would advertise a quota the product refused to honour.
// ─────────────────────────────────────────────────────────────────────────────

/** Human-readable labels for the feature keys, for pricing tables. */
export const PLAN_FEATURE_LABELS: Record<string, string> = {
  whatsappOutreach: "WhatsApp outreach",
  aiInsights: "Advanced AI insights & copy",
  prioritySupport: "Priority support",
  customIntegrations: "Custom integrations & API",
};

/**
 * One plan as shown to an unauthenticated visitor.
 *
 * Deliberately narrower than the console row: `usersOnPlan`,
 * `activeSubscriptions` and `subscriptionValue` are commercial facts about the
 * business, not pricing, and are never published.
 *
 * `monthlyLeadLimit` and `seats` use `null` for unlimited rather than the
 * database's `-1` sentinel, matching the convention /api/auth/me already uses
 * for an infinite lead limit.
 */
export interface PublicPlan {
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  monthlyLeadLimit: number | null;
  seats: number | null;
  trialDays: number;
  features: string[];
  highlight: boolean;
}

/** `-1` is this schema's unlimited sentinel; the wire format uses null. */
function limitToWire(value: number): number | null {
  return value < 0 ? null : value;
}

function toPublicPlan(row: {
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  monthlyLeadLimit: number;
  seats: number;
  trialDays: number;
  features: string | null;
  highlight: boolean;
}): PublicPlan {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    priceMonthly: row.priceMonthly,
    priceYearly: row.priceYearly,
    currency: row.currency,
    monthlyLeadLimit: limitToWire(row.monthlyLeadLimit),
    seats: limitToWire(row.seats),
    trialDays: row.trialDays,
    features: parsePlanFeatures(row.features),
    highlight: row.highlight,
  };
}

/**
 * The published pricing table, derived from the compiled defaults.
 *
 * Used when the catalogue cannot be read at all (migration not yet applied,
 * database unreachable). A pricing section that renders the previous prices is
 * a better failure than one that renders nothing.
 */
function fallbackPublicPlans(): PublicPlan[] {
  return (Object.keys(PLANS) as Array<keyof typeof PLANS>)
    // Mirrors the seed's isPublic: a negotiated tier is not self-serve.
    .filter((key) => key !== "custom")
    .map((key) => {
      const entitlements = PLANS[key];
      const pricing = SEED_PRICING[key] ?? { monthly: 0, yearly: 0, trialDays: 0, sort: 9, highlight: false };
      return {
        key,
        name: entitlements.planName,
        description: null,
        priceMonthly: pricing.monthly,
        priceYearly: pricing.yearly,
        currency: "INR",
        monthlyLeadLimit: Number.isFinite(entitlements.monthlyLeadLimit) ? entitlements.monthlyLeadLimit : null,
        seats: key === "free" ? 1 : null,
        trialDays: pricing.trialDays,
        features: PLAN_FEATURE_KEYS.filter((f) => (entitlements as any)[f] === true),
        highlight: pricing.highlight,
      };
    });
}

/**
 * Plans a visitor may see: active, public, in the operator's chosen order.
 *
 * `source` lets the caller tell a real (possibly empty) catalogue from a
 * degraded read, and never throws for the same reason the seed never throws.
 */
export async function listPublicPlans(): Promise<{ plans: PublicPlan[]; source: "catalog" | "fallback" }> {
  try {
    await ensurePlansSeeded();
    const rows = await prisma.planDefinition.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { plans: rows.map(toPublicPlan), source: "catalog" };
  } catch (err) {
    logger.warn(`Public plan catalogue unavailable, serving compiled defaults: ${(err as Error).message}`);
    return { plans: fallbackPublicPlans(), source: "fallback" };
  }
}

/**
 * Entitlement lookup cache.
 *
 * attachEntitlements runs on every /api request, so an uncached resolver would
 * add a query per request. The TTL bounds staleness on its own; admin writes
 * also drop the cache explicitly so an operator sees their own edit take effect
 * immediately rather than up to a TTL later.
 */
const ENTITLEMENT_CACHE_TTL_MS = 30_000;
let entitlementCache: { expiresAt: number; byKey: Map<string, Entitlements> } | null = null;

/** Drops the cached catalogue. Call after any write to PlanDefinition. */
export function invalidatePlanCache(): void {
  entitlementCache = null;
}

function entitlementsFromRow(row: {
  name: string;
  monthlyLeadLimit: number;
  features: string | null;
}): Entitlements {
  const features = parsePlanFeatures(row.features);
  return {
    planName: row.name,
    // Infinity is not storable; -1 is the sentinel that means unlimited.
    monthlyLeadLimit: row.monthlyLeadLimit < 0 ? Infinity : row.monthlyLeadLimit,
    whatsappOutreach: features.includes("whatsappOutreach"),
    aiInsights: features.includes("aiInsights"),
    prioritySupport: features.includes("prioritySupport"),
    customIntegrations: features.includes("customIntegrations"),
  };
}

async function loadEntitlementMap(): Promise<Map<string, Entitlements>> {
  const cached = entitlementCache;
  if (cached && cached.expiresAt > Date.now()) return cached.byKey;

  await ensurePlansSeeded();
  // Inactive and non-public plans are included on purpose: deactivating a plan
  // hides it from new sign-ups, it does not strip the people already on it.
  const rows = await prisma.planDefinition.findMany({
    select: { key: true, name: true, monthlyLeadLimit: true, features: true },
  });
  const byKey = new Map<string, Entitlements>();
  for (const row of rows) byKey.set(row.key.toLowerCase(), entitlementsFromRow(row));

  entitlementCache = { expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS, byKey };
  return byKey;
}

/**
 * Entitlements for a plan key, preferring the operator-edited catalogue.
 *
 * Falls back to the compiled `getEntitlements` for an unknown key or an
 * unreadable catalogue, so enforcement degrades to the previous behaviour
 * instead of failing open. The falsy-key and "admin" cases are delegated
 * unchanged — that contract is pinned by tests/plans.test.ts.
 */
export async function resolveEntitlements(planKey: string | null | undefined): Promise<Entitlements> {
  if (!planKey) return getEntitlements(planKey);
  const key = String(planKey).toLowerCase();
  if (key === "admin") return getEntitlements(key);

  try {
    const byKey = await loadEntitlementMap();
    return byKey.get(key) ?? getEntitlements(key);
  } catch (err) {
    logger.warn(`Falling back to compiled entitlements for "${key}": ${(err as Error).message}`);
    return getEntitlements(key);
  }
}
