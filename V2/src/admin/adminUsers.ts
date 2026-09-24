/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operator-side user management: full CRUD, bulk actions and export.
 *
 * Mounted at /api/admin/users behind requireAdmin.
 *
 * The previous surface was list + "PATCH plan and role". Everything else an
 * operator actually gets asked to do — verify an address the OTP never reached,
 * lift a brute-force lockout, suspend an abusive account, reset a password over
 * the phone, delete on a GDPR request — had to be done in a SQL client. This
 * module makes those first-class and, crucially, audited: every mutation writes
 * an `admin_*` row naming the actor, which a direct UPDATE never did.
 *
 * Three guards exist because an admin console's worst failure mode is locking
 * out its own operators:
 *   - the last remaining admin cannot be demoted, suspended or deleted;
 *   - an account listed in ADMIN_EMAILS cannot be suspended or deleted at all,
 *     since that is the bootstrap identity the console itself signs in with;
 *   - the acting admin cannot delete or demote themselves.
 */

import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { env } from "../env";

import {
  adminAudit,
  adminRoute,
  actorOf,
  badRequest,
  conflict,
  notFound,
  nullableStr,
  optBool,
  optEmail,
  optEnum,
  optInt,
  optStr,
  pageMeta,
  parseDateRange,
  parseIds,
  parsePaging,
  parseSort,
  reqStr,
  sendCsv,
  sortOn,
  sortOnCount,
  type SortMap,
} from "./shared";
import { allowedPlanKeys, assertPlanKey, resolveEntitlements } from "./planCatalog";

const router = Router();

const ROLES = ["user", "admin"] as const;
const STATUSES = ["active", "suspended"] as const;

/** Minimum length for an operator-set password. Matches the signup rule. */
const MIN_PASSWORD_LENGTH = 8;

const SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  updatedAt: sortOn("updatedAt"),
  email: sortOn("email"),
  name: sortOn("name"),
  plan: sortOn("plan"),
  role: sortOn("role"),
  status: sortOn("status"),
  leadsUsed: sortOn("leadsUsed"),
  lastLoginAt: sortOn("lastLoginAt"),
  emailVerified: sortOn("emailVerified"),
  leadLists: sortOnCount("leadLists"),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Emails the console itself authenticates with. Never suspendable/deletable. */
function isBootstrapAdmin(email: string): boolean {
  return env.adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

/**
 * Refuses a change that would leave the platform with no administrator.
 *
 * Counted with a query rather than tracked in memory because two operators can
 * be demoting each other at the same moment, and the count is cheap.
 */
async function assertNotLastAdmin(userIds: string[], what: string): Promise<void> {
  const affectedAdmins = await prisma.user.count({ where: { id: { in: userIds }, role: "admin" } });
  if (affectedAdmins === 0) return;
  const totalAdmins = await prisma.user.count({ where: { role: "admin" } });
  if (totalAdmins - affectedAdmins <= 0) {
    throw conflict(
      `Refusing to ${what}: that would leave the platform with no administrator. ` +
        `Promote another user to admin first.`
    );
  }
}

/** Refuses an action aimed at the acting admin's own account. */
function assertNotSelf(req: Request, userIds: string[], what: string): void {
  const actor = actorOf(req);
  if (actor.id && userIds.includes(actor.id)) {
    throw conflict(`You cannot ${what} your own account from this console.`);
  }
}

async function assertNotBootstrap(userIds: string[], what: string): Promise<void> {
  if (!env.adminEmails.length) return;
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true },
  });
  const blocked = rows.filter((r) => isBootstrapAdmin(r.email)).map((r) => r.email);
  if (blocked.length) {
    throw conflict(
      `Refusing to ${what} ${blocked.join(", ")}: that address is configured in ADMIN_EMAILS and is how ` +
        `this console signs in. Change ADMIN_EMAILS first if that is really the intent.`
    );
  }
}

const now = () => new Date();

function currentPeriodKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Shapes a user row for the table, including derived operational state.
 *
 * Async because the lead limit shown here must be the one actually enforced,
 * which comes from the operator-editable plan catalogue rather than the
 * compiled defaults. The lookup is served from a short-lived cache.
 */
