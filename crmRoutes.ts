/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CRM Routes — full lead management API backed by MySQL via Prisma.
 * Provides named lead lists, rich sorting/filtering, notes, and CSV export.
 */

import express from "express";
import { prisma } from "./src/prisma";
import { Lead as LeadType } from "./src/types";
import { logger } from "./src/logger";

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a DB lead row back to the app's Lead type */
function dbLeadToAppLead(l: any): LeadType & { id: string; listId: string; notes?: string } {
  return {
    id: l.id,
    listId: l.listId,
    businessName: l.businessName,
    phone: l.phone ?? "",
    address: l.address ?? "",
    rating: l.rating ?? 0,
    reviews: l.reviews ?? 0,
    website: l.website ?? "",
    mapsUrl: l.mapsUrl ?? "",
    category: l.category ?? "",
    websiteMissing: l.websiteMissing ?? false,
    leadScore: l.leadScore ?? 0,
    dateAdded: l.dateAdded ?? "",
    websiteStatus: (l.websiteStatus ?? "MISSING") as any,
    instagramUrl: l.instagramUrl ?? "",
    instagramStatus: (l.instagramStatus ?? "NOT_FOUND") as any,
    instagramLastPost: l.instagramLastPost ?? "",
    facebookUrl: l.facebookUrl ?? "",
    facebookStatus: (l.facebookStatus ?? "NOT_FOUND") as any,
    facebookLastPost: l.facebookLastPost ?? "",
    whatsappPresent: l.whatsappPresent ?? false,
    appointmentSystem: l.appointmentSystem ?? false,
    leadPriority: (l.leadPriority ?? "COLD") as any,
    aiInsight: l.aiInsight ?? "",
    emails: l.emails ? (() => { try { return JSON.parse(l.emails); } catch { return []; } })() : [],
    linkedinUrl: l.linkedinUrl ?? "",
    linkedinStatus: (l.linkedinStatus ?? "NOT_FOUND") as any,
    googleAnalyticsPresent: l.googleAnalyticsPresent ?? false,
    metaPixelPresent: l.metaPixelPresent ?? false,
    emailStatus: l.emailStatus as any,
    emailSentDate: l.emailSentDate ?? undefined,
    whatsappStatus: l.whatsappStatus as any,
    whatsappSentDate: l.whatsappSentDate ?? undefined,
    conversationStatus: (l.conversationStatus ?? undefined) as any,
    lat: l.lat ?? undefined,
    lng: l.lng ?? undefined,
    notes: l.notes ?? undefined,
  };
}

