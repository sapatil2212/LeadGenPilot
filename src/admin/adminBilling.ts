/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Billing administration: plans, subscriptions, invoices, payments, revenue.
 *
 * Mounted at /api/admin/billing behind requireAdmin.
 *
 * Invariants this module is responsible for, because nothing else can be:
 *
 *  1. `users.plan` and the customer's live subscription agree. The plan column
 *     is what src/entitlements.ts enforces against; a subscription that says
 *     "pro" while the column says "free" is a paying customer with a locked
 *     product. Every write that changes one changes the other.
 *  2. An invoice's `amountPaid` and `status` are derived from its payments, not
 *     typed in. `recalcInvoice` is the only thing that sets them, so a refund
 *     cannot leave a paid invoice that nobody paid.
 *  3. Money arithmetic is integer-only, in minor units. Rates are applied with
 *     `Math.round` at exactly one place per invoice.
 */

import { Router, type Request } from "express";
import { prisma } from "../prisma";
import {
  adminAudit,
  adminRoute,
  badRequest,
  conflict,
  deltaPercent,
  monthEnd,
  monthKeys,
  monthStart,
  notFound,
  nullableStr,
  num,
  optBool,
  optDate,
  optEnum,
  optInt,
  optMoney,
  optStr,
  pageMeta,
  parseDateRange,
  parseIds,
  parsePaging,
  parseSort,
  reqDate,
  reqStr,
  sendCsv,
  sortOn,
  sortOnRelation,
  toInt,
  type SortMap,
} from "./shared";
import {
  PLAN_FEATURE_KEYS,
  allowedPlanKeys,
  assertPlanKey,
  ensurePlansSeeded,
  parsePlanFeatures,
} from "./planCatalog";

const router = Router();

// ── Vocabulary ───────────────────────────────────────────────────────────────

const SUB_STATUSES = ["trialing", "active", "past_due", "paused", "canceled", "expired"] as const;
const BILLING_CYCLES = ["monthly", "yearly", "lifetime"] as const;
const INVOICE_STATUSES = ["draft", "open", "paid", "partially_paid", "void", "uncollectible", "refunded"] as const;
const PAYMENT_STATUSES = ["succeeded", "pending", "failed", "refunded", "partially_refunded"] as const;
const PAYMENT_METHODS = [
  "card",
  "upi",
  "netbanking",
  "bank_transfer",
  "paypal",
  "wallet",
  "cheque",
  "manual",
] as const;
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] as const;

/** Statuses that grant product access and count toward recurring revenue. */
const LIVE_SUB_STATUSES = ["trialing", "active", "past_due"] as const;
/** Invoice statuses that represent money still owed. */
const OWED_INVOICE_STATUSES = ["open", "partially_paid"] as const;

const USER_SELECT = { select: { id: true, email: true, name: true, plan: true, status: true } };

// ── Money helpers ────────────────────────────────────────────────────────────

/**
 * Normalises a subscription to monthly recurring revenue, in minor units.
 *
 * Lifetime deals contribute 0: they are cash, not recurring revenue, and
 * counting them in MRR is the most common way a SaaS dashboard overstates it.
 */
function monthlyValue(sub: { amount: number; billingCycle: string; status: string }): number {
  if (!LIVE_SUB_STATUSES.includes(sub.status as any)) return 0;
  if (sub.billingCycle === "yearly") return Math.round(sub.amount / 12);
  if (sub.billingCycle === "lifetime") return 0;
  return sub.amount;
}

interface LineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

/**
 * Validates and normalises invoice line items.
 *
 * Each line's `amount` is recomputed from quantity × unitAmount rather than
 * trusted, so a client cannot submit a line that reads "1 × ₹100" and totals
 * ₹10,000.
 */
function parseLineItems(raw: unknown): LineItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("Line items must be a list.");
  if (raw.length > 100) throw badRequest("An invoice cannot have more than 100 line items.");
  return raw.map((item, index) => {
    const description = reqStr((item as any)?.description, `Line ${index + 1} description`, 300);
    const quantity = optInt((item as any)?.quantity, `Line ${index + 1} quantity`, 1, 100_000) ?? 1;
    const unitAmount = optMoney((item as any)?.unitAmount, `Line ${index + 1} unit amount`) ?? 0;
    return { description, quantity, unitAmount, amount: quantity * unitAmount };
  });
}

interface Totals {
  subtotal: number;
  discount: number;
  taxPercent: number;
  tax: number;
  total: number;
}

/**
 * The one place invoice arithmetic happens.
 *
 * `taxPercent` is in hundredths of a percent (1800 = 18%), so the divisor is
 * 1,000,000: percent → fraction (÷100) and hundredths → percent (÷100).
 */
function computeTotals(lineItems: LineItem[], explicitSubtotal: number | undefined, discount: number, taxPercent: number): Totals {
  const subtotal = lineItems.length
    ? lineItems.reduce((sum, item) => sum + item.amount, 0)
    : (explicitSubtotal ?? 0);
  const cappedDiscount = Math.min(discount, subtotal);
  const taxable = subtotal - cappedDiscount;
  const tax = Math.round((taxable * taxPercent) / 1_000_000);
  return { subtotal, discount: cappedDiscount, taxPercent, tax, total: taxable + tax };
}

/**
 * Mints the next invoice number for the current year.
 *
 * Racy by nature — two concurrent creates can read the same count — so the
 * caller retries on the unique-constraint violation rather than pretending a
 * `count()` is a sequence.
 */
async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const latest = await prisma.invoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = latest ? toInt(latest.number.slice(prefix.length), 0) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

/**
 * Recomputes an invoice's paid amount and status from its payments.
 *
 * Derived rather than stored-by-hand: the alternative is every payment, refund
 * and deletion remembering to adjust two columns, and the first one that forgets
 * leaves an invoice permanently wrong.
 */
async function recalcInvoice(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;
  // Void and uncollectible are operator judgements about collectability, not
  // functions of the payments, so they are left alone.
  if (invoice.status === "void" || invoice.status === "uncollectible") return;

  const payments = await prisma.payment.findMany({
    where: { invoiceId, status: { in: ["succeeded", "partially_refunded", "refunded"] } },
    select: { amount: true, refundedAmount: true, status: true, paidAt: true },
  });

  const netPaid = payments.reduce(
    (sum, p) => sum + (p.status === "refunded" ? 0 : p.amount - p.refundedAmount),
    0
  );
  const gross = payments.reduce((sum, p) => sum + p.amount, 0);
  const refunded = payments.reduce((sum, p) => sum + (p.status === "refunded" ? p.amount : p.refundedAmount), 0);

  let status: string;
  if (netPaid <= 0 && refunded > 0 && gross > 0) status = "refunded";
  else if (netPaid >= invoice.total && invoice.total > 0) status = "paid";
  else if (netPaid > 0) status = "partially_paid";
  else status = invoice.status === "draft" ? "draft" : "open";

  const paidAt =
    status === "paid"
      ? payments.reduce<Date | null>((latest, p) => (!latest || p.paidAt > latest ? p.paidAt : latest), null)
      : null;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: Math.max(0, netPaid), status, paidAt },
  });
}

/**
 * Keeps `users.plan` aligned with the customer's best live subscription.
 *
 * "Best" = the live one ending furthest out. When nothing is live the account
 * falls back to "free" rather than keeping a paid grant it no longer pays for,
 * which is the whole point of doing this on every write.
 */
async function syncUserPlan(userId: string): Promise<string> {
  const live = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE_SUB_STATUSES] } },
    orderBy: { currentPeriodEnd: "desc" },
    select: { planKey: true },
  });
  const plan = live?.planKey ?? "free";
  await prisma.user.update({ where: { id: userId }, data: { plan } }).catch(() => null);
  return plan;
}