async function toRow(u: any, revenueByUser: Map<string, number>) {
  const entitlements = await resolveEntitlements(u.plan);
  const limit = entitlements.monthlyLeadLimit;
  const locked = !!u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
  const activeSub = (u.subscriptions || [])[0] || null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan,
    status: u.status,
    emailVerified: u.emailVerified,
    phone: u.phone,
    phoneVerified: u.phoneVerified,
    leadsUsed: u.leadsUsed,
    usagePeriod: u.usagePeriod,
    // Surfaced so the table can show a usage bar without the client needing to
    // know the entitlement table. -1 means unlimited.
    leadLimit: Number.isFinite(limit) ? limit : -1,
    usagePercent: Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.round((u.leadsUsed / limit) * 100)) : 0,
    locked,
    lockedUntil: u.lockedUntil,
    failedLoginAttempts: u.failedLoginAttempts,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    counts: {
      leadLists: u._count?.leadLists ?? 0,
      campaigns: u._count?.campaigns ?? 0,
      tenants: u._count?.memberships ?? 0,
      integrations: u._count?.integrations ?? 0,
    },
    subscription: activeSub
      ? {
          id: activeSub.id,
          planKey: activeSub.planKey,
          status: activeSub.status,
          billingCycle: activeSub.billingCycle,
          amount: activeSub.amount,
          currency: activeSub.currency,
          currentPeriodEnd: activeSub.currentPeriodEnd,
          cancelAtPeriodEnd: activeSub.cancelAtPeriodEnd,
        }
      : null,
    /** Lifetime collected from this account, in minor units. */
    revenue: revenueByUser.get(u.id) ?? 0,
  };
}

/** Builds the `where` clause shared by the list and export endpoints. */
async function buildWhere(req: Request): Promise<Record<string, unknown>> {
  const search = optStr(req.query.search);
  const plan = optStr(req.query.plan);
  const role = optEnum(req.query.role, "Role", ROLES);
  const status = optEnum(req.query.status, "Status", STATUSES);
  const verified = optBool(req.query.verified);
  const locked = optBool(req.query.locked);

  const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };

  if (search) {
    where.OR = [
      { email: { contains: search } },
      { name: { contains: search } },
      { phone: { contains: search } },
      { id: search },
    ];
  }
  if (plan) {
    // Validated against the catalogue so a typo returns an error rather than an
    // empty table the operator reads as "no such users".
    where.plan = await assertPlanKey(plan, "Plan filter");
  }
  if (role) where.role = role;
  if (status) where.status = status;
  if (verified !== undefined) where.emailVerified = verified;
  if (locked !== undefined) {
    where.lockedUntil = locked ? { gt: new Date() } : { not: { gt: new Date() } };
  }
  return where;
}

/** Lifetime collected per user, for the ids on the current page only. */
async function revenueFor(userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await prisma.payment.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, status: { in: ["succeeded", "partially_refunded"] } },
    _sum: { amount: true, refundedAmount: true },
  });
  return new Map(
    rows.map((r) => [
      String(r.userId),
      Math.max(0, (r._sum.amount || 0) - (r._sum.refundedAmount || 0)),
    ])
  );
}

const LIST_INCLUDE = {
  _count: { select: { leadLists: true, campaigns: true, memberships: true, integrations: true } },
  subscriptions: {
    where: { status: { in: ["trialing", "active", "past_due"] } },
    orderBy: { currentPeriodEnd: "desc" as const },
    take: 1,
  },
};

// ── List ─────────────────────────────────────────────────────────────────────

router.get(
  "/",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const where = await buildWhere(req);
    const orderBy = parseSort(req, SORTS, "createdAt") as any;

    const [total, users, facets] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy, skip: paging.skip, take: paging.take, include: LIST_INCLUDE }),
      // Counts for the filter chips, over the unfiltered table, so the operator
      // can see what else is there rather than only what survived the filter.
      Promise.all([
        prisma.user.groupBy({ by: ["plan"], _count: { id: true } }),
        prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
        prisma.user.groupBy({ by: ["status"], _count: { id: true } }),
      ]),
    ]);

    const revenue = await revenueFor(users.map((u) => u.id));
    const [planFacet, roleFacet, statusFacet] = facets;

    res.json({
      rows: await Promise.all(users.map((u) => toRow(u, revenue))),
      ...pageMeta(total, paging),
      facets: {
        plan: Object.fromEntries(planFacet.map((p) => [p.plan, p._count.id])),
        role: Object.fromEntries(roleFacet.map((p) => [p.role, p._count.id])),
        status: Object.fromEntries(statusFacet.map((p) => [p.status, p._count.id])),
      },
      options: { plans: await allowedPlanKeys(), roles: [...ROLES], statuses: [...STATUSES] },
    });
  })
);

