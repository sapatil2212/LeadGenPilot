/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared outreach template utilities.
 *
 * Templates are authored in the Email/WhatsApp Templates screen and persisted
 * to localStorage. This module lets other surfaces (e.g. the Lead Outreach
 * Console) load those same templates and compile them into ready-to-send text
 * for a specific lead — substituting variables and, when the template relies on
 * an AI-generated body, injecting an AI body produced per lead.
 *
 * The shape mirrors `EmailTemplate` in EmailTemplates.tsx; localStorage is the
 * shared contract between the two surfaces.
 */

import { Lead } from "./types";

export const TEMPLATES_STORAGE_KEY = "leadfinder_email_templates_v3";

export interface OutreachTemplate {
  id: string;
  name: string;
  templateType: "email" | "whatsapp";
  subject: string;
  designMode: "builder" | "code";
  htmlCode: string;
  useLogo: boolean;
  logoType: "text" | "image";
  logoValue: string;
  introText: string;
  useAiBody: boolean;
  customBodyText: string;
  useCta: boolean;
  ctaText: string;
  ctaUrl: string;
  ctaBgColor: string;
  useContact: boolean;
  contactText: string;
  useFooter: boolean;
  footerText: string;
  createdAt: string;
}

/** Load this workspace's reviewed templates from localStorage. */
export function loadOutreachTemplates(workspaceId?: string): OutreachTemplate[] {
  try {
    const key = `${TEMPLATES_STORAGE_KEY}:${workspaceId || "default"}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutreachTemplate[]) : [];
  } catch {
    return [];
  }
}

/** Best-effort extraction of a city name from a free-form address. */
function extractCity(address: string): string {
  const parts = (address || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    // Second-to-last segment is usually the city (last is often "State PIN").
    return parts[parts.length - 2].replace(/\d{4,}/g, "").trim();
  }
  return parts[0] || "";
}

/** Replace template variables with the lead's data. */
export function fillTemplateVariables(text: string, lead: Lead): string {
  if (!text) return "";
  const city = extractCity(lead.address);
  const map: Record<string, string> = {
    "{{company}}": lead.businessName || "your business",
    "{{name}}": lead.businessName || "there",
    "{{business}}": lead.businessName || "your business",
    "{{city}}": city || "your area",
    "{{location}}": city || "your area",
    "{{category}}": lead.category || "your industry",
    "{{phone}}": lead.phone || "",
    "{{website}}": lead.website || "",
  };
  return text.replace(/\{\{[^}]+\}\}/g, (m) => (map[m] !== undefined ? map[m] : m));
}

/** Does this template need an AI-generated body for this lead? */
export function templateNeedsAiBody(tpl: OutreachTemplate): boolean {
  return tpl.useAiBody || !tpl.customBodyText || tpl.customBodyText.trim() === "";
}

/**
 * Compile a template into a plain-text message for a lead.
 * `aiBody` is used as the body when the template relies on AI (or has none).
 */
export function compileTemplateText(tpl: OutreachTemplate, lead: Lead, aiBody?: string): string {
  if (tpl.designMode === "code") {
    return fillTemplateVariables(tpl.htmlCode || "", lead);
  }
  const parts: string[] = [];

  if (tpl.introText && tpl.introText.trim()) {
    parts.push(fillTemplateVariables(tpl.introText, lead).trim());
  }

  const bodyText = templateNeedsAiBody(tpl)
    ? (aiBody || "").trim()
    : fillTemplateVariables(tpl.customBodyText, lead).trim();
  if (bodyText) parts.push(bodyText);

  if (tpl.useCta && tpl.ctaText && tpl.ctaText.trim()) {
    const cta = `${fillTemplateVariables(tpl.ctaText, lead).trim()}${tpl.ctaUrl ? " " + tpl.ctaUrl : ""}`.trim();
    if (cta) parts.push(cta);
  }

  if (tpl.useContact && tpl.contactText && tpl.contactText.trim()) {
    parts.push(fillTemplateVariables(tpl.contactText, lead).trim());
  }

  if (tpl.useFooter && tpl.footerText && tpl.footerText.trim()) {
    parts.push(fillTemplateVariables(tpl.footerText, lead).trim());
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

/** Compile the email subject for a lead (falls back to a sensible default). */
export function compileTemplateSubject(tpl: OutreachTemplate, lead: Lead, fallback = ""): string {
  const subj = fillTemplateVariables(tpl.subject || "", lead).trim();
  return subj || fallback;
}
