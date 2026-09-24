/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant provisioning and membership lookup.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantRole } from "./permissions";

/**
 * Derives a URL-safe slug from a display name, falling back to "workspace" when
 * the name has no usable characters (e.g. a name written entirely in a script
 * that strips to nothing).
 */
export function slugify(input: string): string {
  const base = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

/**
 * Finds a free slug by appending a counter. `Tenant.slug` is unique, so the
 * insert is still the real arbiter — this only avoids the obvious collisions.
 */
async function allocateSlug(desired: string): Promise<string> {
  const base = slugify(desired);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Fall back to something guaranteed unique rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}

/** A tenant name derived from the user, used when provisioning automatically. */
function defaultTenantName(user: { name?: string | null; email: string }): string {
  if (user.name && user.name.trim()) return `${user.name.trim()}'s Workspace`;
  const local = user.email.split("@")[0] || "My";
  return `${local}'s Workspace`;
}

export interface Membership {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  role: TenantRole | string;
  permissions: string | null;
  status: string;
}

/** Active memberships for a user, newest tenant last. */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await prisma.tenantMember.findMany({
    where: { userId, status: "active" },
    include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row: any) => ({
    membershipId: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant.name,
    tenantSlug: row.tenant.slug,
    tenantStatus: row.tenant.status,
    role: row.role,
    permissions: row.permissions,
    status: row.status,
  }));
}

/**
 * Guarantees the user has at least one workspace, creating one where they are
 * owner if not. Idempotent, so it is safe to call on every sign-in.
 *
 * Called from the auth flow rather than lazily from the request path: a GET
 * should not create rows, and a user who somehow reaches the app without a
 * workspace should get a clear error instead of silent provisioning.
 */
export async function ensureTenantForUser(userId: string): Promise<string> {
  const existing = await prisma.tenantMember.findFirst({
    where: { userId, status: "active" },
    select: { tenantId: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.tenantId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new Error(`Cannot provision a workspace: user ${userId} not found.`);

  const name = defaultTenantName(user);
  const slug = await allocateSlug(name);

  // One transaction: a tenant with no owner is unreachable, and an owner
  // membership pointing at no tenant violates the foreign key.
  const tenantId = await prisma.$transaction(async (tx: any) => {
    const tenant = await tx.tenant.create({ data: { name, slug } });
    await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id, role: "owner", status: "active" },
    });
    return tenant.id as string;
  });

  logger.info(`Provisioned workspace "${name}" (${tenantId}) for user ${userId}.`);
  return tenantId;
}

/** Resolves a membership for a specific tenant, or null when there is none. */
export async function findMembership(userId: string, tenantId: string): Promise<Membership | null> {
  const row = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
  });
  if (!row || row.status !== "active") return null;

  return {
    membershipId: row.id,
    tenantId: row.tenantId,
    tenantName: (row as any).tenant.name,
    tenantSlug: (row as any).tenant.slug,
    tenantStatus: (row as any).tenant.status,
    role: row.role,
    permissions: row.permissions,
    status: row.status,
  };
}
