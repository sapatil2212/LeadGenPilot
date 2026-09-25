/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CHARACTERIZATION TESTS — src/leadScoring.ts
 *
 * IMPORTANT: this module is currently DEAD CODE. `calculateLeadScore` has zero
 * importers anywhere in the repository; the live scorer is
 * src/digitalPresenceScorer.ts, which uses a different scale (0-170 rather
 * than 0-100) and different weights.
 *
 * It is pinned here for one reason: Phase 4 consolidates scoring into a single
 * configurable engine, and whoever does that work needs to know exactly what
 * this second model computed before deciding whether to fold it in or delete
 * it. Two scoring models that disagree on the same lead is the debt being
 * retired.
 */

import { describe, it, expect } from "vitest";
import { calculateLeadScore } from "../src/leadScoring";
import { makeLead } from "./helpers/leadFixture";

describe("calculateLeadScore (legacy, unreferenced)", () => {
  it("scores an established lead on phone presence alone", () => {
    // Working website, 50 reviews, 4.0 rating, phone present -> phone only.
    expect(calculateLeadScore(makeLead())).toBe(10);
  });

  it("adds 50 when the website is missing", () => {
    expect(calculateLeadScore(makeLead({ website: "", websiteMissing: true }))).toBe(60);
  });

  it("treats an empty website string as missing even if websiteMissing is false", () => {
    expect(calculateLeadScore(makeLead({ website: "   ", websiteMissing: false }))).toBe(60);
  });

  it("adds 20 for reviews over 100 and 20 for rating over 4.5", () => {
    expect(calculateLeadScore(makeLead({ reviews: 101 }))).toBe(30);
    expect(calculateLeadScore(makeLead({ rating: 4.6 }))).toBe(30);
  });

  it.each(["", "   ", "Not Found", "not found", "NOT FOUND"])(
    "does not award the phone bonus for %j",
    (phone) => {
      expect(calculateLeadScore(makeLead({ phone }))).toBe(0);
    }
  );

  it("caps out at 100 for the maximally-underserved lead", () => {
    const worst = makeLead({
      website: "",
      websiteMissing: true,
      reviews: 500,
      rating: 4.9,
      phone: "+91 98765 43210",
    });
    expect(calculateLeadScore(worst)).toBe(100);
  });

  /**
   * The two scorers disagree by design: this one rewards having a phone number,
   * the live one ignores phone entirely and rewards missing tracking pixels.
   * The same lead therefore gets two different scores on two different scales.
   */
  it("produces a different score than the live scorer for the same lead", async () => {
    const { calculateDigitalPresenceScore } = await import("../src/digitalPresenceScorer");
    const lead = makeLead({ website: "", websiteMissing: true, websiteStatus: "MISSING" });
    expect(calculateLeadScore(lead)).toBe(60);
    expect(calculateDigitalPresenceScore(lead).score).toBe(95);
  });
});
