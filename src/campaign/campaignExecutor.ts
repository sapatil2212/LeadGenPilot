/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign execution job worker.
 *
 * Reads approved messages from the database, sends them one at a time with delay,
 * and marks each as sent or failed. The campaign remains in "sending" status until
 * all approved messages have been attempted.
 *
 * Phase 5 delivered the approval UI. This delivers the "actually send what you
 * approved" part.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { sendEmailOutreach } from "../outreachService";
import { sendWhatsAppUnified } from "../whatsappGateway";
import type { TenantContext } from "../tenancy/context";

interface ExecutionOptions {
  /** Delay between messages in ms. Default: 5000 (5 seconds) */
  delayMs?: number;
  /** Maximum messages to send in one batch. Default: unlimited */
  batchSize?: number;
}

interface ExecutionResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ messageId: string; error: string }>;
}

/**
 * Send all approved messages for a campaign. This is the entry point called
 * from the HTTP route when the user clicks "Send Campaign".
 */
export async function executeCampaign(
  ctx: TenantContext,
  campaignId: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const { delayMs = 5000, batchSize = Infinity } = options;

  // Verify campaign exists and belongs to this tenant
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (campaign.status === "sent") {
    throw new Error("Campaign has already been sent");
  }

  if (campaign.status === "sending") {
    throw new Error("Campaign is already being sent");
  }

  // Mark campaign as sending
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "sending" },
  });

  logger.info(`Starting execution of campaign ${campaignId} (${campaign.name})`);

  try {
    const result = await sendApprovedMessages(ctx, campaignId, { delayMs, batchSize });

    // Mark campaign as sent when done
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "sent",
        completedAt: new Date(),
      },
    });

    logger.info(
      `Campaign ${campaignId} execution complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
    );

    return result;
  } catch (error: any) {
    logger.error(`Campaign ${campaignId} execution failed: ${error.message}`);

    // Revert to approved if execution crashes before finishing
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "approved" },
    });

    throw error;
  }
}

/**
 * Send all approved messages for a campaign, respecting delay and batch size.
 */
async function sendApprovedMessages(
  ctx: TenantContext,
  campaignId: string,
  options: ExecutionOptions
): Promise<ExecutionResult> {
  const { delayMs = 5000, batchSize = Infinity } = options;
  const result: ExecutionResult = { sent: 0, failed: 0, skipped: 0, errors: [] };

  // Fetch all approved messages
  const messages = await prisma.campaignMessage.findMany({
    where: {
      campaignId,
      tenantId: ctx.tenantId,
      status: "approved",
    },
    include: {
      lead: true,
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  if (messages.length === 0) {
    logger.info(`No approved messages to send for campaign ${campaignId}`);
    return result;
  }

  logger.info(`Sending ${messages.length} approved messages for campaign ${campaignId}`);

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Delay before each message (except the first)
    if (i > 0) {
      logger.info(`Waiting ${delayMs}ms before next message...`);
      await delay(delayMs);
    }

    try {
      await sendMessage(ctx, message);
      result.sent++;
    } catch (error: any) {
      logger.error(`Failed to send message ${message.id}: ${error.message}`);
      result.failed++;
      result.errors.push({ messageId: message.id, error: error.message });
    }
  }

  return result;
}

/**
 * Send a single message via email or WhatsApp.
 */
async function sendMessage(ctx: TenantContext, message: any): Promise<void> {
  const { id, channel, lead, subject, body } = message;

  logger.info(`Sending ${channel} message ${id} to ${lead.businessName}`);

  if (channel === "email") {
    await sendEmailMessage(ctx, message);
  } else if (channel === "whatsapp") {
    await sendWhatsAppMessage(ctx, message);
  } else {
    throw new Error(`Unknown channel: ${channel}`);
  }

  logger.success(`Message ${id} sent successfully via ${channel}`);
}

/**
 * Send an email message.
 */
async function sendEmailMessage(ctx: TenantContext, message: any): Promise<void> {
  const { id, lead, subject, body } = message;

  // Parse lead emails
  let emails: string[] = [];
  try {
    emails = typeof lead.emails === "string" ? JSON.parse(lead.emails) : lead.emails;
  } catch {
    emails = [];
  }

  if (emails.length === 0) {
    await markMessageFailed(id, "No email address available");
    throw new Error("No email address available");
  }

  const to = emails[0];

  // TODO: Fetch user's SMTP config from database (user_integrations table)
  // For now, use env vars as fallback
  const result = await sendEmailOutreach(to, subject || "Outreach", body);

  if (result.success) {
    await markMessageSent(id);
  } else {
    await markMessageFailed(id, result.error || "Unknown error");
    throw new Error(result.error || "Email send failed");
  }
}

/**
 * Send a WhatsApp message.
 */
async function sendWhatsAppMessage(ctx: TenantContext, message: any): Promise<void> {
  const { id, lead, body } = message;

  if (!lead.phone) {
    await markMessageFailed(id, "No phone number available");
    throw new Error("No phone number available");
  }

  const result = await sendWhatsAppUnified(lead.phone, body, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    allowTemplateFallback: true,
  });

  if (result.ok) {
    await markMessageSent(id, result.messageId);
  } else {
    await markMessageFailed(id, result.error || "WhatsApp send failed");
    throw new Error(result.error || "WhatsApp send failed");
  }
}

/**
 * Mark a message as sent.
 */
async function markMessageSent(messageId: string, externalId?: string): Promise<void> {
  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: {
      status: "sent",
      sentAt: new Date(),
      ...(externalId && { externalMessageId: externalId }),
    },
  });

  // Recompute campaign summary counts
  const message = await prisma.campaignMessage.findUnique({
    where: { id: messageId },
    select: { campaignId: true },
  });

  if (message) {
    await recomputeCampaignCounts(message.campaignId);
  }
}

/**
 * Mark a message as failed.
 */
async function markMessageFailed(messageId: string, error: string): Promise<void> {
  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: {
      status: "failed",
      errorMessage: error.substring(0, 500), // Truncate to avoid DB overflow
    },
  });

  // Recompute campaign summary counts
  const message = await prisma.campaignMessage.findUnique({
    where: { id: messageId },
    select: { campaignId: true },
  });

  if (message) {
    await recomputeCampaignCounts(message.campaignId);
  }
}

/**
 * Recompute summary counts for a campaign.
 */
async function recomputeCampaignCounts(campaignId: string): Promise<void> {
  const counts = await prisma.campaignMessage.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });

  const pending = counts.find((c) => c.status === "pending_review")?._count || 0;
  const approved = counts.find((c) => c.status === "approved")?._count || 0;
  const rejected = counts.find((c) => c.status === "rejected")?._count || 0;
  const sent = counts.find((c) => c.status === "sent")?._count || 0;
  const failed = counts.find((c) => c.status === "failed")?._count || 0;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      pendingCount: pending,
      approvedCount: approved,
      rejectedCount: rejected,
      sentCount: sent,
      failedCount: failed,
    },
  });
}

/**
 * Utility: delay for a number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
