/**
 * AI generation of a component-based WhatsApp template draft.
 *
 * Grounds the draft in the workspace's own business profile, catalogue,
 * structured facts and a few relevant uploaded-document excerpts — the same
 * context the email template generator uses — then maps the model's component
 * output into a ready-to-edit MessageTemplatePayload. The result is returned
 * unsaved; the builder owns the final save.
 */

import type { TenantContext } from "../tenancy/context";
import { logger } from "../logger";
import { generateStructuredOutput } from "../ai/aiService";
import { AiUnavailableError } from "../ai/types";
import {
  messageTemplateDraftPrompt,
  promptRef,
  validateMessageTemplateDraft,
  type TemplateDraftBusiness,
} from "../prompts";
import { listKnowledgeItems, retrieveChunks } from "../knowledge/knowledgeService";
import { getBusinessProfile, listProducts, listServices } from "../business/businessService";
import { MissingTemplateContextError } from "../business/templateGenerator";
import type { MessageTemplatePayload, TemplateVariable } from "./types";
import { systemVariablesAsTemplateVars } from "./variables";

export interface GeneratedMessageTemplate {
  name: string;
  category: string;
  payload: MessageTemplatePayload;
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
  provider: string;
  model: string;
  promptName: string;
  promptVersion: number;
}

/** Build the TemplateVariable list from the model's recommended variable keys. */
function variablesFromRecommendations(keys: string[]): TemplateVariable[] {
  const all = systemVariablesAsTemplateVars();
  const picked = all.filter((v) => keys.includes(v.key));
  // Always ensure at least the two most common personalization vars exist.
  for (const fallbackKey of ["first_name", "company_name"]) {
    if (!picked.some((v) => v.key === fallbackKey)) {
      const found = all.find((v) => v.key === fallbackKey);
      if (found) picked.push(found);
    }
  }
  return picked;
}

