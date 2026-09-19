/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The tenant-facing AI assistant.
 *
 * Context for every answer is assembled from the workspace's own stored data:
 * the business profile, its products and services, and the knowledge chunks
 * retrieved for THIS question. Never the whole knowledge base — a prompt that
 * grows with the document library eventually stops fitting, costs more every
 * upload, and answers worse, because a model handed fifty unrelated pages does
 * worse than one handed the three relevant paragraphs.
 *
 * Each assistant turn records the provider, model, prompt name and version,
 * token count and the ids of the chunks it was given. That makes an answer
 * auditable after the fact: "why did it say that" is answerable by replaying the
 * exact prompt version against the exact excerpts, which is the whole point of
 * a grounded assistant that customers will act on.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";
import { generateText } from "../ai/aiService";
import type { AiMessage as AiChatMessage, AiProviderId } from "../ai/types";
import { assistantPrompt, promptRef, type RetrievedChunk as PromptChunk } from "../prompts";
import { buildBusinessContext } from "../business/businessService";
import { retrieveChunks } from "../knowledge/knowledgeService";

export const CONVERSATION_KINDS = ["assistant", "onboarding"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

const LIMITS = {
  title: 200,
  question: 8_000,
  /**
   * Prior turns replayed into the prompt.
   *
   * Six exchanges keeps a conversation coherent without letting an hour-long
   * session push the business context and the retrieved excerpts — the parts
   * that actually ground the answer — out of the model's attention.
   */
  historyMessages: 12,
  /** Per-message cap when replaying history, so one pasted document cannot fill it. */
  historyChars: 4_000,
  /** Knowledge chunks injected per question. */
  retrievedChunks: 6,
} as const;

export class AssistantInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantInputError";
  }
}

export interface ConversationView {
  id: string;
  title: string | null;
  kind: string;
  messageCount: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageView {
  id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  promptName: string | null;
  promptVersion: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  citedChunkIds: string[];
  createdAt: Date;
}

function toConversationView(row: any): ConversationView {
  return {
    id: row.id,
    title: row.title ?? null,
    kind: row.kind,
    messageCount: row.messageCount,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decodeIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toMessageView(row: any): MessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    provider: row.provider ?? null,
    model: row.model ?? null,
    promptName: row.promptName ?? null,
    promptVersion: row.promptVersion ?? null,
    totalTokens: row.totalTokens ?? null,
    latencyMs: row.latencyMs ?? null,
    citedChunkIds: decodeIds(row.citedChunkIds),
    createdAt: row.createdAt,
  };
}

/** Derives a thread title from its first question. */
function titleFromQuestion(question: string): string {
  const firstLine = question.split("\n").find((l) => l.trim()) || question;
  const trimmed = firstLine.trim();
  return trimmed.length > 70 ? `${trimmed.slice(0, 67)}...` : trimmed.slice(0, LIMITS.title);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────────────────────────────────────

export async function listConversations(
  ctx: TenantContext,
  options: { includeArchived?: boolean; limit?: number } = {}
): Promise<ConversationView[]> {
  const rows = await prisma.aiConversation.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(options.limit ?? 50, 200)),
  });
  return rows.map(toConversationView);
}

export async function createConversation(
  ctx: TenantContext,
  input: { title?: string | null; kind?: string } = {}
): Promise<ConversationView> {
  const kind = (CONVERSATION_KINDS as readonly string[]).includes(input.kind || "")
    ? (input.kind as ConversationKind)
    : "assistant";

  const row = await prisma.aiConversation.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      kind,
      title: input.title ? String(input.title).trim().slice(0, LIMITS.title) || null : null,
    },
  });
  return toConversationView(row);
}

export async function getConversation(
  ctx: TenantContext,
  conversationId: string
): Promise<(ConversationView & { messages: MessageView[] }) | null> {
  const row = await prisma.aiConversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
  });
  if (!row) return null;

  const messages = await prisma.aiMessage.findMany({
    where: { tenantId: ctx.tenantId, conversationId: row.id },
    orderBy: { createdAt: "asc" },
  });

  return { ...toConversationView(row), messages: messages.map(toMessageView) };
}

export async function renameConversation(
  ctx: TenantContext,
  conversationId: string,
  title: string
): Promise<ConversationView | null> {
  const owned = await prisma.aiConversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return null;

  const clean = String(title ?? "").trim().slice(0, LIMITS.title);
  if (!clean) throw new AssistantInputError("A title is required.");

  const row = await prisma.aiConversation.update({
    where: { id: owned.id },
    data: { title: clean },
  });
  return toConversationView(row);
}

/**
 * Archives rather than deletes by default.
 *
 * An assistant thread is the record of what the business told the AI and what it
 * answered. Hiding it from the list is what the user usually wants; destroying
 * the provenance of a decision is not.
 */
export async function archiveConversation(
  ctx: TenantContext,
  conversationId: string
): Promise<boolean> {
  const owned = await prisma.aiConversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  await prisma.aiConversation.update({
    where: { id: owned.id },
    data: { archivedAt: new Date() },
  });
  return true;
}

