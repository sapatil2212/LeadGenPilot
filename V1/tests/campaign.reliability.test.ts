/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — durable campaign worker reliability.
 *
 * These tests run the real executor against an in-memory database that enforces
 * conditional-write semantics (see tests/helpers/fakeCampaignDb.ts), because every
 * guarantee under test is expressed as a `where` clause rather than as control
 * flow. They cover the failure modes that cost money or trust when they break:
 * contacting somebody twice, contacting somebody who opted out, losing a run to a
 * restart, retrying a permanent failure forever, and reporting numbers the
 * message rows do not support.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeCampaignDb, jobRow, messageRow } from "./helpers/fakeCampaignDb";

// A short renewal interval so lease keep-alive can be observed without waiting
// out the production 15s cadence.
process.env.CAMPAIGN_LEASE_RENEW_MS = "15";

const mocks = vi.hoisted(() => ({
  prisma: null as any,
  sendEmail: vi.fn(),
  sendWhatsApp: vi.fn(),
  integration: vi.fn(),
  recordOutbound: vi.fn(),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, property) => mocks.prisma[property as any] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));
vi.mock("../src/outreachService", () => ({ sendEmailOutreach: mocks.sendEmail, getWhatsAppStatus: () => ({ status: "CONNECTED" }) }));
vi.mock("../src/whatsappGateway", () => ({ sendWhatsAppUnified: mocks.sendWhatsApp }));
vi.mock("../src/userIntegrationService", () => ({ getUserIntegration: mocks.integration }));
vi.mock("../src/conversations/conversationService", () => ({ recordOutbound: mocks.recordOutbound }));

const {
  enqueueCampaignExecution,
  claimNextCampaignJob,
  runClaimedCampaignJob,
  runCampaignWorkerCycle,
  recoverStaleCampaignLeases,
  cancelCampaignExecution,
  deliveryIdempotencyKey,
} = await import("../src/campaign/campaignExecutor");

const CTX_A: any = {
  tenantId: "tenant-a",
  userId: "user-a",
  membershipId: "member-a",
  role: "owner",
  tenantName: "Tenant A",
  tenantSlug: "tenant-a",
  permissions: new Set<string>(),
};

let db: ReturnType<typeof createFakeCampaignDb>;

function seed(options: { messages?: any[]; jobs?: any[]; campaigns?: any[]; suppressions?: any[]; leads?: any[] } = {}) {
  db = createFakeCampaignDb({
    campaigns: options.campaigns ?? [
      { id: "campaign-a", tenantId: "tenant-a", name: "Spring outreach", status: "approved", startedAt: null, completedAt: null },
    ],
    jobs: options.jobs ?? [],
    campaignMessages: options.messages ?? [],
    suppressions: options.suppressions ?? [],
    leads: options.leads ?? [],
  });
  mocks.prisma = db.prisma;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.integration.mockResolvedValue({ host: "smtp.test", port: 587, secure: true, user: "sender", password: "secret", fromEmail: "sender@test" });
  mocks.sendEmail.mockResolvedValue({ success: true, messageId: "smtp-1" });
  mocks.sendWhatsApp.mockResolvedValue({ ok: true, messageId: "wa-1" });
  mocks.recordOutbound.mockResolvedValue({ id: "thread-1" });
  seed();
});

// ── Enqueue ────────────────────────────────────────────────────────────────

describe("enqueue is atomic", () => {
  it("claims the campaign and queues exactly one job", async () => {
    const result = await enqueueCampaignExecution(CTX_A, "campaign-a", { delayMs: 0, batchSize: 5 });

    expect(result.status).toBe("queued");
    expect(db.state.jobs).toHaveLength(1);
    expect(db.state.jobs[0]).toMatchObject({ tenantId: "tenant-a", kind: "campaign", status: "queued" });
    expect(db.state.campaigns[0].status).toBe("sending");
    // Nothing may be delivered from the request path.
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a second simultaneous execute of the same campaign", async () => {
    const [first, second] = await Promise.allSettled([
      enqueueCampaignExecution(CTX_A, "campaign-a", { delayMs: 0 }),
      enqueueCampaignExecution(CTX_A, "campaign-a", { delayMs: 0 }),
    ]);

    const fulfilled = [first, second].filter((outcome) => outcome.status === "fulfilled");
    const rejected = [first, second].filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(db.state.jobs).toHaveLength(1);
  });

  it("refuses to enqueue a campaign that was never approved", async () => {
    seed({ campaigns: [{ id: "campaign-a", tenantId: "tenant-a", name: "Draft", status: "pending_review" }] });
    await expect(enqueueCampaignExecution(CTX_A, "campaign-a", { delayMs: 0 })).rejects.toThrow(/no longer ready to send|already queued/i);
    expect(db.state.jobs).toHaveLength(0);
  });

  it("cannot enqueue another workspace's campaign", async () => {
    seed({ campaigns: [{ id: "campaign-b", tenantId: "tenant-b", name: "Theirs", status: "approved" }] });
    await expect(enqueueCampaignExecution(CTX_A, "campaign-b", { delayMs: 0 })).rejects.toThrow(/not found/i);
    expect(db.state.jobs).toHaveLength(0);
    expect(db.state.campaigns[0].status).toBe("approved");
  });
});