export async function generateMessageTemplateDraft(
  ctx: TenantContext,
  input: { objective?: unknown; tone?: unknown; category?: unknown }
): Promise<GeneratedMessageTemplate> {
  const objective =
    String(input.objective ?? "")
      .replace(/[\u0000-\u001F]/g, " ")
      .trim()
      .slice(0, 500) ||
    "Introduce our relevant offering and start a useful conversation on WhatsApp.";
  const tone = String(input.tone ?? "").trim().slice(0, 120) || null;
  const category = ["marketing", "sales", "utility", "support", "custom"].includes(String(input.category))
    ? String(input.category)
    : "marketing";

  const retrievalQuery = [
    objective,
    "company offering products services benefits differentiators ideal customers call to action",
  ].join(" ").slice(0, 1_500);

  const [profile, products, services, facts, chunks] = await Promise.all([
    getBusinessProfile(ctx),
    listProducts(ctx),
    listServices(ctx),
    listKnowledgeItems(ctx),
    retrieveChunks(ctx, retrievalQuery, { limit: 6 }),
  ]);

  const hasContext = Boolean(
    profile.businessName || profile.description || products.length || services.length || facts.length || chunks.length
  );
  if (!hasContext) throw new MissingTemplateContextError();

  const business: Partial<TemplateDraftBusiness> = {
    businessName: profile.businessName,
    industry: profile.industry,
    businessType: profile.businessType,
    description: profile.description,
    brandVoice: profile.brandVoice,
    targetCustomerTypes: profile.targetCustomerTypes,
    uniqueSellingPoints: profile.uniqueSellingPoints,
    products: products.slice(0, 30).map((p) => ({
      name: p.name, category: p.category, description: p.description,
      keyFeatures: p.keyFeatures, idealFor: p.idealFor, priceRange: p.priceRange,
    })),
    services: services.slice(0, 30).map((s) => ({
      name: s.name, category: s.category, description: s.description,
      idealFor: s.idealFor, priceRange: s.priceRange,
    })),
  };

  const prompt = messageTemplateDraftPrompt.build({
    objective,
    tone,
    category,
    business,
    facts: facts.slice(0, 30).map((f) => ({ category: f.category, label: f.label, value: f.value })),
    knowledge: chunks.map((c) => ({ documentTitle: c.documentTitle, content: c.content.slice(0, 2_500) })),
  });

  let generated;
  try {
    generated = await generateStructuredOutput(
      { messages: prompt, temperature: 0.4, timeoutMs: 60_000 },
      {
        operation: "messageTemplate.draft",
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        // No requiredProvider: drafting a template is not vendor-specific, so
        // it runs on whichever provider in the chain answers. Pinning Gemini
        // here made the whole feature fail closed whenever GEMINI_API_KEY was
        // absent or malformed, even with OpenRouter/OpenAI/Anthropic available.
        validate: (candidate) => validateMessageTemplateDraft(candidate),
        ...promptRef(messageTemplateDraftPrompt),
      }
    );
  } catch (err: any) {
    if (err instanceof AiUnavailableError) throw err;
    // attempts stays empty: the failure happened after a provider answered
    // (schema validation), so there is no per-provider chain to report. The
    // underlying reason goes into the message for the logs.
    throw new AiUnavailableError(
      `The AI provider could not produce a valid template draft. ${err?.message || String(err)}`.trim(),
      []
    );
  }
  const { value, result } = generated;

  const payload: MessageTemplatePayload = {
    header: value.headerText ? { type: "text", text: value.headerText } : { type: "none" },
    body: { text: value.bodyText },
    footer: value.footerText ? { enabled: true, text: value.footerText } : { enabled: false, text: "" },
    // Actions carry an empty value: the model proposes labels/types, the user
    // supplies the destination URL/phone. This honours the "never invent URLs"
    // grounding rule while still giving the user a head start.
    actions: value.actions.map((a, i) => ({
      id: `a${i + 1}`,
      type: a.type,
      label: a.label,
      value: "",
    })),
    quickReplies: value.quickReplies.map((display, i) => ({
      id: `qr${i + 1}`,
      display,
      payload: display.toUpperCase().replace(/\s+/g, "_"),
    })),
    variables: variablesFromRecommendations(value.recommendedVariables),
    settings: { deliveryMethod: "web", personalization: true },
  };

  return {
    name: value.name,
    category,
    payload,
    rationale: value.rationale,
    missingInformation: value.missingInformation,
    confidence: value.confidence,
    provider: result.provider,
    model: result.model,
    ...promptRef(messageTemplateDraftPrompt),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Business-specific starter suggestions
// ─────────────────────────────────────────────────────────────────────────────

/** A single tailored starter suggestion returned to the "Choose a starter" UI. */
export interface StarterSuggestion {
  name: string;
  category: string;
  description: string;
  payload: MessageTemplatePayload;
}

/**
 * Distinct outreach angles used to generate a varied set of starters. Each
 * produces one template grounded in the workspace's own business, so the user
 * sees "promote YOUR service", "follow up with YOUR leads" — not generic
 * universal copy.
 */
const STARTER_ANGLES: { category: string; description: string; objective: string }[] = [
  {
    category: "marketing",
    description: "Promote your main offering to new prospects.",
    objective: "Introduce our main product or service to a new prospect and invite them to learn more. Lead generation / cold outreach.",
  },
  {
    category: "sales",
    description: "Follow up with a lead who hasn't replied.",
    objective: "Follow up with a prospect who showed interest or did not reply, nudging them to take the next step. Keep it short and friendly.",
  },
  {
    category: "marketing",
    description: "Share a limited-time offer or discount.",
    objective: "Promote a special offer or discount on our product/service to drive urgency and bookings or sales.",
  },
  {
    category: "utility",
    description: "Remind a customer about an appointment or follow-up.",
    objective: "Send a helpful reminder to a customer about an upcoming appointment, booking, or follow-up related to what we offer.",
  },
  {
    category: "marketing",
    description: "Re-engage a past or dormant customer.",
    objective: "Re-engage a past customer who has gone quiet, with a reason to come back and a low-friction call to action.",
  },
];

/**
 * Generate several business-specific starter templates in parallel, each from a
 * distinct angle. Grounded in the workspace's profile via the same generator
 * the single AI-draft uses.
 *
 * Resilient by design: uses allSettled so one angle failing (or the model
 * returning something invalid) does not sink the rest — the UI shows whatever
 * succeeded. If NONE succeed, the caller falls back to the universal starters.
 *
 * Throws MissingTemplateContextError (surfaced by the first angle) only when the
 * workspace has no business context at all, so the route can signal fallback
 * without spending five AI calls to discover the same thing.
 */
export async function generateStarterSuggestions(
  ctx: TenantContext,
  count = 5
): Promise<StarterSuggestion[]> {
  const angles = STARTER_ANGLES.slice(0, Math.max(1, Math.min(STARTER_ANGLES.length, count)));

  // Probe the first angle directly: if the workspace has no business context,
  // this throws MissingTemplateContextError and we stop immediately rather than
  // firing five doomed AI calls.
  const first = await generateMessageTemplateDraft(ctx, {
    objective: angles[0].objective,
    category: angles[0].category,
  });

  const rest = await Promise.allSettled(
    angles.slice(1).map((angle) =>
      generateMessageTemplateDraft(ctx, { objective: angle.objective, category: angle.category })
    )
  );

  const suggestions: StarterSuggestion[] = [
    { name: first.name, category: first.category, description: angles[0].description, payload: first.payload },
  ];
  rest.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      suggestions.push({
        name: outcome.value.name,
        category: outcome.value.category,
        description: angles[i + 1].description,
        payload: outcome.value.payload,
      });
    } else {
      logger.warn(`Starter suggestion angle "${angles[i + 1].category}" failed: ${outcome.reason?.message || outcome.reason}`);
    }
  });

  return suggestions;
}
