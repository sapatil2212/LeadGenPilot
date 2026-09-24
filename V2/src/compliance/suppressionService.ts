/**
 * Tenant suppression list (opt-out / unsubscribe compliance).
 *
 * A suppression is the record of a person telling one workspace to stop
 * contacting them on one channel. Three properties matter and are enforced here
 * rather than at the call sites:
 *
 *  - Tenant scoped. An opt-out belongs to the workspace that was contacting the
 *    person. Sharing it across workspaces would leak audience data.
 *  - Channel scoped. Unsubscribing from email does not consent-strip WhatsApp.
 *  - Idempotent. Replying "STOP" three times is one suppression, not three.
 *
 * Contacts are matched on a canonical key (lowercased email, digits-only phone)
 * so "+1 (555) 010-2030" and "15550102030" are the same person.
 */
import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";

export type SuppressionChannel = "email" | "whatsapp";

export interface SuppressionRecord {
  id: string;
  channel: SuppressionChannel;
  contactKey: string;
  reason: string;
  source?: string;
  notes?: string;
  createdAt: string;
}

export interface SuppressInput {
  tenantId: string;
  channel: SuppressionChannel;
  contact: string;
  reason?: string;
  source?: string;
  notes?: string;
}

/**
 * Opt-out detection is split in two because the words differ in how ambiguous
 * they are.
 *
 * Phrases like "unsubscribe" or "do not contact" only ever mean one thing, so
 * they count anywhere in a short reply. A bare "stop" does not: "can you stop by
 * on Tuesday?" is a warm lead, and suppressing them would be an expensive false
 * positive. Single-word commands therefore only count when the command is
 * essentially the entire message.
 */
const UNAMBIGUOUS_OPT_OUT =
  /(unsubscribe|\bunsub\b|opt[\s-]?out|remove me|delete me|do ?n[o']?t (contact|message|email)|stop (sending|messaging|emailing|contacting)|no more (messages|emails)|take me off|leave me alone)/i;

const BARE_OPT_OUT_COMMAND = /^(stop|stopall|unsubscribe|unsub|optout|remove|quit)$/;

/** Words that only soften a command and should not stop it being recognised. */
const COMMAND_FILLER = /\b(please|pls|plz|thanks|thank you|kindly|now|immediately|asap|me|us|all|this|these|any|more|messages|message|emails|email|from your list|list)\b/g;

function normalizeCommand(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(COMMAND_FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalSuppressionKey(channel: SuppressionChannel, contact: string): string {
  const value = String(contact || "").trim();
  if (!value) return "";
  if (channel === "email") return value.toLowerCase();
  return value.replace(/[^0-9]/g, "");
}

/** True when an inbound message is an opt-out request. */
export function isOptOutMessage(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  // Only short messages are treated as commands. A long email that happens to
  // contain the word "unsubscribe" in a quoted footer is not a request.
  if (raw.length > 160) return false;
  if (UNAMBIGUOUS_OPT_OUT.test(raw)) return true;
  return BARE_OPT_OUT_COMMAND.test(normalizeCommand(raw));
}

function toRecord(row: any): SuppressionRecord {
  return {
    id: row.id,
    channel: row.channel as SuppressionChannel,
    contactKey: row.contactKey,
    reason: row.reason,
    ...(row.source ? { source: row.source } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Add or refresh a suppression. Safe to call repeatedly for the same contact. */
export async function suppressContact(input: SuppressInput): Promise<SuppressionRecord> {
  // Channel first: an unknown channel makes the contact key meaningless, so
  // validating it afterwards would report the wrong problem.
  if (input.channel !== "email" && input.channel !== "whatsapp") {
    throw new Error("Suppression channel must be email or whatsapp.");
  }
  const contactKey = canonicalSuppressionKey(input.channel, input.contact);
  if (!contactKey) throw new Error("A contact email or phone number is required to suppress.");
  const data = {
    reason: input.reason || "manual",
    source: input.source ?? null,
    notes: input.notes ? input.notes.slice(0, 1_000) : null,
  };
  const row = await prisma.suppressionEntry.upsert({
    where: {
      tenantId_channel_contactKey: { tenantId: input.tenantId, channel: input.channel, contactKey },
    },
    create: { tenantId: input.tenantId, channel: input.channel, contactKey, ...data },
    update: data,
  });
  return toRecord(row);
}

/** True when this workspace must not contact this address/number on this channel. */
export async function isSuppressed(tenantId: string, channel: SuppressionChannel, contact: string): Promise<boolean> {
  const contactKey = canonicalSuppressionKey(channel, contact);
  if (!contactKey) return false;
  const existing = await prisma.suppressionEntry.findFirst({
    where: { tenantId, channel, contactKey },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Bulk membership test used by campaign generation, so building an audience of
 * 5,000 leads does not issue 5,000 queries.
 */
export async function filterSuppressed(
  tenantId: string,
  channel: SuppressionChannel,
  contacts: string[]
): Promise<Set<string>> {
  const keys = Array.from(
    new Set(contacts.map((contact) => canonicalSuppressionKey(channel, contact)).filter(Boolean))
  );
  if (keys.length === 0) return new Set();
  const rows = await prisma.suppressionEntry.findMany({
    where: { tenantId, channel, contactKey: { in: keys } },
    select: { contactKey: true },
  });
  return new Set(rows.map((row: any) => row.contactKey));
}

export async function listSuppressions(
  ctx: TenantContext,
  options: { channel?: SuppressionChannel; search?: string; page?: number; pageSize?: number } = {}
): Promise<{ records: SuppressionRecord[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize) || 50));
  const where: Record<string, unknown> = { tenantId: ctx.tenantId };
  if (options.channel === "email" || options.channel === "whatsapp") where.channel = options.channel;
  const search = String(options.search || "").trim().toLowerCase();
  if (search) where.contactKey = { contains: search };
  const [rows, total] = await Promise.all([
    prisma.suppressionEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.suppressionEntry.count({ where }),
  ]);
  return { records: rows.map(toRecord), total, page, pageSize };
}

/** Remove a suppression (an explicit, audited re-opt-in). */
export async function removeSuppression(
  ctx: TenantContext,
  channel: SuppressionChannel,
  contact: string
): Promise<boolean> {
  const contactKey = canonicalSuppressionKey(channel, contact);
  if (!contactKey) return false;
  const result = await prisma.suppressionEntry.deleteMany({
    where: { tenantId: ctx.tenantId, channel, contactKey },
  });
  return result.count > 0;
}

/**
 * Record an opt-out observed in an inbound reply. Returns the suppression when
 * one was created, or null when the message was ordinary conversation.
 */
export async function suppressFromInboundReply(params: {
  tenantId: string;
  channel: SuppressionChannel;
  contact: string;
  text: string;
  source?: string;
}): Promise<SuppressionRecord | null> {
  if (!isOptOutMessage(params.text)) return null;
  return suppressContact({
    tenantId: params.tenantId,
    channel: params.channel,
    contact: params.contact,
    reason: "opt_out_reply",
    source: params.source || `inbound_${params.channel}`,
    notes: params.text,
  });
}
