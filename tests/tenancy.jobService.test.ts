/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TESTS — src/tenancy/jobService.ts
 *
 * This is the Phase 2 exit criterion: two workspaces operate concurrently and
 * neither can observe or interfere with the other's work.
 *
 * What it replaces, and what each of those cost:
 *   isScrapingRunning   one boolean for the whole process, so the second
 *                       workspace to press Start got "already active"
 *   scraperResult       one slot, so the last run's counts were shown to every
 *                       workspace
 *   stopRequested       one flag, so Stop aborted whoever happened to be running
 *   campaignProgress    one object, so progress leaked across workspaces
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  TENANT_B,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const {
  startJob,
  findActiveJob,
  finishJob,
  updateJobProgress,
  requestJobCancellation,
  isCancellationRequested,
  getJob,
  getLatestJob,
  reclaimAbandonedJobs,
  canTransition,
  isTerminal,
  ACTIVE_JOB_STATUSES,
} = await import("../src/tenancy/jobService");
const { resolvePermissions } = await import("../src/tenancy/permissions");

/** Minimal TenantContext for a workspace owner. */
function ctxFor(user: { id: string }, workspace: { id: string; name: string; slug: string }) {
  return {
    userId: user.id,
    tenantId: workspace.id,
    membershipId: `tm_${user.id}`,
    role: "owner" as const,
    tenantName: workspace.name,
    tenantSlug: workspace.slug,
    permissions: resolvePermissions("owner"),
  };
}

const CTX_A = ctxFor(TENANT_A, WORKSPACE_A);
const CTX_B = ctxFor(TENANT_B, WORKSPACE_B);

/**
 * An in-memory jobs table, so concurrency behaviour is exercised rather than
 * stubbed one call at a time.
 */
function useFakeJobsTable() {
  const rows: any[] = [];
  let seq = 0;

  mocks.prisma.job.create.mockImplementation(async ({ data }: any) => {
    const row = {
      id: `job_${++seq}`,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      progress: null,
      params: null,
      createdAt: new Date(Date.now() + seq),
      updatedAt: new Date(),
      ...data,
    };
    rows.push(row);
    return row;
  });

  mocks.prisma.job.findFirst.mockImplementation(async ({ where, orderBy }: any) => {
    let found = rows.filter((r) => {
      if (where.id && r.id !== where.id) return false;
      if (where.tenantId && r.tenantId !== where.tenantId) return false;
      if (where.kind && r.kind !== where.kind) return false;
      if (where.status?.in && !where.status.in.includes(r.status)) return false;
      return true;
    });
    if (orderBy?.createdAt === "desc") {
      found = found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return found[0] ?? null;
  });

  mocks.prisma.job.findUnique.mockImplementation(
    async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null
  );

  mocks.prisma.job.update.mockImplementation(async ({ where, data }: any) => {
    const row = rows.find((r) => r.id === where.id);
    if (!row) throw new Error("job not found");
    for (const [k, v] of Object.entries(data)) if (v !== undefined) (row as any)[k] = v;
    return row;
  });

  mocks.prisma.job.updateMany.mockImplementation(async ({ where, data }: any) => {
    const targets = rows.filter((r) => !where.status?.in || where.status.in.includes(r.status));
    for (const row of targets) Object.assign(row, data);
    return { count: targets.length };
  });

  mocks.prisma.job.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter(
      (r) => r.tenantId === where.tenantId && (!where.kind || r.kind === where.kind)
    )
  );

  return rows;
}

let rows: any[];

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  rows = useFakeJobsTable();
});

describe("concurrency across workspaces", () => {
  /** THE exit criterion. */
  it("lets two workspaces run lead discovery at the same time", async () => {
    const a = await startJob(CTX_A, "lead_discovery", { location: "Pune" });
    const b = await startJob(CTX_B, "lead_discovery", { location: "Mumbai" });

    expect(a.job).not.toBeNull();
    expect(b.job).not.toBeNull();
    expect(a.job.tenantId).toBe(WORKSPACE_A.id);
    expect(b.job.tenantId).toBe(WORKSPACE_B.id);
    expect(a.job.id).not.toBe(b.job.id);
  });

  it("keeps each workspace's search parameters separate", async () => {
    const a = await startJob(CTX_A, "lead_discovery", { location: "Pune", maxResults: 10 });
    const b = await startJob(CTX_B, "lead_discovery", { location: "Mumbai", maxResults: 500 });

    // The old shared CONFIG singleton meant the second Start silently rewrote
    // the first run's parameters mid-flight.
    expect(JSON.parse(a.job.params)).toMatchObject({ location: "Pune", maxResults: 10 });
    expect(JSON.parse(b.job.params)).toMatchObject({ location: "Mumbai", maxResults: 500 });
  });

  it("refuses a second concurrent run within the SAME workspace", async () => {
    const first = await startJob(CTX_A, "lead_discovery", {});
    const second = await startJob(CTX_A, "lead_discovery", {});

    expect(first.job).not.toBeNull();
    expect(second.job).toBeNull();
    expect(second.conflict.id).toBe(first.job.id);
  });

  it("does not let a scrape block that workspace's campaign", async () => {
    const scrape = await startJob(CTX_A, "lead_discovery", {});
    const campaign = await startJob(CTX_A, "campaign", {});

    // The slot is per workspace AND per kind.
    expect(scrape.job).not.toBeNull();
    expect(campaign.job).not.toBeNull();
  });

  it("frees the slot once the run finishes", async () => {
    const first = await startJob(CTX_A, "lead_discovery", {});
    await finishJob(first.job.id, "completed", { result: { addedCount: 3 } });

    const second = await startJob(CTX_A, "lead_discovery", {});
    expect(second.job).not.toBeNull();
  });
});

