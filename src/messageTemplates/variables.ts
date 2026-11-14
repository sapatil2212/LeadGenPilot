/**
 * Variable manager for message templates.
 *
 * System variables map to Lead model fields. Custom variables are user-defined
 * and resolved at campaign time via explicit column mapping. Every variable has
 * a sample value so the builder preview shows realistic content.
 */

import type { TemplateVariable } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// System variables — these map to Lead model fields automatically
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemVariableDefinition {
  key: string;
  label: string;
  sampleValue: string;
  /** How to extract the value from a Lead row at send time. */
  leadFieldResolver: string;
}

/**
 * The canonical set of system variables available to every template. Each maps
 * to a field (or derived value) on the Lead model. At compile time the resolver
 * string is evaluated against the lead to produce the substitution.
 */
export const SYSTEM_VARIABLES: readonly SystemVariableDefinition[] = [
  { key: "first_name",       label: "First Name",       sampleValue: "Rahul",                   leadFieldResolver: "contactName.firstName" },
  { key: "last_name",        label: "Last Name",        sampleValue: "Sharma",                  leadFieldResolver: "contactName.lastName" },
  { key: "full_name",        label: "Full Name",        sampleValue: "Rahul Sharma",            leadFieldResolver: "contactName" },
  { key: "company_name",     label: "Company Name",     sampleValue: "ABC Dental Clinic",       leadFieldResolver: "businessName" },
  { key: "business_name",    label: "Business Name",    sampleValue: "ABC Dental Clinic",       leadFieldResolver: "businessName" },
  { key: "city",             label: "City",             sampleValue: "Pune",                    leadFieldResolver: "address.city" },
  { key: "phone",            label: "Phone",            sampleValue: "+919876543210",           leadFieldResolver: "phone" },
  { key: "email",            label: "Email",            sampleValue: "rahul@example.com",       leadFieldResolver: "emails.first" },
  { key: "category",         label: "Category",         sampleValue: "Dental Clinic",           leadFieldResolver: "category" },
  { key: "website",          label: "Website",          sampleValue: "https://example.com",     leadFieldResolver: "website" },
  { key: "service_name",     label: "Service Name",     sampleValue: "Annual Maintenance",      leadFieldResolver: "custom" },
  { key: "product_name",     label: "Product Name",     sampleValue: "PX-100 Autoclave",        leadFieldResolver: "custom" },
  { key: "offer",            label: "Offer",            sampleValue: "20% off",                 leadFieldResolver: "custom" },
  { key: "discount",         label: "Discount",         sampleValue: "₹2,000 off",             leadFieldResolver: "custom" },
  { key: "appointment_date", label: "Appointment Date", sampleValue: "15 October 2026",         leadFieldResolver: "custom" },
  { key: "appointment_time", label: "Appointment Time", sampleValue: "3:00 PM",                 leadFieldResolver: "custom" },
  { key: "agent_name",       label: "Agent Name",       sampleValue: "SP Digitech",             leadFieldResolver: "custom" },
];

/** Quick lookup for whether a key is a built-in system variable. */
const SYSTEM_KEYS = new Set(SYSTEM_VARIABLES.map((v) => v.key));

/** True when the key is a system-provided variable. */
export function isSystemVariable(key: string): boolean {
  return SYSTEM_KEYS.has(key);
}

/**
 * Convert system variable definitions to the TemplateVariable shape stored in
 * a template payload. Used when seeding a new template's variable list.
 */
export function systemVariablesAsTemplateVars(): TemplateVariable[] {
  return SYSTEM_VARIABLES.map((v) => ({
    key: v.key,
    label: v.label,
    sampleValue: v.sampleValue,
    isCustom: false,
  }));
}

/**
 * Return a complete variable map (key → sample value) from a template's
 * variable list, used by the live preview.
 */
export function buildSampleValueMap(variables: TemplateVariable[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of variables) {
    map[v.key] = v.sampleValue || v.label;
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable substitution
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern that matches {{variable_key}} tokens in a string. */
export const VARIABLE_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Extract all unique variable keys referenced in a text. */
export function extractVariableKeys(text: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
  while ((match = pattern.exec(text)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

/**
 * Replace all {{key}} tokens in a text with values from the given map.
 * Unknown keys are left as-is so the user can see which variables are unresolved.
 */
export function substituteVariables(
  text: string,
  values: Record<string, string>,
  fallback: "keep" | "blank" | "label" = "keep"
): string {
  return text.replace(VARIABLE_PATTERN, (token, key) => {
    if (key in values && values[key]) return values[key];
    if (fallback === "blank") return "";
    if (fallback === "label") return key.replace(/_/g, " ");
    return token; // keep the {{key}} as-is
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead data resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Best-effort extraction of a city name from a free-form address. */
function extractCity(address: string): string {
  const parts = (address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2].replace(/\d{4,}/g, "").trim();
  }
  return parts[0] || "";
}

/** Parse a full name into first and last components. */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = (name || "").trim().split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

/**
 * Build a variable value map from a Lead record. This is what the campaign
 * executor calls at send time to merge template variables with real data.
 *
 * The Lead type is kept as `any` here so this module doesn't import the full
 * Lead model. The resolver reads the fields it needs and falls back gracefully.
 */
export function resolveVariablesFromLead(
  lead: Record<string, any>,
  customMapping?: Record<string, string>
): Record<string, string> {
  const { firstName, lastName } = splitName(lead.contactName || lead.businessName || "");
  const city = extractCity(lead.address || "");

  let firstEmail = "";
  try {
    const emails = typeof lead.emails === "string" ? JSON.parse(lead.emails) : lead.emails;
    firstEmail = Array.isArray(emails) && emails.length > 0 ? String(emails[0]) : "";
  } catch {
    firstEmail = "";
  }

  const values: Record<string, string> = {
    first_name: firstName || lead.businessName || "there",
    last_name: lastName,
    full_name: lead.contactName || lead.businessName || "there",
    company_name: lead.businessName || "your business",
    business_name: lead.businessName || "your business",
    city: city || "your area",
    phone: lead.phone || "",
    email: firstEmail,
    category: lead.category || "your industry",
    website: lead.website || "",
  };

  // Merge any custom variable mappings the campaign provided.
  if (customMapping) {
    for (const [key, value] of Object.entries(customMapping)) {
      if (typeof value === "string") values[key] = value;
    }
  }

  return values;
}

/**
 * Collect every variable key referenced anywhere in the template payload.
 * Used by validation to check that every referenced variable has a definition.
 */
export function collectReferencedVariables(
  payload: { header?: { text?: string }; body?: { text?: string }; footer?: { text?: string }; actions?: { value?: string; label?: string }[] }
): string[] {
  const texts: string[] = [];
  if (payload.header?.text) texts.push(payload.header.text);
  if (payload.body?.text) texts.push(payload.body.text);
  if (payload.footer?.text) texts.push(payload.footer.text);
  for (const action of payload.actions || []) {
    if (action.value) texts.push(action.value);
    if (action.label) texts.push(action.label);
  }
  return extractVariableKeys(texts.join("\n"));
}
