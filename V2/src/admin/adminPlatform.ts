/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform operations: workspaces, feature flags, announcements, settings,
 * the audit trail, visitor analytics, cross-tenant data browsing and health.
 *
 * Mounted at /api/admin/platform behind requireAdmin.
 *
 * The unifying idea is that an operator should never need a SQL client. Every
 * read here is scoped, paged and sorted on a whitelist; every write is audited;
 * and the destructive ones (deleting a workspace, purging the audit log) state
 * what they are about to remove before they do it.
 */

import os from "os";
import { Router, type Request } from "express";
import { prisma } from "../prisma";
import { env } from "../env";
import { logger } from "../logger";
import {
  adminAudit,
  adminRoute,
  badRequest,
  conflict,
  fillDailySeries,
  notFound,
  nullableStr,
  num,
  optBool,
  optDate,
  optEnum,
  optInt,
  optStr,
  pageMeta,
  parseDateRange,
  parseDays,
  parseIds,
  parsePaging,
  parseSort,
  reqStr,
  sendCsv,
  sortOn,
  sortOnCount,
  sortOnRelation,
  toInt,
  type SortMap,
} from "./shared";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACES (TENANTS)
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_STATUSES = ["active", "suspended"] as const;

const TENANT_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  updatedAt: sortOn("updatedAt"),
  name: sortOn("name"),
  slug: sortOn("slug"),
  status: sortOn("status"),
  members: sortOnCount("members"),
  leads: sortOnCount("leads"),
  campaigns: sortOnCount("campaigns"),
};

const TENANT_COUNTS = {
  _count: {
    select: {
      members: true,
      leadLists: true,
      leads: true,
      campaigns: true,
      integrations: true,
      jobs: true,
      subscriptions: true,
    },
  },
};

/**
 * Slugifies a workspace name.
 *
 * A collision suffix is appended rather than rejected, because the operator
 * naming a second "Acme" workspace does not care what its handle is, only that
 * the create succeeds.
 */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function tenantWhere(req: Request): Record<string, unknown> {
  const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
  const search = optStr(req.query.search);
  const status = optEnum(req.query.status, "Status", TENANT_STATUSES);
  if (search) {
    where.OR = [{ name: { contains: search } }, { slug: { contains: search } }, { id: search }];
  }
  if (status) where.status = status;
  return where;
}

router.get(
  "/tenants",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const where = tenantWhere(req);
    const orderBy = parseSort(req, TENANT_SORTS, "createdAt") as any;

    const [total, rows, statusFacet] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.take,
        include: {
          ...TENANT_COUNTS,
          members: {
            where: { role: "owner" },
            take: 1,
            include: { user: { select: { id: true, email: true, name: true } } },
          },
        },
      }),
      prisma.tenant.groupBy({ by: ["status"], _count: { id: true } }),
    ]);

    res.json({
      rows: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        owner: t.members[0]?.user ?? null,
        counts: t._count,
      })),
      ...pageMeta(total, paging),
      facets: { status: Object.fromEntries(statusFacet.map((s) => [s.status, s._count.id])) },
      options: { statuses: [...TENANT_STATUSES] },
    });
  })
);

