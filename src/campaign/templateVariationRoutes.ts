/**
 * Template Variation API Routes
 *
 * Provides endpoints for generating, reviewing, approving and rotating
 * AI-generated outreach template variations.
 */

import { Router, type Request, type Response } from "express";
import { requirePermission, resolveTenantContext, ctxOf } from "../tenancy/context";
import { heavyActionRateLimiter } from "../security";
import {
  generateAndSaveVariations,
  listVariations,
  approveVariation,
  rejectVariation,
  editVariation,
  deleteVariation,
  type TemplateVariationInput,
} from "./templateVariationService";

const router = Router();

/**
 * POST /api/campaigns/:id/variations/generate
 *
 * Generate AI template variations for a campaign.
 * Body: { outreachApproach, channel, count?, businessName?, industry?, ctaText?, tone?, targetAudience? }
 */
router.post(
  "/:id/variations/generate",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("CREATE_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const campaignId = req.params.id;

      // Validate the campaign belongs to this tenant.
      const { prisma } = await import("../prisma");
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found." });
      }

      const input: TemplateVariationInput = {
        outreachApproach: String(req.body?.outreachApproach || "").trim(),
        channel: req.body?.channel === "email" ? "email" : "whatsapp",
        count: Number(req.body?.count) || 5,
        businessName: req.body?.businessName,
        industry: req.body?.industry,
        ctaText: req.body?.ctaText,
        tone: req.body?.tone,
        targetAudience: req.body?.targetAudience,
      };

      if (!input.outreachApproach) {
        return res.status(400).json({ error: "outreachApproach is required." });
      }
      if (input.count! < 1 || input.count! > 5) {
        return res.status(400).json({ error: "count must be between 1 and 5." });
      }

      const variations = await generateAndSaveVariations(
        ctx.tenantId,
        campaignId,
        input,
        { userId: ctx.userId }
      );

      res.status(201).json({ variations });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to generate variations." });
    }
  }
);

/**
 * GET /api/campaigns/:id/variations
 *
 * List all template variations for a campaign.
 * Query: channel? (filter by channel)
 */
router.get(
  "/:id/variations",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const channel = req.query.channel as string | undefined;
      const variations = await listVariations(ctx.tenantId, req.params.id, channel);
      res.json({ variations });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to list variations." });
    }
  }
);

/**
 * POST /api/campaigns/variations/:id/approve
 *
 * Approve a template variation, making it eligible for rotation.
 */
router.post(
  "/variations/:id/approve",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await approveVariation(ctx.tenantId, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to approve variation." });
    }
  }
);

/**
 * POST /api/campaigns/variations/:id/reject
 *
 * Reject a template variation.
 */
router.post(
  "/variations/:id/reject",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await rejectVariation(ctx.tenantId, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to reject variation." });
    }
  }
);

/**
 * PATCH /api/campaigns/variations/:id
 *
 * Edit a draft template variation's content or subject.
 */
router.patch(
  "/variations/:id",
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await editVariation(ctx.tenantId, req.params.id, {
        subject: req.body?.subject,
        content: req.body?.content,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to edit variation." });
    }
  }
);

/**
 * DELETE /api/campaigns/variations/:id
 *
 * Delete a draft or rejected template variation.
 */
router.delete(
  "/variations/:id",
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await deleteVariation(ctx.tenantId, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to delete variation." });
    }
  }
);

export default router;