/** Convert app Lead type to DB create/update input */
function appLeadToDbInput(lead: LeadType, listId: string, userId?: string | null) {
  return {
    listId,
    userId: userId ?? null,
    businessName: lead.businessName,
    phone: lead.phone ?? "",
    address: lead.address ?? "",
    rating: typeof lead.rating === "number" ? lead.rating : 0,
    reviews: typeof lead.reviews === "number" ? lead.reviews : 0,
    website: lead.website ?? "",
    mapsUrl: lead.mapsUrl ?? "",
    category: lead.category ?? "",
    websiteMissing: Boolean(lead.websiteMissing),
    leadScore: typeof lead.leadScore === "number" ? lead.leadScore : 0,
    dateAdded: lead.dateAdded ?? new Date().toISOString(),
    websiteStatus: lead.websiteStatus ?? "MISSING",
    instagramUrl: lead.instagramUrl ?? "",
    instagramStatus: lead.instagramStatus ?? "NOT_FOUND",
    instagramLastPost: lead.instagramLastPost ?? "",
    facebookUrl: lead.facebookUrl ?? "",
    facebookStatus: lead.facebookStatus ?? "NOT_FOUND",
    facebookLastPost: lead.facebookLastPost ?? "",
    whatsappPresent: Boolean(lead.whatsappPresent),
    appointmentSystem: Boolean(lead.appointmentSystem),
    leadPriority: lead.leadPriority ?? "COLD",
    aiInsight: lead.aiInsight ?? "",
    emails: JSON.stringify(Array.isArray(lead.emails) ? lead.emails : []),
    linkedinUrl: lead.linkedinUrl ?? "",
    linkedinStatus: lead.linkedinStatus ?? "NOT_FOUND",
    googleAnalyticsPresent: Boolean(lead.googleAnalyticsPresent),
    metaPixelPresent: Boolean(lead.metaPixelPresent),
    emailStatus: lead.emailStatus ?? null,
    emailSentDate: lead.emailSentDate ?? null,
    whatsappStatus: lead.whatsappStatus ?? null,
    whatsappSentDate: lead.whatsappSentDate ?? null,
    conversationStatus: lead.conversationStatus ?? null,
    lat: lead.lat ?? null,
    lng: lead.lng ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// LEAD LIST ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/crm/lists
 * Returns all lead lists for the current user (or global if no auth).
 */
router.get("/lists", async (req: any, res) => {
  try {
    const userId = req.authUser?.id ?? null;
    const where = userId ? { userId } : {};
    const lists = await prisma.leadList.findMany({
      where,
      orderBy: { scrapedAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
    res.json(lists.map((l: any) => ({
      id: l.id,
      name: l.name,
      businessType: l.businessType,
      location: l.location,
      scrapedAt: l.scrapedAt,
      createdAt: l.createdAt,
      leadCount: l._count.leads,
    })));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch lead lists", err);
    res.status(500).json({ error: "Failed to fetch lead lists." });
  }
});

/**
 * POST /api/crm/lists
 * Create a new named lead list.
 * Body: { name, businessType, location }
 */
router.post("/lists", async (req: any, res) => {
  try {
    const { name, businessType, location } = req.body;
    if (!name) return res.status(400).json({ error: "List name is required." });
    const userId = req.authUser?.id ?? null;
    const list = await prisma.leadList.create({
      data: {
        name: String(name),
        businessType: String(businessType || ""),
        location: String(location || ""),
        userId,
      },
    });
    res.json({ id: list.id, name: list.name, businessType: list.businessType, location: list.location, scrapedAt: list.scrapedAt, leadCount: 0 });
  } catch (err: any) {
    logger.error("CRM: Failed to create lead list", err);
    res.status(500).json({ error: "Failed to create lead list." });
  }
});

/**
 * PATCH /api/crm/lists/:id
 * Rename a lead list.
 * Body: { name }
 */
router.patch("/lists/:id", async (req: any, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "List name is required." });
    const list = await prisma.leadList.update({
      where: { id: req.params.id },
      data: { name: String(name) },
    });
    res.json({ id: list.id, name: list.name });
  } catch (err: any) {
    logger.error("CRM: Failed to rename lead list", err);
    res.status(500).json({ error: "Failed to rename lead list." });
  }
});

/**
 * DELETE /api/crm/lists/:id
 * Delete a lead list and all its leads (cascade).
 */
router.delete("/lists/:id", async (req: any, res) => {
  try {
    await prisma.leadList.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    logger.error("CRM: Failed to delete lead list", err);
    res.status(500).json({ error: "Failed to delete lead list." });
  }
});

/**
 * Build a Prisma `where` clause from the shared lead query params.
 * Callers add their own scope (listId / list-id set) to the returned object.
 *
 * Query params:
 *   search        — text search (name, address, phone, email)
 *   priority      — HOT | WARM | COLD | ALL
 *   websiteStatus — MISSING | WORKING | BROKEN | OUTDATED | ALL
 *   emailStatus   — SENT | PENDING | NONE | ALL
 *   whatsappStatus — SENT | PENDING | NONE | ALL
 *   dateFrom      — ISO date string
 *   dateTo        — ISO date string
 */
function buildLeadWhere(query: Record<string, string>): any {
  const {
    search = "",
    priority = "ALL",
    websiteStatus = "ALL",
    emailStatus = "ALL",
    whatsappStatus = "ALL",
    dateFrom,
    dateTo,
  } = query;

  const where: any = {};

  if (priority !== "ALL") where.leadPriority = priority;
  if (websiteStatus !== "ALL") where.websiteStatus = websiteStatus;

  // Outreach status filtering
  if (emailStatus === "SENT") where.emailStatus = "SENT";
  else if (emailStatus === "PENDING") where.emailStatus = null;
  else if (emailStatus === "NONE") where.emails = "";

  if (whatsappStatus === "SENT") where.whatsappStatus = "SENT";
  else if (whatsappStatus === "PENDING") where.whatsappStatus = null;

  // Date range filtering (on dateAdded string — ISO format)
  if (dateFrom || dateTo) {
    where.dateAdded = {};
    if (dateFrom) where.dateAdded.gte = String(dateFrom);
    if (dateTo) where.dateAdded.lte = String(dateTo) + "T23:59:59.999Z";
  }

  // Text search
  if (search && search.trim()) {
    const s = search.trim();
    where.OR = [
      { businessName: { contains: s } },
      { address: { contains: s } },
      { phone: { contains: s } },
      { emails: { contains: s } },
      { category: { contains: s } },
      { aiInsight: { contains: s } },
    ];
  }

  return where;
}

/** Build a Prisma `orderBy` from the shared sort params. */
function buildLeadOrderBy(query: Record<string, string>): any {
  const { sortBy = "leadScore", sortDir = "desc" } = query;
  const allowedSorts: Record<string, string> = {
    businessName: "businessName",
    leadScore: "leadScore",
    leadPriority: "leadPriority",
    rating: "rating",
    reviews: "reviews",
    dateAdded: "dateAdded",
  };
  const orderField = allowedSorts[sortBy] ?? "leadScore";
  const direction = sortDir === "asc" ? "asc" : "desc";
  return { [orderField]: direction };
}

/**
 * GET /api/crm/leads
 * Aggregated view: every lead across ALL of the current user's lists, with the
 * same filtering/sorting as the per-list endpoint. Each lead is annotated with
 * its originating list name so the UI can show where it came from.
 */
router.get("/leads", async (req: any, res) => {
  try {
    const userId = req.authUser?.id ?? null;
    const listWhere = userId ? { userId } : {};
    const userLists = await prisma.leadList.findMany({
      where: listWhere,
      select: { id: true, name: true },
    });
    const listNameById = new Map(userLists.map((l: any) => [l.id, l.name]));

    const where = buildLeadWhere(req.query as Record<string, string>);
    where.listId = { in: userLists.map((l: any) => l.id) };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: buildLeadOrderBy(req.query as Record<string, string>),
    });

    res.json(leads.map((l: any) => ({
      ...dbLeadToAppLead(l),
      listName: listNameById.get(l.listId) ?? "",
    })));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch all leads", err);
    res.status(500).json({ error: "Failed to fetch leads." });
  }
});

