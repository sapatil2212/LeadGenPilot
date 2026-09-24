/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory Prisma double.
 *
 * These are authorization tests, not database tests: what matters is the
 * `where` clause each route hands to Prisma. Mocking at the client boundary
 * lets the tests assert the exact ownership predicate while guaranteeing no
 * query ever reaches the real MySQL instance.
 */

import { vi } from "vitest";

export function createPrismaMock() {
  const model = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({}),
  });

  return {
    user: model(),
    userIntegration: model(),
    auditLog: model(),
    emailOtp: model(),
    leadList: model(),
    lead: model(),
    pageView: model(),
    tenant: model(),
    tenantMember: model(),
    job: model(),
    businessProfile: model(),
    businessProduct: model(),
    businessService: model(),
    knowledgeDocument: model(),
    knowledgeChunk: model(),
    knowledgeItem: model(),
    aiConversation: model(),
    aiMessage: model(),
    icpProfile: model(),
    scoringRuleSet: model(),
    discoveredBusiness: model(),
    campaign: model(),
    campaignMessage: model(),
    campaignDispatch: model(),
    conversationThread: model(),
    conversationMessage: model(),
    suppressionEntry: model(),
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([]),
    // Runs the callback with the same mock, so a transaction behaves like the
    // individual calls it wraps.
    $transaction: vi.fn(),
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

/** Makes $transaction execute its callback against the mock itself. */
export function wireTransaction(prismaMock: PrismaMock) {
  prismaMock.$transaction.mockImplementation(async (fn: any) =>
    typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
  );
  return prismaMock;
}

/** Two tenants mirroring the real fixture data found in the Phase 0 backup. */
export const TENANT_A = {
  id: "cmrn8vzit0000lljcmy8zr0qy",
  email: "tenant-a@example.test",
  name: "Tenant A",
  role: "user",
  plan: "free",
  emailVerified: true,
  leadsUsed: 0,
  usagePeriod: null,
};

export const TENANT_B = {
  id: "cmsigxuod001sl1m4st1qtmcw",
  email: "tenant-b@example.test",
  name: "Tenant B",
  role: "user",
  plan: "free",
  emailVerified: true,
  leadsUsed: 0,
  usagePeriod: null,
};

export const ADMIN_USER = {
  ...TENANT_A,
  id: "admin_user_id",
  email: "admin@example.test",
  role: "admin",
};

/** Workspaces, one per user — what scripts/backfill-tenants.mjs produces. */
export const WORKSPACE_A = {
  id: "ws_a_00000000000000000000",
  name: "Tenant A's Workspace",
  slug: "tenant-a-s-workspace",
  status: "active",
};

export const WORKSPACE_B = {
  id: "ws_b_00000000000000000000",
  name: "Tenant B's Workspace",
  slug: "tenant-b-s-workspace",
  status: "active",
};

/** Lists owned by each tenant, matching the real fixture ids. */
export const LIST_A = {
  id: "cmrok7qoj0003ll1w7s46k7oy",
  name: "Tenant A list",
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
};
export const LIST_B = {
  id: "cmskka4ly00i7l192sdn5envi",
  name: "Tenant B list",
  userId: TENANT_B.id,
  tenantId: WORKSPACE_B.id,
};
export const LEAD_B = { id: "lead_owned_by_b", listId: LIST_B.id };

/**
 * Builds a TenantMember row shaped the way tenantService reads it, i.e. with
 * the tenant relation included.
 */
export function membershipRow(opts: {
  user: { id: string };
  workspace: { id: string; name: string; slug: string; status: string };
  role?: string;
  status?: string;
  permissions?: string | null;
}) {
  return {
    id: `tm_${opts.user.id}_${opts.workspace.id}`,
    tenantId: opts.workspace.id,
    userId: opts.user.id,
    role: opts.role ?? "owner",
    permissions: opts.permissions ?? null,
    status: opts.status ?? "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    tenant: opts.workspace,
  };
}

/**
 * Wires tenantMember.findMany / findUnique so resolveTenantContext can resolve
 * a workspace for each fixture user. Returns the mock for further tweaking.
 */
export function withMemberships(
  prismaMock: PrismaMock,
  memberships: ReturnType<typeof membershipRow>[]
) {
  prismaMock.tenantMember.findMany.mockImplementation(async ({ where }: any) =>
    memberships.filter(
      (m) => m.userId === where.userId && (!where.status || m.status === where.status)
    )
  );

  prismaMock.tenantMember.findUnique.mockImplementation(async ({ where }: any) => {
    const key = where.tenantId_userId;
    if (!key) return null;
    return (
      memberships.find((m) => m.tenantId === key.tenantId && m.userId === key.userId) ?? null
    );
  });

  return prismaMock;
}
