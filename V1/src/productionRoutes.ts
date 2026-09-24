/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production/ops routes: analytics, notifications, backups, system health.
 *
 * AUTHORIZATION
 * -------------
 * This file previously imported `requireAuth` and never applied it. Combined
 * with being mounted before the auth middleware, that left 13 endpoints
 * completely anonymous — including backup create/list/delete and a restore
 * endpoint that extracts an archive over the application working directory —
 * while the 7 endpoints that did check `req.authUser` could never pass, because
 * nothing populated it on this mount.
 *
 * Now:
 *   - every route requires a session (`requireAuth`);
 *   - routes whose data spans all tenants require admin (`requireAdmin`);
 *   - restore additionally requires an explicit env opt-in.
 *
 * The per-tenant/global split is temporary. The analytics and export endpoints
 * read the process-global JSON stores rather than tenant-scoped tables, so
 * "admin only" is the correct answer until Phase 8 gives them real tenant
 * scoping.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireAdmin } from "./authRoutes";
import { env } from "./env";
import { logger } from "./logger";
import { getDashboardMetrics, getUserAnalytics, exportToCSV, performanceMonitor } from "./analytics";
import { notificationService } from "./notifications";
import { backupService } from "./backup";
import { duplicateChecker } from "./duplicateChecker";
import { loadFailedLeads } from "./googleSheetsWebhook";
import { apiRateLimiter } from "./security";

const router = Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter());

/**
 * Every route below requires a signed-in user. Admin-only routes layer
 * `requireAdmin` on top.
 */
router.use(requireAuth);

/** Uniform error responses that never leak internals in production. */
function fail(res: Response, err: unknown, fallback: string) {
  logger.error(`Production route error: ${fallback}`, err);
  res.status(500).json({
    error: env.isProduction ? fallback : `${fallback} ${(err as Error)?.message ?? ""}`.trim(),
  });
}

/**
 * Blocks backup restore unless an operator has explicitly enabled it.
 *
 * Restore unzips an archive over `process.cwd()`. That is remote code execution
 * in practice: overwrite a .js/.cjs file the server loads and wait for a
 * restart. It stays available for genuine disaster recovery, but off by default
 * and admin-only.
 */
function requireRestoreEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!env.enableBackupRestore) {
    return res.status(403).json({
      error:
        "Backup restore is disabled. It overwrites files in the application directory, so it must be " +
        "enabled deliberately by setting ENABLE_BACKUP_RESTORE=true and restarting the server.",
      code: "restore_disabled",
    });
  }
  next();
}

// ── Analytics Endpoints ──

/**
 * Platform-wide metrics computed from the global lead store — not tenant
 * scoped, therefore admin only.
 */
router.get("/analytics/dashboard", requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(getDashboardMetrics());
  } catch (error) {
    fail(res, error, "Failed to fetch dashboard metrics.");
  }
});

/** The caller's own analytics. Reachable now that req.authUser is populated. */
router.get("/analytics/user", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const analytics = await getUserAnalytics(req.authUser.id);
    if (!analytics) {
      return res.status(404).json({ error: "User analytics not found." });
    }

    res.json(analytics);
  } catch (error) {
    fail(res, error, "Failed to fetch user analytics.");
  }
});

/** Server-wide endpoint latency map. Operational data, admin only. */
router.get("/analytics/performance", requireAdmin, (_req: Request, res: Response) => {
  try {
    res.json(performanceMonitor.getMetrics());
  } catch (error) {
    fail(res, error, "Failed to fetch performance metrics.");
  }
});

router.post("/analytics/performance/reset", requireAdmin, (_req: Request, res: Response) => {
  try {
    performanceMonitor.reset();
    res.json({ success: true, message: "Performance metrics reset." });
  } catch (error) {
    fail(res, error, "Failed to reset performance metrics.");
  }
});

// ── Export Endpoints ──
//
// These read the process-global processed-leads.json / failed-leads.json, which
// contain every tenant's leads. Admin only until Phase 8 replaces them with
// tenant-scoped queries. Tenant-scoped CSV export already exists at
// GET /api/crm/lists/:id/export.

router.get("/export/leads/csv", requireAdmin, (_req: Request, res: Response) => {
  try {
    const leads = duplicateChecker.loadLeads();
    const csv = exportToCSV(leads);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leadgenpilot-leads-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    fail(res, error, "Failed to export leads.");
  }
});

router.get("/export/failed-leads/csv", requireAdmin, (_req: Request, res: Response) => {
  try {
    const leads = loadFailedLeads();
    const csv = exportToCSV(leads);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leadgenpilot-failed-leads-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    fail(res, error, "Failed to export failed leads.");
  }
});