router.get(
  "/tenants/export",
  adminRoute(async (req, res) => {
    const where = tenantWhere(req);
    const rows = await prisma.tenant.findMany({
      where,
      orderBy: parseSort(req, TENANT_SORTS, "createdAt") as any,
      take: 10_000,
      include: {
        ...TENANT_COUNTS,
        members: { where: { role: "owner" }, take: 1, include: { user: { select: { email: true } } } },
      },
    });
    await adminAudit(req, "admin_exported_tenants", { count: rows.length });
    sendCsv(res, `workspaces-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { header: "ID", value: (r) => r.id },
      { header: "Name", value: (r) => r.name },
      { header: "Slug", value: (r) => r.slug },
      { header: "Status", value: (r) => r.status },
      { header: "Owner", value: (r) => r.members[0]?.user?.email ?? "" },
      { header: "Members", value: (r) => r._count.members },
      { header: "Lead Lists", value: (r) => r._count.leadLists },
      { header: "Leads", value: (r) => r._count.leads },
      { header: "Campaigns", value: (r) => r._count.campaigns },
      { header: "Integrations", value: (r) => r._count.integrations },
      { header: "Jobs", value: (r) => r._count.jobs },
      { header: "Subscriptions", value: (r) => r._count.subscriptions },
      { header: "Created", value: (r) => r.createdAt },
    ]);
  })
);

router.get(
  "/tenants/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Workspace id", 64);
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        ...TENANT_COUNTS,
        members: { include: { user: { select: { id: true, email: true, name: true, role: true, status: true } } } },
        businessProfile: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!tenant) throw notFound("No workspace with that id.");

    const [recentJobs, recentLeadLists, recentAudit] = await Promise.all([
      prisma.job.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.leadList.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 10, include: { _count: { select: { leads: true } } } }),
      prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    res.json({ tenant, recentJobs, recentLeadLists, recentAudit });
  })
);

router.post(
  "/tenants",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const name = reqStr(body.name, "Workspace name", 120);
    const slug = optStr(body.slug)
      ? reqStr(body.slug, "Slug", 60).toLowerCase().replace(/[^a-z0-9-]/g, "-")
      : await uniqueSlug(name);

    const clash = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (clash) throw conflict(`The handle "${slug}" is already taken.`);

    const ownerId = optStr(body.ownerUserId);
    if (ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
      if (!owner) throw badRequest("No user with that id to make owner.");
    }

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        status: optEnum(body.status, "Status", TENANT_STATUSES) ?? "active",
        // Created together so the workspace is never ownerless — a workspace with
        // no owner cannot be administered by anyone but this console.
        ...(ownerId ? { members: { create: { userId: ownerId, role: "owner", status: "active" } } } : {}),
      },
      include: TENANT_COUNTS,
    });

    await adminAudit(req, "admin_created_tenant", { tenantId: tenant.id, name, slug, ownerId });
    res.status(201).json({ success: true, tenant });
  })
);

router.patch(
  "/tenants/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Workspace id", 64);
    const body = req.body || {};
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw notFound("No workspace with that id.");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = reqStr(body.name, "Workspace name", 120);
    if (body.status !== undefined) data.status = optEnum(body.status, "Status", TENANT_STATUSES);
    if (body.slug !== undefined) {
      const slug = reqStr(body.slug, "Slug", 60).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (slug !== existing.slug) {
        const clash = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
        if (clash) throw conflict(`The handle "${slug}" is already taken.`);
        data.slug = slug;
      }
    }
    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    const tenant = await prisma.tenant.update({ where: { id }, data, include: TENANT_COUNTS });
    await adminAudit(req, "admin_updated_tenant", { tenantId: id, changed: Object.keys(data) });
    res.json({ success: true, tenant });
  })
);

/**
 * Deletes a workspace and everything it owns.
 *
 * The cascade is wide — leads, campaigns, conversations, knowledge, integrations
 * — so the counts are returned to the client BEFORE deleting and the caller must
 * echo the slug back in `confirm`. A two-click delete on a row that owns 40,000
 * leads is not a confirmation.
 */
router.delete(
  "/tenants/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Workspace id", 64);
    const tenant = await prisma.tenant.findUnique({ where: { id }, include: TENANT_COUNTS });
    if (!tenant) throw notFound("No workspace with that id.");

    const confirm = optStr(req.query.confirm) ?? optStr((req.body || {}).confirm);
    if (confirm !== tenant.slug) {
      throw badRequest(
        `Deleting "${tenant.name}" also deletes ${tenant._count.leads} lead(s), ` +
          `${tenant._count.leadLists} list(s), ${tenant._count.campaigns} campaign(s) and all workspace knowledge. ` +
          `Re-send with confirm="${tenant.slug}" to proceed.`,
        { requiresConfirmation: true, confirmWith: tenant.slug, counts: tenant._count }
      );
    }

    await prisma.tenant.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_tenant", { tenantId: id, slug: tenant.slug, cascaded: tenant._count });
    res.json({ success: true, id, deleted: tenant._count });
  })
);

const TENANT_BULK = ["suspend", "activate"] as const;

router.post(
  "/tenants/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", TENANT_BULK);
    if (!action) throw badRequest(`Action must be one of: ${TENANT_BULK.join(", ")}.`);

    // Bulk delete is deliberately absent: the per-row delete requires typing the
    // slug, and a bulk version could not offer the same check.
    const result = await prisma.tenant.updateMany({
      where: { id: { in: ids } },
      data: { status: action === "suspend" ? "suspended" : "active" },
    });

    await adminAudit(req, `admin_bulk_tenants_${action}`, { ids, affected: result.count });
    res.json({ success: true, action, affected: result.count, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_AUDIENCES = ["all", "plan:free", "plan:pro", "plan:custom", "role:admin"] as const;

router.get(
  "/flags",
  adminRoute(async (req, res) => {
    const search = optStr(req.query.search);
    const rows = await prisma.featureFlag.findMany({
      where: search ? { OR: [{ key: { contains: search } }, { name: { contains: search } }] } : {},
      orderBy: [{ enabled: "desc" }, { key: "asc" }],
    });
    res.json({
      rows,
      options: { audiences: [...FLAG_AUDIENCES] },
      summary: { total: rows.length, enabled: rows.filter((r) => r.enabled).length },
    });
  })
);

router.post(
  "/flags",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const key = reqStr(body.key, "Flag key", 60).toLowerCase();
    if (!/^[a-z][a-z0-9_.-]*$/.test(key)) {
      throw badRequest("A flag key must start with a letter and contain only lowercase letters, numbers, . _ or -.");
    }
    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (existing) throw conflict(`A flag with the key "${key}" already exists.`);

    const flag = await prisma.featureFlag.create({
      data: {
        key,
        name: reqStr(body.name, "Flag name", 120),
        description: nullableStr(body.description, "Description", 1000) ?? null,
        enabled: optBool(body.enabled) ?? false,
        rolloutPercent: optInt(body.rolloutPercent, "Rollout percent", 0, 100) ?? 100,
        audience: optEnum(body.audience, "Audience", FLAG_AUDIENCES) ?? "all",
        updatedBy: (req as any).adminUser?.email ?? null,
      },
    });
    await adminAudit(req, "admin_created_feature_flag", { flagId: flag.id, key, enabled: flag.enabled });
    res.status(201).json({ success: true, flag });
  })
);

router.patch(
  "/flags/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Flag id", 64);
    const body = req.body || {};
    const existing = await prisma.featureFlag.findUnique({ where: { id } });
    if (!existing) throw notFound("No feature flag with that id.");

    const data: Record<string, unknown> = { updatedBy: (req as any).adminUser?.email ?? null };
    if (body.name !== undefined) data.name = reqStr(body.name, "Flag name", 120);
    if (body.description !== undefined) data.description = nullableStr(body.description, "Description", 1000);
    if (body.enabled !== undefined) data.enabled = optBool(body.enabled);
    if (body.rolloutPercent !== undefined) data.rolloutPercent = optInt(body.rolloutPercent, "Rollout percent", 0, 100);
    if (body.audience !== undefined) data.audience = optEnum(body.audience, "Audience", FLAG_AUDIENCES);

    const flag = await prisma.featureFlag.update({ where: { id }, data });
    await adminAudit(req, "admin_updated_feature_flag", { flagId: id, key: flag.key, changed: Object.keys(data) });
    res.json({ success: true, flag });
  })
);

router.delete(
  "/flags/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Flag id", 64);
    const existing = await prisma.featureFlag.findUnique({ where: { id } });
    if (!existing) throw notFound("No feature flag with that id.");
    await prisma.featureFlag.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_feature_flag", { flagId: id, key: existing.key });
    res.json({ success: true, id });
  })
);

router.post(
  "/flags/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", ["enable", "disable", "delete"] as const);
    if (!action) throw badRequest("Action must be one of: enable, disable, delete.");

    const affected =
      action === "delete"
        ? (await prisma.featureFlag.deleteMany({ where: { id: { in: ids } } })).count
        : (
            await prisma.featureFlag.updateMany({
              where: { id: { in: ids } },
              data: { enabled: action === "enable", updatedBy: (req as any).adminUser?.email ?? null },
            })
          ).count;

    await adminAudit(req, `admin_bulk_flags_${action}`, { ids, affected });
    res.json({ success: true, action, affected, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────────────────────

const ANNOUNCEMENT_LEVELS = ["info", "success", "warning", "critical"] as const;

const ANNOUNCEMENT_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  publishedAt: sortOn("publishedAt"),
  expiresAt: sortOn("expiresAt"),
  title: sortOn("title"),
  level: sortOn("level"),
};

router.get(
  "/announcements",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const search = optStr(req.query.search);
    const level = optEnum(req.query.level, "Level", ANNOUNCEMENT_LEVELS);
    const active = optBool(req.query.active);

    const where: Record<string, unknown> = {};
    if (search) where.OR = [{ title: { contains: search } }, { body: { contains: search } }];
    if (level) where.level = level;
    if (active !== undefined) where.isActive = active;

    const [total, rows] = await Promise.all([
      prisma.announcement.count({ where }),
      prisma.announcement.findMany({
        where,
        orderBy: parseSort(req, ANNOUNCEMENT_SORTS, "createdAt") as any,
        skip: paging.skip,
        take: paging.take,
      }),
    ]);

    const now = new Date();
    res.json({
      rows: rows.map((a) => ({
        ...a,
        // "Live" is not the same as `isActive`: a scheduled or expired
        // announcement is active but not currently showing.
        isLive:
          a.isActive &&
          (!a.publishedAt || a.publishedAt <= now) &&
          (!a.expiresAt || a.expiresAt > now),
      })),
      ...pageMeta(total, paging),
      options: { levels: [...ANNOUNCEMENT_LEVELS], audiences: [...FLAG_AUDIENCES] },
    });
  })
);

router.post(
  "/announcements",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const publishedAt = (optDate(body.publishedAt, "Publish at") as Date | null) ?? new Date();
    const expiresAt = optDate(body.expiresAt, "Expires at") as Date | null;
    if (expiresAt && expiresAt <= publishedAt) throw badRequest("The expiry must be after the publish time.");

    const announcement = await prisma.announcement.create({
      data: {
        title: reqStr(body.title, "Title", 190),
        body: reqStr(body.body, "Message", 5000),
        level: optEnum(body.level, "Level", ANNOUNCEMENT_LEVELS) ?? "info",
        audience: optEnum(body.audience, "Audience", FLAG_AUDIENCES) ?? "all",
        isActive: optBool(body.isActive) ?? true,
        publishedAt,
        expiresAt,
        createdBy: (req as any).adminUser?.email ?? null,
      },
    });
    await adminAudit(req, "admin_created_announcement", { announcementId: announcement.id, title: announcement.title });
    res.status(201).json({ success: true, announcement });
  })
);

router.patch(
  "/announcements/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Announcement id", 64);
    const body = req.body || {};
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw notFound("No announcement with that id.");

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = reqStr(body.title, "Title", 190);
    if (body.body !== undefined) data.body = reqStr(body.body, "Message", 5000);
    if (body.level !== undefined) data.level = optEnum(body.level, "Level", ANNOUNCEMENT_LEVELS);
    if (body.audience !== undefined) data.audience = optEnum(body.audience, "Audience", FLAG_AUDIENCES);
    if (body.isActive !== undefined) data.isActive = optBool(body.isActive);
    if (body.publishedAt !== undefined) data.publishedAt = optDate(body.publishedAt, "Publish at");
    if (body.expiresAt !== undefined) data.expiresAt = optDate(body.expiresAt, "Expires at");
    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    const announcement = await prisma.announcement.update({ where: { id }, data });
    await adminAudit(req, "admin_updated_announcement", { announcementId: id, changed: Object.keys(data) });
    res.json({ success: true, announcement });
  })
);

router.delete(
  "/announcements/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Announcement id", 64);
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw notFound("No announcement with that id.");
    await prisma.announcement.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_announcement", { announcementId: id, title: existing.title });
    res.json({ success: true, id });
  })
);

router.post(
  "/announcements/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", ["publish", "unpublish", "delete"] as const);
    if (!action) throw badRequest("Action must be one of: publish, unpublish, delete.");

    const affected =
      action === "delete"
        ? (await prisma.announcement.deleteMany({ where: { id: { in: ids } } })).count
        : (
            await prisma.announcement.updateMany({
              where: { id: { in: ids } },
              data:
                action === "publish"
                  ? { isActive: true, publishedAt: new Date() }
                  : { isActive: false },
            })
          ).count;

    await adminAudit(req, `admin_bulk_announcements_${action}`, { ids, affected });
    res.json({ success: true, action, affected, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The settings the console knows how to render, with their defaults.
 *
 * Declared here rather than only in the database so the page has labels, types
 * and help text for a key that has never been saved, and so a fresh install
 * shows the real defaults instead of an empty list.
 *
 * Secrets are absent by design: those stay in the environment, where they are not
 * readable through an HTTP API.
 */
const SETTING_DEFINITIONS = [
  { key: "platform.name", category: "general", label: "Platform name", type: "string", default: "LeadGenPilot", description: "Shown in emails and the product header." },
  { key: "platform.supportEmail", category: "general", label: "Support email", type: "string", default: "", description: "Where in-product help links send customers." },
  { key: "platform.signupsEnabled", category: "general", label: "Allow new sign-ups", type: "boolean", default: true, description: "Turn off to close registration without taking the site down." },
  { key: "platform.maintenanceMode", category: "general", label: "Maintenance banner", type: "boolean", default: false, description: "Shows a platform-wide maintenance notice." },
  { key: "limits.freeMonthlyLeads", category: "limits", label: "Free tier monthly leads", type: "number", default: 100, description: "Fallback quota when a plan row does not specify one." },
  { key: "limits.maxLeadsPerScrape", category: "limits", label: "Max leads per discovery run", type: "number", default: 500, description: "Upper bound on a single lead-discovery job." },
  { key: "limits.maxCampaignRecipients", category: "limits", label: "Max recipients per campaign", type: "number", default: 1000, description: "Guards against an accidental send to an entire database." },
  { key: "billing.currency", category: "billing", label: "Default currency", type: "string", default: "INR", description: "Currency new plans and invoices are created in." },
  { key: "billing.taxPercent", category: "billing", label: "Default tax rate (%)", type: "number", default: 18, description: "Pre-filled on new invoices. Stored as a percentage." },
  { key: "billing.invoiceDueDays", category: "billing", label: "Invoice due window (days)", type: "number", default: 7, description: "Days from issue to due date on new invoices." },
  { key: "billing.trialDays", category: "billing", label: "Default trial length (days)", type: "number", default: 14, description: "Used when a plan does not set its own trial." },
  { key: "security.sessionDays", category: "security", label: "Session lifetime (days)", type: "number", default: 7, description: "Informational: the signing TTL comes from the environment." },
  { key: "security.maxFailedLogins", category: "security", label: "Failed logins before lockout", type: "number", default: 5, description: "Informational mirror of the auth service setting." },
  { key: "security.auditRetentionDays", category: "security", label: "Audit retention (days)", type: "number", default: 365, description: "Used as the default window by the audit purge tool." },
  { key: "notifications.quotaWarnPercent", category: "notifications", label: "Quota warning threshold (%)", type: "number", default: 80, description: "Usage level at which customers are warned." },
  { key: "notifications.digestEnabled", category: "notifications", label: "Weekly operator digest", type: "boolean", default: false, description: "Emails a platform summary to ADMIN_EMAILS." },
] as const;

router.get(
  "/settings",
  adminRoute(async (_req, res) => {
    const saved = await prisma.platformSetting.findMany();
    const savedByKey = new Map(saved.map((s) => [s.key, s]));

    const rows = SETTING_DEFINITIONS.map((def) => {
      const row = savedByKey.get(def.key);
      let value: unknown = def.default;
      if (row) {
        try {
          value = JSON.parse(row.value);
        } catch {
          value = row.value;
        }
      }
      return {
        key: def.key,
        category: def.category,
        label: def.label,
        type: def.type,
        description: def.description,
        value,
        defaultValue: def.default,
        isDefault: !row,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    // Anything saved that no longer has a definition is still shown, so a
    // renamed setting is visible and removable rather than invisible forever.
    const orphans = saved
      .filter((s) => !SETTING_DEFINITIONS.some((d) => d.key === s.key))
      .map((s) => ({
        key: s.key,
        category: s.category,
        label: s.label ?? s.key,
        type: "string",
        description: "Saved value with no matching definition in this build.",
        value: s.value,
        defaultValue: null,
        isDefault: false,
        orphan: true,
        updatedBy: s.updatedBy,
        updatedAt: s.updatedAt,
      }));

    res.json({
      rows: [...rows, ...orphans],
      categories: [...new Set(SETTING_DEFINITIONS.map((d) => d.category))],
    });
  })
);

router.put(
  "/settings",
  adminRoute(async (req, res) => {
    const updates = (req.body || {}).settings;
    if (!Array.isArray(updates) || !updates.length) throw badRequest("Send a non-empty `settings` array.");
    if (updates.length > 100) throw badRequest("Too many settings in one request.");

    const actorEmail = (req as any).adminUser?.email ?? null;
    const applied: string[] = [];

    for (const update of updates) {
      const key = reqStr((update as any)?.key, "Setting key", 120);
      const def = SETTING_DEFINITIONS.find((d) => d.key === key);
      if (!def) throw badRequest(`Unknown setting "${key}".`);

      const raw = (update as any).value;
      let value: unknown;
      if (def.type === "boolean") {
        value = optBool(raw) ?? false;
      } else if (def.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw badRequest(`${def.label} must be a number.`);
        value = n;
      } else {
        value = nullableStr(raw, def.label, 1000) ?? "";
      }

      await prisma.platformSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value), category: def.category, label: def.label, description: def.description, updatedBy: actorEmail },
        update: { value: JSON.stringify(value), category: def.category, label: def.label, updatedBy: actorEmail },
      });
      applied.push(key);
    }

    await adminAudit(req, "admin_updated_platform_settings", { keys: applied });
    res.json({ success: true, updated: applied.length, keys: applied });
  })
);

/** Reverting to the default is deleting the row, not writing the default into it. */
router.delete(
  "/settings/:key",
  adminRoute(async (req, res) => {
    const key = reqStr(req.params.key, "Setting key", 120);
    const existing = await prisma.platformSetting.findUnique({ where: { key } });
    if (!existing) throw notFound("That setting has no saved override.");
    await prisma.platformSetting.delete({ where: { key } });
    await adminAudit(req, "admin_reset_platform_setting", { key });
    res.json({ success: true, key });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  action: sortOn("action"),
  ip: sortOn("ip"),
  userEmail: sortOnRelation("user", "email"),
};

function auditWhere(req: Request): Record<string, unknown> {
  const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
  const search = optStr(req.query.search);
  const action = optStr(req.query.action);
  const userId = optStr(req.query.userId);
  const ip = optStr(req.query.ip);
  const category = optStr(req.query.category);

  if (search) {
    where.OR = [
      { action: { contains: search } },
      { ip: { contains: search } },
      { metadata: { contains: search } },
      { user: { email: { contains: search } } },
    ];
  }
  if (action) where.action = { contains: action };
  if (userId) where.userId = userId;
  if (ip) where.ip = ip;

  // Coarse grouping so the operator can ask "show me failures" without knowing
  // the exact action strings.
  if (category === "auth") where.action = { contains: "login" };
  if (category === "admin") where.action = { startsWith: "admin_" };
  if (category === "failure") where.OR = [{ action: { contains: "failed" } }, { action: { contains: "error" } }];

  return where;
}

router.get(
  "/audit",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 50);
    const where = auditWhere(req);

    const [total, rows, topActions] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: parseSort(req, AUDIT_SORTS, "createdAt") as any,
        skip: paging.skip,
        take: paging.take,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        _count: { id: true },
        orderBy: { _count: { action: "desc" } },
        take: 25,
      }),
    ]);

    res.json({
      rows,
      ...pageMeta(total, paging),
      facets: { action: topActions.map((a) => ({ label: a.action, value: a._count.id })) },
    });
  })
);

router.get(
  "/audit/export",
  adminRoute(async (req, res) => {
    const where = auditWhere(req);
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: parseSort(req, AUDIT_SORTS, "createdAt") as any,
      take: 20_000,
      include: { user: { select: { email: true } } },
    });
    await adminAudit(req, "admin_exported_audit_log", { count: rows.length });
    sendCsv(res, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { header: "Time", value: (r) => r.createdAt },
      { header: "Action", value: (r) => r.action },
      { header: "User", value: (r) => r.user?.email ?? "" },
      { header: "User ID", value: (r) => r.userId },
      { header: "Tenant ID", value: (r) => r.tenantId },
      { header: "IP", value: (r) => r.ip },
      { header: "User Agent", value: (r) => r.userAgent },
      { header: "Metadata", value: (r) => r.metadata },
    ]);
  })
);

/**
 * Trims the audit log to a retention window.
 *
 * `olderThanDays` has a floor of 30: the audit trail is the only record of what
 * this console did, and letting an operator purge to "yesterday" would make it
 * trivial to erase evidence of an action taken minutes ago. The purge itself is
 * audited, and that row is outside the window it just deleted.
 */
router.post(
  "/audit/purge",
  adminRoute(async (req, res) => {
    const days = optInt((req.body || {}).olderThanDays, "Retention days", 30, 3650);
    if (days === undefined) throw badRequest("Specify `olderThanDays` (minimum 30).");

    const cutoff = new Date(Date.now() - days * 86_400_000);
    const doomed = await prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });

    if (!optBool((req.body || {}).confirm)) {
      throw badRequest(
        `This would permanently delete ${doomed} audit event(s) older than ${cutoff.toISOString().slice(0, 10)}. ` +
          `Re-send with confirm: true to proceed.`,
        { requiresConfirmation: true, count: doomed, cutoff }
      );
    }

    const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await adminAudit(req, "admin_purged_audit_log", { olderThanDays: days, cutoff, deleted: result.count });
    res.json({ success: true, deleted: result.count, cutoff });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// VISITOR ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traffic analytics over an arbitrary window.
 *
 * The old endpoint returned a fixed 14-day trend and nothing else; this one
 * takes `?days` and adds referrers, device split and the unique-visitor series,
 * because "is traffic up" and "where is it coming from" are the two questions a
 * traffic page exists to answer.
 */
router.get(
  "/visitors",
  adminRoute(async (req, res) => {
    const days = parseDays(req, 30, 365);
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);
    const prevSince = new Date(since.getTime() - days * 86_400_000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalViews,
      windowViews,
      previousWindowViews,
      todayViews,
      dailyRows,
      uniqueDailyRows,
      topPages,
      topReferrers,
      uniqueToday,
      uniqueWindow,
      deviceRows,
    ] = await Promise.all([
      prisma.pageView.count(),
      prisma.pageView.count({ where: { createdAt: { gte: since } } }),
      prisma.pageView.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
      prisma.pageView.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(created_at) AS day, COUNT(*) AS count
        FROM page_views WHERE created_at >= ${since} GROUP BY day ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(created_at) AS day, COUNT(DISTINCT ip) AS count
        FROM page_views WHERE created_at >= ${since} GROUP BY day ORDER BY day ASC
      `,
      prisma.$queryRaw<{ path: string; count: bigint; visitors: bigint }[]>`
        SELECT path, COUNT(*) AS count, COUNT(DISTINCT ip) AS visitors
        FROM page_views WHERE created_at >= ${since}
        GROUP BY path ORDER BY count DESC LIMIT 15
      `,
      prisma.$queryRaw<{ referrer: string; count: bigint }[]>`
        SELECT COALESCE(NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(referrer,'https://',''),'http://',''), '/', 1), '?', 1), ''), 'direct') AS referrer,
               COUNT(*) AS count
        FROM page_views WHERE created_at >= ${since}
        GROUP BY referrer ORDER BY count DESC LIMIT 12
      `,
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(DISTINCT ip) AS cnt FROM page_views WHERE created_at >= ${todayStart}`,
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(DISTINCT ip) AS cnt FROM page_views WHERE created_at >= ${since}`,
      // Device class from the user agent. Crude, but it is the only signal the
      // page_views table carries, and it answers "is this mobile traffic?".
      prisma.$queryRaw<{ device: string; count: bigint }[]>`
        SELECT CASE
                 WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
                 WHEN user_agent LIKE '%iPad%' OR user_agent LIKE '%Tablet%' THEN 'Tablet'
                 WHEN user_agent IS NULL OR user_agent = '' THEN 'Unknown'
                 ELSE 'Desktop'
               END AS device,
               COUNT(*) AS count
        FROM page_views WHERE created_at >= ${since}
        GROUP BY device ORDER BY count DESC
      `,
    ]);

    res.json({
      days,
      totals: {
        allTime: totalViews,
        window: windowViews,
        previousWindow: previousWindowViews,
        today: todayViews,
        uniqueToday: num(uniqueToday[0]?.cnt),
        uniqueWindow: num(uniqueWindow[0]?.cnt),
        // Views per unique visitor: the closest thing to engagement this table
        // can support.
        viewsPerVisitor: num(uniqueWindow[0]?.cnt) ? Math.round((windowViews / num(uniqueWindow[0]?.cnt)) * 10) / 10 : 0,
      },
      series: {
        views: fillDailySeries(dailyRows as any, days, now),
        uniqueVisitors: fillDailySeries(uniqueDailyRows as any, days, now),
      },
      topPages: topPages.map((p) => ({ path: p.path, views: num(p.count), visitors: num(p.visitors) })),
      topReferrers: topReferrers.map((r) => ({ source: r.referrer, views: num(r.count) })),
      devices: deviceRows.map((d) => ({ label: d.device, value: num(d.count) })),
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-TENANT DATA: LEAD LISTS AND LEADS
// ─────────────────────────────────────────────────────────────────────────────

const LIST_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  scrapedAt: sortOn("scrapedAt"),
  name: sortOn("name"),
  leads: sortOnCount("leads"),
  location: sortOn("location"),
  businessType: sortOn("businessType"),
};

router.get(
  "/lead-lists",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const search = optStr(req.query.search);
    const tenantId = optStr(req.query.tenantId);
    const userId = optStr(req.query.userId);

    const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { businessType: { contains: search } },
        { location: { contains: search } },
      ];
    }
    if (tenantId) where.tenantId = tenantId;
    if (userId) where.userId = userId;

    const [total, rows, aggregate] = await Promise.all([
      prisma.leadList.count({ where }),
      prisma.leadList.findMany({
        where,
        orderBy: parseSort(req, LIST_SORTS, "createdAt") as any,
        skip: paging.skip,
        take: paging.take,
        include: {
          _count: { select: { leads: true } },
          user: { select: { id: true, email: true } },
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.lead.count(),
    ]);

    res.json({ rows, ...pageMeta(total, paging), summary: { leadsPlatformWide: aggregate } });
  })
);

router.delete(
  "/lead-lists/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "List id", 64);
    const list = await prisma.leadList.findUnique({ where: { id }, include: { _count: { select: { leads: true } } } });
    if (!list) throw notFound("No lead list with that id.");
    await prisma.leadList.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_lead_list", { listId: id, name: list.name, leads: list._count.leads });
    res.json({ success: true, id, deletedLeads: list._count.leads });
  })
);

