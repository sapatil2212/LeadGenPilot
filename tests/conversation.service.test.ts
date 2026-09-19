import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../src/tenancy/context";

const mocks = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, property) => mocks.prisma[property] }),
}));

const {
  recordInbound,
  recordOutbound,
  listConversations,
  markConversationRead,
  deleteConversation,
} = await import("../src/conversations/conversationService");

const CTX_A: TenantContext = {
  tenantId: "tenant-a", userId: "user-a", membershipId: "member-a", role: "owner",
  tenantName: "Tenant A", tenantSlug: "tenant-a", permissions: new Set(),
};
const CTX_B: TenantContext = { ...CTX_A, tenantId: "tenant-b", userId: "user-b", membershipId: "member-b" };

function useConversationStore() {
  const threads: any[] = [];
  const messages: any[] = [];
  let threadSequence = 0;
  let messageSequence = 0;

  const threadWithMessages = (thread: any) => ({
    ...thread,
    messages: messages.filter((message) => message.threadId === thread.id).sort((a, b) => a.occurredAt - b.occurredAt),
  });

  mocks.prisma = {
    conversationThread: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.tenantId_channel_contactKey;
        let thread = threads.find((row) => row.tenantId === key.tenantId && row.channel === key.channel && row.contactKey === key.contactKey);
        if (!thread) {
          thread = { id: `thread-${++threadSequence}`, createdAt: new Date(), updatedAt: new Date(), ...create };
          threads.push(thread);
        } else {
          for (const [field, value] of Object.entries(update)) {
            if ((value as any)?.increment) thread[field] += (value as any).increment;
            else thread[field] = value;
          }
        }
        return thread;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const thread = threads.find((row) => row.id === where.id && row.tenantId === where.tenantId);
        return thread ? threadWithMessages(thread) : null;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        threads.filter((row) => row.tenantId === where.tenantId).sort((a, b) => b.lastMessageAt - a.lastMessageAt).map(threadWithMessages)
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const thread = threads.find((row) => row.id === where.id);
        Object.assign(thread, data);
        return thread;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const index = threads.findIndex((row) => row.id === where.id && row.tenantId === where.tenantId);
        if (index < 0) return { count: 0 };
        const [removed] = threads.splice(index, 1);
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].threadId === removed.id) messages.splice(i, 1);
        return { count: 1 };
      }),
    },
    conversationMessage: {
      findFirst: vi.fn(async ({ where }: any) =>
        messages.find((row) => row.tenantId === where.tenantId && row.providerMessageId === where.providerMessageId) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        if (data.providerMessageId && messages.some((row) => row.tenantId === data.tenantId && row.providerMessageId === data.providerMessageId)) {
          const error: any = new Error("duplicate"); error.code = "P2002"; throw error;
        }
        const row = { id: `message-${++messageSequence}`, createdAt: new Date(), ...data };
        messages.push(row);
        return row;
      }),
    },
  };

  return { threads, messages };
}

let store: ReturnType<typeof useConversationStore>;
beforeEach(() => { store = useConversationStore(); });

describe("tenant conversation service", () => {
  it("keeps the same contact isolated between workspaces", async () => {
    const a = await recordInbound({ tenantId: CTX_A.tenantId, channel: "email", email: "lead@example.test", text: "Hello" });
    const b = await recordInbound({ tenantId: CTX_B.tenantId, channel: "email", email: "lead@example.test", text: "Hello" });

    expect(a.id).not.toBe(b.id);
    expect((await listConversations(CTX_A)).conversations).toHaveLength(1);
    expect((await listConversations(CTX_B)).conversations).toHaveLength(1);
  });

  it("does not duplicate a retried provider event or unread count", async () => {
    await recordInbound({ tenantId: CTX_A.tenantId, channel: "whatsapp", phone: "+15551234567", text: "Interested", providerMessageId: "meta-1" });
    await recordInbound({ tenantId: CTX_A.tenantId, channel: "whatsapp", phone: "+15551234567", text: "Interested", providerMessageId: "meta-1" });

    const listed = await listConversations(CTX_A);
    expect(listed.totalUnread).toBe(1);
    expect(listed.conversations[0].messages).toHaveLength(1);
  });

  it("records outbound replies without changing a replied conversation back to awaiting", async () => {
    const inbound = await recordInbound({ tenantId: CTX_A.tenantId, channel: "email", email: "lead@example.test", text: "Can you help?" });
    const outbound = await recordOutbound({ tenantId: CTX_A.tenantId, channel: "email", email: "lead@example.test", text: "Yes, absolutely." });

    expect(outbound.status).toBe("REPLIED");
    expect(outbound.messages.map((message) => message.direction)).toEqual(["in", "out"]);
    const read = await markConversationRead(CTX_A, inbound.id);
    expect(read?.unread).toBe(0);
  });

  it("cannot delete another workspace's conversation", async () => {
    const conversation = await recordInbound({ tenantId: CTX_A.tenantId, channel: "email", email: "lead@example.test", text: "Hello" });

    expect(await deleteConversation(CTX_B, conversation.id)).toBe(false);
    expect((await listConversations(CTX_A)).conversations).toHaveLength(1);
    expect(await deleteConversation(CTX_A, conversation.id)).toBe(true);
  });
});
