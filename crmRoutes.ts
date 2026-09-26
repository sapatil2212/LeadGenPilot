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

import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { prisma } from "./src/prisma";
import { Lead as LeadType } from "./src/types";
import { logger } from "./src/logger";
import { resolveTenantContext, requirePermission, ctxOf } from "./src/tenancy/context";
import * as repo from "./src/tenancy/repository";
import { suppressContact } from "./src/compliance/suppressionService";
import { extractTextFromFile, BUSINESS_UPLOAD_MAX_BYTES, UnsupportedFileError } from "./src/business/fileIngest";
import { generateText, extractJson } from "./src/ai/aiService";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BUSINESS_UPLOAD_MAX_BYTES, files: 1 },
});

function uploadSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const limitMb = Math.round(BUSINESS_UPLOAD_MAX_BYTES / (1024 * 1024));
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `Files must be ${limitMb} MB or smaller.`
            : err.code === "LIMIT_FILE_COUNT"
              ? "Upload one file at a time."
              : `Upload rejected: ${err.message}`;
        return res.status(400).json({ error: message, code: "validation" });
      }
      return next(err);
    });
  };
}

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

const LEAD_SOURCES = ["GOOGLE_MAPS", "WEB_DISCOVERY", "IMPORTED", "GOOGLE_SHEETS", "AI_DISCOVERED", "API", "MANUAL"] as const;
const LEAD_STATUSES = ["NEW", "CONTACTED", "REPLIED", "QUALIFIED", "MEETING", "NOT_INTERESTED", "SUPPRESSED"] as const;
const MAX_PAGE_SIZE = 100;
const MAX_BULK_ACTION = 500;

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

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
    contactName: l.contactName ?? undefined,
    source: l.source ?? "GOOGLE_MAPS",
    status: l.status ?? "NEW",
    assignedUserId: l.assignedUserId ?? undefined,
    assignedUserName: l.assignedUser?.name ?? undefined,
    tags: parseJson<string[]>(l.tags, []),
    customFields: parseJson<Record<string, unknown>>(l.customFields, {}),
    productFit: parseJson<any[]>(l.productFit, []),
    serviceFit: parseJson<any[]>(l.serviceFit, []),
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
    contactName: trimTo((lead as any).contactName ?? "", 200) || null,
    source: LEAD_SOURCES.includes((lead as any).source) ? (lead as any).source : ((lead.mapsUrl || "").trim() ? "GOOGLE_MAPS" : "IMPORTED"),
    status: LEAD_STATUSES.includes((lead as any).status) ? (lead as any).status : "NEW",
    tags: JSON.stringify(Array.isArray((lead as any).tags) ? (lead as any).tags.slice(0, 50) : []),
    customFields: (lead as any).customFields ? JSON.stringify((lead as any).customFields) : null,
    productFit: Array.isArray((lead as any).productFit) ? JSON.stringify((lead as any).productFit) : null,
    serviceFit: Array.isArray((lead as any).serviceFit) ? JSON.stringify((lead as any).serviceFit) : null,
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
function buildLeadWhere(query: Record<string, string>, currentUserId?: string): Record<string, unknown> {
  const where: any = {};
  const and: any[] = [];
  const search = String(query.search || "").trim().slice(0, 200);
  const selectedIds = String(query.ids || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, MAX_BULK_ACTION);
  if (selectedIds.length) where.id = { in: selectedIds };

  if (search) {
    where.OR = [
      { businessName: { contains: search } },
      { contactName: { contains: search } },
      { address: { contains: search } },
      { phone: { contains: search } },
      { emails: { contains: search } },
      { category: { contains: search } },
      { website: { contains: search } },
      { source: { contains: search.replace(/\s+/g, "_").toUpperCase() } },
    ];
  }

  const fit = String(query.fit || query.priority || "ALL").toUpperCase();
  if (fit === "HIGH") where.icpFitScore = { gte: 75 };
  else if (fit === "MEDIUM") where.icpFitScore = { gte: 40, lt: 75 };
  else if (fit === "LOW") where.icpFitScore = { gte: 0, lt: 40 };
  else if (fit === "UNSCORED") where.icpFitScore = null;
  // Legacy priority remains available to old consumers, but is never presented
  // as universal AI Fit in the new workspace.
  else if (["HOT", "WARM", "COLD"].includes(fit)) where.leadPriority = fit;

  const source = String(query.source || "ALL").toUpperCase();
  if ((LEAD_SOURCES as readonly string[]).includes(source)) where.source = source;
  const status = String(query.status || "ALL").toUpperCase();
  if ((LEAD_STATUSES as readonly string[]).includes(status)) where.status = status;
  if (query.mine === "true" && currentUserId) and.push({ OR: [{ assignedUserId: currentUserId }, { AND: [{ assignedUserId: null }, { userId: currentUserId }] }] });

  const industry = String(query.industry || "").trim().slice(0, 200);
  const location = String(query.location || "").trim().slice(0, 300);
  if (industry) where.category = { contains: industry };
  if (location) where.address = { contains: location };

  const contact = String(query.contact || "ALL").toUpperCase();
  if (contact === "EMAIL") and.push({ emails: { not: "[]" } }, { emails: { not: "" } });
  else if (contact === "PHONE") where.phone = { not: "" };
  else if (contact === "WHATSAPP") and.push({ phone: { not: "" } }, { whatsappPresent: true });
  else if (contact === "WEBSITE") where.website = { not: "" };
  else if (contact === "SOCIAL") and.push({ OR: [
    { instagramUrl: { not: "" } }, { facebookUrl: { not: "" } }, { linkedinUrl: { not: "" } },
  ] });

  const outreach = String(query.outreach || "ALL").toUpperCase();
  if (outreach === "NOT_CONTACTED") and.push({ emailStatus: { not: "SENT" } }, { whatsappStatus: { not: "SENT" } }, { conversationStatus: { not: "REPLIED" } });
  else if (outreach === "EMAIL_SENT") where.emailStatus = "SENT";
  else if (outreach === "WHATSAPP_SENT") where.whatsappStatus = "SENT";
  else if (outreach === "REPLIED") where.conversationStatus = "REPLIED";
  else if (outreach === "FAILED") and.push({ OR: [{ emailStatus: "FAILED" }, { whatsappStatus: "FAILED" }] });

  // Backward-compatible legacy filters.
  const websiteStatus = String(query.websiteStatus || "ALL").toUpperCase();
  if (["MISSING", "WORKING", "BROKEN", "OUTDATED"].includes(websiteStatus)) where.websiteStatus = websiteStatus;
  const emailStatus = String(query.emailStatus || "ALL").toUpperCase();
  if (["SENT", "PENDING", "FAILED"].includes(emailStatus)) where.emailStatus = emailStatus;
  const whatsappStatus = String(query.whatsappStatus || "ALL").toUpperCase();
  if (["SENT", "PENDING", "FAILED"].includes(whatsappStatus)) where.whatsappStatus = whatsappStatus;

  const dateFrom = query.dateFrom;
  const dateTo = query.dateTo;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
    if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  if (and.length) where.AND = and;
  return where;
}