router.post(
  "/lead-lists/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body, 200);
    const action = optEnum((req.body || {}).action, "Action", ["delete"] as const);
    if (!action) throw badRequest("The only supported action is delete.");

    const leadCount = await prisma.lead.count({ where: { listId: { in: ids } } });
    const result = await prisma.leadList.deleteMany({ where: { id: { in: ids } } });
    await adminAudit(req, "admin_bulk_deleted_lead_lists", { ids, affected: result.count, cascadedLeads: leadCount });
    res.json({ success: true, action, affected: result.count, requested: ids.length, cascadedLeads: leadCount });
  })
);

const LEAD_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  businessName: sortOn("businessName"),
  leadScore: sortOn("leadScore"),
  rating: sortOn("rating"),
  reviews: sortOn("reviews"),
  status: sortOn("status"),
  leadPriority: sortOn("leadPriority"),
};

router.get(
  "/leads",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const search = optStr(req.query.search);
    const tenantId = optStr(req.query.tenantId);
    const listId = optStr(req.query.listId);
    const status = optStr(req.query.status);
    const priority = optStr(req.query.priority);

    const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
    if (search) {
      where.OR = [
        { businessName: { contains: search } },
        { phone: { contains: search } },
        { category: { contains: search } },
        { address: { contains: search } },
      ];
    }
    if (tenantId) where.tenantId = tenantId;
    if (listId) where.listId = listId;
    if (status) where.status = status.toUpperCase();
    if (priority) where.leadPriority = priority.toUpperCase();

    const [total, rows, statusFacet, priorityFacet] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: parseSort(req, LEAD_SORTS, "createdAt") as any,
        skip: paging.skip,
        take: paging.take,
        select: {
          id: true,
          businessName: true,
          phone: true,
          category: true,
          address: true,
          rating: true,
          reviews: true,
          leadScore: true,
          leadPriority: true,
          status: true,
          websiteMissing: true,
          createdAt: true,
          list: { select: { id: true, name: true } },
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.lead.groupBy({ by: ["leadPriority"], _count: { id: true } }),
    ]);

    res.json({
      rows,
      ...pageMeta(total, paging),
      facets: {
        status: statusFacet.map((s) => ({ label: s.status, value: s._count.id })),
        priority: priorityFacet.map((s) => ({ label: s.leadPriority, value: s._count.id })),
      },
    });
  })
);

