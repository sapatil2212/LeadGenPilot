/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TESTS — src/prompts
 *
 * Prompts are product copy: this wording reaches a customer's prospects under
 * the customer's own name. The grounding rules in particular are a safety
 * property, not a style preference — they are what stops the model inventing a
 * certification or a specification that the sending company then has to answer
 * for. Asserting they are present in every prompt is cheap insurance against
 * someone building a prompt without them.
 */

import { describe, it, expect } from "vitest";
import {
  PROMPTS,
  listPrompts,
  promptRef,
  GROUNDING_PREAMBLE,
  withGrounding,
  leadInsightPrompt,
  outreachCopyPrompt,
  validateOutreachCopy,
  businessExtractionPrompt,
  validateBusinessExtraction,
  assistantPrompt,
} from "../src/prompts";

describe("registry integrity", () => {
  it("keys every prompt by its own name", () => {
    for (const [key, prompt] of Object.entries(PROMPTS)) {
      expect(prompt.name).toBe(key);
    }
  });

  it("gives every prompt a version and a description", () => {
    for (const prompt of Object.values(PROMPTS)) {
      expect(prompt.version).toBeGreaterThanOrEqual(1);
      expect(prompt.description.length).toBeGreaterThan(20);
    }
  });

  it("produces a storable reference for artefact provenance", () => {
    expect(promptRef(leadInsightPrompt)).toEqual({
      promptName: "lead.insight",
      promptVersion: 1,
    });
  });

  it("lists prompts for diagnostics", () => {
    const listed = listPrompts();
    expect(listed.length).toBe(Object.keys(PROMPTS).length);
    expect(listed.map((p) => p.name)).toContain("assistant.chat");
  });
});

describe("grounding rules", () => {
  it("forbids invention and prescribes what to do instead", () => {
    // "Be accurate" is advice; "write Unknown when you lack the fact" is a rule
    // with an observable outcome.
    expect(GROUNDING_PREAMBLE).toMatch(/Never invent/i);
    expect(GROUNDING_PREAMBLE).toMatch(/Unknown/);
    expect(GROUNDING_PREAMBLE).toMatch(/fabricate metrics/i);
    expect(GROUNDING_PREAMBLE).toMatch(/pricing|certifications/i);
  });

  it("states that it overrides other instructions", () => {
    expect(GROUNDING_PREAMBLE).toMatch(/override/i);
  });

  it("prepends the preamble rather than replacing the prompt's own system text", () => {
    const message = withGrounding("Specific instruction here.");
    expect(message.role).toBe("system");
    expect(message.content.startsWith(GROUNDING_PREAMBLE)).toBe(true);
    expect(message.content).toMatch(/Specific instruction here\./);
  });

  /** The property that actually matters: no prompt can skip it. */
  it.each(Object.keys(PROMPTS))("%s carries the grounding rules", (name) => {
    const prompt = (PROMPTS as any)[name];
    const sampleInput: Record<string, unknown> = {
      // lead.insight
      businessName: "Acme", rating: 4, reviews: 10, websiteStatus: "MISSING",
      instagramStatus: "NOT_FOUND", facebookStatus: "NOT_FOUND",
      whatsappPresent: false, appointmentSystem: false, leadScore: 50, leadPriority: "COLD",
      // outreach.copy
      cleanName: "Acme",
      // business.extraction
      sourceText: "We make X-ray machines.",
      // assistant.chat
      business: {}, knowledge: [], history: [], question: "What do we sell?",
    };

    const messages = prompt.build(sampleInput);
    const system = messages.filter((m: any) => m.role === "system");
    expect(system.length).toBeGreaterThan(0);
    expect(system.some((m: any) => m.content.includes("Never invent"))).toBe(true);
  });
});

describe("lead.insight", () => {
  const input = {
    businessName: "Acme Diagnostics", rating: 4.8, reviews: 120,
    websiteStatus: "MISSING", instagramStatus: "NOT_FOUND", facebookStatus: "INACTIVE",
    whatsappPresent: false, appointmentSystem: false,
    leadScore: 130, leadPriority: "HOT",
  };

  it("includes the audit metrics the model is asked to reason over", () => {
    const user = leadInsightPrompt.build(input).find((m) => m.role === "user")!.content;
    expect(user).toContain("Acme Diagnostics");
    expect(user).toContain("Website Status: MISSING");
    expect(user).toContain("4.8 (120 reviews)");
  });

  /**
   * The denominator is wrong: the current scorer's reachable maximum is 170, so
   * a hot lead is shown to the model as ~65% instead of ~76%. It is preserved at
   * 200 so Phase 3 changes no output, and parameterised so Phase 4 can pass the
   * real maximum from the configurable rule set.
   */
  it("defaults the score denominator to the current (incorrect) 200", () => {
    const user = leadInsightPrompt.build(input).find((m) => m.role === "user")!.content;
    expect(user).toContain("130/200");
  });

  it("accepts a corrected denominator", () => {
    const user = leadInsightPrompt
      .build({ ...input, scoreDenominator: 170 })
      .find((m) => m.role === "user")!.content;
    expect(user).toContain("130/170");
  });
});