/** Advances a period start by one billing cycle. */
function addCycle(from: Date, cycle: string): Date {
  const next = new Date(from.getTime());
  if (cycle === "yearly") next.setFullYear(next.getFullYear() + 1);
  else if (cycle === "lifetime") next.setFullYear(next.getFullYear() + 100);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANS
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/plans",
  adminRoute(async (_req, res) => {
    await ensurePlansSeeded();
    const plans = await prisma.planDefinition.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

    const [subCounts, userCounts] = await Promise.all([
      prisma.subscription.groupBy({
        by: ["planKey"],
        where: { status: { in: [...LIVE_SUB_STATUSES] } },
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.user.groupBy({ by: ["plan"], _count: { id: true } }),
    ]);

    const subByPlan = new Map(subCounts.map((s) => [s.planKey, s]));
    const usersByPlan = new Map(userCounts.map((u) => [u.plan, u._count.id]));

    res.json({
      rows: plans.map((p) => ({
        ...p,
        features: parsePlanFeatures(p.features),
        activeSubscriptions: subByPlan.get(p.key)?._count.id ?? 0,
        subscriptionValue: subByPlan.get(p.key)?._sum.amount ?? 0,
        usersOnPlan: usersByPlan.get(p.key) ?? 0,
      })),
      options: { featureKeys: [...PLAN_FEATURE_KEYS], currencies: [...CURRENCIES] },
    });
  })
);

router.post(
  "/plans",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const key = reqStr(body.key, "Plan key", 40).toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
      throw badRequest("Plan key must start with a letter and contain only lowercase letters, numbers, - or _.");
    }
    const existing = await prisma.planDefinition.findUnique({ where: { key } });
    if (existing) throw conflict(`A plan with the key "${key}" already exists.`);

    const plan = await prisma.planDefinition.create({
      data: {
        key,
        name: reqStr(body.name, "Plan name", 80),
        description: nullableStr(body.description, "Description", 1000) ?? null,
        priceMonthly: optMoney(body.priceMonthly, "Monthly price") ?? 0,
        priceYearly: optMoney(body.priceYearly, "Yearly price") ?? 0,
        currency: optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase() ?? "INR",
        monthlyLeadLimit: optInt(body.monthlyLeadLimit, "Monthly lead limit", -1, 10_000_000) ?? 100,
        seats: optInt(body.seats, "Seats", -1, 10_000) ?? 1,
        trialDays: optInt(body.trialDays, "Trial days", 0, 365) ?? 0,
        features: JSON.stringify(parseFeatureList(body.features)),
        highlight: optBool(body.highlight) ?? false,
        isActive: optBool(body.isActive) ?? true,
        isPublic: optBool(body.isPublic) ?? true,
        sortOrder: optInt(body.sortOrder, "Sort order", 0, 999) ?? 0,
      },
    });

    await adminAudit(req, "admin_created_plan", { planId: plan.id, key });
    res.status(201).json({ success: true, plan: { ...plan, features: parsePlanFeatures(plan.features) } });
  })
);

function parseFeatureList(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const cleaned = list.map((f) => String(f).trim()).filter(Boolean);
  const unknown = cleaned.filter((f) => !PLAN_FEATURE_KEYS.includes(f as any));
  if (unknown.length) {
    throw badRequest(`Unknown feature key(s): ${unknown.join(", ")}. Valid keys: ${PLAN_FEATURE_KEYS.join(", ")}.`);
  }
  return [...new Set(cleaned)];
}

router.patch(
  "/plans/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Plan id", 64);
    const body = req.body || {};
    const existing = await prisma.planDefinition.findUnique({ where: { id } });
    if (!existing) throw notFound("No plan with that id.");

    // `key` is intentionally not editable: subscriptions and users.plan reference
    // it by value, so renaming it would orphan every subscriber at once.
    if (body.key !== undefined && String(body.key).toLowerCase() !== existing.key) {
      throw badRequest(
        "A plan key cannot be changed after creation — subscriptions reference it. " +
          "Create a new plan and migrate subscribers instead."
      );
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = reqStr(body.name, "Plan name", 80);
    if (body.description !== undefined) data.description = nullableStr(body.description, "Description", 1000);
    if (body.priceMonthly !== undefined) data.priceMonthly = optMoney(body.priceMonthly, "Monthly price");
    if (body.priceYearly !== undefined) data.priceYearly = optMoney(body.priceYearly, "Yearly price");
    if (body.currency !== undefined) data.currency = optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase();
    if (body.monthlyLeadLimit !== undefined) data.monthlyLeadLimit = optInt(body.monthlyLeadLimit, "Monthly lead limit", -1, 10_000_000);
    if (body.seats !== undefined) data.seats = optInt(body.seats, "Seats", -1, 10_000);
    if (body.trialDays !== undefined) data.trialDays = optInt(body.trialDays, "Trial days", 0, 365);
    if (body.features !== undefined) data.features = JSON.stringify(parseFeatureList(body.features));
    if (body.highlight !== undefined) data.highlight = optBool(body.highlight);
    if (body.isActive !== undefined) data.isActive = optBool(body.isActive);
    if (body.isPublic !== undefined) data.isPublic = optBool(body.isPublic);
    if (body.sortOrder !== undefined) data.sortOrder = optInt(body.sortOrder, "Sort order", 0, 999);

    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    const plan = await prisma.planDefinition.update({ where: { id }, data });
    await adminAudit(req, "admin_updated_plan", { planId: id, key: plan.key, changed: Object.keys(data) });
    res.json({ success: true, plan: { ...plan, features: parsePlanFeatures(plan.features) } });
  })
);

router.delete(
  "/plans/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Plan id", 64);
    const plan = await prisma.planDefinition.findUnique({ where: { id } });
    if (!plan) throw notFound("No plan with that id.");

    const [subscribers, usersOnPlan] = await Promise.all([
      prisma.subscription.count({ where: { planKey: plan.key, status: { in: [...LIVE_SUB_STATUSES] } } }),
      prisma.user.count({ where: { plan: plan.key } }),
    ]);

    // Deleting a plan people are on would leave their `users.plan` pointing at
    // nothing. Deactivating hides it from new sign-ups and keeps them billable.
    if (subscribers > 0 || usersOnPlan > 0) {
      throw conflict(
        `"${plan.name}" still has ${subscribers} live subscription(s) and ${usersOnPlan} account(s) on it. ` +
          `Set it inactive instead of deleting, or move those accounts to another plan first.`
      );
    }

    await prisma.planDefinition.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_plan", { planId: id, key: plan.key });
    res.json({ success: true, id });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────

const SUB_SORTS: SortMap = {
  createdAt: sortOn("createdAt"),
  startedAt: sortOn("startedAt"),
  currentPeriodEnd: sortOn("currentPeriodEnd"),
  amount: sortOn("amount"),
  status: sortOn("status"),
  planKey: sortOn("planKey"),
  billingCycle: sortOn("billingCycle"),
  userEmail: sortOnRelation("user", "email"),
};

async function subWhere(req: Request): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = { ...parseDateRange(req, "createdAt") };
  const search = optStr(req.query.search);
  const status = optEnum(req.query.status, "Status", SUB_STATUSES);
  const cycle = optEnum(req.query.billingCycle, "Billing cycle", BILLING_CYCLES);
  const planKey = optStr(req.query.planKey);

  if (search) {
    where.OR = [
      { user: { email: { contains: search } } },
      { user: { name: { contains: search } } },
      { externalRef: { contains: search } },
      { id: search },
    ];
  }
  if (status) where.status = status;
  if (cycle) where.billingCycle = cycle;
  if (planKey) where.planKey = await assertPlanKey(planKey, "Plan filter");
  if (optBool(req.query.expiringSoon)) {
    where.status = { in: [...LIVE_SUB_STATUSES] };
    where.currentPeriodEnd = { lte: new Date(Date.now() + 30 * 86_400_000) };
  }
  return where;
}

function subRow(s: any) {
  return {
    ...s,
    monthlyValue: monthlyValue(s),
    daysRemaining: Math.ceil((new Date(s.currentPeriodEnd).getTime() - Date.now()) / 86_400_000),
    user: s.user ?? null,
    invoiceCount: s._count?.invoices ?? 0,
  };
}

router.get(
  "/subscriptions",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const where = await subWhere(req);
    const orderBy = parseSort(req, SUB_SORTS, "createdAt") as any;

    const [total, rows, statusFacet, cycleFacet, planFacet, aggregate] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.take,
        include: { user: USER_SELECT, _count: { select: { invoices: true } } },
      }),
      prisma.subscription.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.subscription.groupBy({ by: ["billingCycle"], _count: { id: true } }),
      prisma.subscription.groupBy({ by: ["planKey"], _count: { id: true } }),
      prisma.subscription.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
    ]);

    res.json({
      rows: rows.map(subRow),
      ...pageMeta(total, paging),
      summary: { count: aggregate._count.id, amountSum: aggregate._sum.amount ?? 0 },
      facets: {
        status: Object.fromEntries(statusFacet.map((s) => [s.status, s._count.id])),
        billingCycle: Object.fromEntries(cycleFacet.map((s) => [s.billingCycle, s._count.id])),
        planKey: Object.fromEntries(planFacet.map((s) => [s.planKey, s._count.id])),
      },
      options: {
        statuses: [...SUB_STATUSES],
        cycles: [...BILLING_CYCLES],
        plans: await allowedPlanKeys(),
        currencies: [...CURRENCIES],
      },
    });
  })
);

