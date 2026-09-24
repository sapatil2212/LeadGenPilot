/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CHARACTERIZATION TESTS — src/outreachCopy.ts
 *
 * This is the rule-based fallback copy generator used whenever the AI provider
 * is unavailable or the tenant's plan excludes AI. It is hardcoded to the
 * digital-marketing-agency pitch and to five business verticals, which is
 * exactly what the universal-SaaS requirement forbids.
 *
 * These tests document the current output so Phase 5 can replace it with a
 * business-agnostic generator driven by the tenant's own BusinessProfile, and
 * prove in the diff which pitches changed.
 */

import { describe, it, expect } from "vitest";
import { cleanBusinessName, generateOutreachCopy } from "../src/outreachCopy";
import { makeLead } from "./helpers/leadFixture";

describe("cleanBusinessName", () => {
  it.each([
    ["Acme Diagnostics - Pune Branch", "Acme Diagnostics"],
    ["Acme Diagnostics | Best in Town", "Acme Diagnostics"],
    ["Acme Diagnostics (Kothrud)", "Acme Diagnostics"],
    ["Acme Diagnostics", "Acme Diagnostics"],
  ])("strips the suffix from %j", (input, expected) => {
    expect(cleanBusinessName(input)).toBe(expected);
  });

  it("returns an empty string for empty input", () => {
    expect(cleanBusinessName("")).toBe("");
  });

  it("never returns a blank result for a non-blank name", () => {
    expect(cleanBusinessName("---")).toBe("---");
  });
});

describe("generateOutreachCopy — output contract", () => {
  it("always returns all three channel fields, non-empty", () => {
    const copy = generateOutreachCopy(makeLead());
    expect(copy.emailSubject.length).toBeGreaterThan(0);
    expect(copy.emailBody.length).toBeGreaterThan(0);
    expect(copy.whatsappMessage.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same lead", () => {
    const lead = makeLead();
    expect(generateOutreachCopy(lead)).toEqual(generateOutreachCopy(lead));
  });

  it("uses the cleaned business name in the subject", () => {
    const copy = generateOutreachCopy(makeLead({ businessName: "Acme Diagnostics - Pune" }));
    expect(copy.emailSubject).toBe("Quick digital branding idea for Acme Diagnostics");
  });
});

describe("generateOutreachCopy — hardcoded vertical classification", () => {
  /**
   * Vertical detection is substring matching on businessName/category, and the
   * vocabulary is fixed. Anything outside these five verticals silently gets
   * the generic "customers / business / businesses" wording.
   */
  it.each([
    ["hospital", "patients", "hospitals"],
    ["clinic", "patients", "clinics"],
    ["dental", "patients", "clinics"],
    ["dermatologist", "patients", "clinics"],
    ["gym", "members", "gyms"],
    ["fitness", "members", "gyms"],
    ["restaurant", "customers", "restaurants"],
    ["cafe", "customers", "restaurants"],
    ["bakery", "customers", "restaurants"],
    ["salon", "clients", "salons"],
    ["spa", "clients", "salons"],
  ])("category %j yields audience %j / plural %j", (category, audience, plural) => {
    const copy = generateOutreachCopy(makeLead({ businessName: "Test", category }));
    expect(copy.whatsappMessage).toContain(audience);
    expect(copy.whatsappMessage).toContain(plural);
  });

  it("falls back to generic wording for a genuinely unrecognised vertical", () => {
    const copy = generateOutreachCopy(
      makeLead({ businessName: "Shakti Drives", category: "Industrial Automation Supplier" })
    );
    expect(copy.whatsappMessage).toContain("customers");
    expect(copy.whatsappMessage).toContain("businesses");
  });

  /**
   * Substring matching has no word boundaries, so category names that merely
   * CONTAIN a vertical keyword are misclassified. "Medical Equipment
   * Manufacturer" contains "medical", so a manufacturer selling X-ray machines
   * TO hospitals is classified as a clinic and pitched on attracting patients
   * with "educational health content, patient awareness posts, doctor
   * highlights".
   *
   * This is the single clearest demonstration of why the universal-SaaS
   * requirement forbids hardcoded categories: the misclassification is silent,
   * the output is confidently wrong, and it goes straight to a real prospect.
   * Phase 5 must drive audience/vocabulary from the tenant's BusinessProfile
   * and ICP, never from keyword matching on the lead's category.
   */
  it("MISCLASSIFIES a medical equipment manufacturer as a clinic", () => {
    const copy = generateOutreachCopy(
      makeLead({ businessName: "Bharat X-Ray Systems", category: "Medical Equipment Manufacturer" })
    );
    expect(copy.whatsappMessage).toContain("attract more patients");
    expect(copy.whatsappMessage).toContain("Many clinics are now using");
    expect(copy.whatsappMessage).toContain("patient awareness posts");
    expect(copy.whatsappMessage).toContain("specifically for your clinic");

    // The lead's own name is interpolated, but nothing the TENANT sells is:
    // there is no notion of a seller's product anywhere in this generator.
    expect(copy.whatsappMessage).toContain("Bharat X-Ray Systems");
    expect(copy.whatsappMessage.toLowerCase()).not.toContain("equipment");
    expect(copy.whatsappMessage.toLowerCase()).not.toContain("supply");
  });
});

describe("generateOutreachCopy — agency-specific assumptions to remove", () => {
  /**
   * Every generated message pitches digital branding and social media, and
   * signs off as "Digital Branding Team", regardless of what the tenant sells.
   * A medical equipment manufacturer using this today would email its hospital
   * prospects a social-media-marketing pitch signed by someone else's team.
   */
  it("pitches digital branding no matter the tenant or the lead", () => {
    const copy = generateOutreachCopy(
      makeLead({ businessName: "Bharat X-Ray Systems", category: "Medical Equipment Manufacturer" })
    );
    expect(copy.whatsappMessage).toContain("digital branding");
    expect(copy.emailBody).toContain("digital branding");
  });

  it("hardcodes the sender signature", () => {
    const copy = generateOutreachCopy(makeLead());
    expect(copy.emailBody).toContain("Digital Branding Team");
  });

  it("offers a free digital branding roadmap as the only call to action", () => {
    const copy = generateOutreachCopy(makeLead());
    expect(copy.whatsappMessage).toContain("free digital branding roadmap");
  });

  /**
   * There is no opt-out line, unsubscribe link or sender identification in the
   * generated copy. Phase 6 must add these before production sending.
   */
  it("contains no opt-out or unsubscribe language", () => {
    const copy = generateOutreachCopy(makeLead());
    const all = `${copy.emailSubject}\n${copy.emailBody}\n${copy.whatsappMessage}`.toLowerCase();
    expect(all).not.toContain("unsubscribe");
    expect(all).not.toContain("opt out");
    expect(all).not.toContain("opt-out");
    expect(all).not.toContain("reply stop");
  });
});
