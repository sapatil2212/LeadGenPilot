/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead scoring: rule set definition, validation and evaluation.
 *
 * Replaces the fixed function in src/digitalPresenceScorer.ts. That function
 * encoded one seller's worldview — 50 points for "has no website", 15 for "no
 * Instagram" — which identifies a prospect for a web design agency and is
 * meaningless to a company selling autoclaves to hospitals. For a universal
 * platform the weights have to belong to the tenant.
 *
 * Three properties the old scorer lacked, and the reason each matters:
 *
 *   A REACHABLE MAXIMUM. Computed from the rules, accounting for mutually
 *   exclusive signals, so a score is a proportion rather than an uninterpretable
 *   integer. The old code summed to 170 and clamped at 200; the AI prompt was
 *   handed 200 as the denominator, describing every lead to the model as weaker
 *   than it was.
 *
 *   FRACTIONAL PRIORITY BANDS. HOT and WARM are shares of the maximum, so
 *   editing a weight cannot silently move the bands. The old thresholds were
 *   absolute (100 and 60) against a maximum nobody had calculated.
 *
 *   A BREAKDOWN. Which rules fired and for how much, stored with the lead, so a
 *   score can be explained to the person acting on it.
 */

import { getSignal, isKnownSignal, type ScorableLead } from "./signals";

export interface ScoringRule {
  /** Stable id, so a rule can be edited without losing its identity. */
  id: string;
  /** Signal from src/scoring/signals.ts. Unknown ids are rejected. */
  signal: string;
  /** Label shown in the breakdown. Defaults to the signal's own label. */
  label?: string;
  /**
   * Points awarded when the signal fires. May be negative: a rule set can
   * penalise a signal as easily as reward it.
   */
  points: number;
  /** Overrides the signal's default comparison value, where it has one. */
  when?: number;
  enabled?: boolean;
}

export interface RuleSetDefinition {
  id?: string;
  name: string;
  description?: string | null;
  version: number;
  rules: ScoringRule[];
  /** Shares of the achievable maximum, 0..1. */
  hotThreshold: number;
  warmThreshold: number;
}

export type LeadPriority = "HOT" | "WARM" | "COLD";

export interface ScoreContribution {
  signal: string;
  label: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  /** Achievable maximum for this rule set. */
  max: number;
  /** score / max, 0..1. Zero when the rule set cannot award anything. */
  ratio: number;
  priority: LeadPriority;
  breakdown: ScoreContribution[];
  ruleSetId?: string;
  ruleSetVersion: number;
}

/** Caps, so a rule set cannot be made unusable or unreadable. */
export const RULE_LIMITS = {
  maxRules: 60,
  maxPoints: 1_000,
  minPoints: -1_000,
  labelLength: 160,
  nameLength: 160,
  descriptionLength: 2_000,
} as const;

export class RuleSetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleSetValidationError";
  }
}

/**
 * Comparison tolerance for the priority bands.
 *
 * Thresholds are stored as fractions, so the built-in rule set's bands are
 * 100/170 and 60/170 — values with no exact binary representation. Without a
 * tolerance a lead scoring exactly 100 could land one ULP below its own
 * threshold and be graded WARM, which is both wrong and impossible to explain.
 */
const BAND_EPSILON = 1e-9;

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses and validates a rule array from storage or from a request.
 *
 * Unknown signal ids are dropped rather than rejected. A rule set saved against
 * a later release that names a signal this build does not have should keep
 * scoring with the rules it understands; refusing the whole set would take the
 * tenant's scoring offline for a rule they may not even use.
 */