describe("outreach.copy", () => {
  it("pins the business name into the required message template", () => {
    const user = outreachCopyPrompt.build({ cleanName: "Bharat X-Ray" }).find((m) => m.role === "user")!.content;
    expect(user).toContain('Use exactly "Bharat X-Ray"');
    expect(user).toMatch(/raw JSON/i);
  });
});

describe("validateOutreachCopy", () => {
  it("accepts a complete triple and trims it", () => {
    expect(
      validateOutreachCopy({ emailSubject: " s ", emailBody: " b ", whatsappMessage: " w " })
    ).toEqual({ emailSubject: "s", emailBody: "b", whatsappMessage: "w" });
  });

  const invalidPayloads: [unknown, string][] = [
    [{ emailSubject: "s", emailBody: "b" }, "missing whatsappMessage"],
    [{ emailSubject: "", emailBody: "b", whatsappMessage: "w" }, "blank subject"],
    [{ emailSubject: "s", emailBody: "   ", whatsappMessage: "w" }, "whitespace body"],
    [null, "null"],
    ["a string", "not an object"],
  ];

  it.each(invalidPayloads)("rejects %s (%s)", (input) => {
    expect(validateOutreachCopy(input)).toBeNull();
  });
});

describe("validateBusinessExtraction", () => {
  it("normalises a full payload", () => {
    const result = validateBusinessExtraction({
      businessName: " Bharat X-Ray Systems ",
      industry: "Medical Equipment",
      products: [
        { name: "Portable X-Ray", category: "Imaging", keyFeatures: ["battery", 42], idealFor: ["Hospital"] },
        { name: "", description: "nameless, dropped" },
      ],
      services: [{ name: "Installation" }, { description: "nameless, dropped" }],
      targetCustomerTypes: ["Hospital", "Diagnostic Centre"],
      confidence: 0.8,
    });

    expect(result!.businessName).toBe("Bharat X-Ray Systems");
    // A product with no name is unusable downstream, so it is dropped.
    expect(result!.products).toHaveLength(1);
    expect(result!.products[0].keyFeatures).toEqual(["battery"]);
    expect(result!.services).toHaveLength(1);
    expect(result!.confidence).toBe(0.8);
  });

  /** The model is told to write "Unknown" rather than guess; store it as absent. */
  it("treats the literal 'Unknown' as no value", () => {
    const result = validateBusinessExtraction({ businessName: "Unknown", industry: "unknown" });
    expect(result!.businessName).toBeNull();
    expect(result!.industry).toBeNull();
  });

  it("clamps confidence into 0..1", () => {
    expect(validateBusinessExtraction({ confidence: 5 })!.confidence).toBe(1);
    expect(validateBusinessExtraction({ confidence: -2 })!.confidence).toBe(0);
    expect(validateBusinessExtraction({})!.confidence).toBe(0.5);
  });

  it("returns empty arrays rather than throwing on wrong types", () => {
    const result = validateBusinessExtraction({ products: "not an array", targetIndustries: 7 });
    expect(result!.products).toEqual([]);
    expect(result!.targetIndustries).toEqual([]);
  });

  it("rejects a non-object payload", () => {
    expect(validateBusinessExtraction(null)).toBeNull();
    expect(validateBusinessExtraction("text")).toBeNull();
  });
});

describe("assistant.chat", () => {
  it("renders the business profile and retrieved excerpts into the system turn", () => {
    const messages = assistantPrompt.build({
      business: {
        businessName: "Bharat X-Ray Systems",
        industry: "Medical Equipment",
        products: [{ name: "Portable X-Ray", description: "Battery powered" }],
      },
      knowledge: [{ documentTitle: "Catalogue 2026", content: "Model PX-100 weighs 12kg." }],
      history: [],
      question: "What is the PX-100 weight?",
    });

    const system = messages[0].content;
    expect(system).toContain("Bharat X-Ray Systems");
    expect(system).toContain("Portable X-Ray");
    expect(system).toContain("Catalogue 2026");
    expect(system).toContain("Model PX-100 weighs 12kg.");
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What is the PX-100 weight?",
    });
  });

  it("says so explicitly when there is nothing to work from", () => {
    const system = assistantPrompt
      .build({ business: {}, knowledge: [], history: [], question: "Who should we target?" })[0]
      .content;
    expect(system).toContain("No business profile has been set up yet.");
    expect(system).toContain("No document excerpts were retrieved");
  });

  it("preserves prior turns between the context and the new question", () => {
    const messages = assistantPrompt.build({
      business: {},
      knowledge: [],
      history: [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      question: "follow up",
    });

    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[3].content).toBe("follow up");
  });
});
