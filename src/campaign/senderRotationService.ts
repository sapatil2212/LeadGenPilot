/**
 * Sender Rotation Service
 *
 * Provides concurrency-safe, DB-persisted sender selection for campaigns with
 * multiple WhatsApp or SMTP sender accounts.
 *
 * ## Architecture
 *
 * Multiple sender accounts are stored as UserIntegration rows with typed labels:
 *   - WhatsApp senders: type "whatsapp" (primary) or "whatsapp_N" (extra slots 2–5)
 *   - Email senders:    type "smtp" (primary) or "smtp_N" (extra slots 2–5)
 *
 * Rotation state is persisted on Campaign.senderRotationIndex using an atomic
 * conditional UPDATE so concurrent workers cannot select the same sender index
 * simultaneously. The selected sender's integration ID is stored on
 * CampaignMessage.selectedSenderId so retries always reuse the original sender.
 *
 * ## Sender Types Convention
 *
 * Slot 1 (primary):  "whatsapp" / "smtp"
 * Slot 2:            "whatsapp_2" / "smtp_2"
 * Slot 3:            "whatsapp_3" / "smtp_3"
 * Slot 4:            "whatsapp_4" / "smtp_4"
 * Slot 5:            "whatsapp_5" / "smtp_5"
 *
 * This preserves 100% backward compatibility: campaigns with a single sender
 * continue working because the primary integration type is unchanged.
 */

import { prisma } from "../prisma";
import { logger, logContext } from "../logger";
import crypto from "node:crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-32-char-encryption-key!!";
const ALGORITHM = "aes-256-cbc";

export type SenderChannel = "whatsapp" | "email";

export interface SenderIntegration {
  id: string;
  type: string;
  label: string | null;
  slot: number; // 1-5
  enabled: boolean;
}

export interface ResolvedSender {
  integrationId: string;
  type: string;
  slot: number;
  config: Record<string, unknown>;
}

/** The integration types used for WhatsApp senders in slot order. */
const WHATSAPP_SENDER_TYPES = [
  "whatsapp",
  "whatsapp_2",
  "whatsapp_3",
  "whatsapp_4",
  "whatsapp_5",
] as const;

/** The integration types used for SMTP senders in slot order. */
const SMTP_SENDER_TYPES = [
  "smtp",
  "smtp_2",
  "smtp_3",
  "smtp_4",
  "smtp_5",
] as const;

/** Maximum senders per channel per tenant. */
export const MAX_SENDERS = 5;

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function senderTypesFor(channel: SenderChannel): readonly string[] {
  return channel === "whatsapp" ? WHATSAPP_SENDER_TYPES : SMTP_SENDER_TYPES;
}

/**
 * Fetch all enabled sender integrations for a tenant on a given channel,
 * ordered by slot (1-5). Returns only enabled rows.
 */
export async function getEnabledSenders(
  tenantId: string,
  channel: SenderChannel
): Promise<SenderIntegration[]> {
  const types = senderTypesFor(channel);
  if (!(prisma as any)?.userIntegration?.findMany) {
    return [];
  }
  const rows = await (prisma as any).userIntegration.findMany({
    where: { tenantId, type: { in: types as string[] }, enabled: true },
    select: { id: true, type: true, label: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row: any) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    slot: (types as readonly string[]).indexOf(row.type) + 1,
    enabled: row.enabled,
  })).sort((a: any, b: any) => a.slot - b.slot);
}

/**
 * Atomically select the next sender for a campaign and advance the rotation
 * index. Returns null when no eligible senders are configured.
 *
 * Uses a conditional UPDATE on Campaign.senderRotationIndex so that two
 * concurrent workers cannot select the same index. The optimistic-lock loop
 * retries on contention, bounded by MAX_RETRIES.
 */
export async function selectNextSender(
  campaignId: string,
  tenantId: string,
  channel: SenderChannel
): Promise<{ integrationId: string; slot: number } | null> {
  const senders = await getEnabledSenders(tenantId, channel);
  if (senders.length === 0) return null;
  if (senders.length === 1) return { integrationId: senders[0].id, slot: senders[0].slot };

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { senderRotationIndex: true },
    });
    if (!campaign) return null;

    const currentIndex = campaign.senderRotationIndex;
    const senderIndex = currentIndex % senders.length;
    const nextIndex = (currentIndex + 1) % senders.length;

    // Conditional update: only succeeds if senderRotationIndex hasn't changed.
    const updated = await prisma.campaign.updateMany({
      where: { id: campaignId, tenantId, senderRotationIndex: currentIndex },
      data: { senderRotationIndex: nextIndex },
    });

    if (updated.count === 1) {
      const selected = senders[senderIndex];
      logger.info(
        `Sender rotation: slot ${selected.slot} (${selected.type}) selected for campaign ${campaignId}.${logContext({ tenant: tenantId, campaign: campaignId, slot: selected.slot })}`
      );
      return { integrationId: selected.id, slot: selected.slot };
    }
    // Another worker advanced the index; retry with the new value.
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
  }

  // Fell through after too many contentions — fall back to slot 1.
  logger.warn(`Sender rotation contention: fell back to slot 1 for campaign ${campaignId}.`);
  return { integrationId: senders[0].id, slot: senders[0].slot };
}

