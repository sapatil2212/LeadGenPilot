/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — reporting reconciles with what was actually sent.
 *
 * Two things are verified here. First, that the Reports surface (list, export,
 * view, edit, delete, bulk delete) is backed by tenant-owned rows rather than the
 * empty placeholders it used to return, and that every one of those operations
 * carries the workspace predicate. Second, that campaign status is derived from
 * CampaignMessage rows, so the progress panel cannot claim a delivery the message
 * table does not support — the specific way a dashboard loses trust.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeCampaignDb, jobRow, messageRow } from "./helpers/fakeCampaignDb";

const mocks = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, property) => mocks.prisma[property as any] }),
}));

const dispatchService = await import("../src/campaign/campaignDispatchService");
const { getCampaignStatus, IDLE_PROGRESS } = await import("../src/campaign/campaignStatusService");

const CTX_A: any = {
  tenantId: "tenant-a", userId: "user-a", membershipId: "member-a", role: "owner",
  tenantName: "A", tenantSlug: "a", permissions: new Set<string>(),
};
const CTX_B: any = { ...CTX_A, tenantId: "tenant-b", userId: "user-b" };

function dispatchRow(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? `dispatch-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: "tenant-a",
    campaignId: "campaign-a",
    campaignMessageId: null,
    leadId: null,
    businessName: "Acme Dental",
    recipient: "owner@acme.test",
    channel: "email",
    status: "SENT",
    sourceType: "reviewed_campaign",
    sourceLabel: "Spring outreach",
    dryRun: false,
    subject: "Hello",
    messageSnippet: "Body copy",
    errorMessage: null,
    externalMessageId: "smtp-1",
    occurredAt: new Date("2026-03-01T10:00:00.000Z"),
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    ...overrides,
  };
}

let db: ReturnType<typeof createFakeCampaignDb>;

function seed(rows: any[] = [], extra: Record<string, any> = {}) {
  db = createFakeCampaignDb({ campaignDispatches: rows, ...extra });
  mocks.prisma = db.prisma;
}

beforeEach(() => seed());

describe("report reads are tenant-owned and real", () => {
  beforeEach(() => {
    seed([
      dispatchRow({ id: "d1", businessName: "Acme Dental", channel: "email", status: "SENT" }),
      dispatchRow({ id: "d2", businessName: "Bright Cafe", channel: "whatsapp", status: "FAILED", recipient: "+15550102030" }),
      dispatchRow({ id: "d3", tenantId: "tenant-b", businessName: "Other Workspace" }),
    ]);
  });

  it("returns only the caller's rows, with a total for pagination", async () => {
    const page = await dispatchService.listTenantDispatches(CTX_A, {});

    expect(page.total).toBe(2);
    expect(page.records.map((row) => row.businessName).sort()).toEqual(["Acme Dental", "Bright Cafe"]);
  });

  it("does not return the other workspace's rows to that workspace's neighbour", async () => {
    const page = await dispatchService.listTenantDispatches(CTX_B, {});
    expect(page.records.map((row) => row.businessName)).toEqual(["Other Workspace"]);
  });

  it("filters by channel and status", async () => {
    expect((await dispatchService.listTenantDispatches(CTX_A, { channel: "whatsapp" })).records).toHaveLength(1);
    expect((await dispatchService.listTenantDispatches(CTX_A, { status: "FAILED" })).records[0].businessName).toBe("Bright Cafe");
  });

  it("ignores a filter value that is not a real channel or status", async () => {
    const page = await dispatchService.listTenantDispatches(CTX_A, { channel: "all", status: "all" });
    expect(page.total).toBe(2);
  });

  it("searches the business name and the recipient", async () => {
    expect((await dispatchService.listTenantDispatches(CTX_A, { search: "bright" })).records).toHaveLength(1);
    expect((await dispatchService.listTenantDispatches(CTX_A, { search: "5550102030" })).records).toHaveLength(1);
  });

  it("restricts a date range without dropping the tenant predicate", async () => {
    seed([
      dispatchRow({ id: "d1", occurredAt: new Date("2026-03-01T10:00:00.000Z") }),
      dispatchRow({ id: "d2", occurredAt: new Date("2026-04-01T10:00:00.000Z") }),
      dispatchRow({ id: "d3", tenantId: "tenant-b", occurredAt: new Date("2026-03-15T10:00:00.000Z") }),
    ]);

    const page = await dispatchService.listTenantDispatches(CTX_A, { from: "2026-03-10", to: "2026-05-01" });

    expect(page.records.map((row) => row.id)).toEqual(["d2"]);
  });

  it("ignores an unparseable date instead of returning nothing", async () => {
    const page = await dispatchService.listTenantDispatches(CTX_A, { from: "not-a-date" });
    expect(page.total).toBe(2);
  });

  it("paginates and caps the page size", async () => {
    const page = await dispatchService.listTenantDispatches(CTX_A, { limit: 1, page: 2 });
    expect(page.records).toHaveLength(1);
    expect(page.pageSize).toBe(1);

    const capped = await dispatchService.listTenantDispatches(CTX_A, { limit: 10_000 });
    expect(capped.pageSize).toBe(500);
  });
});

describe("export returns the same rows as the table", () => {
  it("exports the caller's filtered rows rather than an empty report", async () => {
    seed([
      dispatchRow({ id: "d1", channel: "email" }),
      dispatchRow({ id: "d2", channel: "whatsapp" }),
      dispatchRow({ id: "d3", tenantId: "tenant-b", channel: "email" }),
    ]);

    const all = await dispatchService.exportTenantDispatches(CTX_A, {});
    const emailOnly = await dispatchService.exportTenantDispatches(CTX_A, { channel: "email" });

    expect(all).toHaveLength(2);
    expect(emailOnly).toHaveLength(1);
    expect(emailOnly[0].channel).toBe("email");
  });

  it("caps the export so a full-history download cannot be unbounded", async () => {
    const spy = vi.fn(async (_args: any) => [] as any[]);
    seed();
    mocks.prisma.campaignDispatch.findMany = spy;

    await dispatchService.exportTenantDispatches(CTX_A, {});

    expect(spy.mock.calls[0][0].take).toBe(dispatchService.EXPORT_ROW_CAP);
  });
});

describe("single-record operations refuse cross-workspace access", () => {
  beforeEach(() => {
    seed([dispatchRow({ id: "mine" }), dispatchRow({ id: "theirs", tenantId: "tenant-b" })]);
  });

  it("reads the caller's own record", async () => {
    const record = await dispatchService.getTenantDispatch(CTX_A, "mine");
    expect(record).toMatchObject({ id: "mine", status: "SENT", channel: "email" });
  });

  it("cannot read another workspace's record", async () => {
    expect(await dispatchService.getTenantDispatch(CTX_A, "theirs")).toBeNull();
  });

  it("edits only the fields that were supplied", async () => {
    const updated = await dispatchService.updateTenantDispatch(CTX_A, "mine", { businessName: "  Acme Dental Group  " });

    expect(updated?.businessName).toBe("Acme Dental Group");
    // Untouched columns must survive the patch.
    expect(updated?.subject).toBe("Hello");
    expect(updated?.status).toBe("SENT");
  });

  it("refuses a delivery status no sender could produce", async () => {
    await expect(dispatchService.updateTenantDispatch(CTX_A, "mine", { status: "DELIVERED_MAYBE" })).rejects.toThrow(/SENT or FAILED/);
    expect(db.state.campaignDispatches.find((row: any) => row.id === "mine").status).toBe("SENT");
  });

  it("refuses an empty patch", async () => {
    await expect(dispatchService.updateTenantDispatch(CTX_A, "mine", {})).rejects.toThrow(/No editable fields/);
  });

  it("cannot edit another workspace's record", async () => {
    expect(await dispatchService.updateTenantDispatch(CTX_A, "theirs", { businessName: "hijacked" })).toBeNull();
    expect(db.state.campaignDispatches.find((row: any) => row.id === "theirs").businessName).toBe("Acme Dental");
  });

  it("deletes the caller's own record and reports success", async () => {
    expect(await dispatchService.deleteTenantDispatch(CTX_A, "mine")).toBe(true);
    expect(db.state.campaignDispatches.map((row: any) => row.id)).toEqual(["theirs"]);
  });

  it("cannot delete another workspace's record", async () => {
    expect(await dispatchService.deleteTenantDispatch(CTX_A, "theirs")).toBe(false);
    expect(db.state.campaignDispatches).toHaveLength(2);
  });
});

describe("bulk delete", () => {
  it("removes only the ids the caller owns, silently skipping the rest", async () => {
    seed([dispatchRow({ id: "a" }), dispatchRow({ id: "b" }), dispatchRow({ id: "c", tenantId: "tenant-b" })]);

    const removed = await dispatchService.deleteTenantDispatches(CTX_A, ["a", "b", "c", "does-not-exist"]);

    expect(removed).toBe(2);
    expect(db.state.campaignDispatches.map((row: any) => row.id)).toEqual(["c"]);
  });

  it("does nothing for an empty or malformed id list", async () => {
    seed([dispatchRow({ id: "a" })]);
    expect(await dispatchService.deleteTenantDispatches(CTX_A, [])).toBe(0);
    expect(await dispatchService.deleteTenantDispatches(CTX_A, ["", "   "])).toBe(0);
    expect(db.state.campaignDispatches).toHaveLength(1);
  });

  it("caps an oversized bulk request", async () => {
    const spy = vi.fn(async (_args: any) => ({ count: 0 }));
    seed();
    mocks.prisma.campaignDispatch.deleteMany = spy;

    await dispatchService.deleteTenantDispatches(CTX_A, Array.from({ length: 5_000 }, (_, index) => `id-${index}`));

    expect(spy.mock.calls[0][0].where.id.in).toHaveLength(1_000);
    expect(spy.mock.calls[0][0].where.tenantId).toBe("tenant-a");
  });
});

describe("campaign status is derived from message rows", () => {
  it("reports idle when the workspace has never run a campaign", async () => {
    seed();
    const status = await getCampaignStatus(CTX_A);
    expect(status).toMatchObject({ isRunning: false, jobId: null, campaignId: null });
    expect(status.progress).toEqual(IDLE_PROGRESS);
  });

  it("reconciles per-channel counts with the message table", async () => {
    seed([], {
      jobs: [jobRow({ id: "job-1", status: "running", workerId: "worker-1", leaseToken: "t1" })],
      campaignMessages: [
        messageRow({ id: "m1", status: "sent" }),
        messageRow({ id: "m2", status: "failed" }),
        messageRow({ id: "m3", status: "suppressed" }),
        messageRow({ id: "m4", status: "approved" }),
        messageRow({ id: "m5", channel: "whatsapp", status: "sent", recipient: "+15550102030" }),
        messageRow({ id: "m6", channel: "whatsapp", status: "failed", recipient: "+15550102031" }),
        // Rejected and unreviewed messages were never part of this run.
        messageRow({ id: "m7", status: "rejected" }),
        messageRow({ id: "m8", status: "pending_review" }),
      ],
    });

    const status = await getCampaignStatus(CTX_A);

    expect(status.isRunning).toBe(true);
    expect(status.jobStatus).toBe("running");
    expect(status.progress).toMatchObject({
      emailsSent: 1,
      emailsFailed: 1,
      whatsappSent: 1,
      whatsappFailed: 1,
      skipped: 1,
      current: 5,
      total: 6,
    });
    expect(status.progress.status).toBe("Sending 5/6");
  });

  it("describes a queued run as queued rather than as running", async () => {
    seed([], { jobs: [jobRow({ id: "job-1", status: "queued" })], campaignMessages: [messageRow({ id: "m1" })] });

    const status = await getCampaignStatus(CTX_A);

    expect(status.isRunning).toBe(true);
    expect(status.progress.status).toMatch(/queued/i);
    expect(status.progress.current).toBe(0);
  });

  it("stops reporting a finished run as running", async () => {
    seed([], {
      jobs: [jobRow({ id: "job-1", status: "completed", finishedAt: new Date() })],
      campaignMessages: [messageRow({ id: "m1", status: "sent" })],
    });

    const status = await getCampaignStatus(CTX_A);

    expect(status.isRunning).toBe(false);
    expect(status.progress.status).toBe("Completed");
    expect(status.progress.emailsSent).toBe(1);
  });

  it("surfaces the recorded failure reason for a failed run", async () => {
    seed([], {
      jobs: [jobRow({ id: "job-1", status: "failed", error: "Campaign no longer exists." })],
      campaignMessages: [],
    });

    const status = await getCampaignStatus(CTX_A);

    expect(status.isRunning).toBe(false);
    expect(status.progress.status).toMatch(/Campaign no longer exists/);
  });

  it("never reports another workspace's run", async () => {
    seed([], {
      jobs: [jobRow({ id: "job-1", tenantId: "tenant-b", status: "running" })],
      campaignMessages: [messageRow({ id: "m1", tenantId: "tenant-b", status: "sent" })],
    });

    const status = await getCampaignStatus(CTX_A);

    expect(status).toMatchObject({ isRunning: false, jobId: null, campaignId: null });
  });

  it("counts only the caller's messages when both workspaces run the same campaign id", async () => {
    seed([], {
      jobs: [jobRow({ id: "job-1", status: "running" })],
      campaignMessages: [
        messageRow({ id: "m1", status: "sent" }),
        messageRow({ id: "m2", tenantId: "tenant-b", status: "sent" }),
        messageRow({ id: "m3", tenantId: "tenant-b", status: "sent" }),
      ],
    });

    const status = await getCampaignStatus(CTX_A);

    expect(status.progress.emailsSent).toBe(1);
    expect(status.progress.total).toBe(1);
  });
});
