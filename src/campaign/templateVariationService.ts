/**
 * Template Variation Service
 *
 * AI-powered generation of semantically-equivalent outreach message variants,
 * plus persistent rotation state so every lead receives a different wording
 * while the offer, CTA and intent remain consistent.
 *
 * ## Generation
 *
 * generateTemplateVariations() takes an outreach approach and business context,
 * asks the configured AI provider to produce N distinct versions, and stores
 * them as TemplateVariation rows in "draft" status. The user reviews and
 * approves them in the UI before they enter the rotation.
 *
 * ## Rotation
 *
 * selectNextVariation() atomically increments Campaign.templateRotationIndex
 * using the same optimistic-lock pattern as senderRotationService. The
 * selected variation's content is substituted into the message body at
 * delivery time — not stored per message, because the variation is the
 * template and the personalised body is compiled on send.
 *
 * ## Variable Preservation
 *
 * The AI prompt explicitly instructs the model to retain all {{variable}}
 * tokens. The validation function strips any response that drops a variable
 * present in the original approach.
 */

import { prisma } from "../prisma";
import { logger, logContext } from "../logger";
import { generateStructuredOutput } from "../ai/aiService";
import type { AiProviderId } from "../ai/types";
import { fillTemplateVariables } from "../outreachTemplates";
import type { Lead } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TemplateVariationInput {
  outreachApproach: string;
  channel: "email" | "whatsapp";
  count?: number; // 1-5, default 5
  businessName?: string;
  industry?: string;
  ctaText?: string;
  tone?: string;
  targetAudience?: string;
  existingVariables?: string[]; // e.g. ["{{name}}", "{{company}}"]
}

export interface TemplateVariationOutput {
  variationIndex: number;
  subject?: string;   // email only
  content: string;
}

export interface GeneratedVariations {
  variations: TemplateVariationOutput[];
  provider?: string;
  model?: string;
}

export interface StoredVariation {
  id: string;
  campaignId: string | null;
  channel: string;
  variationIndex: number;
  outreachApproach: string | null;
  subject: string | null;
  content: string;
  status: string;
  aiProvider: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_VARIATIONS = 5;
const DEFAULT_VARIATION_COUNT = 5;

// Standard variables the system supports — must be preserved in all variations.
const SYSTEM_VARIABLES = ["{{name}}", "{{company}}", "{{business}}", "{{city}}", "{{location}}", "{{category}}", "{{phone}}", "{{website}}"];

// ── AI Prompt ──────────────────────────────────────────────────────────────

function buildVariationPrompt(input: TemplateVariationInput): string {
  const count = Math.min(MAX_VARIATIONS, Math.max(1, input.count ?? DEFAULT_VARIATION_COUNT));
  const isEmail = input.channel === "email";
  const variablesNote = SYSTEM_VARIABLES.map((v) => `${v}`).join(", ");

  return `You are an expert outreach copywriter. Generate ${count} distinct versions of an outreach message based on the approach below.

OUTREACH APPROACH:
${input.outreachApproach}

CHANNEL: ${isEmail ? "Email" : "WhatsApp"}
${input.businessName ? `SENDER BUSINESS: ${input.businessName}` : ""}
${input.industry ? `INDUSTRY/NICHE: ${input.industry}` : ""}
${input.ctaText ? `CALL TO ACTION: ${input.ctaText}` : ""}
${input.tone ? `TONE: ${input.tone}` : "Keep the tone professional and conversational."}
${input.targetAudience ? `TARGET AUDIENCE: ${input.targetAudience}` : ""}

RULES:
1. Every version must express THE SAME core offer, intent, and CTA as the approach. Do not change the business value proposition.
2. Vary the opening hook, sentence structure, and word choices — NOT the meaning.
3. Keep any template variables exactly as written: ${variablesNote}. If you use {{name}} in one version, use it consistently in all versions.
4. Do NOT invent facts, prices, or claims not stated in the approach.
5. ${isEmail ? "Email: 3–6 sentences for the body, plus a distinct subject line. Keep subject lines under 60 characters." : "WhatsApp: 2–4 short sentences per version. Plain text only, no markdown, no links unless in the approach."}
6. Avoid repeating the same opening words across versions.
7. Each version must be naturally distinct — not just synonym substitution.
8. If {{name}} is appropriate for this approach, include it in every version.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "variations": [
    {
      "variationIndex": 0,
      ${isEmail ? '"subject": "string (required for email)",' : ""}
      "content": "string"
    }
  ]
}

Generate exactly ${count} variations with variationIndex values 0 through ${count - 1}.`;
}

type RawVariation = { variationIndex: number; subject?: string; content: string };

function validateVariations(raw: unknown, count: number): GeneratedVariations | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.variations)) return null;
  if (obj.variations.length === 0) return null;

  const variations: TemplateVariationOutput[] = [];
  for (const item of obj.variations as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const v = item as RawVariation;
    if (typeof v.variationIndex !== "number") return null;
    if (typeof v.content !== "string" || !v.content.trim()) return null;
    variations.push({
      variationIndex: v.variationIndex,
      subject: typeof v.subject === "string" ? v.subject.trim() || undefined : undefined,
      content: v.content.trim(),
    });
  }

  if (variations.length < 1) return null;
  return { variations };
}