// ── Job claiming across workers ────────────────────────────────────────────

describe("job claiming", () => {
  it("gives one queued job to exactly one of three competing workers", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })] });

    const claims = await Promise.all([
      claimNextCampaignJob("worker-1"),
      claimNextCampaignJob("worker-2"),
      claimNextCampaignJob("worker-3"),
    ]);

    const winners = claims.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(db.state.jobs[0].status).toBe("running");
    expect(db.state.jobs[0].attempt).toBe(1);
  });

  it("distributes three queued jobs across three workers without overlap", async () => {
    seed({ jobs: [jobRow({ id: "job-1" }), jobRow({ id: "job-2" }), jobRow({ id: "job-3" })] });

    const claims = await Promise.all([
      claimNextCampaignJob("worker-1"),
      claimNextCampaignJob("worker-2"),
      claimNextCampaignJob("worker-3"),
    ]);

    const claimedIds = claims.filter(Boolean).map((job: any) => job.id);
    expect(claimedIds).toHaveLength(3);
    expect(new Set(claimedIds).size).toBe(3);
    const owners = db.state.jobs.map((job: any) => job.workerId);
    expect(new Set(owners).size).toBe(3);
  });

  it("does not steal a job whose lease is still valid", async () => {
    seed({
      jobs: [
        jobRow({
          id: "job-1",
          status: "running",
          workerId: "worker-1",
          leaseToken: "token-1",
          leaseExpiresAt: new Date(Date.now() + 30_000),
        }),
      ],
    });

    expect(await claimNextCampaignJob("worker-2")).toBeNull();
    expect(db.state.jobs[0].workerId).toBe("worker-1");
  });

  it("recovers a job whose worker died, and only after its lease expired", async () => {
    seed({
      jobs: [
        jobRow({
          id: "job-1",
          status: "running",
          workerId: "worker-dead",
          leaseToken: "token-dead",
          leaseExpiresAt: new Date(Date.now() - 1_000),
        }),
      ],
    });

    const recovered = await recoverStaleCampaignLeases();
    expect(recovered.jobs).toBe(1);
    expect(db.state.jobs[0]).toMatchObject({ status: "queued", workerId: null, leaseToken: null });

    const claim = await claimNextCampaignJob("worker-2");
    expect(claim?.workerId).toBe("worker-2");
  });

  it("settles a cancelled job whose worker died rather than letting it run again", async () => {
    seed({
      jobs: [
        jobRow({
          id: "job-1",
          status: "cancelling",
          workerId: "worker-dead",
          leaseToken: "token-dead",
          leaseExpiresAt: new Date(Date.now() - 1_000),
          cancelRequestedAt: new Date(Date.now() - 2_000),
        }),
      ],
    });

    await recoverStaleCampaignLeases();
    expect(db.state.jobs[0].status).toBe("cancelled");
    expect(await claimNextCampaignJob("worker-2")).toBeNull();
  });
});

// ── Delivery, idempotency and recovery ─────────────────────────────────────

