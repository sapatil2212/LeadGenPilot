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
      // Mirrors the paginated read: a page of threads, each carrying only its
      // most recent messages newest-first (the service reverses them for display).
      findMany: vi.fn(async ({ where, include, skip = 0, take }: any) => {
        const ordered = threads
          .filter(
            (row) =>
              row.tenantId === where.tenantId &&
              (!where.channel || row.channel === where.channel) &&
              (!where.status || row.status === where.status)
          )
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
        const page = ordered.slice(skip, take ? skip + take : undefined);
        const messageTake = include?.messages?.take;
        return page.map((thread) => {
          const newestFirst = messages
            .filter((message) => message.threadId === thread.id)
            .sort((a, b) => b.occurredAt - a.occurredAt);
          return { ...thread, messages: messageTake ? newestFirst.slice(0, messageTake) : newestFirst };
        });
      }),
      count: vi.fn(
        async ({ where }: any) =>
          threads.filter(
            (row) =>
              row.tenantId === where.tenantId &&
              (!where.channel || row.channel === where.channel) &&
              (!where.status || row.status === where.status)
          ).length
      ),
      aggregate: vi.fn(async ({ where }: any) => ({
        _sum: {
          unreadCount: threads
            .filter((row) => row.tenantId === where.tenantId)
            .reduce((sum, thread) => sum + (thread.unreadCount || 0), 0),
        },
      })),
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

/**
 * PHASE 8 — the inbox is polled every few seconds, so an unpaginated read grew
 * with the whole conversation history of the workspace. These tests pin the page
 * boundaries and, importantly, that the unread badge still counts the workspace
 * rather than only the page being displayed.
 */
describe("inbox pagination", () => {
  async function seedThreads(count: number) {
    for (let index = 0; index < count; index++) {
      await recordInbound({
        tenantId: CTX_A.tenantId,
        channel: "email",
        email: `lead-${index}@example.test`,
        text: `Message ${index}`,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }
  }

  it("returns one page at a time with the workspace total", async () => {
    await seedThreads(5);

    const first = await listConversations(CTX_A, { pageSize: 2 });
    const second = await listConversations(CTX_A, { pageSize: 2, page: 2 });

    expect(first.conversations).toHaveLength(2);
    expect(second.conversations).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.pageSize).toBe(2);
    // Newest first, so page two must not repeat page one.
    const firstIds = first.conversations.map((conversation) => conversation.id);
    const secondIds = second.conversations.map((conversation) => conversation.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it("counts unread across the whole workspace, not just the page", async () => {
    await seedThreads(5);

    const page = await listConversations(CTX_A, { pageSize: 1 });

    expect(page.conversations).toHaveLength(1);
    expect(page.totalUnread).toBe(5);
  });

  it("returns the most recent messages of a long thread, in reading order", async () => {
    for (let index = 0; index < 6; index++) {
      await recordInbound({
        tenantId: CTX_A.tenantId,
        channel: "email",
        email: "chatty@example.test",
        text: `Reply ${index}`,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }

    const page = await listConversations(CTX_A, { messageLimit: 3 });
    const texts = page.conversations[0].messages.map((message) => message.text);

    expect(texts).toEqual(["Reply 3", "Reply 4", "Reply 5"]);
  });

  it("filters by channel without losing the tenant scope", async () => {
    await recordInbound({ tenantId: CTX_A.tenantId, channel: "email", email: "lead@example.test", text: "Email" });
    await recordInbound({ tenantId: CTX_A.tenantId, channel: "whatsapp", phone: "+15551234567", text: "WhatsApp" });
    await recordInbound({ tenantId: CTX_B.tenantId, channel: "email", email: "other@example.test", text: "Theirs" });

    const emails = await listConversations(CTX_A, { channel: "email" });

    expect(emails.conversations).toHaveLength(1);
    expect(emails.conversations[0].channel).toBe("email");
  });

  it("caps an oversized page request", async () => {
    await seedThreads(3);
    const page = await listConversations(CTX_A, { pageSize: 10_000 });
    expect(page.pageSize).toBe(200);
  });
});