/**
 * Resolve the full decrypted configuration for a sender integration by its ID.
 * Returns null if the integration is missing or the config is undecryptable.
 */
export async function resolveSenderConfig(
  integrationId: string,
  tenantId: string
): Promise<Record<string, unknown> | null> {
  if (!(prisma as any)?.userIntegration?.findFirst) {
    return null;
  }
  const row = await (prisma as any).userIntegration.findFirst({
    where: { id: integrationId, tenantId, enabled: true },
    select: { config: true, type: true },
  });
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.config)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Determine the effective sender for a campaign message.
 *
 * Priority:
 *   1. selectedSenderId already on the message (retry path — reuse same sender).
 *   2. Rotate among enabled senders for this campaign+channel.
 *   3. Fall back to the primary integration (type "whatsapp" or "smtp").
 */
export async function determineMessageSender(
  campaignId: string,
  tenantId: string,
  channel: SenderChannel,
  alreadySelectedId?: string | null
): Promise<{ integrationId: string; config: Record<string, unknown>; slot: number } | null> {
  // Retry path: reuse the sender already committed to this message.
  if (alreadySelectedId) {
    const config = await resolveSenderConfig(alreadySelectedId, tenantId);
    if (config) {
      const slot = await slotForIntegrationId(alreadySelectedId, tenantId);
      return { integrationId: alreadySelectedId, config, slot };
    }
    // The sender was removed or disabled — fall through to rotation.
    logger.warn(`Previously selected sender ${alreadySelectedId} is no longer available; re-rotating.`);
  }

  const selected = await selectNextSender(campaignId, tenantId, channel);
  if (selected) {
    const config = await resolveSenderConfig(selected.integrationId, tenantId);
    if (config) return { integrationId: selected.integrationId, config, slot: selected.slot };
  }

  // Nothing from rotation — try the primary integration directly.
  const primaryType = channel === "whatsapp" ? "whatsapp" : "smtp";
  if (!(prisma as any)?.userIntegration?.findFirst) {
    return null;
  }
  const primary = await (prisma as any).userIntegration.findFirst({
    where: { tenantId, type: primaryType, enabled: true },
    select: { id: true, config: true },
  });
  if (!primary) return null;
  try {
    const config = JSON.parse(decrypt(primary.config)) as Record<string, unknown>;
    return { integrationId: primary.id, config, slot: 1 };
  } catch {
    return null;
  }
}

/** Resolve the 1-based slot for a sender integration by its ID. Defaults to 1. */
async function slotForIntegrationId(integrationId: string, tenantId: string): Promise<number> {
  if (!(prisma as any)?.userIntegration?.findFirst) return 1;
  const row = await (prisma as any).userIntegration.findFirst({
    where: { id: integrationId, tenantId },
    select: { type: true },
  });
  return row ? slotForSenderType(row.type) : 1;
}

/**
 * List all sender integrations for a tenant/channel (for the settings UI).
 * Does NOT decrypt credentials.
 */
export async function listSenderIntegrations(
  tenantId: string,
  channel: SenderChannel
): Promise<Array<{ id: string; type: string; label: string | null; slot: number; enabled: boolean }>> {
  const types = senderTypesFor(channel);
  if (!(prisma as any)?.userIntegration?.findMany) {
    return [];
  }
  const rows = await (prisma as any).userIntegration.findMany({
    where: { tenantId, type: { in: types as string[] } },
    select: { id: true, type: true, label: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row: any) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    slot: (types as readonly string[]).indexOf(row.type) + 1,
    enabled: row.enabled,
  })).sort((a: any, b: any) => a.slot - b.slot);
}

/**
 * Get the next available slot number for adding a new sender of a channel.
 * Returns null when all 5 slots are occupied.
 */
export function nextAvailableSlot(
  existingTypes: string[],
  channel: SenderChannel
): number | null {
  const types = senderTypesFor(channel);
  for (let i = 0; i < types.length; i++) {
    if (!existingTypes.includes(types[i])) return i + 1;
  }
  return null;
}

/** The integration type string for a given channel and 1-based slot. */
export function senderTypeForSlot(channel: SenderChannel, slot: number): string {
  const types = senderTypesFor(channel);
  if (slot < 1 || slot > types.length) throw new Error(`Slot must be 1-${types.length}.`);
  return types[slot - 1];
}

/**
 * The 1-based slot number for a given sender integration type. Returns 1 for
 * the primary types ("whatsapp" / "smtp") and the matching slot for the
 * numbered extras ("whatsapp_3" -> 3). Returns 1 for anything unrecognized so
 * sending always degrades to the primary account rather than failing.
 */
export function slotForSenderType(type: string): number {
  const idxWhatsapp = (WHATSAPP_SENDER_TYPES as readonly string[]).indexOf(type);
  if (idxWhatsapp >= 0) return idxWhatsapp + 1;
  const idxSmtp = (SMTP_SENDER_TYPES as readonly string[]).indexOf(type);
  if (idxSmtp >= 0) return idxSmtp + 1;
  return 1;
}