router.get(
  "/subscriptions/export",
  adminRoute(async (req, res) => {
    const where = await subWhere(req);
    const orderBy = parseSort(req, SUB_SORTS, "createdAt") as any;
    const rows = await prisma.subscription.findMany({
      where,
      orderBy,
      take: 10_000,
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });
    await adminAudit(req, "admin_exported_subscriptions", { count: rows.length });
    sendCsv(res, `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(subRow), [
      { header: "ID", value: (r) => r.id },
      { header: "Customer", value: (r) => r.user?.email ?? "" },
      { header: "Name", value: (r) => r.user?.name ?? "" },
      { header: "Plan", value: (r) => r.planKey },
      { header: "Status", value: (r) => r.status },
      { header: "Cycle", value: (r) => r.billingCycle },
      { header: "Amount (minor units)", value: (r) => r.amount },
      { header: "Currency", value: (r) => r.currency },
      { header: "MRR (minor units)", value: (r) => r.monthlyValue },
      { header: "Seats", value: (r) => r.seats },
      { header: "Discount %", value: (r) => r.discountPercent },
      { header: "Started", value: (r) => r.startedAt },
      { header: "Period Start", value: (r) => r.currentPeriodStart },
      { header: "Period End", value: (r) => r.currentPeriodEnd },
      { header: "Trial Ends", value: (r) => r.trialEndsAt },
      { header: "Cancel At Period End", value: (r) => (r.cancelAtPeriodEnd ? "yes" : "no") },
      { header: "Canceled At", value: (r) => r.canceledAt },
      { header: "Invoices", value: (r) => r.invoiceCount },
      { header: "External Ref", value: (r) => r.externalRef },
    ]);
  })
);

router.get(
  "/subscriptions/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: {
        user: USER_SELECT,
        tenant: { select: { id: true, name: true, slug: true } },
        invoices: { orderBy: { issuedAt: "desc" }, take: 50 },
        _count: { select: { invoices: true } },
      },
    });
    if (!sub) throw notFound("No subscription with that id.");
    res.json({ subscription: subRow(sub), invoices: sub.invoices });
  })
);

router.post(
  "/subscriptions",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const userId = reqStr(body.userId, "Customer", 64);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw badRequest("No user with that id — pick a customer from the list.");

    const planKey = await assertPlanKey(body.planKey);
    const billingCycle = optEnum(body.billingCycle, "Billing cycle", BILLING_CYCLES) ?? "monthly";
    const status = optEnum(body.status, "Status", SUB_STATUSES) ?? "active";

    // Default the price from the catalogue so the common case needs no amount,
    // but let the operator override it for a negotiated deal.
    const plan = await prisma.planDefinition.findUnique({ where: { key: planKey } });
    const catalogAmount = billingCycle === "yearly" ? plan?.priceYearly ?? 0 : plan?.priceMonthly ?? 0;
    const amount = optMoney(body.amount, "Amount") ?? catalogAmount;
    const discountPercent = optInt(body.discountPercent, "Discount percent", 0, 100) ?? 0;

    const periodStart = (optDate(body.currentPeriodStart, "Period start") as Date | null) ?? new Date();
    const periodEnd =
      (optDate(body.currentPeriodEnd, "Period end") as Date | null) ?? addCycle(periodStart, billingCycle);
    if (periodEnd <= periodStart) throw badRequest("The period end must be after the period start.");

    let tenantId = optStr(body.tenantId) ?? null;
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) throw badRequest("No workspace with that id.");
    }

    const trialEndsAt =
      (optDate(body.trialEndsAt, "Trial ends") as Date | null) ??
      (status === "trialing" && plan?.trialDays
        ? new Date(periodStart.getTime() + plan.trialDays * 86_400_000)
        : null);

    const sub = await prisma.subscription.create({
      data: {
        userId,
        tenantId,
        planKey,
        status,
        billingCycle,
        amount: discountPercent ? Math.round(amount * (1 - discountPercent / 100)) : amount,
        currency: optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase() ?? plan?.currency ?? "INR",
        seats: optInt(body.seats, "Seats", 1, 10_000) ?? 1,
        discountPercent,
        startedAt: (optDate(body.startedAt, "Started at") as Date | null) ?? periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndsAt,
        cancelAtPeriodEnd: optBool(body.cancelAtPeriodEnd) ?? false,
        externalRef: nullableStr(body.externalRef, "External reference", 190) ?? null,
        notes: nullableStr(body.notes, "Notes", 2000) ?? null,
      },
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });

    const syncedPlan = await syncUserPlan(userId);
    await adminAudit(req, "admin_created_subscription", {
      subscriptionId: sub.id,
      targetUserId: userId,
      email: user.email,
      planKey,
      amount: sub.amount,
      userPlanNowSetTo: syncedPlan,
    });

    res.status(201).json({ success: true, subscription: subRow(sub), userPlan: syncedPlan });
  })
);

router.patch(
  "/subscriptions/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const body = req.body || {};
    const existing = await prisma.subscription.findUnique({ where: { id } });
    if (!existing) throw notFound("No subscription with that id.");

    const data: Record<string, unknown> = {};
    if (body.planKey !== undefined) data.planKey = await assertPlanKey(body.planKey);
    if (body.status !== undefined) {
      const status = optEnum(body.status, "Status", SUB_STATUSES)!;
      data.status = status;
      if (status === "canceled" && !existing.canceledAt) data.canceledAt = new Date();
      if (status !== "canceled") data.canceledAt = null;
    }
    if (body.billingCycle !== undefined) data.billingCycle = optEnum(body.billingCycle, "Billing cycle", BILLING_CYCLES);
    if (body.amount !== undefined) data.amount = optMoney(body.amount, "Amount");
    if (body.currency !== undefined) data.currency = optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase();
    if (body.seats !== undefined) data.seats = optInt(body.seats, "Seats", 1, 10_000);
    if (body.discountPercent !== undefined) data.discountPercent = optInt(body.discountPercent, "Discount percent", 0, 100);
    if (body.startedAt !== undefined) data.startedAt = optDate(body.startedAt, "Started at");
    if (body.currentPeriodStart !== undefined) data.currentPeriodStart = optDate(body.currentPeriodStart, "Period start");
    if (body.currentPeriodEnd !== undefined) data.currentPeriodEnd = optDate(body.currentPeriodEnd, "Period end");
    if (body.trialEndsAt !== undefined) data.trialEndsAt = optDate(body.trialEndsAt, "Trial ends");
    if (body.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = optBool(body.cancelAtPeriodEnd);
    if (body.externalRef !== undefined) data.externalRef = nullableStr(body.externalRef, "External reference", 190);
    if (body.notes !== undefined) data.notes = nullableStr(body.notes, "Notes", 2000);
    if (body.tenantId !== undefined) {
      const tenantId = optStr(body.tenantId) ?? null;
      if (tenantId) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!tenant) throw badRequest("No workspace with that id.");
      }
      data.tenantId = tenantId;
    }

    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    const start = (data.currentPeriodStart as Date) ?? existing.currentPeriodStart;
    const end = (data.currentPeriodEnd as Date) ?? existing.currentPeriodEnd;
    if (end <= start) throw badRequest("The period end must be after the period start.");

    const sub = await prisma.subscription.update({
      where: { id },
      data,
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });

    const syncedPlan = await syncUserPlan(sub.userId);
    await adminAudit(req, "admin_updated_subscription", {
      subscriptionId: id,
      targetUserId: sub.userId,
      changed: Object.keys(data),
      userPlanNowSetTo: syncedPlan,
    });

    res.json({ success: true, subscription: subRow(sub), userPlan: syncedPlan });
  })
);

router.post(
  "/subscriptions/:id/cancel",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const body = req.body || {};
    const immediate = optBool(body.immediate) ?? false;
    const reason = nullableStr(body.reason, "Reason", 1000) ?? null;

    const existing = await prisma.subscription.findUnique({ where: { id } });
    if (!existing) throw notFound("No subscription with that id.");
    if (existing.status === "canceled") throw conflict("That subscription is already canceled.");

    const sub = await prisma.subscription.update({
      where: { id },
      data: immediate
        ? { status: "canceled", canceledAt: new Date(), cancelAtPeriodEnd: false, cancelReason: reason, currentPeriodEnd: new Date() }
        : // Access is retained until the period the customer already paid for
          // ends; only the renewal is stopped.
          { cancelAtPeriodEnd: true, cancelReason: reason },
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });

    const syncedPlan = await syncUserPlan(sub.userId);
    await adminAudit(req, "admin_canceled_subscription", {
      subscriptionId: id,
      targetUserId: sub.userId,
      immediate,
      reason,
      userPlanNowSetTo: syncedPlan,
    });

    res.json({ success: true, subscription: subRow(sub), userPlan: syncedPlan });
  })
);

router.post(
  "/subscriptions/:id/resume",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const existing = await prisma.subscription.findUnique({ where: { id } });
    if (!existing) throw notFound("No subscription with that id.");

    // A subscription whose period has already elapsed needs a fresh period, or
    // it would resume as active-but-expired.
    const expired = existing.currentPeriodEnd <= new Date();
    const periodStart = expired ? new Date() : existing.currentPeriodStart;
    const periodEnd = expired ? addCycle(periodStart, existing.billingCycle) : existing.currentPeriodEnd;

    const sub = await prisma.subscription.update({
      where: { id },
      data: {
        status: "active",
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });

    const syncedPlan = await syncUserPlan(sub.userId);
    await adminAudit(req, "admin_resumed_subscription", { subscriptionId: id, targetUserId: sub.userId, userPlanNowSetTo: syncedPlan });
    res.json({ success: true, subscription: subRow(sub), userPlan: syncedPlan });
  })
);

/**
 * Rolls the subscription into its next period and issues the invoice for it.
 *
 * This is the manual stand-in for a billing processor's renewal webhook. Doing
 * it here means the invoice's period matches the subscription's exactly, which
 * is the part that gets wrong when the two are created separately by hand.
 */
router.post(
  "/subscriptions/:id/renew",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const existing = await prisma.subscription.findUnique({ where: { id }, include: { user: USER_SELECT } });
    if (!existing) throw notFound("No subscription with that id.");
    if (existing.billingCycle === "lifetime") throw conflict("A lifetime subscription does not renew.");
    if (existing.cancelAtPeriodEnd) {
      throw conflict("That subscription is set to end at the period end. Resume it before renewing.");
    }

    const periodStart = existing.currentPeriodEnd > new Date() ? existing.currentPeriodEnd : new Date();
    const periodEnd = addCycle(periodStart, existing.billingCycle);

    const sub = await prisma.subscription.update({
      where: { id },
      data: { status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, trialEndsAt: null },
      include: { user: USER_SELECT, _count: { select: { invoices: true } } },
    });

    const invoice = await createInvoiceRecord({
      userId: sub.userId,
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      status: "open",
      currency: sub.currency,
      lineItems: [
        {
          description: `${sub.planKey} plan — ${sub.billingCycle} (${periodStart.toISOString().slice(0, 10)} to ${periodEnd
            .toISOString()
            .slice(0, 10)})`,
          quantity: sub.seats || 1,
          unitAmount: sub.amount,
          amount: (sub.seats || 1) * sub.amount,
        },
      ],
      discount: 0,
      taxPercent: optInt((req.body || {}).taxPercent, "Tax percent", 0, 10_000) ?? 0,
      issuedAt: new Date(),
      dueAt: new Date(Date.now() + 7 * 86_400_000),
      periodStart,
      periodEnd,
      billingName: existing.user?.name ?? null,
      billingEmail: existing.user?.email ?? null,
      notes: "Auto-generated on subscription renewal.",
    });

    const syncedPlan = await syncUserPlan(sub.userId);
    await adminAudit(req, "admin_renewed_subscription", {
      subscriptionId: id,
      targetUserId: sub.userId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      periodEnd,
    });

    res.json({ success: true, subscription: subRow(sub), invoice, userPlan: syncedPlan });
  })
);

router.delete(
  "/subscriptions/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Subscription id", 64);
    const existing = await prisma.subscription.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!existing) throw notFound("No subscription with that id.");

    await prisma.subscription.delete({ where: { id } });
    const syncedPlan = await syncUserPlan(existing.userId);
    await adminAudit(req, "admin_deleted_subscription", { subscriptionId: id, targetUserId: existing.userId, userPlanNowSetTo: syncedPlan });
    res.json({ success: true, id, userPlan: syncedPlan });
  })
);

const SUB_BULK = ["cancel", "cancel-immediately", "activate", "pause", "mark-past-due", "delete"] as const;

router.post(
  "/subscriptions/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", SUB_BULK);
    if (!action) throw badRequest(`Action must be one of: ${SUB_BULK.join(", ")}.`);

    const affectedUsers = await prisma.subscription.findMany({
      where: { id: { in: ids } },
      select: { userId: true },
    });

    let affected = 0;
    switch (action) {
      case "cancel":
        affected = (await prisma.subscription.updateMany({ where: { id: { in: ids } }, data: { cancelAtPeriodEnd: true } })).count;
        break;
      case "cancel-immediately":
        affected = (
          await prisma.subscription.updateMany({
            where: { id: { in: ids } },
            data: { status: "canceled", canceledAt: new Date(), cancelAtPeriodEnd: false, currentPeriodEnd: new Date() },
          })
        ).count;
        break;
      case "activate":
        affected = (
          await prisma.subscription.updateMany({
            where: { id: { in: ids } },
            data: { status: "active", canceledAt: null, cancelAtPeriodEnd: false },
          })
        ).count;
        break;
      case "pause":
        affected = (await prisma.subscription.updateMany({ where: { id: { in: ids } }, data: { status: "paused" } })).count;
        break;
      case "mark-past-due":
        affected = (await prisma.subscription.updateMany({ where: { id: { in: ids } }, data: { status: "past_due" } })).count;
        break;
      case "delete":
        affected = (await prisma.subscription.deleteMany({ where: { id: { in: ids } } })).count;
        break;
    }

    // Every touched customer's plan column is re-derived, since a bulk status
    // change is exactly the case where the two drift.
    const userIds = [...new Set(affectedUsers.map((s) => s.userId))];
    for (const userId of userIds) await syncUserPlan(userId);

    await adminAudit(req, `admin_bulk_subscriptions_${action.replace(/-/g, "_")}`, { ids, affected, resyncedUsers: userIds.length });
    res.json({ success: true, action, affected, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// INVOICES
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_SORTS: SortMap = {
  issuedAt: sortOn("issuedAt"),
  dueAt: sortOn("dueAt"),
  paidAt: sortOn("paidAt"),
  number: sortOn("number"),
  total: sortOn("total"),
  amountPaid: sortOn("amountPaid"),
  status: sortOn("status"),
  createdAt: sortOn("createdAt"),
  userEmail: sortOnRelation("user", "email"),
};

function invoiceWhere(req: Request): Record<string, unknown> {
  const where: Record<string, unknown> = { ...parseDateRange(req, "issuedAt") };
  const search = optStr(req.query.search);
  const status = optEnum(req.query.status, "Status", INVOICE_STATUSES);
  const userId = optStr(req.query.userId);

  if (search) {
    where.OR = [
      { number: { contains: search } },
      { user: { email: { contains: search } } },
      { billingEmail: { contains: search } },
      { billingName: { contains: search } },
      { id: search },
    ];
  }
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (optBool(req.query.overdue)) {
    where.status = { in: [...OWED_INVOICE_STATUSES] };
    where.dueAt = { lt: new Date() };
  }
  return where;
}

function invoiceRow(inv: any) {
  const owed = Math.max(0, inv.total - inv.amountPaid);
  return {
    ...inv,
    lineItems: safeJsonArray(inv.lineItems),
    amountDue: owed,
    isOverdue: owed > 0 && !!inv.dueAt && new Date(inv.dueAt) < new Date() && inv.status !== "void",
    paymentCount: inv._count?.payments ?? 0,
  };
}

function safeJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Shared create path, used by the route and by subscription renewal. */
async function createInvoiceRecord(input: {
  userId: string | null;
  tenantId: string | null;
  subscriptionId: string | null;
  status: string;
  currency: string;
  lineItems: LineItem[];
  explicitSubtotal?: number;
  discount: number;
  taxPercent: number;
  issuedAt: Date;
  dueAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  billingName: string | null;
  billingEmail: string | null;
  notes: string | null;
}) {
  const totals = computeTotals(input.lineItems, input.explicitSubtotal, input.discount, input.taxPercent);

  // Retry the number, not the whole invoice: the only contended value is the
  // sequence, and a clash means somebody else took this one.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.invoice.create({
        data: {
          number: await nextInvoiceNumber(),
          userId: input.userId,
          tenantId: input.tenantId,
          subscriptionId: input.subscriptionId,
          status: input.status,
          currency: input.currency,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxPercent: totals.taxPercent,
          tax: totals.tax,
          total: totals.total,
          amountPaid: 0,
          lineItems: JSON.stringify(input.lineItems),
          issuedAt: input.issuedAt,
          dueAt: input.dueAt,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          billingName: input.billingName,
          billingEmail: input.billingEmail,
          notes: input.notes,
        },
      });
    } catch (err: unknown) {
      if ((err as any)?.code !== "P2002") throw err;
      lastError = err;
    }
  }
  throw lastError ?? conflict("Could not allocate an invoice number. Try again.");
}

router.get(
  "/invoices",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const where = invoiceWhere(req);
    const orderBy = parseSort(req, INVOICE_SORTS, "issuedAt") as any;

    const [total, rows, statusFacet, aggregate, overdueCount] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.take,
        include: { user: USER_SELECT, _count: { select: { payments: true } } },
      }),
      prisma.invoice.groupBy({ by: ["status"], _count: { id: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where, _sum: { total: true, amountPaid: true }, _count: { id: true } }),
      prisma.invoice.count({ where: { status: { in: [...OWED_INVOICE_STATUSES] }, dueAt: { lt: new Date() } } }),
    ]);

    res.json({
      rows: rows.map(invoiceRow),
      ...pageMeta(total, paging),
      summary: {
        count: aggregate._count.id,
        invoiced: aggregate._sum.total ?? 0,
        collected: aggregate._sum.amountPaid ?? 0,
        outstanding: Math.max(0, (aggregate._sum.total ?? 0) - (aggregate._sum.amountPaid ?? 0)),
        overdueCount,
      },
      facets: {
        status: Object.fromEntries(statusFacet.map((s) => [s.status, s._count.id])),
        statusValue: Object.fromEntries(statusFacet.map((s) => [s.status, s._sum.total ?? 0])),
      },
      options: { statuses: [...INVOICE_STATUSES], currencies: [...CURRENCIES] },
    });
  })
);

router.get(
  "/invoices/export",
  adminRoute(async (req, res) => {
    const where = invoiceWhere(req);
    const orderBy = parseSort(req, INVOICE_SORTS, "issuedAt") as any;
    const rows = await prisma.invoice.findMany({
      where,
      orderBy,
      take: 10_000,
      include: { user: USER_SELECT, _count: { select: { payments: true } } },
    });
    await adminAudit(req, "admin_exported_invoices", { count: rows.length });
    sendCsv(res, `invoices-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(invoiceRow), [
      { header: "Invoice", value: (r) => r.number },
      { header: "ID", value: (r) => r.id },
      { header: "Customer", value: (r) => r.user?.email ?? r.billingEmail ?? "" },
      { header: "Billing Name", value: (r) => r.billingName },
      { header: "Status", value: (r) => r.status },
      { header: "Currency", value: (r) => r.currency },
      { header: "Subtotal", value: (r) => r.subtotal },
      { header: "Discount", value: (r) => r.discount },
      { header: "Tax %", value: (r) => (r.taxPercent / 100).toFixed(2) },
      { header: "Tax", value: (r) => r.tax },
      { header: "Total", value: (r) => r.total },
      { header: "Paid", value: (r) => r.amountPaid },
      { header: "Due", value: (r) => r.amountDue },
      { header: "Overdue", value: (r) => (r.isOverdue ? "yes" : "no") },
      { header: "Issued", value: (r) => r.issuedAt },
      { header: "Due Date", value: (r) => r.dueAt },
      { header: "Paid At", value: (r) => r.paidAt },
      { header: "Period Start", value: (r) => r.periodStart },
      { header: "Period End", value: (r) => r.periodEnd },
      { header: "Payments", value: (r) => r.paymentCount },
      { header: "Notes", value: (r) => r.notes },
    ]);
  })
);

