/** Tenant-scoped outreach-template CRUD and AI draft generation. */

import { Router, type Request, type Response } from "express";
import { AiUnavailableError } from "../ai/types";
import { generateTemplateDraft, MissingTemplateContextError } from "../business/templateGenerator";
import { logger } from "../logger";
import { heavyActionRateLimiter } from "../security";
import { ctxOf, requirePermission, resolveTenantContext } from "../tenancy/context";
import {
  TemplateValidationError,
  createTemplate,
  deleteTemplate,
  importTemplates,
  listTemplates,
  updateTemplate,
} from "./templateService";

const router = Router();
router.use(resolveTenantContext);

function fail(res: Response, err: any, context: string) {
  if (err instanceof TemplateValidationError || err instanceof MissingTemplateContextError) {
    return res.status(400).json({ error: err.message, code: "validation" });
  }
  if (err instanceof AiUnavailableError) {
    return res.status(503).json({
      error: "Gemini is not currently available. Check GEMINI_API_KEY and try again.",
      code: "ai_unavailable",
      attempts: err.attempts,
    });
  }
  logger.error(`${context} failed`, err);
  return res.status(500).json({ error: `${context} failed.`, code: "internal" });
}

router.get("/", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
    res.json(await listTemplates(ctxOf(req), channel));
  } catch (err) {
    fail(res, err, "Fetching templates");
  }
});

router.post(
  "/ai-draft",
  heavyActionRateLimiter(),
  requirePermission("MANAGE_TEMPLATES"),
  async (req: Request, res: Response) => {
    try {
      res.json(
        await generateTemplateDraft(ctxOf(req), {
          channel: req.body?.channel,
          objective: req.body?.objective,
          tone: req.body?.tone,
        })
      );
    } catch (err) {
      fail(res, err, "Generating a template");
    }
  }
);

router.post("/import", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const templates = await importTemplates(ctxOf(req), req.body?.templates);
    res.status(201).json({ templates, imported: templates.length });
  } catch (err) {
    fail(res, err, "Importing templates");
  }
});

router.post("/", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    res.status(201).json(await createTemplate(ctxOf(req), req.body?.template));
  } catch (err) {
    fail(res, err, "Creating a template");
  }
});

router.put("/:id", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const template = await updateTemplate(ctxOf(req), req.params.id, req.body?.template);
    if (!template) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.json(template);
  } catch (err) {
    fail(res, err, "Updating a template");
  }
});

router.delete("/:id", requirePermission("MANAGE_TEMPLATES"), async (req: Request, res: Response) => {
  try {
    const deleted = await deleteTemplate(ctxOf(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: "Template not found.", code: "not_found" });
    res.json({ success: true });
  } catch (err) {
    fail(res, err, "Deleting a template");
  }
});

export default router;
