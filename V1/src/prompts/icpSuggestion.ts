/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proposes an Ideal Customer Profile from what the workspace has already told
 * the platform about itself.
 *
 * This is the one place the product is allowed to answer "who should we target"
 * on the user's behalf, and the constraint that makes it safe is that it reasons
 * only from the stored business profile, catalogue and document excerpts. A model
 * asked to invent target markets for an unknown company produces a generic list
 * that looks plausible, sends a discovery run in the wrong direction, and burns
 * the tenant's lead quota doing it.
 *
 * So the output is a proposal for review, every field is allowed to be empty, and
 * anything the supplied context does not support belongs in `missingInformation`
 * as a question rather than in a target list as a guess.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";
import type { AssistantBusinessContext, RetrievedChunk } from "./assistant";

export interface IcpSuggestionInput {
  business: AssistantBusinessContext;
  /** Document excerpts retrieved for the targeting question. */
  knowledge: RetrievedChunk[];
  /** What the tenant already put in this profile, so it is refined not replaced. */
  existing?: {
    name?: string | null;
    targetCategories?: string[];
    targetLocations?: string[];
    excludeCategories?: string[];
  };
  /** Free-text steer, e.g. "we want to expand into Gujarat". */
  guidance?: string | null;
}

export interface IcpSuggestionOutput {
  name: string | null;
  description: string | null;
  /**
   * The kinds of business to search for, phrased as they would appear on a maps
   * listing — "Multispecialty Hospital", not "large healthcare providers". A
   * category that does not match how businesses describe themselves returns
   * nothing.
   */
  targetCategories: string[];
  targetIndustries: string[];
  /** Cities or regions, only where the business data supports them. */
  targetLocations: string[];
  decisionMakerRoles: string[];
  /** Categories that a search for the above would wrongly return. */
  excludeCategories: string[];
  excludeKeywords: string[];
  /** Why this profile follows from the business data. Shown to the user. */
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
}

function asStringArray(value: unknown, limit = 30, maxLen = 200): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && v.toLowerCase() !== "unknown")
        .map((v) => v.slice(0, maxLen))
    )
  ).slice(0, limit);
}

function asNullableString(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed.slice(0, max);
}

export function validateIcpSuggestion(value: unknown): IcpSuggestionOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const rawConfidence = typeof v.confidence === "number" ? v.confidence : 0.5;

  return {
    name: asNullableString(v.name, 200),
    description: asNullableString(v.description, 2_000),
    targetCategories: asStringArray(v.targetCategories),
    targetIndustries: asStringArray(v.targetIndustries),
    targetLocations: asStringArray(v.targetLocations),
    decisionMakerRoles: asStringArray(v.decisionMakerRoles),
    excludeCategories: asStringArray(v.excludeCategories),
    excludeKeywords: asStringArray(v.excludeKeywords),
    rationale: asNullableString(v.rationale, 3_000),
    missingInformation: asStringArray(v.missingInformation, 12, 400),
    confidence: Math.min(1, Math.max(0, rawConfidence)),
  };
}

function renderBusiness(business: AssistantBusinessContext): string {
  const lines: string[] = [];
  const add = (label: string, value?: string | null) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  const addList = (label: string, values?: string[]) => {
    if (values && values.length) lines.push(`${label}: ${values.join(", ")}`);
  };

  add("Business name", business.businessName);
  add("Industry", business.industry);
  add("Business type", business.businessType);
  add("What they do", business.description);
  addList("Locations they serve", business.locationsServed);
  addList("Customer types they have named", business.targetCustomerTypes);
  addList("Differentiators", business.uniqueSellingPoints);

  if (business.products?.length) {
    lines.push("Products they sell:");
    for (const p of business.products.slice(0, 40)) {
      lines.push(`  - ${[p.name, p.category, p.description].filter(Boolean).join(" — ")}`);
    }
  }
  if (business.services?.length) {
    lines.push("Services they offer:");
    for (const s of business.services.slice(0, 40)) {
      lines.push(`  - ${[s.name, s.description].filter(Boolean).join(" — ")}`);
    }
  }

  return lines.length ? lines.join("\n") : "No business profile has been filled in yet.";
}

