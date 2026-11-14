/**
 * MessageTemplate REST API — tenant-scoped CRUD, preview rendering & prebuilts.
 *
 * Mounted at /api/message-templates in server.ts. Follows the same middleware
 * chain as the existing template routes: resolveTenantContext → requirePermission
 * → handler. Read operations need VIEW_ANALYTICS; writes need MANAGE_TEMPLATES.
 */

import { Router, type Request, type Response } from "express";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import { logger } from "../logger";
import { heavyActionRateLimiter } from "../security";
import { AiUnavailableError } from "../ai/types";
import { MissingTemplateContextError } from "../business/templateGenerator";
import {
  MessageTemplateValidationError,
  listMessageTemplates,
  getMessageTemplate,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  duplicateMessageTemplate,
} from "./messageTemplateService";
import { generateMessageTemplateDraft, generateStarterSuggestions } from "./messageTemplateGenerator";
import { validateForSend, hasErrors } from "./validation";
import { render } from "./renderers";
import { buildSampleValueMap } from "./variables";
import { getPrebuiltTemplates } from "./prebuiltTemplates";
import type { DeliveryMethod } from "./types";

const router = Router();
router.use(resolveTenantContext);

function fail(res: Response, err: any, context: string) {
  if (err instanceof MessageTemplateValidationError || err instanceof MissingTemplateContextError) {
    return res.status(400).json({ error: err.message, code: "validation" });
  }
  if (err instanceof AiUnavailableError) {
    return res.status(503).json({
      error:
        "No AI provider could answer right now. Check that at least one of " +
        "GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY " +
        "is set to a valid key, then try again.",
      code: "ai_unavailable",
      attempts: err.attempts,
    });
  }
  logger.error(`${context} failed`, err);
  return res.status(500).json({ error: `${context} failed.`, code: "internal" });
}

// ─────────────────────────────────────────────────────────────────────────────
// List & read
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/message-templates */
router.get("/", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const templates = await listMessageTemplates(ctxOf(req), {
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      channel: typeof req.query.channel === "string" ? req.query.channel : undefined,
      deliveryMethod: typeof req.query.deliveryMethod === "string" ? req.query.deliveryMethod : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      language: typeof req.query.language === "string" ? req.query.language : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      isPrebuilt: req.query.isPrebuilt === "true" ? true : req.query.isPrebuilt === "false" ? false : undefined,
    });
    res.json({ ok: true, templates });
  } catch (err) {
    fail(res, err, "Listing message templates");
  }
});

/** GET /api/message-templates/prebuilt — starter template library */
router.get("/prebuilt", requirePermission("VIEW_ANALYTICS"), async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, templates: getPrebuiltTemplates() });
  } catch (err) {
    fail(res, err, "Fetching prebuilt templates");
  }
});

/**
 * POST /api/message-templates/ai-draft — generate a component template with AI.
 * Body: { objective, tone?, category? }. Returns an unsaved draft payload.
 */
router.post(
  "/ai-draft",
  heavyActionRateLimiter(),
  requirePermission("MANAGE_TEMPLATES"),
  async (req: Request, res: Response) => {
    try {
      const draft = await generateMessageTemplateDraft(ctxOf(req), {
        objective: req.body?.objective,
        tone: req.body?.tone,
        category: req.body?.category,
      });
      res.json({ ok: true, draft });
    } catch (err) {
      fail(res, err, "Generating a template");
    }
  }
);

/**
 * POST /api/message-templates/starter-suggestions
 *
 * Generate a few business-specific starter templates grounded in this
 * workspace's profile, for the "Choose a starter" screen. Never 500s the
 * picker: when the workspace has no business context, or AI is unavailable,
 * it returns an empty set with fallbackToPrebuilt=true so the UI shows the
 * universal starters instead.
 */
router.post(
  "/starter-suggestions",
  heavyActionRateLimiter(),
  requirePermission("MANAGE_TEMPLATES"),
  async (req: Request, res: Response) => {
    try {
      const suggestions = await generateStarterSuggestions(ctxOf(req));
      res.json({ ok: true, suggestions, fallbackToPrebuilt: suggestions.length === 0 });
    } catch (err) {
      // No business context or no AI provider is not an error for this screen —
      // it just means we show the universal starters.
      if (err instanceof MissingTemplateContextError || err instanceof AiUnavailableError) {
        return res.json({ ok: true, suggestions: [], fallbackToPrebuilt: true });
      }
      fail(res, err, "Generating starter suggestions");
    }
  }
);

/** GET /api/message-templates/:id */
router.get("/:id", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const template = await getMessageTemplate(ctxOf(req), req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.json({ ok: true, template });
  } catch (err) {
    fail(res, err, "Fetching message template");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Create / update / delete
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/message-templates */
router.post("/", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const template = await createMessageTemplate(ctxOf(req), req.body);
    res.status(201).json({ ok: true, template });
  } catch (err) {
    fail(res, err, "Creating message template");
  }
});

/** PUT /api/message-templates/:id */
router.put("/:id", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const template = await updateMessageTemplate(ctxOf(req), req.params.id, req.body);
    if (!template) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.json({ ok: true, template });
  } catch (err) {
    fail(res, err, "Updating message template");
  }
});

/** DELETE /api/message-templates/:id (soft-delete → archived) */
router.delete("/:id", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const deleted = await deleteMessageTemplate(ctxOf(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Deleting message template");
  }
});

/** POST /api/message-templates/:id/duplicate */
router.post("/:id/duplicate", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const template = await duplicateMessageTemplate(ctxOf(req), req.params.id, req.body);
    if (!template) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.status(201).json({ ok: true, template });
  } catch (err) {
    fail(res, err, "Duplicating message template");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview / render / validate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/message-templates/render
 *
 * Render a template payload using the appropriate channel renderer. This is
 * the live-preview endpoint: the builder calls it as the user types, and
 * campaign execution calls it at send time.
 *
 * Body: { payload, deliveryMethod?, values?, metaOptions? }
 */
router.post("/render", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const { payload, deliveryMethod, values, metaOptions } = req.body || {};
    if (!payload) return res.status(400).json({ error: "payload is required.", code: "validation" });

    const method: DeliveryMethod = deliveryMethod === "cloud_api" ? "cloud_api" : "web";
    const variableValues = values && typeof values === "object" ? values : buildSampleValueMap(payload.variables || []);

    const result = render(payload, method, variableValues, metaOptions);
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, "Rendering template");
  }
});

/**
 * POST /api/message-templates/validate
 *
 * Run pre-send validation on a payload. Returns all issues so the UI can show
 * them at once rather than fixing one at a time.
 *
 * Body: { payload, deliveryMethod? }
 */
router.post("/validate", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const { payload, deliveryMethod } = req.body || {};
    if (!payload) return res.status(400).json({ error: "payload is required.", code: "validation" });

    const method: DeliveryMethod = deliveryMethod === "cloud_api" ? "cloud_api" : "web";
    const issues = validateForSend(payload, method);

    res.json({
      ok: true,
      valid: !hasErrors(issues),
      issues,
    });
  } catch (err) {
    fail(res, err, "Validating template");
  }
});

export default router;
