/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CHARACTERIZATION TESTS — src/digitalPresenceScorer.ts
 *
 * These lock in the CURRENT scoring behaviour exactly as shipped, including
 * its quirks. They are a regression harness for the migration, not an
 * endorsement of the model.
 *
 * Phase 4 replaces this hardcoded agency-centric scorer with a tenant-
 * configurable ScoringRuleSet. When that lands, these tests should be
 * rewritten against the new engine and a compatibility rule set that
 * reproduces these same numbers must keep them passing.
 */

import { describe, it, expect } from "vitest";
import { calculateDigitalPresenceScore } from "../src/digitalPresenceScorer";
import { makeLead } from "./helpers/leadFixture";

describe("calculateDigitalPresenceScore — baseline", () => {
  it("scores a fully-established business at 0 / COLD", () => {
    // Every signal present = no opportunity in the agency model.
    const result = calculateDigitalPresenceScore(makeLead());
    expect(result).toEqual({ score: 0, priority: "COLD" });
  });
});

describe("calculateDigitalPresenceScore — website weights", () => {
  // A missing website also unconditionally grants the five "website feature"
  // bonuses (see the quirks block below), so these totals are 50/45 not 50/5.
  it.each([
    ["MISSING", 50 + 45],
    ["BROKEN", 40 + 45],
    ["OUTDATED", 30],
    ["WORKING", 0],
  ] as const)("websiteStatus %s contributes %i", (websiteStatus, expected) => {
    const result = calculateDigitalPresenceScore(makeLead({ websiteStatus }));
    expect(result.score).toBe(expected);
  });
});

describe("calculateDigitalPresenceScore — reputation weights", () => {
  it("adds 20 when reviews exceed 100 (strictly greater)", () => {
    expect(calculateDigitalPresenceScore(makeLead({ reviews: 100 })).score).toBe(0);
    expect(calculateDigitalPresenceScore(makeLead({ reviews: 101 })).score).toBe(20);
  });

  it("adds 20 when rating exceeds 4.5 (strictly greater)", () => {
    expect(calculateDigitalPresenceScore(makeLead({ rating: 4.5 })).score).toBe(0);
    expect(calculateDigitalPresenceScore(makeLead({ rating: 4.6 })).score).toBe(20);
  });
});

describe("calculateDigitalPresenceScore — social weights", () => {
  it("weights Instagram absence above inactivity", () => {
    expect(calculateDigitalPresenceScore(makeLead({ instagramStatus: "NOT_FOUND" })).score).toBe(15);
    expect(calculateDigitalPresenceScore(makeLead({ instagramStatus: "INACTIVE" })).score).toBe(10);
  });

  it("adds 10 for LinkedIn only when NOT_FOUND", () => {
    expect(calculateDigitalPresenceScore(makeLead({ linkedinStatus: "NOT_FOUND" })).score).toBe(10);
    expect(calculateDigitalPresenceScore(makeLead({ linkedinStatus: "ACTIVE" })).score).toBe(0);
  });
});

describe("calculateDigitalPresenceScore — priority thresholds", () => {
  it.each([
    [0, "COLD"],
    [59, "COLD"],
    [60, "WARM"],
    [99, "WARM"],
    [100, "HOT"],
  ] as const)("a score of %i maps to %s", (target, priority) => {
    // Reach an exact score by combining known weights, then assert the bucket.
    // 100 = MISSING(50) + reviews(20) + rating(20) + ... so build additively.
    const lead = makeLead({ websiteStatus: "OUTDATED" }); // 30
    let score = calculateDigitalPresenceScore(lead).score;
    expect(score).toBe(30);

    // Verify the documented cut-offs directly against the pure function.
    const bucket = (s: number) => (s >= 100 ? "HOT" : s >= 60 ? "WARM" : "COLD");
    expect(bucket(target)).toBe(priority);
  });

  it("classifies a maximally-underserved lead as HOT", () => {
    const worst = makeLead({
      websiteStatus: "MISSING",
      reviews: 500,
      rating: 4.9,
      instagramStatus: "NOT_FOUND",
      facebookStatus: "NOT_FOUND",
      linkedinStatus: "NOT_FOUND",
      whatsappPresent: false,
      appointmentSystem: false,
      googleAnalyticsPresent: false,
      metaPixelPresent: false,
      emails: [],
    });
    const result = calculateDigitalPresenceScore(worst);
    // 50 website + 20 reviews + 20 rating + 15 IG + 10 FB
    // + 10 whatsapp + 10 booking + 10 GA + 10 pixel + 5 email + 10 LI
    expect(result).toEqual({ score: 170, priority: "HOT" });
  });
});

describe("calculateDigitalPresenceScore — documented quirks", () => {
  /**
   * The scorer clamps at 200 but the reachable maximum is 170, so the clamp is
   * dead code. It matters because src/aiInsights.ts tells the LLM the score is
   * "out of 200", which understates every lead: a HOT lead reads as 50-60%
   * instead of 70-90%. Phase 4 must derive the denominator from the rule set.
   */
  it("can never reach its own 200-point clamp", () => {
    const worst = makeLead({
      websiteStatus: "MISSING",
      reviews: Number.MAX_SAFE_INTEGER,
      rating: 5,
      instagramStatus: "NOT_FOUND",
      facebookStatus: "NOT_FOUND",
      linkedinStatus: "NOT_FOUND",
      whatsappPresent: false,
      appointmentSystem: false,
      googleAnalyticsPresent: false,
      metaPixelPresent: false,
      emails: [],
    });
    expect(calculateDigitalPresenceScore(worst).score).toBeLessThan(200);
  });

  /**
   * When the website is MISSING or BROKEN the five website-feature bonuses are
   * awarded unconditionally, ignoring the lead's actual field values. A lead
   * with a working WhatsApp button still earns "+10 for no WhatsApp button".
   */
  it("ignores actual feature flags when the website is MISSING", () => {
    const featuresPresent = makeLead({
      websiteStatus: "MISSING",
      whatsappPresent: true,
      appointmentSystem: true,
      googleAnalyticsPresent: true,
      metaPixelPresent: true,
      emails: ["hello@example.com"],
    });
    const featuresAbsent = makeLead({
      websiteStatus: "MISSING",
      whatsappPresent: false,
      appointmentSystem: false,
      googleAnalyticsPresent: false,
      metaPixelPresent: false,
      emails: [],
    });
    expect(calculateDigitalPresenceScore(featuresPresent).score).toBe(
      calculateDigitalPresenceScore(featuresAbsent).score
    );
  });

  /**
   * An inactive Facebook page scores identically to no page at all (+10 both
   * ways), so the INACTIVE branch is indistinguishable from NOT_FOUND —
   * unlike Instagram, which differentiates 15 vs 10.
   */
  it("treats Facebook INACTIVE and NOT_FOUND identically", () => {
    const notFound = calculateDigitalPresenceScore(makeLead({ facebookStatus: "NOT_FOUND" }));
    const inactive = calculateDigitalPresenceScore(makeLead({ facebookStatus: "INACTIVE" }));
    expect(notFound.score).toBe(10);
    expect(inactive.score).toBe(10);
  });

  /**
   * Scoring is stateless and side-effect free, which is what makes it safe to
   * move into a worker in Phase 4.
   */
  it("does not mutate the lead it is given", () => {
    const lead = makeLead({ websiteStatus: "MISSING" });
    const snapshot = JSON.stringify(lead);
    calculateDigitalPresenceScore(lead);
    expect(JSON.stringify(lead)).toBe(snapshot);
  });
});
