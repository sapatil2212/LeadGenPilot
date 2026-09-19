import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../src/tenancy/context";

const mocks = vi.hoisted(() => ({ prisma: null as any, sendEmail: vi.fn(), sendWhatsApp: vi.fn(), integration: vi.fn() }));
vi.mock("../src/prisma", () => ({ prisma: new Proxy({}, { get: (_t, key) => mocks.prisma[key as any] }) }));
vi.mock("../src/outreachService", () => ({ sendEmailOutreach: mocks.sendEmail }));
vi.mock("../src/whatsappGateway", () => ({ sendWhatsAppUnified: mocks.sendWhatsApp }));
vi.mock("../src/userIntegrationService", () => ({ getUserIntegration: mocks.integration }));

const queue = await import("../src/campaign/campaignExecutor");
const ctx: TenantContext = { tenantId: "tenant-a", userId: "user-a", membershipId: "member-a", role: "owner", tenantName: "A", tenantSlug: "a", permissions: new Set() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma = {
    $transaction: vi.fn(async (fn: any) => fn(mocks.prisma)),
    campaign: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue({ id: "campaign-a", status: "approved", name: "A" }), update: vi.fn(), },
    job: { create: vi.fn().mockResolvedValue({ id: "job-a" }), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    campaignMessage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    campaignDispatch: { upsert: vi.fn() },
  };
});

describe("Phase 7 durable campaign queue", () => {
  it("enqueues a queued job and does not send provider traffic in the request path", async () => {
    const result = await queue.enqueueCampaignExecution(ctx, "campaign-a", { delayMs: 0, batchSize: 1 });
    expect(result).toEqual({ jobId: "job-a", campaignId: "campaign-a", status: "queued" });
    expect(mocks.prisma.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a" }), data: expect.objectContaining({ status: "sending" }) }));
    expect(mocks.prisma.job.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-a", userId: "user-a", kind: "campaign", status: "queued" }) }));
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("uses a conditional updateMany lease so two workers cannot both claim the same job", async () => {
    const candidate = { id: "job-a", tenantId: "tenant-a", kind: "campaign", status: "queued", createdAt: new Date(), params: "{}" };
    let claimCount = 0;
    mocks.prisma.job.findFirst.mockImplementation(async () => candidate);
    mocks.prisma.job.updateMany.mockImplementation(async () => ({ count: ++claimCount === 1 ? 1 : 0 }));
    const [first, second] = await Promise.all([queue.claimNextCampaignJob("worker-1"), queue.claimNextCampaignJob("worker-2")]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(mocks.prisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workerId: expect.any(String), leaseToken: expect.any(String), leaseExpiresAt: expect.any(Date), heartbeatAt: expect.any(Date) }) }));
  });

  it("reclaims only expired leases and makes stale messages retryable", async () => {
    await queue.recoverStaleCampaignLeases(new Date("2026-01-01T00:00:00.000Z"));
    expect(mocks.prisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: "campaign", leaseExpiresAt: { lt: new Date("2026-01-01T00:00:00.000Z") } }) }));
    expect(mocks.prisma.campaignMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "sending", leaseExpiresAt: { lt: new Date("2026-01-01T00:00:00.000Z") } }), data: expect.objectContaining({ status: "retry_wait", leaseOwner: null }) }));
  });

  it("does not let a tenant cancel another tenant's campaign", async () => {
    mocks.prisma.campaign.findFirst.mockResolvedValue(null);
    const result = await queue.cancelCampaignExecution({ ...ctx, tenantId: "tenant-b" }, "campaign-a");
    expect(result).toEqual({ ok: false });
    expect(mocks.prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it("upserts one final dispatch receipt per campaign message", async () => {
    const { recordCampaignDispatch } = await import("../src/campaign/dispatchService");
    await recordCampaignDispatch({ message: { id: "message-a", tenantId: "tenant-a", campaignId: "campaign-a", leadId: null, businessName: "Business", recipient: "a@test.example", channel: "email", subject: "S", body: "B" }, campaignName: "Campaign", status: "SENT", externalMessageId: "provider-a" });
    expect(mocks.prisma.campaignDispatch.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignMessageId: "message-a" }, create: expect.objectContaining({ tenantId: "tenant-a", status: "SENT" }), update: expect.objectContaining({ externalMessageId: "provider-a" }) }));
  });
});