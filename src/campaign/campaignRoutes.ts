/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTTP layer for campaign generation and approval.
 *
 * Phase 5 routes, so the operators can generate outreach batches, review each
 * message, and approve only what they're willing to claim.
 */

import { Router, type Request, type Response } from "express";
import { requirePermission, resolveTenantContext, ctxOf } from "../tenancy/context";
import { entOf } from "../entitlements";
import { heavyActionRateLimiter } from "../security";
import {
  generateCampaign,
  listCampaigns,
  getCampaign,
  approveMessage,
  rejectMessage,
  editMessage,
  approveAllMessages,
  deleteCampaign,
  type GenerateCampaignRequest,
} from "./campaignService";
import { enqueueCampaignExecution, cancelCampaignExecution } from "./campaignExecutor";

const router = Router();

function assertCampaignFeatures(req: Request) {
  const channels = req.body?.channels;
  if (channels?.whatsapp && !entOf(req).whatsappOutreach) {
    throw new Error(`WhatsApp outreach is not included in your ${entOf(req).planName} plan. Upgrade to Pro to unlock it.`);
  }
}

/**
 * POST /api/campaigns
 *
 * Generate a campaign: resolve leads, generate copy for each, store as pending review.
 */
router.post(
  "/",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("CREATE_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      assertCampaignFeatures(req);
      const request = req.body as GenerateCampaignRequest;

      const result = await generateCampaign(ctx, request);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to generate campaign." });
    }
  }
);

/**
 * GET /api/campaigns
 *
 * List all campaigns for this workspace.
 */
router.get(
  "/",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const campaigns = await listCampaigns(ctx);
      res.json(campaigns);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to list campaigns." });
    }
  }
);

/**
 * GET /api/campaigns/:id
 *
 * Get a single campaign with its messages.
 */
router.get(
  "/:id",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const campaign = await getCampaign(ctx, req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found." });
      }
      res.json(campaign);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get campaign." });
    }
  }
);

/**
 * DELETE /api/campaigns/:id
 *
 * Delete a campaign and all its messages.
 */
router.delete(
  "/:id",
  resolveTenantContext,
  requirePermission("DELETE_LEADS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await deleteCampaign(ctx, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to delete campaign." });
    }
  }
);

/**
 * POST /api/campaigns/:id/approve-all
 *
 * Approve all pending messages in a campaign at once.
 */
router.post(
  "/:id/approve-all",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const result = await approveAllMessages(ctx, req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to approve all." });
    }
  }
);

/**
 * POST /api/campaigns/:id/execute
 *
 * Send all approved messages in a campaign.
 */
router.post(
  "/:id/execute",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      const result = await enqueueCampaignExecution(ctx, req.params.id, {
        // `undefined` deliberately selects the service default; zero is valid.
        delayMs: req.body?.delayMs,
        batchSize: req.body?.batchSize,
      });
      res.status(202).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to execute campaign." });
    }
  }
);

/** Request cooperative cancellation of this workspace's queued/running campaign. */
router.post(
  "/:id/cancel",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const result = await cancelCampaignExecution(ctxOf(req), req.params.id);
      if (!result.ok) return res.status(404).json({ error: "No active campaign execution found." });
      res.status(202).json({ ...result, status: "cancelling" });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to cancel campaign." });
    }
  }
);

/**
 * PATCH /api/campaigns/messages/:id
 *
 * Edit a pending message's copy.
 */
router.patch(
  "/messages/:id",
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await editMessage(ctx, req.params.id, req.body);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to edit message." });
    }
  }
);

/**
 * POST /api/campaigns/messages/:id/approve
 *
 * Approve a single message.
 */
router.post(
  "/messages/:id/approve",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await approveMessage(ctx, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to approve message." });
    }
  }
);

/**
 * POST /api/campaigns/messages/:id/reject
 *
 * Reject a single message.
 */
router.post(
  "/messages/:id/reject",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  async (req: Request, res: Response) => {
    try {
      const ctx = ctxOf(req);
      await rejectMessage(ctx, req.params.id, req.body.reason);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to reject message." });
    }
  }
);

export default router;
