/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CRM Routes — lead management API backed by MySQL via Prisma.
 * Named lead lists, rich sorting/filtering, notes, and CSV export.
 *
 * TENANT ISOLATION
 * ----------------
 * `resolveTenantContext` runs before every route and refuses the request when
 * there is no session or no workspace. Data access then goes exclusively through
 * src/tenancy/repository.ts, which injects the tenant predicate itself — there
 * is no repository function that accepts a bare id, so a handler here cannot
 * express an unscoped query even by mistake.
 *
 * That structure is the point. Before Phase 1 this router derived its scope from
 * `req.authUser?.id ?? null` and treated null as "operate globally"; because it
 * was also mounted before the middleware that populates `req.authUser`, the
 * scope was always null and every tenant's data was readable, editable and
 * deletable by an anonymous caller. Phase 1 added the predicate to all ten
 * handlers; Phase 2 removes the possibility of forgetting it.
 *
 * Each route also declares the capability it needs, so a member can be given
 * lead access without the ability to delete records or export the database.
 */

import express, { type Request, type Response } from "express";
import { prisma } from "./src/prisma";
import { Lead as LeadType } from "./src/types";
import { logger } from "./src/logger";
import { resolveTenantContext, requirePermission, ctxOf } from "./src/tenancy/context";
import * as repo from "./src/tenancy/repository";

const router = express.Router();

// Establishes req.ctx (user, workspace, role, permissions) for every route.
router.use(resolveTenantContext);

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
// Row mapping
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
    // Score provenance. Without scoreMax a stored leadScore cannot be read as a
    // proportion, which is why the dashboard could only ever show a bare number.
    scoreMax: l.scoreMax ?? undefined,
    scoreBreakdown: l.scoreBreakdown
      ? (() => {
          try {
            return JSON.parse(l.scoreBreakdown);
          } catch {
            return undefined;
          }
        })()
      : undefined,
    scoringRuleSetId: l.scoringRuleSetId ?? undefined,
    scoringVersion: l.scoringVersion ?? undefined,
    icpProfileId: l.icpProfileId ?? undefined,
    icpFitScore: l.icpFitScore ?? undefined,
    icpFitReason: l.icpFitReason ?? undefined,
  };
}

/**
 * Convert app Lead type to DB create/update input.
 *
 * `userId` is still populated alongside `tenantId` (the repository adds both):
 * the scraper persistence path and the Google Sheets sync still read it, so
 * dropping it now would break them. It goes when those readers move over.
 */
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
    // Score provenance, so a stored score can be read as a proportion and traced
    // to the rule set version that produced it. Null for leads created by hand
    // through the CRM, which are not scored.
    scoreMax: typeof lead.scoreMax === "number" ? lead.scoreMax : null,
    scoreBreakdown: lead.scoreBreakdown ? JSON.stringify(lead.scoreBreakdown) : null,
    scoringRuleSetId: lead.scoringRuleSetId ?? null,
    scoringVersion: typeof lead.scoringVersion === "number" ? lead.scoringVersion : null,
    scoredAt: typeof lead.leadScore === "number" ? new Date() : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Query building
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a Prisma `where` fragment from the shared lead query params. The tenant
 * predicate is NOT part of this — the repository owns that, so a caller cannot
 * accidentally use these filters as the entire clause.
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
function buildLeadWhere(query: Record<string, string>): Record<string, unknown> {
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
function buildLeadOrderBy(query: Record<string, string>): Record<string, unknown> {
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

// ──────────────────────────────────────────────────────────────────────────────
// LEAD LIST ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

/** GET /api/crm/lists — the workspace's lead lists. */
router.get("/lists", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const lists = await repo.listLeadLists(ctxOf(req));
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

/** POST /api/crm/lists — create a list in the workspace. Body: { name, businessType, location } */
router.post("/lists", requirePermission("MANAGE_CRM"), async (req: Request, res: Response) => {
  try {
    const { name, businessType, location } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "List name is required." });
    }
    const list = await repo.createLeadList(ctxOf(req), {
      name: trimTo(name, LIMITS.listName),
      businessType: trimTo(businessType || "", LIMITS.category),
      location: trimTo(location || "", LIMITS.address),
    });
    res.json({
      id: list.id,
      name: list.name,
      businessType: list.businessType,
      location: list.location,
      scrapedAt: list.scrapedAt,
      leadCount: 0,
    });
  } catch (err: any) {
    logger.error("CRM: Failed to create lead list", err);
    res.status(500).json({ error: "Failed to create lead list." });
  }
});

/** PATCH /api/crm/lists/:id — rename. Body: { name } */
router.patch("/lists/:id", requirePermission("MANAGE_CRM"), async (req: Request, res: Response) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "List name is required." });
    }
    const list = await repo.renameLeadList(ctxOf(req), req.params.id, trimTo(name, LIMITS.listName));
    if (!list) return res.status(404).json(NOT_FOUND_LIST);
    res.json({ id: list.id, name: list.name });
  } catch (err: any) {
    logger.error("CRM: Failed to rename lead list", err);
    res.status(500).json({ error: "Failed to rename lead list." });
  }
});

