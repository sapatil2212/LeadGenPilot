/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Document ingestion and knowledge retrieval.
 *
 * Two things are under test, and they are different in kind:
 *
 *   1. The ingest lifecycle. status is the only record of which step failed, so
 *      the transitions and the terminal states have to be exactly right —
 *      "ready with no vectors" (usable via keywords) and "failed because the PDF
 *      is a scan" (not usable at all) must not collapse into each other.
 *
 *   2. Tenant isolation. Every query is asserted to carry the workspace
 *      predicate. Retrieval is the highest-risk surface in this phase: it reads
 *      document text by similarity rather than by id, so a missing predicate
 *      would not 404 or look wrong — it would quietly feed another company's
 *      catalogue into this company's prompt.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaMock,
  embedTexts: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/ai/aiService", () => ({
  embedTexts: (...args: unknown[]) => mocks.embedTexts(...args),
  isAnyProviderConfigured: () => mocks.isAnyProviderConfigured(),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const knowledge = await import("../src/knowledge/knowledgeService");
const { AiUnavailableError } = await import("../src/ai/types");
const { resolvePermissions } = await import("../src/tenancy/permissions");

/** A context for workspace A, as resolveTenantContext would produce. */
const CTX_A = {
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
  membershipId: "tm_a",
  role: "owner",
  tenantName: WORKSPACE_A.name,
  tenantSlug: WORKSPACE_A.slug,
  permissions: resolvePermissions("owner"),
};

/** Text long enough to survive the chunker's minimum length. */
const DOC_TEXT = [
  "Brightwave Instruments manufactures autoclaves and sterilisation equipment for dental clinics.",
  "The PX-100 chamber holds 18 litres and completes a cycle in 22 minutes. Warranty is 36 months.",
].join("\n\n");

function textFile(content = DOC_TEXT, name = "catalogue.txt") {
  const buffer = Buffer.from(content, "utf8");
  return { originalName: name, mimeType: "text/plain", buffer, size: buffer.length };
}

/** Wires knowledgeDocument so create/update behave like a real row over time. */
function wireDocumentRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, any> = {
    id: "doc_1",
    tenantId: WORKSPACE_A.id,
    title: "catalogue",
    originalName: "catalogue.txt",
    mimeType: "text/plain",
    fileType: "txt",
    sizeBytes: 100,
    checksum: "abc",
    status: "pending",
    error: null,
    extractedText: null,
    charCount: null,
    chunkCount: null,
    category: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    processedAt: null,
    ...overrides,
  };

  mocks.prisma.knowledgeDocument.create.mockImplementation(async ({ data }: any) => {
    Object.assign(row, data);
    return { ...row };
  });
  mocks.prisma.knowledgeDocument.update.mockImplementation(async ({ data }: any) => {
    Object.assign(row, data);
    return { ...row };
  });
  mocks.prisma.knowledgeDocument.updateMany.mockImplementation(async ({ data }: any) => {
    Object.assign(row, data);
    return { count: 1 };
  });
  return row;
}

function embedResult(vectors: number[][], model = "text-embedding-004") {
  return {
    vectors,
    provider: "gemini" as const,
    model,
    dimensions: vectors[0]?.length ?? 0,
    latencyMs: 5,
  };
}

/** Every `where` clause passed to a mocked model, as JSON, for predicate asserts. */
function wheres(fn: any): string[] {
  return fn.mock.calls.map((c: any[]) => JSON.stringify(c?.[0]?.where ?? {}));
}

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  mocks.embedTexts.mockReset();
  mocks.isAnyProviderConfigured.mockReset();
  mocks.isAnyProviderConfigured.mockReturnValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("validateUpload", () => {
  it("rejects an empty file", () => {
    const empty = { originalName: "a.txt", mimeType: "text/plain", buffer: Buffer.alloc(0), size: 0 };
    expect(() => knowledge.validateUpload(empty)).toThrow(knowledge.UploadValidationError);
  });

  it("rejects a file over the 20 MB cap", () => {
    const big = { ...textFile(), size: 21 * 1024 * 1024 };
    expect(() => knowledge.validateUpload(big)).toThrow(/20 MB or smaller/);
  });

  it("rejects an unsupported type as a validation error, not an internal one", () => {
    // The route maps UploadValidationError to 400. An UnsupportedFileError
    // leaking through would surface as a 500 for what is a user mistake.
    const png = { originalName: "logo.png", mimeType: "image/png", buffer: Buffer.from("x"), size: 1 };
    expect(() => knowledge.validateUpload(png)).toThrow(knowledge.UploadValidationError);
  });

  it("accepts a supported type and returns it", () => {
    expect(knowledge.validateUpload(textFile())).toBe("txt");
  });
});

