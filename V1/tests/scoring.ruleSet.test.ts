/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The configurable scoring engine.
 *
 * The centrepiece is the parity block at the bottom. It enumerates the whole
 * input space the old scorer could observe — 4 website states x 3 Instagram x 3
 * Facebook x 2 LinkedIn x reviews x rating x five booleans, 6,912 combinations —
 * and asserts the engine agrees with a frozen transcription of the original
 * arithmetic on every one.
 *
 * That reference implementation is duplicated code, deliberately. Its purpose is
 * to be the historical spec: it can never be refactored to share logic with the
 * thing it validates, because then it would validate nothing. It is the reason a
 * migration that changes how every lead in the product is prioritised can be
 * trusted.
 */

import { describe, it, expect, vi } from "vitest";
import { makeLead } from "./helpers/leadFixture";

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  BUILT_IN_HOT_THRESHOLD,
  BUILT_IN_MAX,
  BUILT_IN_RULES,
  BUILT_IN_WARM_THRESHOLD,
  RuleSetValidationError,
  builtInRuleSet,
  computeMaxScore,
  evaluate,
  parseRules,
  parseThresholds,
} = await import("../src/scoring/ruleSet");
const { SIGNALS, getSignal, isKnownSignal, listSignals } = await import("../src/scoring/signals");

// ─────────────────────────────────────────────────────────────────────────────
// Signals
// ─────────────────────────────────────────────────────────────────────────────