router.get(
  "/invoices/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Invoice id", 64);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        user: USER_SELECT,
        tenant: { select: { id: true, name: true, slug: true } },
        subscription: { select: { id: true, planKey: true, billingCycle: true, status: true } },
        payments: { orderBy: { paidAt: "desc" } },
        _count: { select: { payments: true } },
      },
    });
    if (!invoice) throw notFound("No invoice with that id.");
    res.json({ invoice: invoiceRow(invoice), payments: invoice.payments });
  })
);

router.post(
  "/invoices",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const lineItems = parseLineItems(body.lineItems);
    const explicitSubtotal = optMoney(body.subtotal, "Subtotal");
    if (!lineItems.length && !explicitSubtotal) {
      throw badRequest("Add at least one line item, or set a subtotal.");
    }

    const userId = optStr(body.userId) ?? null;
    let user: { id: string; email: string; name: string | null } | null = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
      if (!user) throw badRequest("No user with that id — pick a customer from the list.");
    }

    const subscriptionId = optStr(body.subscriptionId) ?? null;
    if (subscriptionId) {
      const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true } });
      if (!sub) throw badRequest("No subscription with that id.");
    }

    const issuedAt = (optDate(body.issuedAt, "Issue date") as Date | null) ?? new Date();
    const dueAt =
      (optDate(body.dueAt, "Due date") as Date | null) ?? new Date(issuedAt.getTime() + 7 * 86_400_000);
    if (dueAt && dueAt < issuedAt) throw badRequest("The due date cannot be before the issue date.");

    const invoice = await createInvoiceRecord({
      userId,
      tenantId: optStr(body.tenantId) ?? null,
      subscriptionId,
      status: optEnum(body.status, "Status", INVOICE_STATUSES) ?? "open",
      currency: optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase() ?? "INR",
      lineItems,
      explicitSubtotal,
      discount: optMoney(body.discount, "Discount") ?? 0,
      taxPercent: optInt(body.taxPercent, "Tax percent", 0, 10_000) ?? 0,
      issuedAt,
      dueAt,
      periodStart: (optDate(body.periodStart, "Period start") as Date | null) ?? null,
      periodEnd: (optDate(body.periodEnd, "Period end") as Date | null) ?? null,
      billingName: nullableStr(body.billingName, "Billing name", 190) ?? user?.name ?? null,
      billingEmail: nullableStr(body.billingEmail, "Billing email", 254) ?? user?.email ?? null,
      notes: nullableStr(body.notes, "Notes", 2000) ?? null,
    });

    await adminAudit(req, "admin_created_invoice", {
      invoiceId: invoice.id,
      number: invoice.number,
      targetUserId: userId,
      total: invoice.total,
    });
    res.status(201).json({ success: true, invoice: invoiceRow(invoice) });
  })
);

