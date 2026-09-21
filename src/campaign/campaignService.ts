/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign generation with human approval.
 *
 * Replaces the in-memory fire-and-forget campaign loop with a durable two-phase
 * model:
 *   1. Generate a batch of outreach messages, each with AI-generated copy.
 *   2. Store them as "pending_review", show them in the approval UI.
 *   3. The user approves/rejects/edits each one.
 *   4. Only approved messages are sent.
 *
 * This is what turns the product from "spray and pray" into "reviewed outreach"
 * — the only mode that works for a business where every claim made to a prospect
 * is the operator's responsibility, not the AI's.
 */

import { prisma } from "../prisma";
import { logger, logContext } from "../logger";
import type { Lead } from "../types";
import type { TenantContext } from "../tenancy/context";
import { generateAICopy } from "../aiCopyGenerator";
import { generateOutreachCopy } from "../outreachCopy";
import { canonicalSuppressionKey, filterSuppressed } from "../compliance/suppressionService";
import { compileTemplateSubject, compileTemplateText, templateNeedsAiBody } from "../outreachTemplates";
import { resolveTemplateSelection } from "../templates/templateService";

export interface GenerateCampaignRequest {
  name?: string;
  icpProfileId?: string;
  sourceType: "icp" | "list" | "manual";
  sourceListId?: string;
  leadIds?: string[];
  filters?: Record<string, unknown>;
  channels: {
    email: boolean;
    whatsapp: boolean;
  };
  templateIds?: {
    email?: string;
    whatsapp?: string;
  };
  useAi: boolean;
}