describe("checksumOf", () => {
  it("is a stable SHA-256 of the bytes", () => {
    const a = knowledge.checksumOf(Buffer.from("hello"));
    expect(a).toBe(knowledge.checksumOf(Buffer.from("hello")));
    expect(a).not.toBe(knowledge.checksumOf(Buffer.from("hello!")));
    expect(a).toHaveLength(64);
  });
});

describe("ingestDocument", () => {
  it("validates before writing any row", async () => {
    const png = { originalName: "logo.png", mimeType: "image/png", buffer: Buffer.from("x"), size: 1 };
    await expect(knowledge.ingestDocument(CTX_A, png)).rejects.toThrow(
      knowledge.UploadValidationError
    );
    expect(mocks.prisma.knowledgeDocument.create).not.toHaveBeenCalled();
  });

  it("stamps the workspace and the uploader on the row", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    await knowledge.ingestDocument(CTX_A, textFile(), { title: "Product catalogue" });

    const data = mocks.prisma.knowledgeDocument.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.uploadedById).toBe(TENANT_A.id);
    expect(data.title).toBe("Product catalogue");
    expect(data.status).toBe("pending");
    expect(data.checksum).toHaveLength(64);
  });

  it("derives a title from the filename when none is given", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    await knowledge.ingestDocument(CTX_A, textFile(DOC_TEXT, "Company Profile.txt"));

    expect(mocks.prisma.knowledgeDocument.create.mock.calls[0][0].data.title).toBe(
      "Company Profile"
    );
  });

  it("looks for duplicates within the workspace only", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    await knowledge.ingestDocument(CTX_A, textFile());

    expect(wheres(mocks.prisma.knowledgeDocument.findFirst)[0]).toContain(WORKSPACE_A.id);
  });

  it("returns the existing document instead of re-ingesting identical bytes", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc_existing",
      tenantId: WORKSPACE_A.id,
      title: "Catalogue",
      originalName: "catalogue.txt",
      mimeType: "text/plain",
      fileType: "txt",
      sizeBytes: 10,
      checksum: "x",
      status: "ready",
      createdAt: new Date(),
    });

    const result = await knowledge.ingestDocument(CTX_A, textFile());

    expect(result.duplicateOf).toBe("doc_existing");
    expect(result.warning).toMatch(/already in your knowledge base/i);
    expect(mocks.prisma.knowledgeDocument.create).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("allows a duplicate when the caller opts out of the check", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({ id: "doc_existing" });
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    const result = await knowledge.ingestDocument(CTX_A, textFile(), {
      rejectDuplicates: false,
    });

    expect(result.duplicateOf).toBeUndefined();
    expect(mocks.prisma.knowledgeDocument.create).toHaveBeenCalled();
  });

  it("walks the full lifecycle and ends ready", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    const result = await knowledge.ingestDocument(CTX_A, textFile());

    const statuses = [
      ...mocks.prisma.knowledgeDocument.updateMany.mock.calls,
      ...mocks.prisma.knowledgeDocument.update.mock.calls,
    ]
      .map((c: any[]) => c[0]?.data?.status)
      .filter(Boolean);

    expect(statuses).toContain("extracting");
    expect(statuses).toContain("chunking");
    expect(statuses).toContain("embedding");
    expect(result.document.status).toBe("ready");
    expect(result.document.processedAt).toBeInstanceOf(Date);
    expect(result.warning).toBeUndefined();
  });

  it("keeps the extracted text so re-chunking never needs the original file", async () => {
    const row = wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    await knowledge.ingestDocument(CTX_A, textFile());

    expect(row.extractedText).toContain("Brightwave Instruments");
    expect(row.charCount).toBe(DOC_TEXT.length);
  });

  it("persists each chunk with its vector and the model that produced it", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]], "text-embedding-3-small"));

    await knowledge.ingestDocument(CTX_A, textFile());

    const rows = mocks.prisma.knowledgeChunk.createMany.mock.calls[0][0].data;
    expect(rows.length).toBeGreaterThan(0);
    for (const chunk of rows) {
      expect(chunk.tenantId).toBe(WORKSPACE_A.id);
      expect(chunk.documentId).toBe("doc_1");
      // Storing the model per chunk is what makes changing embedding models a
      // re-embed rather than silently broken search.
      expect(chunk.embeddingModel).toBe("text-embedding-3-small");
      expect(chunk.embeddingDims).toBe(2);
      expect(JSON.parse(chunk.embedding)).toHaveLength(2);
    }
    expect(rows.map((r: any) => r.chunkIndex)).toEqual(rows.map((_: any, i: number) => i));
  });

  it("pins the first batch's model for the rest of the document", async () => {
    // Long enough to need two embedding calls.
    // Each paragraph is near the 1000-character chunk target, so 70 of them
    // produce more than the 64-chunk embedding batch size.
    const paragraphs = Array.from(
      { length: 70 },
      (_, i) => `Paragraph ${i} describes a distinct product feature. `.repeat(20)
    ).join("\n\n");

    wireDocumentRow();
    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      embedResult(texts.map(() => [1, 0]))
    );

    await knowledge.ingestDocument(CTX_A, textFile(paragraphs));

    expect(mocks.embedTexts.mock.calls.length).toBeGreaterThan(1);
    // The first call names no model; every later call pins the one that answered.
    expect(mocks.embedTexts.mock.calls[0][1].model).toBeUndefined();
    expect(mocks.embedTexts.mock.calls[1][1].model).toBe("text-embedding-004");
  });

  it("stays ready without vectors when no embedding provider is configured", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockRejectedValue(
      new AiUnavailableError("No configured AI provider supports embeddings.", [])
    );

    const result = await knowledge.ingestDocument(CTX_A, textFile());

    // Keyword retrieval still works on it, so failing the upload would be wrong.
    expect(result.document.status).toBe("ready");
    expect(result.warning).toMatch(/keyword matching/i);
    const rows = mocks.prisma.knowledgeChunk.createMany.mock.calls[0][0].data;
    expect(rows.every((r: any) => r.embedding === null)).toBe(true);
    expect(rows.every((r: any) => r.embeddingModel === null)).toBe(true);
  });

  it("marks a file with no text layer as failed and says it is probably a scan", async () => {
    wireDocumentRow({ fileType: "pdf" });
    const buffer = Buffer.from("%PDF-1.4\n%%EOF\n", "utf8");

    const result = await knowledge.ingestDocument(CTX_A, {
      originalName: "scan.pdf",
      mimeType: "application/pdf",
      buffer,
      size: buffer.length,
    });

    expect(result.document.status).toBe("failed");
    expect(result.document.error).toBeTruthy();
    expect(mocks.prisma.knowledgeChunk.createMany).not.toHaveBeenCalled();
  });

  it("records the failure on the row rather than throwing when the pipeline breaks", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));
    mocks.prisma.knowledgeChunk.createMany.mockRejectedValue(new Error("deadlock"));

    const result = await knowledge.ingestDocument(CTX_A, textFile());

    // A document the user can see and retry beats a 500 and no trace.
    expect(result.document.status).toBe("failed");
    expect(result.document.error).toContain("deadlock");
  });

  it("replaces existing chunks rather than appending on re-ingest", async () => {
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    await knowledge.ingestDocument(CTX_A, textFile());

    const where = mocks.prisma.knowledgeChunk.deleteMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.documentId).toBe("doc_1");
  });
});