export function parseRules(input: unknown): { rules: ScoringRule[]; dropped: string[] } {
  const raw = typeof input === "string" ? safeJson(input) : input;
  if (!Array.isArray(raw)) {
    throw new RuleSetValidationError("Rules must be an array.");
  }
  if (raw.length > RULE_LIMITS.maxRules) {
    throw new RuleSetValidationError(`A rule set may hold at most ${RULE_LIMITS.maxRules} rules.`);
  }

  const rules: ScoringRule[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;

    const signal = candidate.signal;
    if (!isKnownSignal(signal)) {
      if (typeof signal === "string") dropped.push(signal);
      continue;
    }

    const points = Number(candidate.points);
    if (!Number.isFinite(points)) {
      throw new RuleSetValidationError(`Rule for "${signal}" has a non-numeric points value.`);
    }
    if (points > RULE_LIMITS.maxPoints || points < RULE_LIMITS.minPoints) {
      throw new RuleSetValidationError(
        `Rule for "${signal}" is outside the allowed range of ${RULE_LIMITS.minPoints} to ${RULE_LIMITS.maxPoints} points.`
      );
    }

    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : signal;
    // A duplicate rule for the same signal would double-count it and break the
    // maximum, so the first one wins.
    if (seen.has(id) || seen.has(signal)) continue;
    seen.add(id);
    seen.add(signal);

    const when = Number(candidate.when);
    const label =
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim().slice(0, RULE_LIMITS.labelLength)
        : undefined;

    rules.push({
      id,
      signal,
      points: Math.round(points),
      ...(label ? { label } : {}),
      ...(Number.isFinite(when) ? { when } : {}),
      enabled: candidate.enabled === undefined ? true : Boolean(candidate.enabled),
    });
  }

  if (rules.length === 0) {
    throw new RuleSetValidationError("A rule set needs at least one rule naming a known signal.");
  }

  return { rules, dropped };
}

