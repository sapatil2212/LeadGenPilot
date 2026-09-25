/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ideal Customer Profile API.
 *
 * Replaces `GET/POST /api/config`, which held one vertical and one city for the
 * whole deployment in a mutable module object. Any authenticated user could
 * change what every other workspace's next discovery run searched for, and in
 * development the handler rewrote `src/config.ts` on disk to persist it.
 *
 * Reads need VIEW_ANALYTICS; writes need MANAGE_BUSINESS_PROFILE. Targeting is
 * business configuration rather than a record edit: it decides who the company
 * contacts and it spends the metered lead quota, so `member` does not get it.
 */

import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import { AiUnavailableError } from "../ai/types";
import * as icp from "./icpService";
import { suggestIcp, SuggestionUnavailableError } from "./suggestionService";

const router = express.Router();

router.use(resolveTenantContext);

const NOT_FOUND = { error: "Customer profile not found.", code: "not_found" } as const;

function fail(res: Response, err: any, context: string) {
  if (err instanceof icp.IcpValidationError) {
    return res.status(400).json({ error: err.message, code: "validation" });
  }
  if (err instanceof SuggestionUnavailableError) {
    // "Profile not found" arrives here from the suggestion path, where refusing
    // is deliberate rather than an error condition.
    const status = err.message === "Profile not found." ? 404 : 400;
    return res
      .status(status)
      .json({ error: err.message, code: status === 404 ? "not_found" : "precondition" });
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

/** Reads the ICP fields a request may set, ignoring anything absent. */
function readInput(body: any): icp.IcpInput {
  const input: icp.IcpInput = {};
  if (body.name !== undefined) input.name = String(body.name);
  if (body.description !== undefined) {
    input.description = body.description === null ? null : String(body.description);
  }

  for (const key of [
    "targetCategories",
    "targetIndustries",
    "targetLocations",
    "decisionMakerRoles",
    "excludeCategories",
    "excludeKeywords",
  ] as const) {
    if (body[key] !== undefined) input[key] = body[key];
  }
  for (const key of ["requiredSignals", "preferredSignals"] as const) {
    if (body[key] !== undefined) input[key] = body[key];
  }

  if (body.minRating !== undefined) input.minRating = body.minRating;
  if (body.minReviews !== undefined) input.minReviews = body.minReviews;
  if (body.maxResults !== undefined) input.maxResults = body.maxResults;
  if (body.radiusKm !== undefined) input.radiusKm = body.radiusKm;
  if (body.deepAnalysis !== undefined) input.deepAnalysis = Boolean(body.deepAnalysis);
  if (body.isDefault !== undefined) input.isDefault = Boolean(body.isDefault);
  if (body.status !== undefined) input.status = String(body.status);

  return input;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profiles
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/icp?includeArchived=true */
router.get("/", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await icp.listIcpProfiles(ctxOf(req), req.query.includeArchived === "true"));
  } catch (err) {
    fail(res, err, "Fetching customer profiles");
  }
});

/**
 * GET /api/icp/default — the profile a discovery run would use.
 *
 * Returns 200 with `profile: null` rather than 404 when the workspace has none:
 * "you have not set this up yet" is a normal state for a new workspace, not a
 * missing resource, and the dashboard needs to distinguish the two to know
 * whether to prompt for setup.
 */
router.get("/default", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const profile = await icp.resolveDefaultIcp(ctxOf(req));
    res.json({ profile, configured: !!profile });
  } catch (err) {
    fail(res, err, "Fetching the default customer profile");
  }
});

/** POST /api/icp */
router.post(
  "/",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const input = readInput(req.body || {});
      if (!input.name || !String(input.name).trim()) {
        return res.status(400).json({ error: "A profile name is required.", code: "validation" });
      }
      res.status(201).json(await icp.createIcpProfile(ctxOf(req), input));
    } catch (err) {
      fail(res, err, "Creating the customer profile");
    }
  }
);

/** GET /api/icp/:id */
router.get("/:id", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const profile = await icp.getIcpProfile(ctxOf(req), req.params.id);
    if (!profile) return res.status(404).json(NOT_FOUND);
    res.json(profile);
  } catch (err) {
    fail(res, err, "Fetching the customer profile");
  }
});

/** PATCH /api/icp/:id — patch semantics; omitted fields are left alone. */
router.patch(
  "/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const updated = await icp.updateIcpProfile(
        ctxOf(req),
        req.params.id,
        readInput(req.body || {})
      );
      if (!updated) return res.status(404).json(NOT_FOUND);
      res.json(updated);
    } catch (err) {
      fail(res, err, "Updating the customer profile");
    }
  }
);

/** POST /api/icp/:id/default — make this the profile discovery uses. */
router.post(
  "/:id/default",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const ok = await icp.setDefaultIcpProfile(ctxOf(req), req.params.id);
      if (!ok) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Setting the default customer profile");
    }
  }
);

/** DELETE /api/icp/:id — lead lists found with it keep their leads. */
router.delete(
  "/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await icp.deleteIcpProfile(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting the customer profile");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// AI suggestion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/icp/suggest
 *
 * Body: { profileId?, guidance?, apply? }
 *
 * Proposes targeting from the workspace's business profile and documents.
 * `apply` defaults to false, so the proposal is reviewed before it can direct a
 * run that spends lead quota. Applying unions with what is already set rather
 * than replacing it.
 */
router.post(
  "/suggest",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      res.json(
        await suggestIcp(ctxOf(req), {
          profileId: typeof body.profileId === "string" ? body.profileId : null,
          guidance: typeof body.guidance === "string" ? body.guidance : null,
          apply: body.apply === true,
        })
      );
    } catch (err) {
      fail(res, err, "Suggesting a customer profile");
    }
  }
);

export default router;
