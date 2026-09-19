/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ICP fit: is this discovered business the right kind of customer?
 *
 * Distinct from the lead score, and deliberately so. The lead score measures
 * opportunity signals on the business — no website, dormant social accounts, no
 * booking system. Fit measures relevance. A dentist with no website tops the
 * opportunity scale and is worth nothing to a company selling hospital
 * sterilisation equipment, and the original scorer had no way to express that.
 *
 * Two implementations, with the deterministic one as the floor:
 *
 *   `deterministicFit` compares the candidate's category, location and reputation
 *   against the profile. Cheap, explainable, no provider required.
 *
 *   `scoreFitWithAi` asks a model to judge a batch. Better with messy category
 *   names ("Dr. Patil's Skin & Hair" against "Dermatology Clinic"), but only
 *   available when a provider is configured, and it can fail.
 *
 * `scoreFit` prefers the model and falls back. Neither invents a fit score when
 * the profile specifies nothing to judge against — that returns null, because a
 * fabricated relevance number would be acted on as though it meant something.
 */

import { logger } from "../logger";
import { generateStructuredOutput } from "../ai/aiService";
import { AiUnavailableError } from "../ai/types";
import {
  leadIcpFitPrompt,
  promptRef,
  validateIcpFit,
  type IcpFitCandidate,
  type IcpFitOutput,
  type IcpFitProfile,
} from "../prompts";
import type { TenantContext } from "../tenancy/context";
import type { IcpView } from "./icpService";

/** Candidates judged per AI call. */
const FIT_BATCH_SIZE = 20;

export interface FitVerdict {
  ref: string;
  /** 0-100, or null when the profile gives nothing to judge against. */
  fit: number | null;
  reason: string;
  method: "ai" | "rules" | "excluded";
}

