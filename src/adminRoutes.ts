/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./authRoutes";
import {
  adminListUsers,
  adminUpdateUser,
  adminListAuditLogs,
  AuthError,
  type RequestMeta,
} from "./authService";
import { logger } from "./logger";

const router = Router();

function metaOf(req: Request): RequestMeta {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    userAgent: req.headers["user-agent"],
  };
}

function handleError(res: Response, err: unknown) {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error("Admin route error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again.", code: "internal" });
}

router.use(requireAdmin);

// ── List users (paginated, searchable) ──
router.get("/users", async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const pageSize = parseInt(String(req.query.pageSize || "20"), 10);
    const search = req.query.search ? String(req.query.search) : undefined;
    const result = await adminListUsers({ page, pageSize, search });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Update a user's plan/role ──
router.patch("/users/:id", async (req: Request, res: Response) => {
  try {
    const actorId = (req as any).user.sub;
    const { plan, role } = req.body || {};
    const user = await adminUpdateUser(req.params.id, { plan, role }, actorId, metaOf(req));
    res.json({ success: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

// ── View audit log ──
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

// ── Platform stats overview ──
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { prisma } = await import("./prisma");
    const now = new Date();
    const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOf7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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
      audit: {
        total: totalAuditLogs,
        last7Days: auditLast7,
      },
      plans: Object.fromEntries(planCounts.map((p) => [p.plan, p._count.id])),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Visitor analytics ──
router.get("/visitors", async (req: Request, res: Response) => {
  try {
    const { getVisitorStats } = await import("./visitorTracker");
    const stats = await getVisitorStats();
    res.json(stats);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
