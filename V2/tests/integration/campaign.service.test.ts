/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign service tests — INTEGRATION.
 *
 * These exercise generation, review and approval against a real MySQL schema
 * rather than a double, which is the only way to catch a Prisma query that is
 * valid TypeScript and invalid SQL. They therefore require a disposable database
 * in TEST_DATABASE_URL and run from vitest.integration.config.ts:
 *
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "../../src/prisma";
import type { TenantContext } from "../../src/tenancy/context";
import {
  generateCampaign,
  listCampaigns,
  getCampaign,
  approveMessage,
  rejectMessage,
  editMessage,
  approveAllMessages,
  deleteCampaign,
} from "../../src/campaign/campaignService";
import * as aiCopyGenerator from "../../src/aiCopyGenerator";
import * as outreachCopy from "../../src/outreachCopy";

vi.mock("../../src/aiCopyGenerator");
vi.mock("../../src/outreachCopy");

const TENANT_ID = "test-tenant-campaign";
const USER_ID = "test-user-campaign";
const CTX: TenantContext = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  membershipId: "test-membership",
  role: "owner",
  tenantName: "Test Tenant",
  tenantSlug: "test-campaign",
  permissions: new Set(["SEND_CAMPAIGN", "VIEW_ANALYTICS", "EDIT_LEADS", "DELETE_LEADS"]),
};

function createLeadData(listId: string, overrides: Partial<any> = {}) {
  return {
    listId,
    tenantId: TENANT_ID,
    userId: USER_ID,
    businessName: "Test Business",
    phone: "+1234567890",
    emails: JSON.stringify(["test@example.com"]),
    address: "123 Test St",
    rating: 4.5,
    reviews: 100,
    website: "https://test.com",
    websiteStatus: "WORKING",
    mapsUrl: "https://maps.google.com",
    category: "Test",
    dateAdded: new Date().toISOString(),
    instagramUrl: "",
    facebookUrl: "",
    linkedinUrl: "",
    aiInsight: "",
    ...overrides,
  };
}