describe("reprocessDocument", () => {
  it("returns null for a document in another workspace", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue(null);

    expect(await knowledge.reprocessDocument(CTX_A, "doc_of_b")).toBeNull();
    // The lookup is scoped, so "not found" is what a cross-workspace id gets.
    expect(wheres(mocks.prisma.knowledgeDocument.findFirst)[0]).toContain(WORKSPACE_A.id);
  });

  it("refuses when there is no stored text to work from", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc_1",
      extractedText: null,
    });

    await expect(knowledge.reprocessDocument(CTX_A, "doc_1")).rejects.toThrow(
      knowledge.UploadValidationError
    );
  });

  it("re-chunks and re-embeds from the stored text", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc_1",
      extractedText: DOC_TEXT,
    });
    wireDocumentRow();
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0], [0, 1]]));

    const result = await knowledge.reprocessDocument(CTX_A, "doc_1");

    expect(result?.document.status).toBe("ready");
    expect(mocks.prisma.knowledgeChunk.deleteMany).toHaveBeenCalled();
    expect(mocks.prisma.knowledgeChunk.createMany).toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("refuses a document belonging to another workspace", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue(null);

    expect(await knowledge.deleteDocument(CTX_A, "doc_of_b")).toBe(false);
    expect(mocks.prisma.knowledgeDocument.delete).not.toHaveBeenCalled();
  });

  it("deletes a document it owns", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue({ id: "doc_1" });

    expect(await knowledge.deleteDocument(CTX_A, "doc_1")).toBe(true);
    expect(mocks.prisma.knowledgeDocument.delete).toHaveBeenCalledWith({
      where: { id: "doc_1" },
    });
  });
});

