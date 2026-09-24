/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proposes an ICP from the workspace's own business data.
 *
 * This is where Phase 3's work pays off: the business profile, the catalogue and
 * the uploaded documents are the context, so the proposal is derived from what
 * the tenant told the platform rather than from the model's priors about their
 * industry.
 *
 * Nothing is written unless the caller asks. A discovery run spends metered lead
 * quota, so an unreviewed target list does not just produce a bad profile — it
 * spends the tenant's money searching for the wrong businesses. When it is
 * applied, existing entries are kept and the suggestion is unioned in, for the
 * same reason business extraction never overwrites a filled field: a model
 * refining a list should not silently delete the tenant's own choices.
 */

import { logger } from "../logger";
import { generateStructuredOutput, isAnyProviderConfigured } from "../ai/aiService";
import {
  icpSuggestionPrompt,
  promptRef,
  validateIcpSuggestion,
  type IcpSuggestionOutput,
} from "../prompts";
import { buildBusinessContext } from "../business/businessService";
import { retrieveChunks } from "../knowledge/knowledgeService";
import type { TenantContext } from "../tenancy/context";
import {
  createIcpProfile,
  getIcpProfile,
  recordIcpSuggestion,
  updateIcpProfile,
  type IcpView,
} from "./icpService";

/** Knowledge chunks pulled in for the targeting question. */
const KNOWLEDGE_CHUNKS = 6;

/**
 * The retrieval query.
 *
 * Fixed rather than assembled from the business profile: retrieval embeds this
 * text, so a query that changes with every edit to the profile would return
 * different excerpts each time and make the suggestion irreproducible. These are
 * the terms that surface the customer-facing parts of a brochure or company deck.
 */
const TARGETING_QUERY =
  "target customers, who we sell to, industries served, ideal clients, markets and regions covered";

export interface SuggestionResult {
  suggestion: IcpSuggestionOutput;
  applied: boolean;
  /** The profile written to, when applied. */
  profile?: IcpView;
  /** Set when the workspace has too little data for a useful suggestion. */
  warning?: string;
}

export class SuggestionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionUnavailableError";
  }
}

function union(current: string[], incoming: string[], limit = 40): string[] {
  const seen = new Set(current.map((v) => v.toLowerCase()));
  const merged = [...current];
  for (const value of incoming) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged.slice(0, limit);
}

/**
 * Suggests targeting for the workspace.
 *
 * @param options.profileId  Refine an existing profile instead of proposing a new
 *                           one. Its current entries are shown to the model and
 *                           preserved on apply.
 * @param options.apply      Write the suggestion. Defaults to false.
 */
export async function suggestIcp(
  ctx: TenantContext,
  options: { profileId?: string | null; guidance?: string | null; apply?: boolean } = {}
): Promise<SuggestionResult> {
  if (!isAnyProviderConfigured()) {
    throw new SuggestionUnavailableError(
      "Suggesting a customer profile needs an AI provider. Set GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY."
    );
  }

  const existingProfile = options.profileId
    ? await getIcpProfile(ctx, options.profileId)
    : null;
  if (options.profileId && !existingProfile) {
    throw new SuggestionUnavailableError("Profile not found.");
  }

  const [business, chunks] = await Promise.all([
    buildBusinessContext(ctx),
    retrieveChunks(ctx, TARGETING_QUERY, { limit: KNOWLEDGE_CHUNKS }),
  ]);

  // Refusing outright when the workspace has told us nothing. The model would
  // happily return a generic list of business categories, which reads as an
  // answer and sends discovery somewhere arbitrary.
  const hasBusinessContext =
    !!business.businessName ||
    !!business.description ||
    !!business.industry ||
    business.products.length > 0 ||
    business.services.length > 0 ||
    chunks.length > 0;

  if (!hasBusinessContext) {
    throw new SuggestionUnavailableError(
      "Fill in your business profile or upload a document first. Without knowing what you sell, " +
        "any customer profile would be guesswork."
    );
  }

  const { value, result } = await generateStructuredOutput<IcpSuggestionOutput>(
    {
      messages: icpSuggestionPrompt.build({
        business,
        knowledge: chunks.map((c) => ({
          documentTitle: c.documentTitle,
          content: c.content,
          score: c.score,
        })),
        existing: existingProfile
          ? {
              name: existingProfile.name,
              targetCategories: existingProfile.targetCategories,
              targetLocations: existingProfile.targetLocations,
              excludeCategories: existingProfile.excludeCategories,
            }
          : undefined,
        guidance: options.guidance ?? null,
      }),
      temperature: 0.3,
      timeoutMs: 60_000,
    },
    {
      operation: "icp.suggestion",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      validate: validateIcpSuggestion,
      ...promptRef(icpSuggestionPrompt),
    }
  );

  const warning =
    value.targetCategories.length === 0
      ? "The model could not identify target categories from your business data. " +
        "Its questions are in missingInformation."
      : undefined;

  if (!options.apply) {
    return { suggestion: value, applied: false, warning };
  }

  if (value.targetCategories.length === 0) {
    // Applying a suggestion with no categories would produce a profile that
    // cannot run a discovery search, which is worse than not applying it.
    return { suggestion: value, applied: false, warning };
  }

  const profile = existingProfile
    ? await updateIcpProfile(ctx, existingProfile.id, {
        targetCategories: union(existingProfile.targetCategories, value.targetCategories),
        targetIndustries: union(existingProfile.targetIndustries, value.targetIndustries),
        targetLocations: union(existingProfile.targetLocations, value.targetLocations),
        decisionMakerRoles: union(existingProfile.decisionMakerRoles, value.decisionMakerRoles),
        excludeCategories: union(existingProfile.excludeCategories, value.excludeCategories),
        excludeKeywords: union(existingProfile.excludeKeywords, value.excludeKeywords),
        // The tenant's own description and name are left alone; they named it.
        ...(existingProfile.description ? {} : { description: value.description }),
      })
    : await createIcpProfile(ctx, {
        name: value.name || "Suggested customer profile",
        description: value.description,
        targetCategories: value.targetCategories,
        targetIndustries: value.targetIndustries,
        targetLocations: value.targetLocations,
        decisionMakerRoles: value.decisionMakerRoles,
        excludeCategories: value.excludeCategories,
        excludeKeywords: value.excludeKeywords,
      });

  if (!profile) {
    throw new SuggestionUnavailableError("Profile not found.");
  }

  // updateIcpProfile clears aiConfidence on any edit, since a hand-edited profile
  // is no longer the model's output. Stamping provenance afterwards records that
  // this particular write did come from the model.
  await recordIcpSuggestion(ctx, profile.id, {
    confidence: value.confidence,
    promptName: icpSuggestionPrompt.name,
    promptVersion: icpSuggestionPrompt.version,
  });

  logger.info(
    `Applied an AI customer profile suggestion to ${profile.id} for workspace ${ctx.tenantId} ` +
      `via ${result.provider} (${value.targetCategories.length} categor${
        value.targetCategories.length === 1 ? "y" : "ies"
      }).`
  );

  const refreshed = await getIcpProfile(ctx, profile.id);
  return { suggestion: value, applied: true, profile: refreshed ?? profile, warning };
}
