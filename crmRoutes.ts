/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CRM Routes — full lead management API backed by MySQL via Prisma.
 * Provides named lead lists, rich sorting/filtering, notes, and CSV export.
 *
 * TENANT ISOLATION
 * ----------------
 * Every route in this router is scoped to the signed-in user. `requireTenant`
 * runs first and refuses the request outright when there is no session, and
 * each query carries an explicit ownership predicate.
 *
 * This router previously derived its scope from `req.authUser?.id ?? null` and
 * treated `null` as "unauthenticated, so operate globally". Because the router
 * was also mounted before the middleware that populates `req.authUser`, the
 * scope was ALWAYS null in practice: any anonymous caller could read, edit and
 * delete every tenant's lists and leads, and GET /lists/ALL/export returned the
 * entire leads table as CSV. Ownership is now mandatory, never inferred.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { prisma } from "./src/prisma";
import { Lead as LeadType } from "./src/types";
import { logger } from "./src/logger";
import { env } from "./src/env";

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// Tenant guard
// ──────────────────────────────────────────────────────────────────────────────

/** The resolved owner for the current request. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Owning user id for every CRM query in this request. Never null. */
      tenantUserId?: string;
    }
  }
}

/**
 * Requires an authenticated owner. `req.authUser` is populated by
 * attachEntitlements, which runs before this router is mounted.
 */
function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!env.isDatabaseConfigured()) {
    return res.status(503).json({
      error: "The CRM requires a configured database.",
      code: "db_unconfigured",
    });
  }

  const userId = req.authUser?.id;
  if (!userId) {
    return res.status(401).json({
      error: "Authentication required.",
      code: "no_session",
    });
  }

  req.tenantUserId = userId;
  next();
}

router.use(requireTenant);

/**
 * Resolves a lead list only if the current user owns it. Returning null for
 * "not yours" as well as "does not exist" is deliberate: responding 404 either
 * way stops the API confirming that another tenant's list id is real.
 */
async function findOwnedList(listId: string, userId: string) {
  return prisma.leadList.findFirst({ where: { id: listId, userId } });
}

/** Resolves a lead only if it sits in a list the current user owns. */
async function findOwnedLead(leadId: string, userId: string) {
  return prisma.lead.findFirst({
    where: { id: leadId, list: { is: { userId } } },
    select: { id: true },
  });
}

const NOT_FOUND_LIST = { error: "Lead list not found.", code: "not_found" } as const;
const NOT_FOUND_LEAD = { error: "Lead not found.", code: "not_found" } as const;

// ──────────────────────────────────────────────────────────────────────────────
// Input limits
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Field caps. Text written here is rendered in the dashboard, so unbounded
 * input was both a storage and a stored-XSS concern. Values are generous enough
 * that no realistic record is truncated.
 */
const LIMITS = {
  listName: 200,
  businessName: 300,
  phone: 60,
  address: 1000,
  category: 200,
  website: 500,
  notes: 10_000,
  /** Cap on a single bulk import. Each item costs two queries. */
  bulkLeads: 5_000,
} as const;

