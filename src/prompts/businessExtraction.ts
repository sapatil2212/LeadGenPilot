/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Extracts structured business knowledge from free text — what a tenant types
 * about their company, or text pulled out of an uploaded document.
 *
 * The output is deliberately a set of named fields rather than a summary blob.
 * Storing "everything we know about this business" as one paragraph makes it
 * impossible to assemble a focused prompt later: campaign generation needs the
 * products and the USPs, lead scoring needs the target customer profile, and
 * neither wants the other's text spending its context budget.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";

export interface BusinessExtractionInput {
  /** What the tenant wrote, or text extracted from their document. */
  sourceText: string;
  /** Anything already known, so the model does not re-ask or contradict it. */
  known?: {
    businessName?: string | null;
    industry?: string | null;
    businessType?: string | null;
    website?: string | null;
    country?: string | null;
    city?: string | null;
  };
}

export interface ExtractedProduct {
  name: string;
  category: string | null;
  description: string | null;
  keyFeatures: string[];
  idealFor: string[];
}

export interface BusinessExtractionOutput {
  businessName: string | null;
  industry: string | null;
  businessType: string | null;
  description: string | null;
  products: ExtractedProduct[];
  services: { name: string; description: string | null }[];
  targetCustomerTypes: string[];
  targetIndustries: string[];
  locationsServed: string[];
  uniqueSellingPoints: string[];
  certifications: string[];
  decisionMakerRoles: string[];
  brandVoice: string | null;
  /** Questions worth asking, so the UI can ask instead of the model guessing. */
  missingInformation: string[];
  /** 0-1 self-assessment of how much was actually stated in the source. */
  confidence: number;
}

function asStringArray(value: unknown, limit = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function asNullableString(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed.slice(0, max);
}

/** Validates and normalises the model's JSON, dropping anything malformed. */
export function validateBusinessExtraction(value: unknown): BusinessExtractionOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const products: ExtractedProduct[] = Array.isArray(v.products)
    ? v.products
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({
          name: asNullableString(p.name, 300) ?? "",
          category: asNullableString(p.category, 200),
          description: asNullableString(p.description, 4000),
          keyFeatures: asStringArray(p.keyFeatures),
          idealFor: asStringArray(p.idealFor),
        }))
        .filter((p) => p.name !== "")
        .slice(0, 100)
    : [];

  const services = Array.isArray(v.services)
    ? v.services
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          name: asNullableString(s.name, 300) ?? "",
          description: asNullableString(s.description, 4000),
        }))
        .filter((s) => s.name !== "")
        .slice(0, 100)
    : [];

  const rawConfidence = typeof v.confidence === "number" ? v.confidence : 0.5;
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  return {
    businessName: asNullableString(v.businessName, 300),
    industry: asNullableString(v.industry, 200),
    businessType: asNullableString(v.businessType, 200),
    description: asNullableString(v.description, 6000),
    products,
    services,
    targetCustomerTypes: asStringArray(v.targetCustomerTypes),
    targetIndustries: asStringArray(v.targetIndustries),
    locationsServed: asStringArray(v.locationsServed),
    uniqueSellingPoints: asStringArray(v.uniqueSellingPoints),
    certifications: asStringArray(v.certifications),
    decisionMakerRoles: asStringArray(v.decisionMakerRoles),
    brandVoice: asNullableString(v.brandVoice, 500),
    missingInformation: asStringArray(v.missingInformation, 20),
    confidence,
  };
}

export const businessExtractionPrompt: PromptDefinition<BusinessExtractionInput> = {
  name: "business.extraction",
  version: 1,
  description:
    "Turns free-form text about a company (typed or extracted from a document) into " +
    "structured business knowledge fields, listing what is missing rather than guessing.",

  build(input: BusinessExtractionInput): AiMessage[] {
    const known = input.known ?? {};
    const knownLines = Object.entries(known)
      .filter(([, value]) => value)
      .map(([key, value]) => `- ${key}: ${value}`);

    const knownBlock = knownLines.length
      ? `Already known about this business (treat as authoritative, do not contradict):\n${knownLines.join("\n")}\n\n`
      : "";

    const user = `${knownBlock}Extract structured business knowledge from the text below.

TEXT:
"""
${input.sourceText}
"""

Return raw JSON matching exactly this schema:
{
  "businessName": "string or null",
  "industry": "string or null",
  "businessType": "string or null",
  "description": "string or null — two or three sentences on what this business does",
  "products": [
    {
      "name": "string",
      "category": "string or null",
      "description": "string or null",
      "keyFeatures": ["string"],
      "idealFor": ["string — the customer type this product suits"]
    }
  ],
  "services": [{ "name": "string", "description": "string or null" }],
  "targetCustomerTypes": ["string — e.g. Hospital, Diagnostic Centre, Dealer"],
  "targetIndustries": ["string"],
  "locationsServed": ["string"],
  "uniqueSellingPoints": ["string"],
  "certifications": ["string"],
  "decisionMakerRoles": ["string — e.g. Procurement Manager"],
  "brandVoice": "string or null — e.g. formal, technical, warm",
  "missingInformation": ["string — a question to ask the user about something important that the text does not state"],
  "confidence": 0.0
}

Rules:
- Extract only what the text states or unambiguously implies. Use null or an empty array otherwise.
- Never invent a product name, specification, certification, price or client.
- Put anything important but absent into "missingInformation" as a question to ask the user.
- "confidence" is your estimate of how completely the text describes this business: 0.0 to 1.0.
- Return only the raw JSON.`;

    return [
      withGrounding(
        "You extract structured facts about a company from text its own staff provided. " +
          "Accuracy matters more than completeness: this data becomes the factual basis for " +
          "outreach the company sends under its own name, so an invented detail becomes a " +
          "false claim to their prospects."
      ),
      { role: "user", content: user },
    ];
  },
};
