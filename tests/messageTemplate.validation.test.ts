/**
 * Validation tests for the WhatsApp message template builder.
 *
 * Covers the pre-save and pre-send rules that keep a template deliverable:
 * required body, char limits, action/URL/phone validity, unique quick-reply
 * payloads, undefined-variable warnings, and the Meta API button limits.
 */

import { describe, it, expect } from "vitest";
import {
  validateForSave,
  validateForSend,
  hasErrors,
} from "../src/messageTemplates/validation";
import type { MessageTemplatePayload } from "../src/messageTemplates/types";

function base(overrides: Partial<MessageTemplatePayload> = {}): MessageTemplatePayload {
  return {
    header: { type: "none" },
    body: { text: "Hi {{first_name}}, a quick note." },
    footer: { enabled: false, text: "" },
    actions: [],
    quickReplies: [],
    variables: [
      { key: "first_name", label: "First Name", sampleValue: "Rahul", isCustom: false },
    ],
    settings: { deliveryMethod: "web", personalization: true },
    ...overrides,
  };
}

describe("validateForSave", () => {
  it("passes a minimal valid template", () => {
    expect(hasErrors(validateForSave(base()))).toBe(false);
  });

  it("errors on an empty body", () => {
    const issues = validateForSave(base({ body: { text: "" } }));
    expect(hasErrors(issues)).toBe(true);
    expect(issues.some((i) => i.field === "body")).toBe(true);
  });

  it("errors on a media header with no media URL", () => {
    const issues = validateForSave(base({ header: { type: "image" } }));
    expect(issues.some((i) => i.field === "header.media")).toBe(true);
  });

  it("errors on an action with no label", () => {
    const issues = validateForSave(
      base({ actions: [{ id: "a1", type: "url", label: "", value: "https://x.com" }] })
    );
    expect(issues.some((i) => i.field === "actions[0].label")).toBe(true);
  });

  it("errors on an invalid action URL", () => {
    const issues = validateForSave(
      base({ actions: [{ id: "a1", type: "url", label: "Go", value: "notaurl" }] })
    );
    expect(issues.some((i) => i.field === "actions[0].value")).toBe(true);
  });

  it("accepts a URL containing a variable (resolved later)", () => {
    const issues = validateForSave(
      base({ actions: [{ id: "a1", type: "url", label: "Go", value: "https://x.com/{{company_name}}" }] })
    );
    expect(issues.some((i) => i.field === "actions[0].value")).toBe(false);
  });

  it("errors on an invalid phone number", () => {
    const issues = validateForSave(
      base({ actions: [{ id: "a1", type: "phone", label: "Call", value: "abc" }] })
    );
    expect(issues.some((i) => i.field === "actions[0].value")).toBe(true);
  });

  it("errors on duplicate quick reply payloads", () => {
    const issues = validateForSave(
      base({
        quickReplies: [
          { id: "q1", display: "Yes", payload: "YES" },
          { id: "q2", display: "Yeah", payload: "YES" },
        ],
      })
    );
    expect(issues.some((i) => i.field === "quickReplies")).toBe(true);
  });

  it("errors on an over-long header", () => {
    const issues = validateForSave(
      base({ header: { type: "text", text: "x".repeat(100) } })
    );
    expect(issues.some((i) => i.field === "header")).toBe(true);
  });
});

describe("validateForSend", () => {
  it("warns when a referenced variable is undefined", () => {
    const issues = validateForSend(
      base({ body: { text: "Hi {{first_name}} from {{agent_name}}" } }),
      "web"
    );
    const warn = issues.find((i) => i.field === "variables" && i.severity === "warning");
    expect(warn?.message).toContain("agent_name");
  });

  it("warns about text-based actions on WhatsApp Web", () => {
    const issues = validateForSend(
      base({ actions: [{ id: "a1", type: "url", label: "Go", value: "https://x.com" }] }),
      "web"
    );
    expect(issues.some((i) => i.field === "actions" && i.severity === "warning")).toBe(true);
  });

  it("errors when Meta API has more than 3 actions", () => {
    const issues = validateForSend(
      base({
        actions: [
          { id: "a1", type: "url", label: "A", value: "https://a.com" },
          { id: "a2", type: "url", label: "B", value: "https://b.com" },
          { id: "a3", type: "url", label: "C", value: "https://c.com" },
          { id: "a4", type: "url", label: "D", value: "https://d.com" },
        ],
      }),
      "cloud_api"
    );
    expect(issues.some((i) => i.field === "actions" && i.severity === "error")).toBe(true);
  });

  it("errors on a body exceeding the WhatsApp character limit", () => {
    const issues = validateForSend(base({ body: { text: "x".repeat(5000) } }), "web");
    expect(issues.some((i) => i.field === "body" && i.severity === "error")).toBe(true);
  });
});