export interface CampaignView {
  id: string;
  name: string;
  status: string;
  sourceType: string;
  sourceListId: string | null;
  channels: { email: boolean; whatsapp: boolean };
  totalMessages: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignMessageView {
  id: string;
  businessName: string;
  recipient: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  rejectionReason: string | null;
  errorMessage: string | null;
  leadId: string | null;
  createdAt: string;
}

export interface CampaignDetailView extends CampaignView {
  messages: CampaignMessageView[];
}

/**
 * Generate a campaign: resolve leads, generate copy for each, store as pending review.
 *
 * Returns the campaign ID so the caller can immediately redirect to the review UI.
 */
export async function generateCampaign(
  ctx: TenantContext,
  request: GenerateCampaignRequest
): Promise<{ campaignId: string; messageCount: number; warning?: string }> {
  const { email: emailOn, whatsapp: whatsappOn } = request.channels;
  if (!emailOn && !whatsappOn) {
    throw new Error("At least one channel (email or whatsapp) must be enabled.");
  }

  const selectedTemplates = await resolveTemplateSelection(ctx, request.templateIds);
  if (!emailOn && selectedTemplates.email) {
    throw new Error("An email template was selected but the email channel is disabled.");
  }
  if (!whatsappOn && selectedTemplates.whatsapp) {
    throw new Error("A WhatsApp template was selected but the WhatsApp channel is disabled.");
  }

  // Resolve the lead pool.
  const leads = await resolveLeads(ctx, request);
  if (leads.length === 0) {
    throw new Error("No leads matched the selection criteria.");
  }

  // Create the campaign record.
  const campaign = await prisma.campaign.create({
    data: {
      tenantId: ctx.tenantId,
      name: request.name || `Campaign ${new Date().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`,
      status: "pending_review",
      icpProfileId: request.icpProfileId || null,
      sourceType: request.sourceType,
      sourceListId: request.sourceListId || null,
      filters: request.filters ? JSON.stringify(request.filters) : null,
      channels: JSON.stringify(request.channels),
      templates: request.templateIds
        ? JSON.stringify({
            ...(selectedTemplates.email ? { email: selectedTemplates.email.id } : {}),
            ...(selectedTemplates.whatsapp ? { whatsapp: selectedTemplates.whatsapp.id } : {}),
          })
        : null,
      createdById: ctx.userId,
      totalMessages: 0, // will be updated after message creation
    },
  });

  // Opted-out contacts are excluded before any copy is generated, so a
  // suppressed person never appears in the review queue for a human to approve
  // by accident, and no AI tokens are spent writing to them.
  const emailCandidates: string[] = [];
  const phoneCandidates: string[] = [];
  for (const lead of leads) {
    if (emailOn && (lead as any).emails) {
      const list = Array.isArray((lead as any).emails) ? (lead as any).emails : JSON.parse((lead as any).emails || "[]");
      for (const email of list) if (typeof email === "string") emailCandidates.push(email);
    }
    if (whatsappOn && lead.phone) phoneCandidates.push(lead.phone);
  }
  const [suppressedEmails, suppressedPhones] = await Promise.all([
    emailOn ? filterSuppressed(ctx.tenantId, "email", emailCandidates) : Promise.resolve(new Set<string>()),
    whatsappOn ? filterSuppressed(ctx.tenantId, "whatsapp", phoneCandidates) : Promise.resolve(new Set<string>()),
  ]);
  let suppressedSkips = 0;

  const messages: Array<{
    campaignId: string;
    tenantId: string;
    leadId: string;
    businessName: string;
    recipient: string;
    channel: string;
    subject: string | null;
    body: string;
    aiProvider: string | null;
    aiModel: string | null;
    promptName: string | null;
    promptVersion: number | null;
    tokensUsed: number | null;
    latencyMs: number | null;
  }> = [];

  let aiFailures = 0;

  for (const lead of leads) {
    const emailNeedsGeneratedBody = emailOn &&
      (!selectedTemplates.email || templateNeedsAiBody(selectedTemplates.email));
    const whatsappNeedsGeneratedBody = whatsappOn &&
      (!selectedTemplates.whatsapp || templateNeedsAiBody(selectedTemplates.whatsapp));
    const needsGeneratedCopy = emailNeedsGeneratedBody || whatsappNeedsGeneratedBody;

    // A reviewed static template bypasses AI entirely. Missing/AI-body channels
    // retain the existing AI-or-rule fallback and are still reviewed as final
    // CampaignMessage snapshots before anything can be sent.
    let copy: { emailSubject: string; emailBody: string; whatsappMessage: string } = {
      emailSubject: "",
      emailBody: "",
      whatsappMessage: "",
    };
    let aiMeta: {
      provider: string | null;
      model: string | null;
      promptName: string | null;
      promptVersion: number | null;
      tokensUsed: number | null;
      latencyMs: number | null;
    } = {
      provider: null,
      model: null,
      promptName: null,
      promptVersion: null,
      tokensUsed: null,
      latencyMs: null,
    };

    if (needsGeneratedCopy && request.useAi) {
      try {
        copy = await generateAICopy(lead);
        aiMeta.provider = "openrouter";
        aiMeta.promptName = "lead_outreach";
      } catch (err: any) {
        logger.warn(`AI copy generation failed for lead ${lead.id}: ${err.message || err}. Falling back to rule-based copy.`);
        copy = generateOutreachCopy(lead);
        aiFailures++;
      }
    } else if (needsGeneratedCopy) {
      copy = generateOutreachCopy(lead);
    }

    const emailSubject = selectedTemplates.email
      ? compileTemplateSubject(selectedTemplates.email, lead, copy.emailSubject)
      : copy.emailSubject;
    const emailBody = selectedTemplates.email
      ? compileTemplateText(selectedTemplates.email, lead, copy.emailBody)
      : copy.emailBody;
    const whatsappBody = selectedTemplates.whatsapp
      ? compileTemplateText(selectedTemplates.whatsapp, lead, copy.whatsappMessage)
      : copy.whatsappMessage;

    // Email message
    if (emailOn && lead.emails) {
      const emailList = Array.isArray(lead.emails) ? lead.emails : JSON.parse(lead.emails || "[]");
      const deliverable = emailList.filter((e: string) => typeof e === "string" && e.includes("@"));
      // Prefer an address this workspace is still allowed to contact; a lead
      // with one opted-out and one open address is still reachable.
      const email = deliverable.find((e: string) => !suppressedEmails.has(canonicalSuppressionKey("email", e))) || null;
      if (!email && deliverable.length > 0) suppressedSkips++;
      if (email) {
        messages.push({
          campaignId: campaign.id,
          tenantId: ctx.tenantId,
          leadId: lead.id,
          businessName: lead.businessName,
          recipient: email,
          channel: "email",
          subject: emailSubject || "A relevant idea for your business",
          body: emailBody,
          aiProvider: aiMeta.provider,
          aiModel: aiMeta.model,
          promptName: aiMeta.promptName,
          promptVersion: aiMeta.promptVersion,
          tokensUsed: aiMeta.tokensUsed,
          latencyMs: aiMeta.latencyMs,
        });
      }
    }

    // WhatsApp message
    if (whatsappOn && lead.phone && suppressedPhones.has(canonicalSuppressionKey("whatsapp", lead.phone))) {
      suppressedSkips++;
    } else if (whatsappOn && lead.phone) {
      messages.push({
        campaignId: campaign.id,
        tenantId: ctx.tenantId,
        leadId: lead.id,
        businessName: lead.businessName,
        recipient: lead.phone,
        channel: "whatsapp",
        subject: null,
        body: whatsappBody,
        aiProvider: aiMeta.provider,
        aiModel: aiMeta.model,
        promptName: aiMeta.promptName,
        promptVersion: aiMeta.promptVersion,
        tokensUsed: aiMeta.tokensUsed,
        latencyMs: aiMeta.latencyMs,
      });
    }
  }

  if (messages.length === 0) {
    await prisma.campaign.delete({ where: { id: campaign.id } });
    throw new Error("None of the selected leads has an eligible, unsuppressed contact for the enabled channels.");
  }

  // Bulk insert the messages.
  await prisma.campaignMessage.createMany({ data: messages });

  // Update the campaign's message count and status.
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      totalMessages: messages.length,
      pendingCount: messages.length,
      status: "pending_review",
    },
  });

  const warnings: string[] = [];
  if (aiFailures > 0) {
    warnings.push(`${aiFailures} lead${aiFailures === 1 ? "" : "s"} fell back to rule-based copy because the AI provider was unavailable.`);
  }
  if (suppressedSkips > 0) {
    warnings.push(`${suppressedSkips} contact${suppressedSkips === 1 ? " was" : "s were"} excluded because they opted out of this workspace's outreach.`);
  }
  const warning = warnings.length ? warnings.join(" ") : undefined;

  logger.info(`Campaign generated: ${messages.length} messages for ${leads.length} leads${suppressedSkips ? `, ${suppressedSkips} suppressed` : ""}.${logContext({ tenant: ctx.tenantId, campaign: campaign.id })}`);
  return { campaignId: campaign.id, messageCount: messages.length, warning };
}

