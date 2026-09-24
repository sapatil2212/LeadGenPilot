/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CHARACTERIZATION TESTS — src/outreachTemplates.ts
 *
 * Template compilation currently runs in the BROWSER and the compiled body is
 * POSTed to the server, so the server never sees the template. Phase 5 moves
 * compilation server-side and Phase 5/6 move template storage out of
 * localStorage into tenant-scoped DB rows.
 *
 * These tests pin the substitution contract so the server-side implementation
 * can be proven byte-identical for existing templates.
 *
 * Note: loadOutreachTemplates() is deliberately NOT tested — it touches
 * localStorage, which does not exist in the Node test environment and which is
 * itself the thing Phase 5 removes.
 */

import { describe, it, expect } from "vitest";
import {
  fillTemplateVariables,
  templateNeedsAiBody,
  compileTemplateText,
  compileTemplateSubject,
  type OutreachTemplate,
} from "../src/outreachTemplates";
import { makeLead } from "./helpers/leadFixture";

function makeTemplate(overrides: Partial<OutreachTemplate> = {}): OutreachTemplate {
  return {
    id: "tpl_1",
    name: "Test template",
    templateType: "email",
    subject: "",
    designMode: "builder",
    htmlCode: "",
    useLogo: false,
    logoType: "text",
    logoValue: "",
    introText: "",
    useAiBody: false,
    customBodyText: "",
    useCta: false,
    ctaText: "",
    ctaUrl: "",
    ctaBgColor: "#4f46e5",
    useContact: false,
    contactText: "",
    useFooter: false,
    footerText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fillTemplateVariables — supported placeholders", () => {
  const lead = makeLead({
    businessName: "Acme Diagnostics",
    category: "Diagnostic Center",
    phone: "+91 98765 43210",
    website: "https://acme.example",
    address: "12 MG Road, Pune, Maharashtra 411001",
  });

  it.each([
    ["{{company}}", "Acme Diagnostics"],
    ["{{name}}", "Acme Diagnostics"],
    ["{{business}}", "Acme Diagnostics"],
    ["{{category}}", "Diagnostic Center"],
    ["{{phone}}", "+91 98765 43210"],
    ["{{website}}", "https://acme.example"],
  ])("substitutes %s", (token, expected) => {
    expect(fillTemplateVariables(token, lead)).toBe(expected);
  });

  it("derives {{city}} and {{location}} from the second-to-last address segment", () => {
    // "12 MG Road, Pune, Maharashtra 411001" -> segments -> "Pune"
    expect(fillTemplateVariables("{{city}}", lead)).toBe("Pune");
    expect(fillTemplateVariables("{{location}}", lead)).toBe("Pune");
  });

  it("strips 4+ digit runs out of the derived city", () => {
    const withPin = makeLead({ address: "Plot 5, Nashik 422001, Maharashtra" });
    expect(fillTemplateVariables("{{city}}", withPin)).toBe("Nashik");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(fillTemplateVariables("{{company}} and {{company}}", lead)).toBe(
      "Acme Diagnostics and Acme Diagnostics"
    );
  });

  it("returns an empty string for empty input", () => {
    expect(fillTemplateVariables("", lead)).toBe("");
  });
});

describe("fillTemplateVariables — fallbacks for missing lead data", () => {
  it("falls back to friendly defaults rather than emitting blanks", () => {
    const bare = makeLead({ businessName: "", category: "", address: "" });
    expect(fillTemplateVariables("{{company}}", bare)).toBe("your business");
    expect(fillTemplateVariables("{{name}}", bare)).toBe("there");
    expect(fillTemplateVariables("{{category}}", bare)).toBe("your industry");
    expect(fillTemplateVariables("{{city}}", bare)).toBe("your area");
  });

  it("emits an empty string for missing phone and website (no friendly default)", () => {
    const bare = makeLead({ phone: "", website: "" });
    expect(fillTemplateVariables("{{phone}}", bare)).toBe("");
    expect(fillTemplateVariables("{{website}}", bare)).toBe("");
  });
});

