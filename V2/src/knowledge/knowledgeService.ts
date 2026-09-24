/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The knowledge base: document ingestion and retrieval.
 *
 * INGESTION
 * ---------
 * upload → validate → checksum → extract text → chunk → embed → persist, with
 * the document's `status` column advanced at each step. A status rather than a
 * boolean because extraction, chunking and embedding are separate failure
 * points with different fixes: "this PDF is a scan" and "the embedding provider
 * is down" both mean "not searchable", but only one of them is worth retrying.
 *
 * The pipeline runs inline, awaited by the request. At the scale this serves
 * (tens of documents per workspace, embeddings batched into a handful of calls)
 * a background worker would add a queue, a poller and a stuck-job reaper to
 * save a few seconds of latency on an action the user takes once. `status` plus
 * `reprocessDocument` covers the failure case without any of that.
 *
 * Original bytes are NOT retained. The extracted text is the durable artefact —
 * it is what chunking and re-chunking read — and keeping customer files on disk
 * needs a retention and encryption policy that belongs with object storage, not
 * with a local path written as a side effect of an upload.
 *
 * RETRIEVAL
 * ---------
 * Similarity is computed in the application: MySQL has no vector type and no
 * ANN index, so the alternative is adding a vector database to the deployment
 * for a few hundred rows per tenant. The query is embedded first, and only
 * chunks carrying the SAME embedding model are scanned — vectors from different
 * models are not comparable, and silently mixing them degrades search in a way
 * that looks like the model getting worse rather than like a bug.
 *
 * When no embedding provider is configured, retrieval falls back to keyword
 * overlap. Worse than semantic search, much better than an assistant that can
 * never see the documents.
 */

import crypto from "node:crypto";
import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";
import { embedTexts, isAnyProviderConfigured } from "../ai/aiService";
import { AiUnavailableError } from "../ai/types";
import {
  UPLOAD_RULES,
  UnsupportedFileError,
  extractText,
  resolveFileType,
  type SupportedFileType,
} from "./extraction";
import { chunkText, cosineSimilarity, keywordScore } from "./chunking";

/** Document processing states, in order. */
export const DOCUMENT_STATUS = {
  pending: "pending",
  extracting: "extracting",
  chunking: "chunking",
  embedding: "embedding",
  ready: "ready",
  failed: "failed",
} as const;

export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

/** Chunks embedded per provider call. Keeps a large document to a few requests. */
const EMBED_BATCH_SIZE = 64;

/** Rows inserted per createMany. */
const INSERT_BATCH_SIZE = 200;

/**
 * Upper bound on chunks scanned for one query.
 *
 * A guard, not a design limit: it stops a pathological workspace from turning
 * one search into a multi-hundred-megabyte read.
 */
const MAX_SCAN_CHUNKS = 2_000;

const LIMITS = {
  title: 300,
  category: 120,
  query: 2_000,
  /** Extracted text kept per document. LONGTEXT could hold more; a prompt cannot. */
  extractedText: 2_000_000,
} as const;

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}