router.patch(
  "/invoices/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Invoice id", 64);
    const body = req.body || {};
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw notFound("No invoice with that id.");

    // A paid invoice's figures are the record of a completed transaction. Void
    // and reissue instead — that is what the void status is for.
    const changesMoney =
      body.lineItems !== undefined ||
      body.subtotal !== undefined ||
      body.discount !== undefined ||
      body.taxPercent !== undefined;
    if (changesMoney && (existing.status === "paid" || existing.amountPaid > 0)) {
      throw conflict(
        "This invoice has already been paid, so its amounts cannot be edited. " +
          "Void it and issue a replacement if the figures were wrong."
      );
    }

    const data: Record<string, unknown> = {};

    if (changesMoney) {
      const lineItems =
        body.lineItems !== undefined ? parseLineItems(body.lineItems) : (safeJsonArray(existing.lineItems) as LineItem[]);
      const totals = computeTotals(
        lineItems,
        optMoney(body.subtotal, "Subtotal") ?? existing.subtotal,
        optMoney(body.discount, "Discount") ?? existing.discount,
        optInt(body.taxPercent, "Tax percent", 0, 10_000) ?? existing.taxPercent
      );
      data.lineItems = JSON.stringify(lineItems);
      data.subtotal = totals.subtotal;
      data.discount = totals.discount;
      data.taxPercent = totals.taxPercent;
      data.tax = totals.tax;
      data.total = totals.total;
    }

    if (body.status !== undefined) data.status = optEnum(body.status, "Status", INVOICE_STATUSES);
    if (body.currency !== undefined) data.currency = optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase();
    if (body.issuedAt !== undefined) data.issuedAt = optDate(body.issuedAt, "Issue date");
    if (body.dueAt !== undefined) data.dueAt = optDate(body.dueAt, "Due date");
    if (body.periodStart !== undefined) data.periodStart = optDate(body.periodStart, "Period start");
    if (body.periodEnd !== undefined) data.periodEnd = optDate(body.periodEnd, "Period end");
    if (body.billingName !== undefined) data.billingName = nullableStr(body.billingName, "Billing name", 190);
    if (body.billingEmail !== undefined) data.billingEmail = nullableStr(body.billingEmail, "Billing email", 254);
    if (body.notes !== undefined) data.notes = nullableStr(body.notes, "Notes", 2000);

    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    await prisma.invoice.update({ where: { id }, data });
    await recalcInvoice(id);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { user: USER_SELECT, _count: { select: { payments: true } } },
    });
    await adminAudit(req, "admin_updated_invoice", { invoiceId: id, number: existing.number, changed: Object.keys(data) });
    res.json({ success: true, invoice: invoiceRow(invoice) });
  })
);

/**
 * Settles an invoice by recording the payment that settles it.
 *
 * Deliberately not a status flip: an invoice marked paid with no payment row is
 * money that reconciliation cannot find.
 */