describe("message delivery", () => {
  it("sends each approved message once and completes the job", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [
        messageRow({ id: "m1", recipient: "a@acme.test" }),
        messageRow({ id: "m2", recipient: "b@acme.test" }),
      ],
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result).toMatchObject({ sent: 2, failed: 0, skipped: 0, cancelled: false });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(db.state.campaignMessages.every((message: any) => message.status === "sent")).toBe(true);
    expect(db.state.campaignMessages.every((message: any) => message.leaseToken === null)).toBe(true);
    expect(db.state.jobs[0].status).toBe("completed");
    // One report row per message, and the campaign row reflects the outcome.
    expect(db.state.campaignDispatches).toHaveLength(2);
    expect(db.state.campaigns[0]).toMatchObject({ status: "sent", sentCount: 2, failedCount: 0 });
  });

  it("never re-sends a message that was already delivered before a restart", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [
        messageRow({ id: "m1", status: "sent", sentAt: new Date(), externalMessageId: "smtp-existing" }),
        messageRow({ id: "m2", status: "approved" }),
      ],
    });

    const result = await runCampaignWorkerCycle("worker-restarted");

    expect(result?.sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0]).toBe("owner@acme.test");
    expect(db.state.campaignMessages.filter((message: any) => message.status === "sent")).toHaveLength(2);
  });

  it("resumes an interrupted in-flight message only after its lease expires", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [
        messageRow({
          id: "m1",
          status: "sending",
          attemptCount: 1,
          leaseOwner: "worker-dead",
          leaseToken: "token-dead",
          leaseExpiresAt: new Date(Date.now() + 30_000),
        }),
      ],
    });

    // Lease still valid: the surviving worker must leave it alone and finish.
    const blocked = await runCampaignWorkerCycle("worker-2");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(blocked?.sent).toBe(0);

    // Once the lease lapses, recovery hands it back and it is retried exactly once.
    db.state.campaignMessages[0].leaseExpiresAt = new Date(Date.now() - 1_000);
    db.state.jobs[0] = jobRow({ id: "job-2" });
    const resumed = await runCampaignWorkerCycle("worker-3");

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(resumed?.sent).toBe(1);
    expect(db.state.campaignMessages[0].status).toBe("sent");
  });

  it("keeps the message lease alive across a provider call longer than the lease", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    const renewals: number[] = [];
    mocks.sendEmail.mockImplementation(async () => {
      const before = db.state.campaignMessages[0].leaseExpiresAt?.getTime() ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 90));
      const after = db.state.campaignMessages[0].leaseExpiresAt?.getTime() ?? 0;
      renewals.push(after - before);
      return { success: true, messageId: "smtp-1" };
    });

    await runCampaignWorkerCycle("worker-1");

    // The lease expiry moved forward while the send was in flight, which is what
    // stops another worker from recovering and re-sending this message.
    expect(renewals[0]).toBeGreaterThan(0);
    expect(db.state.campaignMessages[0].status).toBe("sent");
  });

  it("records one report row per message even if the worker is restarted mid-run", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });

    await runCampaignWorkerCycle("worker-1");
    // A second cycle finds nothing to do and must not append a duplicate receipt.
    db.state.jobs.push(jobRow({ id: "job-2" }));
    await runCampaignWorkerCycle("worker-2");

    expect(db.state.campaignDispatches).toHaveLength(1);
  });
});

// ── Retry classification ───────────────────────────────────────────────────

describe("retry handling", () => {
  it("schedules a retry with attempt bookkeeping after a transient failure", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    mocks.sendEmail.mockResolvedValue({ success: false, error: "connection reset by peer" });

    const result = await runCampaignWorkerCycle("worker-1");

    const message = db.state.campaignMessages[0];
    expect(message.status).toBe("retry_wait");
    expect(message.attemptCount).toBe(1);
    expect(message.lastAttemptAt).toBeInstanceOf(Date);
    expect(message.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(message.errorMessage).toMatch(/connection reset/i);
    expect(message.leaseOwner).toBeNull();
    // A retry is not a delivery outcome, so no report row and no failure count.
    expect(db.state.campaignDispatches).toHaveLength(0);
    expect(result?.failed).toBe(0);
    expect(result?.deferred).toBe(true);
  });

  it("treats an unroutable recipient as permanent and does not retry it", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1", recipient: "not-an-email" })] });

    const result = await runCampaignWorkerCycle("worker-1");

    const message = db.state.campaignMessages[0];
    expect(message.status).toBe("failed");
    expect(message.nextAttemptAt).toBeNull();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(result?.failed).toBe(1);
    expect(db.state.campaignDispatches[0]).toMatchObject({ status: "FAILED" });
  });

  it("treats a missing integration as permanent rather than retrying forever", async () => {
    mocks.integration.mockResolvedValue(null);
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(db.state.campaignMessages[0].status).toBe("failed");
    expect(db.state.campaignMessages[0].errorMessage).toMatch(/not configured/i);
    expect(result?.failed).toBe(1);
  });

  it("gives up after the attempt ceiling instead of retrying indefinitely", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1", attemptCount: 2, status: "retry_wait", nextAttemptAt: new Date(Date.now() - 1_000) })] });
    mocks.sendEmail.mockResolvedValue({ success: false, error: "temporary provider outage" });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(db.state.campaignMessages[0].status).toBe("failed");
    expect(db.state.campaignMessages[0].attemptCount).toBe(3);
    expect(result?.failed).toBe(1);
  });
});

