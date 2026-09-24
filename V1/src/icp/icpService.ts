/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ideal Customer Profiles: who a workspace wants to reach, and where.
 *
 * Replaces `src/config.ts` — a mutable module-level object holding one vertical
 * ("ayurveda hospital clinic") and one city ("nashik") for the entire
 * deployment. Any tenant saving a search changed what every other tenant's next
 * discovery run looked for, and the plan-quota capper wrote its reduced
 * `maxResults` back into the same object, permanently lowering the cap for
 * everyone.
 *
 * Target categories and locations are free-form string arrays, never enums. The
 * categories a medical equipment manufacturer sells into ("Multispecialty
 * Hospital", "Diagnostic Centre") have nothing in common with a gym's, and any
 * fixed vocabulary would exclude somebody's actual market.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";
import { isKnownSignal } from "../scoring";

const LIMITS = {
  name: 200,
  description: 4_000,
  listItem: 200,
  listLength: 40,
  maxResults: 5_000,
} as const;

export class IcpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcpValidationError";
  }
}

function trimTo(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * JSON-encodes a string array column.
 *
 * `undefined` means "absent from the patch", `null` means "cleared". The
 * distinction is what makes a partial update possible without the caller having
 * to resend every field.
 */
function encodeList(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : null;
  if (!source) return undefined;

  const cleaned = Array.from(
    new Set(
      source
        .map((v) => trimTo(v, LIMITS.listItem))
        .filter((v): v is string => !!v)
    )
  ).slice(0, LIMITS.listLength);
  return JSON.stringify(cleaned);
}

function decodeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Signal ids, filtered to ones this build knows, so an unknown id cannot be stored. */
function encodeSignalList(value: unknown): string | null | undefined {
  const encoded = encodeList(value);
  if (encoded === undefined || encoded === null) return encoded;
  const known = (JSON.parse(encoded) as string[]).filter(isKnownSignal);
  return JSON.stringify(known);
}

export interface IcpView {
  id: string;
  name: string;
  description: string | null;
  targetCategories: string[];
  targetIndustries: string[];
  targetLocations: string[];
  decisionMakerRoles: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  requiredSignals: string[];
  preferredSignals: string[];
  minRating: number | null;
  minReviews: number | null;
  maxResults: number;
  radiusKm: number | null;
  deepAnalysis: boolean;
  isDefault: boolean;
  status: string;
  aiConfidence: number | null;
  lastSuggestedAt: Date | null;
  /** Rough 0-100 measure of how usable this profile is for a discovery run. */
  completeness: number;
  /** False when discovery cannot run from this profile alone. */
  readyForDiscovery: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Weights for how complete a profile is.
 *
 * Categories and locations dominate because without both there is nothing to
 * search for: everything else refines results that a run cannot produce yet.
 */
const COMPLETENESS_FIELDS: { has: (p: IcpView) => boolean; weight: number }[] = [
  { has: (p) => p.targetCategories.length > 0, weight: 35 },
  { has: (p) => p.targetLocations.length > 0, weight: 30 },
  { has: (p) => p.decisionMakerRoles.length > 0, weight: 10 },
  { has: (p) => p.targetIndustries.length > 0, weight: 10 },
  { has: (p) => p.excludeCategories.length > 0 || p.excludeKeywords.length > 0, weight: 10 },
  { has: (p) => p.minRating !== null || p.minReviews !== null, weight: 5 },
];

function toView(row: any): IcpView {
  const view: IcpView = {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    targetCategories: decodeList(row.targetCategories),
    targetIndustries: decodeList(row.targetIndustries),
    targetLocations: decodeList(row.targetLocations),
    decisionMakerRoles: decodeList(row.decisionMakerRoles),
    excludeCategories: decodeList(row.excludeCategories),
    excludeKeywords: decodeList(row.excludeKeywords),
    requiredSignals: decodeList(row.requiredSignals),
    preferredSignals: decodeList(row.preferredSignals),
    minRating: row.minRating ?? null,
    minReviews: row.minReviews ?? null,
    maxResults: row.maxResults,
    radiusKm: row.radiusKm ?? null,
    deepAnalysis: row.deepAnalysis,
    isDefault: row.isDefault,
    status: row.status,
    aiConfidence: row.aiConfidence ?? null,
    lastSuggestedAt: row.lastSuggestedAt ?? null,
    completeness: 0,
    readyForDiscovery: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  view.completeness = COMPLETENESS_FIELDS.reduce(
    (sum, f) => sum + (f.has(view) ? f.weight : 0),
    0
  );
  view.readyForDiscovery = view.targetCategories.length > 0 && view.targetLocations.length > 0;
  return view;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listIcpProfiles(
  ctx: TenantContext,
  includeArchived = false
): Promise<IcpView[]> {
  const rows = await prisma.icpProfile.findMany({
    where: { tenantId: ctx.tenantId, ...(includeArchived ? {} : { status: "active" }) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export async function getIcpProfile(ctx: TenantContext, id: string): Promise<IcpView | null> {
  const row = await prisma.icpProfile.findFirst({ where: { id, tenantId: ctx.tenantId } });
  return row ? toView(row) : null;
}

/**
 * The workspace's default profile, or null.
 *
 * Deliberately not seeded the way the scoring rule set is. A default rule set can
 * be guessed at — the shipped weights are a reasonable starting point for anyone.
 * A default ICP cannot: inventing target categories for a business the platform
 * knows nothing about is exactly the fabrication this product must not do. An
 * empty ICP is honest, and `POST /api/icp/suggest` fills it from the workspace's
 * own business profile and documents.
 */
export async function resolveDefaultIcp(ctx: TenantContext): Promise<IcpView | null> {
  const row = await prisma.icpProfile.findFirst({
    where: { tenantId: ctx.tenantId, status: "active", isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (row) return toView(row);

  const anyActive = await prisma.icpProfile.findFirst({
    where: { tenantId: ctx.tenantId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  return anyActive ? toView(anyActive) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface IcpInput {
  name?: string;
  description?: string | null;
  targetCategories?: string[] | string | null;
  targetIndustries?: string[] | string | null;
  targetLocations?: string[] | string | null;
  decisionMakerRoles?: string[] | string | null;
  excludeCategories?: string[] | string | null;
  excludeKeywords?: string[] | string | null;
  requiredSignals?: string[] | null;
  preferredSignals?: string[] | null;
  minRating?: number | null;
  minReviews?: number | null;
  maxResults?: number;
  radiusKm?: number | null;
  deepAnalysis?: boolean;
  isDefault?: boolean;
  status?: string;
}

function icpData(input: IcpInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = trimTo(input.name, LIMITS.name);
    if (!name) throw new IcpValidationError("A profile name is required.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = trimTo(input.description, LIMITS.description);
  }

  for (const key of [
    "targetCategories",
    "targetIndustries",
    "targetLocations",
    "decisionMakerRoles",
    "excludeCategories",
    "excludeKeywords",
  ] as const) {
    const encoded = encodeList(input[key]);
    if (encoded !== undefined) data[key] = encoded;
  }

  for (const key of ["requiredSignals", "preferredSignals"] as const) {
    const encoded = encodeSignalList(input[key]);
    if (encoded !== undefined) data[key] = encoded;
  }

  if (input.minRating !== undefined) {
    if (input.minRating === null) data.minRating = null;
    else {
      const r = Number(input.minRating);
      if (!Number.isFinite(r) || r < 0 || r > 5) {
        throw new IcpValidationError("Minimum rating must be between 0 and 5.");
      }
      data.minRating = r;
    }
  }

  if (input.minReviews !== undefined) {
    if (input.minReviews === null) data.minReviews = null;
    else {
      const n = Math.trunc(Number(input.minReviews));
      if (!Number.isFinite(n) || n < 0) {
        throw new IcpValidationError("Minimum reviews cannot be negative.");
      }
      data.minReviews = n;
    }
  }

  if (input.maxResults !== undefined) {
    const n = Math.trunc(Number(input.maxResults));
    if (!Number.isFinite(n) || n < 1 || n > LIMITS.maxResults) {
      throw new IcpValidationError(`Maximum results must be between 1 and ${LIMITS.maxResults}.`);
    }
    data.maxResults = n;
  }

  if (input.radiusKm !== undefined) {
    if (input.radiusKm === null) data.radiusKm = null;
    else {
      const r = Number(input.radiusKm);
      if (!Number.isFinite(r) || r <= 0 || r > 500) {
        throw new IcpValidationError("Search radius must be between 1 and 500 km.");
      }
      data.radiusKm = r;
    }
  }

  if (input.deepAnalysis !== undefined) data.deepAnalysis = Boolean(input.deepAnalysis);
  if (input.status !== undefined) {
    data.status = input.status === "archived" ? "archived" : "active";
  }

  return data;
}

export async function createIcpProfile(ctx: TenantContext, input: IcpInput): Promise<IcpView> {
  const data = icpData(input);
  const name = trimTo(input.name, LIMITS.name);
  if (!name) throw new IcpValidationError("A profile name is required.");

  // The first profile in a workspace becomes the default, so a single-profile
  // workspace never has to think about the concept.
  const existing = await prisma.icpProfile.count({
    where: { tenantId: ctx.tenantId, status: "active" },
  });

  const row = await prisma.icpProfile.create({
    data: {
      tenantId: ctx.tenantId,
      createdById: ctx.userId,
      ...data,
      name,
      isDefault: existing === 0,
    },
  });

  if (input.isDefault && existing > 0) {
    await setDefaultIcpProfile(ctx, row.id);
    const refreshed = await getIcpProfile(ctx, row.id);
    if (refreshed) return refreshed;
  }

  return toView(row);
}

export async function updateIcpProfile(
  ctx: TenantContext,
  id: string,
  input: IcpInput
): Promise<IcpView | null> {
  const owned = await prisma.icpProfile.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, isDefault: true },
  });
  if (!owned) return null;

  const data = icpData(input);
  if (data.status === "archived" && owned.isDefault) data.isDefault = false;

  // A profile that was AI-suggested and then edited by hand is no longer the
  // model's output, so its confidence no longer describes what is stored.
  if (Object.keys(data).length > 0) {
    data.aiConfidence = null;
  }

  const row = await prisma.icpProfile.update({ where: { id: owned.id }, data });

  if (input.isDefault === true) {
    await setDefaultIcpProfile(ctx, owned.id);
    return await getIcpProfile(ctx, owned.id);
  }

  return toView(row);
}

/** Makes one profile the workspace's default, clearing the flag from the rest. */
export async function setDefaultIcpProfile(ctx: TenantContext, id: string): Promise<boolean> {
  const owned = await prisma.icpProfile.findFirst({
    where: { id, tenantId: ctx.tenantId, status: "active" },
    select: { id: true },
  });
  if (!owned) return false;

  // "Exactly one default per workspace" is not expressible as a MySQL partial
  // unique index, so it is maintained here in two statements.
  await prisma.icpProfile.updateMany({
    where: { tenantId: ctx.tenantId, isDefault: true, id: { not: owned.id } },
    data: { isDefault: false },
  });
  await prisma.icpProfile.update({ where: { id: owned.id }, data: { isDefault: true } });
  return true;
}

export async function deleteIcpProfile(ctx: TenantContext, id: string): Promise<boolean> {
  const owned = await prisma.icpProfile.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, isDefault: true },
  });
  if (!owned) return false;

  // Lead lists reference the profile with SetNull, so deleting a profile never
  // takes the leads found with it.
  await prisma.icpProfile.delete({ where: { id: owned.id } });

  if (owned.isDefault) {
    const next = await prisma.icpProfile.findFirst({
      where: { tenantId: ctx.tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) await prisma.icpProfile.update({ where: { id: next.id }, data: { isDefault: true } });
  }

  return true;
}

/** Records that a profile's contents came from an AI suggestion. */
export async function recordIcpSuggestion(
  ctx: TenantContext,
  id: string,
  provenance: { confidence: number | null; promptName: string; promptVersion: number }
): Promise<void> {
  await prisma.icpProfile.updateMany({
    where: { id, tenantId: ctx.tenantId },
    data: {
      aiConfidence: provenance.confidence,
      lastSuggestedAt: new Date(),
      lastPromptName: provenance.promptName,
      lastPromptVersion: provenance.promptVersion,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery criteria
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The search parameters a discovery run needs, derived from a profile.
 *
 * Separate from IcpView because a run takes a snapshot: the criteria are written
 * to the job row, so editing the profile mid-run cannot change what is being
 * searched for. That was the exact failure mode of the shared CONFIG object.
 */
export interface DiscoveryCriteria {
  categories: string[];
  locations: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  minRating: number | null;
  minReviews: number | null;
  maxResults: number;
  radiusKm: number | null;
  deepAnalysis: boolean;
  icpProfileId: string | null;
  /** Display label, e.g. for the generated lead list name. */
  label: string;
}

export function toDiscoveryCriteria(
  icp: IcpView,
  overrides: Partial<DiscoveryCriteria> = {}
): DiscoveryCriteria {
  const categories = overrides.categories?.length ? overrides.categories : icp.targetCategories;
  const locations = overrides.locations?.length ? overrides.locations : icp.targetLocations;

  return {
    categories,
    locations,
    excludeCategories: overrides.excludeCategories ?? icp.excludeCategories,
    excludeKeywords: overrides.excludeKeywords ?? icp.excludeKeywords,
    minRating: overrides.minRating !== undefined ? overrides.minRating : icp.minRating,
    minReviews: overrides.minReviews !== undefined ? overrides.minReviews : icp.minReviews,
    maxResults: overrides.maxResults ?? icp.maxResults,
    radiusKm: overrides.radiusKm !== undefined ? overrides.radiusKm : icp.radiusKm,
    deepAnalysis: overrides.deepAnalysis ?? icp.deepAnalysis,
    icpProfileId: icp.id,
    label: overrides.label ?? icp.name,
  };
}

/**
 * Whether a discovered business should be kept.
 *
 * Exclusions are applied before any analyzer runs, because each excluded
 * business otherwise costs four page loads to reach the same conclusion. A search
 * for "clinic" returns competitors as readily as prospects, so ruling things out
 * matters as much as ruling them in.
 */
export function passesIcpFilters(
  candidate: { businessName: string; category?: string | null; rating?: number; reviews?: number },
  criteria: Pick<
    DiscoveryCriteria,
    "excludeCategories" | "excludeKeywords" | "minRating" | "minReviews"
  >
): { keep: boolean; reason?: string } {
  const name = (candidate.businessName || "").toLowerCase();
  const category = (candidate.category || "").toLowerCase();

  for (const excluded of criteria.excludeCategories) {
    const needle = excluded.toLowerCase().trim();
    if (needle && category.includes(needle)) {
      return { keep: false, reason: `category matches the excluded "${excluded}"` };
    }
  }

  for (const keyword of criteria.excludeKeywords) {
    const needle = keyword.toLowerCase().trim();
    if (needle && (name.includes(needle) || category.includes(needle))) {
      return { keep: false, reason: `matches the excluded keyword "${keyword}"` };
    }
  }

  if (criteria.minRating !== null && criteria.minRating !== undefined) {
    if ((candidate.rating ?? 0) < criteria.minRating) {
      return { keep: false, reason: `rating ${candidate.rating ?? 0} is below ${criteria.minRating}` };
    }
  }

  if (criteria.minReviews !== null && criteria.minReviews !== undefined) {
    if ((candidate.reviews ?? 0) < criteria.minReviews) {
      return {
        keep: false,
        reason: `${candidate.reviews ?? 0} reviews is below ${criteria.minReviews}`,
      };
    }
  }

  return { keep: true };
}

/**
 * Search queries for one run: every category against every location.
 *
 * This replaces a heuristic that expanded "dental, skin clinic" into "dental
 * clinic" and "skin clinic" by matching the last word against a hardcoded list
 * of thirty English business nouns — hospital, clinic, salon, dealer and so on.
 * A fixed vocabulary of what a business can be is precisely what a universal
 * platform cannot have: any category outside the list silently searched for
 * something else, and the list was unreachable from the UI to correct.
 *
 * The ICP holds categories as an explicit array, so each one is stated in full
 * and no guessing is needed.
 */
export function buildSearchQueries(categories: string[], locations: string[]): string[] {
  const cats = categories.map((c) => c.trim()).filter(Boolean);
  const locs = locations.map((l) => l.trim()).filter(Boolean);

  if (cats.length === 0 || locs.length === 0) return [];

  const queries: string[] = [];
  for (const location of locs) {
    for (const category of cats) {
      queries.push(`${category} in ${location}`);
    }
  }
  // Deduplicated: two categories differing only by whitespace or case would
  // otherwise scrape the same result page twice.
  const seen = new Set<string>();
  return queries.filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Summarises criteria for a job row and a lead list name. */
export function describeCriteria(criteria: DiscoveryCriteria): string {
  const cats = criteria.categories.join(", ") || "any business";
  const locs = criteria.locations.join(", ") || "anywhere";
  return `${cats} in ${locs}`;
}

/** Logs and returns the queries a run will execute. */
export function planQueries(criteria: DiscoveryCriteria): string[] {
  const queries = buildSearchQueries(criteria.categories, criteria.locations);
  logger.info(
    `Discovery plan: ${queries.length} quer${queries.length === 1 ? "y" : "ies"} ` +
      `across ${criteria.categories.length} categor${criteria.categories.length === 1 ? "y" : "ies"} ` +
      `and ${criteria.locations.length} location(s).`
  );
  return queries;
}
