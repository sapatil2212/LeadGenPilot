/**
 * Tenant-scoped AI generation of reusable outreach template drafts.
 *
 * A draft is grounded in the current workspace's profile/catalogue, structured
 * facts and a small set of relevant uploaded-document excerpts. It is returned
 * unsaved for review; the existing Templates editor owns the final save action.
 */

import type { TenantContext } from "../tenancy/context";
import { generateStructuredOutput } from "../ai/aiService";
import { AiUnavailableError } from "../ai/types";
import {
  outreachTemplateDraftPrompt,
  promptRef,
  validateOutreachTemplateDraft,
  type TemplateChannel,
  type TemplateDraftBusiness,
} from "../prompts";
import { listKnowledgeItems, retrieveChunks } from "../knowledge/knowledgeService";
import { getBusinessProfile, listProducts, listServices } from "./businessService";
import { normalizeTemplate } from "../templates/templateService";

export class MissingTemplateContextError extends Error {
  constructor() {
    super(
      "Add business details or upload a company document before generating a template."
    );
    this.name = "MissingTemplateContextError";
  }
}

export interface GeneratedTemplateDraft {
  id: string;
  name: string;
  templateType: TemplateChannel;
  subject: string;
  designMode: "builder";
  htmlCode: string;
  useLogo: boolean;
  logoType: "text";
  logoValue: string;
  introText: string;
  useAiBody: false;
  customBodyText: string;
  useCta: boolean;
  ctaText: string;
  ctaUrl: string;
  ctaBgColor: string;
  useContact: boolean;
  contactText: string;
  useFooter: boolean;
  footerText: string;
  createdAt: string;
}

export interface GenerateTemplateResult {
  draft: GeneratedTemplateDraft;
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
  sources: { documentId: string; documentTitle: string }[];
  provider: string;
  model: string;
  promptName: string;
  promptVersion: number;
}

function verifiedWebsite(raw: string | null): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function generateTemplateDraft(
  ctx: TenantContext,
  input: { channel?: unknown; objective?: unknown; tone?: unknown }
): Promise<GenerateTemplateResult> {
  const channel: TemplateChannel = input.channel === "whatsapp" ? "whatsapp" : "email";
  const objective = String(input.objective ?? "")
    .replace(/[\u0000-\u001F]/g, " ")
    .trim()
    .slice(0, 500) || "Introduce our relevant offering and start a useful sales conversation.";
  const tone = String(input.tone ?? "").trim().slice(0, 120) || null;

  const retrievalQuery = [
    objective,
    "company offering products services benefits differentiators ideal customers warranty pricing implementation call to action",
  ].join(" ").slice(0, 1_500);

  const [profile, products, services, facts, chunks] = await Promise.all([
    getBusinessProfile(ctx),
    listProducts(ctx),
    listServices(ctx),
    listKnowledgeItems(ctx),
    retrieveChunks(ctx, retrievalQuery, { limit: 6 }),
  ]);

  const hasContext = Boolean(
    profile.businessName ||
      profile.description ||
      products.length ||
      services.length ||
      facts.length ||
      chunks.length
  );
  if (!hasContext) throw new MissingTemplateContextError();

  const business: TemplateDraftBusiness = {
    businessName: profile.businessName,
    industry: profile.industry,
    businessType: profile.businessType,
    description: profile.description,
    brandVoice: profile.brandVoice,
    salesObjectives: profile.salesObjectives,
    targetCustomerTypes: profile.targetCustomerTypes,
    targetIndustries: profile.targetIndustries,
    locationsServed: profile.locationsServed,
    uniqueSellingPoints: profile.uniqueSellingPoints,
    certifications: profile.certifications,
    products: products.slice(0, 30).map((product) => ({
      name: product.name,
      category: product.category,
      description: product.description,
      keyFeatures: product.keyFeatures,
      idealFor: product.idealFor,
      priceRange: product.priceRange,
    })),
    services: services.slice(0, 30).map((service) => ({
      name: service.name,
      category: service.category,
      description: service.description,
      idealFor: service.idealFor,
      priceRange: service.priceRange,
    })),
  };

  const prompt = outreachTemplateDraftPrompt.build({
    channel,
    objective,
    tone,
    business,
    facts: facts.slice(0, 30).map((fact) => ({
      category: fact.category,
      label: fact.label,
      value: fact.value,
    })),
    knowledge: chunks.map((chunk) => ({
      documentTitle: chunk.documentTitle,
      content: chunk.content.slice(0, 2_500),
    })),
  });

  let generated;
  try {
    generated = await generateStructuredOutput(
      { messages: prompt, temperature: 0.3, timeoutMs: 60_000 },
      {
        operation: "outreach.templateDraft",
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requiredProvider: "gemini",
        validate: (candidate) => validateOutreachTemplateDraft(candidate, channel),
        ...promptRef(outreachTemplateDraftPrompt),
      }
    );
  } catch (err: any) {
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError(
      "Gemini could not produce a valid template draft.",
      [{ provider: "gemini", message: err?.message || String(err) }]
    );
  }
  const { value, result } = generated;

  const website = verifiedWebsite(profile.website);
  const contactText = [profile.contactEmail, profile.contactPhone].filter(Boolean).join(" • ");
  const businessName = profile.businessName || "Our team";
  const footerText =
    channel === "whatsapp"
      ? "Reply STOP if you do not want to receive further messages."
      : `${businessName}. Reply “unsubscribe” if you prefer not to receive further messages.`;

  const draft: GeneratedTemplateDraft = {
    id: `ai-${Date.now()}`,
    name: value.name,
    templateType: channel,
    subject: channel === "email" ? value.subject || `A relevant idea for {{company}}` : "",
    designMode: "builder",
    htmlCode: "",
    useLogo: Boolean(profile.businessName),
    logoType: "text",
    logoValue: profile.businessName || "",
    introText: value.introText || "Hi {{company}} team,",
    useAiBody: false,
    customBodyText: value.bodyText,
    useCta: Boolean(value.ctaText),
    ctaText: value.ctaText || "",
    ctaUrl: website,
    ctaBgColor: "#4f46e5",
    useContact: Boolean(contactText),
    contactText,
    useFooter: true,
    footerText,
    createdAt: new Date().toISOString(),
  };

  const normalizedDraft = normalizeTemplate(draft);
  const safeDraft: GeneratedTemplateDraft = {
    id: draft.id,
    ...normalizedDraft,
    designMode: "builder",
    logoType: "text",
    useAiBody: false,
    createdAt: draft.createdAt,
  };

  return {
    draft: safeDraft,
    rationale: value.rationale,
    missingInformation: value.missingInformation,
    confidence: value.confidence,
    sources: Array.from(
      new Map(chunks.map((chunk) => [chunk.documentId, {
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
      }])).values()
    ),
    provider: result.provider,
    model: result.model,
    ...promptRef(outreachTemplateDraftPrompt),
  };
}
