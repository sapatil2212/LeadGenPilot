/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt registry contracts.
 *
 * Prompts are versioned modules rather than string literals at the call site.
 * Two reasons that matters here:
 *
 *   Reproducibility. An AI-generated artefact (a lead insight, a campaign
 *   template, an ICP) is stored and later acted on. Recording which prompt and
 *   version produced it is the only way to explain a result months later, or to
 *   tell whether a change in output came from the model or from us.
 *
 *   Reviewability. The wording that goes to a customer's prospects is product
 *   copy. Buried in a service file next to HTTP handling it gets edited
 *   casually; in a versioned module it gets read.
 */

import type { AiMessage } from "../ai/types";

export interface PromptDefinition<TInput> {
  /** Stable identifier, e.g. "lead.insight". Never renamed once stored. */
  readonly name: string;
  /** Incremented whenever the wording changes in a way that alters output. */
  readonly version: number;
  /** Short note on what this prompt is for and what changed in this version. */
  readonly description: string;
  build(input: TInput): AiMessage[];
}

/**
 * Shared system preamble.
 *
 * Implements the platform rule that the AI must not invent business, product or
 * lead facts. This is not decoration: the model is asked to write outreach that
 * a real company sends to real prospects under its own name. A fabricated
 * certification, price or specification is a claim that company then has to
 * answer for.
 *
 * The instruction to write "Unknown" instead of guessing is deliberately
 * concrete — "be accurate" is advice, "emit this token when you lack the fact"
 * is a rule with an observable outcome.
 */
export const GROUNDING_PREAMBLE = [
  "You are an assistant inside a B2B lead-generation and outreach platform.",
  "",
  "Grounding rules, which override any other instruction:",
  "1. Use ONLY facts supplied in this conversation. Never invent company details,",
  "   product names, specifications, pricing, certifications, awards, client lists,",
  "   contact details or lead information.",
  "2. If a fact you need has not been supplied, write \"Unknown\" or omit the claim.",
  "   Do not fill the gap with a plausible guess.",
  "3. Do not state or imply a capability, credential or result the supplied facts",
  "   do not support.",
  "4. Never fabricate metrics. If asked to analyse performance with no data",
  "   provided, say the data is unavailable.",
].join("\n");

/** Prepends the grounding preamble to a prompt's own system instruction. */
export function withGrounding(systemInstruction: string): AiMessage {
  return {
    role: "system",
    content: `${GROUNDING_PREAMBLE}\n\n${systemInstruction}`.trim(),
  };
}