/** Build a stable Prisma orderBy for server-side sorting and pagination. */
function buildLeadOrderBy(query: Record<string, string>): Array<Record<string, unknown>> {
  const sortBy = String(query.sortBy || "aiFit");
  const direction = query.sortDir === "asc" ? "asc" : "desc";
  const allowedSorts: Record<string, string> = {
    aiFit: "icpFitScore",
    leadScore: "leadScore",
    recentlyAdded: "createdAt",
    dateAdded: "createdAt",
    recentlyContacted: "updatedAt",
    lastActivity: "updatedAt",
    businessName: "businessName",
  };
  const orderField = allowedSorts[sortBy] ?? "icpFitScore";
  return [{ [orderField]: direction }, { id: "asc" }];
}

function pageOptions(query: Record<string, string>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || 25));
  return { page, pageSize };
}

function wantsPaginatedResponse(query: Record<string, string>) {
  return query.paginated === "true" || query.page !== undefined || query.pageSize !== undefined;
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
 * GET /api/crm/summary — real tenant-scoped smart-view counts and capabilities.
 */
router.get("/summary", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 30);
    const listIds = await repo.leadListIds(ctx);
    const count = (where: Record<string, unknown> = {}) => repo.countWorkspaceLeadsForLists(listIds, where);
    const [
      all, newLeads, mine, highFit, mediumFit, lowFit, unscored, recent,
      googleMaps, webDiscovery, imported, googleSheets, aiDiscovered,
      contacted, replied, qualified, meeting, notInterested, suppressed,
      notContacted, emailAvailable, whatsappAvailable, phoneAvailable, failed,
      assignees,
    ] = await Promise.all([
      count(), count({ status: "NEW" }), count({ OR: [{ assignedUserId: ctx.userId }, { AND: [{ assignedUserId: null }, { userId: ctx.userId }] }] }),
      count({ icpFitScore: { gte: 75 } }), count({ icpFitScore: { gte: 40, lt: 75 } }),
      count({ icpFitScore: { gte: 0, lt: 40 } }), count({ icpFitScore: null }), count({ createdAt: { gte: recentCutoff } }),
      count({ source: "GOOGLE_MAPS" }), count({ source: "WEB_DISCOVERY" }), count({ source: "IMPORTED" }),
      count({ source: "GOOGLE_SHEETS" }), count({ source: "AI_DISCOVERED" }),
      count({ status: "CONTACTED" }), count({ status: "REPLIED" }), count({ status: "QUALIFIED" }),
      count({ status: "MEETING" }), count({ status: "NOT_INTERESTED" }), count({ status: "SUPPRESSED" }),
      count({ AND: [{ emailStatus: { not: "SENT" } }, { whatsappStatus: { not: "SENT" } }, { conversationStatus: { not: "REPLIED" } }] }),
      count({ AND: [{ emails: { not: "[]" } }, { emails: { not: "" } }] }),
      count({ phone: { not: "" }, whatsappPresent: true }), count({ phone: { not: "" } }),
      count({ OR: [{ emailStatus: "FAILED" }, { whatsappStatus: "FAILED" }] }),
      repo.listWorkspaceAssignees(ctx),
    ]);
    res.json({
      counts: {
        all, new: newLeads, mine, highFit, mediumFit, lowFit, unscored, recent,
        sources: { GOOGLE_MAPS: googleMaps, WEB_DISCOVERY: webDiscovery, IMPORTED: imported, GOOGLE_SHEETS: googleSheets, AI_DISCOVERED: aiDiscovered },
        statuses: { NEW: newLeads, CONTACTED: contacted, REPLIED: replied, QUALIFIED: qualified, MEETING: meeting, NOT_INTERESTED: notInterested, SUPPRESSED: suppressed },
        outreach: { NOT_CONTACTED: notContacted, EMAIL_AVAILABLE: emailAvailable, WHATSAPP_AVAILABLE: whatsappAvailable, PHONE_AVAILABLE: phoneAvailable, REPLIED: replied, FAILED: failed },
      },
      permissions: Array.from(ctx.permissions),
      assignees: assignees.map((m: any) => ({ id: m.userId, name: m.user?.name || m.user?.email || "Workspace member", email: m.user?.email, role: m.role })),
    });
  } catch (err: any) {
    logger.error("CRM: Failed to fetch lead summary", err);
    res.status(500).json({ error: "Failed to fetch lead summary." });
  }
});

