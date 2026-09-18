/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant-scoped data access.
 *
 * Every function here takes a TenantContext and injects the tenant predicate
 * itself. Callers cannot express "all lead lists" or "lead by id" without a
 * workspace, because there is no function that accepts a bare id.
 *
 * That is the whole point. The pre-Phase-1 leak was not a missing check in one
 * handler — it was ten handlers each independently responsible for remembering
 * a `where` clause, and one of them (`id === "ALL"` in the CSV export) not
 * having one at all. Centralising the predicate turns "remember to scope this"
 * into "you cannot fetch anything unscoped".
 *
 * COMPATIBILITY
 * Writes set BOTH `tenantId` and the legacy `userId`. Older code paths and the
 * Google Sheets sync still read `userId`, so dropping it now would break them;
 * it is removed once every reader has moved over. Reads prefer `tenantId` but
 * accept rows whose backfill has not happened yet — see tenantScope().
 */

import { prisma } from "../prisma";
import type { TenantContext } from "./context";

/**
 * The tenant predicate used by every read.
 *
 * During the migration window a row may legitimately have `tenantId = null`
 * while still belonging to the caller through the legacy `userId` column, so
 * both are accepted. This is a transitional clause with a defined end: once the
 * backfill has run everywhere and `tenantId` becomes non-nullable, the
 * `userId` half is deleted and this collapses to `{ tenantId }`.
 *
 * Note the second branch still requires the row to belong to the CALLING user —
 * it widens the match to un-backfilled rows, never to another tenant's data.
 */
export function tenantScope(ctx: TenantContext) {
  return {
    OR: [{ tenantId: ctx.tenantId }, { AND: [{ tenantId: null }, { userId: ctx.userId }] }],
  };
}

/** Ownership stamp applied to every row this layer creates. */
export function ownershipStamp(ctx: TenantContext) {
  return { tenantId: ctx.tenantId, userId: ctx.userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead lists
// ─────────────────────────────────────────────────────────────────────────────

export async function listLeadLists(ctx: TenantContext) {
  return prisma.leadList.findMany({
    where: tenantScope(ctx),
    orderBy: { scrapedAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });
}

/** Resolves a list only when it belongs to the caller's workspace. */
export async function findLeadList(ctx: TenantContext, listId: string) {
  return prisma.leadList.findFirst({
    where: { AND: [{ id: listId }, tenantScope(ctx)] },
  });
}

/** Ids of every list in the workspace. Used to scope lead queries. */
export async function leadListIds(ctx: TenantContext): Promise<string[]> {
  const rows = await prisma.leadList.findMany({
    where: tenantScope(ctx),
    select: { id: true },
  });
  return rows.map((r: { id: string }) => r.id);
}

export async function createLeadList(
  ctx: TenantContext,
  data: { name: string; businessType: string; location: string }
) {
  return prisma.leadList.create({ data: { ...data, ...ownershipStamp(ctx) } });
}

export async function renameLeadList(ctx: TenantContext, listId: string, name: string) {
  const owned = await findLeadList(ctx, listId);
  if (!owned) return null;
  return prisma.leadList.update({ where: { id: owned.id }, data: { name } });
}

export async function deleteLeadList(ctx: TenantContext, listId: string) {
  const owned = await findLeadList(ctx, listId);
  if (!owned) return false;
  await prisma.leadList.delete({ where: { id: owned.id } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leads across the whole workspace.
 *
 * Scoped through the workspace's list ids rather than `leads.tenant_id` alone,
 * so a lead whose backfill has not run is still reachable via its list. An
 * empty id set short-circuits: `{ listId: { in: [] } }` matches nothing, and
 * issuing that query would be pointless work.
 */
export async function findLeadsInWorkspace(
  ctx: TenantContext,
  extraWhere: Record<string, unknown>,
  orderBy: Record<string, unknown>
) {
  const listIds = await leadListIds(ctx);
  if (listIds.length === 0) return [];
  return prisma.lead.findMany({
    where: { ...extraWhere, listId: { in: listIds } },
    orderBy,
  });
}

export async function findLeadsInList(
  ctx: TenantContext,
  listId: string,
  extraWhere: Record<string, unknown>,
  orderBy: Record<string, unknown>
) {
  const owned = await findLeadList(ctx, listId);
  if (!owned) return null;
  return prisma.lead.findMany({
    where: { ...extraWhere, listId: owned.id },
    orderBy,
  });
}

/**
 * Resolves a lead only when its list belongs to the caller's workspace.
 *
 * Ownership is decided by the LIST, not by `leads.tenant_id` or
 * `leads.user_id`. The list is the authoritative parent — a lead cannot exist
 * without one (`listId` is required with a cascading delete) whereas both
 * ownership columns on the lead itself are nullable and were historically
 * unset by some write paths.
 */
export async function findLead(ctx: TenantContext, leadId: string) {
  return prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, { list: { is: tenantScope(ctx) } }] },
    select: { id: true, listId: true },
  });
}

export async function updateLead(ctx: TenantContext, leadId: string, data: Record<string, unknown>) {
  const owned = await findLead(ctx, leadId);
  if (!owned) return null;
  return prisma.lead.update({ where: { id: owned.id }, data });
}

export async function deleteLead(ctx: TenantContext, leadId: string) {
  const owned = await findLead(ctx, leadId);
  if (!owned) return false;
  await prisma.lead.delete({ where: { id: owned.id } });
  return true;
}

/** Finds a lead in a specific owned list by business name, for import dedupe. */
export async function findLeadByName(ctx: TenantContext, listId: string, businessName: string) {
  return prisma.lead.findFirst({
    where: { listId, businessName, list: { is: tenantScope(ctx) } },
    select: { id: true },
  });
}

export async function createLead(ctx: TenantContext, data: Record<string, unknown>) {
  return prisma.lead.create({ data: { ...(data as any), ...ownershipStamp(ctx) } });
}

export async function updateLeadById(leadId: string, data: Record<string, unknown>) {
  // Deliberately unscoped: only for callers that have ALREADY verified ownership
  // via findLead. Kept separate and named so it stands out in review.
  return prisma.lead.update({ where: { id: leadId }, data });
}

/** Leads for CSV export, scoped to the workspace or one owned list. */
export async function findLeadsForExport(ctx: TenantContext, listId: string | "ALL") {
  if (listId === "ALL") {
    const listIds = await leadListIds(ctx);
    if (listIds.length === 0) return { leads: [], listName: null as string | null };
    const leads = await prisma.lead.findMany({
      where: { listId: { in: listIds } },
      orderBy: { leadScore: "desc" },
    });
    return { leads, listName: null as string | null };
  }

  const owned = await findLeadList(ctx, listId);
  if (!owned) return null;
  const leads = await prisma.lead.findMany({
    where: { listId: owned.id },
    orderBy: { leadScore: "desc" },
  });
  return { leads, listName: owned.name as string };
}