/**
 * Resolve leads from the source and filters.
 */
async function resolveLeads(
  ctx: TenantContext,
  request: GenerateCampaignRequest
): Promise<Lead[]> {
  if (request.sourceType === "manual" && request.leadIds) {
    const leads = await prisma.lead.findMany({
      where: { tenantId: ctx.tenantId, id: { in: request.leadIds } },
    });
    return leads as unknown as Lead[];
  }

  if (request.sourceType === "list" && request.sourceListId) {
    const leads = await prisma.lead.findMany({
      where: { tenantId: ctx.tenantId, listId: request.sourceListId },
    });
    return leads as unknown as Lead[];
  }

  if (request.sourceType === "icp" && request.icpProfileId) {
    // Leads discovered under this ICP, optionally filtered by score/priority.
    const where: any = {
      tenantId: ctx.tenantId,
      icpProfileId: request.icpProfileId,
    };

    if (request.filters) {
      if (request.filters.minScore !== undefined) {
        where.leadScore = { gte: Number(request.filters.minScore) };
      }
      if (request.filters.priority && request.filters.priority !== "all") {
        where.leadPriority = request.filters.priority;
      }
    }

    const leads = await prisma.lead.findMany({ where, take: 200 });
    return leads as unknown as Lead[];
  }

  return [];
}

/**
 * List campaigns for this workspace.
 */