/**
 * DELETE /api/crm/lists/:id — delete the list and its leads (cascade).
 *
 * Requires DELETE_LEADS rather than MANAGE_CRM: the row being deleted is a
 * container, but the cascade destroys every lead inside it, so the permission
 * has to reflect the real blast radius. A member can create and rename lists —
 * that is ordinary organising work — but cannot wipe one out.
 */
router.delete("/lists/:id", requirePermission("DELETE_LEADS"), async (req: Request, res: Response) => {
  try {
    const deleted = await repo.deleteLeadList(ctxOf(req), req.params.id);
    if (!deleted) return res.status(404).json(NOT_FOUND_LIST);
    res.json({ success: true });
  } catch (err: any) {
    logger.error("CRM: Failed to delete lead list", err);
    res.status(500).json({ error: "Failed to delete lead list." });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// LEAD ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/crm/leads
 * Every lead across the workspace's lists, annotated with its list name.
 */
router.get("/leads", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const lists = await repo.listLeadLists(ctx);
    const listNameById = new Map(lists.map((l: any) => [l.id, l.name]));

    const leads = await repo.findLeadsInWorkspace(
      ctx,
      buildLeadWhere(req.query as Record<string, string>),
      buildLeadOrderBy(req.query as Record<string, string>)
    );

    res.json(leads.map((l: any) => ({
      ...dbLeadToAppLead(l),
      listName: listNameById.get(l.listId) ?? "",
    })));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch all leads", err);
    res.status(500).json({ error: "Failed to fetch leads." });
  }
});

/** GET /api/crm/lists/:id/leads — leads in one owned list. */
router.get("/lists/:id/leads", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const leads = await repo.findLeadsInList(
      ctxOf(req),
      req.params.id,
      buildLeadWhere(req.query as Record<string, string>),
      buildLeadOrderBy(req.query as Record<string, string>)
    );
    if (leads === null) return res.status(404).json(NOT_FOUND_LIST);
    res.json(leads.map(dbLeadToAppLead));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch leads", err);
    res.status(500).json({ error: "Failed to fetch leads." });
  }
});

/** POST /api/crm/lists/:id/leads — bulk upsert into an owned list. Body: { leads: Lead[] } */
router.post("/lists/:id/leads", requirePermission("EDIT_LEADS"), async (req: Request, res: Response) => {
  try {
    const { leads } = req.body || {};
    if (!Array.isArray(leads)) return res.status(400).json({ error: "leads must be an array." });
    if (leads.length > LIMITS.bulkLeads) {
      return res.status(413).json({
        error: `Too many leads in one request. Send at most ${LIMITS.bulkLeads}.`,
        code: "batch_too_large",
      });
    }

    const ctx = ctxOf(req);
    const owned = await repo.findLeadList(ctx, req.params.id);
    if (!owned) return res.status(404).json(NOT_FOUND_LIST);

    let created = 0;
    let updated = 0;
    for (const lead of leads) {
      if (!lead || typeof lead !== "object" || !lead.businessName) continue;
      const data = appLeadToDbInput(lead as LeadType, owned.id, ctx.userId);
      const existing = await repo.findLeadByName(ctx, owned.id, data.businessName);
      if (existing) {
        await repo.updateLeadById(existing.id, data);
        updated++;
      } else {
        await repo.createLead(ctx, data);
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
 * Quick outreach-status patches and full core-field edits.
 */
router.patch("/leads/:id", requirePermission("EDIT_LEADS"), async (req: Request, res: Response) => {
  try {
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

    const lead = await repo.updateLead(ctxOf(req), req.params.id, updateData);
    if (!lead) return res.status(404).json(NOT_FOUND_LEAD);
    res.json(dbLeadToAppLead(lead));
  } catch (err: any) {
    logger.error("CRM: Failed to update lead", err);
    res.status(500).json({ error: "Failed to update lead." });
  }
});

/**
 * DELETE /api/crm/leads/:id
 * Requires DELETE_LEADS, which the default `member` role does not have — a
 * teammate can correct a record but not destroy it.
 */
router.delete("/leads/:id", requirePermission("DELETE_LEADS"), async (req: Request, res: Response) => {
  try {
    const deleted = await repo.deleteLead(ctxOf(req), req.params.id);
    if (!deleted) return res.status(404).json(NOT_FOUND_LEAD);
    res.json({ success: true });
  } catch (err: any) {
    logger.error("CRM: Failed to delete lead", err);
    res.status(500).json({ error: "Failed to delete lead." });
  }
});

/**
 * GET /api/crm/lists/:id/export
 * CSV export. `:id` may be "ALL", which covers every lead in the CALLER'S
 * workspace — this is the endpoint that used to dump the entire leads table.
 */
router.get("/lists/:id/export", requirePermission("EXPORT_LEADS"), async (req: Request, res: Response) => {
  try {
    const result = await repo.findLeadsForExport(ctxOf(req), req.params.id === "ALL" ? "ALL" : req.params.id);
    if (result === null) return res.status(404).json(NOT_FOUND_LIST);
    const { leads, listName } = result;

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
    const filename = `${(listName ?? "all_leads").replace(/[^a-zA-Z0-9-_]/g, "_")}_${Date.now()}.csv`;

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
