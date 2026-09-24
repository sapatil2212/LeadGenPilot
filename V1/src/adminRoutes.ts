/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The /api/admin surface: everything the superadmin console reads and writes.
 *
 * `requireAdmin` guards the whole router, so nothing below needs its own check —
 * and, more usefully, nothing below can accidentally omit one. The real surface
 * lives in ./admin/*, grouped by the thing it administers:
 *
 *   /api/admin/users      accounts: CRUD, bulk actions, password resets, export
 *   /api/admin/billing    plans, subscriptions, invoices, payments, revenue
 *   /api/admin/platform   workspaces, flags, announcements, settings, audit,
 *                         traffic, jobs, cross-tenant data, health
 *   /api/admin/analytics   KPIs, time series, cohorts
 *
 * The four endpoints at the bottom (/stats, /audit, /visitors, /me) are the
 * original ones, kept so an older client or a bookmarked URL still resolves.
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./authRoutes";
import { adminListAuditLogs, AuthError } from "./authService";
import { logger } from "./logger";
import { env } from "./env";

import adminUsersRouter from "./admin/adminUsers";
import adminBillingRouter from "./admin/adminBilling";
import adminPlatformRouter from "./admin/adminPlatform";
import adminAnalyticsRouter from "./admin/adminAnalytics";
import { actorOf, adminRoute, sendAdminError } from "./admin/shared";

const router = Router();

function handleError(res: Response, err: unknown) {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error("Admin route error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again.", code: "internal" });
}

// Single gate for every route in this file and every sub-router below it.
router.use(requireAdmin);

// ── Grouped admin surface ────────────────────────────────────────────────────
router.use("/users", adminUsersRouter);
router.use("/billing", adminBillingRouter);
router.use("/platform", adminPlatformRouter);
router.use("/analytics", adminAnalyticsRouter);

/**
 * Who am I, and what is this console allowed to do?
 *
 * The console's session may be the synthetic env-based superadmin with no row in
 * `users`, so the client cannot look itself up by id. This is how the header
 * learns the operator's identity after a hard reload.
 */
router.get(
  "/me",
  adminRoute(async (req, res) => {
    const actor = actorOf(req);
    res.json({
      id: actor.id ?? "superadmin",
      email: actor.email,
      role: "admin",
      kind: actor.synthetic ? "superadmin_console" : "admin_user",
      environment: env.nodeEnv,
      capabilities: {
        // Surfaced so the UI can explain a disabled control instead of failing
        // the request after the operator has filled in a form.
        backupRestore: env.enableBackupRestore,
        emailDelivery: env.isSmtpConfigured(),
        aiProvider: env.isGeminiConfigured(),
      },
    });
  })
);

// ── Legacy endpoints (kept for compatibility) ────────────────────────────────

/**
 * Platform counters.
 *
 * Superseded by /api/admin/analytics/overview, which returns the same figures
 * plus period-over-period deltas and the series behind them.
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { prisma } = await import("./prisma");
    const now = new Date();
    const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOf7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      verifiedUsers,
      adminUsers,
      newUsersLast7,
      newUsersLast30,
      totalLeads,
      totalLeadLists,
      leadsLast30,
      totalAuditLogs,
      auditLast7,
      planCounts,
      totalLeadsUsed,
      lockedUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.user.count({ where: { createdAt: { gte: startOf7Days } } }),
      prisma.user.count({ where: { createdAt: { gte: startOf30Days } } }),
      prisma.lead.count(),
      prisma.leadList.count(),
      prisma.lead.count({ where: { createdAt: { gte: startOf30Days } } }),
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: startOf7Days } } }),
      prisma.user.groupBy({ by: ["plan"], _count: { id: true } }),
      prisma.user.aggregate({ _sum: { leadsUsed: true } }),
      prisma.user.count({ where: { lockedUntil: { gt: now } } }),
    ]);

    res.json({
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        unverified: totalUsers - verifiedUsers,
        admins: adminUsers,
        newLast7Days: newUsersLast7,
        newLast30Days: newUsersLast30,
        locked: lockedUsers,
      },
      leads: {
        total: totalLeads,
        lists: totalLeadLists,
        last30Days: leadsLast30,
        totalUsed: totalLeadsUsed._sum.leadsUsed || 0,
      },
      audit: { total: totalAuditLogs, last7Days: auditLast7 },
      plans: Object.fromEntries(planCounts.map((p) => [p.plan, p._count.id])),
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** Superseded by /api/admin/platform/audit, which adds filters, sort and export. */
router.get("/audit", async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const pageSize = parseInt(String(req.query.pageSize || "50"), 10);
    const result = await adminListAuditLogs({ page, pageSize });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/** Superseded by /api/admin/platform/visitors, which takes a ?days window. */
router.get("/visitors", async (req: Request, res: Response) => {
  try {
    const { getVisitorStats } = await import("./visitorTracker");
    const stats = await getVisitorStats();
    res.json(stats);
  } catch (err) {
    sendAdminError(res, err);
  }
});

export default router;
