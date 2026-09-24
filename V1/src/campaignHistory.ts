/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign dispatch history — records every email/WhatsApp send attempt made
 * by the outreach campaign engine (success or failure) so the dashboard can
 * show a real audit trail, summary stats for charts, and exportable reports.
 *
 * Persisted as a capped, atomically-written JSON file (consistent with the
 * rest of the app's lightweight local storage — see src/storage.ts). This is
 * intentionally simple and dependency-free; no schema migration required.
 */

import path from "path";
import { readJson, writeJsonAtomic, withLock } from "./storage";

export interface CampaignHistoryRecord {
  id: string;
  campaignId: string;
  timestamp: string; // ISO
  businessName: string;
  channel: "email" | "whatsapp";
  status: "SENT" | "FAILED";
  recipient: string;
  subject?: string;
  messageSnippet?: string;
  dryRun: boolean;
  sourceType: "list" | "sheet" | "manual";
  sourceLabel: string;
}

const HISTORY_PATH = path.join(process.cwd(), "campaign-history.json");
const MAX_RECORDS = 5000;

export function loadCampaignHistory(): CampaignHistoryRecord[] {
  return readJson<CampaignHistoryRecord[]>(HISTORY_PATH, []);
}

/** Append one dispatch record, capping the file to the most recent MAX_RECORDS. */
export async function appendCampaignHistory(record: Omit<CampaignHistoryRecord, "id" | "timestamp">): Promise<void> {
  await withLock("campaign-history", () => {
    const existing = loadCampaignHistory();
    const entry: CampaignHistoryRecord = {
      ...record,
      id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    const next = [...existing, entry].slice(-MAX_RECORDS);
    writeJsonAtomic(HISTORY_PATH, next);
  });
}

/** Fetch a single dispatch record by id. */
export function getCampaignHistoryRecord(id: string): CampaignHistoryRecord | null {
  return loadCampaignHistory().find((r) => r.id === id) || null;
}

/** Editable fields for a dispatch record (CRUD "edit" from the Reports table). */
export interface CampaignHistoryUpdate {
  businessName?: string;
  recipient?: string;
  subject?: string;
  messageSnippet?: string;
  status?: "SENT" | "FAILED";
}

/** Update a single dispatch record. Returns the updated record, or null if not found. */
export async function updateCampaignHistoryRecord(
  id: string,
  update: CampaignHistoryUpdate
): Promise<CampaignHistoryRecord | null> {
  return withLock("campaign-history", () => {
    const existing = loadCampaignHistory();
    const idx = existing.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    // Only apply fields that were actually provided. Spreading `update`
    // directly would overwrite existing values with `undefined` for any
    // field the caller omitted (e.g. editing just businessName would wipe
    // recipient/subject/messageSnippet/status).
    const patch: Partial<CampaignHistoryRecord> = {};
    if (update.businessName !== undefined) patch.businessName = update.businessName;
    if (update.recipient !== undefined) patch.recipient = update.recipient;
    if (update.subject !== undefined) patch.subject = update.subject;
    if (update.messageSnippet !== undefined) patch.messageSnippet = update.messageSnippet;
    if (update.status !== undefined) patch.status = update.status;

    const updated: CampaignHistoryRecord = { ...existing[idx], ...patch };
    existing[idx] = updated;
    writeJsonAtomic(HISTORY_PATH, existing);
    return updated;
  });
}

/** Delete a single dispatch record. Returns true if a record was removed. */
export async function deleteCampaignHistoryRecord(id: string): Promise<boolean> {
  return withLock("campaign-history", () => {
    const existing = loadCampaignHistory();
    const next = existing.filter((r) => r.id !== id);
    const removed = next.length !== existing.length;
    if (removed) writeJsonAtomic(HISTORY_PATH, next);
    return removed;
  });
}

/** Delete multiple dispatch records by id. Returns the count actually removed. */
export async function deleteCampaignHistoryRecords(ids: string[]): Promise<number> {
  return withLock("campaign-history", () => {
    const idSet = new Set(ids);
    const existing = loadCampaignHistory();
    const next = existing.filter((r) => !idSet.has(r.id));
    const removedCount = existing.length - next.length;
    if (removedCount > 0) writeJsonAtomic(HISTORY_PATH, next);
    return removedCount;
  });
}

export interface CampaignHistoryQuery {
  channel?: "email" | "whatsapp" | "all";
  status?: "SENT" | "FAILED" | "all";
  campaignId?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  search?: string;
  limit?: number;
}

export function queryCampaignHistory(query: CampaignHistoryQuery = {}): CampaignHistoryRecord[] {
  let records = loadCampaignHistory();

  if (query.channel && query.channel !== "all") {
    records = records.filter((r) => r.channel === query.channel);
  }
  if (query.status && query.status !== "all") {
    records = records.filter((r) => r.status === query.status);
  }
  if (query.campaignId) {
    records = records.filter((r) => r.campaignId === query.campaignId);
  }
  if (query.from) {
    const fromTime = new Date(query.from).getTime();
    records = records.filter((r) => new Date(r.timestamp).getTime() >= fromTime);
  }
  if (query.to) {
    const toTime = new Date(query.to).getTime() + 24 * 60 * 60 * 1000 - 1;
    records = records.filter((r) => new Date(r.timestamp).getTime() <= toTime);
  }
  if (query.search && query.search.trim()) {
    const s = query.search.trim().toLowerCase();
    records = records.filter(
      (r) => r.businessName.toLowerCase().includes(s) || r.recipient.toLowerCase().includes(s)
    );
  }

  records = [...records].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (query.limit && query.limit > 0) {
    records = records.slice(0, query.limit);
  }
  return records;
}

/** Aggregate summary + time-series buckets used to power the dashboard charts. */
export function summarizeCampaignHistory(records: CampaignHistoryRecord[]) {
  const totalSent = records.filter((r) => r.status === "SENT").length;
  const totalFailed = records.filter((r) => r.status === "FAILED").length;
  const emailSent = records.filter((r) => r.channel === "email" && r.status === "SENT").length;
  const emailFailed = records.filter((r) => r.channel === "email" && r.status === "FAILED").length;
  const whatsappSent = records.filter((r) => r.channel === "whatsapp" && r.status === "SENT").length;
  const whatsappFailed = records.filter((r) => r.channel === "whatsapp" && r.status === "FAILED").length;

  // Bucket by day (last 14 days present in the data) for a trend chart.
  const byDay = new Map<string, { date: string; sent: number; failed: number; email: number; whatsapp: number }>();
  for (const r of records) {
    const day = r.timestamp.split("T")[0];
    if (!byDay.has(day)) byDay.set(day, { date: day, sent: 0, failed: 0, email: 0, whatsapp: 0 });
    const bucket = byDay.get(day)!;
    if (r.status === "SENT") bucket.sent++;
    else bucket.failed++;
    if (r.channel === "email") bucket.email++;
    else bucket.whatsapp++;
  }
  const timeline = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

  return {
    totalSent,
    totalFailed,
    emailSent,
    emailFailed,
    whatsappSent,
    whatsappFailed,
    total: records.length,
    successRate: records.length > 0 ? Math.round((totalSent / records.length) * 100) : 0,
    timeline,
  };
}