export function toFitProfile(icp: IcpView): IcpFitProfile {
  return {
    name: icp.name,
    description: icp.description,
    targetCategories: icp.targetCategories,
    targetIndustries: icp.targetIndustries,
    targetLocations: icp.targetLocations,
    excludeCategories: icp.excludeCategories,
    excludeKeywords: icp.excludeKeywords,
    minRating: icp.minRating,
    minReviews: icp.minReviews,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fit
// ─────────────────────────────────────────────────────────────────────────────

const STOP_TOKENS = new Set([
  "and",
  "the",
  "for",
  "of",
  "in",
  "at",
  "on",
  "with",
  "clinic",
  "centre",
  "center",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

/**
 * How well a candidate's category matches one wanted category, 0..1.
 *
 * Substring containment either way scores 1: "Dental Clinic" against a listing
 * of "Dental Clinic & Implant Centre" is the same business type. Otherwise it is
 * the share of the wanted category's meaningful words that appear, which handles
 * word-order and pluralisation differences without a stemmer.
 *
 * Generic words like "clinic" and "centre" are excluded from that share. They
 * appear in nearly every listing in some verticals, so counting them would score
 * "Veterinary Clinic" as a partial match for "Dental Clinic".
 */
function categoryMatch(candidateText: string, wanted: string): number {
  const haystack = candidateText.toLowerCase();
  const needle = wanted.toLowerCase().trim();
  if (!needle) return 0;
  if (haystack.includes(needle) || needle.includes(haystack.trim())) return 1;

  const wantedTokens = tokens(wanted).filter((t) => !STOP_TOKENS.has(t));
  if (wantedTokens.length === 0) return 0;

  const hits = wantedTokens.filter((t) => haystack.includes(t)).length;
  return hits / wantedTokens.length;
}

export interface DeterministicCandidate {
  ref: string;
  businessName: string;
  category?: string | null;
  address?: string | null;
  rating?: number;
  reviews?: number;
}

/**
 * Rule-based fit.
 *
 * Weights are renormalised over the dimensions the profile actually specifies,
 * so a profile naming only categories is scored purely on category and is not
 * quietly capped at 60% for omitting locations.
 */
export function deterministicFit(
  candidate: DeterministicCandidate,
  profile: IcpFitProfile
): FitVerdict {
  const name = (candidate.businessName || "").toLowerCase();
  const category = (candidate.category || "").toLowerCase();
  const searchable = `${category} ${name}`.trim();

  for (const excluded of profile.excludeCategories) {
    if (excluded.trim() && categoryMatch(category, excluded) === 1) {
      return {
        ref: candidate.ref,
        fit: 0,
        reason: `Excluded: its category matches "${excluded}".`,
        method: "excluded",
      };
    }
  }
  for (const keyword of profile.excludeKeywords) {
    const needle = keyword.toLowerCase().trim();
    if (needle && searchable.includes(needle)) {
      return {
        ref: candidate.ref,
        fit: 0,
        reason: `Excluded: matches the keyword "${keyword}".`,
        method: "excluded",
      };
    }
  }

  const dimensions: { weight: number; score: number; note: string }[] = [];

  const wantedCategories = [...profile.targetCategories, ...profile.targetIndustries].filter(Boolean);
  if (wantedCategories.length > 0) {
    let best = 0;
    let bestLabel = "";
    for (const wanted of wantedCategories) {
      const score = categoryMatch(searchable, wanted);
      if (score > best) {
        best = score;
        bestLabel = wanted;
      }
    }
    dimensions.push({
      weight: 6,
      score: best,
      note:
        best >= 1
          ? `category matches "${bestLabel}"`
          : best > 0
            ? `category partly matches "${bestLabel}"`
            : "category does not match any target",
    });
  }

  if (profile.targetLocations.length > 0) {
    const address = (candidate.address || "").toLowerCase();
    const matched = profile.targetLocations.find((loc) => {
      const needle = loc.toLowerCase().trim();
      return needle.length > 0 && address.includes(needle);
    });
    dimensions.push({
      weight: 3,
      score: matched ? 1 : 0,
      note: matched ? `located in ${matched}` : "address is outside the target locations",
    });
  }

  const hasQualityBar = profile.minRating != null || profile.minReviews != null;
  if (hasQualityBar) {
    const ratingOk = profile.minRating == null || (candidate.rating ?? 0) >= profile.minRating;
    const reviewsOk = profile.minReviews == null || (candidate.reviews ?? 0) >= profile.minReviews;
    dimensions.push({
      weight: 1,
      score: ratingOk && reviewsOk ? 1 : 0,
      note: ratingOk && reviewsOk ? "meets the reputation bar" : "below the reputation bar",
    });
  }

  if (dimensions.length === 0) {
    // The profile names no categories, no locations and no quality bar, so there
    // is nothing to compare against. A number here would be invented.
    return {
      ref: candidate.ref,
      fit: null,
      reason: "The profile does not define any targets to judge against yet.",
      method: "rules",
    };
  }

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const weighted = dimensions.reduce((sum, d) => sum + d.weight * d.score, 0);
  const fit = Math.round((weighted / totalWeight) * 100);

  return {
    ref: candidate.ref,
    fit,
    reason: `${dimensions.map((d) => d.note).join("; ")}.`,
    method: "rules",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI fit
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreFitOptions {
  /** What the tenant sells, so relevance is judged against a real offering. */
  sellerSummary?: string | null;
  /** Skip the model even when one is configured. */
  rulesOnly?: boolean;
}

/**
 * Judges a batch with the model.
 *
 * Batched because fit is a short comparison and one request per lead would
 * dominate the cost and latency of a hundred-lead discovery run. Verdicts are
 * matched back by the caller-assigned `ref` rather than by position: a model that
 * reorders or drops an entry would otherwise silently attach one business's
 * verdict to another.
 */
export async function scoreFitWithAi(
  ctx: TenantContext,
  candidates: IcpFitCandidate[],
  profile: IcpFitProfile,
  options: ScoreFitOptions = {}
): Promise<Map<string, FitVerdict>> {
  const results = new Map<string, FitVerdict>();

  for (let i = 0; i < candidates.length; i += FIT_BATCH_SIZE) {
    const batch = candidates.slice(i, i + FIT_BATCH_SIZE);

    const { value } = await generateStructuredOutput<IcpFitOutput>(
      {
        messages: leadIcpFitPrompt.build({
          profile,
          sellerSummary: options.sellerSummary ?? null,
          candidates: batch,
        }),
        temperature: 0.2,
        timeoutMs: 60_000,
      },
      {
        operation: "lead.icpFit",
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        validate: validateIcpFit,
        ...promptRef(leadIcpFitPrompt),
      }
    );

    const requested = new Set(batch.map((c) => c.ref));
    for (const verdict of value.verdicts) {
      // A ref not in this batch is a hallucinated candidate; dropping it is the
      // only safe response, since there is no business to attach it to.
      if (!requested.has(verdict.ref)) continue;
      results.set(verdict.ref, {
        ref: verdict.ref,
        fit: verdict.fit,
        reason: verdict.reason,
        method: "ai",
      });
    }
  }

  return results;
}

/**
 * Fit for a batch, preferring the model and falling back to the rules.
 *
 * The fallback is per candidate, not per batch: a model that returned fifteen of
 * twenty verdicts leaves the other five scored by rules rather than unscored.
 */
export async function scoreFit(
  ctx: TenantContext,
  candidates: DeterministicCandidate[],
  icp: IcpView,
  options: ScoreFitOptions = {}
): Promise<Map<string, FitVerdict>> {
  const profile = toFitProfile(icp);

  const nothingToJudge =
    profile.targetCategories.length === 0 &&
    profile.targetIndustries.length === 0 &&
    profile.targetLocations.length === 0 &&
    profile.minRating == null &&
    profile.minReviews == null;

  if (nothingToJudge) {
    return new Map(candidates.map((c) => [c.ref, deterministicFit(c, profile)]));
  }

  let aiVerdicts = new Map<string, FitVerdict>();
  if (!options.rulesOnly) {
    try {
      aiVerdicts = await scoreFitWithAi(
        ctx,
        candidates.map((c) => ({
          ref: c.ref,
          businessName: c.businessName,
          category: c.category ?? null,
          address: c.address ?? null,
          rating: c.rating,
          reviews: c.reviews,
        })),
        profile,
        options
      );
    } catch (err: any) {
      const why = err instanceof AiUnavailableError ? "no provider available" : err?.message || err;
      logger.warn(`ICP fit scoring fell back to rules for workspace ${ctx.tenantId}: ${why}`);
    }
  }

  const results = new Map<string, FitVerdict>();
  for (const candidate of candidates) {
    const fromAi = aiVerdicts.get(candidate.ref);
    const rules = deterministicFit(candidate, profile);

    // An exclusion is a fact about the profile, not a judgement call, so it wins
    // over a model that scored the business highly anyway.
    if (rules.method === "excluded") {
      results.set(candidate.ref, rules);
      continue;
    }
    results.set(candidate.ref, fromAi ?? rules);
  }

  return results;
}
