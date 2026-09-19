/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outreach copy generation (email subject, email body, WhatsApp message).
 *
 * Lifted verbatim from src/aiCopyGenerator.ts.
 *
 * KNOWN LIMITATION, carried over deliberately: this prompt hardcodes a digital
 * branding and social-media pitch, and picks its vocabulary from the LEAD's
 * category with no notion of what the sending business actually sells. A medical
 * equipment manufacturer using it today emails hospitals a social-media
 * marketing pitch. It is preserved as-is so Phase 3 changes nothing about
 * behaviour; Phase 5 replaces it with a version driven by the tenant's own
 * BusinessProfile, products and ICP, which is why this one stays at version 1
 * rather than being edited.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";

export interface OutreachCopyInput {
  /** Business name, already cleaned of location/branch suffixes. */
  cleanName: string;
  category?: string;
  rating?: number;
  reviews?: number;
  aiInsight?: string;
}

export interface OutreachCopyOutput {
  emailSubject: string;
  emailBody: string;
  whatsappMessage: string;
}

/** Validates the model's JSON. Used by generateStructuredOutput. */
export function validateOutreachCopy(value: unknown): OutreachCopyOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const subject = typeof v.emailSubject === "string" ? v.emailSubject.trim() : "";
  const body = typeof v.emailBody === "string" ? v.emailBody.trim() : "";
  const whatsapp = typeof v.whatsappMessage === "string" ? v.whatsappMessage.trim() : "";
  if (!subject || !body || !whatsapp) return null;
  return { emailSubject: subject, emailBody: body, whatsappMessage: whatsapp };
}

export const outreachCopyPrompt: PromptDefinition<OutreachCopyInput> = {
  name: "outreach.copy",
  version: 1,
  description:
    "Digital-branding outreach copy for a scraped lead. Migrated unchanged from " +
    "src/aiCopyGenerator.ts. Superseded in Phase 5 by a business-agnostic version.",

  build(input: OutreachCopyInput): AiMessage[] {
    const cleanName = input.cleanName;

    const user = `You are a professional B2B digital presence and branding specialist.
Generate B2B outreach copy (email subject, email body, and WhatsApp message) for the business '${cleanName}'.

The business details are:
- Business Name: "${cleanName}"
- Category/Type: "${input.category || "local business"}"
- Rating: ${input.rating || 0} (${input.reviews || 0} reviews)
- AI Insight from audit: "${input.aiInsight || "No specific insight"}"

For the "whatsappMessage", you MUST generate it EXACTLY in the following format (maintaining the paragraph breaks, friendly tone, and overall structure):

"Hi! 👋

I came across [Business Name] on Google Maps and noticed there’s a great opportunity to increase your local visibility and attract more [Target Audience] through stronger digital branding and social media presence.

Many [Plural Business Type] are now using [Highlight 1], [Highlight 2], [Highlight 3], and local marketing campaigns to build trust and generate more inquiries from nearby areas.

To give you an idea of what's possible, I created a free digital branding roadmap along with a few sample designs specifically for your [Singular Business Type].

Would you like me to send them over? There's absolutely no cost or obligation—just thought they might be helpful."

Instructions for filling the placeholders:
1. [Business Name]: Use exactly "${cleanName}".
2. [Target Audience]: Choose the most appropriate word for who the business serves (e.g. use "patients" for medical/hospitals/dental clinics/doctors, "members" or "clients" for gyms, "customers" for restaurants/retail, "clients" for professional services).
3. [Plural Business Type]: Use the plural term for this type of business (e.g. "hospitals", "dental clinics", "restaurants", "gyms", "salons", "businesses").
4. [Highlight 1], [Highlight 2], [Highlight 3]: Generate 3 relevant highlights tailored to the business category. For example:
   - For hospitals/medical/dental/clinic: "educational health content", "patient awareness posts", "doctor highlights"
   - For gyms/fitness: "fitness tips", "member success stories", "trainer highlights"
   - For restaurants/cafes: "mouthwatering food photos", "customer reviews", "chef specials"
   - For salons/beauty: "before-and-after transformations", "beauty tips", "stylist highlights"
   - For general/other businesses: "educational industry tips", "customer success stories", "team highlights"
5. [Singular Business Type]: Use the singular term for this type of business (e.g. "hospital", "clinic", "restaurant", "gym", "salon", "business").

For the email:
Generate a warm, professional email that follows this branding roadmap concept. The "emailSubject" should be a short, personalized curiosity hook (e.g. "Quick digital branding idea for ${cleanName}"). The "emailBody" should also reference the free digital branding roadmap and sample designs in a warm and structured format.

You MUST return the output in raw JSON format matching this schema:
{
  "emailSubject": "string",
  "emailBody": "string",
  "whatsappMessage": "string"
}
Return only the raw JSON.`;

    return [
      withGrounding(
        "You write B2B outreach copy. Personalise only from the supplied business details; " +
          "do not invent achievements, client names, statistics or offers."
      ),
      { role: "user", content: user },
    ];
  },
};