export async function deleteConversation(
  ctx: TenantContext,
  conversationId: string
): Promise<boolean> {
  const owned = await prisma.aiConversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  // Messages cascade from the schema.
  await prisma.aiConversation.delete({ where: { id: owned.id } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Asking
// ─────────────────────────────────────────────────────────────────────────────

export interface AskOptions {
  conversationId?: string | null;
  question: string;
  kind?: string;
  preferredProvider?: AiProviderId | null;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  method: string;
}

export interface AskResult {
  conversationId: string;
  answer: string;
  citations: Citation[];
  provider: string;
  model: string;
  promptName: string;
  promptVersion: number;
  totalTokens: number | null;
  latencyMs: number;
  /** Message rows created, so a client can render without a refetch. */
  messages: MessageView[];
}

/**
 * Answers a question in the workspace's context.
 *
 * The user's turn is persisted before the model is called, so a provider outage
 * does not lose what they typed — the thread shows the question and the client
 * can retry it.
 */
export async function askAssistant(ctx: TenantContext, options: AskOptions): Promise<AskResult> {
  const question = String(options.question ?? "").trim();
  if (!question) throw new AssistantInputError("A question is required.");
  if (question.length > LIMITS.question) {
    throw new AssistantInputError(`Questions must be ${LIMITS.question} characters or fewer.`);
  }

  const conversation = await resolveConversation(ctx, options, question);

  const history = await loadHistory(ctx, conversation.id);

  const userMessage = await prisma.aiMessage.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: conversation.id,
      role: "user",
      content: question,
    },
  });

  const [business, retrieved] = await Promise.all([
    buildBusinessContext(ctx),
    retrieveChunks(ctx, question, { limit: LIMITS.retrievedChunks }),
  ]);

  const knowledge: PromptChunk[] = retrieved.map((c) => ({
    documentTitle: c.documentTitle,
    content: c.content,
    score: c.score,
  }));

  const messages = assistantPrompt.build({ business, knowledge, history, question });

  const result = await generateText(
    { messages, temperature: 0.4, timeoutMs: 60_000 },
    {
      operation: "assistant.chat",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      preferredProvider: options.preferredProvider ?? null,
      ...promptRef(assistantPrompt),
    }
  );

  const answer = result.text.trim();
  const citations: Citation[] = retrieved.map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    score: Number(c.score.toFixed(4)),
    method: c.method,
  }));

  const assistantMessage = await prisma.aiMessage.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: conversation.id,
      role: "assistant",
      content: answer,
      provider: result.provider,
      model: result.model,
      promptName: assistantPrompt.name,
      promptVersion: assistantPrompt.version,
      totalTokens: result.usage?.totalTokens ?? null,
      latencyMs: result.latencyMs,
      citedChunkIds: citations.length ? JSON.stringify(citations.map((c) => c.chunkId)) : null,
    },
  });

  // Two messages were added. The rolling counter exists so history can be
  // trimmed without a COUNT(*) on every turn.
  await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      messageCount: { increment: 2 },
      ...(conversation.title ? {} : { title: titleFromQuestion(question) }),
    },
  });

  logger.info(
    `Assistant answered in workspace ${ctx.tenantId} via ${result.provider}/${result.model} ` +
      `with ${citations.length} excerpt(s).`
  );

  return {
    conversationId: conversation.id,
    answer,
    citations,
    provider: result.provider,
    model: result.model,
    promptName: assistantPrompt.name,
    promptVersion: assistantPrompt.version,
    totalTokens: result.usage?.totalTokens ?? null,
    latencyMs: result.latencyMs,
    messages: [toMessageView(userMessage), toMessageView(assistantMessage)],
  };
}

/**
 * Finds the requested thread within this workspace, or starts one.
 *
 * A conversationId that does not resolve is refused rather than silently
 * replaced with a new thread: quietly starting a fresh conversation would hide
 * the fact that a client is pointing at something it cannot see — including
 * another workspace's thread.
 */
async function resolveConversation(
  ctx: TenantContext,
  options: AskOptions,
  question: string
): Promise<{ id: string; title: string | null }> {
  if (options.conversationId) {
    const existing = await prisma.aiConversation.findFirst({
      where: { id: options.conversationId, tenantId: ctx.tenantId },
      select: { id: true, title: true },
    });
    if (!existing) throw new AssistantInputError("Conversation not found.");
    return existing;
  }

  const created = await createConversation(ctx, {
    kind: options.kind,
    title: titleFromQuestion(question),
  });
  return { id: created.id, title: created.title };
}

/** Loads recent turns for replay, oldest first, with metadata stripped. */
async function loadHistory(ctx: TenantContext, conversationId: string): Promise<AiChatMessage[]> {
  const rows = await prisma.aiMessage.findMany({
    where: { tenantId: ctx.tenantId, conversationId },
    orderBy: { createdAt: "desc" },
    take: LIMITS.historyMessages,
    select: { role: true, content: true },
  });

  return rows
    .reverse()
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content).slice(0, LIMITS.historyChars),
    }));
}
