/**
 * Tenant-owned outreach-template persistence and safe compilation inputs.
 *
 * Template records store only a validated builder payload. Arbitrary HTML/code
 * is intentionally not persisted: campaign messages are compiled server-side
 * from bounded plain-text sections and then snapshotted for human review.
 */

import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";
import type { OutreachTemplate } from "../outreachTemplates";

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

export interface TemplateView extends OutreachTemplate {
  version: number;
  updatedAt: string;
}

const ALLOWED_PLACEHOLDERS = new Set([
  "{{company}}",
  "{{business}}",
  "{{city}}",
  "{{location}}",
  "{{category}}",
  "{{phone}}",
  "{{website}}",
]);

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\{\{[^}]+\}\}/g, (token) =>
      token === "{{name}}"
        ? "{{company}} team"
        : ALLOWED_PLACEHOLDERS.has(token)
          ? token
          : ""
    )
    .trim()
    .slice(0, max);
}

function trimWords(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? value : words.slice(0, maxWords).join(" ");
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#4f46e5";
}

/** Validate untrusted browser/import input and return the only persisted shape. */
export function normalizeTemplate(input: unknown): Omit<OutreachTemplate, "id" | "createdAt"> {
  if (!input || typeof input !== "object") {
    throw new TemplateValidationError("A template object is required.");
  }
  const raw = input as Record<string, unknown>;
  if (raw.designMode === "code") {
    throw new TemplateValidationError(
      "Code-mode templates cannot be imported or saved. Recreate this template in the safe builder."
    );
  }
  const templateType = raw.templateType === "whatsapp" ? "whatsapp" : "email";
  const name = cleanText(raw.name, 120);
  if (!name) throw new TemplateValidationError("Template name is required.");

  const useAiBody = raw.useAiBody === true;
  const useCta = raw.useCta === true;
  const useContact = raw.useContact === true;
  const useFooter = raw.useFooter === true;
  const introText = trimWords(cleanText(raw.introText, 600), templateType === "whatsapp" ? 20 : 60);
  const ctaText = useCta ? trimWords(cleanText(raw.ctaText, 120), 12) : "";
  const ctaUrl = useCta ? safeUrl(raw.ctaUrl) : "";
  const contactText = useContact ? trimWords(cleanText(raw.contactText, 500), 20) : "";
  const footerText = useFooter ? trimWords(cleanText(raw.footerText, 500), 20) : "";

  // The channel limits apply to the assembled message, not just its body.
  const fixedWhatsappWords = templateType === "whatsapp"
    ? [introText, ctaText, ctaUrl, contactText, footerText]
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length
    : 0;
  const bodyWordLimit = templateType === "whatsapp"
    ? Math.max(1, 120 - fixedWhatsappWords)
    : 220;
  const customBodyText = trimWords(cleanText(raw.customBodyText, 5_000), bodyWordLimit);
  
  // If AI dynamic body is not selected, require either customBodyText or introText
  if (!useAiBody && !customBodyText && !introText) {
    throw new TemplateValidationError("Add template body text or intro message before saving.");
  }

  const useLogo = raw.useLogo === true;
  const logoType = raw.logoType === "image" ? "image" : "text";
  let logoValue = "";
  if (useLogo) {
    if (logoType === "image" && typeof raw.logoValue === "string") {
      const trimmed = raw.logoValue.trim();
      if (trimmed.startsWith("data:image/")) {
        // Base64 data URL for local machine uploads (allow up to 3MB)
        logoValue = trimmed.slice(0, 3_000_000);
      } else {
        logoValue = cleanText(trimmed, 2000);
      }
    } else {
      logoValue = cleanText(raw.logoValue, 200);
    }
  }

  const textAlign = raw.textAlign === "center" ? "center" : raw.textAlign === "right" ? "right" : "left";

  return {
    name,
    templateType,
    subject: templateType === "email" ? cleanText(raw.subject, 120) : "",
    designMode: "builder",
    htmlCode: "",
    useLogo,
    logoType,
    logoValue,
    textAlign,
    introText,
    useAiBody,
    customBodyText,
    useCta,
    ctaText,
    ctaUrl,
    ctaBgColor: safeColor(raw.ctaBgColor),
    useContact,
    contactText,
    useFooter,
    footerText,
  };
}

