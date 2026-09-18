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
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  });

  return {
    user: model(),
    userIntegration: model(),
    auditLog: model(),
    emailOtp: model(),
    leadList: model(),
    lead: model(),
    pageView: model(),
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

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

/** Lists owned by each tenant, matching the real fixture ids. */
export const LIST_A = { id: "cmrok7qoj0003ll1w7s46k7oy", name: "Tenant A list", userId: TENANT_A.id };
export const LIST_B = { id: "cmskka4ly00i7l192sdn5envi", name: "Tenant B list", userId: TENANT_B.id };
export const LEAD_B = { id: "lead_owned_by_b", listId: LIST_B.id };
