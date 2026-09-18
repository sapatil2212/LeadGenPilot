/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lead } from "./types";

export interface OutreachTemplate {
  emailSubject: string;
  emailBody: string;
  whatsappMessage: string;
}

/**
 * Analyzes a lead's digital gaps and generates a personalized,
 * human-sounding outreach copy that reads like a real conversation —
 * not a spam template.
 */
/**
 * Cleans the business name by stripping common suffixes (e.g., location, tags).
 */
export function cleanBusinessName(name: string): string {
  if (!name) return "";
  // Split by common delimiters and take the first part
  let cleaned = name.split(/ - | \| | \(| \[(?=[^]*\])/)[0].trim();
  // Strip trailing/leading punctuation
  cleaned = cleaned.replace(/^[^a-zA-Z0-9\u00C0-\u017F]+|[^a-zA-Z0-9\u00C0-\u017F\s\.\,\'\&\/]+$/g, "").trim();
  return cleaned || name;
}

export function generateOutreachCopy(lead: Lead): OutreachTemplate {
  const cleanName = cleanBusinessName(lead.businessName || "your business");
  const lowerName = (lead.businessName || "").toLowerCase();
  const lowerCat = (lead.category || "").toLowerCase();

  let audience = "customers";
  let singularType = "business";
  let pluralType = "businesses";
  let highlights = "educational industry content, customer success stories, team highlights";

  if (lowerName.includes("hospital") || lowerCat.includes("hospital")) {
    audience = "patients";
    singularType = "hospital";
    pluralType = "hospitals";
    highlights = "educational health content, patient awareness posts, doctor highlights";
  } else if (
    lowerName.includes("clinic") ||
    lowerCat.includes("clinic") ||
    lowerName.includes("dental") ||
    lowerCat.includes("dental") ||
    lowerName.includes("doctor") ||
    lowerCat.includes("doctor") ||
    lowerName.includes("medical") ||
    lowerCat.includes("medical") ||
    lowerName.includes("dermatology") ||
    lowerCat.includes("dermatologist")
  ) {
    audience = "patients";
    singularType = "clinic";
    pluralType = "clinics";
    highlights = "educational health content, patient awareness posts, doctor highlights";
  } else if (
    lowerName.includes("gym") ||
    lowerCat.includes("gym") ||
    lowerName.includes("fitness") ||
    lowerCat.includes("fitness") ||
    lowerName.includes("workout") ||
    lowerCat.includes("workout")
  ) {
    audience = "members";
    singularType = "gym";
    pluralType = "gyms";
    highlights = "fitness tips, member success stories, trainer highlights";
  } else if (
    lowerName.includes("restaurant") ||
    lowerCat.includes("restaurant") ||
    lowerName.includes("cafe") ||
    lowerCat.includes("cafe") ||
    lowerName.includes("food") ||
    lowerCat.includes("food") ||
    lowerName.includes("bakery") ||
    lowerCat.includes("bakery")
  ) {
    audience = "customers";
    singularType = "restaurant";
    pluralType = "restaurants";
    highlights = "mouthwatering food photos, customer reviews, chef specials";
  } else if (
    lowerName.includes("salon") ||
    lowerCat.includes("salon") ||
    lowerName.includes("spa") ||
    lowerCat.includes("spa") ||
    lowerName.includes("beauty") ||
    lowerCat.includes("beauty") ||
    lowerName.includes("hair") ||
    lowerCat.includes("hair")
  ) {
    audience = "clients";
    singularType = "salon";
    pluralType = "salons";
    highlights = "before-and-after transformations, beauty tips, stylist highlights";
  }

  const whatsappMessage = `Hi! 👋

I came across ${cleanName} on Google Maps and noticed there’s a great opportunity to increase your local visibility and attract more ${audience} through stronger digital branding and social media presence.

Many ${pluralType} are now using ${highlights}, and local marketing campaigns to build trust and generate more inquiries from nearby areas.

To give you an idea of what's possible, I created a free digital branding roadmap along with a few sample designs specifically for your ${singularType}.

Would you like me to send them over? There's absolutely no cost or obligation—just thought they might be helpful.`;

  const emailSubject = `Quick digital branding idea for ${cleanName}`;
  const emailBody = `Hi there,

I came across ${cleanName} on Google Maps and noticed there’s a great opportunity to increase your local visibility and attract more ${audience} through stronger digital branding and social media presence.

Many ${pluralType} are now using ${highlights}, and local marketing campaigns to build trust and generate more inquiries from nearby areas.

To give you an idea of what's possible, I created a free digital branding roadmap along with a few sample designs specifically for your ${singularType}.

Would you like me to send them over? There's absolutely no cost or obligation—just thought they might be helpful.

Best regards,
Digital Branding Team`;

  return { emailSubject, emailBody, whatsappMessage };
}
