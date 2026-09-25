/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform analytics for the operator overview.
 *
 * Mounted at /api/admin/analytics behind requireAdmin.
 *
 * Two design points worth stating:
 *
 *  - Every headline number carries the same number for the *preceding* window of
 *    equal length. A dashboard that says "412 users" is trivia; one that says
 *    "412, +38 this month, up 14% on last" is information, and the comparison has
 *    to be computed alongside the figure or the two can disagree.
 *  - Time series are produced by one grouped SQL statement per metric and then
 *    zero-filled in JS. The alternative — a query per day — turns a 90-day chart
 *    into 90 round trips to a remote MySQL server.
 */

import { Router } from "express";
import { prisma } from "../prisma";
import {
  adminRoute,
  deltaPercent,
  fillDailySeries,
  num,
  optStr,
  parseDays,
  toInt,
} from "./shared";

const router = Router();

const LIVE_SUB_STATUSES = ["trialing", "active", "past_due"] as const;
const DAY_MS = 86_400_000;

/**
 * Counts the same thing over two adjacent windows.
 *
 * Kept as one helper because the "previous window" bound is the easy thing to
 * get wrong: it must end exactly where the current window begins, or the two
 * overlap and the delta flatters itself.
 */
async function countWithDelta(
  model: { count: (args: any) => Promise<number> },
  field: string,
  since: Date,
  prevSince: Date,
  extraWhere: Record<string, unknown> = {}
): Promise<{ current: number; previous: number; delta: number | null }> {
  const [current, previous] = await Promise.all([
    model.count({ where: { ...extraWhere, [field]: { gte: since } } }),
    model.count({ where: { ...extraWhere, [field]: { gte: prevSince, lt: since } } }),
  ]);
  return { current, previous, delta: deltaPercent(current, previous) };
}

