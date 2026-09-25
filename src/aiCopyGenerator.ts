/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lead } from "./types";
import { generateOutreachCopy, OutreachTemplate, cleanBusinessName } from "./outreachCopy";
import { logger } from "./logger";
import { generateStructuredOutput } from "./ai/aiService";
import { outreachCopyPrompt, validateOutreachCopy, promptRef } from "./prompts";
import type { AiProviderId } from "./ai/types";

export interface CopyOptions {
  tenantId?: string;
  userId?: string;
  preferredProvider?: AiProviderId | null;
}

/**
 * Generates outreach messages (WhatsApp + Email) for a lead, falling back to the
 * deterministic rule-based engine when no AI provider can answer.
 *
 * The vendor call, the prompt, the JSON parsing and the retry policy have all
 * moved out: provider selection and fallback live in the AI service, the prompt
 * lives in the registry, and JSON validation is a schema function passed to
 * generateStructuredOutput. What remains here is the mapping from a Lead to the
 * prompt's inputs and the decision to degrade rather than fail.
 *
 * Two things improve as a side effect of centralising:
 *   - there is now a request timeout. The previous Gemini call had none, so a
 *     hung request could stall a scrape indefinitely — once per lead.
 *   - a malformed JSON reply gets one correction attempt before falling back,
 *     instead of discarding the whole generation on the first bad character.
 */
export async function generateAICopy(lead: Lead, options?: CopyOptions): Promise<OutreachTemplate> {
  const cleanName = cleanBusinessName(lead.businessName || "your business");

  try {
    logger.info(`Generating personalized AI outreach copy for: '${lead.businessName}'`);

    const { value } = await generateStructuredOutput<OutreachTemplate>(
      {
        messages: outreachCopyPrompt.build({
          cleanName,
          category: lead.category,
          rating: lead.rating,
          reviews: lead.reviews,
          aiInsight: lead.aiInsight,
        }),
        timeoutMs: 30_000,
      },
      {
        operation: "outreach.copy",
        tenantId: options?.tenantId,
        userId: options?.userId,
        preferredProvider: options?.preferredProvider,
        validate: validateOutreachCopy,
        ...promptRef(outreachCopyPrompt),
      }
    );

    logger.success(`AI outreach copy generated for: '${lead.businessName}'`);
    return value;
  } catch (error: any) {
    logger.warn(
      `AI copy generation failed: ${error?.message || error}. Falling back to rule-based copy.`
    );
    return generateOutreachCopy(lead);
  }
}
