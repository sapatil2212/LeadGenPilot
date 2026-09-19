import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";

export type ConversationChannel = "email" | "whatsapp";
export type ConversationStatus = "AWAITING_REPLY" | "REPLIED" | "CLOSED";
export type ConversationDirection = "in" | "out";

export interface ConversationMessageView {
  id: string;
  direction: ConversationDirection;
  channel: ConversationChannel;
  text: string;
  timestamp: string;
}

export interface ConversationView {
  id: string;
  leadId?: string;
  businessName: string;
  phone?: string;
  email?: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  messages: ConversationMessageView[];
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
  createdAt: string;
}

export interface RecordConversationInput {
  tenantId: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  text: string;
  phone?: string | null;
  email?: string | null;
  leadId?: string | null;
  businessName?: string | null;
  occurredAt?: Date;
  source?: string;
  provider?: string;
  providerMessageId?: string;
}

function canonicalContactKey(channel: ConversationChannel, phone?: string | null, email?: string | null): string {
  if (channel === "email") return String(email || "").trim().toLowerCase();
  return String(phone || "").replace(/[^0-9]/g, "");
}

function preview(text: string): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized;
}

function assertInput(input: RecordConversationInput): string {
  const key = canonicalContactKey(input.channel, input.phone, input.email);
  if (!key) throw new Error(`A ${input.channel === "email" ? "recipient email" : "recipient phone"} is required.`);
  if (!String(input.text || "").trim()) throw new Error("Conversation text is required.");
  return key;
}

function toView(thread: any): ConversationView {
  return {
    id: thread.id,
    ...(thread.leadId ? { leadId: thread.leadId } : {}),
    businessName: thread.businessName,
    ...(thread.phone ? { phone: thread.phone } : {}),
    ...(thread.email ? { email: thread.email } : {}),
    channel: thread.channel as ConversationChannel,
    status: thread.status as ConversationStatus,
    messages: (thread.messages ?? []).map((message: any) => ({
      id: message.id,
      direction: message.direction as ConversationDirection,
      channel: message.channel as ConversationChannel,
      text: message.text,
      timestamp: message.occurredAt.toISOString(),
    })),
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastMessagePreview: thread.lastMessagePreview,
    unread: thread.unreadCount,
    createdAt: thread.createdAt.toISOString(),
  };
}

async function getThread(tenantId: string, threadId: string): Promise<any | null> {
  return prisma.conversationThread.findFirst({
    where: { id: threadId, tenantId },
    include: { messages: { orderBy: { occurredAt: "asc" } } },
  });
}

/** Records a tenant-safe inbound or outbound message, with provider-id idempotency. */
async function record(input: RecordConversationInput): Promise<ConversationView> {
  const contactKey = assertInput(input);
  const occurredAt = input.occurredAt ?? new Date();

  if (input.providerMessageId) {
    const duplicate = await prisma.conversationMessage.findFirst({
      where: { tenantId: input.tenantId, providerMessageId: input.providerMessageId },
      select: { threadId: true },
    });
    if (duplicate) {
      const existing = await getThread(input.tenantId, duplicate.threadId);
      if (existing) return toView(existing);
    }
  }

  const fallbackBusiness = input.businessName || input.email || input.phone || "Unknown contact";
  const thread = await prisma.conversationThread.upsert({
    where: {
      tenantId_channel_contactKey: {
        tenantId: input.tenantId,
        channel: input.channel,
        contactKey,
      },
    },
    create: {
      tenantId: input.tenantId,
      channel: input.channel,
      contactKey,
      leadId: input.leadId ?? null,
      businessName: fallbackBusiness,
      phone: input.phone || null,
      email: input.email || null,
      status: input.direction === "in" ? "REPLIED" : "AWAITING_REPLY",
      unreadCount: input.direction === "in" ? 1 : 0,
      lastMessageAt: occurredAt,
      lastMessagePreview: preview(input.text),
    },
    update: {
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.businessName ? { businessName: input.businessName } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.email ? { email: input.email } : {}),
      lastMessageAt: occurredAt,
      lastMessagePreview: preview(input.text),
      ...(input.direction === "in"
        ? { status: "REPLIED", unreadCount: { increment: 1 } }
        : {}),
    },
  });

  try {
    await prisma.conversationMessage.create({
      data: {
        tenantId: input.tenantId,
        threadId: thread.id,
        direction: input.direction,
        channel: input.channel,
        text: input.text.trim(),
        source: input.source ?? null,
        provider: input.provider ?? null,
        providerMessageId: input.providerMessageId ?? null,
        occurredAt,
      },
    });
  } catch (error: any) {
    // A duplicate provider event may race the pre-check. Return the existing
    // thread rather than incrementing unread or storing it a second time.
    if (error?.code !== "P2002") throw error;
  }

  const updated = await getThread(input.tenantId, thread.id);
  if (!updated) throw new Error("Conversation thread was not found after recording a message.");
  return toView(updated);
}

export function recordInbound(input: Omit<RecordConversationInput, "direction">): Promise<ConversationView> {
  return record({ ...input, direction: "in" });
}

export function recordOutbound(input: Omit<RecordConversationInput, "direction">): Promise<ConversationView> {
  return record({ ...input, direction: "out" });
}

export async function listConversations(ctx: TenantContext): Promise<{ conversations: ConversationView[]; totalUnread: number }> {
  const threads = await prisma.conversationThread.findMany({
    where: { tenantId: ctx.tenantId },
    include: { messages: { orderBy: { occurredAt: "asc" } } },
    orderBy: { lastMessageAt: "desc" },
  });
  return {
    conversations: threads.map(toView),
    totalUnread: threads.reduce((sum: number, thread: any) => sum + thread.unreadCount, 0),
  };
}

export async function getConversation(ctx: TenantContext, threadId: string): Promise<ConversationView | null> {
  const thread = await getThread(ctx.tenantId, threadId);
  return thread ? toView(thread) : null;
}

export async function markConversationRead(ctx: TenantContext, threadId: string): Promise<ConversationView | null> {
  const existing = await getThread(ctx.tenantId, threadId);
  if (!existing) return null;
  await prisma.conversationThread.update({ where: { id: threadId }, data: { unreadCount: 0 } });
  return getConversation(ctx, threadId);
}

export async function setConversationStatus(
  ctx: TenantContext,
  threadId: string,
  status: ConversationStatus
): Promise<ConversationView | null> {
  if (!(["AWAITING_REPLY", "REPLIED", "CLOSED"] as string[]).includes(status)) {
    throw new Error("Invalid conversation status.");
  }
  const existing = await getThread(ctx.tenantId, threadId);
  if (!existing) return null;
  await prisma.conversationThread.update({ where: { id: threadId }, data: { status } });
  return getConversation(ctx, threadId);
}

export async function deleteConversation(ctx: TenantContext, threadId: string): Promise<boolean> {
  const result = await prisma.conversationThread.deleteMany({ where: { id: threadId, tenantId: ctx.tenantId } });
  return result.count === 1;
}