/**
 * GET /api/crm/lists/:id/leads
 * Get leads in a single list with rich filtering and sorting.
 */
router.get("/lists/:id/leads", async (req: any, res) => {
  try {
    const where = buildLeadWhere(req.query as Record<string, string>);
    where.listId = req.params.id;

    const leads = await prisma.lead.findMany({
      where,
      orderBy: buildLeadOrderBy(req.query as Record<string, string>),
    });

    res.json(leads.map(dbLeadToAppLead));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch leads", err);
    res.status(500).json({ error: "Failed to fetch leads." });
  }
});

/**
 * POST /api/crm/lists/:id/leads
 * Bulk save leads to a list (called by scraper hook).
 * Body: { leads: Lead[] }
 */
router.post("/lists/:id/leads", async (req: any, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads)) return res.status(400).json({ error: "leads must be an array." });
    const userId = req.authUser?.id ?? null;
    const listId = req.params.id;
    
    // Upsert by businessName+listId to avoid duplicates on re-import
    let created = 0;
    let updated = 0;
    for (const lead of leads) {
      const data = appLeadToDbInput(lead as LeadType, listId, userId);
      const existing = await prisma.lead.findFirst({
        where: { listId, businessName: lead.businessName },
      });
      if (existing) {
        await prisma.lead.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.lead.create({ data });
        created++;
      }
    }
    res.json({ success: true, created, updated });
  } catch (err: any) {
    logger.error("CRM: Failed to save leads to list", err);
    res.status(500).json({ error: "Failed to save leads." });
  }
});

