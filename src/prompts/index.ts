/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt registry.
 *
 * Every prompt used anywhere in the application is registered here, so:
 *   - the wording that reaches a customer's prospects is reviewable in one place;
 *   - an artefact can record the prompt name and version that produced it;
 *   - a call site cannot quietly introduce a new prompt inline.
 */

import { leadInsightPrompt } from "./leadInsight";
import { outreachCopyPrompt } from "./outreachCopy";
import { businessExtractionPrompt } from "./businessExtraction";
import { assistantPrompt } from "./assistant";
import { icpSuggestionPrompt } from "./icpSuggestion";
import { leadIcpFitPrompt } from "./leadIcpFit";
import type { PromptDefinition } from "./types";

export { GROUNDING_PREAMBLE, withGrounding } from "./types";
export type { PromptDefinition } from "./types";

export { leadInsightPrompt, type LeadInsightInput } from "./leadInsight";
export {
  outreachCopyPrompt,
  validateOutreachCopy,
  type OutreachCopyInput,
  type OutreachCopyOutput,
} from "./outreachCopy";
export {
  businessExtractionPrompt,
  validateBusinessExtraction,
  type BusinessExtractionInput,
  type BusinessExtractionOutput,
} from "./businessExtraction";
export {
  assistantPrompt,
  type AssistantInput,
  type AssistantBusinessContext,
  type RetrievedChunk,
} from "./assistant";
export {
  icpSuggestionPrompt,
  validateIcpSuggestion,
  type IcpSuggestionInput,
  type IcpSuggestionOutput,
} from "./icpSuggestion";
export {
  leadIcpFitPrompt,
  validateIcpFit,
  type IcpFitCandidate,
  type IcpFitInput,
  type IcpFitOutput,
  type IcpFitProfile,
  type IcpFitVerdict,
} from "./leadIcpFit";

/** All registered prompts, keyed by name. */
export const PROMPTS = {
  [leadInsightPrompt.name]: leadInsightPrompt,
  [outreachCopyPrompt.name]: outreachCopyPrompt,
  [businessExtractionPrompt.name]: businessExtractionPrompt,
  [assistantPrompt.name]: assistantPrompt,
  [icpSuggestionPrompt.name]: icpSuggestionPrompt,
  [leadIcpFitPrompt.name]: leadIcpFitPrompt,
} as const satisfies Record<string, PromptDefinition<any>>;

export type PromptName = keyof typeof PROMPTS;

/**
 * Identifier to store alongside an AI-generated artefact, so the exact wording
 * that produced it can be recovered later.
 */
export function promptRef(prompt: PromptDefinition<any>): { promptName: string; promptVersion: number } {
  return { promptName: prompt.name, promptVersion: prompt.version };
}

/** Registry listing, for an admin diagnostics view. */
export function listPrompts(): { name: string; version: number; description: string }[] {
  return Object.values(PROMPTS).map((p) => ({
    name: p.name,
    version: p.version,
    description: p.description,
  }));
}