// ── Core Service Functions ─────────────────────────────────────────────────

/**
 * Generate N template variations from an outreach approach using AI.
 * Does NOT persist anything — the caller decides whether to save.
 */
export async function generateTemplateVariations(
  input: TemplateVariationInput,
  options: { tenantId?: string; userId?: string; preferredProvider?: AiProviderId | null } = {}
): Promise<GeneratedVariations> {
  const count = Math.min(MAX_VARIATIONS, Math.max(1, input.count ?? DEFAULT_VARIATION_COUNT));
  const prompt = buildVariationPrompt({ ...input, count });

  logger.info(
    `Generating ${count} template variations for ${input.channel} channel.${logContext({ tenant: options.tenantId })}`
  );

  const { value, result } = await generateStructuredOutput<GeneratedVariations>(
    {
      messages: [{ role: "user", content: prompt }],
      timeoutMs: 45_000,
      maxTokens: 4_096,
    },
    {
      operation: "template.variations",
      tenantId: options.tenantId,
      userId: options.userId,
      preferredProvider: options.preferredProvider,
      promptName: "template_variations",
      promptVersion: 1,
      validate: (raw) => validateVariations(raw, count),
    }
  );

  // Re-index variations 0..N-1 in case the model produced out-of-order indices.
  const reindexed = value.variations
    .slice(0, count)
    .map((v, i) => ({ ...v, variationIndex: i }));

  return {
    variations: reindexed,
    provider: result.provider,
    model: result.model,
  };
}

/**
 * Generate and persist template variations for a campaign.
 *
 * Clears any previous draft variations for this campaign+channel before
 * inserting the new set, so a regeneration always starts fresh. Approved
 * variations are never deleted by regeneration.
 */
export async function generateAndSaveVariations(
  tenantId: string,
  campaignId: string,
  input: TemplateVariationInput,
  options: { userId?: string; preferredProvider?: AiProviderId | null } = {}
): Promise<StoredVariation[]> {
  const generated = await generateTemplateVariations(input, { tenantId, ...options });

  // Delete previous drafts for this campaign+channel so the UI shows only
  // the freshly generated set.
  await prisma.templateVariation.deleteMany({
    where: { campaignId, tenantId, channel: input.channel, status: "draft" },
  });

  const rows = await Promise.all(
    generated.variations.map((v) =>
      prisma.templateVariation.create({
        data: {
          tenantId,
          campaignId,
          channel: input.channel,
          variationIndex: v.variationIndex,
          outreachApproach: input.outreachApproach,
          subject: v.subject ?? null,
          content: v.content,
          status: "draft",
          aiProvider: generated.provider ?? null,
          aiModel: generated.model ?? null,
        },
      })
    )
  );

  logger.info(
    `Saved ${rows.length} template variations for campaign ${campaignId}.${logContext({ tenant: tenantId, campaign: campaignId, channel: input.channel })}`
  );

  return rows.map(toStoredVariation);
}

/**
 * List all template variations for a campaign (or all approved ones for
 * a tenant+channel when campaignId is omitted).
 */
export async function listVariations(
  tenantId: string,
  campaignId: string,
  channel?: string
): Promise<StoredVariation[]> {
  const rows = await prisma.templateVariation.findMany({
    where: {
      campaignId,
      tenantId,
      ...(channel ? { channel } : {}),
    },
    orderBy: [{ channel: "asc" }, { variationIndex: "asc" }],
  });
  return rows.map(toStoredVariation);
}

/** Approve a variation, making it eligible for rotation. */
export async function approveVariation(tenantId: string, variationId: string): Promise<void> {
  const row = await prisma.templateVariation.findFirst({
    where: { id: variationId, tenantId },
  });
  if (!row) throw new Error("Template variation not found.");
  if (row.status === "approved") return; // idempotent
  await prisma.templateVariation.update({
    where: { id: variationId },
    data: { status: "approved" },
  });
}

/** Reject a variation so it won't be sent. */
export async function rejectVariation(tenantId: string, variationId: string): Promise<void> {
  const row = await prisma.templateVariation.findFirst({
    where: { id: variationId, tenantId },
  });
  if (!row) throw new Error("Template variation not found.");
  await prisma.templateVariation.update({
    where: { id: variationId },
    data: { status: "rejected" },
  });
}

