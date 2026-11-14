/**
 * MessageTemplate service — tenant-scoped CRUD, validation and lifecycle.
 *
 * Mirrors the existing templateService pattern: untrusted input → normalise →
 * persist as a validated JSON payload. The Prisma row carries indexed metadata
 * (name, category, channel, status), while the component-rich builder schema
 * lives in the `payload` LongText column and is never queried inside SQL.
 */

import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";
import type {
  MessageTemplatePayload,
  MessageTemplateView,
  TemplateCategory,
  TemplateStatus,
  DeliveryMethod,
  TemplateHeader,
  TemplateBody,
  TemplateFooter,
  TemplateAction,
  TemplateQuickReply,
  TemplateVariable,
  TemplateSettings,
} from "./types";
import {
  TEMPLATE_CATEGORIES,
  WHATSAPP_BODY_MAX_CHARS,
  HEADER_TEXT_MAX_CHARS,
  FOOTER_TEXT_MAX_CHARS,
  ACTION_LABEL_MAX_CHARS,
  QUICK_REPLY_MAX_CHARS,
} from "./types";
import { validateForSave, hasErrors } from "./validation";

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class MessageTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageTemplateValidationError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload normalisation (untrusted input → clean persisted shape)
// ─────────────────────────────────────────────────────────────────────────────

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function normalizeHeader(raw: any): TemplateHeader {
  if (!raw || typeof raw !== "object") return { type: "none" };
  const type = ["none", "text", "image", "video", "document"].includes(raw.type)
    ? raw.type
    : "none";
  return {
    type,
    text: type === "text" ? str(raw.text, HEADER_TEXT_MAX_CHARS) : undefined,
    mediaUrl: type !== "none" && type !== "text" ? str(raw.mediaUrl, 5000) : undefined,
    mediaCaption: str(raw.mediaCaption, 300) || undefined,
    mediaFileName: str(raw.mediaFileName, 200) || undefined,
    mediaMimeType: str(raw.mediaMimeType, 100) || undefined,
  };
}

function normalizeBody(raw: any): TemplateBody {
  return {
    text: str(raw?.text, WHATSAPP_BODY_MAX_CHARS),
  };
}

function normalizeFooter(raw: any): TemplateFooter {
  return {
    enabled: Boolean(raw?.enabled),
    text: str(raw?.text, FOOTER_TEXT_MAX_CHARS),
  };
}

function normalizeAction(raw: any): TemplateAction | null {
  if (!raw || typeof raw !== "object") return null;
  const type = ["url", "phone", "whatsapp_link", "custom_url"].includes(raw.type) ? raw.type : "url";
  const label = str(raw.label, ACTION_LABEL_MAX_CHARS);
  const value = str(raw.value, 2000);
  if (!label && !value) return null;
  return {
    id: str(raw.id, 50) || crypto.randomUUID().slice(0, 8),
    type,
    label,
    value,
  };
}

function normalizeQuickReply(raw: any): TemplateQuickReply | null {
  if (!raw || typeof raw !== "object") return null;
  const display = str(raw.display, QUICK_REPLY_MAX_CHARS);
  if (!display) return null;
  return {
    id: str(raw.id, 50) || crypto.randomUUID().slice(0, 8),
    display,
    payload: str(raw.payload, 50) || display.toUpperCase().replace(/\s+/g, "_"),
  };
}

function normalizeVariable(raw: any): TemplateVariable | null {
  if (!raw || typeof raw !== "object") return null;
  const key = str(raw.key, 50).replace(/[^a-zA-Z0-9_]/g, "");
  if (!key) return null;
  return {
    key,
    label: str(raw.label, 100) || key.replace(/_/g, " "),
    sampleValue: str(raw.sampleValue, 500) || key,
    isCustom: Boolean(raw.isCustom),
  };
}

function normalizeSettings(raw: any): TemplateSettings {
  return {
    deliveryMethod: raw?.deliveryMethod === "cloud_api" ? "cloud_api" : "web",
    personalization: Boolean(raw?.personalization),
  };
}

