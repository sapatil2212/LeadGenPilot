/**
 * Tenant-owned delivery history (the Reports table).
 *
 * Every read and write goes through one `where` builder that always carries the
 * tenant predicate, so a filtered export cannot disagree with the table it came
 * from and no individual route can forget to scope itself. Single-record
 * mutations use `updateMany`/`deleteMany` with that predicate rather than
 * `update`/`delete` by id: a foreign id then matches zero rows and reports "not
 * found" instead of mutating another workspace's audit trail.
 */
import { prisma } from "../prisma";
import type { TenantContext } from "../tenancy/context";
import type { CampaignHistoryRecord } from "../campaignHistory";

export interface DispatchHistoryQuery {
  channel?: string;
  status?: string;
  campaignId?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number | string;
  page?: number | string;
}

export interface DispatchHistoryUpdate {
  businessName?: string;
  recipient?: string;
  subject?: string;
  messageSnippet?: string;
  status?: string;
}

/** Maximum rows a single export may materialise. */
export const EXPORT_ROW_CAP = 10_000;

export function dispatchWhere(ctx: TenantContext, query: DispatchHistoryQuery): Record<string, unknown> {
  const channel = query.channel === "email" || query.channel === "whatsapp" ? query.channel : undefined;
  const status = query.status === "SENT" || query.status === "FAILED" ? query.status : undefined;
  const campaignId = typeof query.campaignId === "string" && query.campaignId.trim() ? query.campaignId.trim() : undefined;
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  const occurredAt: Record<string, Date> = {};
  if (from && !Number.isNaN(from.getTime())) occurredAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) occurredAt.lte = to;

  return {
    tenantId: ctx.tenantId,
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
    ...(search
      ? {
          OR: [
            { businessName: { contains: search } },
            { recipient: { contains: search } },
            { subject: { contains: search } },
            { messageSnippet: { contains: search } },
          ],
        }
      : {}),
  };
}

export function toHistoryRecord(row: any): CampaignHistoryRecord {
  return {
    id: row.id,
    campaignId: row.campaignId || "manual",
    timestamp: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    businessName: row.businessName,
    channel: row.channel,
    status: row.status,
    subject: row.subject || undefined,
    recipient: row.recipient,
    messageSnippet: row.messageSnippet || undefined,
    dryRun: !!row.dryRun,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
  } as CampaignHistoryRecord;
}

export async function listTenantDispatches(
  ctx: TenantContext,
  query: DispatchHistoryQuery
): Promise<{ records: CampaignHistoryRecord[]; total: number; page: number; pageSize: number }> {
  const where = dispatchWhere(ctx, query);
  const pageSize = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const page = Math.max(1, Number(query.page) || 1);
  const [rows, total] = await Promise.all([
    prisma.campaignDispatch.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.campaignDispatch.count({ where }),
  ]);
  return { records: rows.map(toHistoryRecord), total, page, pageSize };
}

/** Rows for a downloadable report: same filters as the table, capped. */
export async function exportTenantDispatches(
  ctx: TenantContext,
  query: DispatchHistoryQuery
): Promise<CampaignHistoryRecord[]> {
  const rows = await prisma.campaignDispatch.findMany({
    where: dispatchWhere(ctx, query),
    orderBy: { occurredAt: "desc" },
    take: EXPORT_ROW_CAP,
  });
  return rows.map(toHistoryRecord);
}

export async function getTenantDispatch(ctx: TenantContext, id: string): Promise<CampaignHistoryRecord | null> {
  const row = await prisma.campaignDispatch.findFirst({ where: { id, tenantId: ctx.tenantId } });
  return row ? toHistoryRecord(row) : null;
}

/**
 * Applies only the fields the caller actually sent. The delivery outcome is
 * restricted to the two states a sender can produce, so the audit trail cannot
 * be edited into a state no send could have reached.
 */
export async function updateTenantDispatch(
  ctx: TenantContext,
  id: string,
  patch: DispatchHistoryUpdate
): Promise<CampaignHistoryRecord | null> {
  const data: Record<string, unknown> = {};
  if (typeof patch.businessName === "string") data.businessName = patch.businessName.trim().slice(0, 200);
  if (typeof patch.recipient === "string") data.recipient = patch.recipient.trim().slice(0, 200);
  if (typeof patch.subject === "string") data.subject = patch.subject.slice(0, 500);
  if (typeof patch.messageSnippet === "string") data.messageSnippet = patch.messageSnippet.slice(0, 500);
  if (patch.status !== undefined) {
    if (patch.status !== "SENT" && patch.status !== "FAILED") throw new Error("status must be SENT or FAILED.");
    data.status = patch.status;
  }
  if (Object.keys(data).length === 0) throw new Error("No editable fields were provided.");

  const updated = await prisma.campaignDispatch.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
  if (updated.count !== 1) return null;
  return getTenantDispatch(ctx, id);
}

export async function deleteTenantDispatch(ctx: TenantContext, id: string): Promise<boolean> {
  const removed = await prisma.campaignDispatch.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  return removed.count === 1;
}

export async function deleteTenantDispatches(ctx: TenantContext, ids: string[]): Promise<number> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim()))).slice(0, 1_000);
  if (unique.length === 0) return 0;
  const removed = await prisma.campaignDispatch.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: unique } } });
  return removed.count;
}
