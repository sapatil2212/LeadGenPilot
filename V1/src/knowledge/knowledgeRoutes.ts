/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge base API: document upload, listing, retrieval and structured facts.
 *
 * Uploads use multer's in-memory storage. The file never touches disk: it is
 * parsed, chunked and discarded, and the extracted text is what persists. That
 * removes a whole class of problem — a temp directory filling up, a path
 * traversal from a caller-supplied filename, orphaned files after a failed
 * ingest — in exchange for holding at most 20 MB in a buffer, which is the
 * upload cap anyway.
 *
 * Reads need VIEW_ANALYTICS; changing the knowledge base needs
 * MANAGE_BUSINESS_PROFILE, because these documents are what the AI treats as
 * fact when it writes to a prospect.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { logger } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import { AiUnavailableError } from "../ai/types";
import { UPLOAD_RULES } from "./extraction";
import * as knowledge from "./knowledgeService";
import { extractBusinessKnowledge } from "../business/businessService";

const router = express.Router();

router.use(resolveTenantContext);

const NOT_FOUND_DOCUMENT = { error: "Document not found.", code: "not_found" } as const;

/**
 * One file per request, capped at the service's own limit.
 *
 * The limit is enforced here as well as in validateUpload so an oversized body
 * is rejected while streaming, rather than after 200 MB has been buffered.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_RULES.maxBytes, files: 1 },
});

/** Turns multer's own errors into the same shape as our validation errors. */
function uploadSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const limitMb = Math.round(UPLOAD_RULES.maxBytes / (1024 * 1024));
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `Files must be ${limitMb} MB or smaller.`
            : err.code === "LIMIT_FILE_COUNT"
              ? "Upload one file at a time."
              : `Upload rejected: ${err.message}`;
        return res.status(400).json({ error: message, code: "validation" });
      }
      return next(err);
    });
  };
}

function fail(res: Response, err: any, context: string) {
  if (err instanceof knowledge.UploadValidationError) {
    return res.status(400).json({ error: err.message, code: "validation" });
  }
  if (err instanceof AiUnavailableError) {
    logger.warn(`${context}: no AI provider available — ${err.message}`);
    return res.status(503).json({
      error: "No AI provider is currently available. Try again shortly.",
      code: "ai_unavailable",
      attempts: err.attempts,
    });
  }
  logger.error(`${context} failed`, err);
  return res.status(500).json({ error: `${context} failed.`, code: "internal" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/knowledge/documents */
router.get("/documents", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await knowledge.listDocuments(ctxOf(req)));
  } catch (err) {
    fail(res, err, "Fetching documents");
  }
});

/** GET /api/knowledge/stats */
router.get("/stats", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await knowledge.getKnowledgeStats(ctxOf(req)));
  } catch (err) {
    fail(res, err, "Fetching knowledge statistics");
  }
});

/**
 * GET /api/knowledge/documents/:id?includeText=true
 *
 * The extracted text is large, so it is opt-in rather than part of every read.
 */
router.get(
  "/documents/:id",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const doc = await knowledge.getDocument(ctxOf(req), req.params.id);
      if (!doc) return res.status(404).json(NOT_FOUND_DOCUMENT);
      if (req.query.includeText !== "true") {
        const { extractedText: _omitted, ...rest } = doc;
        return res.json(rest);
      }
      res.json(doc);
    } catch (err) {
      fail(res, err, "Fetching the document");
    }
  }
);

/**
 * POST /api/knowledge/documents — multipart upload.
 *
 * Fields: file (required), title, category, learn ("true" to also extract
 * business details for review).
 *
 * Returns 200 with a `warning` rather than an error when the file was stored but
 * is not searchable (a scanned PDF, or no embedding provider). The distinction
 * matters to the UI: one needs a different file, the other needs configuration,
 * and neither means "the upload broke".
 */
