/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant-owned scoring rule sets.
 *
 * Every function takes a TenantContext and scopes by it, matching
 * src/tenancy/repository.ts: no function here accepts a bare id, so a route
 * handler cannot read or edit another workspace's scoring configuration.
 *
 * The built-in rule set is seeded lazily, on first use, rather than by a data
 * migration. A workspace that never runs discovery never needs one, and a lazy
 * seed means a tenant created by any path — sign-up, backfill, a future invite
 * flow — gets a working configuration without each of those paths having to
 * remember to create it.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";
import {
  BUILT_IN_HOT_THRESHOLD,
  BUILT_IN_RULES,
  BUILT_IN_RULE_SET_NAME,
  BUILT_IN_WARM_THRESHOLD,
  RULE_LIMITS,
  RuleSetValidationError,
  computeMaxScore,
  evaluate,
  parseRules,
  parseThresholds,
  type RuleSetDefinition,
  type ScoreResult,
  type ScoringRule,
} from "./ruleSet";
import type { ScorableLead } from "./signals";

export interface RuleSetView {
  id: string;
  name: string;
  description: string | null;
  version: number;
  rules: ScoringRule[];
  hotThreshold: number;
  warmThreshold: number;
  /** Derived, not stored: it is a function of the rules and must never drift. */
  maxScore: number;
  /** The point totals the bands correspond to, for display. */
  hotAtPoints: number;
  warmAtPoints: number;
  isDefault: boolean;
  isBuiltIn: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function trimTo(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Maps a stored row to a view.
 *
 * `maxScore` is recomputed here rather than stored. A denormalised maximum would
 * be one edit away from disagreeing with the rules that produce it, and it is
 * the denominator every score and every AI prompt is expressed against — the one
 * number that must not be allowed to go stale.
 */
function toView(row: any): RuleSetView {
  let rules: ScoringRule[] = [];
  try {
    rules = parseRules(row.rules).rules;
  } catch (err: any) {
    // A corrupted column must not break the listing. It is surfaced as an empty
    // rule set, which scores nothing and is visibly wrong, rather than as a 500.
    logger.error(`Scoring rule set ${row.id} holds unusable rules: ${err?.message || err}`);
  }

  const maxScore = computeMaxScore(rules);

  /*
   * The lowest integer score that reaches a band.
   *
   * The epsilon is not cosmetic. The built-in bands are stored as 100/170 and
   * 60/170, and 60/170 * 170 evaluates to 60.00000000000001, so a plain ceil
   * would tell the user their WARM band starts at 61 points while the evaluator
   * correctly grades 60 as WARM.
   */
  const bandPoints = (threshold: number) => Math.ceil(threshold * maxScore - 1e-9);

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    rules,
    hotThreshold: row.hotThreshold,
    warmThreshold: row.warmThreshold,
    maxScore,
    hotAtPoints: bandPoints(row.hotThreshold),
    warmAtPoints: bandPoints(row.warmThreshold),
    isDefault: row.isDefault,
    isBuiltIn: row.isBuiltIn,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The definition the evaluator needs, from a view. */
export function toDefinition(view: RuleSetView): RuleSetDefinition {
  return {
    id: view.id,
    name: view.name,
    description: view.description,
    version: view.version,
    rules: view.rules,
    hotThreshold: view.hotThreshold,
    warmThreshold: view.warmThreshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listRuleSets(
  ctx: TenantContext,
  includeArchived = false
): Promise<RuleSetView[]> {
  const rows = await prisma.scoringRuleSet.findMany({
    where: { tenantId: ctx.tenantId, ...(includeArchived ? {} : { status: "active" }) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export async function getRuleSet(ctx: TenantContext, id: string): Promise<RuleSetView | null> {
  const row = await prisma.scoringRuleSet.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  return row ? toView(row) : null;
}

/**
 * The rule set discovery should score with, seeding the built-in one if the
 * workspace has none.
 *
 * Concurrent first runs can both find nothing and both insert. Rather than lock,
 * the winner is resolved by reading back the oldest default afterwards, so every
 * caller converges on the same row and the loser's extra row is harmless and
 * editable.
 */
export async function resolveActiveRuleSet(ctx: TenantContext): Promise<RuleSetView> {
  const existing = await prisma.scoringRuleSet.findFirst({
    where: { tenantId: ctx.tenantId, status: "active", isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return toView(existing);

  // A workspace may have rule sets but no default, e.g. after the default was
  // archived. Promote the oldest active one rather than seeding a second built-in.
  const anyActive = await prisma.scoringRuleSet.findFirst({
    where: { tenantId: ctx.tenantId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (anyActive) {
    const promoted = await prisma.scoringRuleSet.update({
      where: { id: anyActive.id },
      data: { isDefault: true },
    });
    return toView(promoted);
  }

  await prisma.scoringRuleSet.create({
    data: {
      tenantId: ctx.tenantId,
      name: BUILT_IN_RULE_SET_NAME,
      description:
        "Scores how much a business's online presence needs work. Seeded as your starting " +
        "point — edit the weights to match what you sell.",
      version: 1,
      rules: JSON.stringify(BUILT_IN_RULES),
      hotThreshold: BUILT_IN_HOT_THRESHOLD,
      warmThreshold: BUILT_IN_WARM_THRESHOLD,
      isDefault: true,
      isBuiltIn: true,
      createdById: ctx.userId,
    },
  });

  logger.info(`Seeded the built-in scoring rule set for workspace ${ctx.tenantId}.`);

  const seeded = await prisma.scoringRuleSet.findFirst({
    where: { tenantId: ctx.tenantId, status: "active", isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (seeded) return toView(seeded);

  // The row was written but cannot be read back, which means the database is in
  // trouble. Score with the in-code definition rather than failing the run.
  logger.error(
    `Could not read back the seeded rule set for workspace ${ctx.tenantId}; using the in-code default.`
  );
  return {
    id: "built-in",
    name: BUILT_IN_RULE_SET_NAME,
    description: null,
    version: 1,
    rules: BUILT_IN_RULES,
    hotThreshold: BUILT_IN_HOT_THRESHOLD,
    warmThreshold: BUILT_IN_WARM_THRESHOLD,
    maxScore: computeMaxScore(BUILT_IN_RULES),
    hotAtPoints: 100,
    warmAtPoints: 60,
    isDefault: true,
    isBuiltIn: true,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleSetInput {
  name?: string;
  description?: string | null;
  rules?: unknown;
  hotThreshold?: unknown;
  warmThreshold?: unknown;
  isDefault?: boolean;
  status?: string;
}

export async function createRuleSet(
  ctx: TenantContext,
  input: RuleSetInput
): Promise<RuleSetView> {
  const name = trimTo(input.name, RULE_LIMITS.nameLength);
  if (!name) throw new RuleSetValidationError("A name is required.");

  const { rules } = parseRules(input.rules);
  const { hotThreshold, warmThreshold } = parseThresholds(
    input.hotThreshold ?? BUILT_IN_HOT_THRESHOLD,
    input.warmThreshold ?? BUILT_IN_WARM_THRESHOLD
  );

  if (computeMaxScore(rules) <= 0) {
    // Every rule is a penalty, so nothing can ever score above zero and every
    // lead grades COLD. That is a configuration mistake, not a preference.
    throw new RuleSetValidationError(
      "At least one rule must award positive points, otherwise no lead can ever score."
    );
  }

  const row = await prisma.scoringRuleSet.create({
    data: {
      tenantId: ctx.tenantId,
      name,
      description: trimTo(input.description, RULE_LIMITS.descriptionLength),
      version: 1,
      rules: JSON.stringify(rules),
      hotThreshold,
      warmThreshold,
      isBuiltIn: false,
      isDefault: false,
      createdById: ctx.userId,
    },
  });

  if (input.isDefault) {
    await setDefaultRuleSet(ctx, row.id);
    const refreshed = await getRuleSet(ctx, row.id);
    if (refreshed) return refreshed;
  }

  return toView(row);
}

/**
 * Updates a rule set and bumps its version.
 *
 * The version bump is not bookkeeping. Leads carry the version they were scored
 * under, so without it a changed weight would leave yesterday's scores and
 * today's sitting in the same column, on different scales, with nothing to tell
 * them apart.
 */
export async function updateRuleSet(
  ctx: TenantContext,
  id: string,
  input: RuleSetInput
): Promise<RuleSetView | null> {
  const owned = await prisma.scoringRuleSet.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!owned) return null;

  const data: Record<string, unknown> = {};
  let scoringChanged = false;

  if (input.name !== undefined) {
    const name = trimTo(input.name, RULE_LIMITS.nameLength);
    if (!name) throw new RuleSetValidationError("A name is required.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = trimTo(input.description, RULE_LIMITS.descriptionLength);
  }

  if (input.rules !== undefined) {
    const { rules } = parseRules(input.rules);
    if (computeMaxScore(rules) <= 0) {
      throw new RuleSetValidationError(
        "At least one rule must award positive points, otherwise no lead can ever score."
      );
    }
    data.rules = JSON.stringify(rules);
    scoringChanged = true;
  }

  if (input.hotThreshold !== undefined || input.warmThreshold !== undefined) {
    const { hotThreshold, warmThreshold } = parseThresholds(
      input.hotThreshold ?? owned.hotThreshold,
      input.warmThreshold ?? owned.warmThreshold
    );
    data.hotThreshold = hotThreshold;
    data.warmThreshold = warmThreshold;
    scoringChanged = true;
  }

  if (input.status !== undefined) {
    data.status = input.status === "archived" ? "archived" : "active";
    // Archiving the default would leave the workspace with no rule set to score
    // with, so the flag moves off it and resolveActiveRuleSet promotes another.
    if (data.status === "archived" && owned.isDefault) data.isDefault = false;
  }

  // Editing the built-in set is allowed — that is the point of the phase — but
  // it stops being "built-in" once the weights are no longer the shipped ones.
  if (scoringChanged && owned.isBuiltIn) data.isBuiltIn = false;
  if (scoringChanged) data.version = owned.version + 1;

  const row = await prisma.scoringRuleSet.update({ where: { id: owned.id }, data });

  if (input.isDefault === true) {
    await setDefaultRuleSet(ctx, owned.id);
    return await getRuleSet(ctx, owned.id);
  }

  return toView(row);
}

/** Makes one rule set the workspace's default, clearing the flag from the rest. */
export async function setDefaultRuleSet(ctx: TenantContext, id: string): Promise<boolean> {
  const owned = await prisma.scoringRuleSet.findFirst({
    where: { id, tenantId: ctx.tenantId, status: "active" },
    select: { id: true },
  });
  if (!owned) return false;

  // Two statements rather than one: "exactly one default per workspace" cannot
  // be expressed as a MySQL partial unique index, so it is maintained here.
  await prisma.scoringRuleSet.updateMany({
    where: { tenantId: ctx.tenantId, isDefault: true, id: { not: owned.id } },
    data: { isDefault: false },
  });
  await prisma.scoringRuleSet.update({ where: { id: owned.id }, data: { isDefault: true } });
  return true;
}

export async function deleteRuleSet(ctx: TenantContext, id: string): Promise<boolean> {
  const owned = await prisma.scoringRuleSet.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, isDefault: true },
  });
  if (!owned) return false;

  const activeCount = await prisma.scoringRuleSet.count({
    where: { tenantId: ctx.tenantId, status: "active" },
  });
  if (activeCount <= 1) {
    throw new RuleSetValidationError(
      "This is your only scoring configuration. Create another before deleting it."
    );
  }

  await prisma.scoringRuleSet.delete({ where: { id: owned.id } });

  if (owned.isDefault) {
    const next = await prisma.scoringRuleSet.findFirst({
      where: { tenantId: ctx.tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) await prisma.scoringRuleSet.update({ where: { id: next.id }, data: { isDefault: true } });
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

/** Scores a lead with an already-resolved rule set. Pure; no I/O. */
export function scoreLead(lead: ScorableLead, ruleSet: RuleSetView): ScoreResult {
  return evaluate(lead, toDefinition(ruleSet));
}

/** Scores a lead with the workspace's active rule set. */
export async function scoreLeadForTenant(
  ctx: TenantContext,
  lead: ScorableLead
): Promise<ScoreResult> {
  const ruleSet = await resolveActiveRuleSet(ctx);
  return scoreLead(lead, ruleSet);
}
