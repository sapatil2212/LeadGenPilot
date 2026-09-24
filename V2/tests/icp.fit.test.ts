/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ICP fit scoring.
 *
 * Fit answers a different question from the lead score, and the tests are built
 * around keeping them apart: a dentist with no website tops the opportunity scale
 * and is worth nothing to a seller of hospital equipment. The original scorer had
 * no way to express that, which is why it only worked for one kind of customer.
 *
 * The other properties under test are all about not inventing a number. Fit is
 * null when the profile defines nothing to judge against, exclusions override a
 * model that scored a business highly anyway, and a verdict for a candidate that
 * was never sent is discarded rather than attached to whatever is nearby.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TENANT_A, WORKSPACE_A } from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ generateStructuredOutput: vi.fn() }));

vi.mock("../src/ai/aiService", () => ({
  generateStructuredOutput: (...args: unknown[]) => mocks.generateStructuredOutput(...args),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const fit = await import("../src/icp/fitService");
const { AiUnavailableError } = await import("../src/ai/types");
const { validateIcpFit, leadIcpFitPrompt } = await import("../src/prompts");
const { resolvePermissions } = await import("../src/tenancy/permissions");

const CTX_A = {
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
  membershipId: "tm_a",
  role: "owner",
  tenantName: WORKSPACE_A.name,
  tenantSlug: WORKSPACE_A.slug,
  permissions: resolvePermissions("owner"),
};

function icpView(overrides: Record<string, unknown> = {}) {
  return {
    id: "icp_1",
    name: "Mid-size hospitals in Maharashtra",
    description: null,
    targetCategories: ["Multispecialty Hospital"],
    targetIndustries: [],
    targetLocations: ["Pune"],
    decisionMakerRoles: [],
    excludeCategories: [],
    excludeKeywords: [],
    requiredSignals: [],
    preferredSignals: [],
    minRating: null,
    minReviews: null,
    maxResults: 50,
    radiusKm: null,
    deepAnalysis: false,
    isDefault: true,
    status: "active",
    aiConfidence: null,
    lastSuggestedAt: null,
    completeness: 65,
    readyForDiscovery: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

beforeEach(() => {
  mocks.generateStructuredOutput.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fit
// ─────────────────────────────────────────────────────────────────────────────

describe("deterministicFit", () => {
  const profile = fit.toFitProfile(icpView());

  it("scores a squarely-matching candidate at the top", () => {
    const verdict = fit.deterministicFit(
      {
        ref: "1",
        businessName: "Sahyadri Multispecialty Hospital",
        category: "Multispecialty Hospital",
        address: "Karve Road, Pune",
      },
      profile
    );
    expect(verdict.fit).toBe(100);
    expect(verdict.method).toBe("rules");
  });

  it("penalises the wrong location", () => {
    // Category 6/9 of the weight, location 3/9.
    const verdict = fit.deterministicFit(
      {
        ref: "1",
        businessName: "Sahyadri Multispecialty Hospital",
        category: "Multispecialty Hospital",
        address: "Indore",
      },
      profile
    );
    expect(verdict.fit).toBe(67);
  });

  it("scores the wrong category near zero even in the right place", () => {
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "Cafe Noir", category: "Cafe", address: "Pune" },
      profile
    );
    expect(verdict.fit).toBe(33);
  });

  it("treats a containing category as a full match", () => {
    // "Multispecialty Hospital" against a listing of "Multispecialty Hospital &
    // Trauma Centre" is the same business type.
    const verdict = fit.deterministicFit(
      {
        ref: "1",
        businessName: "Ruby Hall",
        category: "Multispecialty Hospital & Trauma Centre",
        address: "Pune",
      },
      profile
    );
    expect(verdict.fit).toBe(100);
  });

  it("gives partial credit for a partial word overlap", () => {
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "City Hospital", category: "Hospital", address: "Pune" },
      profile
    );
    // "multispecialty" missing, "hospital" present: half the category weight.
    expect(verdict.fit).toBeGreaterThan(33);
    expect(verdict.fit).toBeLessThan(100);
  });

  it("does not count generic words like clinic or centre as a match", () => {
    // They appear in nearly every listing in some verticals, so counting them
    // would score a veterinary clinic as a partial match for a dental one.
    const dentalProfile = fit.toFitProfile(
      icpView({ targetCategories: ["Dental Clinic"], targetLocations: [] })
    );
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "Happy Paws", category: "Veterinary Clinic" },
      dentalProfile
    );
    expect(verdict.fit).toBe(0);
  });

  it("zeroes a candidate matching an excluded category", () => {
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "City Pharmacy", category: "Pharmacy", address: "Pune" },
      fit.toFitProfile(icpView({ excludeCategories: ["Pharmacy"] }))
    );
    expect(verdict.fit).toBe(0);
    expect(verdict.method).toBe("excluded");
    expect(verdict.reason).toContain("Pharmacy");
  });

  it("zeroes a candidate matching an excluded keyword in its name", () => {
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "Brightwave Equipment Depot", category: "Wholesaler" },
      fit.toFitProfile(icpView({ excludeKeywords: ["brightwave"] }))
    );
    expect(verdict.fit).toBe(0);
    expect(verdict.method).toBe("excluded");
  });

  it("renormalises the weights over the dimensions the profile defines", () => {
    // A profile naming only categories is scored purely on category, not quietly
    // capped at 67% for omitting locations.
    const categoriesOnly = fit.toFitProfile(icpView({ targetLocations: [] }));
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "X", category: "Multispecialty Hospital", address: "Anywhere" },
      categoriesOnly
    );
    expect(verdict.fit).toBe(100);
  });

  it("includes the reputation bar when the profile sets one", () => {
    const withBar = fit.toFitProfile(
      icpView({ targetLocations: [], minRating: 4, minReviews: 20 })
    );

    const meets = fit.deterministicFit(
      { ref: "1", businessName: "X", category: "Multispecialty Hospital", rating: 4.5, reviews: 50 },
      withBar
    );
    expect(meets.fit).toBe(100);

    const below = fit.deterministicFit(
      { ref: "2", businessName: "Y", category: "Multispecialty Hospital", rating: 3.0, reviews: 50 },
      withBar
    );
    // Category 6/7, reputation 0/7.
    expect(below.fit).toBe(86);
  });

  it("returns null rather than a number when there is nothing to judge", () => {
    // A fabricated relevance score would be acted on as though it meant
    // something.
    const empty = fit.toFitProfile(
      icpView({ targetCategories: [], targetIndustries: [], targetLocations: [] })
    );
    const verdict = fit.deterministicFit({ ref: "1", businessName: "X" }, empty);
    expect(verdict.fit).toBeNull();
    expect(verdict.reason).toMatch(/does not define any targets/i);
  });

  it("explains itself in the reason", () => {
    const verdict = fit.deterministicFit(
      { ref: "1", businessName: "X", category: "Multispecialty Hospital", address: "Pune" },
      profile
    );
    expect(verdict.reason).toContain("Multispecialty Hospital");
    expect(verdict.reason).toContain("Pune");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI fit
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreFit", () => {
  const candidates = [
    {
      ref: "0",
      businessName: "Sahyadri Multispecialty Hospital",
      category: "Multispecialty Hospital",
      address: "Pune",
      rating: 4.4,
      reviews: 320,
    },
    {
      ref: "1",
      businessName: "Cafe Noir",
      category: "Cafe",
      address: "Pune",
      rating: 4.6,
      reviews: 90,
    },
  ];

  function wireAi(verdicts: { ref: string; fit: number; reason: string }[]) {
    mocks.generateStructuredOutput.mockResolvedValue({
      value: { verdicts },
      result: { text: "", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 10 },
    });
  }

  it("uses the model's verdicts when it answers", async () => {
    wireAi([
      { ref: "0", fit: 92, reason: "A multispecialty hospital in Pune." },
      { ref: "1", fit: 3, reason: "A cafe, not a healthcare provider." },
    ]);

    const results = await fit.scoreFit(CTX_A, candidates, icpView());

    expect(results.get("0")).toMatchObject({ fit: 92, method: "ai" });
    expect(results.get("1")).toMatchObject({ fit: 3, method: "ai" });
  });

  it("attributes the call to the workspace", async () => {
    wireAi([{ ref: "0", fit: 90, reason: "x" }]);

    await fit.scoreFit(CTX_A, candidates, icpView());

    const request = mocks.generateStructuredOutput.mock.calls[0][0];
    expect(request.maxTokens).toBe(2_048);
    const options = mocks.generateStructuredOutput.mock.calls[0][1];
    expect(options).toMatchObject({
      operation: "lead.icpFit",
      tenantId: WORKSPACE_A.id,
      userId: TENANT_A.id,
      promptName: "lead.icpFit",
      promptVersion: 1,
    });
  });

  it("falls back to rules for candidates the model omitted", async () => {
    // Per candidate, not per batch: fifteen of twenty verdicts should leave five
    // scored by rules, not unscored.
    wireAi([{ ref: "0", fit: 92, reason: "A hospital." }]);

    const results = await fit.scoreFit(CTX_A, candidates, icpView());

    expect(results.get("0")?.method).toBe("ai");
    expect(results.get("1")?.method).toBe("rules");
    expect(results.get("1")?.fit).toBe(33);
  });

  it("discards a verdict for a candidate that was never sent", async () => {
    // A hallucinated ref has no business to attach to, so dropping it is the only
    // safe response.
    wireAi([
      { ref: "0", fit: 92, reason: "A hospital." },
      { ref: "999", fit: 100, reason: "A business that does not exist." },
    ]);

    const results = await fit.scoreFit(CTX_A, candidates, icpView());

    expect(results.has("999")).toBe(false);
    expect(results.size).toBe(2);
  });

  it("lets an exclusion override a high model score", async () => {
    // An exclusion is a fact about the profile, not a judgement call.
    wireAi([{ ref: "1", fit: 95, reason: "Looks like a great fit." }]);

    const results = await fit.scoreFit(
      CTX_A,
      candidates,
      icpView({ excludeCategories: ["Cafe"] })
    );

    expect(results.get("1")).toMatchObject({ fit: 0, method: "excluded" });
  });

  it("falls back to rules entirely when no provider is available", async () => {
    mocks.generateStructuredOutput.mockRejectedValue(new AiUnavailableError("all down", []));

    const results = await fit.scoreFit(CTX_A, candidates, icpView());

    expect(results.get("0")?.method).toBe("rules");
    expect(results.get("0")?.fit).toBe(100);
  });

  it("skips the model when asked for rules only", async () => {
    const results = await fit.scoreFit(CTX_A, candidates, icpView(), { rulesOnly: true });

    expect(mocks.generateStructuredOutput).not.toHaveBeenCalled();
    expect(results.get("0")?.method).toBe("rules");
  });

  it("does not call the model when the profile defines no targets", async () => {
    const results = await fit.scoreFit(
      CTX_A,
      candidates,
      icpView({ targetCategories: [], targetIndustries: [], targetLocations: [] })
    );

    expect(mocks.generateStructuredOutput).not.toHaveBeenCalled();
    expect(results.get("0")?.fit).toBeNull();
  });

  it("batches large candidate lists", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      ref: String(i),
      businessName: `Business ${i}`,
      category: "Multispecialty Hospital",
      address: "Pune",
    }));
    mocks.generateStructuredOutput.mockImplementation(async (request: any) => {
      const prompt = request.messages[1].content as string;
      const refs = Array.from(prompt.matchAll(/ref: (\d+)/g)).map((m) => m[1]);
      return {
        value: { verdicts: refs.map((ref) => ({ ref, fit: 80, reason: "ok" })) },
        result: { text: "", provider: "gemini", model: "m", latencyMs: 1 },
      };
    });

    const results = await fit.scoreFit(CTX_A, many, icpView());

    // 45 candidates at 20 per call.
    expect(mocks.generateStructuredOutput).toHaveBeenCalledTimes(3);
    expect(results.size).toBe(45);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The prompt contract