/**
 * GET /api/crm/leads
 * Legacy calls receive an array. paginated=true (or page/pageSize) enables the
 * universal response contract without breaking existing consumers.
 */
router.get("/leads", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const query = req.query as Record<string, string>;
    const where = buildLeadWhere(query, ctx.userId);
    const orderBy = buildLeadOrderBy(query);
    const lists = await repo.listLeadLists(ctx);
    const listNameById = new Map(lists.map((l: any) => [l.id, l.name]));

    if (wantsPaginatedResponse(query)) {
      const { page, pageSize } = pageOptions(query);
      const result = await repo.findLeadPageInWorkspace(ctx, { page, pageSize, where, orderBy });
      return res.json({
        leads: result.rows.map((l: any) => ({ ...dbLeadToAppLead(l), listName: listNameById.get(l.listId) ?? "" })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      });
    }

    const leads = await repo.findLeadsInWorkspace(ctx, where, orderBy);
    res.json(leads.map((l: any) => ({ ...dbLeadToAppLead(l), listName: listNameById.get(l.listId) ?? "" })));
  } catch (err: any) {
    logger.error("CRM: Failed to fetch all leads", err);
    res.status(500).json({ error: "Failed to fetch leads." });
  }
});

/** GET /api/crm/lists/:id/leads — legacy array or opt-in paged response. */
router.get("/lists/:id/leads", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const query = req.query as Record<string, string>;
    const where = buildLeadWhere(query, ctx.userId);
    const orderBy = buildLeadOrderBy(query);
    if (wantsPaginatedResponse(query)) {
      const { page, pageSize } = pageOptions(query);
      const result = await repo.findLeadPageInList(ctx, req.params.id, { page, pageSize, where, orderBy });
      if (result === null) return res.status(404).json(NOT_FOUND_LIST);
      return res.json({
        leads: result.rows.map(dbLeadToAppLead), total: result.total,
        page: result.page, pageSize: result.pageSize,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      });
    }
    const leads = await repo.findLeadsInList(ctx, req.params.id, where, orderBy);
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

interface ExtractedLead {
  businessName: string;
  contactName?: string;
  emails?: string[];
  phone?: string;
  address?: string;
  category?: string;
  website?: string;
  source: "IMPORTED";
  status: "NEW";
}

function parseTabularFallback(text: string): ExtractedLead[] {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const sample = lines.slice(0, 5).join("\n");
  const tabCount = (sample.match(/\t/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;
  const delimiter = tabCount > commaCount && tabCount > semiCount ? "\t" : semiCount > commaCount ? ";" : ",";

  const rows = lines.map(line => {
    if (delimiter === ",") {
      const result: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
          result.push(cur.trim().replace(/^"|"$/g, ''));
          cur = "";
        } else {
          cur += char;
        }
      }
      result.push(cur.trim().replace(/^"|"$/g, ''));
      return result;
    }
    return line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
  });

  const header = rows[0].map(x => x.toLowerCase());
  const hasHeader = header.some(x => x.includes("name") || x.includes("company") || x.includes("business") || x.includes("email") || x.includes("phone"));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const getCol = (names: string[], fallbackIdx: number, row: string[]) => {
    const idx = header.findIndex(h => names.some(n => h.includes(n)));
    return (idx >= 0 ? row[idx] : row[fallbackIdx]) || "";
  };

  const results: ExtractedLead[] = [];
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    let bName = hasHeader ? getCol(["business", "company", "firm", "name"], 0, row) : row[0];
    if (!bName) continue;
    bName = bName.replace(/^\d+[\.\)]\s*/, "").trim();
    if (!bName) continue;

    const contact = hasHeader ? getCol(["contact", "person", "owner", "manager"], 1, row) : (row[1] || "");
    const emailRaw = hasHeader ? getCol(["email", "mail"], 2, row) : (row[2] || "");
    const phone = hasHeader ? getCol(["phone", "mobile", "tel", "whatsapp", "contact_no"], 3, row) : (row[3] || "");
    const address = hasHeader ? getCol(["location", "address", "city", "state"], 4, row) : (row[4] || "");
    const category = hasHeader ? getCol(["industry", "category", "type", "sector"], 5, row) : (row[5] || "");
    const website = hasHeader ? getCol(["website", "web", "url", "domain"], 6, row) : (row[6] || "");

    const emails: string[] = [];
    if (emailRaw) {
      const emailMatches = emailRaw.match(/[\w.-]+@[\w.-]+\.\w+/g);
      if (emailMatches) emails.push(...emailMatches);
      else if (emailRaw.includes("@")) emails.push(emailRaw.trim());
    }

    results.push({
      businessName: bName,
      contactName: contact || undefined,
      emails: emails.length > 0 ? Array.from(new Set(emails)) : undefined,
      phone: phone || undefined,
      address: address || undefined,
      category: category || undefined,
      website: website || undefined,
      source: "IMPORTED",
      status: "NEW",
    });
  }

  return results;
}

