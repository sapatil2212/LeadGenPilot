/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI assistant API.
 *
 * Everything is scoped to the resolved workspace, including the conversation
 * lookup: asking with another workspace's conversationId returns "not found"
 * rather than answering into it.
 *
 * Reads and asking need VIEW_ANALYTICS — the assistant explains the workspace's
 * own data, which is work any member does. Deleting a thread needs
 * MANAGE_BUSINESS_PROFILE, because a conversation is the record of what the
 * business told the AI and what it answered back.
 */

import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import { AiUnavailableError } from "../ai/types";
import { isAnyProviderConfigured } from "../ai/aiService";
import * as assistant from "./assistantService";

const router = express.Router();

router.use(resolveTenantContext);

const NOT_FOUND = { error: "Conversation not found.", code: "not_found" } as const;

function fail(res: Response, err: any, context: string) {
  if (err instanceof assistant.AssistantInputError) {
    // "Conversation not found" arrives as an input error from askAssistant,
    // where refusing is deliberate: silently starting a new thread would hide a
    // client pointing at something it cannot see.
    const status = err.message === "Conversation not found." ? 404 : 400;
    return res.status(status).json({
      error: err.message,
      code: status === 404 ? "not_found" : "validation",
    });
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

/** GET /api/assistant/status — whether the assistant can answer at all. */
router.get("/status", requirePermission("VIEW_ANALYTICS"), (_req: Request, res: Response) => {
  const available = isAnyProviderConfigured();
  res.json({
    available,
    ...(available
      ? {}
      : {
          reason:
            "No AI provider is configured. Set GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY.",
        }),
  });
});

/** GET /api/assistant/conversations?includeArchived=true */
router.get(
  "/conversations",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      res.json(
        await assistant.listConversations(ctxOf(req), {
          includeArchived: req.query.includeArchived === "true",
        })
      );
    } catch (err) {
      fail(res, err, "Fetching conversations");
    }
  }
);

/** POST /api/assistant/conversations — start an empty thread. */
router.post(
  "/conversations",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      res.status(201).json(
        await assistant.createConversation(ctxOf(req), {
          title: typeof body.title === "string" ? body.title : null,
          kind: typeof body.kind === "string" ? body.kind : undefined,
        })
      );
    } catch (err) {
      fail(res, err, "Creating the conversation");
    }
  }
);

/** GET /api/assistant/conversations/:id — the thread with its messages. */
router.get(
  "/conversations/:id",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const conversation = await assistant.getConversation(ctxOf(req), req.params.id);
      if (!conversation) return res.status(404).json(NOT_FOUND);
      res.json(conversation);
    } catch (err) {
      fail(res, err, "Fetching the conversation");
    }
  }
);

/** PATCH /api/assistant/conversations/:id — rename. */
router.patch(
  "/conversations/:id",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const updated = await assistant.renameConversation(
        ctxOf(req),
        req.params.id,
        String(req.body?.title ?? "")
      );
      if (!updated) return res.status(404).json(NOT_FOUND);
      res.json(updated);
    } catch (err) {
      fail(res, err, "Renaming the conversation");
    }
  }
);

/** POST /api/assistant/conversations/:id/archive — hide without destroying. */
router.post(
  "/conversations/:id/archive",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const archived = await assistant.archiveConversation(ctxOf(req), req.params.id);
      if (!archived) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Archiving the conversation");
    }
  }
);

/** DELETE /api/assistant/conversations/:id — permanent, so it needs the stronger permission. */
router.delete(
  "/conversations/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await assistant.deleteConversation(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting the conversation");
    }
  }
);

/**
 * POST /api/assistant/ask
 *
 * Body: { question, conversationId?, kind? }
 *
 * Returns the answer plus the citations it was grounded in, so the UI can show
 * which documents an answer came from instead of asking the user to trust it.
 */
router.post("/ask", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    res.json(
      await assistant.askAssistant(ctxOf(req), {
        question: String(body.question ?? ""),
        conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
        kind: typeof body.kind === "string" ? body.kind : undefined,
      })
    );
  } catch (err) {
    fail(res, err, "Answering the question");
  }
});

export default router;
