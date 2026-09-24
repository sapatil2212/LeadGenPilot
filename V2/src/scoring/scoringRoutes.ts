/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead scoring configuration API.
 *
 * Exposes the signal registry and the workspace's rule sets, so the weights that
 * decide which leads a team chases are editable rather than compiled in. The old
 * scorer awarded 50 points for "has no website" and graded HOT at an absolute 100
 * against a maximum of 170 that appeared nowhere — correct for a web design
 * agency, meaningless for anyone else.
 *
 * Reads need VIEW_ANALYTICS; writes need MANAGE_BUSINESS_PROFILE. Changing the
 * weights re-prioritises the whole pipeline, so it sits with the other business
 * configuration rather than with per-record edits.
 */

import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import * as scoring from "./scoringService";
import { RuleSetValidationError, evaluate, listSignals, type ScorableLead } from "./index";

const router = express.Router();

router.use(resolveTenantContext);

const NOT_FOUND = { error: "Scoring configuration not found.", code: "not_found" } as const;

function fail(res: Response, err: any, context: string) {
  if (err instanceof RuleSetValidationError) {
    return res.status(400).json({ error: err.message, code: "validation" });
  }
  logger.error(`${context} failed`, err);
  return res.status(500).json({ error: `${context} failed.`, code: "internal" });
}

function readInput(body: any): scoring.RuleSetInput {
  const input: scoring.RuleSetInput = {};
  if (body.name !== undefined) input.name = String(body.name);
  if (body.description !== undefined) {
    input.description = body.description === null ? null : String(body.description);
  }
  if (body.rules !== undefined) input.rules = body.rules;
  if (body.hotThreshold !== undefined) input.hotThreshold = body.hotThreshold;
  if (body.warmThreshold !== undefined) input.warmThreshold = body.warmThreshold;
  if (body.isDefault !== undefined) input.isDefault = Boolean(body.isDefault);
  if (body.status !== undefined) input.status = String(body.status);
  return input;
}

/**
 * GET /api/scoring/signals — every fact a rule can test.
 *
 * The rule editor needs this to offer choices, and it is also the authoritative
 * answer to "what can this product actually observe about a business", which is
 * otherwise only discoverable by reading the analyzers.
 */
router.get("/signals", requirePermission("VIEW_ANALYTICS"), (_req: Request, res: Response) => {
  res.json({ signals: listSignals() });
});

/** GET /api/scoring/rule-sets?includeArchived=true */
router.get(
  "/rule-sets",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      res.json(await scoring.listRuleSets(ctxOf(req), req.query.includeArchived === "true"));
    } catch (err) {
      fail(res, err, "Fetching scoring configurations");
    }
  }
);

/**
 * GET /api/scoring/active — the rule set discovery will score with.
 *
 * Seeds the built-in configuration if the workspace has none, so a client can
 * always render something and a first discovery run never has to wait for setup.
 */
router.get("/active", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await scoring.resolveActiveRuleSet(ctxOf(req)));
  } catch (err) {
    fail(res, err, "Fetching the active scoring configuration");
  }
});

/** POST /api/scoring/rule-sets */
router.post(
  "/rule-sets",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      res.status(201).json(await scoring.createRuleSet(ctxOf(req), readInput(req.body || {})));
    } catch (err) {
      fail(res, err, "Creating the scoring configuration");
    }
  }
);

/** GET /api/scoring/rule-sets/:id */
router.get(
  "/rule-sets/:id",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const ruleSet = await scoring.getRuleSet(ctxOf(req), req.params.id);
      if (!ruleSet) return res.status(404).json(NOT_FOUND);
      res.json(ruleSet);
    } catch (err) {
      fail(res, err, "Fetching the scoring configuration");
    }
  }
);

/** PATCH /api/scoring/rule-sets/:id — bumps the version when weights change. */
router.patch(
  "/rule-sets/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const updated = await scoring.updateRuleSet(
        ctxOf(req),
        req.params.id,
        readInput(req.body || {})
      );
      if (!updated) return res.status(404).json(NOT_FOUND);
      res.json(updated);
    } catch (err) {
      fail(res, err, "Updating the scoring configuration");
    }
  }
);

/** POST /api/scoring/rule-sets/:id/default */
router.post(
  "/rule-sets/:id/default",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const ok = await scoring.setDefaultRuleSet(ctxOf(req), req.params.id);
      if (!ok) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Setting the default scoring configuration");
    }
  }
);

/** DELETE /api/scoring/rule-sets/:id — refused when it is the only one left. */
router.delete(
  "/rule-sets/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await scoring.deleteRuleSet(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting the scoring configuration");
    }
  }
);

/**
 * POST /api/scoring/rule-sets/:id/preview — score a hypothetical lead.
 *
 * Editing weights blind is guesswork: the only way to know what a change does is
 * to see a lead's score and band move. Returns the full breakdown, so which rules
 * fired is visible rather than inferred from a total.
 */
router.post(
  "/rule-sets/:id/preview",
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const ruleSet = await scoring.getRuleSet(ctxOf(req), req.params.id);
      if (!ruleSet) return res.status(404).json(NOT_FOUND);

      const body = req.body || {};
      const lead: ScorableLead = {
        businessName: typeof body.businessName === "string" ? body.businessName : "Example business",
        category: typeof body.category === "string" ? body.category : "",
        phone: typeof body.phone === "string" ? body.phone : "",
        address: typeof body.address === "string" ? body.address : "",
        rating: Number.isFinite(Number(body.rating)) ? Number(body.rating) : 0,
        reviews: Number.isFinite(Number(body.reviews)) ? Number(body.reviews) : 0,
        websiteStatus: body.websiteStatus ?? "WORKING",
        instagramStatus: body.instagramStatus ?? "ACTIVE",
        facebookStatus: body.facebookStatus ?? "ACTIVE",
        linkedinStatus: body.linkedinStatus ?? "ACTIVE",
        whatsappPresent: Boolean(body.whatsappPresent),
        appointmentSystem: Boolean(body.appointmentSystem),
        googleAnalyticsPresent: Boolean(body.googleAnalyticsPresent),
        metaPixelPresent: Boolean(body.metaPixelPresent),
        emails: Array.isArray(body.emails) ? body.emails.map((e: unknown) => String(e)) : [],
      };

      res.json(evaluate(lead, scoring.toDefinition(ruleSet)));
    } catch (err) {
      fail(res, err, "Previewing the scoring configuration");
    }
  }
);

export default router;