export interface DocumentView {
  id: string;
  title: string;
  originalName: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  charCount: number | null;
  chunkCount: number | null;
  category: string | null;
  /** True when chunks carry vectors, so this document is semantically searchable. */
  embedded: boolean;
  embeddingModel: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

function trimTo(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function toDocumentView(row: any): DocumentView {
  return {
    id: row.id,
    title: row.title,
    originalName: row.originalName,
    fileType: row.fileType,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error ?? null,
    charCount: row.charCount ?? null,
    chunkCount: row.chunkCount ?? null,
    category: row.category ?? null,
    embedded: !!row.embeddingModel,
    embeddingModel: row.embeddingModel ?? null,
    createdAt: row.createdAt,
    processedAt: row.processedAt ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks an upload before anything is parsed or stored.
 *
 * Size and emptiness are refused outright. The file type is resolved from the
 * MIME type with an extension fallback, because browsers report Office formats
 * inconsistently — see resolveFileType, which explains why that is not a trust
 * boundary.
 */
export function validateUpload(file: UploadedFile): SupportedFileType {
  if (!file || !file.buffer || file.size === 0) {
    throw new UploadValidationError("The uploaded file is empty.");
  }
  if (file.size > UPLOAD_RULES.maxBytes) {
    const limitMb = Math.round(UPLOAD_RULES.maxBytes / (1024 * 1024));
    throw new UploadValidationError(`Files must be ${limitMb} MB or smaller.`);
  }
  try {
    return resolveFileType(file.mimeType, file.originalName);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      throw new UploadValidationError(err.message);
    }
    throw err;
  }
}

export function checksumOf(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listDocuments(ctx: TenantContext): Promise<DocumentView[]> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
  });

  // embeddingModel lives on the chunks, so surface it per document in one pass
  // rather than one query per row.
  const ids = rows.map((r: any) => r.id);
  const models = ids.length
    ? await prisma.knowledgeChunk.findMany({
        where: { tenantId: ctx.tenantId, documentId: { in: ids }, embeddingModel: { not: null } },
        distinct: ["documentId"],
        select: { documentId: true, embeddingModel: true },
      })
    : [];
  const byDocument = new Map<string, string>(
    models.map((m: any) => [m.documentId, m.embeddingModel])
  );

  return rows.map((row: any) =>
    toDocumentView({ ...row, embeddingModel: byDocument.get(row.id) ?? null })
  );
}

export async function getDocument(
  ctx: TenantContext,
  documentId: string
): Promise<(DocumentView & { extractedText: string | null }) | null> {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId: ctx.tenantId },
  });
  if (!row) return null;

  const chunk = await prisma.knowledgeChunk.findFirst({
    where: { tenantId: ctx.tenantId, documentId: row.id, embeddingModel: { not: null } },
    select: { embeddingModel: true },
  });

  return {
    ...toDocumentView({ ...row, embeddingModel: chunk?.embeddingModel ?? null }),
    extractedText: row.extractedText ?? null,
  };
}

export async function deleteDocument(ctx: TenantContext, documentId: string): Promise<boolean> {
  const owned = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  // Chunks and derived items cascade from the schema.
  await prisma.knowledgeDocument.delete({ where: { id: owned.id } });
  return true;
}

export interface KnowledgeStats {
  documents: number;
  ready: number;
  failed: number;
  processing: number;
  chunks: number;
  embeddedChunks: number;
  /** False when nothing is searchable yet, so the UI can say why. */
  searchable: boolean;
  embeddingsAvailable: boolean;
}