export async function listCampaigns(ctx: TenantContext): Promise<CampaignView[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    sourceType: c.sourceType,
    sourceListId: c.sourceListId,
    channels: JSON.parse(c.channels),
    totalMessages: c.totalMessages,
    pendingCount: c.pendingCount,
    approvedCount: c.approvedCount,
    rejectedCount: c.rejectedCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

/**
 * Get a single campaign with its messages.
 */
export async function getCampaign(
  ctx: TenantContext,
  campaignId: string
): Promise<CampaignDetailView | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) return null;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    sourceType: campaign.sourceType,
    sourceListId: campaign.sourceListId,
    channels: JSON.parse(campaign.channels),
    totalMessages: campaign.totalMessages,
    pendingCount: campaign.pendingCount,
    approvedCount: campaign.approvedCount,
    rejectedCount: campaign.rejectedCount,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    messages: campaign.messages.map((m) => ({
      id: m.id,
      businessName: m.businessName,
      recipient: m.recipient,
      channel: m.channel,
      subject: m.subject,
      body: m.body,
      status: m.status,
      rejectionReason: m.rejectionReason,
      errorMessage: m.errorMessage,
      leadId: m.leadId,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * Approve a message: mark it ready to send.
 */
export async function approveMessage(
  ctx: TenantContext,
  messageId: string
): Promise<void> {
  const message = await prisma.campaignMessage.findFirst({
    where: { id: messageId, tenantId: ctx.tenantId },
  });
  if (!message) throw new Error("Message not found.");
  if (message.status !== "pending_review") {
    throw new Error(`Message is ${message.status}, cannot approve.`);
  }

  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: { status: "approved", approvedAt: new Date() },
  });

  await updateCampaignCounts(message.campaignId);
}

/**
 * Reject a message: mark it will not be sent.
 */
export async function rejectMessage(
  ctx: TenantContext,
  messageId: string,
  reason?: string
): Promise<void> {
  const message = await prisma.campaignMessage.findFirst({
    where: { id: messageId, tenantId: ctx.tenantId },
  });
  if (!message) throw new Error("Message not found.");
  if (message.status !== "pending_review") {
    throw new Error(`Message is ${message.status}, cannot reject.`);
  }

  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: { status: "rejected", rejectionReason: reason || null },
  });

  await updateCampaignCounts(message.campaignId);
}

/**
 * Edit a pending message's copy.
 */
export async function editMessage(
  ctx: TenantContext,
  messageId: string,
  updates: { subject?: string; body?: string }
): Promise<void> {
  const message = await prisma.campaignMessage.findFirst({
    where: { id: messageId, tenantId: ctx.tenantId },
  });
  if (!message) throw new Error("Message not found.");
  if (message.status !== "pending_review") {
    throw new Error(`Message is ${message.status}, cannot edit.`);
  }

  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: {
      ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
      ...(updates.body !== undefined ? { body: updates.body } : {}),
    },
  });
}

/**
 * Bulk approve all pending messages in a campaign.
 */
export async function approveAllMessages(
  ctx: TenantContext,
  campaignId: string
): Promise<{ count: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
  });
  if (!campaign) throw new Error("Campaign not found.");

  const result = await prisma.campaignMessage.updateMany({
    where: { campaignId, status: "pending_review" },
    data: { status: "approved", approvedAt: new Date() },
  });

  await updateCampaignCounts(campaignId);
  return { count: result.count };
}

/**
 * Recompute the campaign's summary counts from its messages.
 */
async function updateCampaignCounts(campaignId: string): Promise<void> {
  const counts = await prisma.campaignMessage.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const pending = counts.find((c) => c.status === "pending_review")?._count._all || 0;
  const approved = counts.find((c) => c.status === "approved")?._count._all || 0;
  const rejected = counts.find((c) => c.status === "rejected")?._count._all || 0;
  const sent = counts.find((c) => c.status === "sent")?._count._all || 0;
  const failed = counts.find((c) => c.status === "failed")?._count._all || 0;

  let status = "pending_review";
  if (pending === 0 && approved === 0) status = "cancelled";
  else if (approved > 0 && pending === 0) status = "approved";
  else if (approved > 0) status = "partially_approved";

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      pendingCount: pending,
      approvedCount: approved,
      rejectedCount: rejected,
      sentCount: sent,
      failedCount: failed,
      status,
    },
  });
}

/**
 * Delete a campaign and all its messages.
 */
export async function deleteCampaign(ctx: TenantContext, campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: ctx.tenantId },
  });
  if (!campaign) throw new Error("Campaign not found.");

  if (campaign.status === "sending") {
    throw new Error("Cannot delete a campaign that is currently sending.");
  }

  await prisma.campaign.delete({ where: { id: campaignId } });
}