function trimTo(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

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
    businessName: trimTo(lead.businessName, LIMITS.businessName),
    phone: trimTo(lead.phone ?? "", LIMITS.phone),
    address: trimTo(lead.address ?? "", LIMITS.address),
    rating: typeof lead.rating === "number" ? lead.rating : 0,
    reviews: typeof lead.reviews === "number" ? lead.reviews : 0,
    website: trimTo(lead.website ?? "", LIMITS.website),
    mapsUrl: lead.mapsUrl ?? "",
    category: trimTo(lead.category ?? "", LIMITS.category),
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
 * Returns the current user's lead lists.
 */
router.get("/lists", async (req: Request, res: Response) => {
  try {
    const lists = await prisma.leadList.findMany({
      where: { userId: req.tenantUserId },
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
 * Create a new named lead list owned by the current user.
 * Body: { name, businessType, location }
 */
router.post("/lists", async (req: Request, res: Response) => {
  try {
    const { name, businessType, location } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "List name is required." });
    }
    const list = await prisma.leadList.create({
      data: {
        name: trimTo(name, LIMITS.listName),
        businessType: trimTo(businessType || "", LIMITS.category),
        location: trimTo(location || "", LIMITS.address),
        // Ownership is never null: an unowned list would be invisible to its
        // creator and readable by nobody, which is how orphan rows appear.
        userId: req.tenantUserId!,
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
 * Rename one of the current user's lead lists.
 * Body: { name }
 */
router.patch("/lists/:id", async (req: Request, res: Response) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "List name is required." });
    }

    const owned = await findOwnedList(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LIST);

    const list = await prisma.leadList.update({
      where: { id: owned.id },
      data: { name: trimTo(name, LIMITS.listName) },
    });
    res.json({ id: list.id, name: list.name });
  } catch (err: any) {
    logger.error("CRM: Failed to rename lead list", err);
    res.status(500).json({ error: "Failed to rename lead list." });
  }
});

/**
 * DELETE /api/crm/lists/:id
 * Delete one of the current user's lead lists and all its leads (cascade).
 */
router.delete("/lists/:id", async (req: Request, res: Response) => {
  try {
    const owned = await findOwnedList(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LIST);

    await prisma.leadList.delete({ where: { id: owned.id } });
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

  // Allow-list the enum filters so an unexpected value cannot reach Prisma and
  // surface as an unhandled 500.
  const PRIORITIES = ["HOT", "WARM", "COLD"];
  const WEBSITE_STATUSES = ["MISSING", "WORKING", "BROKEN", "OUTDATED"];
  if (priority !== "ALL" && PRIORITIES.includes(priority)) where.leadPriority = priority;
  if (websiteStatus !== "ALL" && WEBSITE_STATUSES.includes(websiteStatus)) where.websiteStatus = websiteStatus;

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
    const s = search.trim().slice(0, 200);
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
router.get("/leads", async (req: Request, res: Response) => {
  try {
    const userLists = await prisma.leadList.findMany({
      where: { userId: req.tenantUserId },
      select: { id: true, name: true },
    });
    const listNameById = new Map(userLists.map((l: any) => [l.id, l.name]));

    // No lists means no leads. Without this guard an empty `in` array would
    // match nothing anyway, but being explicit avoids a pointless query.
    if (userLists.length === 0) return res.json([]);

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
 * Get leads in one of the current user's lists, with filtering and sorting.
 */
router.get("/lists/:id/leads", async (req: Request, res: Response) => {
  try {
    const owned = await findOwnedList(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LIST);

    const where = buildLeadWhere(req.query as Record<string, string>);
    where.listId = owned.id;

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
 * Bulk save leads into one of the current user's lists.
 * Body: { leads: Lead[] }
 */
router.post("/lists/:id/leads", async (req: Request, res: Response) => {
  try {
    const { leads } = req.body || {};
    if (!Array.isArray(leads)) return res.status(400).json({ error: "leads must be an array." });
    if (leads.length > LIMITS.bulkLeads) {
      return res.status(413).json({
        error: `Too many leads in one request. Send at most ${LIMITS.bulkLeads}.`,
        code: "batch_too_large",
      });
    }

    const owned = await findOwnedList(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LIST);

    const userId = req.tenantUserId!;
    const listId = owned.id;

    // Upsert by businessName+listId to avoid duplicates on re-import
    let created = 0;
    let updated = 0;
    for (const lead of leads) {
      if (!lead || typeof lead !== "object" || !lead.businessName) continue;
      const data = appLeadToDbInput(lead as LeadType, listId, userId);
      const existing = await prisma.lead.findFirst({
        where: { listId, businessName: data.businessName },
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
 * Update one of the current user's leads. Supports both quick outreach-status
 * patches and full core-field edits (from the Leads table's Edit action).
 */
router.patch("/leads/:id", async (req: Request, res: Response) => {
  try {
    const owned = await findOwnedLead(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LEAD);

    const {
      notes, emailStatus, whatsappStatus, emailSentDate, whatsappSentDate,
      businessName, phone, address, category, website, rating, reviews, leadPriority,
    } = req.body || {};
    const updateData: any = {};

    const OUTREACH_STATUSES = ["PENDING", "SENT", "FAILED"];
    if (notes !== undefined) updateData.notes = trimTo(notes, LIMITS.notes);
    if (emailStatus !== undefined) {
      if (emailStatus !== null && !OUTREACH_STATUSES.includes(emailStatus)) {
        return res.status(400).json({ error: "Invalid emailStatus." });
      }
      updateData.emailStatus = emailStatus;
    }
    if (whatsappStatus !== undefined) {
      if (whatsappStatus !== null && !OUTREACH_STATUSES.includes(whatsappStatus)) {
        return res.status(400).json({ error: "Invalid whatsappStatus." });
      }
      updateData.whatsappStatus = whatsappStatus;
    }
    if (emailSentDate !== undefined) updateData.emailSentDate = emailSentDate;
    if (whatsappSentDate !== undefined) updateData.whatsappSentDate = whatsappSentDate;

    if (businessName !== undefined) updateData.businessName = trimTo(businessName, LIMITS.businessName);
    if (phone !== undefined) updateData.phone = trimTo(phone, LIMITS.phone);
    if (address !== undefined) updateData.address = trimTo(address, LIMITS.address);
    if (category !== undefined) updateData.category = trimTo(category, LIMITS.category);
    if (website !== undefined) updateData.website = trimTo(website, LIMITS.website);
    if (rating !== undefined) updateData.rating = Number(rating) || 0;
    if (reviews !== undefined) updateData.reviews = Number(reviews) || 0;
    if (leadPriority !== undefined && ["HOT", "WARM", "COLD"].includes(leadPriority)) {
      updateData.leadPriority = leadPriority;
    }

    const lead = await prisma.lead.update({
      where: { id: owned.id },
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
 * Delete one of the current user's leads.
 */
router.delete("/leads/:id", async (req: Request, res: Response) => {
  try {
    const owned = await findOwnedLead(req.params.id, req.tenantUserId!);
    if (!owned) return res.status(404).json(NOT_FOUND_LEAD);

    await prisma.lead.delete({ where: { id: owned.id } });
    res.json({ success: true });
  } catch (err: any) {
    logger.error("CRM: Failed to delete lead", err);
    res.status(500).json({ error: "Failed to delete lead." });
  }
});

/**
 * GET /api/crm/lists/:id/export
 * Export leads as CSV. `:id` may be "ALL", which exports every lead across the
 * CURRENT USER'S lists only — it previously exported the entire leads table.
 */
router.get("/lists/:id/export", async (req: Request, res: Response) => {
  try {
    const userId = req.tenantUserId!;
    const isAll = req.params.id === "ALL";

    let listInfo: { id: string; name: string } | null = null;
    let where: any;

    if (isAll) {
      const userLists = await prisma.leadList.findMany({
        where: { userId },
        select: { id: true },
      });
      where = { listId: { in: userLists.map((l: any) => l.id) } };
    } else {
      const owned = await findOwnedList(req.params.id, userId);
      if (!owned) return res.status(404).json(NOT_FOUND_LIST);
      listInfo = { id: owned.id, name: owned.name };
      where = { listId: owned.id };
    }

    const leads = await prisma.lead.findMany({
      where,
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
export { appLeadToDbInput, dbLeadToAppLead, requireTenant };
