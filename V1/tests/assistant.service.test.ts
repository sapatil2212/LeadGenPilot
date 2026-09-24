/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The tenant AI assistant: persistence, context assembly and isolation.
 *
 * Three properties are worth testing here and nothing else really is:
 *
 *   - The prompt contains this workspace's business context and only the chunks
 *     retrieved for THIS question. A prompt that grows with the document library
 *     eventually stops fitting and always answers worse.
 *   - Every assistant turn records provider, model, prompt version, tokens and
 *     the chunk ids it was given. Without that, "why did it say that" is
 *     unanswerable, which makes a grounded assistant untrustworthy in exactly
 *     the situation where it matters.
 *   - A conversationId from another workspace is refused, not answered into and
 *     not silently replaced with a fresh thread.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  WORKSPACE_A,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaMock,
  generateText: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
  buildBusinessContext: vi.fn(),
  retrieveChunks: vi.fn(),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/ai/aiService", () => ({
  generateText: (...args: unknown[]) => mocks.generateText(...args),
  isAnyProviderConfigured: () => mocks.isAnyProviderConfigured(),
}));

vi.mock("../src/business/businessService", () => ({
  buildBusinessContext: (...args: unknown[]) => mocks.buildBusinessContext(...args),
}));

vi.mock("../src/knowledge/knowledgeService", () => ({
  retrieveChunks: (...args: unknown[]) => mocks.retrieveChunks(...args),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const assistant = await import("../src/assistant/assistantService");
const { AiUnavailableError } = await import("../src/ai/types");
const { resolvePermissions } = await import("../src/tenancy/permissions");

const CTX_A = {
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
  membershipId: "tm_a",
  role: "owner",
  tenantName: WORKSPACE_A.name,
  tenantSlug: WORKSPACE_A.slug,
  permissions: resolvePermissions("owner"),
};

const QUESTION = "Which of our products suits a 40-chair dental hospital?";

function wireHappyPath() {
  mocks.buildBusinessContext.mockResolvedValue({
    businessName: "Brightwave Instruments",
    industry: "Medical Equipment Manufacturing",
    businessType: "Manufacturer",
    description: "Builds autoclaves for dental clinics.",
    locationsServed: ["Pune"],
    uniqueSellingPoints: ["36-month warranty"],
    targetCustomerTypes: ["Dental clinics"],
    products: [{ name: "PX-100", category: "Autoclave", description: "18 litre chamber" }],
    services: [{ name: "AMC", description: "Four visits a year" }],
  });

  mocks.retrieveChunks.mockResolvedValue([
    {
      chunkId: "chunk_1",
      documentId: "doc_1",
      documentTitle: "Product catalogue",
      content: "The PX-100 completes a cycle in 22 minutes.",
      score: 0.87,
      method: "embedding",
    },
  ]);

  mocks.generateText.mockResolvedValue({
    text: "  The PX-100 fits that scale.  ",
    provider: "gemini",
    model: "gemini-2.5-flash",
    usage: { promptTokens: 900, completionTokens: 120, totalTokens: 1020 },
    latencyMs: 812,
  });

  mocks.prisma.aiConversation.create.mockImplementation(async ({ data }: any) => ({
    id: "conv_1",
    messageCount: 0,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...data,
  }));

  let messageSeq = 0;
  mocks.prisma.aiMessage.create.mockImplementation(async ({ data }: any) => ({
    id: `msg_${++messageSeq}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...data,
  }));

  mocks.prisma.aiConversation.update.mockResolvedValue({});
}

/** The system prompt the AI layer was handed. */
function systemPrompt(): string {
  const messages = mocks.generateText.mock.calls[0][0].messages;
  return messages.find((m: any) => m.role === "system")?.content ?? "";
}

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  mocks.generateText.mockReset();
  mocks.buildBusinessContext.mockReset();
  mocks.retrieveChunks.mockReset();
  mocks.isAnyProviderConfigured.mockReset();
  mocks.isAnyProviderConfigured.mockReturnValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("conversations", () => {
  it("lists only unarchived threads in the workspace by default", async () => {
    await assistant.listConversations(CTX_A);
    const where = mocks.prisma.aiConversation.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.archivedAt).toBeNull();
  });

  it("includes archived threads on request", async () => {
    await assistant.listConversations(CTX_A, { includeArchived: true });
    expect(
      mocks.prisma.aiConversation.findMany.mock.calls[0][0].where.archivedAt
    ).toBeUndefined();
  });

  it("caps the page size", async () => {
    await assistant.listConversations(CTX_A, { limit: 5_000 });
    expect(mocks.prisma.aiConversation.findMany.mock.calls[0][0].take).toBe(200);
  });

  it("stamps the workspace and the user on a new thread", async () => {
    mocks.prisma.aiConversation.create.mockResolvedValue({
      id: "conv_1",
      kind: "assistant",
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assistant.createConversation(CTX_A, { title: "Targeting" });

    const data = mocks.prisma.aiConversation.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.userId).toBe(TENANT_A.id);
    expect(data.title).toBe("Targeting");
  });

  it("falls back to the assistant kind for an unknown value", async () => {
    mocks.prisma.aiConversation.create.mockResolvedValue({
      id: "conv_1",
      kind: "assistant",
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assistant.createConversation(CTX_A, { kind: "nonsense" });

    expect(mocks.prisma.aiConversation.create.mock.calls[0][0].data.kind).toBe("assistant");
  });

  it("accepts the onboarding kind", async () => {
    mocks.prisma.aiConversation.create.mockResolvedValue({
      id: "conv_1",
      kind: "onboarding",
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assistant.createConversation(CTX_A, { kind: "onboarding" });

    expect(mocks.prisma.aiConversation.create.mock.calls[0][0].data.kind).toBe("onboarding");
  });

  it("returns null for a thread in another workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue(null);

    expect(await assistant.getConversation(CTX_A, "conv_of_b")).toBeNull();
    expect(
      JSON.stringify(mocks.prisma.aiConversation.findFirst.mock.calls[0][0].where)
    ).toContain(WORKSPACE_A.id);
  });

  it("returns a thread with its messages, oldest first", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({
      id: "conv_1",
      title: "Targeting",
      kind: "assistant",
      messageCount: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.prisma.aiMessage.findMany.mockResolvedValue([
      { id: "m1", role: "user", content: "Q", createdAt: new Date() },
      {
        id: "m2",
        role: "assistant",
        content: "A",
        provider: "gemini",
        model: "gemini-2.5-flash",
        promptName: "assistant.chat",
        promptVersion: 1,
        totalTokens: 100,
        latencyMs: 50,
        citedChunkIds: JSON.stringify(["chunk_1"]),
        createdAt: new Date(),
      },
    ]);

    const conversation = await assistant.getConversation(CTX_A, "conv_1");

    expect(conversation?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conversation?.messages[1].citedChunkIds).toEqual(["chunk_1"]);
    expect(mocks.prisma.aiMessage.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("survives a corrupted citation column", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({
      id: "conv_1",
      kind: "assistant",
      messageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.prisma.aiMessage.findMany.mockResolvedValue([
      { id: "m1", role: "assistant", content: "A", citedChunkIds: "{not json", createdAt: new Date() },
    ]);

    const conversation = await assistant.getConversation(CTX_A, "conv_1");
    expect(conversation?.messages[0].citedChunkIds).toEqual([]);
  });

  it("refuses to rename a thread in another workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue(null);
    expect(await assistant.renameConversation(CTX_A, "conv_of_b", "Mine now")).toBeNull();
    expect(mocks.prisma.aiConversation.update).not.toHaveBeenCalled();
  });

  it("requires a non-empty title on rename", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    await expect(assistant.renameConversation(CTX_A, "conv_1", "  ")).rejects.toThrow(
      assistant.AssistantInputError
    );
  });

  it("archives by setting a timestamp rather than deleting", async () => {
    // A thread is the record of what the business told the AI. Hiding it is
    // usually what the user wants; destroying the provenance is not.
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1" });

    expect(await assistant.archiveConversation(CTX_A, "conv_1")).toBe(true);
    expect(
      mocks.prisma.aiConversation.update.mock.calls[0][0].data.archivedAt
    ).toBeInstanceOf(Date);
    expect(mocks.prisma.aiConversation.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a thread in another workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue(null);
    expect(await assistant.deleteConversation(CTX_A, "conv_of_b")).toBe(false);
    expect(mocks.prisma.aiConversation.delete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("askAssistant", () => {
  beforeEach(() => {
    wireHappyPath();
  });

  it("requires a question", async () => {
    await expect(assistant.askAssistant(CTX_A, { question: "   " })).rejects.toThrow(
      assistant.AssistantInputError
    );
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects an oversized question", async () => {
    await expect(
      assistant.askAssistant(CTX_A, { question: "x".repeat(9_000) })
    ).rejects.toThrow(/characters or fewer/);
  });

  it("starts a thread and titles it from the question", async () => {
    const result = await assistant.askAssistant(CTX_A, { question: QUESTION });

    expect(result.conversationId).toBe("conv_1");
    expect(mocks.prisma.aiConversation.create.mock.calls[0][0].data.title).toBe(QUESTION);
  });

  it("truncates a long derived title", async () => {
    await assistant.askAssistant(CTX_A, { question: "Q".repeat(200) });
    const title = mocks.prisma.aiConversation.create.mock.calls[0][0].data.title;
    expect(title).toHaveLength(70);
    expect(title.endsWith("...")).toBe(true);
  });

  it("refuses a conversationId that does not belong to the workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue(null);

    await expect(
      assistant.askAssistant(CTX_A, { conversationId: "conv_of_b", question: QUESTION })
    ).rejects.toThrow("Conversation not found.");

    // Neither answered into, nor silently replaced with a new thread — the
    // latter would hide a client pointing at something it cannot see.
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.prisma.aiConversation.create).not.toHaveBeenCalled();
  });

  it("persists the user's turn before calling the model", async () => {
    mocks.generateText.mockRejectedValue(new AiUnavailableError("all providers down", []));

    await expect(assistant.askAssistant(CTX_A, { question: QUESTION })).rejects.toThrow(
      AiUnavailableError
    );

    // A provider outage must not lose what the user typed.
    const created = mocks.prisma.aiMessage.create.mock.calls.map((c: any[]) => c[0].data);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenantId: WORKSPACE_A.id,
      conversationId: "conv_1",
      role: "user",
      content: QUESTION,
    });
  });

  it("injects the workspace's business context into the prompt", async () => {
    await assistant.askAssistant(CTX_A, { question: QUESTION });

    const prompt = systemPrompt();
    expect(prompt).toContain("Brightwave Instruments");
    expect(prompt).toContain("PX-100");
    expect(prompt).toContain("36-month warranty");
    expect(mocks.buildBusinessContext).toHaveBeenCalledWith(CTX_A);
  });

  it("injects only the chunks retrieved for this question", async () => {
    await assistant.askAssistant(CTX_A, { question: QUESTION });

    expect(mocks.retrieveChunks).toHaveBeenCalledWith(CTX_A, QUESTION, { limit: 6 });
    const prompt = systemPrompt();
    expect(prompt).toContain("Product catalogue");
    expect(prompt).toContain("completes a cycle in 22 minutes");
  });

  it("tells the model plainly when nothing was retrieved", async () => {
    mocks.retrieveChunks.mockResolvedValue([]);

    await assistant.askAssistant(CTX_A, { question: QUESTION });

    expect(systemPrompt()).toContain("No document excerpts were retrieved");
  });

  it("instructs the model not to invent business facts", async () => {
    await assistant.askAssistant(CTX_A, { question: QUESTION });

    const prompt = systemPrompt();
    expect(prompt).toMatch(/do not invent/i);
    expect(prompt).toMatch(/do not guess/i);
  });

  it("replays prior turns oldest first, with metadata stripped", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1", title: "Targeting" });
    // loadHistory reads newest-first and reverses.
    mocks.prisma.aiMessage.findMany.mockResolvedValue([
      { role: "assistant", content: "Second" },
      { role: "user", content: "First" },
    ]);

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    const messages = mocks.generateText.mock.calls[0][0].messages;
    expect(messages.map((m: any) => m.content)).toEqual([
      expect.stringContaining("BUSINESS PROFILE"),
      "First",
      "Second",
      QUESTION,
    ]);
  });

  it("caps replayed history", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1", title: "T" });

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    expect(mocks.prisma.aiMessage.findMany.mock.calls[0][0].take).toBe(12);
  });

  it("drops system rows and truncates a pasted wall of text from history", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1", title: "T" });
    mocks.prisma.aiMessage.findMany.mockResolvedValue([
      { role: "system", content: "internal" },
      { role: "user", content: "x".repeat(10_000) },
    ]);

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    const messages = mocks.generateText.mock.calls[0][0].messages;
    expect(messages.some((m: any) => m.content === "internal")).toBe(false);
    const replayed = messages.find((m: any) => m.role === "user" && m.content.startsWith("xxx"));
    expect(replayed.content).toHaveLength(4_000);
  });

  it("scopes the history read to the workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1", title: "T" });

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    expect(mocks.prisma.aiMessage.findMany.mock.calls[0][0].where.tenantId).toBe(WORKSPACE_A.id);
  });

  it("records what produced the answer and what it was grounded in", async () => {
    const result = await assistant.askAssistant(CTX_A, { question: QUESTION });

    const assistantRow = mocks.prisma.aiMessage.create.mock.calls[1][0].data;
    expect(assistantRow).toMatchObject({
      tenantId: WORKSPACE_A.id,
      role: "assistant",
      content: "The PX-100 fits that scale.",
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptName: "assistant.chat",
      promptVersion: 1,
      totalTokens: 1020,
      latencyMs: 812,
    });
    expect(JSON.parse(assistantRow.citedChunkIds)).toEqual(["chunk_1"]);

    expect(result.citations).toEqual([
      {
        chunkId: "chunk_1",
        documentId: "doc_1",
        documentTitle: "Product catalogue",
        score: 0.87,
        method: "embedding",
      },
    ]);
  });

  it("stores no citations when nothing was retrieved", async () => {
    mocks.retrieveChunks.mockResolvedValue([]);

    await assistant.askAssistant(CTX_A, { question: QUESTION });

    expect(mocks.prisma.aiMessage.create.mock.calls[1][0].data.citedChunkIds).toBeNull();
  });

  it("passes the prompt reference to the AI layer", async () => {
    await assistant.askAssistant(CTX_A, { question: QUESTION });

    const options = mocks.generateText.mock.calls[0][1];
    expect(options).toMatchObject({
      operation: "assistant.chat",
      tenantId: WORKSPACE_A.id,
      userId: TENANT_A.id,
      promptName: "assistant.chat",
      promptVersion: 1,
    });
  });

  it("bumps the rolling message counter by two", async () => {
    await assistant.askAssistant(CTX_A, { question: QUESTION });

    const data = mocks.prisma.aiConversation.update.mock.calls[0][0].data;
    // The counter exists so history can be trimmed without a COUNT(*).
    expect(data.messageCount).toEqual({ increment: 2 });
  });

  it("does not rewrite the title of an existing thread", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({
      id: "conv_1",
      title: "Chosen by the user",
    });

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    expect(mocks.prisma.aiConversation.update.mock.calls[0][0].data.title).toBeUndefined();
  });

  it("titles an untitled existing thread from the first question", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1", title: null });

    await assistant.askAssistant(CTX_A, { conversationId: "conv_1", question: QUESTION });

    expect(mocks.prisma.aiConversation.update.mock.calls[0][0].data.title).toBe(QUESTION);
  });

  it("returns both new messages so a client need not refetch", async () => {
    const result = await assistant.askAssistant(CTX_A, { question: QUESTION });
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
