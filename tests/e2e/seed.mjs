/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seeds the end-to-end database with one workspace's worth of realistic data.
 *
 * Deliberately not fixtures-in-the-test: the browser suite signs in as a real
 * user, so the account, its workspace membership, and enough downstream data for
 * every screen to have something to render must exist before the browser starts.
 *
 * SAFETY: refuses to run unless E2E_DATABASE_URL is set, and it deletes only the
 * rows it owns (identified by the fixture tenant and user ids), so pointing it at
 * a populated database cannot wipe unrelated workspaces.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

export const E2E = {
  email: "e2e-owner@example.test",
  password: "E2ePassw0rd!",
  userId: "e2e_user_owner",
  tenantId: "e2e_tenant_alpha",
  tenantName: "Alpha Dental Group",
  tenantSlug: "e2e-alpha",
  listId: "e2e_list_primary",
  campaignId: "e2e_campaign_spring",
  // A second workspace's data, used to prove the UI never shows it.
  otherTenantId: "e2e_tenant_beta",
  otherUserId: "e2e_user_beta",
};

const url = process.env.E2E_DATABASE_URL?.trim();
if (!url) {
  console.error("E2E_DATABASE_URL is not set. Refusing to seed an unknown database.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function clear() {
  const tenants = [E2E.tenantId, E2E.otherTenantId];
  const users = [E2E.userId, E2E.otherUserId];
  await prisma.campaignDispatch.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.conversationMessage.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.conversationThread.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.campaignMessage.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.campaign.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.suppressionEntry.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.job.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.lead.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.leadList.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenantMember.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

function leadData(index, overrides = {}) {
  return {
    listId: E2E.listId,
    tenantId: E2E.tenantId,
    userId: E2E.userId,
    businessName: `Bright Smile Clinic ${index}`,
    phone: `+1555010${String(2000 + index).padStart(4, "0")}`,
    emails: JSON.stringify([`owner${index}@brightsmile.test`]),
    address: `${index} Market Street`,
    rating: 4.2,
    reviews: 40 + index,
    website: "",
    websiteMissing: true,
    websiteStatus: "MISSING",
    mapsUrl: "https://maps.example.test/place",
    category: "Dental clinic",
    dateAdded: new Date().toISOString(),
    instagramUrl: "",
    facebookUrl: "",
    linkedinUrl: "",
    aiInsight: "No website and an unclaimed listing.",
    leadScore: 70 + index,
    leadPriority: "HOT",
    ...overrides,
  };
}

async function main() {
  await clear();

  const passwordHash = await bcrypt.hash(E2E.password, 10);
  await prisma.user.create({
    data: { id: E2E.userId, email: E2E.email, name: "E2E Owner", passwordHash, emailVerified: true, role: "user", plan: "pro" },
  });
  await prisma.tenant.create({ data: { id: E2E.tenantId, name: E2E.tenantName, slug: E2E.tenantSlug } });
  await prisma.tenantMember.create({
    data: { tenantId: E2E.tenantId, userId: E2E.userId, role: "owner", status: "active" },
  });

  await prisma.leadList.create({
    data: {
      id: E2E.listId,
      name: "Nashik dentists",
      tenantId: E2E.tenantId,
      userId: E2E.userId,
      businessType: "Dental clinic",
      location: "Nashik",
    },
  });
  await prisma.lead.createMany({ data: [leadData(1), leadData(2), leadData(3)] });

  // A campaign mid-review, so the campaigns screen has a queue to show.
  await prisma.campaign.create({
    data: {
      id: E2E.campaignId,
      tenantId: E2E.tenantId,
      name: "Spring outreach",
      status: "pending_review",
      sourceType: "list",
      sourceListId: E2E.listId,
      channels: JSON.stringify({ email: true, whatsapp: false }),
      createdById: E2E.userId,
      totalMessages: 2,
      pendingCount: 1,
      sentCount: 1,
    },
  });
  await prisma.campaignMessage.createMany({
    data: [
      {
        id: "e2e_message_pending",
        campaignId: E2E.campaignId,
        tenantId: E2E.tenantId,
        businessName: "Bright Smile Clinic 1",
        recipient: "owner1@brightsmile.test",
        channel: "email",
        subject: "A faster way to fill your calendar",
        body: "Hello, we noticed your clinic has no website.",
        status: "pending_review",
      },
      {
        id: "e2e_message_sent",
        campaignId: E2E.campaignId,
        tenantId: E2E.tenantId,
        businessName: "Bright Smile Clinic 2",
        recipient: "owner2@brightsmile.test",
        channel: "email",
        subject: "Quick question about your booking flow",
        body: "Hello, a short note about online bookings.",
        status: "sent",
        sentAt: new Date(),
        externalMessageId: "smtp-e2e-1",
        idempotencyKey: "e2eidempotencykey0000000000000001",
      },
    ],
  });

  // Delivery history, so the report table and its charts have real rows.
  await prisma.campaignDispatch.createMany({
    data: [
      {
        tenantId: E2E.tenantId,
        campaignId: E2E.campaignId,
        campaignMessageId: "e2e_message_sent",
        businessName: "Bright Smile Clinic 2",
        recipient: "owner2@brightsmile.test",
        channel: "email",
        status: "SENT",
        sourceType: "reviewed_campaign",
        sourceLabel: "Spring outreach",
        subject: "Quick question about your booking flow",
        messageSnippet: "Hello, a short note about online bookings.",
        externalMessageId: "smtp-e2e-1",
        idempotencyKey: "e2eidempotencykey0000000000000001",
        occurredAt: new Date(),
      },
      {
        tenantId: E2E.tenantId,
        campaignId: E2E.campaignId,
        businessName: "Bright Smile Clinic 3",
        recipient: "+15550102003",
        channel: "whatsapp",
        status: "FAILED",
        sourceType: "reviewed_campaign",
        sourceLabel: "Spring outreach",
        messageSnippet: "Hello from Alpha Dental Group.",
        errorMessage: "Recipient is not on WhatsApp.",
        occurredAt: new Date(),
      },
    ],
  });

  // An inbound reply, so the inbox is not empty.
  const thread = await prisma.conversationThread.create({
    data: {
      tenantId: E2E.tenantId,
      channel: "email",
      contactKey: "owner2@brightsmile.test",
      businessName: "Bright Smile Clinic 2",
      email: "owner2@brightsmile.test",
      status: "REPLIED",
      unreadCount: 1,
      lastMessageAt: new Date(),
      lastMessagePreview: "Yes, please send more detail.",
    },
  });
  await prisma.conversationMessage.createMany({
    data: [
      {
        tenantId: E2E.tenantId,
        threadId: thread.id,
        direction: "out",
        channel: "email",
        text: "Hello, a short note about online bookings.",
        source: "campaign",
        provider: "smtp",
        occurredAt: new Date(Date.now() - 60_000),
      },
      {
        tenantId: E2E.tenantId,
        threadId: thread.id,
        direction: "in",
        channel: "email",
        text: "Yes, please send more detail.",
        source: "imap",
        provider: "imap",
        occurredAt: new Date(),
      },
    ],
  });

  // One existing opt-out for this workspace, and one belonging to a different
  // workspace that must never appear on screen.
  await prisma.suppressionEntry.create({
    data: {
      tenantId: E2E.tenantId,
      channel: "email",
      contactKey: "optedout@brightsmile.test",
      reason: "opt_out_reply",
      source: "inbound_email",
      notes: "Replied STOP to the March campaign.",
    },
  });

  await prisma.user.create({
    data: { id: E2E.otherUserId, email: "e2e-beta@example.test", passwordHash, emailVerified: true },
  });
  await prisma.tenant.create({ data: { id: E2E.otherTenantId, name: "Beta Clinic Group", slug: "e2e-beta" } });
  await prisma.tenantMember.create({
    data: { tenantId: E2E.otherTenantId, userId: E2E.otherUserId, role: "owner", status: "active" },
  });
  await prisma.suppressionEntry.create({
    data: { tenantId: E2E.otherTenantId, channel: "email", contactKey: "beta-secret@other.test", reason: "manual" },
  });
  await prisma.campaignDispatch.create({
    data: {
      tenantId: E2E.otherTenantId,
      businessName: "Beta Workspace Business",
      recipient: "beta-lead@other.test",
      channel: "email",
      status: "SENT",
      sourceType: "manual",
      sourceLabel: "Beta manual outreach",
      occurredAt: new Date(),
    },
  });

  console.log(`Seeded ${E2E.tenantName} (${E2E.email}) and a second workspace for isolation checks.`);
}

main()
  .catch((error) => {
    console.error("E2E seed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