// ── Cancellation ───────────────────────────────────────────────────────────

describe("cancellation", () => {
  it("settles a cancel issued before any worker claimed the job, and sends nothing after", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });

    const cancelled = await cancelCampaignExecution(CTX_A, "campaign-a");
    expect(cancelled).toMatchObject({ ok: true, jobId: "job-1" });
    // No worker ever held this job, so it must reach a terminal state
    // immediately rather than waiting for a lease that will never expire.
    expect(db.state.jobs[0].status).toBe("cancelled");
    expect(db.state.jobs[0].finishedAt).toBeInstanceOf(Date);
    expect(db.state.campaigns[0].status).toBe("cancelled");

    expect(await runCampaignWorkerCycle("worker-1")).toBeNull();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.state.campaignMessages[0].status).toBe("approved");
  });

  it("observes a cancel requested while the job was already claimed", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    const claimed = await claimNextCampaignJob("worker-1");
    await cancelCampaignExecution(CTX_A, "campaign-a");
    expect(db.state.jobs[0].status).toBe("cancelling");

    const result = await runClaimedCampaignJob(claimed);

    expect(result.cancelled).toBe(true);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.state.jobs[0].status).toBe("cancelled");
    expect(db.state.campaigns[0].status).toBe("cancelled");
  });

  it("stops starting new messages once cancellation is observed mid-run, and keeps sent ones sent", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1" }), messageRow({ id: "m2" }), messageRow({ id: "m3" })],
    });
    // Cancel as soon as the first delivery completes.
    mocks.sendEmail.mockImplementationOnce(async () => {
      await cancelCampaignExecution(CTX_A, "campaign-a");
      return { success: true, messageId: "smtp-1" };
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result?.cancelled).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.state.campaignMessages.filter((message: any) => message.status === "sent")).toHaveLength(1);
    expect(db.state.campaignMessages.filter((message: any) => message.status === "approved")).toHaveLength(2);
    expect(db.state.jobs[0].status).toBe("cancelled");
  });

  it("cannot cancel another workspace's run", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      campaigns: [{ id: "campaign-a", tenantId: "tenant-a", name: "Mine", status: "sending" }],
    });
    const otherTenant = { ...CTX_A, tenantId: "tenant-b" };

    expect(await cancelCampaignExecution(otherTenant, "campaign-a")).toEqual({ ok: false });
    expect(db.state.jobs[0].status).toBe("queued");
  });
});

// ── Delivery idempotency ───────────────────────────────────────────────────

describe("delivery idempotency", () => {
  it("derives a stable key and persists it on the message and the report", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });

    await runCampaignWorkerCycle("worker-1");

    const stored = db.state.campaignMessages[0].idempotencyKey;
    expect(stored).toMatch(/^[0-9a-f]{32}$/);
    expect(stored).toBe(deliveryIdempotencyKey("tenant-a", "m1"));
    // The report carries it too, so a duplicate can be recognised afterwards.
    expect(db.state.campaignDispatches[0].idempotencyKey).toBe(stored);
  });

  it("reuses the same key on a retry instead of minting a new one", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: "connection reset by peer" });

    await runCampaignWorkerCycle("worker-1");
    const firstKey = mocks.sendEmail.mock.calls[0][4]?.idempotencyKey;

    // Make the retry due and run another cycle, as recovery would.
    db.state.campaignMessages[0].nextAttemptAt = new Date(Date.now() - 1_000);
    db.state.jobs.push(jobRow({ id: "job-2" }));
    await runCampaignWorkerCycle("worker-2");

    const secondKey = mocks.sendEmail.mock.calls[1][4]?.idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    expect(db.state.campaignMessages[0].status).toBe("sent");
  });

  it("gives two messages different keys", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", recipient: "a@acme.test" }), messageRow({ id: "m2", recipient: "b@acme.test" })],
    });

    await runCampaignWorkerCycle("worker-1");

    const keys = db.state.campaignMessages.map((message: any) => message.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("scopes the key to the workspace that produced it", () => {
    expect(deliveryIdempotencyKey("tenant-a", "m1")).not.toBe(deliveryIdempotencyKey("tenant-b", "m1"));
  });

  it("passes the key to the email transport on every send", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });

    await runCampaignWorkerCycle("worker-1");

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "owner@acme.test",
      "Hello",
      "Body copy",
      expect.objectContaining({ host: "smtp.test" }),
      expect.objectContaining({ idempotencyKey: deliveryIdempotencyKey("tenant-a", "m1") })
    );
  });

  it("keeps the key it was generated with when a message is recovered after a lease expiry", async () => {
    const existingKey = deliveryIdempotencyKey("tenant-a", "m1");
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [
        messageRow({
          id: "m1",
          status: "sending",
          attemptCount: 1,
          idempotencyKey: existingKey,
          leaseOwner: "worker-dead",
          leaseToken: "token-dead",
          leaseExpiresAt: new Date(Date.now() - 1_000),
        }),
      ],
    });

    await runCampaignWorkerCycle("worker-2");

    expect(mocks.sendEmail.mock.calls[0][4]?.idempotencyKey).toBe(existingKey);
    expect(db.state.campaignMessages[0].idempotencyKey).toBe(existingKey);
  });
});

