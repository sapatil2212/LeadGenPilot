import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("../src/prisma", () => ({ prisma: new Proxy({}, { get: (_t, key) => mocks.prisma?.[key as any] }) }));
vi.mock("../src/outreachService", () => ({ sendEmailOutreach: vi.fn() }));
vi.mock("../src/whatsappGateway", () => ({ sendWhatsAppUnified: vi.fn() }));
vi.mock("../src/userIntegrationService", () => ({ getUserIntegration: vi.fn() }));

const { normalizeExecutionOptions } = await import("../src/campaign/campaignExecutor");

describe("campaign execution options", () => {
  it("normalizes safe worker parameters", () => {
    expect(normalizeExecutionOptions()).toEqual({ delayMs: 5000, batchSize: 25 });
    expect(normalizeExecutionOptions({ delayMs: 0, batchSize: 1 })).toEqual({ delayMs: 0, batchSize: 1 });
  });
  it("rejects unsafe scheduling parameters before durable enqueue", () => {
    expect(() => normalizeExecutionOptions({ batchSize: 0 })).toThrow("batchSize");
    expect(() => normalizeExecutionOptions({ delayMs: -1 })).toThrow("delayMs");
  });
});