/** Validates a threshold pair, returning it in a usable order. */
export function parseThresholds(
  hot: unknown,
  warm: unknown
): { hotThreshold: number; warmThreshold: number } {
  const h = Number(hot);
  const w = Number(warm);
  if (!Number.isFinite(h) || !Number.isFinite(w)) {
    throw new RuleSetValidationError("Priority thresholds must be numbers.");
  }
  if (h <= 0 || h > 1 || w <= 0 || w > 1) {
    throw new RuleSetValidationError(
      "Priority thresholds are shares of the maximum, so they must be between 0 and 1."
    );
  }
  if (w >= h) {
    throw new RuleSetValidationError("The WARM threshold must be below the HOT threshold.");
  }
  return { hotThreshold: h, warmThreshold: w };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RuleSetValidationError("Rules are not valid JSON.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Maximum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The highest score this rule set can award.
 *
 * Signals reading the same attribute share an exclusive group and cannot both
 * fire, so a group contributes only its best-paying member. Negative rules
 * contribute nothing to the ceiling.
 *
 * Within a group the signals partition one attribute's values, which is what
 * makes `max` exact rather than an estimate — with one caveat: the two
 * threshold-based groups (`reviews`, `rating`) only partition cleanly while
 * their thresholds do not overlap. A tenant who sets "more than 10 reviews" and
 * "at most 50 reviews" can make both fire, so `evaluate` clamps the score to
 * `max` rather than trusting the arithmetic. The clamp caps such a lead at 100%
 * instead of letting it exceed the scale.
 */
export function computeMaxScore(rules: ScoringRule[]): number {
  const groupBest = new Map<string, number>();
  let ungrouped = 0;

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.points <= 0) continue;

    const group = getSignal(rule.signal)?.exclusiveGroup;
    if (group) {
      groupBest.set(group, Math.max(groupBest.get(group) ?? 0, rule.points));
    } else {
      ungrouped += rule.points;
    }
  }

  let total = ungrouped;
  for (const best of groupBest.values()) total += best;
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/** Scores a lead against a rule set. */
export function evaluate(lead: ScorableLead, ruleSet: RuleSetDefinition): ScoreResult {
  const max = computeMaxScore(ruleSet.rules);
  const breakdown: ScoreContribution[] = [];
  let raw = 0;

  for (const rule of ruleSet.rules) {
    if (rule.enabled === false) continue;

    const signal = getSignal(rule.signal);
    if (!signal) continue;

    let fired = false;
    try {
      fired = signal.test(lead, rule.when ?? signal.defaultThreshold);
    } catch {
      // A malformed lead must not abort scoring. An unevaluable signal does not
      // fire, which is the conservative outcome.
      fired = false;
    }
    if (!fired) continue;

    raw += rule.points;
    breakdown.push({
      signal: rule.signal,
      label: rule.label || signal.label,
      points: rule.points,
    });
  }

  // Clamped to the scale in both directions: a negative total is not a
  // meaningful "worse than nothing", and exceeding the maximum would make the
  // fractional bands nonsense.
  const score = Math.max(0, Math.min(raw, max));
  const ratio = max > 0 ? score / max : 0;

  let priority: LeadPriority = "COLD";
  if (ratio >= ruleSet.hotThreshold - BAND_EPSILON) priority = "HOT";
  else if (ratio >= ruleSet.warmThreshold - BAND_EPSILON) priority = "WARM";

  return {
    score,
    max,
    ratio,
    priority,
    breakdown,
    ruleSetId: ruleSet.id,
    ruleSetVersion: ruleSet.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The built-in rule set
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Digital presence opportunity, v1 — the pre-Phase-4 scorer, expressed as data.
 *
 * Reproduces src/digitalPresenceScorer.ts exactly, including its reachable
 * maximum of 170 and its HOT/WARM cutovers at 100 and 60 points. Existing scores
 * therefore stay comparable with new ones, and the old scorer's tests become the
 * proof that this engine is a faithful replacement.
 *
 * It is seeded as every new workspace's default because it is a reasonable
 * starting point for the selling motion the product shipped with — finding
 * businesses whose online presence needs work. A workspace selling something
 * else is expected to edit it, which is the point of the phase.
 */
export const BUILT_IN_RULES: ScoringRule[] = [
  { id: "website.missing", signal: "website.missing", points: 50, enabled: true },
  { id: "website.broken", signal: "website.broken", points: 40, enabled: true },
  { id: "website.outdated", signal: "website.outdated", points: 30, enabled: true },
  { id: "reputation.many_reviews", signal: "reputation.many_reviews", points: 20, when: 100, enabled: true },
  { id: "reputation.high_rating", signal: "reputation.high_rating", points: 20, when: 4.5, enabled: true },
  { id: "social.instagram_missing", signal: "social.instagram_missing", points: 15, enabled: true },
  { id: "social.instagram_inactive", signal: "social.instagram_inactive", points: 10, enabled: true },
  { id: "social.facebook_missing", signal: "social.facebook_missing", points: 10, enabled: true },
  { id: "social.facebook_inactive", signal: "social.facebook_inactive", points: 10, enabled: true },
  { id: "social.linkedin_missing", signal: "social.linkedin_missing", points: 10, enabled: true },
  { id: "contact.no_whatsapp", signal: "contact.no_whatsapp", points: 10, enabled: true },
  { id: "contact.no_booking", signal: "contact.no_booking", points: 10, enabled: true },
  { id: "tracking.no_analytics", signal: "tracking.no_analytics", points: 10, enabled: true },
  { id: "tracking.no_pixel", signal: "tracking.no_pixel", points: 10, enabled: true },
  { id: "contact.no_email", signal: "contact.no_email", points: 5, enabled: true },
];

/** The maximum the built-in rules can award. Asserted by tests to be 170. */
export const BUILT_IN_MAX = computeMaxScore(BUILT_IN_RULES);

/**
 * The legacy bands, as fractions.
 *
 * Expressed as the original absolute cutovers divided by the real maximum, not
 * as rounded decimals, so a lead scoring exactly 100 is HOT and one scoring 99
 * is not — byte-identical grading to the function this replaces.
 */
export const BUILT_IN_HOT_THRESHOLD = 100 / BUILT_IN_MAX;
export const BUILT_IN_WARM_THRESHOLD = 60 / BUILT_IN_MAX;

export const BUILT_IN_RULE_SET_NAME = "Digital presence opportunity";

export function builtInRuleSet(id?: string, version = 1): RuleSetDefinition {
  return {
    id,
    name: BUILT_IN_RULE_SET_NAME,
    description:
      "Scores how much a business's online presence needs work. Seeded as the starting point; " +
      "edit the weights to match what you sell.",
    version,
    rules: BUILT_IN_RULES,
    hotThreshold: BUILT_IN_HOT_THRESHOLD,
    warmThreshold: BUILT_IN_WARM_THRESHOLD,
  };
}