describe("Campaign Service", () => {
  /**
   * Refuse to run against whatever `.env` points at. Without this, a developer
   * running the integration suite locally would delete tenants out of the
   * production database, because the fixtures start by clearing their own rows.
   */
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL?.trim()) {
      throw new Error(
        "TEST_DATABASE_URL is not set. The integration suite writes and deletes rows, so it must be pointed at a disposable database. See docs/PHASE8-OPERATIONS.md."
      );
    }
  });

  beforeEach(async () => {
    // Clean up campaign data
    await prisma.campaignMessage.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.campaign.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.lead.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.leadList.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });

    // Create tenant and user
    await prisma.user.create({
      data: { id: USER_ID, email: "test@campaign.test", passwordHash: "x", emailVerified: true },
    });
    await prisma.tenant.create({ data: { id: TENANT_ID, name: "Test Tenant", slug: "test-campaign" } });
    await prisma.tenantMember.create({
      data: { tenantId: TENANT_ID, userId: USER_ID, role: "owner", status: "active" },
    });

    // Mock AI copy generator
    vi.mocked(aiCopyGenerator.generateAICopy).mockResolvedValue({
      emailSubject: "AI Subject",
      emailBody: "AI email body for {{businessName}}",
      whatsappMessage: "AI WhatsApp message",
    });

    vi.mocked(outreachCopy.generateOutreachCopy).mockReturnValue({
      emailSubject: "Rule Subject",
      emailBody: "Rule email body",
      whatsappMessage: "Rule WhatsApp message",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateCampaign", () => {
    it("generates a campaign from a lead list with AI copy", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id) });

      const result = await generateCampaign(CTX, {
        name: "Test Campaign",
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: true },
        useAi: true,
      });

      expect(result.campaignId).toBeTruthy();
      expect(result.messageCount).toBe(2); // email + whatsapp

      // Verify AI was called
      expect(aiCopyGenerator.generateAICopy).toHaveBeenCalledTimes(1);

      // Verify campaign was created
      const campaign = await prisma.campaign.findUnique({ where: { id: result.campaignId } });
      expect(campaign).toBeTruthy();
      expect(campaign!.name).toBe("Test Campaign");
      expect(campaign!.status).toBe("pending_review");
      expect(campaign!.totalMessages).toBe(2);
      expect(campaign!.pendingCount).toBe(2);

      // Verify messages were created
      const messages = await prisma.campaignMessage.findMany({
        where: { campaignId: result.campaignId },
      });
      expect(messages).toHaveLength(2);
      expect(messages.find((m) => m.channel === "email")).toBeTruthy();
      expect(messages.find((m) => m.channel === "whatsapp")).toBeTruthy();
    });

    it("falls back to rule-based copy when AI fails", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id) });

      // Mock AI to fail
      vi.mocked(aiCopyGenerator.generateAICopy).mockRejectedValue(new Error("AI unavailable"));

      const result = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: true,
      });

      expect(result.warning).toContain("fell back to rule-based copy");
      expect(outreachCopy.generateOutreachCopy).toHaveBeenCalledTimes(1);
    });

    it("uses rule-based copy when AI is disabled", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { emails: JSON.stringify([]) }) });

      await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: false, whatsapp: true },
        useAi: false,
      });

      expect(aiCopyGenerator.generateAICopy).not.toHaveBeenCalled();
      expect(outreachCopy.generateOutreachCopy).toHaveBeenCalledTimes(1);
    });

    it("rejects when no channels are enabled", async () => {
      await expect(
        generateCampaign(CTX, {
          sourceType: "manual",
          leadIds: [],
          channels: { email: false, whatsapp: false },
          useAi: true,
        })
      ).rejects.toThrow("At least one channel");
    });

    it("rejects when no leads match", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Empty List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Type",
          location: "Test Location",
        },
      });

      await expect(
        generateCampaign(CTX, {
          sourceType: "list",
          sourceListId: list.id,
          channels: { email: true, whatsapp: false },
          useAi: true,
        })
      ).rejects.toThrow("No leads matched");
    });

    it("rejects and creates no campaign when leads match but none has an eligible contact", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "No Contact List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Type",
          location: "Test Location",
        },
      });

      // A lead with no email addresses and no phone: it matches the source but
      // has nothing to send to on either channel.
      await prisma.lead.create({
        data: createLeadData(list.id, { businessName: "Unreachable", emails: JSON.stringify([]), phone: "" }),
      });

      await expect(
        generateCampaign(CTX, {
          sourceType: "list",
          sourceListId: list.id,
          channels: { email: true, whatsapp: true },
          useAi: false,
        })
      ).rejects.toThrow(/eligible|contact/i);

      const campaigns = await prisma.campaign.findMany({ where: { tenantId: TENANT_ID } });
      expect(campaigns).toHaveLength(0);
    });
  });

  describe("listCampaigns", () => {
    it("lists campaigns for the workspace", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        name: "Campaign 1",
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaigns = await listCampaigns(CTX);
      expect(campaigns).toHaveLength(1);
      expect(campaigns[0].id).toBe(campaignId);
      expect(campaigns[0].name).toBe("Campaign 1");
    });

    it("returns empty array when no campaigns exist", async () => {
      const campaigns = await listCampaigns(CTX);
      expect(campaigns).toEqual([]);
    });
  });

  describe("getCampaign", () => {
    it("returns a campaign with its messages", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: true },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      expect(campaign).toBeTruthy();
      expect(campaign!.messages).toHaveLength(2);
      expect(campaign!.totalMessages).toBe(2);
    });

    it("returns null for non-existent campaign", async () => {
      const campaign = await getCampaign(CTX, "nonexistent");
      expect(campaign).toBeNull();
    });
  });

  describe("approveMessage", () => {
    it("approves a pending message and updates campaign counts", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      const messageId = campaign!.messages[0].id;

      await approveMessage(CTX, messageId);

      const updated = await getCampaign(CTX, campaignId);
      expect(updated!.approvedCount).toBe(1);
      expect(updated!.pendingCount).toBe(0);
      expect(updated!.status).toBe("approved");

      const message = await prisma.campaignMessage.findUnique({ where: { id: messageId } });
      expect(message!.status).toBe("approved");
      expect(message!.approvedAt).toBeTruthy();
    });

    it("rejects approving a non-pending message", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      const messageId = campaign!.messages[0].id;

      await approveMessage(CTX, messageId);

      await expect(approveMessage(CTX, messageId)).rejects.toThrow("cannot approve");
    });
  });

  describe("rejectMessage", () => {
    it("rejects a pending message with a reason", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      const messageId = campaign!.messages[0].id;

      await rejectMessage(CTX, messageId, "Copy is too generic");

      const updated = await getCampaign(CTX, campaignId);
      expect(updated!.rejectedCount).toBe(1);
      expect(updated!.pendingCount).toBe(0);

      const message = await prisma.campaignMessage.findUnique({ where: { id: messageId } });
      expect(message!.status).toBe("rejected");
      expect(message!.rejectionReason).toBe("Copy is too generic");
    });
  });

  describe("editMessage", () => {
    it("edits a pending message's copy", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      const messageId = campaign!.messages[0].id;

      await editMessage(CTX, messageId, {
        subject: "Edited Subject",
        body: "Edited body",
      });

      const message = await prisma.campaignMessage.findUnique({ where: { id: messageId } });
      expect(message!.subject).toBe("Edited Subject");
      expect(message!.body).toBe("Edited body");
    });

    it("rejects editing a non-pending message", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      const campaign = await getCampaign(CTX, campaignId);
      const messageId = campaign!.messages[0].id;

      await approveMessage(CTX, messageId);

      await expect(editMessage(CTX, messageId, { body: "New body" })).rejects.toThrow("cannot edit");
    });
  });

  describe("approveAllMessages", () => {
    it("approves all pending messages at once", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: true },
        useAi: false,
      });

      const result = await approveAllMessages(CTX, campaignId);
      expect(result.count).toBe(2);

      const campaign = await getCampaign(CTX, campaignId);
      expect(campaign!.approvedCount).toBe(2);
      expect(campaign!.pendingCount).toBe(0);
      expect(campaign!.status).toBe("approved");
    });
  });

  describe("deleteCampaign", () => {
    it("deletes a draft campaign", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      await deleteCampaign(CTX, campaignId);

      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(campaign).toBeNull();

      const messages = await prisma.campaignMessage.findMany({ where: { campaignId } });
      expect(messages).toHaveLength(0);
    });

    it("rejects deleting a campaign that is sending", async () => {
      const list = await prisma.leadList.create({
        data: {
          name: "Test List",
          tenantId: TENANT_ID,
          userId: USER_ID,
          businessType: "Test Business Type",
          location: "Test Location",
        },
      });

      await prisma.lead.create({ data: createLeadData(list.id, { businessName: "Test" }) });

      const { campaignId } = await generateCampaign(CTX, {
        sourceType: "list",
        sourceListId: list.id,
        channels: { email: true, whatsapp: false },
        useAi: false,
      });

      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "sending" } });

      await expect(deleteCampaign(CTX, campaignId)).rejects.toThrow("currently sending");
    });
  });
});
