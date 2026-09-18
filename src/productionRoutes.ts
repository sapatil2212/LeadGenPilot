/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./authRoutes";
import { env } from "./env";
import { getDashboardMetrics, getUserAnalytics, exportToCSV, performanceMonitor } from "./analytics";
import { notificationService } from "./notifications";
import { backupService } from "./backup";
import { duplicateChecker } from "./duplicateChecker";
import { loadFailedLeads } from "./googleSheetsWebhook";
import { apiRateLimiter } from "./security";

const router = Router();

// Apply rate limiting to all routes
router.use(apiRateLimiter());

// ── Analytics Endpoints ──

router.get("/analytics/dashboard", async (req: Request, res: Response) => {
  try {
    const metrics = getDashboardMetrics();
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch dashboard metrics." });
  }
});

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
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch user analytics." });
  }
});

router.get("/analytics/performance", (req: Request, res: Response) => {
  try {
    const metrics = performanceMonitor.getMetrics();
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch performance metrics." });
  }
});

router.post("/analytics/performance/reset", (req: Request, res: Response) => {
  try {
    performanceMonitor.reset();
    res.json({ success: true, message: "Performance metrics reset." });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to reset performance metrics." });
  }
});

// ── Export Endpoints ──

router.get("/export/leads/csv", (req: Request, res: Response) => {
  try {
    const leads = duplicateChecker.loadLeads();
    const csv = exportToCSV(leads);
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="nexaleadai-leads-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to export leads." });
  }
});

router.get("/export/failed-leads/csv", (req: Request, res: Response) => {
  try {
    const leads = loadFailedLeads();
    const csv = exportToCSV(leads);
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="nexaleadai-failed-leads-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to export failed leads." });
  }
});

router.get("/export/analytics/csv", (req: Request, res: Response) => {
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
    res.setHeader("Content-Disposition", `attachment; filename="nexaleadai-analytics-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to export analytics." });
  }
});

// ── Notification Endpoints ──

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }
    
    const unreadOnly = req.query.unreadOnly === "true";
    const notifications = await notificationService.getForUser(req.authUser.id, unreadOnly);
    res.json(notifications);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch notifications." });
  }
});

router.get("/notifications/count", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }
    
    const count = await notificationService.getCount(req.authUser.id);
    res.json(count);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch notification count." });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to mark notification as read." });
  }
});

router.post("/notifications/read-all", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }
    
    const count = await notificationService.markAllAsRead(req.authUser.id);
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to mark all notifications as read." });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete notification." });
  }
});

router.delete("/notifications", async (req: Request, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required." });
    }
    
    const count = await notificationService.clearAll(req.authUser.id);
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to clear notifications." });
  }
});

// ── Backup Endpoints ──

router.post("/backups/create", async (req: Request, res: Response) => {
  try {
    const metadata = await backupService.createBackup();
    res.json({ success: true, backup: metadata });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create backup." });
  }
});

router.get("/backups", (req: Request, res: Response) => {
  try {
    const backups = backupService.listBackups();
    res.json(backups);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list backups." });
  }
});

router.post("/backups/:id/restore", async (req: Request, res: Response) => {
  try {
    const success = await backupService.restoreBackup(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Backup not found or restore failed." });
    }
    
    res.json({ success: true, message: "Backup restored successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to restore backup." });
  }
});

router.delete("/backups/:id", (req: Request, res: Response) => {
  try {
    const success = backupService.deleteBackup(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Backup not found or deletion failed." });
    }
    
    res.json({ success: true, message: "Backup deleted successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete backup." });
  }
});

// ── System Health Endpoints ──

router.get("/system/health", (req: Request, res: Response) => {
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