// Declared before "/:id" so the literal path is not captured as an id.
router.get(
  "/export",
  adminRoute(async (req, res) => {
    const where = await buildWhere(req);
    const orderBy = parseSort(req, SORTS, "createdAt") as any;
    // Bounded: an export is still a query, and "every user" on a large table
    // should not be a single unpaged read.
    const users = await prisma.user.findMany({ where, orderBy, take: 10_000, include: LIST_INCLUDE });
    const revenue = await revenueFor(users.map((u) => u.id));
    const rows = await Promise.all(users.map((u) => toRow(u, revenue)));

    await adminAudit(req, "admin_exported_users", { count: rows.length });

    sendCsv(res, `users-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { header: "ID", value: (r) => r.id },
      { header: "Email", value: (r) => r.email },
      { header: "Name", value: (r) => r.name },
      { header: "Role", value: (r) => r.role },
      { header: "Plan", value: (r) => r.plan },
      { header: "Status", value: (r) => r.status },
      { header: "Email Verified", value: (r) => (r.emailVerified ? "yes" : "no") },
      { header: "Phone", value: (r) => r.phone },
      { header: "Phone Verified", value: (r) => (r.phoneVerified ? "yes" : "no") },
      { header: "Leads Used", value: (r) => r.leadsUsed },
      { header: "Lead Limit", value: (r) => (r.leadLimit < 0 ? "unlimited" : r.leadLimit) },
      { header: "Usage Period", value: (r) => r.usagePeriod },
      { header: "Lead Lists", value: (r) => r.counts.leadLists },
      { header: "Campaigns", value: (r) => r.counts.campaigns },
      { header: "Workspaces", value: (r) => r.counts.tenants },
      { header: "Subscription", value: (r) => r.subscription?.status ?? "" },
      { header: "Subscription Plan", value: (r) => r.subscription?.planKey ?? "" },
      { header: "Lifetime Revenue (minor units)", value: (r) => r.revenue },
      { header: "Locked", value: (r) => (r.locked ? "yes" : "no") },
      { header: "Last Login", value: (r) => r.lastLoginAt },
      { header: "Joined", value: (r) => r.createdAt },
    ]);
  })
);

// ── Detail ───────────────────────────────────────────────────────────────────

router.get(
  "/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);

    const user = await prisma.user.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!user) throw notFound("No user with that id.");

    const [subscriptions, invoices, payments, auditLogs, memberships, integrations, leadStats] =
      await Promise.all([
        prisma.subscription.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
        prisma.invoice.findMany({ where: { userId: id }, orderBy: { issuedAt: "desc" }, take: 25 }),
        prisma.payment.findMany({ where: { userId: id }, orderBy: { paidAt: "desc" }, take: 25 }),
        prisma.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
        prisma.tenantMember.findMany({
          where: { userId: id },
          include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
        }),
        prisma.userIntegration.findMany({
          where: { userId: id },
          // Never return credential columns to a browser, even an admin's.
          select: { id: true, type: true, enabled: true, createdAt: true, updatedAt: true },
        }),
        prisma.leadList.aggregate({ where: { userId: id }, _count: { id: true } }),
      ]);

    const leadCount = await prisma.lead.count({ where: { userId: id } });
    const revenue = await revenueFor([id]);

    res.json({
      user: await toRow(user, revenue),
      subscriptions,
      invoices,
      payments,
      auditLogs,
      memberships: memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
        tenant: m.tenant,
      })),
      integrations,
      activity: { leadLists: leadStats._count.id, leads: leadCount },
      options: { plans: await allowedPlanKeys(), roles: [...ROLES], statuses: [...STATUSES] },
    });
  })
);

// ── Create ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const email = optEmail(body.email);
    if (!email) throw badRequest("A valid email address is required.");

    const password = String(body.password || "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict("An account with that email already exists.");

    const plan = body.plan === undefined ? "free" : await assertPlanKey(body.plan);
    const role = optEnum(body.role, "Role", ROLES) ?? "user";
    const status = optEnum(body.status, "Status", STATUSES) ?? "active";

    const user = await prisma.user.create({
      data: {
        email,
        name: nullableStr(body.name, "Name", 120) ?? null,
        passwordHash: await bcrypt.hash(password, 12),
        // Operator-created accounts are verified by default: the operator is
        // the verification, and leaving it false means the person cannot sign in
        // until an OTP they never asked for arrives.
        emailVerified: optBool(body.emailVerified) ?? true,
        role,
        plan,
        status,
        phone: nullableStr(body.phone, "Phone", 32) ?? null,
      },
    });

    await adminAudit(req, "admin_created_user", { targetUserId: user.id, email, plan, role, status });
    res.status(201).json({
      success: true,
      user: await toRow({ ...user, _count: {}, subscriptions: [] }, new Map()),
    });
  })
);

// ── Update ───────────────────────────────────────────────────────────────────

router.patch(
  "/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);
    const body = req.body || {};

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound("No user with that id.");

    const data: Record<string, unknown> = {};

    if (body.email !== undefined) {
      const email = optEmail(body.email);
      if (!email) throw badRequest("A valid email address is required.");
      if (email !== target.email) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) throw conflict("Another account already uses that email.");
        data.email = email;
        // A changed address has not been proven; forcing re-verification stops
        // an operator typo from silently locking someone out of password reset.
        if (optBool(body.emailVerified) === undefined) data.emailVerified = false;
      }
    }
    if (body.name !== undefined) data.name = nullableStr(body.name, "Name", 120);
    if (body.phone !== undefined) data.phone = nullableStr(body.phone, "Phone", 32);
    if (body.plan !== undefined) data.plan = await assertPlanKey(body.plan);
    if (body.emailVerified !== undefined) data.emailVerified = optBool(body.emailVerified);
    if (body.phoneVerified !== undefined) data.phoneVerified = optBool(body.phoneVerified);
    if (body.leadsUsed !== undefined) {
      data.leadsUsed = optInt(body.leadsUsed, "Leads used", 0, 10_000_000);
      data.usagePeriod = target.usagePeriod ?? currentPeriodKey();
    }

    if (body.role !== undefined) {
      const role = optEnum(body.role, "Role", ROLES)!;
      if (role !== "admin" && target.role === "admin") {
        assertNotSelf(req, [id], "remove admin from");
        await assertNotLastAdmin([id], "demote that administrator");
      }
      data.role = role;
    }

    if (body.status !== undefined) {
      const status = optEnum(body.status, "Status", STATUSES)!;
      if (status === "suspended") {
        assertNotSelf(req, [id], "suspend");
        await assertNotBootstrap([id], "suspend");
        await assertNotLastAdmin([id], "suspend that administrator");
      }
      data.status = status;
    }

    // Explicit lock control. `lockedUntil` is normally written by the
    // brute-force counter; the console needs to be able to clear it, because the
    // alternative is telling a customer to wait out a timer.
    if (body.locked !== undefined) {
      const locked = optBool(body.locked);
      if (locked === false) {
        data.lockedUntil = null;
        data.failedLoginAttempts = 0;
      } else if (locked === true) {
        data.lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
      }
    }

    if (Object.keys(data).length === 0) throw badRequest("Nothing to update.");

    const updated = await prisma.user.update({ where: { id }, data, include: LIST_INCLUDE });
    await adminAudit(req, "admin_updated_user", { targetUserId: id, changed: Object.keys(data) });

    res.json({ success: true, user: await toRow(updated, await revenueFor([id])) });
  })
);

// ── Password reset ───────────────────────────────────────────────────────────

router.post(
  "/:id/password",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);
    const password = String((req.body || {}).password || "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) throw notFound("No user with that id.");

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        // A reset is also the remedy for a lockout, so clear it in the same write.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // The password itself is never audited, only the fact of the reset.
    await adminAudit(req, "admin_reset_user_password", { targetUserId: id, email: target.email });
    res.json({ success: true });
  })
);

router.post(
  "/:id/unlock",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);
    const updated = await prisma.user
      .update({ where: { id }, data: { lockedUntil: null, failedLoginAttempts: 0 }, include: LIST_INCLUDE })
      .catch(() => null);
    if (!updated) throw notFound("No user with that id.");
    await adminAudit(req, "admin_unlocked_user", { targetUserId: id });
    res.json({ success: true, user: await toRow(updated, await revenueFor([id])) });
  })
);

// ── Delete ───────────────────────────────────────────────────────────────────

router.delete(
  "/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!target) throw notFound("No user with that id.");

    assertNotSelf(req, [id], "delete");
    await assertNotBootstrap([id], "delete");
    await assertNotLastAdmin([id], "delete that administrator");

    // Invoices and payments deliberately survive via SetNull: the financial
    // record of a deleted account still has to exist.
    await prisma.user.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_user", { targetUserId: id, email: target.email });
    res.json({ success: true, id });
  })
);

// ── Bulk actions ─────────────────────────────────────────────────────────────

const BULK_ACTIONS = [
  "verify",
  "unverify",
  "suspend",
  "activate",
  "unlock",
  "set-plan",
  "set-role",
  "reset-usage",
  "delete",
] as const;

router.post(
  "/bulk",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const ids = parseIds(body);
    const action = optEnum(body.action, "Action", BULK_ACTIONS);
    if (!action) throw badRequest(`Action must be one of: ${BULK_ACTIONS.join(", ")}.`);

    let affected = 0;
    const detail: Record<string, unknown> = { action, requested: ids.length };

    switch (action) {
      case "verify":
      case "unverify": {
        const result = await prisma.user.updateMany({
          where: { id: { in: ids } },
          data: { emailVerified: action === "verify" },
        });
        affected = result.count;
        break;
      }

      case "suspend": {
        assertNotSelf(req, ids, "suspend");
        await assertNotBootstrap(ids, "suspend");
        await assertNotLastAdmin(ids, "suspend those administrators");
        const result = await prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: "suspended" } });
        affected = result.count;
        break;
      }

      case "activate": {
        const result = await prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: "active" } });
        affected = result.count;
        break;
      }

      case "unlock": {
        const result = await prisma.user.updateMany({
          where: { id: { in: ids } },
          data: { lockedUntil: null, failedLoginAttempts: 0 },
        });
        affected = result.count;
        break;
      }

      case "set-plan": {
        const plan = await assertPlanKey(body.plan);
        const result = await prisma.user.updateMany({ where: { id: { in: ids } }, data: { plan } });
        affected = result.count;
        detail.plan = plan;
        break;
      }

      case "set-role": {
        const role = optEnum(body.role, "Role", ROLES);
        if (!role) throw badRequest(`Role must be one of: ${ROLES.join(", ")}.`);
        if (role !== "admin") {
          assertNotSelf(req, ids, "remove admin from");
          await assertNotLastAdmin(ids, "demote those administrators");
        }
        const result = await prisma.user.updateMany({ where: { id: { in: ids } }, data: { role } });
        affected = result.count;
        detail.role = role;
        break;
      }

      case "reset-usage": {
        const result = await prisma.user.updateMany({
          where: { id: { in: ids } },
          data: { leadsUsed: 0, usagePeriod: currentPeriodKey() },
        });
        affected = result.count;
        break;
      }

      case "delete": {
        assertNotSelf(req, ids, "delete");
        await assertNotBootstrap(ids, "delete");
        await assertNotLastAdmin(ids, "delete those administrators");
        const result = await prisma.user.deleteMany({ where: { id: { in: ids } } });
        affected = result.count;
        break;
      }
    }

    await adminAudit(req, `admin_bulk_users_${action.replace(/-/g, "_")}`, { ...detail, affected, ids });
    res.json({ success: true, action, affected, requested: ids.length });
  })
);

// ── Impersonation-adjacent read: what this user is entitled to ───────────────

/**
 * The entitlement snapshot the application would compute for this account.
 *
 * Exposed because "the customer says WhatsApp is locked" is a support ticket,
 * and the answer lives in a function the operator otherwise cannot call.
 */
router.get(
  "/:id/entitlements",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "User id", 64);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, plan: true, role: true, leadsUsed: true, usagePeriod: true, status: true },
    });
    if (!user) throw notFound("No user with that id.");

    const entitlements = await resolveEntitlements(user.plan);
    const limit = entitlements.monthlyLeadLimit;
    res.json({
      userId: user.id,
      plan: user.plan,
      status: user.status,
      entitlements: {
        ...entitlements,
        // JSON cannot carry Infinity; -1 is the wire representation.
        monthlyLeadLimit: Number.isFinite(limit) ? limit : -1,
      },
      usage: {
        leadsUsed: user.leadsUsed,
        usagePeriod: user.usagePeriod,
        currentPeriod: currentPeriodKey(now()),
        remaining: Number.isFinite(limit) ? Math.max(0, limit - user.leadsUsed) : -1,
      },
    });
  })
);

export default router;
