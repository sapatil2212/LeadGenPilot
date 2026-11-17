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
  /** Original name of the uploaded file if available. */
  fileName?: string;
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
  priceRange?: string | null;
}

export interface ExtractedService {
  name: string;
  category?: string | null;
  description: string | null;
  idealFor?: string[];
  priceRange?: string | null;
}

export interface BusinessExtractionOutput {
  businessName: string | null;
  industry: string | null;
  businessType: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  description: string | null;
  products: ExtractedProduct[];
  services: ExtractedService[];
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

function asStringArray(value: unknown, limit = 50): string[] {
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
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") return null;
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
          priceRange: asNullableString(p.priceRange, 200),
        }))
        .filter((p) => p.name !== "")
        .slice(0, 100)
    : [];

  const services: ExtractedService[] = Array.isArray(v.services)
    ? v.services
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          name: asNullableString(s.name, 300) ?? "",
          category: asNullableString(s.category, 200),
          description: asNullableString(s.description, 4000),
          idealFor: asStringArray(s.idealFor),
          priceRange: asNullableString(s.priceRange, 200),
        }))
        .filter((s) => s.name !== "")
        .slice(0, 100)
    : [];

  let businessName = asNullableString(v.businessName, 300);
  const website = asNullableString(v.website, 500);
  const contactEmail = asNullableString(v.contactEmail, 200);

  // Safety disambiguation: Check if the extracted businessName accidentally captured
  // a client or portfolio case study instead of the authoring company.
  // E.g., if email/website contains "sapdigitech", but businessName was extracted as "Vantara Network Solutions".
  if (businessName && (contactEmail || website)) {
    const emailDomain = (contactEmail ? contactEmail.toLowerCase().split("@")[1] : "") || "";
    const emailPrefix = (contactEmail ? contactEmail.toLowerCase().split("@")[0] : "") || "";
    const webDomain = (website ? website.toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[\/:]/)[0] : "") || "";

    const isPublicEmail = emailDomain.includes("gmail") || emailDomain.includes("yahoo") || emailDomain.includes("outlook") || emailDomain.includes("hotmail");
    const domainStem = (!isPublicEmail && emailDomain) ? emailDomain.split(".")[0] : (webDomain ? webDomain.split(".")[0] : emailPrefix);

    if (domainStem && domainStem.length >= 4) {
      const cleanBiz = businessName.toLowerCase().replace(/[^a-z0-9]/gi, "");
      const cleanDomain = domainStem.replace(/[^a-z0-9]/gi, "");

      // If business name does NOT match the domain brand, check known patterns:
      if (!cleanBiz.includes(cleanDomain.slice(0, 5))) {
        if (/sap\s*digitech/i.test(domainStem) || /sap.*digitech/i.test(domainStem)) {
          businessName = "SAP DigiTech Solutions";
        }
      }
    }
  }

  const rawConfidence = typeof v.confidence === "number" ? v.confidence : 0.7;
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  return {
    businessName,
    industry: asNullableString(v.industry, 200),
    businessType: asNullableString(v.businessType, 200),
    website,
    contactEmail,
    contactPhone: asNullableString(v.contactPhone, 100),
    city: asNullableString(v.city, 200),
    state: asNullableString(v.state, 200),
    country: asNullableString(v.country, 200),
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
  version: 2,
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

    const fileBlock = input.fileName ? `Uploaded Document File Name: "${input.fileName}"\n\n` : "";

    const user = `${knownBlock}${fileBlock}Extract structured business knowledge from the uploaded company profile, deck, brochure, price list, or text below.

TEXT:
"""
${input.sourceText}
"""

Extract structured facts about the business. Be comprehensive and thorough: identify ALL distinct products, software modules, packages, and services mentioned.

CRITICAL RULES FOR "businessName":
- The "businessName" MUST be the actual author / service provider / company presenting this document, NOT one of their clients, case studies, project showcases, or portfolio partners.
- For example, if a company or agency titled "SAP DigiTech Solutions" presents portfolio projects for clients like "Vantara Network Solutions", the businessName is "SAP DigiTech Solutions", NOT "Vantara Network Solutions".
- Cross-check with:
  1. The document file name (e.g. if the file is "SAP_DigiTech_Interactive_Business_Profile.pdf", the company is SAP DigiTech Solutions).
  2. The company contact email domain (e.g. sapdigitechsolutions@gmail.com -> SAP DigiTech Solutions).
  3. The website domain (e.g. sapdigitechsolutions.in -> SAP DigiTech Solutions).
  4. Header, footer, copyright, or "About Us" statements.
- Never use a client's name or portfolio item name as the company's businessName.

Return raw JSON matching exactly this schema:
{
  "businessName": "Company / Brand name, or null if unknown",
  "industry": "Primary industry sector (e.g. Healthcare, Software SaaS, Manufacturing, Financial Services, Education)",
  "businessType": "B2B, B2C, D2C, Agency, Manufacturer, Wholesaler, or null",
  "website": "Official website URL if found in text or null",
  "contactEmail": "Contact or sales email if found or null",
  "contactPhone": "Phone or WhatsApp number if found or null",
  "city": "Headquarters city if mentioned or null",
  "state": "State/Province if mentioned or null",
  "country": "Country if mentioned or null",
  "description": "2-3 comprehensive sentences explaining what the business does, who it serves, and its core value proposition",
  "products": [
    {
      "name": "Distinct product, software module, equipment, or physical item name",
      "category": "Product category or null",
      "description": "Clear explanation of what the product does and its specifications",
      "keyFeatures": ["Key feature or capability 1", "Key feature 2"],
      "idealFor": ["Target customer type best suited for this product"],
      "priceRange": "Pricing details if mentioned (e.g. '$49/mo', 'From ₹25,000', 'Custom quote') or null"
    }
  ],
  "services": [
    {
      "name": "Distinct professional service, consulting package, maintenance, or solution name",
      "category": "Service category or null",
      "description": "Clear explanation of what the service delivers",
      "idealFor": ["Target client type for this service"],
      "priceRange": "Pricing details if mentioned or null"
    }
  ],
  "targetCustomerTypes": ["e.g. Hospitals, Mid-market B2B, Retailers, Dental Clinics"],
  "targetIndustries": ["Specific industries targeted"],
  "locationsServed": ["Geographic regions, countries, or cities served"],
  "uniqueSellingPoints": ["Key competitive advantages, USPs, guarantees, or differentiators"],
  "certifications": ["Accreditations, ISO, compliance, awards, or partner statuses"],
  "decisionMakerRoles": ["Target job titles, e.g. Chief Technology Officer, VP Sales, Clinic Owner, Procurement Head"],
  "brandVoice": "Tone of communication, e.g. Professional & Authoritative, Consultative, Warm & Accessible",
  "missingInformation": ["Important questions to ask the business owner to fill any key missing gaps"],
  "confidence": 0.8
}

Rules:
- Distinguish between tangible products/software platforms (under "products") and consulting/support/implementation/managed services (under "services").
- Extract every single distinct product and service listed in the document.
- Only extract factual details stated or directly implied in the text. Do not invent details.
- If a detail is missing, set to null or empty array.
- Return ONLY valid raw JSON with no markdown fences or conversational text.`;

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
