/**
 * Renderer tests for the WhatsApp message template builder.
 *
 * These lock the two things that matter most about the renderers:
 *   1. The WhatsApp Web renderer produces honest text actions — never faking
 *      native buttons — and substitutes variables.
 *   2. The Meta API renderer produces the structured component shape with
 *      positional parameters, respecting the 3-button limit.
 */

import { describe, it, expect } from "vitest";
import { renderForWhatsAppWeb } from "../src/messageTemplates/renderers/whatsappWebRenderer";
import { renderForMetaApi } from "../src/messageTemplates/renderers/metaApiRenderer";
import { render } from "../src/messageTemplates/renderers";
import type { MessageTemplatePayload } from "../src/messageTemplates/types";

function samplePayload(overrides: Partial<MessageTemplatePayload> = {}): MessageTemplatePayload {
  return {
    header: { type: "text", text: "Special Offer" },
    body: { text: "Hi {{first_name}}, we have an offer for {{company_name}}." },
    footer: { enabled: true, text: "SP Digitech Solutions" },
    actions: [{ id: "a1", type: "url", label: "Visit Website", value: "https://example.com" }],
    quickReplies: [
      { id: "qr1", display: "Interested", payload: "INTERESTED" },
      { id: "qr2", display: "Not Now", payload: "NOT_NOW" },
    ],
    variables: [
      { key: "first_name", label: "First Name", sampleValue: "Rahul", isCustom: false },
      { key: "company_name", label: "Company", sampleValue: "ABC Co", isCustom: false },
    ],
    settings: { deliveryMethod: "web", personalization: true },
    ...overrides,
  };
}

const values = { first_name: "Rahul", company_name: "ABC Dental Clinic" };

describe("WhatsApp Web renderer", () => {
  it("substitutes variables in header, body and footer", () => {
    const out = renderForWhatsAppWeb(samplePayload(), values);
    expect(out.text).toContain("Hi Rahul, we have an offer for ABC Dental Clinic.");
    expect(out.text).toContain("⭐ *Special Offer*");
    expect(out.text).toContain("_SP Digitech Solutions_");
  });

  it("renders CTA actions as text links, not fake buttons", () => {
    const out = renderForWhatsAppWeb(samplePayload(), values);
    expect(out.text).toContain("🌐 *Visit Website*");
    expect(out.text).toContain("https://example.com");
  });

  it("renders a phone action with the call emoji and number", () => {
    const out = renderForWhatsAppWeb(
      samplePayload({ actions: [{ id: "a1", type: "phone", label: "Call Now", value: "+919876543210" }] }),
      values
    );
    expect(out.text).toContain("📞 *Call Now*");
    expect(out.text).toContain("+919876543210");
  });

  it("renders quick replies as a text instruction", () => {
    const out = renderForWhatsAppWeb(samplePayload(), values);
    expect(out.text).toContain("💬 Reply");
    expect(out.text).toContain("*Interested*");
    expect(out.text).toContain("*Not Now*");
  });

  it("renders a single quick reply with the singular phrasing", () => {
    const out = renderForWhatsAppWeb(
      samplePayload({ quickReplies: [{ id: "qr1", display: "Interested", payload: "INTERESTED" }] }),
      values
    );
    expect(out.text).toContain("💬 Reply *Interested* if you'd like more details.");
  });

  it("returns media as a separate attachment for non-text headers", () => {
    const out = renderForWhatsAppWeb(
      samplePayload({
        header: { type: "image", mediaUrl: "https://cdn.example.com/promo.jpg", mediaCaption: "Hi {{first_name}}" },
      }),
      values
    );
    expect(out.mediaUrl).toBe("https://cdn.example.com/promo.jpg");
    expect(out.mediaCaption).toBe("Hi Rahul");
    // The image is not inlined into the text.
    expect(out.text).not.toContain("https://cdn.example.com/promo.jpg");
  });

  it("omits empty sections cleanly", () => {
    const out = renderForWhatsAppWeb(
      {
        header: { type: "none" },
        body: { text: "Just a plain message." },
        footer: { enabled: false, text: "" },
        actions: [],
        quickReplies: [],
        variables: [],
        settings: { deliveryMethod: "web", personalization: false },
      },
      {}
    );
    expect(out.text).toBe("Just a plain message.");
    expect(out.mediaUrl).toBeUndefined();
  });

  it("leaves unknown variables intact so they are visible", () => {
    const out = renderForWhatsAppWeb(
      samplePayload({ body: { text: "Hi {{unknown_var}}" } }),
      values
    );
    expect(out.text).toContain("{{unknown_var}}");
  });
});