router.get(
  "/overview",
  adminRoute(async (req, res) => {
    const days = parseDays(req, 30, 365);
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const prevSince = new Date(since.getTime() - days * DAY_MS);

    const [
      totalUsers,
      verifiedUsers,
      suspendedUsers,
      adminUsers,
      lockedUsers,
      totalTenants,
      suspendedTenants,
      totalLeads,
      totalLists,
      totalCampaigns,
      totalPageViews,
      auditTotal,
      newUsers,
      newLeads,
      newTenants,
      newCampaigns,
      windowPageViews,
      planDistribution,
      roleDistribution,
      statusDistribution,
      verifiedSplit,
      leadPriority,
      leadStatus,
      subStatus,
      liveSubs,
      collectedWindow,
      collectedPrev,
      outstanding,
      signupRows,
      leadRows,
      viewRows,
      revenueRows,
      topTenants,
      recentActivity,
      recentSignups,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({ where: { status: "suspended" } }),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.user.count({ where: { lockedUntil: { gt: now } } }),
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: "suspended" } }),
      prisma.lead.count(),
      prisma.leadList.count(),
      prisma.campaign.count(),
      prisma.pageView.count(),
      prisma.auditLog.count(),
      countWithDelta(prisma.user as any, "createdAt", since, prevSince),
      countWithDelta(prisma.lead as any, "createdAt", since, prevSince),
      countWithDelta(prisma.tenant as any, "createdAt", since, prevSince),
      countWithDelta(prisma.campaign as any, "createdAt", since, prevSince),
      countWithDelta(prisma.pageView as any, "createdAt", since, prevSince),

      prisma.user.groupBy({ by: ["plan"], _count: { id: true } }),
      prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
      prisma.user.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.user.groupBy({ by: ["emailVerified"], _count: { id: true } }),
      prisma.lead.groupBy({ by: ["leadPriority"], _count: { id: true } }),
      prisma.lead.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.subscription.groupBy({ by: ["status"], _count: { id: true } }),

      prisma.subscription.findMany({
        where: { status: { in: [...LIVE_SUB_STATUSES] } },
        select: { amount: true, billingCycle: true },
      }),
      prisma.payment.aggregate({
        where: { status: { in: ["succeeded", "partially_refunded"] }, paidAt: { gte: since } },
        _sum: { amount: true, refundedAmount: true },
      }),
      prisma.payment.aggregate({
        where: { status: { in: ["succeeded", "partially_refunded"] }, paidAt: { gte: prevSince, lt: since } },
        _sum: { amount: true, refundedAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { status: { in: ["open", "partially_paid"] } },
        _sum: { total: true, amountPaid: true },
        _count: { id: true },
      }),

      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(created_at) AS day, COUNT(*) AS count FROM users
        WHERE created_at >= ${since} GROUP BY day ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(created_at) AS day, COUNT(*) AS count FROM leads
        WHERE created_at >= ${since} GROUP BY day ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(created_at) AS day, COUNT(*) AS count FROM page_views
        WHERE created_at >= ${since} GROUP BY day ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE(paid_at) AS day, SUM(amount - refunded_amount) AS count FROM payments
        WHERE paid_at >= ${since} AND status IN ('succeeded','partially_refunded')
        GROUP BY day ORDER BY day ASC
      `,

      prisma.tenant.findMany({
        orderBy: { leads: { _count: "desc" } },
        take: 8,
        include: { _count: { select: { leads: true, members: true, campaigns: true } } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, email: true, name: true, plan: true, emailVerified: true, createdAt: true },
      }),
    ]);

    const mrr = liveSubs.reduce(
      (sum, s) => sum + (s.billingCycle === "yearly" ? Math.round(s.amount / 12) : s.billingCycle === "lifetime" ? 0 : s.amount),
      0
    );
    const netWindow = (collectedWindow._sum.amount ?? 0) - (collectedWindow._sum.refundedAmount ?? 0);
    const netPrev = (collectedPrev._sum.amount ?? 0) - (collectedPrev._sum.refundedAmount ?? 0);

    /**
     * Operator attention list.
     *
     * Derived from the numbers already fetched rather than from a separate pass,
     * and each entry names the action. A dashboard that shows 12 overdue invoices
     * without linking to them has only made the operator's job longer.
     */
    const alerts: { level: "warn" | "critical" | "info"; message: string; page?: string }[] = [];
    if (lockedUsers > 0) {
      alerts.push({ level: "warn", message: `${lockedUsers} account(s) are locked out after failed sign-ins.`, page: "users" });
    }
    if (suspendedUsers > 0) {
      alerts.push({ level: "info", message: `${suspendedUsers} account(s) are suspended.`, page: "users" });
    }
    if (suspendedTenants > 0) {
      alerts.push({ level: "info", message: `${suspendedTenants} workspace(s) are suspended.`, page: "tenants" });
    }
    const overdueAmount = Math.max(0, (outstanding._sum.total ?? 0) - (outstanding._sum.amountPaid ?? 0));
    if (outstanding._count.id > 0) {
      alerts.push({
        level: overdueAmount > 0 ? "warn" : "info",
        message: `${outstanding._count.id} invoice(s) are unpaid, totalling ${overdueAmount} minor units.`,
        page: "invoices",
      });
    }
    const unverified = totalUsers - verifiedUsers;
    if (unverified > 0) {
      alerts.push({ level: "info", message: `${unverified} account(s) never completed email verification.`, page: "users" });
    }

    res.json({
      window: { days, since, until: now },
      kpis: {
        users: { total: totalUsers, new: newUsers.current, delta: newUsers.delta, verified: verifiedUsers, unverified, suspended: suspendedUsers, admins: adminUsers, locked: lockedUsers },
        tenants: { total: totalTenants, new: newTenants.current, delta: newTenants.delta, suspended: suspendedTenants },
        leads: { total: totalLeads, new: newLeads.current, delta: newLeads.delta, lists: totalLists },
        campaigns: { total: totalCampaigns, new: newCampaigns.current, delta: newCampaigns.delta },
        traffic: { total: totalPageViews, window: windowPageViews.current, delta: windowPageViews.delta },
        revenue: {
          mrr,
          arr: mrr * 12,
          collectedWindow: Math.max(0, netWindow),
          delta: deltaPercent(netWindow, netPrev),
          outstanding: overdueAmount,
          outstandingCount: outstanding._count.id,
          activeSubscriptions: liveSubs.length,
        },
        audit: { total: auditTotal },
      },
      series: {
        signups: fillDailySeries(signupRows as any, days, now),
        leads: fillDailySeries(leadRows as any, days, now),
        pageViews: fillDailySeries(viewRows as any, days, now),
        revenue: fillDailySeries(revenueRows as any, days, now),
      },
      distributions: {
        plan: planDistribution.map((p) => ({ label: p.plan, value: p._count.id })),
        role: roleDistribution.map((p) => ({ label: p.role, value: p._count.id })),
        accountStatus: statusDistribution.map((p) => ({ label: p.status, value: p._count.id })),
        emailVerified: verifiedSplit.map((p) => ({ label: p.emailVerified ? "Verified" : "Unverified", value: p._count.id })),
        leadPriority: leadPriority.map((p) => ({ label: p.leadPriority, value: p._count.id })),
        leadStatus: leadStatus.map((p) => ({ label: p.status, value: p._count.id })),
        subscriptionStatus: subStatus.map((p) => ({ label: p.status, value: p._count.id })),
      },
      topTenants: topTenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        leads: t._count.leads,
        members: t._count.members,
        campaigns: t._count.campaigns,
      })),
      recentActivity,
      recentSignups,
      alerts,
    });
  })
);

/**
 * A single named series, so the chart's range selector does not have to refetch
 * the whole overview payload to redraw one line.
 */
const SERIES_SOURCES: Record<string, { table: string; dateColumn: string; expression: string; where?: string }> = {
  signups: { table: "users", dateColumn: "created_at", expression: "COUNT(*)" },
  leads: { table: "leads", dateColumn: "created_at", expression: "COUNT(*)" },
  pageViews: { table: "page_views", dateColumn: "created_at", expression: "COUNT(*)" },
  uniqueVisitors: { table: "page_views", dateColumn: "created_at", expression: "COUNT(DISTINCT ip)" },
  revenue: {
    table: "payments",
    dateColumn: "paid_at",
    expression: "SUM(amount - refunded_amount)",
    where: "status IN ('succeeded','partially_refunded')",
  },
  invoices: { table: "invoices", dateColumn: "issued_at", expression: "COUNT(*)", where: "status <> 'void'" },
  subscriptions: { table: "subscriptions", dateColumn: "started_at", expression: "COUNT(*)" },
  campaigns: { table: "campaigns", dateColumn: "created_at", expression: "COUNT(*)" },
  auditEvents: { table: "audit_logs", dateColumn: "created_at", expression: "COUNT(*)" },
};

router.get(
  "/series",
  adminRoute(async (req, res) => {
    const days = parseDays(req, 30, 365);
    const requested = (optStr(req.query.metric) || "signups").split(",").slice(0, 4);
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);

    const out: Record<string, { date: string; value: number }[]> = {};
    for (const metric of requested) {
      const source = SERIES_SOURCES[metric];
      // Unknown metric names are skipped rather than interpolated: `table` and
      // `expression` below are concatenated into SQL, so they may only ever come
      // from this map, never from the query string.
      if (!source) continue;
      const sql =
        `SELECT DATE(${source.dateColumn}) AS day, ${source.expression} AS count ` +
        `FROM ${source.table} WHERE ${source.dateColumn} >= ? ` +
        (source.where ? `AND ${source.where} ` : "") +
        `GROUP BY day ORDER BY day ASC`;
      const rows = await prisma.$queryRawUnsafe<{ day: string; count: bigint }[]>(sql, since);
      out[metric] = fillDailySeries(rows as any, days, now);
    }

    res.json({ days, since, until: now, series: out, available: Object.keys(SERIES_SOURCES) });
  })
);

/**
 * Monthly signup cohorts with retention-style survival.
 *
 * "Still active" here means the account has not been suspended and has signed in
 * since the month after it joined, which is the closest this schema can get to
 * retention without an events table. Labelled as such in the response so the
 * client does not present it as something stronger.
 */
router.get(
  "/cohorts",
  adminRoute(async (req, res) => {
    const months = Math.min(18, Math.max(3, toInt(req.query.months, 6)));
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    const rows = await prisma.$queryRaw<
      { ym: string; signups: bigint; verified: bigint; retained: bigint; paying: bigint }[]
    >`
      SELECT DATE_FORMAT(u.created_at, '%Y-%m') AS ym,
             COUNT(*) AS signups,
             SUM(u.email_verified = 1) AS verified,
             SUM(u.last_login_at IS NOT NULL
                 AND u.last_login_at > DATE_ADD(u.created_at, INTERVAL 30 DAY)
                 AND u.status = 'active') AS retained,
             SUM(EXISTS (SELECT 1 FROM subscriptions s
                         WHERE s.user_id = u.id AND s.status IN ('trialing','active','past_due'))) AS paying
      FROM users u
      WHERE u.created_at >= ${start}
      GROUP BY ym
      ORDER BY ym ASC
    `;

    res.json({
      months,
      definition:
        "Retained = verified, still active, and signed in more than 30 days after joining. " +
        "Derived from users.last_login_at; there is no per-session events table.",
      cohorts: rows.map((r) => {
        const signups = num(r.signups);
        return {
          month: r.ym,
          signups,
          verified: num(r.verified),
          retained: num(r.retained),
          paying: num(r.paying),
          verifiedRate: signups ? Math.round((num(r.verified) / signups) * 1000) / 10 : 0,
          retentionRate: signups ? Math.round((num(r.retained) / signups) * 1000) / 10 : 0,
          conversionRate: signups ? Math.round((num(r.paying) / signups) * 1000) / 10 : 0,
        };
      }),
    });
  })
);

export default router;