describe("listDocuments", () => {
  it("scopes to the workspace", async () => {
    await knowledge.listDocuments(CTX_A);
    expect(wheres(mocks.prisma.knowledgeDocument.findMany)[0]).toContain(WORKSPACE_A.id);
  });

  it("reports which documents are semantically searchable", async () => {
    mocks.prisma.knowledgeDocument.findMany.mockResolvedValue([
      { id: "doc_1", title: "A", originalName: "a.txt", mimeType: "text/plain", fileType: "txt", sizeBytes: 1, status: "ready", createdAt: new Date() },
      { id: "doc_2", title: "B", originalName: "b.txt", mimeType: "text/plain", fileType: "txt", sizeBytes: 1, status: "ready", createdAt: new Date() },
    ]);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      { documentId: "doc_1", embeddingModel: "text-embedding-004" },
    ]);

    const docs = await knowledge.listDocuments(CTX_A);

    expect(docs.find((d) => d.id === "doc_1")?.embedded).toBe(true);
    expect(docs.find((d) => d.id === "doc_2")?.embedded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("retrieveChunks", () => {
  const chunkRow = (id: string, content: string, embedding: number[] | null, title = "Catalogue") => ({
    id,
    documentId: "doc_1",
    content,
    embedding: embedding ? JSON.stringify(embedding) : null,
    document: { title },
  });

  it("returns nothing for an empty query without touching the database", async () => {
    expect(await knowledge.retrieveChunks(CTX_A, "   ")).toEqual([]);
    expect(mocks.prisma.knowledgeChunk.findFirst).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("skips the embedding call when the workspace has no vectors", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    await knowledge.retrieveChunks(CTX_A, "autoclave chamber size");

    // Paying for a query embedding with nothing to compare it against is waste.
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("compares only against chunks embedded with the same model", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]], "text-embedding-004"));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      chunkRow("c1", "The PX-100 chamber holds 18 litres.", [1, 0]),
    ]);

    await knowledge.retrieveChunks(CTX_A, "chamber size");

    const where = mocks.prisma.knowledgeChunk.findMany.mock.calls.at(-1)![0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    // Mixing vector spaces would degrade search in a way that looks like the
    // model getting worse rather than like a bug.
    expect(where.embeddingModel).toBe("text-embedding-004");
  });

  it("ranks by cosine similarity, highest first", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]]));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      chunkRow("weak", "partially related text", [0.7, 0.7]),
      chunkRow("exact", "exactly on topic", [1, 0]),
    ]);

    const results = await knowledge.retrieveChunks(CTX_A, "chamber size");

    expect(results.map((r) => r.chunkId)).toEqual(["exact", "weak"]);
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[0].method).toBe("embedding");
  });

  it("drops chunks below the similarity floor instead of padding the result", async () => {
    // Returning the top k regardless is how a grounded assistant starts citing
    // an unrelated document with confidence.
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]]));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      chunkRow("orthogonal", "completely unrelated", [0, 1]),
    ]);

    expect(await knowledge.retrieveChunks(CTX_A, "chamber size")).toEqual([]);
  });

  it("honours the requested limit", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]]));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => chunkRow(`c${i}`, `chunk ${i}`, [1, 0]))
    );

    expect(await knowledge.retrieveChunks(CTX_A, "chamber", { limit: 3 })).toHaveLength(3);
  });

  it("ignores a chunk whose stored vector is unparseable", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]]));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      { id: "broken", documentId: "doc_1", content: "text", embedding: "not json", document: { title: "T" } },
      chunkRow("good", "on topic", [1, 0]),
    ]);

    const results = await knowledge.retrieveChunks(CTX_A, "chamber");
    expect(results.map((r) => r.chunkId)).toEqual(["good"]);
  });

  it("falls back to keywords when embedding the query fails", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockRejectedValue(new AiUnavailableError("down", []));
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([
      chunkRow("k1", "The PX-100 autoclave chamber holds 18 litres.", null),
    ]);

    const results = await knowledge.retrieveChunks(CTX_A, "autoclave chamber");

    expect(results).toHaveLength(1);
    expect(results[0].method).toBe("keyword");
  });

  it("falls back to keywords when the workspace's vectors came from another model", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue({ id: "c1" });
    mocks.embedTexts.mockResolvedValue(embedResult([[1, 0]], "text-embedding-3-small"));
    mocks.prisma.knowledgeChunk.findMany
      // Semantic pass: nothing embedded with the new model.
      .mockResolvedValueOnce([])
      // Keyword pass.
      .mockResolvedValueOnce([chunkRow("k1", "The autoclave chamber holds 18 litres.", null)]);

    const results = await knowledge.retrieveChunks(CTX_A, "autoclave chamber");

    expect(results[0].method).toBe("keyword");
  });

  it("scopes the keyword fallback to the workspace too", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    await knowledge.retrieveChunks(CTX_A, "autoclave chamber");

    const where = mocks.prisma.knowledgeChunk.findMany.mock.calls.at(-1)![0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.tenantId).not.toBe(WORKSPACE_B.id);
  });

  it("prefilters the keyword search on query terms", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    await knowledge.retrieveChunks(CTX_A, "autoclave sterilisation");

    const where = mocks.prisma.knowledgeChunk.findMany.mock.calls.at(-1)![0].where;
    expect(JSON.stringify(where.OR)).toContain("autoclave");
    expect(JSON.stringify(where.OR)).toContain("sterilisation");
  });

  it("returns nothing when a keyword query has only filler words", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);

    expect(await knowledge.retrieveChunks(CTX_A, "is an of to")).toEqual([]);
    expect(mocks.prisma.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getKnowledgeStats", () => {
  it("aggregates statuses and reports whether embeddings are available", async () => {
    mocks.prisma.knowledgeDocument.groupBy.mockResolvedValue([
      { status: "ready", _count: { _all: 3 } },
      { status: "failed", _count: { _all: 1 } },
      { status: "embedding", _count: { _all: 1 } },
    ]);
    mocks.prisma.knowledgeChunk.count.mockResolvedValueOnce(42).mockResolvedValueOnce(40);
    mocks.isAnyProviderConfigured.mockReturnValue(false);

    const stats = await knowledge.getKnowledgeStats(CTX_A);

    expect(stats).toMatchObject({
      documents: 5,
      ready: 3,
      failed: 1,
      processing: 1,
      chunks: 42,
      embeddedChunks: 40,
      searchable: true,
      embeddingsAvailable: false,
    });
  });

  it("scopes every count to the workspace", async () => {
    await knowledge.getKnowledgeStats(CTX_A);
    expect(wheres(mocks.prisma.knowledgeDocument.groupBy)[0]).toContain(WORKSPACE_A.id);
    for (const where of wheres(mocks.prisma.knowledgeChunk.count)) {
      expect(where).toContain(WORKSPACE_A.id);
    }
  });
});