import crypto from "node:crypto";

/**
 * Validate and normalise untrusted input into a clean payload. Throws
 * MessageTemplateValidationError if the payload has blocking issues.
 */
export function normalizePayload(input: unknown): MessageTemplatePayload {
  if (!input || typeof input !== "object") {
    throw new MessageTemplateValidationError("A template payload object is required.");
  }
  const raw = input as Record<string, unknown>;

  const payload: MessageTemplatePayload = {
    header: normalizeHeader(raw.header),
    body: normalizeBody(raw.body),
    footer: normalizeFooter(raw.footer),
    actions: Array.isArray(raw.actions)
      ? raw.actions.map(normalizeAction).filter(Boolean) as TemplateAction[]
      : [],
    quickReplies: Array.isArray(raw.quickReplies)
      ? raw.quickReplies.map(normalizeQuickReply).filter(Boolean) as TemplateQuickReply[]
      : [],
    variables: Array.isArray(raw.variables)
      ? raw.variables.map(normalizeVariable).filter(Boolean) as TemplateVariable[]
      : [],
    settings: normalizeSettings(raw.settings),
  };

  // Run structural validation and throw if there are errors.
  const issues = validateForSave(payload);
  if (hasErrors(issues)) {
    const first = issues.find((i) => i.severity === "error");
    throw new MessageTemplateValidationError(first?.message || "Template has validation errors.");
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t: unknown) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseRow(row: any): MessageTemplateView {
  let payload: MessageTemplatePayload;
  try {
    payload = normalizePayload(JSON.parse(row.payload));
  } catch {
    // Fallback: return a minimal valid payload so a corrupted row doesn't
    // crash the list endpoint.
    payload = {
      header: { type: "none" },
      body: { text: "(template content could not be loaded)" },
      footer: { enabled: false, text: "" },
      actions: [],
      quickReplies: [],
      variables: [],
      settings: { deliveryMethod: "web", personalization: false },
    };
  }

  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? null,
    category: (TEMPLATE_CATEGORIES.includes(row.category) ? row.category : "custom") as TemplateCategory,
    language: row.language || "en",
    channel: row.channel || "whatsapp",
    deliveryMethod: (row.deliveryMethod === "cloud_api" ? "cloud_api" : "web") as DeliveryMethod,
    tags: parseTags(row.tags),
    payload,
    status: (["draft", "active", "archived"].includes(row.status) ? row.status : "draft") as TemplateStatus,
    version: row.version || 1,
    usageCount: row.usageCount || 0,
    isPrebuilt: Boolean(row.isPrebuilt),
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFilters {
  category?: string;
  channel?: string;
  deliveryMethod?: string;
  status?: string;
  language?: string;
  search?: string;
  tags?: string[];
  isPrebuilt?: boolean;
}

export async function listMessageTemplates(
  ctx: TenantContext,
  filters: ListFilters = {}
): Promise<MessageTemplateView[]> {
  const where: any = {
    tenantId: ctx.tenantId,
    status: filters.status || { not: "archived" },
  };
  if (filters.category) where.category = filters.category;
  if (filters.channel) where.channel = filters.channel;
  if (filters.deliveryMethod) where.deliveryMethod = filters.deliveryMethod;
  if (filters.language) where.language = filters.language;
  if (filters.isPrebuilt !== undefined) where.isPrebuilt = filters.isPrebuilt;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search } },
      { description: { contains: filters.search } },
    ];
  }

  const rows = await prisma.messageTemplate.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(parseRow);
}

export async function getMessageTemplate(
  ctx: TenantContext,
  id: string
): Promise<MessageTemplateView | null> {
  const row = await prisma.messageTemplate.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  return row ? parseRow(row) : null;
}

export interface CreateInput {
  name: string;
  description?: string;
  category?: string;
  language?: string;
  channel?: string;
  deliveryMethod?: string;
  tags?: string[];
  payload: unknown;
  status?: string;
}

