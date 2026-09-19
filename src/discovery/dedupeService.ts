/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant-scoped deduplication of discovered businesses.
 *
 * Replaces `src/duplicateChecker.ts`, which kept every business ever harvested
 * in one `processed-leads.json` file in the process working directory. Three
 * problems, in descending order of seriousness:
 *
 *   1. No tenant dimension. One workspace discovering "Smile Dental" suppressed
 *      that business for every other workspace in the deployment — a tenant
 *      could silently deny leads to a competitor using the same platform.
 *   2. `GET /api/processed` served the whole file to any authenticated caller,
 *      disclosing every tenant's prospect list.
 *   3. Every candidate lead re-read and linearly scanned the entire file.
 *
 * Here the fingerprint is a digest of the normalised name and address, unique per
 * workspace, so the check is a single indexed lookup and cannot cross a
 * workspace boundary.
 *
 * Businesses that were seen and then filtered out are recorded too, with a null
 * `leadId`. Remembering a rejection is what stops the next run spending four page
 * loads to reach the same conclusion.
 */

import crypto from "node:crypto";
import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";

/**
 * Normalises a name or address for comparison.
 *
 * Strips everything outside letters and digits, so "Dr. Patil's Clinic, 12 Main
 * St." and "dr patils clinic 12 main st" collide as they should. Accented
 * characters are kept — dropping them would merge genuinely different names in
 * scripts where the accent is not decoration.
 */
function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Fingerprint for a business within a workspace.
 *
 * Name and address together, because the name alone collides across branches of
 * a chain — "Apollo Diagnostics" in two suburbs are two prospects — and the
 * address alone collides in a shared building.
 */
export function fingerprintOf(businessName: string, address?: string | null): string {
  const key = `${normalize(businessName)}|${normalize(address)}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface SeenBusiness {
  id: string;
  fingerprint: string;
  businessName: string;
  address: string | null;
  leadId: string | null;
  timesSeen: number;
  lastSeenAt: Date;
}

/** Whether this workspace has already encountered a business. */
export async function isAlreadyDiscovered(
  ctx: TenantContext,
  businessName: string,
  address?: string | null
): Promise<boolean> {
  const fingerprint = fingerprintOf(businessName, address);
  const existing = await prisma.discoveredBusiness.findUnique({
    where: { tenantId_fingerprint: { tenantId: ctx.tenantId, fingerprint } },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Loads the fingerprints a workspace has already seen.
 *
 * One query per run instead of one per candidate. A discovery run examines up to
 * a few thousand businesses, and the alternative is that many round trips to a
 * remote database that is already known to drop connections intermittently.
 */
export async function loadSeenFingerprints(ctx: TenantContext): Promise<Set<string>> {
  const rows = await prisma.discoveredBusiness.findMany({
    where: { tenantId: ctx.tenantId },
    select: { fingerprint: true },
  });
  return new Set(rows.map((r: any) => r.fingerprint));
}

export interface RecordDiscoveryInput {
  businessName: string;
  address?: string | null;
  phone?: string | null;
  category?: string | null;
  /** Set when the business was kept and persisted as a lead. */
  leadId?: string | null;
}

/**
 * Records that a business was encountered.
 *
 * Idempotent: a second sighting bumps the counter rather than failing on the
 * unique constraint, so a re-run over overlapping search results is safe. A
 * `leadId` is only ever added, never cleared — the first successful persist is
 * the one worth keeping a pointer to.
 */
export async function recordDiscovered(
  ctx: TenantContext,
  input: RecordDiscoveryInput
): Promise<void> {
  const fingerprint = fingerprintOf(input.businessName, input.address);

  try {
    await prisma.discoveredBusiness.upsert({
      where: { tenantId_fingerprint: { tenantId: ctx.tenantId, fingerprint } },
      create: {
        tenantId: ctx.tenantId,
        fingerprint,
        businessName: input.businessName.slice(0, 300),
        address: input.address ?? null,
        phone: input.phone ?? null,
        category: input.category ?? null,
        leadId: input.leadId ?? null,
      },
      update: {
        timesSeen: { increment: 1 },
        lastSeenAt: new Date(),
        ...(input.leadId ? { leadId: input.leadId } : {}),
      },
    });
  } catch (err: any) {
    // Dedupe bookkeeping must never abort a run that has already done the
    // expensive work of finding and analysing the business.
    logger.warn(
      `Could not record discovered business "${input.businessName}": ${err?.message || err}`
    );
  }
}

/** Records many sightings. Sequential so one failure cannot lose the rest. */
export async function recordManyDiscovered(
  ctx: TenantContext,
  inputs: RecordDiscoveryInput[]
): Promise<void> {
  for (const input of inputs) {
    await recordDiscovered(ctx, input);
  }
}

export interface DiscoveredPage {
  items: SeenBusiness[];
  total: number;
}

/** The workspace's own discovery history. Replaces GET /api/processed. */
export async function listDiscovered(
  ctx: TenantContext,
  options: { limit?: number; offset?: number } = {}
): Promise<DiscoveredPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const offset = Math.max(0, options.offset ?? 0);

  const [rows, total] = await Promise.all([
    prisma.discoveredBusiness.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.discoveredBusiness.count({ where: { tenantId: ctx.tenantId } }),
  ]);

  return {
    items: rows.map((row: any) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      businessName: row.businessName,
      address: row.address ?? null,
      leadId: row.leadId ?? null,
      timesSeen: row.timesSeen,
      lastSeenAt: row.lastSeenAt,
    })),
    total,
  };
}

/**
 * Forgets the workspace's discovery history, so previously seen businesses can
 * be found again. Scoped to the caller's workspace; returns how many were
 * forgotten.
 */
export async function clearDiscovered(ctx: TenantContext): Promise<number> {
  const { count } = await prisma.discoveredBusiness.deleteMany({
    where: { tenantId: ctx.tenantId },
  });
  logger.info(`Cleared ${count} discovered business record(s) for workspace ${ctx.tenantId}.`);
  return count;
}
