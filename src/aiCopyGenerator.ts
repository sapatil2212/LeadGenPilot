/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { Lead } from "./types";
import { generateOutreachCopy, OutreachTemplate, cleanBusinessName } from "./outreachCopy";
import { logger } from "./logger";

/**
 * Generates custom, human-like outreach messages (WhatsApp + Email) 
 * for a lead using the Gemini API. Falls back to a rule-based engine 
 * if Gemini is not configured or fails.
 */
export async function generateAICopy(lead: Lead): Promise<OutreachTemplate> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey === "MY_GEMINI_API_KEY") {
    logger.info(`Gemini API key not configured. Using rule-based copy for: '${lead.businessName}'`);
    return generateOutreachCopy(lead);
  }

  try {
    logger.info(`Generating personalized AI outreach copy via Gemini for: '${lead.businessName}'`);
    const ai = new GoogleGenAI({ apiKey });
    const cleanName = cleanBusinessName(lead.businessName || "your business");
    
    const prompt = `You are a professional B2B digital presence and branding specialist.
Generate B2B outreach copy (email subject, email body, and WhatsApp message) for the business '${cleanName}'.

The business details are:
- Business Name: "${cleanName}"
- Category/Type: "${lead.category || "local business"}"
- Rating: ${lead.rating || 0} (${lead.reviews || 0} reviews)
- AI Insight from audit: "${lead.aiInsight || "No specific insight"}"

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text ? response.text.trim() : "";
    if (text) {
      // Parse the JSON output
      const cleanJsonStr = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleanJsonStr);
      if (parsed.emailSubject && parsed.emailBody && parsed.whatsappMessage) {
        logger.success(`Gemini successfully generated outreach copy for: '${lead.businessName}'`);
        return {
          emailSubject: parsed.emailSubject.trim(),
          emailBody: parsed.emailBody.trim(),
          whatsappMessage: parsed.whatsappMessage.trim()
        };
      }
    }
    throw new Error("Invalid response format received from Gemini.");
  } catch (error: any) {
    logger.warn(`AI copy generation failed: ${error.message || error}. Falling back to rule-based copy.`);
    return generateOutreachCopy(lead);
  }
}
