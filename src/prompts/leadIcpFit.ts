/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Judges how well a discovered business matches the workspace's ideal customer
 * profile.
 *
 * This answers a different question from the lead score, and conflating the two
 * is what made the original scorer unusable outside one vertical. The lead score
 * measures opportunity signals on the business — no website, dormant social, no
 * booking system. Fit measures whether it is the right kind of customer at all.
 *
 * A dentist with no website scores near the top of the opportunity scale and is
 * worth nothing to a company selling hospital sterilisation equipment. Keeping
 * them separate is what lets a workspace sort by "most underserved" and "most
 * relevant" independently, and what stops a high score standing in for
 * relevance.
 *
 * Several leads are judged in one call. Fit is a cheap comparison against a short
 * profile, and one request per lead across a hundred-lead run would dominate both
 * the latency and the cost of discovery.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";

/** The lead attributes relevant to fit. Deliberately not the whole lead. */
export interface IcpFitCandidate {
  /** Caller-assigned key, echoed back so results can be matched up. */
  ref: string;
  businessName: string;
  category?: string | null;
  address?: string | null;
  rating?: number;
  reviews?: number;
  website?: string | null;
  hasWebsite?: boolean;
}

export interface IcpFitProfile {
  name: string;
  description?: string | null;
  targetCategories: string[];
  targetIndustries: string[];
  targetLocations: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  minRating?: number | null;
  minReviews?: number | null;
}

export interface IcpFitInput {
  profile: IcpFitProfile;
  /** What the tenant sells, so relevance is judged against a real offering. */
  sellerSummary?: string | null;
  candidates: IcpFitCandidate[];
}

export interface IcpFitVerdict {
  ref: string;
  /** 0-100. 0 means "not a customer", 100 means "squarely in the profile". */
  fit: number;
  /** One short sentence, citing the candidate's own attributes. */
  reason: string;
}

export interface IcpFitOutput {
  verdicts: IcpFitVerdict[];
}

export function validateIcpFit(value: unknown): IcpFitOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  // Tolerate a bare array as well as { verdicts: [...] }: asked for a list of
  // judgements, models return one about as often as the wrapper, and rejecting
  // it would cost a repair round trip for a response that is entirely usable.
  const raw = Array.isArray(v.verdicts) ? v.verdicts : Array.isArray(value) ? value : null;
  if (!raw) return null;

  const verdicts: IcpFitVerdict[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const ref = typeof e.ref === "string" ? e.ref.trim() : "";
    if (!ref) continue;

    const rawFit = Number(e.fit);
    if (!Number.isFinite(rawFit)) continue;

    verdicts.push({
      ref,
      fit: Math.round(Math.min(100, Math.max(0, rawFit))),
      reason:
        typeof e.reason === "string" && e.reason.trim()
          ? e.reason.trim().slice(0, 600)
          : "No reason given.",
    });
  }

  if (verdicts.length === 0) return null;
  return { verdicts };
}

function renderProfile(profile: IcpFitProfile): string {
  const lines: string[] = [`Profile: ${profile.name}`];
  const addList = (label: string, values: string[]) => {
    if (values.length) lines.push(`${label}: ${values.join(", ")}`);
  };

  if (profile.description) lines.push(`About: ${profile.description}`);
  addList("Wanted categories", profile.targetCategories);
  addList("Wanted industries", profile.targetIndustries);
  addList("Wanted locations", profile.targetLocations);
  addList("Excluded categories", profile.excludeCategories);
  addList("Excluded keywords", profile.excludeKeywords);
  if (profile.minRating != null) lines.push(`Minimum acceptable rating: ${profile.minRating}`);
  if (profile.minReviews != null) lines.push(`Minimum acceptable reviews: ${profile.minReviews}`);

  return lines.join("\n");
}

function renderCandidates(candidates: IcpFitCandidate[]): string {
  return candidates
    .map((c) => {
      const parts = [`ref: ${c.ref}`, `name: ${c.businessName}`];
      if (c.category) parts.push(`category: ${c.category}`);
      if (c.address) parts.push(`address: ${c.address}`);
      if (typeof c.rating === "number") parts.push(`rating: ${c.rating}`);
      if (typeof c.reviews === "number") parts.push(`reviews: ${c.reviews}`);
      const hasWebsite = c.hasWebsite ?? !!c.website;
      parts.push(`website: ${hasWebsite ? "yes" : "none listed"}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

export const leadIcpFitPrompt: PromptDefinition<IcpFitInput> = {
  name: "lead.icpFit",
  version: 1,
  description:
    "Scores discovered businesses 0-100 on how well each matches the workspace's ideal " +
    "customer profile, with a one-sentence reason drawn from the business's own attributes.",

  build(input: IcpFitInput): AiMessage[] {
    const sellerBlock = input.sellerSummary?.trim()
      ? `=== WHAT THE SELLER OFFERS ===\n${input.sellerSummary.trim().slice(0, 4_000)}\n\n`
      : "";

    const user = `${sellerBlock}=== IDEAL CUSTOMER PROFILE ===
${renderProfile(input.profile)}

=== CANDIDATES ===
${renderCandidates(input.candidates)}

For each candidate, judge how well it matches the profile. Return raw JSON:
{
  "verdicts": [
    { "ref": "string — echo the candidate's ref exactly", "fit": 0, "reason": "string — one sentence" }
  ]
}

Rules:
- Return exactly one verdict per candidate, using the ref given. Do not add,
  merge or drop candidates.
- "fit" is 0-100: how well this business matches the wanted categories,
  industries and locations. Score 0 when it matches an exclusion or is plainly a
  different kind of business.
- Judge ONLY from the candidate attributes listed. You do not know their revenue,
  staff count, buying intent or budget — do not reason as if you do.
- The reason must cite the candidate's own name, category or location. Never
  invent a detail about them to justify a score.
- Do not reward or penalise a candidate for having or lacking a website. That is
  scored separately and is not a measure of whether they are the right customer.
- Return only the raw JSON.`;

    return [
      withGrounding(
        "You decide whether a discovered business is the right kind of customer for a specific " +
          "seller. You are given only what a public listing shows — name, category, location, " +
          "rating, review count. Judge relevance from that and nothing else. An invented detail " +
          "here becomes the stated reason a real company was contacted, or was not."
      ),
      { role: "user", content: user },
    ];
  },
};
