/**
 * Tests for multi-sender rotation, random delay, batch pause, and template
 * variation services introduced in v2 of the outreach system.
 *
 * No network calls, no actual DB — all Prisma calls are mocked via vi.mock so
 * tests run in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────

const mockPrisma = {
  userIntegration: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  campaign: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  templateVariation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};
vi.mock("../src/prisma", () => ({ prisma: mockPrisma }));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("senderRotationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getEnabledSenders: returns empty array when no integrations found", async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([]);
    const { getEnabledSenders } = await import("../src/campaign/senderRotationService");
    const result = await getEnabledSenders("tenant1", "email");
    expect(result).toEqual([]);
  });

  it("getEnabledSenders: maps slot correctly for primary and extra senders", async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([
      { id: "s1", type: "smtp", label: "Primary", enabled: true },
      { id: "s2", type: "smtp_2", label: "Secondary", enabled: true },
    ]);
    const { getEnabledSenders } = await import("../src/campaign/senderRotationService");
    const result = await getEnabledSenders("tenant1", "email");
    expect(result).toHaveLength(2);
    expect(result[0].slot).toBe(1);
    expect(result[1].slot).toBe(2);
  });

  it("nextAvailableSlot: returns 1 when no senders configured", async () => {
    const { nextAvailableSlot } = await import("../src/campaign/senderRotationService");
    expect(nextAvailableSlot([], "email")).toBe(1);
  });

  it("nextAvailableSlot: returns 2 when slot 1 is taken", async () => {
    const { nextAvailableSlot } = await import("../src/campaign/senderRotationService");
    expect(nextAvailableSlot(["smtp"], "email")).toBe(2);
  });

  it("nextAvailableSlot: returns null when all 5 slots are taken", async () => {
    const { nextAvailableSlot } = await import("../src/campaign/senderRotationService");
    expect(nextAvailableSlot(["smtp", "smtp_2", "smtp_3", "smtp_4", "smtp_5"], "email")).toBeNull();
  });

  it("senderTypeForSlot: maps slot 1 to primary type", async () => {
    const { senderTypeForSlot } = await import("../src/campaign/senderRotationService");
    expect(senderTypeForSlot("email", 1)).toBe("smtp");
    expect(senderTypeForSlot("whatsapp", 1)).toBe("whatsapp");
  });

  it("senderTypeForSlot: maps slot 3 correctly", async () => {
    const { senderTypeForSlot } = await import("../src/campaign/senderRotationService");
    expect(senderTypeForSlot("email", 3)).toBe("smtp_3");
    expect(senderTypeForSlot("whatsapp", 3)).toBe("whatsapp_3");
  });

  it("senderTypeForSlot: throws for out-of-range slot", async () => {
    const { senderTypeForSlot } = await import("../src/campaign/senderRotationService");
    expect(() => senderTypeForSlot("email", 0)).toThrow();
    expect(() => senderTypeForSlot("email", 6)).toThrow();
  });

  it("selectNextSender: returns null when no enabled senders", async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([]);
    const { selectNextSender } = await import("../src/campaign/senderRotationService");
    const result = await selectNextSender("campaign1", "tenant1", "email");
    expect(result).toBeNull();
  });

  it("selectNextSender: returns the only sender without rotation when there is exactly one", async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([
      { id: "s1", type: "smtp", label: null, enabled: true },
    ]);
    const { selectNextSender } = await import("../src/campaign/senderRotationService");
    const result = await selectNextSender("campaign1", "tenant1", "email");
    expect(result).toEqual({ integrationId: "s1", slot: 1 });
  });

  it("selectNextSender: rotates atomically with conditional updateMany", async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([
      { id: "s1", type: "smtp", label: null, enabled: true },
      { id: "s2", type: "smtp_2", label: null, enabled: true },
    ]);
    mockPrisma.campaign.findFirst.mockResolvedValue({ senderRotationIndex: 0 });
    mockPrisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    const { selectNextSender } = await import("../src/campaign/senderRotationService");
    const result = await selectNextSender("campaign1", "tenant1", "email");
    // index 0 selects slot 0 (s1)
    expect(result?.integrationId).toBe("s1");
    // index advanced from 0 to 1
    expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { senderRotationIndex: 1 },
      })
    );
  });
});

describe("templateVariationService — compileVariationForLead", () => {
  it("substitutes {{name}} with contactName when available", async () => {
    const { compileVariationForLead } = await import("../src/campaign/templateVariationService");
    const result = compileVariationForLead("Hi {{name}}, checking in!", {
      businessName: "Acme Corp",
      contactName: "John",
    });
    expect(result).toBe("Hi John, checking in!");
  });

  it("falls back to businessName when contactName is absent", async () => {
    const { compileVariationForLead } = await import("../src/campaign/templateVariationService");
    const result = compileVariationForLead("Hi {{name}}, checking in!", {
      businessName: "Acme Corp",
    });
    expect(result).toBe("Hi Acme Corp, checking in!");
  });

  it("falls back to 'there' when both contactName and businessName are absent", async () => {
    const { compileVariationForLead } = await import("../src/campaign/templateVariationService");
    const result = compileVariationForLead("Hi {{name}}, checking in!", {});
    expect(result).toBe("Hi there, checking in!");
  });

  it("substitutes multiple variables in one pass", async () => {
    const { compileVariationForLead } = await import("../src/campaign/templateVariationService");
    const result = compileVariationForLead(
      "Hey {{name}} from {{business}}, based in {{city}}!",
      {
        businessName: "Cool Cafe",
        contactName: "Maria",
        address: "12 Park St, Mumbai, Maharashtra",
      } as any
    );
    expect(result).toContain("Maria");
    expect(result).toContain("Cool Cafe");
    expect(result).toContain("Mumbai");
  });

  it("preserves unknown variables (does not strip them)", async () => {
    const { compileVariationForLead } = await import("../src/campaign/templateVariationService");
    const result = compileVariationForLead("Check {{unknownVar}} here", {});
    expect(result).toBe("Check {{unknownVar}} here");
  });
});

describe("campaignExecutor — validateCampaignThrottleSettings", () => {
  it("returns null for valid settings", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(40, 100, 25, 60)).toBeNull();
  }, 30_000);

  it("rejects negative messageDelayMin", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(-1, 100)).not.toBeNull();
  });

  it("rejects messageDelayMax < messageDelayMin", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(100, 50)).not.toBeNull();
  });

  it("rejects messageDelayMax > 3600", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(0, 3601)).not.toBeNull();
  });

  it("rejects batchSize of 0", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(40, 100, 0)).not.toBeNull();
  });

  it("rejects batchPauseSeconds > 3600", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(40, 100, 25, 3601)).not.toBeNull();
  });

  it("accepts equal min and max delay (zero jitter)", async () => {
    const { validateCampaignThrottleSettings } = await import("../src/campaign/campaignExecutor");
    expect(validateCampaignThrottleSettings(60, 60, 10, 30)).toBeNull();
  });
});