export async function getKnowledgeStats(ctx: TenantContext): Promise<KnowledgeStats> {
  const [byStatus, chunks, embeddedChunks] = await Promise.all([
    prisma.knowledgeDocument.groupBy({
      by: ["status"],
      where: { tenantId: ctx.tenantId },
      _count: { _all: true },
    }),
    prisma.knowledgeChunk.count({ where: { tenantId: ctx.tenantId } }),
    prisma.knowledgeChunk.count({
      where: { tenantId: ctx.tenantId, embeddingModel: { not: null } },
    }),
  ]);

  const count = (status: string) =>
    byStatus
      .filter((g: any) => g.status === status)
      .reduce((sum: number, g: any) => sum + (g._count?._all ?? 0), 0);

  const documents = byStatus.reduce((sum: number, g: any) => sum + (g._count?._all ?? 0), 0);
  const ready = count(DOCUMENT_STATUS.ready);

  return {
    documents,
    ready,
    failed: count(DOCUMENT_STATUS.failed),
    processing: documents - ready - count(DOCUMENT_STATUS.failed),
    chunks,
    embeddedChunks,
    searchable: chunks > 0,
    embeddingsAvailable: isAnyProviderConfigured(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────────────────────────────────────

export interface IngestOptions {
  title?: string | null;
  category?: string | null;
  /**
   * Reject a file whose bytes already exist in this workspace. On by default:
   * re-uploading the same catalogue twice doubles every retrieval hit for it.
   */
  rejectDuplicates?: boolean;
}

export interface IngestResult {
  document: DocumentView;
  /** Set when an identical file was already present and was returned instead. */
  duplicateOf?: string;
  /** Present when the file was stored but is not searchable. */
  warning?: string;
}

/**
 * Ingests an uploaded file into the workspace's knowledge base.
 *
 * Validation failures throw before any row is written. Failures after the row
 * exists are recorded on it — a document the user can see and retry is more
 * useful than a 500 and no trace.
 */
export async function ingestDocument(
  ctx: TenantContext,
  file: UploadedFile,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const fileType = validateUpload(file);
  const checksum = checksumOf(file.buffer);

  if (options.rejectDuplicates !== false) {
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { tenantId: ctx.tenantId, checksum },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return {
        document: toDocumentView(existing),
        duplicateOf: existing.id,
        warning: `"${existing.title}" is already in your knowledge base.`,
      };
    }
  }

  const title =
    trimTo(options.title, LIMITS.title) ||
    trimTo(file.originalName.replace(/\.[^.]+$/, ""), LIMITS.title) ||
    "Untitled document";

  const document = await prisma.knowledgeDocument.create({
    data: {
      tenantId: ctx.tenantId,
      uploadedById: ctx.userId,
      title,
      originalName: trimTo(file.originalName, LIMITS.title) || "upload",
      mimeType: trimTo(file.mimeType, 200) || "application/octet-stream",
      fileType,
      sizeBytes: file.size,
      checksum,
      category: trimTo(options.category, LIMITS.category),
      status: DOCUMENT_STATUS.pending,
    },
  });

  return processBuffer(ctx, document.id, file.buffer, fileType);
}

/** Runs extract → chunk → embed for a document row that already exists. */
async function processBuffer(
  ctx: TenantContext,
  documentId: string,
  buffer: Buffer,
  fileType: SupportedFileType
): Promise<IngestResult> {
  try {
    await setStatus(ctx, documentId, DOCUMENT_STATUS.extracting);
    const outcome = await extractText(buffer, fileType);

    if (!outcome.text) {
      // A scanned PDF parses fine and yields nothing. That is a failed ingest,
      // not an empty success: the document contributes no retrievable content,
      // and the fix (OCR, or a text-based copy) is something only the user can
      // do. Saying which is far more useful than a generic error.
      const warning = outcome.warning || "No text content found in this file.";
      const row = await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: DOCUMENT_STATUS.failed, error: warning, charCount: 0, chunkCount: 0 },
      });
      return { document: toDocumentView(row), warning };
    }

    const text = outcome.text.slice(0, LIMITS.extractedText);
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: DOCUMENT_STATUS.chunking,
        extractedText: text,
        charCount: text.length,
        error: null,
      },
    });

    return await chunkAndEmbed(ctx, documentId, text);
  } catch (err: any) {
    const message = err?.message || String(err);
    logger.error(`Knowledge ingest failed for document ${documentId}: ${message}`);
    const row = await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: DOCUMENT_STATUS.failed, error: message.slice(0, 2_000) },
    });
    return { document: toDocumentView(row), warning: message };
  }
}

/**
 * Chunks stored text, embeds the chunks and replaces the document's old chunks.
 *
 * A document with chunks but no vectors is still marked `ready`: keyword
 * retrieval works on it, so it is usable. The missing embedding is reported
 * through the `warning` and through KnowledgeStats.embeddingsAvailable rather
 * than by failing an upload the user cannot fix.
 */