router.post(
  "/documents",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  uploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as
        | { originalname: string; mimetype: string; buffer: Buffer; size: number }
        | undefined;

      if (!file) {
        return res.status(400).json({ error: "No file was uploaded.", code: "validation" });
      }

      const ctx = ctxOf(req);
      const result = await knowledge.ingestDocument(
        ctx,
        {
          originalName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          size: file.size,
        },
        {
          title: typeof req.body?.title === "string" ? req.body.title : null,
          category: typeof req.body?.category === "string" ? req.body.category : null,
        }
      );

      // Optional: also read business details out of the document. Never applied
      // automatically — it comes back for review, because a brochure's marketing
      // copy is not automatically a fact about the business.
      let extracted: unknown = undefined;
      if (req.body?.learn === "true" && result.document.status === "ready") {
        const doc = await knowledge.getDocument(ctx, result.document.id);
        if (doc?.extractedText) {
          try {
            const outcome = await extractBusinessKnowledge(ctx, doc.extractedText, {
              apply: false,
              sourceDocumentId: doc.id,
            });
            extracted = outcome.extracted;
          } catch (err: any) {
            // The document itself ingested fine. Report the extraction failure
            // without failing the upload.
            logger.warn(`Business extraction from document ${doc.id} failed: ${err?.message || err}`);
          }
        }
      }

      res.status(result.duplicateOf ? 200 : 201).json({ ...result, extracted });
    } catch (err) {
      fail(res, err, "Uploading the document");
    }
  }
);

/** POST /api/knowledge/documents/:id/reprocess — re-chunk and re-embed. */
router.post(
  "/documents/:id/reprocess",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const result = await knowledge.reprocessDocument(ctxOf(req), req.params.id);
      if (!result) return res.status(404).json(NOT_FOUND_DOCUMENT);
      res.json(result);
    } catch (err) {
      fail(res, err, "Reprocessing the document");
    }
  }
);

/** DELETE /api/knowledge/documents/:id — removes the document and its chunks. */
router.delete(
  "/documents/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await knowledge.deleteDocument(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND_DOCUMENT);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting the document");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/knowledge/search — the retrieval the assistant uses.
 *
 * Exposed on its own so the ranking can be inspected directly. When an answer
 * looks wrong, the first question is whether the right excerpts were retrieved,
 * and that is unanswerable if retrieval is only reachable through a chat turn.
 */
router.post("/search", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    if (!query) {
      return res.status(400).json({ error: "A query is required.", code: "validation" });
    }
    const limit = Number.parseInt(String(req.body?.limit ?? ""), 10);
    const results = await knowledge.retrieveChunks(ctxOf(req), query, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ query, count: results.length, results });
  } catch (err) {
    fail(res, err, "Searching the knowledge base");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Structured facts
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/knowledge/items?category=pricing */
router.get("/items", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.json(await knowledge.listKnowledgeItems(ctxOf(req), category));
  } catch (err) {
    fail(res, err, "Fetching knowledge items");
  }
});

/** POST /api/knowledge/items */
router.post(
  "/items",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const item = await knowledge.createKnowledgeItem(ctxOf(req), {
        category: typeof body.category === "string" ? body.category : undefined,
        label: body.label,
        value: body.value,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        source: typeof body.source === "string" ? body.source : undefined,
        sourceDocumentId:
          typeof body.sourceDocumentId === "string" ? body.sourceDocumentId : undefined,
      });
      res.status(201).json(item);
    } catch (err) {
      fail(res, err, "Creating a knowledge item");
    }
  }
);

/** DELETE /api/knowledge/items/:id */
router.delete(
  "/items/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await knowledge.deleteKnowledgeItem(ctxOf(req), req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Knowledge item not found.", code: "not_found" });
      }
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting a knowledge item");
    }
  }
);

/** GET /api/knowledge/categories — the allowed item categories. */
router.get("/categories", requirePermission("VIEW_ANALYTICS"), (_req: Request, res: Response) => {
  res.json({ categories: knowledge.KNOWLEDGE_CATEGORIES });
});

export default router;