router.post(
  "/leads/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", ["delete"] as const);
    if (!action) throw badRequest("The only supported action is delete.");
    const result = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
    await adminAudit(req, "admin_bulk_deleted_leads", { count: result.count });
    res.json({ success: true, action, affected: result.count, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND JOBS
// ─────────────────────────────────────────────────────────────────────────────

const JOB_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  updatedAt: sortOn("updatedAt"),
  kind: sortOn("kind"),
  status: sortOn("status"),
};

router.get(
  "/jobs",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const status = optStr(req.query.status);
    const kind = optStr(req.query.kind);
    const tenantId = optStr(req.query.tenantId);

    const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
    if (status) where.status = status;
    if (kind) where.kind = kind;
    if (tenantId) where.tenantId = tenantId;

    const [total, rows, statusFacet, kindFacet] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: parseSort(req, JOB_SORTS, "createdAt") as any,
        skip: paging.skip,
        take: paging.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, email: true } },
        },
      }),
      prisma.job.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.job.groupBy({ by: ["kind"], _count: { id: true } }),
    ]);

    res.json({
      rows,
      ...pageMeta(total, paging),
      facets: {
        status: statusFacet.map((s) => ({ label: s.status, value: s._count.id })),
        kind: kindFacet.map((s) => ({ label: s.kind, value: s._count.id })),
      },
    });
  })
);