describe("fillTemplateVariables — documented quirks", () => {
  /**
   * Substitution is exact-match against a fixed map, so a token with inner
   * whitespace is left verbatim and ships to the recipient as literal text.
   * Phase 5's server-side compiler must either normalise whitespace or reject
   * unknown tokens at save time.
   */
  it("does NOT substitute tokens containing spaces", () => {
    const lead = makeLead({ businessName: "Acme" });
    expect(fillTemplateVariables("{{ company }}", lead)).toBe("{{ company }}");
  });

  /**
   * Unknown tokens are also passed through verbatim rather than blanked, so a
   * typo like {{compnay}} is delivered to the lead as-is. There is no
   * validation step before send anywhere in the current pipeline.
   */
  it("leaves unknown tokens in the outgoing message", () => {
    const lead = makeLead();
    expect(fillTemplateVariables("Hi {{compnay}}", lead)).toBe("Hi {{compnay}}");
    expect(fillTemplateVariables("{{unsubscribe}}", lead)).toBe("{{unsubscribe}}");
  });

  /**
   * There is no {{unsubscribe}} / {{opt_out}} variable at all. Phase 6 must add
   * one, together with a suppression list, before any production send.
   */
  it("has no opt-out variable in the substitution map", () => {
    const lead = makeLead();
    expect(fillTemplateVariables("{{opt_out}}", lead)).toBe("{{opt_out}}");
  });
});

describe("templateNeedsAiBody", () => {
  it("is true when useAiBody is set", () => {
    expect(templateNeedsAiBody(makeTemplate({ useAiBody: true, customBodyText: "written" }))).toBe(true);
  });

  it("is true when there is no custom body, even if useAiBody is false", () => {
    expect(templateNeedsAiBody(makeTemplate({ useAiBody: false, customBodyText: "" }))).toBe(true);
    expect(templateNeedsAiBody(makeTemplate({ useAiBody: false, customBodyText: "   " }))).toBe(true);
  });

  it("is false only when a custom body is supplied and AI is off", () => {
    expect(templateNeedsAiBody(makeTemplate({ useAiBody: false, customBodyText: "written" }))).toBe(false);
  });
});

describe("compileTemplateText", () => {
  const lead = makeLead({ businessName: "Acme Diagnostics" });

  it("joins enabled builder sections with blank lines in a fixed order", () => {
    const tpl = makeTemplate({
      introText: "Hello {{company}},",
      customBodyText: "We supply diagnostic equipment.",
      useCta: true,
      ctaText: "Book a demo",
      ctaUrl: "https://acme.example/demo",
      useContact: true,
      contactText: "Call us on 1800-000-000",
      useFooter: true,
      footerText: "Acme Pvt Ltd",
    });
    expect(compileTemplateText(tpl, lead)).toBe(
      [
        "Hello Acme Diagnostics,",
        "We supply diagnostic equipment.",
        "Book a demo https://acme.example/demo",
        "Call us on 1800-000-000",
        "Acme Pvt Ltd",
      ].join("\n\n")
    );
  });

  it("injects the AI body when the template relies on AI", () => {
    const tpl = makeTemplate({ introText: "Hi {{company}},", useAiBody: true });
    expect(compileTemplateText(tpl, lead, "AI generated pitch.")).toBe(
      "Hi Acme Diagnostics,\n\nAI generated pitch."
    );
  });

  it("omits disabled sections entirely", () => {
    const tpl = makeTemplate({
      introText: "Intro",
      customBodyText: "Body",
      useCta: false,
      ctaText: "ignored",
      useFooter: false,
      footerText: "ignored",
    });
    expect(compileTemplateText(tpl, lead)).toBe("Intro\n\nBody");
  });

  it("returns raw variable-filled HTML in code mode, bypassing every section", () => {
    const tpl = makeTemplate({
      designMode: "code",
      htmlCode: "<p>Hi {{company}}</p>",
      introText: "ignored",
      useFooter: true,
      footerText: "ignored",
    });
    expect(compileTemplateText(tpl, lead)).toBe("<p>Hi Acme Diagnostics</p>");
  });

  /**
   * The campaign loop passes the SAME compiled text to both the email and the
   * WhatsApp provider, so a code-mode template sends raw HTML as a WhatsApp
   * message body. Phase 5/6 must compile per channel.
   */
  it("produces HTML that would be sent verbatim on a plain-text channel", () => {
    const tpl = makeTemplate({ designMode: "code", htmlCode: "<h1>Offer</h1>" });
    expect(compileTemplateText(tpl, lead)).toContain("<h1>");
  });
});

describe("compileTemplateSubject", () => {
  const lead = makeLead({ businessName: "Acme Diagnostics" });

  it("substitutes variables in the subject", () => {
    const tpl = makeTemplate({ subject: "A proposal for {{company}}" });
    expect(compileTemplateSubject(tpl, lead)).toBe("A proposal for Acme Diagnostics");
  });

  it("falls back to the supplied default when the subject is blank", () => {
    const tpl = makeTemplate({ subject: "   " });
    expect(compileTemplateSubject(tpl, lead, "AI subject")).toBe("AI subject");
  });

  it("returns an empty string when both subject and fallback are absent", () => {
    expect(compileTemplateSubject(makeTemplate(), lead)).toBe("");
  });
});