export async function createMessageTemplate(
  ctx: TenantContext,
  input: CreateInput
): Promise<MessageTemplateView> {
  const name = str(input.name, 200);
  if (!name) throw new MessageTemplateValidationError("Template name is required.");

  const payload = normalizePayload(input.payload);
  const category = TEMPLATE_CATEGORIES.includes(input.category as any)
    ? input.category!
    : "custom";

  const row = await prisma.messageTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      name,
      description: input.description ? str(input.description, 2000) : null,
      category,
      language: str(input.language || "en", 10),
      channel: str(input.channel || "whatsapp", 30),
      deliveryMethod: input.deliveryMethod === "cloud_api" ? "cloud_api" : "web",
      tags: Array.isArray(input.tags) ? JSON.stringify(input.tags.slice(0, 20)) : null,
      payload: JSON.stringify(payload),
      status: input.status === "active" ? "active" : "draft",
      createdById: ctx.userId,
      updatedById: ctx.userId,
    },
  });

  return parseRow(row);
}

export async function updateMessageTemplate(
  ctx: TenantContext,
  id: string,
  input: Partial<CreateInput> & { saveAsNewVersion?: boolean }
): Promise<MessageTemplateView | null> {
  const existing = await prisma.messageTemplate.findFirst({
    where: { id, tenantId: ctx.tenantId, status: { not: "archived" } },
  });
  if (!existing) return null;

  const payload = input.payload !== undefined
    ? normalizePayload(input.payload)
    : undefined;
  const name = input.name !== undefined ? str(input.name, 200) : undefined;
  if (name !== undefined && !name) {
    throw new MessageTemplateValidationError("Template name cannot be empty.");
  }

  const data: any = {
    updatedById: ctx.userId,
  };
  if (name !== undefined) data.name = name;
  if (input.description !== undefined) data.description = str(input.description, 2000) || null;
  if (input.category && TEMPLATE_CATEGORIES.includes(input.category as any)) {
    data.category = input.category;
  }
  if (input.language !== undefined) data.language = str(input.language, 10);
  if (input.deliveryMethod !== undefined) {
    data.deliveryMethod = input.deliveryMethod === "cloud_api" ? "cloud_api" : "web";
  }
  if (input.tags !== undefined) {
    data.tags = Array.isArray(input.tags) ? JSON.stringify(input.tags.slice(0, 20)) : null;
  }
  if (payload !== undefined) data.payload = JSON.stringify(payload);
  if (input.status && ["draft", "active", "archived"].includes(input.status)) {
    data.status = input.status;
  }

  // Version bump: always increment on payload changes, or on explicit request.
  if (payload !== undefined || input.saveAsNewVersion) {
    data.version = { increment: 1 };
  }

  const row = await prisma.messageTemplate.update({
    where: { id: existing.id },
    data,
  });

  return parseRow(row);
}

export async function deleteMessageTemplate(
  ctx: TenantContext,
  id: string
): Promise<boolean> {
  const result = await prisma.messageTemplate.updateMany({
    where: { id, tenantId: ctx.tenantId, status: { not: "archived" } },
    data: { status: "archived", updatedById: ctx.userId },
  });
  return result.count === 1;
}

export async function duplicateMessageTemplate(
  ctx: TenantContext,
  id: string,
  overrides?: { name?: string; language?: string }
): Promise<MessageTemplateView | null> {
  const source = await getMessageTemplate(ctx, id);
  if (!source) return null;

  return createMessageTemplate(ctx, {
    name: overrides?.name || `${source.name} (Copy)`,
    description: source.description || undefined,
    category: source.category,
    language: overrides?.language || source.language,
    channel: source.channel,
    deliveryMethod: source.deliveryMethod,
    tags: source.tags,
    payload: source.payload,
    status: "draft",
  });
}

export async function incrementUsageCount(
  tenantId: string,
  id: string
): Promise<void> {
  await prisma.messageTemplate.updateMany({
    where: { id, tenantId },
    data: { usageCount: { increment: 1 } },
  }).catch(() => {});
}