/**
 * Asks a running job to stop.
 *
 * "cancelling" rather than "cancelled": the worker owns the transition to a
 * terminal state, and declaring it finished from here would leave the worker
 * writing progress to a job the console says is over.
 */
router.post(
  "/jobs/:id/cancel",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Job id", 64);
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw notFound("No job with that id.");
    if (!["queued", "running"].includes(job.status)) {
      throw conflict(`That job is already ${job.status}.`);
    }
    const updated = await prisma.job.update({ where: { id }, data: { status: "cancelling" } });
    await adminAudit(req, "admin_cancelled_job", { jobId: id, kind: job.kind, tenantId: job.tenantId });
    res.json({ success: true, job: updated });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A live probe of the things that break in production.
 *
 * Every check reports ok / warn / fail with a sentence explaining the
 * consequence, because a red dot that says "ENCRYPTION_KEY" tells the operator
 * nothing about what stops working.
 */
router.get(
  "/health",
  adminRoute(async (req, res) => {
    const started = Date.now();
    let dbLatencyMs: number | null = null;
    let dbOk = false;
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch (err) {
      logger.warn(`Admin health probe: database check failed: ${(err as Error).message}`);
    }

    const [tableCounts, jobCounts, staleJobs, recentErrors] = await Promise.all([
      Promise.all([
        prisma.user.count(),
        prisma.tenant.count(),
        prisma.lead.count(),
        prisma.leadList.count(),
        prisma.campaign.count(),
        prisma.auditLog.count(),
        prisma.pageView.count(),
        prisma.subscription.count(),
        prisma.invoice.count(),
        prisma.payment.count(),
      ]).catch(() => [] as number[]),
      prisma.job.groupBy({ by: ["status"], _count: { id: true } }).catch(() => []),
      // A job still "running" after six hours is almost certainly an orphan from
      // a crashed worker rather than genuinely long work.
      prisma.job
        .count({ where: { status: "running", updatedAt: { lt: new Date(Date.now() - 6 * 3600_000) } } })
        .catch(() => 0),
      prisma.auditLog
        .count({ where: { action: { contains: "failed" }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })
        .catch(() => 0),
    ]);

    const memory = process.memoryUsage();
    const checks = [
      {
        key: "database",
        label: "Database",
        status: dbOk ? (dbLatencyMs !== null && dbLatencyMs > 500 ? "warn" : "ok") : "fail",
        detail: dbOk
          ? `Responding in ${dbLatencyMs} ms.`
          : "Unreachable. Every feature that reads or writes data is down.",
      },
      {
        key: "jwt_secret",
        label: "Session signing secret",
        status: env.isDefaultJwtSecret() ? (env.isProduction ? "fail" : "warn") : "ok",
        detail: env.isDefaultJwtSecret()
          ? "Still the development fallback. Anyone who knows it can mint an admin session — set JWT_SECRET."
          : "A custom secret is configured.",
      },
      {
        key: "encryption_key",
        label: "Integration encryption key",
        status: env.isDefaultEncryptionKey() ? (env.isProduction ? "fail" : "warn") : "ok",
        detail: env.isDefaultEncryptionKey()
          ? "Stored SMTP and WhatsApp credentials are encrypted with the shipped default key. Set ENCRYPTION_KEY."
          : "A custom key is configured.",
      },
      {
        key: "cors",
        label: "CORS policy",
        status: env.corsOrigins.includes("*") ? (env.isProduction ? "fail" : "warn") : "ok",
        detail: env.corsOrigins.includes("*")
          ? "Wildcard origin. Credentialed cross-origin reads are refused in production, but set CORS_ORIGINS explicitly."
          : `Restricted to ${env.corsOrigins.length} origin(s).`,
      },
      {
        key: "superadmin",
        label: "Superadmin console",
        status: env.isSuperAdminConfigured() ? "ok" : "fail",
        detail: env.isSuperAdminConfigured()
          ? "ADMIN_EMAILS, ADMIN_PASSWORD and SUPERADMIN_SECRET are all set."
          : "Not fully configured — this console cannot issue new sessions.",
      },
      {
        key: "smtp",
        label: "Outbound email",
        status: env.isSmtpConfigured() ? "ok" : "warn",
        detail: env.isSmtpConfigured()
          ? "SMTP is configured; verification codes and campaigns can send."
          : "Not configured. Sign-up verification codes cannot be delivered.",
      },
      {
        key: "gemini",
        label: "AI provider",
        status: env.isGeminiConfigured() ? "ok" : "warn",
        detail: env.isGeminiConfigured()
          ? "Gemini key present; AI copy and insights are live."
          : "No key. AI features fall back to rule-based output.",
      },
      {
        key: "workers",
        label: "Background jobs",
        status: staleJobs > 0 ? "warn" : "ok",
        detail: staleJobs > 0
          ? `${staleJobs} job(s) have been "running" for over six hours — the worker may have died mid-run.`
          : "No stalled jobs.",
      },
      {
        key: "failures",
        label: "Failures in the last 24h",
        status: recentErrors > 50 ? "warn" : "ok",
        detail: `${recentErrors} failure event(s) recorded in the audit log.`,
      },
    ];

    const [users, tenants, leads, leadLists, campaigns, auditLogs, pageViews, subscriptions, invoices, payments] =
      tableCounts.length === 10 ? tableCounts : new Array(10).fill(0);

    res.json({
      status: checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok",
      checks,
      probeMs: Date.now() - started,
      runtime: {
        nodeVersion: process.version,
        platform: `${process.platform} ${process.arch}`,
        environment: env.nodeEnv,
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10,
        rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
        systemMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
      },
      database: {
        reachable: dbOk,
        latencyMs: dbLatencyMs,
        // The host is shown without the credentials that precede it.
        host: env.databaseUrl ? env.databaseUrl.replace(/\/\/[^@]*@/, "//***@") : null,
        tables: { users, tenants, leads, leadLists, campaigns, auditLogs, pageViews, subscriptions, invoices, payments },
      },
      jobs: Object.fromEntries((jobCounts as any[]).map((j) => [j.status, j._count.id])),
    });
  })
);

export default router;