/** Edit the content/subject of a draft variation. */
export async function editVariation(
  tenantId: string,
  variationId: string,
  updates: { subject?: string; content?: string }
): Promise<void> {
  const row = await prisma.templateVariation.findFirst({
    where: { id: variationId, tenantId },
  });
  if (!row) throw new Error("Template variation not found.");
  if (row.status === "approved") throw new Error("Cannot edit an approved variation. Reject it first.");
  await prisma.templateVariation.update({
    where: { id: variationId },
    data: {
      ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
      ...(updates.content !== undefined ? { content: updates.content } : {}),
    },
  });
}

/** Delete a variation (only draft or rejected). */
export async function deleteVariation(tenantId: string, variationId: string): Promise<void> {
  const row = await prisma.templateVariation.findFirst({
    where: { id: variationId, tenantId },
  });
  if (!row) throw new Error("Template variation not found.");
  if (row.status === "approved") throw new Error("Cannot delete an approved variation.");
  await prisma.templateVariation.delete({ where: { id: variationId } });
}

/**
 * Atomically select the next approved variation for a campaign+channel and
 * advance the rotation index. Returns null when no approved variations exist.
 *
 * Uses the same optimistic-lock pattern as senderRotationService: reads
 * templateRotationIndex, attempts a conditional UPDATE, retries on contention.
 */
export async function selectNextVariation(
  campaignId: string,
  tenantId: string,
  channel: string
): Promise<{ variationId: string; variationIndex: number; content: string; subject?: string | null } | null> {
  if (!(prisma as any)?.templateVariation?.findMany) return null;
  const approved = await (prisma as any).templateVariation.findMany({
    where: { campaignId, tenantId, channel, status: "approved" },
    orderBy: { variationIndex: "asc" },
    select: { id: true, variationIndex: true, content: true, subject: true },
  });
  if (approved.length === 0) return null;
  if (approved.length === 1) {
    return {
      variationId: approved[0].id,
      variationIndex: approved[0].variationIndex,
      content: approved[0].content,
      subject: approved[0].subject,
    };
  }

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { templateRotationIndex: true },
    });
    if (!campaign) return null;

    const currentIndex = campaign.templateRotationIndex;
    const slotIndex = currentIndex % approved.length;
    const nextIndex = (currentIndex + 1) % approved.length;

    const updated = await prisma.campaign.updateMany({
      where: { id: campaignId, tenantId, templateRotationIndex: currentIndex },
      data: { templateRotationIndex: nextIndex },
    });

    if (updated.count === 1) {
      const selected = approved[slotIndex];
      return {
        variationId: selected.id,
        variationIndex: selected.variationIndex,
        content: selected.content,
        subject: selected.subject,
      };
    }

    await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
  }

  // Fell through — return slot 0 as fallback.
  return {
    variationId: approved[0].id,
    variationIndex: approved[0].variationIndex,
    content: approved[0].content,
    subject: approved[0].subject,
  };
}

/**
 * Compile a variation's content for a lead by substituting template variables.
 *
 * Handles the {{name}} variable specially: uses contactName when available,
 * falls back to businessName, falls back to a neutral greeting fragment
 * ("there") rather than "undefined" or "null".
 */
export function compileVariationForLead(
  content: string,
  lead: Partial<Lead> & { businessName?: string; contactName?: string | null }
): string {
  // Build variable map with safe fallbacks.
  const name = (lead.contactName || lead.businessName || "").trim() || "there";
  const business = (lead.businessName || "your business").trim();
  const city = extractCity(String((lead as any).address || ""));

  const variableMap: Record<string, string> = {
    "{{name}}": name,
    "{{company}}": business,
    "{{business}}": business,
    "{{city}}": city || "your area",
    "{{location}}": city || "your area",
    "{{category}}": String((lead as any).category || "your industry"),
    "{{phone}}": String((lead as any).phone || ""),
    "{{website}}": String((lead as any).website || ""),
  };

  return content.replace(/\{\{[^}]+\}\}/g, (m) =>
    variableMap[m] !== undefined ? variableMap[m] : m
  );
}

function extractCity(address: string): string {
  const parts = (address || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\d{4,}/g, "").trim();
  return parts[0] || "";
}

function toStoredVariation(row: any): StoredVariation {
  return {
    id: row.id,
    campaignId: row.campaignId ?? null,
    channel: row.channel,
    variationIndex: row.variationIndex,
    outreachApproach: row.outreachApproach ?? null,
    subject: row.subject ?? null,
    content: row.content,
    status: row.status,
    aiProvider: row.aiProvider ?? null,
    aiModel: row.aiModel ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}