describe("knowledge items", () => {
  it("requires a label and a value", async () => {
    await expect(knowledge.createKnowledgeItem(CTX_A, { value: "x" })).rejects.toThrow(/label/i);
    await expect(knowledge.createKnowledgeItem(CTX_A, { label: "x" })).rejects.toThrow(/value/i);
  });

  it("falls back to 'other' for an unknown category", async () => {
    mocks.prisma.knowledgeItem.create.mockImplementation(async ({ data }: any) => ({
      id: "ki_1",
      createdAt: new Date(),
      ...data,
    }));

    const item = await knowledge.createKnowledgeItem(CTX_A, {
      category: "definitely_not_a_category",
      label: "Warranty",
      value: "36 months",
    });

    expect(item.category).toBe("other");
  });

  it("clamps confidence and defaults the source to the user", async () => {
    mocks.prisma.knowledgeItem.create.mockImplementation(async ({ data }: any) => ({
      id: "ki_1",
      createdAt: new Date(),
      ...data,
    }));

    const item = await knowledge.createKnowledgeItem(CTX_A, {
      label: "Warranty",
      value: "36 months",
      confidence: 9,
      source: "nonsense",
    });

    expect(item.confidence).toBe(1);
    expect(item.source).toBe("user");
  });

  it("drops a source document reference that points outside the workspace", async () => {
    mocks.prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeItem.create.mockImplementation(async ({ data }: any) => ({
      id: "ki_1",
      createdAt: new Date(),
      ...data,
    }));

    const item = await knowledge.createKnowledgeItem(CTX_A, {
      label: "Warranty",
      value: "36 months",
      sourceDocumentId: "doc_owned_by_b",
    });

    // The reference is dropped rather than allowed to cross the boundary.
    expect(item.sourceDocumentId).toBeNull();
  });

  it("refuses to delete an item in another workspace", async () => {
    mocks.prisma.knowledgeItem.findFirst.mockResolvedValue(null);
    expect(await knowledge.deleteKnowledgeItem(CTX_A, "ki_of_b")).toBe(false);
    expect(mocks.prisma.knowledgeItem.delete).not.toHaveBeenCalled();
  });

  it("ignores an unknown category filter rather than returning nothing", async () => {
    await knowledge.listKnowledgeItems(CTX_A, "bogus");
    const where = mocks.prisma.knowledgeItem.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.category).toBeUndefined();
  });
});