async function extractLeadsWithAi(text: string, fileName: string): Promise<{ leads: ExtractedLead[]; suggestedListName: string }> {
  const cleanBase = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ").trim();
  let suggestedListName = cleanBase
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  if (!suggestedListName || suggestedListName.length < 2) {
    suggestedListName = "Imported Leads";
  }

  const tabularLeads = parseTabularFallback(text);

  try {
    const prompt = `You are an expert AI lead extractor. Analyze the following document text and extract all business leads, companies, or potential client prospects.
For each lead, extract:
- businessName: company or business name (string, required)
- contactName: contact person name if mentioned (string or null)
- emails: array of valid email addresses found (e.g. ["info@example.com"])
- phone: phone/mobile number if found (string or null)
- address: address, city, region or country (string or null)
- category: industry or business category (string or null)
- website: website URL or domain (string or null)

Also suggest a concise, professional lead list name (suggestedListName) describing these leads based on their industry or city (e.g. "Pune Dentists Q3", "Retail Suppliers", etc.).

Return pure JSON in this structure:
{
  "suggestedListName": "${suggestedListName}",
  "leads": [
    {
      "businessName": "...",
      "contactName": "...",
      "emails": ["..."],
      "phone": "...",
      "address": "...",
      "category": "...",
      "website": "..."
    }
  ]
}

Document Content:
${text.slice(0, 35000)}
`;

    const aiRes = await generateText(
      {
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4000,
        temperature: 0.2,
      },
      { operation: "lead_document_extraction" }
    );

    const jsonStr = extractJson(aiRes.text);
    const parsed = JSON.parse(jsonStr);

    if (parsed && Array.isArray(parsed.leads) && parsed.leads.length > 0) {
      const validLeads: ExtractedLead[] = [];
      const seen = new Set<string>();

      for (const item of parsed.leads) {
        if (!item || !item.businessName) continue;
        const name = String(item.businessName).trim();
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const emails: string[] = [];
        if (Array.isArray(item.emails)) {
          for (const e of item.emails) if (typeof e === "string" && e.includes("@")) emails.push(e.trim());
        } else if (typeof item.emails === "string" && item.emails.includes("@")) {
          emails.push(item.emails.trim());
        }

        validLeads.push({
          businessName: name,
          contactName: item.contactName ? String(item.contactName).trim() : undefined,
          emails: emails.length > 0 ? Array.from(new Set(emails)) : undefined,
          phone: item.phone ? String(item.phone).trim() : undefined,
          address: item.address ? String(item.address).trim() : undefined,
          category: item.category ? String(item.category).trim() : undefined,
          website: item.website ? String(item.website).trim() : undefined,
          source: "IMPORTED",
          status: "NEW",
        });
      }

      if (validLeads.length > 0) {
        return {
          leads: validLeads,
          suggestedListName: parsed.suggestedListName ? String(parsed.suggestedListName).trim() : suggestedListName,
        };
      }
    }
  } catch (err: any) {
    logger.warn(`AI lead extraction fell back to tabular/pattern parsing: ${err?.message || err}`);
  }

  return {
    leads: tabularLeads,
    suggestedListName,
  };
}