async function chunkAndEmbed(
  ctx: TenantContext,
  documentId: string,
  text: string
): Promise<IngestResult> {
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    const row = await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: DOCUMENT_STATUS.failed,
        error: "The file had no text long enough to be useful.",
        chunkCount: 0,
      },
    });
    return { document: toDocumentView(row), warning: row.error ?? undefined };
  }

  // Re-processing replaces rather than appends, so chunk indexes stay unique
  // and a retry does not double the document's weight in every search.
  await prisma.knowledgeChunk.deleteMany({ where: { tenantId: ctx.tenantId, documentId } });

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: DOCUMENT_STATUS.embedding, chunkCount: chunks.length },
  });

  let vectors: (number[] | null)[] = chunks.map(() => null);
  let embeddingModel: string | null = null;
  let embeddingDims: number | null = null;
  let warning: string | undefined;

  try {
    const collected: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE).map((c) => c.content);
      const result = await embedTexts(batch, {
        operation: "knowledge.embed",
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        // Pin the model chosen by the first batch. Without this a provider
        // failing mid-document would leave one file with two incomparable
        // vector spaces in it.
        ...(embeddingModel ? { model: embeddingModel } : {}),
      });
      embeddingModel = result.model;
      embeddingDims = result.dimensions;
      collected.push(...result.vectors);
    }
    vectors = collected;
  } catch (err: any) {
    embeddingModel = null;
    embeddingDims = null;
    vectors = chunks.map(() => null);
    warning =
      err instanceof AiUnavailableError
        ? "Stored, but not semantically searchable: no embedding provider is configured. Search will use keyword matching."
        : `Stored, but embedding failed: ${err?.message || err}. Search will use keyword matching.`;
    logger.warn(`Knowledge embedding unavailable for document ${documentId}: ${err?.message || err}`);
  }

  const rows = chunks.map((chunk, i) => ({
    tenantId: ctx.tenantId,
    documentId,
    chunkIndex: chunk.index,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
    embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
    embeddingModel: vectors[i] ? embeddingModel : null,
    embeddingDims: vectors[i] ? embeddingDims : null,
  }));

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    await prisma.knowledgeChunk.createMany({ data: rows.slice(i, i + INSERT_BATCH_SIZE) });
  }

  const row = await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: {
      status: DOCUMENT_STATUS.ready,
      chunkCount: chunks.length,
      processedAt: new Date(),
      error: null,
    },
  });

  logger.info(
    `Knowledge document ${documentId} ready: ${chunks.length} chunk(s)` +
      (embeddingModel ? ` embedded with ${embeddingModel}.` : ", no embeddings.")
  );

  return {
    document: toDocumentView({ ...row, embeddingModel }),
    warning,
  };
}

/**
 * Advances the status column.
 *
 * updateMany with the tenant predicate rather than update by id: the id came
 * from a row this workspace owns, but keeping the predicate on every write means
 * the isolation does not depend on remembering that.
 */
async function setStatus(ctx: TenantContext, documentId: string, status: DocumentStatus) {
  await prisma.knowledgeDocument.updateMany({
    where: { id: documentId, tenantId: ctx.tenantId },
    data: { status },
  });
}

/**
 * Re-runs chunking and embedding from the stored extracted text.
 *
 * Works without the original file, which is the reason extracted text is kept:
 * a failed embedding, a changed chunk size or a new embedding model is a re-run
 * over text already on disk, not a re-upload.
 */
