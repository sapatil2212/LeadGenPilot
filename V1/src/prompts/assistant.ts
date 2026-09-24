/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The tenant's business assistant.
 *
 * Context is assembled from specific stored fields plus the knowledge chunks
 * retrieved for this question — never the whole knowledge base. Two reasons:
 * a prompt that grows with the document library eventually stops fitting and
 * always costs more than it needs to, and a model given fifty pages of
 * unrelated text answers worse than one given the three relevant paragraphs.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";

export interface AssistantBusinessContext {
  businessName?: string | null;
  industry?: string | null;
  businessType?: string | null;
  description?: string | null;
  locationsServed?: string[];
  uniqueSellingPoints?: string[];
  targetCustomerTypes?: string[];
  products?: { name: string; category?: string | null; description?: string | null }[];
  services?: { name: string; description?: string | null }[];
}

/** One retrieved knowledge chunk, with enough provenance to cite it. */
export interface RetrievedChunk {
  documentTitle: string;
  content: string;
  /** Similarity score, for ordering only. Not shown to the model. */
  score?: number;
}

export interface AssistantInput {
  business: AssistantBusinessContext;
  /** Chunks retrieved for THIS question, most relevant first. */
  knowledge: RetrievedChunk[];
  /** Prior turns, oldest first, already truncated by the caller. */
  history: AiMessage[];
  question: string;
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
  addList("Locations served", business.locationsServed);
  addList("Target customers", business.targetCustomerTypes);
  addList("Differentiators", business.uniqueSellingPoints);

  if (business.products?.length) {
    lines.push("Products:");
    for (const p of business.products.slice(0, 40)) {
      const parts = [p.name, p.category, p.description].filter(Boolean);
      lines.push(`  - ${parts.join(" — ")}`);
    }
  }

  if (business.services?.length) {
    lines.push("Services:");
    for (const s of business.services.slice(0, 40)) {
      lines.push(`  - ${[s.name, s.description].filter(Boolean).join(" — ")}`);
    }
  }

  return lines.length ? lines.join("\n") : "No business profile has been set up yet.";
}

function renderKnowledge(chunks: RetrievedChunk[]): string {
  if (!chunks.length) {
    return "No document excerpts were retrieved for this question.";
  }
  return chunks
    .map((c, i) => `[${i + 1}] from "${c.documentTitle}":\n${c.content}`)
    .join("\n\n");
}

export const assistantPrompt: PromptDefinition<AssistantInput> = {
  name: "assistant.chat",
  version: 1,
  description:
    "Tenant-facing business assistant. Answers from the stored business profile and the " +
    "knowledge chunks retrieved for the current question only.",

  build(input: AssistantInput): AiMessage[] {
    const system = [
      "You are the business assistant for the workspace described below. You help the team",
      "understand their own business data, define who to target, and prepare outreach.",
      "",
      "=== BUSINESS PROFILE ===",
      renderBusiness(input.business),
      "",
      "=== RELEVANT DOCUMENT EXCERPTS ===",
      renderKnowledge(input.knowledge),
      "",
      "How to answer:",
      "- Answer from the profile and excerpts above. They are this workspace's own data.",
      "- When something is not covered, say so plainly and ask for it. Do not guess.",
      "- Do not invent product specifications, pricing, certifications or customer names.",
      "- Be concise and practical. Prefer specifics from the data over generic advice.",
      "- If the profile is empty, say what you would need in order to help.",
    ].join("\n");

    return [
      withGrounding(system),
      ...input.history,
      { role: "user", content: input.question },
    ];
  },
};