/**
 * POST /api/crm/leads/import-file
 * Analyzes an uploaded document (Excel, CSV, Word, PDF, TXT) with AI,
 * returns extracted structured leads and a suggested list name for review.
 */
router.post(
  "/leads/import-file",
  requirePermission("EDIT_LEADS"),
  uploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      let buffer: Buffer | null = null;
      let originalName = "uploaded_file.txt";
      let mimeType = "text/plain";
      let size = 0;

      const file = (req as any).file;
      if (file) {
        buffer = file.buffer;
        originalName = file.originalname || "document";
        mimeType = file.mimetype || "application/octet-stream";
        size = file.size || buffer.length;
      } else if (req.body?.fileData) {
        buffer = Buffer.from(req.body.fileData, "base64");
        originalName = req.body.fileName || "document";
        mimeType = req.body.mimeType || "application/octet-stream";
        size = buffer.length;
      } else if (req.body?.text) {
        buffer = Buffer.from(String(req.body.text), "utf8");
        originalName = req.body.fileName || "pasted_leads.txt";
        mimeType = "text/plain";
        size = buffer.length;
      }

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file or text content was provided.", code: "validation" });
      }

      const ingested = await extractTextFromFile({
        originalName,
        mimeType,
        buffer,
        size,
      });

      if (!ingested.text || ingested.text.trim().length === 0) {
        return res.status(400).json({
          error: ingested.warning || "Could not extract any readable text from this file.",
          code: "empty_document",
        });
      }

      const { leads, suggestedListName } = await extractLeadsWithAi(ingested.text, originalName);

      if (leads.length === 0) {
        return res.status(400).json({
          error: "No leads or business records could be extracted from this document. Please verify the file contains company names.",
          code: "no_leads_found",
        });
      }

      res.json({
        success: true,
        fileName: originalName,
        kind: ingested.kind,
        charCount: ingested.charCount,
        count: leads.length,
        suggestedListName,
        leads,
      });
    } catch (err: any) {
      logger.error("CRM: Lead import-file failed", err);
      if (err instanceof UnsupportedFileError) {
        return res.status(400).json({ error: err.message, code: "validation" });
      }
      res.status(500).json({ error: err.message || "Failed to process lead document." });
    }
  }
);

