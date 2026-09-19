import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prisma: null as any, sendEmail: vi.fn(), integration: vi.fn() }));
vi.mock("../src/prisma", () => ({ prisma: new Proxy({}, { get: (_t, key) => mocks.prisma[key as any] }) }));
vi.mock("../src/outreachService", () => ({ sendEmailOutreach: mocks.sendEmail }));
vi.mock("../src/whatsappGateway", () => ({ sendWhatsAppUnified: vi.fn() }));
vi.mock("../src/userIntegrationService", () => ({ getUserIntegration: mocks.integration }));
const { runClaimedCampaignJob } = await import("../src/campaign/campaignExecutor");

function job(overrides: any = {}) { return { id: "job-a", tenantId: "tenant-a", userId: "user-a", workerId: "worker-a", leaseToken: "lease-a", params: JSON.stringify({ campaignId: "campaign-a", delayMs: 0, batchSize: 1 }), ...overrides }; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.integration.mockResolvedValue({ host: "smtp.test", port: 587, user: "user", password: "pass", fromEmail: "from@test" });
  mocks.prisma = {
    campaign: { findFirst: vi.fn().mockResolvedValue({ id: "campaign-a", name: "Campaign" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    job: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue({ status: "running", cancelRequestedAt: null }) },
    campaignMessage: { count: vi.fn().mockResolvedValue(1), findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), groupBy: vi.fn().mockResolvedValue([]) },
    campaignDispatch: { upsert: vi.fn().mockResolvedValue({}) },
  };
});

describe("leased campaign messages", () => {
  it("retries a transient provider failure with a durable retry_wait lease release", async () => {
    let calls = 0;
    mocks.prisma.campaignMessage.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.status === "retry_wait") return { nextAttemptAt: new Date(Date.now() + 60_000) };
      calls++;
      if (calls === 1) return { id: "message-a", campaignId: "campaign-a", tenantId: "tenant-a", leadId: null, businessName: "Business", recipient: "a@test.example", channel: "email", subject: "s", body: "b", attemptCount: 1, leaseToken: null };
      if (calls === 2) return { id: "message-a", campaignId: "campaign-a", tenantId: "tenant-a", leadId: null, businessName: "Business", recipient: "a@test.example", channel: "email", subject: "s", body: "b", attemptCount: 1, leaseToken: "message-lease" };
      return null;
    });
    mocks.sendEmail.mockResolvedValue({ success: false, error: "Could not connect to SMTP server" });
    const result = await runClaimedCampaignJob(job());
    expect(result.deferred).toBe(true);
    expect(mocks.prisma.campaignMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "retry_wait", nextAttemptAt: expect.any(Date), leaseOwner: null }) }));
    expect(mocks.prisma.campaignDispatch.upsert).not.toHaveBeenCalled();
  });

  it("honours persisted cancellation before claiming a message", async () => {
    mocks.prisma.job.findFirst.mockResolvedValue({ status: "cancelling", cancelRequestedAt: new Date() });
    const result = await runClaimedCampaignJob(job());
    expect(result.cancelled).toBe(true);
    expect(mocks.prisma.campaignMessage.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "campaign-a", tenantId: "tenant-a" }, data: expect.objectContaining({ status: "cancelled" }) }));
  });
});