// ─────────────────────────────────────────────────────────────────────────────

describe("validateIcpFit", () => {
  it("accepts the documented shape", () => {
    expect(validateIcpFit({ verdicts: [{ ref: "0", fit: 70, reason: "ok" }] })).toEqual({
      verdicts: [{ ref: "0", fit: 70, reason: "ok" }],
    });
  });

  it("accepts a bare array", () => {
    // Asked for a list of judgements, models return one about as often as the
    // documented wrapper, and rejecting it costs a repair round trip for a
    // response that is entirely usable.
    expect(validateIcpFit([{ ref: "0", fit: 70, reason: "ok" }])?.verdicts).toHaveLength(1);
  });

  it("clamps and rounds the score", () => {
    const out = validateIcpFit({
      verdicts: [
        { ref: "a", fit: 140, reason: "x" },
        { ref: "b", fit: -20, reason: "x" },
        { ref: "c", fit: 61.7, reason: "x" },
      ],
    });
    expect(out?.verdicts.map((v) => v.fit)).toEqual([100, 0, 62]);
  });

  it("drops entries with no ref or no usable score", () => {
    const out = validateIcpFit({
      verdicts: [
        { ref: "", fit: 50, reason: "x" },
        { ref: "b", fit: "high", reason: "x" },
        { ref: "c", fit: 50, reason: "x" },
      ],
    });
    expect(out?.verdicts.map((v) => v.ref)).toEqual(["c"]);
  });

  it("supplies a placeholder when the model gives no reason", () => {
    expect(validateIcpFit({ verdicts: [{ ref: "a", fit: 50 }] })?.verdicts[0].reason).toBe(
      "No reason given."
    );
  });

  it("rejects a response with nothing usable in it", () => {
    expect(validateIcpFit({ verdicts: [] })).toBeNull();
    expect(validateIcpFit({ nope: true })).toBeNull();
    expect(validateIcpFit(null)).toBeNull();
  });
});

describe("the lead.icpFit prompt", () => {
  it("tells the model not to judge on website presence", () => {
    // That is the lead score's job. Conflating them is what made the original
    // scorer unusable outside one vertical.
    const messages = leadIcpFitPrompt.build({
      profile: fit.toFitProfile(icpView()),
      candidates: [{ ref: "0", businessName: "X" }],
    });
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toMatch(/not.*reward or penalise.*website/is);
  });

  it("echoes each candidate's ref, so verdicts can be matched up", () => {
    const messages = leadIcpFitPrompt.build({
      profile: fit.toFitProfile(icpView()),
      candidates: [
        { ref: "0", businessName: "First" },
        { ref: "1", businessName: "Second" },
      ],
    });
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("ref: 0");
    expect(user).toContain("ref: 1");
  });

  it("carries the grounding rules", () => {
    const messages = leadIcpFitPrompt.build({
      profile: fit.toFitProfile(icpView()),
      candidates: [{ ref: "0", businessName: "X" }],
    });
    expect(messages[0].content).toContain("Never invent");
  });
});