/** GET /api/crm/leads/:id — universal detail, outreach history and CRM context. */
router.get("/leads/:id", requirePermission("VIEW_LEADS"), async (req: Request, res: Response) => {
  try {
    const row: any = await repo.findLeadDetail(ctxOf(req), req.params.id);
    if (!row) return res.status(404).json(NOT_FOUND_LEAD);
    const lead = dbLeadToAppLead(row);
    res.json({
      lead: { ...lead, listName: row.list?.name || "" },
      list: row.list,
      outreach: {
        messages: (row.campaignMessages || []).map((m: any) => ({
          id: m.id, campaignId: m.campaignId, channel: m.channel, recipient: m.recipient,
          subject: m.subject, body: m.body, status: m.status, sentAt: m.sentAt, createdAt: m.createdAt,
        })),
        dispatches: (row.campaignDispatches || []).map((d: any) => ({
          id: d.id, channel: d.channel, status: d.status, recipient: d.recipient,
          occurredAt: d.occurredAt, errorMessage: d.errorMessage,
        })),
        conversations: (row.conversationThreads || []).map((t: any) => ({
          id: t.id, channel: t.channel, status: t.status, unreadCount: t.unreadCount,
          lastMessageAt: t.lastMessageAt, messages: (t.messages || []).map((m: any) => ({
            id: m.id, direction: m.direction, channel: m.channel, text: m.text, occurredAt: m.occurredAt,
          })),
        })),
      },
      ai: {
        fitScore: row.icpFitScore,
        fitReason: row.icpFitReason,
        scoreBreakdown: parseJson<any[]>(row.scoreBreakdown, []),
        productFit: parseJson<any[]>(row.productFit, []),
        serviceFit: parseJson<any[]>(row.serviceFit, []),
        recommendation: row.aiInsight || null,
      },
    });
  } catch (err: any) {
    logger.error("CRM: Failed to fetch lead detail", err);
    res.status(500).json({ error: "Failed to fetch lead detail." });
  }
});