export async function reprocessDocument(
  ctx: TenantContext,
  documentId: string
): Promise<IngestResult | null> {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId: ctx.tenantId },
    select: { id: true, extractedText: true },
  });
  if (!row) return null;

  if (!row.extractedText) {
    throw new UploadValidationError(
      "There is no extracted text to reprocess. Upload the file again."
    );
  }

  try {
    return await chunkAndEmbed(ctx, row.id, row.extractedText);
  } catch (err: any) {
    const message = err?.message || String(err);
    const failed = await prisma.knowledgeDocument.update({
      where: { id: row.id },
      data: { status: DOCUMENT_STATUS.failed, error: message.slice(0, 2_000) },
    });
    return { document: toDocumentView(failed), warning: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  method: "embedding" | "keyword";
}

export interface RetrieveOptions {
  /** How many chunks to return. */
  limit?: number;
  /** Chunks scoring below this are dropped rather than padded in. */
  minScore?: number;
}

const RETRIEVE_DEFAULTS = {
  limit: 6,
  /**
   * Cosine similarity floor.
   *
   * Retrieval that always returns its top k fills the prompt with the least
   * irrelevant text in the library, which is how a grounded assistant starts
   * confidently citing an unrelated document. Returning nothing is a better
   * input to a prompt that is instructed to say it does not know.
   */
  minScore: 0.25,
  /** Keyword overlap is coarser, so it needs a lower bar to be useful at all. */
  keywordMinScore: 0.2,
} as const;

/**
 * Finds the knowledge chunks most relevant to a query, within one workspace.
 *
 * Embedding path: embed the query, then compare only against chunks embedded
 * with the same model. Keyword path: used when embedding is unavailable, or
 * when no chunk in the workspace carries a comparable vector.
 */
export async function retrieveChunks(
  ctx: TenantContext,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const cleanQuery = String(query ?? "").trim().slice(0, LIMITS.query);
  if (!cleanQuery) return [];

  const limit = Math.max(1, Math.min(options.limit ?? RETRIEVE_DEFAULTS.limit, 25));

  const semantic = await retrieveByEmbedding(ctx, cleanQuery, limit, options.minScore);
  if (semantic !== null) return semantic;

  return retrieveByKeyword(ctx, cleanQuery, limit, options.minScore);
}

/**
 * Returns null — not an empty array — when the semantic path is unavailable, so
 * the caller can distinguish "no embeddings here" from "nothing matched" and
 * only fall back in the first case.
 */
async function retrieveByEmbedding(
  ctx: TenantContext,
  query: string,
  limit: number,
  minScore?: number
): Promise<RetrievedChunk[] | null> {
  // Cheap check first: if this workspace has no vectors at all, skip the
  // embedding call entirely rather than paying for a query embedding that has
  // nothing to be compared against.
  const anyEmbedded = await prisma.knowledgeChunk.findFirst({
    where: { tenantId: ctx.tenantId, embeddingModel: { not: null } },
    select: { id: true },
  });
  if (!anyEmbedded) return null;

  let queryVector: number[];
  let model: string;
  try {
    const embedded = await embedTexts([query], {
      operation: "knowledge.retrieve",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    queryVector = embedded.vectors[0] || [];
    model = embedded.model;
  } catch (err: any) {
    logger.warn(`Knowledge retrieval fell back to keywords: ${err?.message || err}`);
    return null;
  }

  if (queryVector.length === 0) return null;

  const candidates = await prisma.knowledgeChunk.findMany({
    where: { tenantId: ctx.tenantId, embeddingModel: model },
    select: {
      id: true,
      documentId: true,
      content: true,
      embedding: true,
      document: { select: { title: true } },
    },
    take: MAX_SCAN_CHUNKS,
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length === 0) {
    // The workspace has vectors, but from a different model than the one now
    // serving queries. Comparing them would be meaningless, so use keywords.
    logger.warn(
      `Workspace ${ctx.tenantId} has no chunks embedded with ${model}; using keyword retrieval. ` +
        "Reprocess the documents to re-embed them."
    );
    return null;
  }

  const floor = minScore ?? RETRIEVE_DEFAULTS.minScore;
  const scored: RetrievedChunk[] = [];

  for (const row of candidates) {
    const vector = parseVector(row.embedding);
    if (!vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    if (score < floor) continue;
    scored.push({
      chunkId: row.id,
      documentId: row.documentId,
      documentTitle: row.document?.title ?? "Untitled document",
      content: row.content,
      score,
      method: "embedding",
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function retrieveByKeyword(
  ctx: TenantContext,
  query: string,
  limit: number,
  minScore?: number
): Promise<RetrievedChunk[]> {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t.length > 2)
    )
  ).slice(0, 12);

  if (terms.length === 0) return [];

  // Prefilter in the database so scoring reads only plausible rows.
  const candidates = await prisma.knowledgeChunk.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: terms.map((term) => ({ content: { contains: term } })),
    },
    select: {
      id: true,
      documentId: true,
      content: true,
      document: { select: { title: true } },
    },
    take: MAX_SCAN_CHUNKS,
    orderBy: { createdAt: "desc" },
  });

  const floor = minScore ?? RETRIEVE_DEFAULTS.keywordMinScore;

  return candidates
    .map((row: any) => ({
      chunkId: row.id,
      documentId: row.documentId,
      documentTitle: row.document?.title ?? "Untitled document",
      content: row.content,
      score: keywordScore(query, row.content),
      method: "keyword" as const,
    }))
    .filter((c) => c.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function parseVector(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.every((n) => typeof n === "number" && Number.isFinite(n))
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured knowledge items
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Labelled facts that do not have a column on BusinessProfile — warranty terms,
 * lead times, a certification number. Kept as rows so they can be added without
 * a migration per fact, and so each one carries its own confidence and source.
 */
export const KNOWLEDGE_CATEGORIES = [
  "company",
  "product",
  "service",
  "target_customer",
  "location",
  "usp",
  "certification",
  "pricing",
  "faq",
  "brand_voice",
  "other",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeItemView {
  id: string;
  category: string;
  label: string;
  value: string;
  confidence: number;
  source: string;
  sourceDocumentId: string | null;
  createdAt: Date;
}

function toItemView(row: any): KnowledgeItemView {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    value: row.value,
    confidence: row.confidence,
    source: row.source,
    sourceDocumentId: row.sourceDocumentId ?? null,
    createdAt: row.createdAt,
  };
}

export async function listKnowledgeItems(
  ctx: TenantContext,
  category?: string
): Promise<KnowledgeItemView[]> {
  const rows = await prisma.knowledgeItem.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(category && (KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)
        ? { category }
        : {}),
    },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toItemView);
}

export interface KnowledgeItemInput {
  category?: string;
  label?: string;
  value?: string;
  confidence?: number;
  source?: string;
  sourceDocumentId?: string | null;
}

export async function createKnowledgeItem(
  ctx: TenantContext,
  input: KnowledgeItemInput
): Promise<KnowledgeItemView> {
  const label = trimTo(input.label, 300);
  const value = trimTo(input.value, 4_000);
  if (!label) throw new UploadValidationError("A label is required.");
  if (!value) throw new UploadValidationError("A value is required.");

  const category = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(input.category || "")
    ? (input.category as string)
    : "other";

  // A referenced document must belong to this workspace, otherwise the
  // reference is dropped rather than allowed to point across the boundary.
  let sourceDocumentId: string | null = null;
  if (input.sourceDocumentId) {
    const owned = await prisma.knowledgeDocument.findFirst({
      where: { id: input.sourceDocumentId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    sourceDocumentId = owned?.id ?? null;
  }

  const row = await prisma.knowledgeItem.create({
    data: {
      tenantId: ctx.tenantId,
      category,
      label,
      value,
      confidence:
        typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1
          ? input.confidence
          : 1,
      source: input.source === "document" || input.source === "conversation" ? input.source : "user",
      sourceDocumentId,
    },
  });
  return toItemView(row);
}

export async function deleteKnowledgeItem(ctx: TenantContext, itemId: string): Promise<boolean> {
  const owned = await prisma.knowledgeItem.findFirst({
    where: { id: itemId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  await prisma.knowledgeItem.delete({ where: { id: owned.id } });
  return true;
}