function parseRow(row: any): TemplateView {
  let payload: unknown = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    throw new TemplateValidationError(`Stored template ${row.id} has invalid content.`);
  }
  const normalized = normalizeTemplate({
    ...(payload as object),
    name: row.name,
    templateType: row.channel,
  });
  return {
    id: row.id,
    ...normalized,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    version: row.version,
  };
}

export async function listTemplates(
  ctx: TenantContext,
  channel?: string
): Promise<TemplateView[]> {
  const rows = await prisma.outreachTemplate.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: "active",
      ...(channel === "email" || channel === "whatsapp" ? { channel } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(parseRow);
}

export async function getTemplate(
  ctx: TenantContext,
  templateId: string
): Promise<TemplateView | null> {
  const row = await prisma.outreachTemplate.findFirst({
    where: { id: templateId, tenantId: ctx.tenantId, status: "active" },
  });
  return row ? parseRow(row) : null;
}

export async function createTemplate(
  ctx: TenantContext,
  input: unknown
): Promise<TemplateView> {
  const template = normalizeTemplate(input);
  const row = await prisma.outreachTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      name: template.name,
      channel: template.templateType,
      payload: JSON.stringify(template),
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
  });
  return parseRow(row);
}

export async function updateTemplate(
  ctx: TenantContext,
  templateId: string,
  input: unknown
): Promise<TemplateView | null> {
  const owned = await prisma.outreachTemplate.findFirst({
    where: { id: templateId, tenantId: ctx.tenantId, status: "active" },
    select: { id: true },
  });
  if (!owned) return null;

  const template = normalizeTemplate(input);
  const row = await prisma.outreachTemplate.update({
    where: { id: owned.id },
    data: {
      name: template.name,
      channel: template.templateType,
      payload: JSON.stringify(template),
      updatedById: ctx.userId,
      version: { increment: 1 },
    },
  });
  return parseRow(row);
}

export async function deleteTemplate(
  ctx: TenantContext,
  templateId: string
): Promise<boolean> {
  const result = await prisma.outreachTemplate.updateMany({
    where: { id: templateId, tenantId: ctx.tenantId, status: "active" },
    data: { status: "archived", updatedById: ctx.userId, version: { increment: 1 } },
  });
  return result.count === 1;
}

/** Explicitly claim legacy browser records for the selected workspace. */
export async function importTemplates(
  ctx: TenantContext,
  inputs: unknown
): Promise<TemplateView[]> {
  if (!Array.isArray(inputs)) throw new TemplateValidationError("Templates must be an array.");
  if (inputs.length > 500) throw new TemplateValidationError("Import at most 500 templates at once.");

  // Validate the whole batch before the first write, then commit all creates in
  // one transaction. A malformed later record can never leave a partial prefix.
  const templates = inputs.map(normalizeTemplate);
  const rows = await prisma.$transaction(
    templates.map((template) =>
      prisma.outreachTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          name: template.name,
          channel: template.templateType,
          payload: JSON.stringify(template),
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      })
    )
  );
  return rows.map(parseRow);
}

export async function resolveTemplateSelection(
  ctx: TenantContext,
  ids: { email?: string; whatsapp?: string } | undefined
): Promise<{ email: TemplateView | null; whatsapp: TemplateView | null }> {
  const [email, whatsapp] = await Promise.all([
    ids?.email ? getTemplate(ctx, ids.email) : Promise.resolve(null),
    ids?.whatsapp ? getTemplate(ctx, ids.whatsapp) : Promise.resolve(null),
  ]);

  if (ids?.email && (!email || email.templateType !== "email")) {
    throw new TemplateValidationError("The selected email template was not found in this workspace.");
  }
  if (ids?.whatsapp && (!whatsapp || whatsapp.templateType !== "whatsapp")) {
    throw new TemplateValidationError("The selected WhatsApp template was not found in this workspace.");
  }
  return { email, whatsapp };
}