/** POST /api/crm/bulk/leads — tenant-safe composable bulk CRM actions. */
router.post("/bulk/leads", requirePermission("EDIT_LEADS"), async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const ids: string[] = Array.from(new Set<string>((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id: unknown) => String(id)).filter(Boolean)));
    if (!ids.length) return res.status(400).json({ error: "Select at least one lead." });
    if (ids.length > MAX_BULK_ACTION) return res.status(413).json({ error: `Bulk actions are limited to ${MAX_BULK_ACTION} leads.` });
    const action = String(req.body?.action || "").toUpperCase();

    if (action === "DELETE") {
      if (!ctx.permissions.has("DELETE_LEADS")) return res.status(403).json({ error: "Your role in this workspace does not allow this action.", code: "permission_denied" });
      const affected = await repo.bulkDeleteLeads(ctx, ids);
      return res.json({ success: true, affected });
    }
    if (action === "CHANGE_STATUS") {
      const status = String(req.body?.status || "").toUpperCase();
      if (!(LEAD_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: "Invalid lead status." });
      const affected = await repo.bulkUpdateLeads(ctx, ids, { status });
      return res.json({ success: true, affected });
    }
    if (action === "ASSIGN") {
      const assignedUserId = req.body?.assignedUserId ? String(req.body.assignedUserId) : null;
      if (assignedUserId && !(await repo.isActiveWorkspaceMember(ctx, assignedUserId))) return res.status(400).json({ error: "Assignee is not an active workspace member." });
      const affected = await repo.bulkUpdateLeads(ctx, ids, { assignedUserId });
      return res.json({ success: true, affected });
    }
    if (action === "ADD_TO_LIST") {
      const listId = String(req.body?.listId || "");
      if (!listId || !(await repo.findLeadList(ctx, listId))) return res.status(400).json({ error: "Destination list is not available in this workspace." });
      const affected = await repo.bulkUpdateLeads(ctx, ids, { listId });
      return res.json({ success: true, affected });
    }
    if (action === "ADD_TAG") {
      const tag = trimTo(req.body?.tag, 80).trim();
      if (!tag) return res.status(400).json({ error: "Tag is required." });
      const rows: any[] = await repo.findWorkspaceLeadsByIds(ctx, ids);
      await Promise.all(rows.map((row) => repo.updateLead(ctx, row.id, { tags: JSON.stringify(Array.from(new Set([...parseJson<string[]>(row.tags, []), tag])).slice(0, 50)) })));
      return res.json({ success: true, affected: rows.length });
    }
    if (action === "SUPPRESS") {
      const rows: any[] = await repo.findWorkspaceLeadsByIds(ctx, ids);
      let contactsSuppressed = 0;
      for (const row of rows) {
        for (const email of parseJson<string[]>(row.emails, [])) {
          if (!email) continue;
          await suppressContact({ tenantId: ctx.tenantId, channel: "email", contact: email, reason: "manual", source: "leads_bulk" });
          contactsSuppressed++;
        }
        if (row.phone) {
          await suppressContact({ tenantId: ctx.tenantId, channel: "whatsapp", contact: row.phone, reason: "manual", source: "leads_bulk" });
          contactsSuppressed++;
        }
      }
      const affected = await repo.bulkUpdateLeads(ctx, ids, { status: "SUPPRESSED" });
      return res.json({ success: true, affected, contactsSuppressed });
    }
    return res.status(400).json({ error: "Unsupported bulk action." });
  } catch (err: any) {
    logger.error("CRM: Bulk action failed", err);
    res.status(500).json({ error: "Bulk action failed." });
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
      businessName, contactName, phone, address, category, website, rating, reviews,
      source, status, assignedUserId, tags, customFields, productFit, serviceFit,
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
    if (contactName !== undefined) updateData.contactName = trimTo(contactName, 200) || null;
    if (phone !== undefined) updateData.phone = trimTo(phone, LIMITS.phone);
    if (address !== undefined) updateData.address = trimTo(address, LIMITS.address);
    if (category !== undefined) updateData.category = trimTo(category, LIMITS.category);
    if (website !== undefined) updateData.website = trimTo(website, LIMITS.website);
    if (rating !== undefined) updateData.rating = Number(rating) || 0;
    if (reviews !== undefined) updateData.reviews = Number(reviews) || 0;
    if (source !== undefined) {
      const value = String(source).toUpperCase();
      if (!(LEAD_SOURCES as readonly string[]).includes(value)) return res.status(400).json({ error: "Invalid lead source." });
      updateData.source = value;
    }
    if (status !== undefined) {
      const value = String(status).toUpperCase();
      if (!(LEAD_STATUSES as readonly string[]).includes(value)) return res.status(400).json({ error: "Invalid lead status." });
      updateData.status = value;
    }
    if (assignedUserId !== undefined) {
      const value = assignedUserId ? String(assignedUserId) : null;
      if (value && !(await repo.isActiveWorkspaceMember(ctxOf(req), value))) return res.status(400).json({ error: "Assignee is not an active workspace member." });
      updateData.assignedUserId = value;
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: "tags must be an array." });
      updateData.tags = JSON.stringify(tags.map((tag: unknown) => trimTo(tag, 80).trim()).filter(Boolean).slice(0, 50));
    }
    if (customFields !== undefined) updateData.customFields = JSON.stringify(customFields || {});
    if (productFit !== undefined) updateData.productFit = Array.isArray(productFit) ? JSON.stringify(productFit) : null;
    if (serviceFit !== undefined) updateData.serviceFit = Array.isArray(serviceFit) ? JSON.stringify(serviceFit) : null;

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
    const ctx = ctxOf(req);
    const result = await repo.findLeadsForExport(
      ctx,
      req.params.id === "ALL" ? "ALL" : req.params.id,
      buildLeadWhere(req.query as Record<string, string>, ctx.userId)
    );
    if (result === null) return res.status(404).json(NOT_FOUND_LIST);
    const { leads, listName } = result;

    const headers = [
      "Business Name", "Contact Name", "Industry / Category", "Location", "Email", "Phone",
      "WhatsApp Available", "Website", "AI Fit Score", "ICP Fit Reason", "Source", "Status",
      "Email Outreach", "WhatsApp Outreach", "Conversation", "Assigned User ID", "Tags",
      "List", "Date Added", "Notes",
    ];

    const escape = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = leads.map((l: any) => {
      const emails = parseJson<string[]>(l.emails, []).join("; ");
      return [
        l.businessName, l.contactName || "", l.category, l.address, emails, l.phone,
        l.whatsappPresent ? "Yes" : "No", l.website, l.icpFitScore ?? "", l.icpFitReason || "",
        l.source || "", l.status || "NEW", l.emailStatus || "NOT_CONTACTED",
        l.whatsappStatus || "NOT_CONTACTED", l.conversationStatus || "", l.assignedUserId || "",
        parseJson<string[]>(l.tags, []).join("; "), l.listId, l.dateAdded, l.notes || "",
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