router.post(
  "/invoices/:id/mark-paid",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Invoice id", 64);
    const body = req.body || {};
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw notFound("No invoice with that id.");
    if (invoice.status === "void") throw conflict("A voided invoice cannot be paid.");

    const outstanding = Math.max(0, invoice.total - invoice.amountPaid);
    if (outstanding === 0) throw conflict("That invoice is already fully paid.");

    const amount = optMoney(body.amount, "Amount") ?? outstanding;
    if (amount > outstanding) {
      throw badRequest(`That is more than the ${outstanding} minor units still outstanding on this invoice.`);
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: id,
        userId: invoice.userId,
        amount,
        currency: invoice.currency,
        status: "succeeded",
        method: optEnum(body.method, "Method", PAYMENT_METHODS) ?? "manual",
        gateway: nullableStr(body.gateway, "Gateway", 100) ?? null,
        reference: nullableStr(body.reference, "Reference", 190) ?? null,
        paidAt: (optDate(body.paidAt, "Paid at") as Date | null) ?? new Date(),
        notes: nullableStr(body.notes, "Notes", 1000) ?? "Recorded from the admin console.",
      },
    });

    await recalcInvoice(id);
    const updated = await prisma.invoice.findUnique({
      where: { id },
      include: { user: USER_SELECT, _count: { select: { payments: true } } },
    });

    await adminAudit(req, "admin_marked_invoice_paid", {
      invoiceId: id,
      number: invoice.number,
      paymentId: payment.id,
      amount,
    });
    res.json({ success: true, invoice: invoiceRow(updated), payment });
  })
);

router.post(
  "/invoices/:id/void",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Invoice id", 64);
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw notFound("No invoice with that id.");
    if (invoice.amountPaid > 0) {
      throw conflict("This invoice has payments against it. Refund those first, then void it.");
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: "void", notes: nullableStr((req.body || {}).reason, "Reason", 2000) ?? invoice.notes },
      include: { user: USER_SELECT, _count: { select: { payments: true } } },
    });
    await adminAudit(req, "admin_voided_invoice", { invoiceId: id, number: invoice.number });
    res.json({ success: true, invoice: invoiceRow(updated) });
  })
);

router.delete(
  "/invoices/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Invoice id", 64);
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
    if (!invoice) throw notFound("No invoice with that id.");
    if (invoice._count.payments > 0) {
      throw conflict(
        `This invoice has ${invoice._count.payments} payment(s) recorded against it and cannot be deleted. ` +
          `Void it instead — deleting it would erase the record of money received.`
      );
    }

    await prisma.invoice.delete({ where: { id } });
    await adminAudit(req, "admin_deleted_invoice", { invoiceId: id, number: invoice.number });
    res.json({ success: true, id });
  })
);

const INVOICE_BULK = ["mark-paid", "void", "mark-uncollectible", "reopen", "delete"] as const;

router.post(
  "/invoices/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", INVOICE_BULK);
    if (!action) throw badRequest(`Action must be one of: ${INVOICE_BULK.join(", ")}.`);

    let affected = 0;
    const skipped: string[] = [];

    if (action === "mark-paid") {
      const invoices = await prisma.invoice.findMany({
        where: { id: { in: ids }, status: { in: ["draft", "open", "partially_paid"] } },
      });
      for (const invoice of invoices) {
        const outstanding = Math.max(0, invoice.total - invoice.amountPaid);
        if (outstanding <= 0) {
          skipped.push(invoice.number);
          continue;
        }
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            userId: invoice.userId,
            amount: outstanding,
            currency: invoice.currency,
            status: "succeeded",
            method: "manual",
            paidAt: new Date(),
            notes: "Bulk-settled from the admin console.",
          },
        });
        await recalcInvoice(invoice.id);
        affected++;
      }
    } else if (action === "void" || action === "mark-uncollectible") {
      // Anything already paid is excluded rather than silently rewritten.
      const result = await prisma.invoice.updateMany({
        where: { id: { in: ids }, amountPaid: 0 },
        data: { status: action === "void" ? "void" : "uncollectible" },
      });
      affected = result.count;
    } else if (action === "reopen") {
      const result = await prisma.invoice.updateMany({
        where: { id: { in: ids }, status: { in: ["void", "uncollectible"] } },
        data: { status: "open" },
      });
      affected = result.count;
    } else {
      const deletable = await prisma.invoice.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, _count: { select: { payments: true } } },
      });
      const safe = deletable.filter((i) => i._count.payments === 0).map((i) => i.id);
      skipped.push(...deletable.filter((i) => i._count.payments > 0).map((i) => i.number));
      affected = safe.length ? (await prisma.invoice.deleteMany({ where: { id: { in: safe } } })).count : 0;
    }

    await adminAudit(req, `admin_bulk_invoices_${action.replace(/-/g, "_")}`, { ids, affected, skipped });
    res.json({
      success: true,
      action,
      affected,
      requested: ids.length,
      skipped,
      message: skipped.length
        ? `${affected} updated. Skipped ${skipped.length} with payments recorded against them: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}`
        : undefined,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_SORTS: SortMap = {
  paidAt: sortOn("paidAt"),
  amount: sortOn("amount"),
  status: sortOn("status"),
  method: sortOn("method"),
  createdAt: sortOn("createdAt"),
  userEmail: sortOnRelation("user", "email"),
};

function paymentWhere(req: Request): Record<string, unknown> {
  const where: Record<string, unknown> = { ...parseDateRange(req, "paidAt") };
  const search = optStr(req.query.search);
  const status = optEnum(req.query.status, "Status", PAYMENT_STATUSES);
  const method = optEnum(req.query.method, "Method", PAYMENT_METHODS);
  const userId = optStr(req.query.userId);
  const invoiceId = optStr(req.query.invoiceId);

  if (search) {
    where.OR = [
      { reference: { contains: search } },
      { gateway: { contains: search } },
      { user: { email: { contains: search } } },
      { invoice: { number: { contains: search } } },
      { id: search },
    ];
  }
  if (status) where.status = status;
  if (method) where.method = method;
  if (userId) where.userId = userId;
  if (invoiceId) where.invoiceId = invoiceId;
  return where;
}

function paymentRow(p: any) {
  return {
    ...p,
    netAmount: p.status === "refunded" ? 0 : Math.max(0, p.amount - p.refundedAmount),
    refundable: p.status === "succeeded" || p.status === "partially_refunded",
    invoiceNumber: p.invoice?.number ?? null,
  };
}

router.get(
  "/payments",
  adminRoute(async (req, res) => {
    const paging = parsePaging(req, 25);
    const where = paymentWhere(req);
    const orderBy = parseSort(req, PAYMENT_SORTS, "paidAt") as any;

    const [total, rows, statusFacet, methodFacet, aggregate] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        orderBy,
        skip: paging.skip,
        take: paging.take,
        include: { user: USER_SELECT, invoice: { select: { id: true, number: true, total: true, status: true } } },
      }),
      prisma.payment.groupBy({ by: ["status"], _count: { id: true }, _sum: { amount: true } }),
      prisma.payment.groupBy({ by: ["method"], _count: { id: true }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where, _sum: { amount: true, refundedAmount: true }, _count: { id: true } }),
    ]);

    res.json({
      rows: rows.map(paymentRow),
      ...pageMeta(total, paging),
      summary: {
        count: aggregate._count.id,
        gross: aggregate._sum.amount ?? 0,
        refunded: aggregate._sum.refundedAmount ?? 0,
        net: Math.max(0, (aggregate._sum.amount ?? 0) - (aggregate._sum.refundedAmount ?? 0)),
      },
      facets: {
        status: Object.fromEntries(statusFacet.map((s) => [s.status, s._count.id])),
        method: Object.fromEntries(methodFacet.map((s) => [s.method, s._count.id])),
        methodValue: Object.fromEntries(methodFacet.map((s) => [s.method, s._sum.amount ?? 0])),
      },
      options: { statuses: [...PAYMENT_STATUSES], methods: [...PAYMENT_METHODS], currencies: [...CURRENCIES] },
    });
  })
);