function renderKnowledge(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "No document excerpts are available.";
  return chunks
    .map((c, i) => `[${i + 1}] from "${c.documentTitle}":\n${c.content}`)
    .join("\n\n");
}

export const icpSuggestionPrompt: PromptDefinition<IcpSuggestionInput> = {
  name: "icp.suggestion",
  version: 1,
  description:
    "Proposes target categories, locations, decision-maker roles and exclusions for a " +
    "workspace's ideal customer profile, reasoning only from its stored business data.",

  build(input: IcpSuggestionInput): AiMessage[] {
    const existing = input.existing ?? {};
    const existingLines: string[] = [];
    if (existing.name) existingLines.push(`- Profile name: ${existing.name}`);
    if (existing.targetCategories?.length) {
      existingLines.push(`- Already targeting: ${existing.targetCategories.join(", ")}`);
    }
    if (existing.targetLocations?.length) {
      existingLines.push(`- Already searching: ${existing.targetLocations.join(", ")}`);
    }
    if (existing.excludeCategories?.length) {
      existingLines.push(`- Already excluding: ${existing.excludeCategories.join(", ")}`);
    }

    const existingBlock = existingLines.length
      ? `\nThe tenant has already set some of this. Keep what they chose and add to it; ` +
        `do not remove their entries:\n${existingLines.join("\n")}\n`
      : "";

    const guidanceBlock = input.guidance?.trim()
      ? `\nThe tenant also said: "${input.guidance.trim().slice(0, 1_000)}"\n`
      : "";

    const user = `Propose an ideal customer profile for the business described below.

=== THE BUSINESS (this is who is selling) ===
${renderBusiness(input.business)}

=== THEIR OWN DOCUMENTS ===
${renderKnowledge(input.knowledge)}
${existingBlock}${guidanceBlock}
Return raw JSON matching exactly this schema:
{
  "name": "string or null — a short name for this profile, e.g. \\"Mid-size hospitals in Maharashtra\\"",
  "description": "string or null — one or two sentences on who this targets",
  "targetCategories": ["string"],
  "targetIndustries": ["string"],
  "targetLocations": ["string"],
  "decisionMakerRoles": ["string"],
  "excludeCategories": ["string"],
  "excludeKeywords": ["string"],
  "rationale": "string or null — why this follows from the business data above",
  "missingInformation": ["string — a question to ask the tenant"],
  "confidence": 0.0
}

Rules:
- "targetCategories" must be the kind of business a search engine or maps listing
  would show, phrased the way those businesses describe themselves: "Dental
  Clinic", "Multispecialty Hospital", "Auto Parts Dealer". Not a market segment,
  not an adjective, not a size band. A category nobody lists themselves under
  returns no results.
- "targetLocations" must be places the business data supports. If it never says
  where they operate, return an empty array and ask in "missingInformation".
  Do not pick a city because it is large.
- "excludeCategories" and "excludeKeywords" are the traps: businesses a search
  for the above would return that are NOT customers. Their own competitors,
  suppliers, and adjacent categories that share a word.
- Propose nothing the business data does not support. Empty arrays are the
  correct answer when the context is thin. Put what you would need into
  "missingInformation" as a direct question.
- "confidence" is how well the supplied context supports this profile: 0.0 to 1.0.
- Return only the raw JSON.`;

    return [
      withGrounding(
        "You define who a company should sell to, working only from what that company has told " +
          "this platform about itself. The profile you return drives automated lead discovery " +
          "that spends the tenant's metered quota, so a plausible-sounding guess is worse than " +
          "an empty answer: it sends the search somewhere real money gets spent for nothing. " +
          "Prefer fewer, well-supported targets over a broad list."
      ),
      { role: "user", content: user },
    ];
  },
};