describe("isolation of progress and results", () => {
  it("shows a workspace only its own job", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await startJob(CTX_B, "lead_discovery", {});

    // Tenant B naming tenant A's job id gets nothing.
    expect(await getJob(CTX_B, a.job.id)).toBeNull();
    expect((await getJob(CTX_A, a.job.id))!.id).toBe(a.job.id);
  });

  it("reports each workspace's own latest run", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    const b = await startJob(CTX_B, "lead_discovery", {});

    await updateJobProgress(a.job.id, { stage: "analysing", current: 5, total: 10 });
    await updateJobProgress(b.job.id, { stage: "analysing", current: 90, total: 100 });

    const latestA = await getLatestJob(CTX_A, "lead_discovery");
    const latestB = await getLatestJob(CTX_B, "lead_discovery");

    expect(latestA!.progress).toMatchObject({ current: 5, total: 10 });
    expect(latestB!.progress).toMatchObject({ current: 90, total: 100 });
  });

  it("merges progress updates rather than replacing them", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await updateJobProgress(a.job.id, { stage: "discovered", total: 40 });
    await updateJobProgress(a.job.id, { current: 12 });

    const job = await getJob(CTX_A, a.job.id);
    expect(job!.progress).toMatchObject({ stage: "discovered", total: 40, current: 12 });
  });

  it("ignores progress written after the job has finished", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await finishJob(a.job.id, "completed", { result: { addedCount: 1 } });
    await updateJobProgress(a.job.id, { stage: "late", current: 999 });

    const job = await getJob(CTX_A, a.job.id);
    expect(job!.progress.stage).not.toBe("late");
  });
});

describe("cancellation is owned", () => {
  /** The old global Stop aborted whichever run was in flight. */
  it("does not let one workspace cancel another's run", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});

    const outcome = await requestJobCancellation(CTX_B, a.job.id);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not_found");
    expect(await isCancellationRequested(a.job.id)).toBe(false);
  });

  it("cancels the caller's own run", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});

    const outcome = await requestJobCancellation(CTX_A, a.job.id);

    expect(outcome.ok).toBe(true);
    expect(await isCancellationRequested(a.job.id)).toBe(true);
  });

  it("leaves the other workspace's run untouched when one cancels", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    const b = await startJob(CTX_B, "lead_discovery", {});

    await requestJobCancellation(CTX_A, a.job.id);

    expect(await isCancellationRequested(a.job.id)).toBe(true);
    expect(await isCancellationRequested(b.job.id)).toBe(false);
  });

  it("refuses to cancel a run that already finished", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await finishJob(a.job.id, "completed");

    const outcome = await requestJobCancellation(CTX_A, a.job.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("already_finished");
  });

  it("treats a vanished job as cancelled so a worker stops rather than spinning", async () => {
    expect(await isCancellationRequested("job_that_does_not_exist")).toBe(true);
  });
});

describe("state machine", () => {
  it("permits only the intended transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("running", "cancelling")).toBe(true);
    expect(canTransition("cancelling", "cancelled")).toBe(true);

    // Terminal is terminal.
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
  });

  it("recognises terminal statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    for (const s of ACTIVE_JOB_STATUSES) expect(isTerminal(s)).toBe(false);
  });

  /** A late worker callback must not resurrect or rewrite a settled job. */
  it("ignores an illegal finish transition", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await finishJob(a.job.id, "cancelled");
    await finishJob(a.job.id, "completed", { result: { addedCount: 99 } });

    const job = await getJob(CTX_A, a.job.id);
    expect(job!.status).toBe("cancelled");
    expect(job!.result).toBeNull();
  });

  it("truncates a long error rather than storing a whole stack trace", async () => {
    const a = await startJob(CTX_A, "lead_discovery", {});
    await finishJob(a.job.id, "failed", { error: "x".repeat(5000) });

    const job = await getJob(CTX_A, a.job.id);
    expect(job!.error!.length).toBe(2000);
  });
});

describe("recovery after a crash", () => {
  /**
   * Without this, a job left "running" by a dead process holds its workspace's
   * slot forever and no new run can ever start there.
   */
  it("fails interrupted jobs so the slot is released", async () => {
    await startJob(CTX_A, "lead_discovery", {});
    await startJob(CTX_B, "campaign", {});

    const reclaimed = await reclaimAbandonedJobs();
    expect(reclaimed).toBe(2);

    expect(await findActiveJob(WORKSPACE_A.id, "lead_discovery")).toBeNull();

    const restarted = await startJob(CTX_A, "lead_discovery", {});
    expect(restarted.job).not.toBeNull();
  });

  it("explains the interruption on the job it failed", async () => {
    await startJob(CTX_A, "lead_discovery", {});
    await reclaimAbandonedJobs();

    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("restarted");
  });
});