router.get(
  "/payments/export",
  adminRoute(async (req, res) => {
    const where = paymentWhere(req);
    const orderBy = parseSort(req, PAYMENT_SORTS, "paidAt") as any;
    const rows = await prisma.payment.findMany({
      where,
      orderBy,
      take: 10_000,
      include: { user: USER_SELECT, invoice: { select: { id: true, number: true, total: true, status: true } } },
    });
    await adminAudit(req, "admin_exported_payments", { count: rows.length });
    sendCsv(res, `payments-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(paymentRow), [
      { header: "ID", value: (r) => r.id },
      { header: "Paid At", value: (r) => r.paidAt },
      { header: "Customer", value: (r) => r.user?.email ?? "" },
      { header: "Invoice", value: (r) => r.invoiceNumber },
      { header: "Amount", value: (r) => r.amount },
      { header: "Refunded", value: (r) => r.refundedAmount },
      { header: "Net", value: (r) => r.netAmount },
      { header: "Currency", value: (r) => r.currency },
      { header: "Status", value: (r) => r.status },
      { header: "Method", value: (r) => r.method },
      { header: "Gateway", value: (r) => r.gateway },
      { header: "Reference", value: (r) => r.reference },
      { header: "Failure Reason", value: (r) => r.failureReason },
      { header: "Notes", value: (r) => r.notes },
    ]);
  })
);

router.post(
  "/payments",
  adminRoute(async (req, res) => {
    const body = req.body || {};
    const amount = optMoney(body.amount, "Amount");
    if (!amount) throw badRequest("An amount greater than zero is required.");

    const invoiceId = optStr(body.invoiceId) ?? null;
    let invoice = null;
    if (invoiceId) {
      invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw badRequest("No invoice with that id.");
      if (invoice.status === "void") throw conflict("That invoice is voided; it cannot take a payment.");
      const outstanding = Math.max(0, invoice.total - invoice.amountPaid);
      if (amount > outstanding) {
        throw badRequest(
          `That is more than the ${outstanding} minor units outstanding on ${invoice.number}. ` +
            `Record a smaller amount, or raise the invoice total first.`
        );
      }
    }

    const userId = optStr(body.userId) ?? invoice?.userId ?? null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw badRequest("No user with that id.");
    }

    const status = optEnum(body.status, "Status", PAYMENT_STATUSES) ?? "succeeded";
    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        userId,
        amount,
        currency: optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase() ?? invoice?.currency ?? "INR",
        status,
        method: optEnum(body.method, "Method", PAYMENT_METHODS) ?? "manual",
        gateway: nullableStr(body.gateway, "Gateway", 100) ?? null,
        reference: nullableStr(body.reference, "Reference", 190) ?? null,
        failureReason: status === "failed" ? nullableStr(body.failureReason, "Failure reason", 1000) ?? null : null,
        paidAt: (optDate(body.paidAt, "Paid at") as Date | null) ?? new Date(),
        notes: nullableStr(body.notes, "Notes", 1000) ?? null,
      },
      include: { user: USER_SELECT, invoice: { select: { id: true, number: true, total: true, status: true } } },
    });

    if (invoiceId) await recalcInvoice(invoiceId);
    await adminAudit(req, "admin_recorded_payment", { paymentId: payment.id, invoiceId, targetUserId: userId, amount, status });
    res.status(201).json({ success: true, payment: paymentRow(payment) });
  })
);

router.patch(
  "/payments/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Payment id", 64);
    const body = req.body || {};
    const existing = await prisma.payment.findUnique({ where: { id } });
    if (!existing) throw notFound("No payment with that id.");

    const data: Record<string, unknown> = {};
    if (body.amount !== undefined) {
      const amount = optMoney(body.amount, "Amount")!;
      if (existing.invoiceId) {
        const invoice = await prisma.invoice.findUnique({ where: { id: existing.invoiceId } });
        // Compare against the invoice total less every OTHER payment, so raising
        // one payment cannot push an invoice past what it bills.
        const otherPaid = Math.max(0, (invoice?.amountPaid ?? 0) - (existing.amount - existing.refundedAmount));
        if (invoice && amount + otherPaid > invoice.total) {
          throw badRequest(`That would over-pay ${invoice.number}. The most this payment can be is ${invoice.total - otherPaid}.`);
        }
      }
      data.amount = amount;
    }
    if (body.status !== undefined) data.status = optEnum(body.status, "Status", PAYMENT_STATUSES);
    if (body.method !== undefined) data.method = optEnum(body.method, "Method", PAYMENT_METHODS);
    if (body.currency !== undefined) data.currency = optEnum(body.currency, "Currency", CURRENCIES)?.toUpperCase();
    if (body.gateway !== undefined) data.gateway = nullableStr(body.gateway, "Gateway", 100);
    if (body.reference !== undefined) data.reference = nullableStr(body.reference, "Reference", 190);
    if (body.failureReason !== undefined) data.failureReason = nullableStr(body.failureReason, "Failure reason", 1000);
    if (body.paidAt !== undefined) data.paidAt = optDate(body.paidAt, "Paid at");
    if (body.notes !== undefined) data.notes = nullableStr(body.notes, "Notes", 1000);

    if (!Object.keys(data).length) throw badRequest("Nothing to update.");

    await prisma.payment.update({ where: { id }, data });
    if (existing.invoiceId) await recalcInvoice(existing.invoiceId);

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { user: USER_SELECT, invoice: { select: { id: true, number: true, total: true, status: true } } },
    });
    await adminAudit(req, "admin_updated_payment", { paymentId: id, changed: Object.keys(data) });
    res.json({ success: true, payment: paymentRow(payment) });
  })
);

router.post(
  "/payments/:id/refund",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Payment id", 64);
    const body = req.body || {};
    const existing = await prisma.payment.findUnique({ where: { id } });
    if (!existing) throw notFound("No payment with that id.");
    if (existing.status === "failed" || existing.status === "pending") {
      throw conflict("Only a succeeded payment can be refunded.");
    }

    const refundable = existing.amount - existing.refundedAmount;
    if (refundable <= 0) throw conflict("That payment has already been fully refunded.");

    const amount = optMoney(body.amount, "Refund amount") ?? refundable;
    if (amount > refundable) throw badRequest(`At most ${refundable} minor units can still be refunded.`);

    const refundedAmount = existing.refundedAmount + amount;
    await prisma.payment.update({
      where: { id },
      data: {
        refundedAmount,
        status: refundedAmount >= existing.amount ? "refunded" : "partially_refunded",
        notes: nullableStr(body.reason, "Reason", 1000) ?? existing.notes,
      },
    });

    if (existing.invoiceId) await recalcInvoice(existing.invoiceId);

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { user: USER_SELECT, invoice: { select: { id: true, number: true, total: true, status: true } } },
    });
    await adminAudit(req, "admin_refunded_payment", { paymentId: id, amount, totalRefunded: refundedAmount });
    res.json({ success: true, payment: paymentRow(payment) });
  })
);

router.delete(
  "/payments/:id",
  adminRoute(async (req, res) => {
    const id = reqStr(req.params.id, "Payment id", 64);
    const existing = await prisma.payment.findUnique({ where: { id } });
    if (!existing) throw notFound("No payment with that id.");

    await prisma.payment.delete({ where: { id } });
    if (existing.invoiceId) await recalcInvoice(existing.invoiceId);
    await adminAudit(req, "admin_deleted_payment", { paymentId: id, amount: existing.amount, invoiceId: existing.invoiceId });
    res.json({ success: true, id });
  })
);

const PAYMENT_BULK = ["mark-succeeded", "mark-failed", "mark-pending", "refund", "delete"] as const;

router.post(
  "/payments/bulk",
  adminRoute(async (req, res) => {
    const ids = parseIds(req.body);
    const action = optEnum((req.body || {}).action, "Action", PAYMENT_BULK);
    if (!action) throw badRequest(`Action must be one of: ${PAYMENT_BULK.join(", ")}.`);

    const touched = await prisma.payment.findMany({ where: { id: { in: ids } }, select: { id: true, invoiceId: true, amount: true, refundedAmount: true } });
    let affected = 0;

    if (action === "refund") {
      for (const p of touched) {
        const refundable = p.amount - p.refundedAmount;
        if (refundable <= 0) continue;
        await prisma.payment.update({ where: { id: p.id }, data: { refundedAmount: p.amount, status: "refunded" } });
        affected++;
      }
    } else if (action === "delete") {
      affected = (await prisma.payment.deleteMany({ where: { id: { in: ids } } })).count;
    } else {
      const status = action === "mark-succeeded" ? "succeeded" : action === "mark-failed" ? "failed" : "pending";
      affected = (await prisma.payment.updateMany({ where: { id: { in: ids } }, data: { status } })).count;
    }

    // Every invoice that any of these payments touched is re-derived once.
    const invoiceIds = [...new Set(touched.map((p) => p.invoiceId).filter(Boolean) as string[])];
    for (const invoiceId of invoiceIds) await recalcInvoice(invoiceId);

    await adminAudit(req, `admin_bulk_payments_${action.replace(/-/g, "_")}`, { ids, affected, recalculatedInvoices: invoiceIds.length });
    res.json({ success: true, action, affected, requested: ids.length });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the billing dashboard plots, computed server-side.
 *
 * Computed here rather than in the browser because the client would otherwise
 * have to download every subscription and payment row to add them up — which is
 * both slow and a way to leak the whole billing table into a page.
 */
router.get(
  "/metrics",
  adminRoute(async (req, res) => {
    const months = Math.min(24, Math.max(3, toInt(req.query.months, 12)));
    const now = new Date();
    const monthStartNow = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      liveSubs,
      statusCounts,
      planCounts,
      cycleCounts,
      invoiceStatus,
      paymentMethods,
      collectedAllTime,
      collectedThisMonth,
      collectedPrevMonth,
      outstanding,
      overdue,
      canceledThisMonth,
      canceledPrevMonth,
      liveAtMonthStart,
      upcomingRenewals,
      recentPayments,
      topCustomers,
    ] = await Promise.all([
      prisma.subscription.findMany({
        where: { status: { in: [...LIVE_SUB_STATUSES] } },
        select: { amount: true, billingCycle: true, status: true, planKey: true, currency: true },
      }),
      prisma.subscription.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.subscription.groupBy({
        by: ["planKey"],
        where: { status: { in: [...LIVE_SUB_STATUSES] } },
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.subscription.groupBy({
        by: ["billingCycle"],
        where: { status: { in: [...LIVE_SUB_STATUSES] } },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({ by: ["status"], _count: { id: true }, _sum: { total: true } }),
      prisma.payment.groupBy({
        by: ["method"],
        where: { status: { in: ["succeeded", "partially_refunded"] } },
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({ where: { status: { in: ["succeeded", "partially_refunded"] } }, _sum: { amount: true, refundedAmount: true } }),
      prisma.payment.aggregate({
        where: { status: { in: ["succeeded", "partially_refunded"] }, paidAt: { gte: monthStartNow } },
        _sum: { amount: true, refundedAmount: true },
      }),
      prisma.payment.aggregate({
        where: { status: { in: ["succeeded", "partially_refunded"] }, paidAt: { gte: monthStartPrev, lt: monthStartNow } },
        _sum: { amount: true, refundedAmount: true },
      }),
      prisma.invoice.aggregate({ where: { status: { in: [...OWED_INVOICE_STATUSES] } }, _sum: { total: true, amountPaid: true }, _count: { id: true } }),
      prisma.invoice.aggregate({
        where: { status: { in: [...OWED_INVOICE_STATUSES] }, dueAt: { lt: now } },
        _sum: { total: true, amountPaid: true },
        _count: { id: true },
      }),
      prisma.subscription.count({ where: { canceledAt: { gte: monthStartNow } } }),
      prisma.subscription.count({ where: { canceledAt: { gte: monthStartPrev, lt: monthStartNow } } }),
      // Denominator for churn: subscriptions that were live when the month began.
      prisma.subscription.count({ where: { startedAt: { lt: monthStartNow }, OR: [{ canceledAt: null }, { canceledAt: { gte: monthStartNow } }] } }),
      prisma.subscription.findMany({
        where: { status: { in: [...LIVE_SUB_STATUSES] }, currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + 30 * 86_400_000) } },
        orderBy: { currentPeriodEnd: "asc" },
        take: 10,
        include: { user: USER_SELECT },
      }),
      prisma.payment.findMany({
        orderBy: { paidAt: "desc" },
        take: 8,
        include: { user: USER_SELECT, invoice: { select: { number: true } } },
      }),
      prisma.payment.groupBy({
        by: ["userId"],
        where: { status: { in: ["succeeded", "partially_refunded"] }, userId: { not: null } },
        _sum: { amount: true, refundedAmount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 8,
      }),
    ]);

    const mrr = liveSubs.reduce((sum, s) => sum + monthlyValue(s), 0);
    const payingCount = liveSubs.filter((s) => monthlyValue(s) > 0).length;
    const netCollected = (collectedAllTime._sum.amount ?? 0) - (collectedAllTime._sum.refundedAmount ?? 0);
    const netThisMonth = (collectedThisMonth._sum.amount ?? 0) - (collectedThisMonth._sum.refundedAmount ?? 0);
    const netPrevMonth = (collectedPrevMonth._sum.amount ?? 0) - (collectedPrevMonth._sum.refundedAmount ?? 0);
    const churnRate = liveAtMonthStart > 0 ? Math.round((canceledThisMonth / liveAtMonthStart) * 1000) / 10 : 0;

    // Monthly invoiced vs collected, from two grouped raw queries rather than
    // `months` round trips.
    const keys = monthKeys(months, now);
    const windowStart = monthStart(keys[0]);
    const [invoicedRows, collectedRows, newSubRows] = await Promise.all([
      prisma.$queryRaw<{ ym: string; total: bigint | number }[]>`
        SELECT DATE_FORMAT(issued_at, '%Y-%m') AS ym, SUM(total) AS total
        FROM invoices WHERE issued_at >= ${windowStart} AND status <> 'void'
        GROUP BY ym ORDER BY ym ASC
      `,
      prisma.$queryRaw<{ ym: string; total: bigint | number }[]>`
        SELECT DATE_FORMAT(paid_at, '%Y-%m') AS ym, SUM(amount - refunded_amount) AS total
        FROM payments WHERE paid_at >= ${windowStart} AND status IN ('succeeded','partially_refunded')
        GROUP BY ym ORDER BY ym ASC
      `,
      prisma.$queryRaw<{ ym: string; total: bigint | number }[]>`
        SELECT DATE_FORMAT(started_at, '%Y-%m') AS ym, COUNT(*) AS total
        FROM subscriptions WHERE started_at >= ${windowStart}
        GROUP BY ym ORDER BY ym ASC
      `,
    ]);

    const invoicedByMonth = new Map(invoicedRows.map((r) => [r.ym, num(r.total)]));
    const collectedByMonth = new Map(collectedRows.map((r) => [r.ym, num(r.total)]));
    const newSubsByMonth = new Map(newSubRows.map((r) => [r.ym, num(r.total)]));

    const customerIds = topCustomers.map((c) => String(c.userId));
    const customerRows = customerIds.length
      ? await prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, email: true, name: true, plan: true } })
      : [];
    const customerById = new Map(customerRows.map((u) => [u.id, u]));

    res.json({
      currency: liveSubs[0]?.currency ?? "INR",
      kpis: {
        mrr,
        arr: mrr * 12,
        arpu: payingCount ? Math.round(mrr / payingCount) : 0,
        activeSubscriptions: liveSubs.length,
        payingSubscriptions: payingCount,
        collectedAllTime: Math.max(0, netCollected),
        collectedThisMonth: Math.max(0, netThisMonth),
        collectedThisMonthDelta: deltaPercent(netThisMonth, netPrevMonth),
        outstanding: Math.max(0, (outstanding._sum.total ?? 0) - (outstanding._sum.amountPaid ?? 0)),
        outstandingCount: outstanding._count.id,
        overdue: Math.max(0, (overdue._sum.total ?? 0) - (overdue._sum.amountPaid ?? 0)),
        overdueCount: overdue._count.id,
        churnRate,
        churnedThisMonth: canceledThisMonth,
        churnedDelta: deltaPercent(canceledThisMonth, canceledPrevMonth),
        // Crude but honest: ARPU divided by the monthly churn fraction.
        lifetimeValue: churnRate > 0 && payingCount ? Math.round((mrr / payingCount) / (churnRate / 100)) : 0,
        refundedAllTime: collectedAllTime._sum.refundedAmount ?? 0,
      },
      revenueSeries: keys.map((ym) => ({
        month: ym,
        label: new Date(monthStart(ym)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
        invoiced: invoicedByMonth.get(ym) ?? 0,
        collected: collectedByMonth.get(ym) ?? 0,
        newSubscriptions: newSubsByMonth.get(ym) ?? 0,
        monthEnd: monthEnd(ym),
      })),
      distributions: {
        subscriptionStatus: statusCounts.map((s) => ({ label: s.status, value: s._count.id })),
        planRevenue: planCounts.map((p) => ({ label: p.planKey, value: p._sum.amount ?? 0, count: p._count.id })),
        billingCycle: cycleCounts.map((c) => ({ label: c.billingCycle, value: c._count.id })),
        invoiceStatus: invoiceStatus.map((i) => ({ label: i.status, value: i._count.id, amount: i._sum.total ?? 0 })),
        paymentMethod: paymentMethods.map((m) => ({ label: m.method, value: m._sum.amount ?? 0, count: m._count.id })),
      },
      upcomingRenewals: upcomingRenewals.map(subRow),
      recentPayments: recentPayments.map(paymentRow),
      topCustomers: topCustomers.map((c) => ({
        userId: c.userId,
        user: customerById.get(String(c.userId)) ?? null,
        total: Math.max(0, (c._sum.amount ?? 0) - (c._sum.refundedAmount ?? 0)),
      })),
    });
  })
);

/**
 * Customer picker for the create/edit forms.
 *
 * A dedicated endpoint rather than reusing the users list: those payloads carry
 * per-row revenue, counts and facets, and a type-ahead firing on every keystroke
 * should not pay for any of it.
 */
router.get(
  "/customers",
  adminRoute(async (req, res) => {
    const search = optStr(req.query.search);
    const users = await prisma.user.findMany({
      where: search
        ? { OR: [{ email: { contains: search } }, { name: { contains: search } }] }
        : {},
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, email: true, name: true, plan: true, status: true },
    });
    res.json({ rows: users });
  })
);

export default router;
