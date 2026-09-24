import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../src/ai/aiService", () => ({
  generateText: (...args: unknown[]) => mocks.generateText(...args),
}));

const { generateSalesInsight } = await import("../src/aiInsights");

describe("lead insight generation", () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.generateText.mockResolvedValue({ text: "A grounded sales insight.", provider: "openrouter" });
  });

  it("uses a short-output token ceiling so low-credit providers can accept the request", async () => {
    await generateSalesInsight({
      businessName: "Acme Computers",
      rating: 4.5,
      reviews: 100,
      websiteStatus: "MISSING",
      instagramStatus: "NOT_FOUND",
      facebookStatus: "NOT_FOUND",
      linkedinStatus: "NOT_FOUND",
      whatsappPresent: false,
      appointmentSystem: false,
      emails: [],
      googleAnalyticsPresent: false,
      metaPixelPresent: false,
      leadScore: 150,
      leadPriority: "HOT",
      scoreDenominator: 170,
    });

    const request = mocks.generateText.mock.calls[0][0];
    expect(request.maxTokens).toBe(1_024);
  });
});