describe("Meta Cloud API renderer", () => {
  it("produces the template envelope with name and language", () => {
    const out = renderForMetaApi(samplePayload(), "special_offer", "en", values);
    expect(out.type).toBe("template");
    expect(out.template.name).toBe("special_offer");
    expect(out.template.language.code).toBe("en");
  });

  it("creates header and body components with positional parameters", () => {
    const out = renderForMetaApi(samplePayload(), "special_offer", "en", values);
    const body = out.template.components.find((c) => c.type === "body");
    expect(body?.parameters).toHaveLength(2);
    expect(body?.parameters?.[0]).toEqual({ type: "text", text: "Rahul" });
    expect(body?.parameters?.[1]).toEqual({ type: "text", text: "ABC Dental Clinic" });
  });

  it("emits a url button component for CTA actions", () => {
    const out = renderForMetaApi(samplePayload(), "special_offer", "en", values);
    const button = out.template.components.find((c) => c.type === "button" && c.sub_type === "url");
    expect(button).toBeDefined();
    expect(button?.index).toBe(0);
  });

  it("emits quick_reply buttons carrying the payload value", () => {
    const out = renderForMetaApi(samplePayload(), "special_offer", "en", values);
    const quick = out.template.components.filter((c) => c.sub_type === "quick_reply");
    expect(quick.length).toBeGreaterThan(0);
    expect(quick[0].parameters?.[0]).toEqual({ type: "text", text: "INTERESTED" });
  });

  it("never emits more than 3 buttons total", () => {
    const out = renderForMetaApi(
      samplePayload({
        actions: [
          { id: "a1", type: "url", label: "A", value: "https://a.com" },
          { id: "a2", type: "url", label: "B", value: "https://b.com" },
        ],
        quickReplies: [
          { id: "q1", display: "One", payload: "ONE" },
          { id: "q2", display: "Two", payload: "TWO" },
          { id: "q3", display: "Three", payload: "THREE" },
        ],
      }),
      "t",
      "en",
      values
    );
    const buttons = out.template.components.filter((c) => c.type === "button");
    expect(buttons.length).toBeLessThanOrEqual(3);
  });

  it("emits an image header parameter for media headers", () => {
    const out = renderForMetaApi(
      samplePayload({ header: { type: "image", mediaUrl: "https://cdn.example.com/x.jpg" } }),
      "t",
      "en",
      values
    );
    const header = out.template.components.find((c) => c.type === "header");
    expect(header?.parameters?.[0]).toEqual({ type: "image", image: { link: "https://cdn.example.com/x.jpg" } });
  });
});

describe("render dispatcher", () => {
  it("routes web delivery to the WhatsApp Web renderer", () => {
    const result = render(samplePayload(), "web", values);
    expect(result.method).toBe("web");
    if (result.method === "web") {
      expect(result.output.text).toContain("Hi Rahul");
    }
  });

  it("routes cloud_api delivery to the Meta renderer", () => {
    const result = render(samplePayload(), "cloud_api", values, { templateName: "special_offer" });
    expect(result.method).toBe("cloud_api");
    if (result.method === "cloud_api") {
      expect(result.output.template.name).toBe("special_offer");
    }
  });

  it("throws when cloud_api is requested without a template name", () => {
    expect(() => render(samplePayload(), "cloud_api", values)).toThrow(/templateName/);
  });
});