// ── Suppression, CRM and inbox ─────────────────────────────────────────────

describe("compliance and downstream synchronisation", () => {
  it("never delivers to a suppressed contact and reports it as skipped", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", recipient: "OptedOut@Acme.test" }), messageRow({ id: "m2", recipient: "ok@acme.test" })],
      suppressions: [{ id: "s1", tenantId: "tenant-a", channel: "email", contactKey: "optedout@acme.test", reason: "opt_out_reply", createdAt: new Date() }],
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0]).toBe("ok@acme.test");
    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: 1 });
    const suppressed = db.state.campaignMessages.find((message: any) => message.id === "m1");
    expect(suppressed.status).toBe("suppressed");
    // A compliance skip is not a delivery failure, so it gets no report row.
    expect(db.state.campaignDispatches).toHaveLength(1);
    expect(db.state.campaigns[0].skippedCount).toBe(1);
  });

  it("does not apply another workspace's suppression", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", recipient: "shared@acme.test" })],
      suppressions: [{ id: "s1", tenantId: "tenant-b", channel: "email", contactKey: "shared@acme.test", reason: "manual", createdAt: new Date() }],
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result).toMatchObject({ sent: 1, skipped: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not apply an email suppression to the WhatsApp channel", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", channel: "whatsapp", recipient: "+1 (555) 010-2030", subject: null })],
      suppressions: [{ id: "s1", tenantId: "tenant-a", channel: "email", contactKey: "15550102030", reason: "manual", createdAt: new Date() }],
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result).toMatchObject({ sent: 1, skipped: 0 });
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("holds a message back rather than sending when the suppression check itself fails", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    mocks.prisma.suppressionEntry.findFirst = async () => {
      throw new Error("lost connection to MySQL server during query");
    };

    await runCampaignWorkerCycle("worker-1");

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.state.campaignMessages[0].status).toBe("retry_wait");
  });

  it("updates the CRM lead and opens an inbox thread for a delivered message", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", leadId: "lead-1", recipient: "owner@acme.test" })],
      leads: [{ id: "lead-1", tenantId: "tenant-a", businessName: "Acme Dental", emailStatus: null, emailSentDate: null }],
    });

    await runCampaignWorkerCycle("worker-1");

    expect(db.state.leads[0].emailStatus).toBe("SENT");
    expect(db.state.leads[0].emailSentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mocks.recordOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", channel: "email", leadId: "lead-1", providerMessageId: "smtp-1", source: "campaign" })
    );
  });

  it("marks the CRM lead FAILED on a permanent failure without opening a thread", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", leadId: "lead-1", recipient: "broken-address" })],
      leads: [{ id: "lead-1", tenantId: "tenant-a", businessName: "Acme Dental", emailStatus: null }],
    });

    await runCampaignWorkerCycle("worker-1");

    expect(db.state.leads[0].emailStatus).toBe("FAILED");
    expect(mocks.recordOutbound).not.toHaveBeenCalled();
  });

  it("never touches another workspace's lead row", async () => {
    seed({
      jobs: [jobRow({ id: "job-1" })],
      messages: [messageRow({ id: "m1", leadId: "lead-b" })],
      leads: [{ id: "lead-b", tenantId: "tenant-b", businessName: "Theirs", emailStatus: null }],
    });

    await runCampaignWorkerCycle("worker-1");

    expect(db.state.leads[0].emailStatus).toBeNull();
  });

  it("still marks the message sent when the bookkeeping write fails", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1", leadId: "lead-1" })], leads: [{ id: "lead-1", tenantId: "tenant-a" }] });
    mocks.recordOutbound.mockRejectedValue(new Error("inbox write failed"));

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result?.sent).toBe(1);
    expect(db.state.campaignMessages[0].status).toBe("sent");
  });
});