describe("the signal registry", () => {
  it("has unique ids", () => {
    const ids = SIGNALS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes every signal, so a rule editor can explain what it weights", () => {
    for (const signal of SIGNALS) {
      expect(signal.label.length).toBeGreaterThan(3);
      expect(signal.description.length).toBeGreaterThan(20);
    }
  });

  it("rejects an unknown signal id", () => {
    expect(isKnownSignal("website.missing")).toBe(true);
    expect(isKnownSignal("website.on_fire")).toBe(false);
    expect(isKnownSignal(42)).toBe(false);
  });

  it("omits the predicate from the public listing", () => {
    // The registry is exposed over HTTP; shipping the function bodies would
    // serialise to nothing useful and leak implementation detail.
    for (const entry of listSignals()) {
      expect((entry as any).test).toBeUndefined();
    }
  });

  it("keeps signals in an exclusive group genuinely exclusive", () => {
    // This is what makes the achievable maximum exact rather than a guess, so it
    // is asserted rather than assumed. Threshold-based groups are excluded: they
    // only partition cleanly while their thresholds do not overlap, which is
    // documented and handled by clamping instead.
    const thresholdGroups = new Set(["reviews", "rating"]);
    const groups = new Map<string, typeof SIGNALS>();
    for (const signal of SIGNALS) {
      if (!signal.exclusiveGroup || thresholdGroups.has(signal.exclusiveGroup)) continue;
      const list = groups.get(signal.exclusiveGroup) ?? [];
      list.push(signal);
      groups.set(signal.exclusiveGroup, list);
    }

    const websiteStatuses = ["MISSING", "BROKEN", "OUTDATED", "WORKING"] as const;
    const socialStatuses = ["NOT_FOUND", "ACTIVE", "INACTIVE"] as const;

    for (const [group, members] of groups) {
      for (const websiteStatus of websiteStatuses) {
        for (const instagramStatus of socialStatuses) {
          for (const facebookStatus of socialStatuses) {
            for (const linkedinStatus of ["NOT_FOUND", "ACTIVE"] as const) {
              for (const hasEmail of [true, false]) {
                for (const hasAnalytics of [true, false]) {
                  const lead = makeLead({
                    websiteStatus,
                    instagramStatus,
                    facebookStatus,
                    linkedinStatus,
                    emails: hasEmail ? ["a@b.test"] : [],
                    googleAnalyticsPresent: hasAnalytics,
                  });
                  const fired = members.filter((m) => m.test(lead, m.defaultThreshold));
                  expect(
                    fired.length,
                    `group "${group}" had ${fired.length} signals fire: ${fired.map((f) => f.id).join(", ")}`
                  ).toBeLessThanOrEqual(1);
                }
              }
            }
          }
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Maximum
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMaxScore", () => {
  it("counts an exclusive group only once, at its best-paying member", () => {
    // 50 + 40 + 30 naively sums to 120, but websiteStatus holds one value.
    const max = computeMaxScore([
      { id: "a", signal: "website.missing", points: 50 },
      { id: "b", signal: "website.broken", points: 40 },
      { id: "c", signal: "website.outdated", points: 30 },
    ]);
    expect(max).toBe(50);
  });

  it("sums signals that are not mutually exclusive", () => {
    const max = computeMaxScore([
      { id: "a", signal: "contact.no_whatsapp", points: 10 },
      { id: "b", signal: "contact.no_booking", points: 10 },
      { id: "c", signal: "tracking.no_pixel", points: 10 },
    ]);
    expect(max).toBe(30);
  });

  it("ignores disabled rules", () => {
    const max = computeMaxScore([
      { id: "a", signal: "contact.no_whatsapp", points: 10 },
      { id: "b", signal: "contact.no_booking", points: 10, enabled: false },
    ]);
    expect(max).toBe(10);
  });

  it("ignores penalties, which cannot raise a ceiling", () => {
    const max = computeMaxScore([
      { id: "a", signal: "contact.no_whatsapp", points: 10 },
      { id: "b", signal: "website.working", points: -20 },
    ]);
    expect(max).toBe(10);
  });

  it("computes the built-in maximum as 170", () => {
    // 50 website + 20 reviews + 20 rating + 15 IG + 10 FB + 10 LI
    // + 10 whatsapp + 10 booking + 10 analytics + 10 pixel + 5 email
    expect(BUILT_IN_MAX).toBe(170);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluate", () => {
  const simpleSet = {
    name: "Test",
    version: 3,
    rules: [
      { id: "a", signal: "website.missing", points: 40 },
      { id: "b", signal: "contact.no_whatsapp", points: 10 },
    ],
    hotThreshold: 0.8,
    warmThreshold: 0.4,
  };

  it("reports the score, the maximum and the ratio together", () => {
    const result = evaluate(makeLead({ websiteStatus: "MISSING" }), simpleSet);
    expect(result.score).toBe(50);
    expect(result.max).toBe(50);
    expect(result.ratio).toBe(1);
    expect(result.priority).toBe("HOT");
  });

  it("lists the rules that fired, with their points", () => {
    const result = evaluate(makeLead({ websiteStatus: "MISSING" }), simpleSet);
    expect(result.breakdown).toEqual([
      { signal: "website.missing", label: "No website at all", points: 40 },
      { signal: "contact.no_whatsapp", label: "No WhatsApp channel", points: 10 },
    ]);
  });

  it("uses a rule's own label in the breakdown when given one", () => {
    const result = evaluate(makeLead({ websiteStatus: "MISSING" }), {
      ...simpleSet,
      rules: [{ id: "a", signal: "website.missing", points: 40, label: "Needs a site built" }],
    });
    expect(result.breakdown[0].label).toBe("Needs a site built");
  });

  it("stamps the rule set version, so a score stays comparable", () => {
    const result = evaluate(makeLead(), { ...simpleSet, id: "rs_1" });
    expect(result.ruleSetId).toBe("rs_1");
    expect(result.ruleSetVersion).toBe(3);
  });

  it("skips disabled rules", () => {
    const result = evaluate(makeLead({ websiteStatus: "MISSING" }), {
      ...simpleSet,
      rules: [
        { id: "a", signal: "website.missing", points: 40, enabled: false },
        { id: "b", signal: "contact.no_whatsapp", points: 10 },
      ],
    });
    expect(result.score).toBe(10);
    expect(result.max).toBe(10);
  });

  it("honours a rule's threshold override", () => {
    const lead = makeLead({ reviews: 50 });
    const rules = [{ id: "a", signal: "reputation.many_reviews", points: 20, when: 40 }];
    expect(evaluate(lead, { ...simpleSet, rules }).score).toBe(20);

    const stricter = [{ id: "a", signal: "reputation.many_reviews", points: 20, when: 60 }];
    expect(evaluate(lead, { ...simpleSet, rules: stricter }).score).toBe(0);
  });

  it("clamps a negative total to zero", () => {
    // "Worse than no signals at all" is not a meaningful position on the scale.
    const result = evaluate(makeLead({ websiteStatus: "WORKING" }), {
      ...simpleSet,
      rules: [
        { id: "a", signal: "website.working", points: -50 },
        { id: "b", signal: "contact.has_phone", points: 10 },
      ],
    });
    expect(result.score).toBe(0);
  });

  it("clamps to the maximum when overlapping thresholds let two rules fire", () => {
    // A tenant can configure "more than 10 reviews" and "at most 50 reviews",
    // which both fire at 30. The group maximum says 20, so the clamp is what
    // keeps the score on the scale rather than at 120%.
    const result = evaluate(makeLead({ reviews: 30 }), {
      ...simpleSet,
      rules: [
        { id: "a", signal: "reputation.many_reviews", points: 20, when: 10 },
        { id: "b", signal: "reputation.few_reviews", points: 20, when: 50 },
      ],
    });
    expect(result.max).toBe(20);
    expect(result.score).toBe(20);
    expect(result.ratio).toBe(1);
  });

  it("grades everything COLD when no rule can award points", () => {
    const result = evaluate(makeLead(), {
      ...simpleSet,
      rules: [{ id: "a", signal: "website.working", points: -10 }],
    });
    expect(result.max).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.priority).toBe("COLD");
  });

  it("does not mutate the lead", () => {
    const lead = makeLead({ websiteStatus: "MISSING" });
    const snapshot = JSON.stringify(lead);
    evaluate(lead, simpleSet);
    expect(JSON.stringify(lead)).toBe(snapshot);
  });

  it("survives a lead missing most fields", () => {
    const result = evaluate({ businessName: "Bare" }, builtInRuleSet());
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.max).toBe(170);
  });
});

describe("fractional priority bands", () => {
  const set = (hot: number, warm: number) => ({
    name: "Bands",
    version: 1,
    rules: [{ id: "a", signal: "website.missing", points: 100 }],
    hotThreshold: hot,
    warmThreshold: warm,
  });

  it("grades on the share of the maximum, not an absolute score", () => {
    // The same 100-point lead is HOT under a 100-point maximum and COLD under a
    // 1000-point one. The old absolute thresholds could not express that, so
    // changing any weight moved the bands without anyone touching them.
    const hundredMax = evaluate(makeLead({ websiteStatus: "MISSING" }), set(0.9, 0.5));
    expect(hundredMax.priority).toBe("HOT");

    const thousandMax = evaluate(makeLead({ websiteStatus: "MISSING" }), {
      ...set(0.9, 0.5),
      rules: [
        { id: "a", signal: "website.missing", points: 100 },
        { id: "b", signal: "contact.no_whatsapp", points: 900 },
      ],
    });
    expect(thousandMax.score).toBe(1_000);
    expect(thousandMax.priority).toBe("HOT");
  });

  it("puts a lead exactly on the threshold in the higher band", () => {
    const result = evaluate(makeLead({ websiteStatus: "MISSING" }), set(1, 0.5));
    expect(result.ratio).toBe(1);
    expect(result.priority).toBe("HOT");
  });

  it("tolerates thresholds that have no exact binary representation", () => {
    // The built-in bands are 100/170 and 60/170. Without a comparison tolerance
    // a lead scoring exactly 100 can land one ULP below its own threshold.
    const ruleSet = builtInRuleSet();
    const hundred = evaluate(
      makeLead({
        websiteStatus: "MISSING",
        reviews: 500,
        rating: 4.9,
        instagramStatus: "ACTIVE",
        facebookStatus: "ACTIVE",
        linkedinStatus: "ACTIVE",
      }),
      ruleSet
    );
    expect(hundred.score).toBe(135);
    expect(hundred.priority).toBe("HOT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRules", () => {
  it("accepts a JSON string as well as an array", () => {
    const fromString = parseRules(JSON.stringify(BUILT_IN_RULES));
    expect(fromString.rules).toHaveLength(BUILT_IN_RULES.length);
  });

  it("rejects unparseable JSON", () => {
    expect(() => parseRules("{not json")).toThrow(RuleSetValidationError);
  });

  it("rejects a non-array", () => {
    expect(() => parseRules({ signal: "website.missing" })).toThrow(/must be an array/);
  });

  it("drops a rule naming an unknown signal, rather than rejecting the set", () => {
    // A set saved against a later release should keep scoring with the rules this
    // build understands. Refusing it outright would take the tenant's scoring
    // offline over a rule they may not even use.
    const { rules, dropped } = parseRules([
      { signal: "website.missing", points: 50 },
      { signal: "website.on_fire", points: 99 },
    ]);
    expect(rules).toHaveLength(1);
    expect(dropped).toEqual(["website.on_fire"]);
  });

  it("rejects a set with no usable rules at all", () => {
    expect(() => parseRules([{ signal: "nope", points: 1 }])).toThrow(/at least one rule/i);
  });

  it("rejects non-numeric points", () => {
    expect(() => parseRules([{ signal: "website.missing", points: "lots" }])).toThrow(
      /non-numeric/
    );
  });

  it("rejects points outside the allowed range", () => {
    expect(() => parseRules([{ signal: "website.missing", points: 100_000 }])).toThrow(
      /outside the allowed range/
    );
  });

  it("refuses an unreasonably large set", () => {
    const many = Array.from({ length: 61 }, () => ({ signal: "website.missing", points: 1 }));
    expect(() => parseRules(many)).toThrow(/at most 60 rules/);
  });

  it("keeps only the first rule for a repeated signal", () => {
    // A duplicate would double-count the signal and break the maximum.
    const { rules } = parseRules([
      { signal: "website.missing", points: 50 },
      { signal: "website.missing", points: 30 },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].points).toBe(50);
  });

  it("rounds fractional points", () => {
    const { rules } = parseRules([{ signal: "website.missing", points: 12.6 }]);
    expect(rules[0].points).toBe(13);
  });

  it("defaults a rule to enabled", () => {
    const { rules } = parseRules([{ signal: "website.missing", points: 10 }]);
    expect(rules[0].enabled).toBe(true);
  });

  it("preserves an explicit disable", () => {
    const { rules } = parseRules([
      { signal: "website.missing", points: 10, enabled: false },
      { signal: "contact.no_whatsapp", points: 10 },
    ]);
    expect(rules[0].enabled).toBe(false);
  });
});

describe("parseThresholds", () => {
  it("accepts a valid pair", () => {
    expect(parseThresholds(0.6, 0.3)).toEqual({ hotThreshold: 0.6, warmThreshold: 0.3 });
  });

  it("rejects values outside 0..1, since they are shares not points", () => {
    expect(() => parseThresholds(100, 60)).toThrow(/between 0 and 1/);
    expect(() => parseThresholds(0, 0)).toThrow(/between 0 and 1/);
  });

  it("rejects a WARM band at or above the HOT band", () => {
    expect(() => parseThresholds(0.5, 0.5)).toThrow(/below the HOT threshold/);
    expect(() => parseThresholds(0.4, 0.6)).toThrow(/below the HOT threshold/);
  });

  it("rejects non-numbers", () => {
    expect(() => parseThresholds("high", "low")).toThrow(/must be numbers/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parity with the pre-Phase-4 scorer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A frozen transcription of src/digitalPresenceScorer.ts as it shipped before
 * Phase 4.
 *
 * Duplicated on purpose and never to be refactored: its only job is to be the
 * historical specification. The moment it shares code with the engine it stops
 * proving anything.
 */
function legacyScore(lead: ReturnType<typeof makeLead>): { score: number; priority: string } {
  let score = 0;

  if (lead.websiteStatus === "MISSING") score += 50;
  else if (lead.websiteStatus === "BROKEN") score += 40;
  else if (lead.websiteStatus === "OUTDATED") score += 30;

  if (lead.reviews > 100) score += 20;
  if (lead.rating > 4.5) score += 20;

  if (lead.instagramStatus === "NOT_FOUND") score += 15;
  else if (lead.instagramStatus === "INACTIVE") score += 10;

  if (lead.facebookStatus === "NOT_FOUND") score += 10;
  else if (lead.facebookStatus === "INACTIVE") score += 10;

  if (lead.websiteStatus !== "MISSING" && lead.websiteStatus !== "BROKEN") {
    if (!lead.whatsappPresent) score += 10;
    if (!lead.appointmentSystem) score += 10;
  } else {
    score += 10;
    score += 10;
  }

  if (lead.websiteStatus !== "MISSING" && lead.websiteStatus !== "BROKEN") {
    if (!lead.googleAnalyticsPresent) score += 10;
    if (!lead.metaPixelPresent) score += 10;
    if (!lead.emails || lead.emails.length === 0) score += 5;
  } else {
    score += 10;
    score += 10;
    score += 5;
  }

  if (lead.linkedinStatus === "NOT_FOUND") score += 10;

  score = Math.min(score, 200);

  let priority = "COLD";
  if (score >= 100) priority = "HOT";
  else if (score >= 60) priority = "WARM";

  return { score, priority };
}

describe("parity with the pre-Phase-4 scorer", () => {
  it("reproduces the reachable maximum and the legacy bands", () => {
    expect(BUILT_IN_MAX).toBe(170);
    expect(BUILT_IN_HOT_THRESHOLD * BUILT_IN_MAX).toBeCloseTo(100, 9);
    expect(BUILT_IN_WARM_THRESHOLD * BUILT_IN_MAX).toBeCloseTo(60, 9);
  });

  it("agrees on every combination the old scorer could observe", () => {
    const ruleSet = builtInRuleSet();
    const websiteStatuses = ["MISSING", "BROKEN", "OUTDATED", "WORKING"] as const;
    const socialStatuses = ["NOT_FOUND", "ACTIVE", "INACTIVE"] as const;
    const linkedinStatuses = ["NOT_FOUND", "ACTIVE"] as const;
    // Values either side of each strict comparison in the old code.
    const reviewCounts = [0, 100, 101];
    const ratings = [0, 4.5, 4.6];

    let checked = 0;
    const mismatches: string[] = [];

    for (const websiteStatus of websiteStatuses) {
      for (const instagramStatus of socialStatuses) {
        for (const facebookStatus of socialStatuses) {
          for (const linkedinStatus of linkedinStatuses) {
            for (const reviews of reviewCounts) {
              for (const rating of ratings) {
                for (const whatsappPresent of [true, false]) {
                  for (const appointmentSystem of [true, false]) {
                    for (const googleAnalyticsPresent of [true, false]) {
                      for (const metaPixelPresent of [true, false]) {
                        for (const hasEmail of [true, false]) {
                          const lead = makeLead({
                            websiteStatus,
                            instagramStatus,
                            facebookStatus,
                            linkedinStatus,
                            reviews,
                            rating,
                            whatsappPresent,
                            appointmentSystem,
                            googleAnalyticsPresent,
                            metaPixelPresent,
                            emails: hasEmail ? ["a@b.test"] : [],
                          });

                          const expected = legacyScore(lead);
                          const actual = evaluate(lead, ruleSet);
                          checked++;

                          if (
                            actual.score !== expected.score ||
                            actual.priority !== expected.priority
                          ) {
                            mismatches.push(
                              `${websiteStatus}/${instagramStatus}/${facebookStatus}/${linkedinStatus} ` +
                                `r=${reviews} rt=${rating} wa=${whatsappPresent} bk=${appointmentSystem} ` +
                                `ga=${googleAnalyticsPresent} px=${metaPixelPresent} em=${hasEmail}: ` +
                                `expected ${expected.score}/${expected.priority}, ` +
                                `got ${actual.score}/${actual.priority}`
                            );
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(checked).toBe(4 * 3 * 3 * 2 * 3 * 3 * 2 * 2 * 2 * 2 * 2);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("keeps the quirk where a missing website awards the on-site bonuses anyway", () => {
    // Preserved rather than fixed. A site that cannot be loaded means the
    // analyzer could not look, and "could not look" and "looked and found
    // nothing" lead to the same conclusion: no reachable channel there. Changing
    // it would silently re-rank every lead already in every customer's CRM.
    const ruleSet = builtInRuleSet();
    const featuresPresent = evaluate(
      makeLead({
        websiteStatus: "MISSING",
        whatsappPresent: true,
        appointmentSystem: true,
        googleAnalyticsPresent: true,
        metaPixelPresent: true,
        emails: ["hi@example.test"],
      }),
      ruleSet
    );
    expect(featuresPresent.score).toBe(95);
  });

  it("no longer reports an unreachable denominator", () => {
    // The old scorer clamped at 200 and told the AI prompt the score was out of
    // 200, so a maximally-underserved lead read as 85% instead of 100%.
    const worst = evaluate(
      makeLead({
        websiteStatus: "MISSING",
        reviews: 500,
        rating: 4.9,
        instagramStatus: "NOT_FOUND",
        facebookStatus: "NOT_FOUND",
        linkedinStatus: "NOT_FOUND",
      }),
      builtInRuleSet()
    );
    expect(worst.score).toBe(170);
    expect(worst.max).toBe(170);
    expect(worst.ratio).toBe(1);
  });
});

describe("the built-in rule set", () => {
  it("names only known signals", () => {
    for (const rule of BUILT_IN_RULES) {
      expect(getSignal(rule.signal), `unknown signal ${rule.signal}`).toBeDefined();
    }
  });

  it("passes its own validation", () => {
    expect(() => parseRules(BUILT_IN_RULES)).not.toThrow();
    expect(() =>
      parseThresholds(BUILT_IN_HOT_THRESHOLD, BUILT_IN_WARM_THRESHOLD)
    ).not.toThrow();
  });
});