/**
 * PATCH /api/crm/leads/:id
 * Update a single lead. Supports both quick outreach-status patches and full
 * core-field edits (from the Leads table's Edit action).
 * Body: {
 *   notes?, emailStatus?, whatsappStatus?, emailSentDate?, whatsappSentDate?,
 *   businessName?, phone?, address?, category?, website?, rating?, reviews?,
 *   leadPriority?
 * }
 */
router.patch("/leads/:id", async (req: any, res) => {
  try {
    const {
      notes, emailStatus, whatsappStatus, emailSentDate, whatsappSentDate,
      businessName, phone, address, category, website, rating, reviews, leadPriority,
    } = req.body;
    const updateData: any = {};
    if (notes !== undefined) updateData.notes = notes;
    if (emailStatus !== undefined) updateData.emailStatus = emailStatus;
    if (whatsappStatus !== undefined) updateData.whatsappStatus = whatsappStatus;
    if (emailSentDate !== undefined) updateData.emailSentDate = emailSentDate;
    if (whatsappSentDate !== undefined) updateData.whatsappSentDate = whatsappSentDate;

    if (businessName !== undefined) updateData.businessName = String(businessName);
    if (phone !== undefined) updateData.phone = String(phone);
    if (address !== undefined) updateData.address = String(address);
    if (category !== undefined) updateData.category = String(category);
    if (website !== undefined) updateData.website = String(website);
    if (rating !== undefined) updateData.rating = Number(rating) || 0;
    if (reviews !== undefined) updateData.reviews = Number(reviews) || 0;
    if (leadPriority !== undefined && ["HOT", "WARM", "COLD"].includes(leadPriority)) {
      updateData.leadPriority = leadPriority;
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json(dbLeadToAppLead(lead));
  } catch (err: any) {
    logger.error("CRM: Failed to update lead", err);
    res.status(500).json({ error: "Failed to update lead." });
  }
});

/**
 * DELETE /api/crm/leads/:id
 * Delete a single lead from the DB.
 */
router.delete("/leads/:id", async (req: any, res) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    logger.error("CRM: Failed to delete lead", err);
    res.status(500).json({ error: "Failed to delete lead." });
  }
});

/**
 * GET /api/crm/lists/:id/export
 * Export leads in a list as CSV.
 */
router.get("/lists/:id/export", async (req: any, res) => {
  try {
    const isAll = req.params.id === "ALL";
    const leads = await prisma.lead.findMany({
      where: isAll ? {} : { listId: req.params.id },
      orderBy: { leadScore: "desc" },
    });

    const headers = [
      "Business Name","Phone","Address","Rating","Reviews","Website","Website Status",
      "Instagram URL","Instagram Status","Facebook URL","Facebook Status","LinkedIn URL",
      "LinkedIn Status","Emails","Google Analytics","Meta Pixel","WhatsApp Present",
      "Appointment System","Google Maps URL","Lead Score","Lead Priority","Date Added",
      "AI Insight","Category","Website Missing","Email Status","WhatsApp Status","Notes",
    ];

    const escape = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = leads.map((l: any) => {
      const emails = (() => { try { return JSON.parse(l.emails || "[]").join("; "); } catch { return ""; } })();
      return [
        l.businessName, l.phone, l.address, l.rating, l.reviews, l.website, l.websiteStatus,
        l.instagramUrl, l.instagramStatus, l.facebookUrl, l.facebookStatus, l.linkedinUrl,
        l.linkedinStatus, emails, l.googleAnalyticsPresent ? "Yes" : "No",
        l.metaPixelPresent ? "Yes" : "No", l.whatsappPresent ? "Yes" : "No",
        l.appointmentSystem ? "Yes" : "No", l.mapsUrl, l.leadScore, l.leadPriority,
        l.dateAdded, l.aiInsight, l.category, l.websiteMissing ? "Yes" : "No",
        l.emailStatus || "", l.whatsappStatus || "", l.notes || "",
      ].map(escape).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const listInfo = isAll ? null : await prisma.leadList.findUnique({ where: { id: req.params.id } });
    const filename = `${(listInfo?.name ?? "all_leads").replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    logger.error("CRM: Failed to export leads", err);
    res.status(500).json({ error: "Failed to export leads." });
  }
});

export default router;
export { appLeadToDbInput, dbLeadToAppLead };