router.get("/export/analytics/csv", requireAdmin, (_req: Request, res: Response) => {
  try {
    const metrics = getDashboardMetrics();
    const data = [
      { metric: "Total Leads", value: metrics.leads.total },
      { metric: "Hot Leads", value: metrics.leads.hot },
      { metric: "Warm Leads", value: metrics.leads.warm },
      { metric: "Cold Leads", value: metrics.leads.cold },
      { metric: "Leads Today", value: metrics.leads.today },
      { metric: "Leads This Week", value: metrics.leads.thisWeek },
      { metric: "Leads This Month", value: metrics.leads.thisMonth },
      { metric: "Emails Sent", value: metrics.outreach.emailSent },
      { metric: "Emails Failed", value: metrics.outreach.emailFailed },
      { metric: "WhatsApp Sent", value: metrics.outreach.whatsappSent },
      { metric: "WhatsApp Failed", value: metrics.outreach.whatsappFailed },
      { metric: "Conversion Rate", value: `${metrics.conversion.conversionRate}%` },
    ];

    const csv = exportToCSV(data);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leadgenpilot-analytics-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    fail(res, error, "Failed to export analytics.");
  }
});

// ── Notification Endpoints ──
// Per-user and keyed by req.authUser.id, so a session is sufficient. These were
// unreachable before the mount-order fix.

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const unreadOnly = req.query.unreadOnly === "true";
    const notifications = await notificationService.getForUser(req.authUser.id, unreadOnly);
    res.json(notifications);
  } catch (error) {
    fail(res, error, "Failed to fetch notifications.");
  }
});

router.get("/notifications/count", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const count = await notificationService.getCount(req.authUser.id);
    res.json(count);
  } catch (error) {
    fail(res, error, "Failed to fetch notification count.");
  }
});

router.post("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const success = await notificationService.markAsRead(req.authUser.id, req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Notification not found." });
    }

    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to mark notification as read.");
  }
});

router.post("/notifications/read-all", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const count = await notificationService.markAllAsRead(req.authUser.id);
    res.json({ success: true, count });
  } catch (error) {
    fail(res, error, "Failed to mark all notifications as read.");
  }
});

router.delete("/notifications/:id", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const success = await notificationService.delete(req.authUser.id, req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Notification not found." });
    }

    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to delete notification.");
  }
});

router.delete("/notifications", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const count = await notificationService.clearAll(req.authUser.id);
    res.json({ success: true, count });
  } catch (error) {
    fail(res, error, "Failed to clear notifications.");
  }
});

// ── Backup Endpoints ──
// Backups bundle the global lead stores and a masked copy of .env. Admin only.

router.post("/backups/create", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const metadata = await backupService.createBackup();
    res.json({ success: true, backup: metadata });
  } catch (error) {
    fail(res, error, "Failed to create backup.");
  }
});

router.get("/backups", requireAdmin, (_req: Request, res: Response) => {
  try {
    res.json(backupService.listBackups());
  } catch (error) {
    fail(res, error, "Failed to list backups.");
  }
});

router.post(
  "/backups/:id/restore",
  requireAdmin,
  requireRestoreEnabled,
  async (req: Request, res: Response) => {
    try {
      logger.warn(
        `Backup restore requested for '${req.params.id}' by ${(req as any).adminUser?.email ?? "an administrator"}.`
      );
      const success = await backupService.restoreBackup(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Backup not found or restore failed." });
      }

      res.json({ success: true, message: "Backup restored successfully." });
    } catch (error) {
      fail(res, error, "Failed to restore backup.");
    }
  }
);

router.delete("/backups/:id", requireAdmin, (req: Request, res: Response) => {
  try {
    const success = backupService.deleteBackup(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Backup not found or deletion failed." });
    }

    res.json({ success: true, message: "Backup deleted successfully." });
  } catch (error) {
    fail(res, error, "Failed to delete backup.");
  }
});

// ── System Health Endpoints ──
// Exposes process memory, uptime and global lead counts. Admin only.
// The unauthenticated liveness probe remains GET /api/health.

router.get("/system/health", requireAdmin, (_req: Request, res: Response) => {
  const metrics = getDashboardMetrics();
  const performance = performanceMonitor.getMetrics();

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    leads: {
      total: metrics.leads.total,
      hot: metrics.leads.hot,
    },
    performance: {
      avgResponseTime: performance.length > 0
        ? Math.round(performance.reduce((sum, p) => sum + p.avgTime, 0) / performance.length)
        : 0,
    },
  });
});

export default router;