// ── Tenant isolation of the worker itself ──────────────────────────────────

describe("worker tenant isolation", () => {
  it("only processes messages belonging to the job's workspace", async () => {
    seed({
      jobs: [jobRow({ id: "job-1", tenantId: "tenant-a" })],
      messages: [
        messageRow({ id: "m1", tenantId: "tenant-a", recipient: "mine@acme.test" }),
        messageRow({ id: "m2", tenantId: "tenant-b", recipient: "theirs@acme.test" }),
      ],
    });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result?.sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0]).toBe("mine@acme.test");
    expect(db.state.campaignMessages.find((message: any) => message.id === "m2").status).toBe("approved");
  });

  it("fails the job rather than guessing when the campaign no longer exists", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], campaigns: [] });

    const result = await runCampaignWorkerCycle("worker-1");

    expect(result?.sent).toBe(0);
    expect(db.state.jobs[0].status).toBe("failed");
    expect(db.state.jobs[0].error).toMatch(/no longer exists/i);
  });

  it("stops processing when another worker has taken over the job lease", async () => {
    seed({ jobs: [jobRow({ id: "job-1" })], messages: [messageRow({ id: "m1" })] });
    const claimed = await claimNextCampaignJob("worker-1");
    // Simulate the takeover: the row now belongs to a different lease.
    db.state.jobs[0].workerId = "worker-2";
    db.state.jobs[0].leaseToken = "token-2";

    const result = await runClaimedCampaignJob(claimed);

    expect(result.sent).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.state.campaignMessages[0].status).toBe("approved");
  });
});

// ── Multi-worker end to end ────────────────────────────────────────────────

describe("three workers, three tenants", () => {
  it("processes every job once, isolates tenants, and one failure does not block the others", async () => {
    const campaigns = ["a", "b", "c"].map((suffix) => ({
      id: `campaign-${suffix}`,
      tenantId: `tenant-${suffix}`,
      name: `Campaign ${suffix}`,
      status: "sending",
    }));
    const jobs = ["a", "b", "c"].map((suffix) =>
      jobRow({
        id: `job-${suffix}`,
        tenantId: `tenant-${suffix}`,
        params: JSON.stringify({ campaignId: `campaign-${suffix}`, delayMs: 0, batchSize: 25 }),
      })
    );
    const messages = ["a", "b", "c"].flatMap((suffix) => [
      messageRow({ id: `m-${suffix}-1`, tenantId: `tenant-${suffix}`, campaignId: `campaign-${suffix}`, recipient: `one@${suffix}.test` }),
      messageRow({ id: `m-${suffix}-2`, tenantId: `tenant-${suffix}`, campaignId: `campaign-${suffix}`, recipient: `two@${suffix}.test` }),
    ]);
    seed({ campaigns, jobs, messages });

    // Tenant B's provider is broken. Its job must fail on its own without
    // stopping A and C.
    mocks.sendEmail.mockImplementation(async (to: string) =>
      to.endsWith("@b.test") ? { success: false, error: "authentication failed" } : { success: true, messageId: `smtp-${to}` }
    );

    const results = await Promise.all([
      runCampaignWorkerCycle("worker-1"),
      runCampaignWorkerCycle("worker-2"),
      runCampaignWorkerCycle("worker-3"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(3);
    expect(new Set(results.map((result: any) => result.jobId)).size).toBe(3);

    // Every message was attempted exactly once.
    const attempts = mocks.sendEmail.mock.calls.map((call: any[]) => call[0]).sort();
    expect(attempts).toEqual(["one@a.test", "one@b.test", "one@c.test", "two@a.test", "two@b.test", "two@c.test"]);

    const statusFor = (id: string) => db.state.campaignMessages.find((message: any) => message.id === id).status;
    expect(statusFor("m-a-1")).toBe("sent");
    expect(statusFor("m-c-2")).toBe("sent");
    expect(statusFor("m-b-1")).toBe("failed");

    // No report row ever crosses a workspace boundary.
    for (const dispatch of db.state.campaignDispatches) {
      const message = db.state.campaignMessages.find((row: any) => row.id === dispatch.campaignMessageId);
      expect(dispatch.tenantId).toBe(message.tenantId);
    }
    expect(db.state.jobs.every((job: any) => ["completed", "failed"].includes(job.status))).toBe(true);
  });
});
