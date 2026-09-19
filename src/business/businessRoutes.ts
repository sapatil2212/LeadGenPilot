/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business profile, products and services API.
 *
 * TENANT ISOLATION
 * ----------------
 * `resolveTenantContext` runs before every route, and every handler passes the
 * resulting context to businessService — which has no function that accepts a
 * bare id. A handler here cannot express a query that reaches another
 * workspace's data, which is the same structural guarantee crmRoutes gained in
 * Phase 2 after Phase 1 had to patch ten handlers by hand.
 *
 * PERMISSIONS
 * -----------
 * Reads need VIEW_ANALYTICS — the profile is workspace context that anyone
 * generating copy or reviewing leads needs to see. Writes need
 * MANAGE_BUSINESS_PROFILE, which `member` does not have: these fields become the
 * factual basis of every AI-generated message sent in the company's name, so
 * changing them is closer to editing brand collateral than to editing a record.
 */

import express, { type Request, type Response } from "express";
import { logger } from "../logger";
import { resolveTenantContext, requirePermission, ctxOf } from "../tenancy/context";
import { AiUnavailableError } from "../ai/types";
import * as business from "./businessService";

const router = express.Router();

router.use(resolveTenantContext);

const NOT_FOUND_PRODUCT = { error: "Product not found.", code: "not_found" } as const;
const NOT_FOUND_SERVICE = { error: "Service not found.", code: "not_found" } as const;

/** Cap on text submitted for AI extraction. Matches the prompt's own slice. */
const MAX_EXTRACTION_CHARS = 60_000;

/**
 * Maps a service-layer failure to a response.
 *
 * AiUnavailableError is 503 with the per-provider reasons: "every provider
 * failed" is an operational fact the caller can act on (retry later), unlike a
 * generic 500.
 */
function fail(res: Response, err: any, context: string) {
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

/** Reads a string array from a request body, tolerating a comma-separated string. */
function readList(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
    return parts;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/business/profile */
router.get("/profile", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await business.getBusinessProfile(ctxOf(req)));
  } catch (err) {
    fail(res, err, "Fetching the business profile");
  }
});

/**
 * PUT /api/business/profile — patch semantics.
 *
 * Only keys present in the body are written, so a client editing one field does
 * not have to send the whole profile back and cannot blank the rest by omission.
 */
router.put(
  "/profile",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const patch: business.BusinessProfilePatch = {};

      for (const key of [
        "businessName",
        "industry",
        "businessType",
        "website",
        "description",
        "country",
        "state",
        "city",
        "contactEmail",
        "contactPhone",
        "brandVoice",
        "salesObjectives",
      ] as const) {
        if (body[key] !== undefined) patch[key] = body[key] === null ? null : String(body[key]);
      }

      for (const key of [
        "locationsServed",
        "targetCustomerTypes",
        "targetIndustries",
        "uniqueSellingPoints",
        "certifications",
        "decisionMakerRoles",
      ] as const) {
        const list = readList(body[key]);
        if (list !== undefined) patch[key] = list;
      }

      res.json(await business.updateBusinessProfile(ctxOf(req), patch));
    } catch (err) {
      fail(res, err, "Saving the business profile");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

function readProduct(body: any): business.ProductInput {
  const input: business.ProductInput = {};
  if (body.name !== undefined) input.name = String(body.name);
  if (body.category !== undefined) input.category = body.category === null ? null : String(body.category);
  if (body.description !== undefined) {
    input.description = body.description === null ? null : String(body.description);
  }
  if (body.priceRange !== undefined) {
    input.priceRange = body.priceRange === null ? null : String(body.priceRange);
  }
  if (body.status !== undefined) input.status = String(body.status);
  const features = readList(body.keyFeatures);
  if (features !== undefined) input.keyFeatures = features;
  const idealFor = readList(body.idealFor);
  if (idealFor !== undefined) input.idealFor = idealFor;
  return input;
}

/** GET /api/business/products?includeArchived=true */
router.get("/products", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    res.json(await business.listProducts(ctxOf(req), includeArchived));
  } catch (err) {
    fail(res, err, "Fetching products");
  }
});

/** POST /api/business/products */
router.post(
  "/products",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const input = readProduct(req.body || {});
      if (!input.name || !input.name.trim()) {
        return res.status(400).json({ error: "Product name is required.", code: "validation" });
      }
      res.status(201).json(await business.createProduct(ctxOf(req), input));
    } catch (err) {
      fail(res, err, "Creating a product");
    }
  }
);

/** PATCH /api/business/products/:id */
router.patch(
  "/products/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const updated = await business.updateProduct(
        ctxOf(req),
        req.params.id,
        readProduct(req.body || {})
      );
      if (!updated) return res.status(404).json(NOT_FOUND_PRODUCT);
      res.json(updated);
    } catch (err) {
      fail(res, err, "Updating a product");
    }
  }
);

/** DELETE /api/business/products/:id */
router.delete(
  "/products/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await business.deleteProduct(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND_PRODUCT);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting a product");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────

function readService(body: any): business.ServiceInput {
  const { keyFeatures: _ignored, ...rest } = readProduct(body);
  return rest;
}

/** GET /api/business/services?includeArchived=true */
router.get("/services", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    res.json(await business.listServices(ctxOf(req), includeArchived));
  } catch (err) {
    fail(res, err, "Fetching services");
  }
});

/** POST /api/business/services */
router.post(
  "/services",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const input = readService(req.body || {});
      if (!input.name || !input.name.trim()) {
        return res.status(400).json({ error: "Service name is required.", code: "validation" });
      }
      res.status(201).json(await business.createService(ctxOf(req), input));
    } catch (err) {
      fail(res, err, "Creating a service");
    }
  }
);

/** PATCH /api/business/services/:id */
router.patch(
  "/services/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const updated = await business.updateService(
        ctxOf(req),
        req.params.id,
        readService(req.body || {})
      );
      if (!updated) return res.status(404).json(NOT_FOUND_SERVICE);
      res.json(updated);
    } catch (err) {
      fail(res, err, "Updating a service");
    }
  }
);

/** DELETE /api/business/services/:id */
router.delete(
  "/services/:id",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const deleted = await business.deleteService(ctxOf(req), req.params.id);
      if (!deleted) return res.status(404).json(NOT_FOUND_SERVICE);
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Deleting a service");
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// AI-assisted extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/business/extract — turn free text about the business into fields.
 *
 * `apply` defaults to false: the result comes back for review rather than being
 * written. That is the approval principle the brief requires — the user sees what
 * the model concluded before it becomes the factual basis for messages sent in
 * their name. When applied, existing filled fields are never overwritten.
 */
router.post(
  "/extract",
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  async (req: Request, res: Response) => {
    try {
      const { text, apply } = req.body || {};
      const sourceText = String(text ?? "").trim();
      if (sourceText.length < 40) {
        return res.status(400).json({
          error: "Provide at least a paragraph of text about the business.",
          code: "validation",
        });
      }

      const result = await business.extractBusinessKnowledge(
        ctxOf(req),
        sourceText.slice(0, MAX_EXTRACTION_CHARS),
        { apply: apply === true }
      );
      res.json(result);
    } catch (err) {
      fail(res, err, "Extracting business details");
    }
  }
);

/** GET /api/business/context — the exact context the AI layer is given. */
router.get("/context", requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    res.json(await business.buildBusinessContext(ctxOf(req)));
  } catch (err) {
    fail(res, err, "Building the business context");
  }
});

export default router;
