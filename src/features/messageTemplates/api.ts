/**
 * Client-side API + types for the WhatsApp message template builder.
 *
 * The payload shape mirrors src/messageTemplates/types.ts on the server. It is
 * re-declared here (rather than imported) so the browser bundle never pulls in
 * server-only modules through a shared file. The two must stay in sync; the
 * server validates/normalises everything it receives, so a drift is caught at
 * the boundary rather than corrupting data.
 */

import { api } from "../../ui/api";

// ─────────────────────────────────────────────────────────────────────────────
// Payload types (mirror of server types.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type HeaderType = "none" | "text" | "image" | "video" | "document";
export type ActionType = "url" | "phone" | "whatsapp_link" | "custom_url";
export type DeliveryMethod = "web" | "cloud_api";
export type TemplateCategory = "marketing" | "sales" | "utility" | "support" | "custom";
export type TemplateStatus = "draft" | "active" | "archived";

export interface TemplateHeader {
  type: HeaderType;
  text?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
}
export interface TemplateBody {
  text: string;
}
export interface TemplateFooter {
  enabled: boolean;
  text: string;
}
export interface TemplateAction {
  id: string;
  type: ActionType;
  label: string;
  value: string;
}
export interface TemplateQuickReply {
  id: string;
  display: string;
  payload: string;
}
export interface TemplateVariable {
  key: string;
  label: string;
  sampleValue: string;
  isCustom: boolean;
}
export interface TemplateSettings {
  deliveryMethod: DeliveryMethod;
  personalization: boolean;
}
export interface MessageTemplatePayload {
  header: TemplateHeader;
  body: TemplateBody;
  footer: TemplateFooter;
  actions: TemplateAction[];
  quickReplies: TemplateQuickReply[];
  variables: TemplateVariable[];
  settings: TemplateSettings;
}

export interface MessageTemplateView {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  language: string;
  channel: string;
  deliveryMethod: DeliveryMethod;
  tags: string[];
  payload: MessageTemplatePayload;
  status: TemplateStatus;
  version: number;
  usageCount: number;
  isPrebuilt: boolean;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrebuiltTemplate {
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  language: string;
  tags: string[];
  payload: MessageTemplatePayload;
}

export type ValidationSeverity = "error" | "warning";
export interface ValidationIssue {
  severity: ValidationSeverity;
  field: string;
  message: string;
}

export interface AiDraft {
  name: string;
  category: string;
  payload: MessageTemplatePayload;
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirror of server)
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ACTIONS_META = 3;
export const MAX_QUICK_REPLIES_META = 3;
export const WHATSAPP_BODY_MAX_CHARS = 4096;
export const HEADER_TEXT_MAX_CHARS = 60;
export const FOOTER_TEXT_MAX_CHARS = 60;
export const ACTION_LABEL_MAX_CHARS = 25;
export const QUICK_REPLY_MAX_CHARS = 25;

export const CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales Outreach" },
  { value: "utility", label: "Utility" },
  { value: "support", label: "Customer Support" },
  { value: "custom", label: "Custom" },
];

export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "hi_en", label: "Hinglish" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
];

/** The system variables available to insert, with sample values. */
export const SYSTEM_VARIABLES: TemplateVariable[] = [
  { key: "first_name", label: "First Name", sampleValue: "Rahul", isCustom: false },
  { key: "last_name", label: "Last Name", sampleValue: "Sharma", isCustom: false },
  { key: "full_name", label: "Full Name", sampleValue: "Rahul Sharma", isCustom: false },
  { key: "company_name", label: "Company Name", sampleValue: "ABC Dental Clinic", isCustom: false },
  { key: "business_name", label: "Business Name", sampleValue: "ABC Dental Clinic", isCustom: false },
  { key: "city", label: "City", sampleValue: "Pune", isCustom: false },
  { key: "phone", label: "Phone", sampleValue: "+919876543210", isCustom: false },
  { key: "email", label: "Email", sampleValue: "rahul@example.com", isCustom: false },
  { key: "category", label: "Category", sampleValue: "Dental Clinic", isCustom: false },
  { key: "website", label: "Website", sampleValue: "https://example.com", isCustom: false },
  { key: "service_name", label: "Service Name", sampleValue: "Annual Maintenance", isCustom: false },
  { key: "product_name", label: "Product Name", sampleValue: "PX-100 Autoclave", isCustom: false },
  { key: "offer", label: "Offer", sampleValue: "20% off", isCustom: false },
  { key: "discount", label: "Discount", sampleValue: "₹2,000 off", isCustom: false },
  { key: "appointment_date", label: "Appointment Date", sampleValue: "15 October 2026", isCustom: false },
  { key: "appointment_time", label: "Appointment Time", sampleValue: "3:00 PM", isCustom: false },
  { key: "agent_name", label: "Agent Name", sampleValue: "SP Digitech", isCustom: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** A fresh, empty payload for a blank template. */
export function emptyPayload(): MessageTemplatePayload {
  return {
    header: { type: "none" },
    body: { text: "" },
    footer: { enabled: false, text: "" },
    actions: [],
    quickReplies: [],
    variables: [
      SYSTEM_VARIABLES.find((v) => v.key === "first_name")!,
      SYSTEM_VARIABLES.find((v) => v.key === "company_name")!,
    ],
    settings: { deliveryMethod: "web", personalization: true },
  };
}

/** Build a sample-value map from a payload's variable list for the preview. */
export function sampleValues(payload: MessageTemplatePayload): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of payload.variables) map[v.key] = v.sampleValue || v.label;
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFilters {
  category?: string;
  deliveryMethod?: string;
  status?: string;
  language?: string;
  search?: string;
}

export function listTemplates(filters: ListFilters = {}): Promise<{ ok: boolean; templates: MessageTemplateView[] }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const q = qs.toString();
  return api.get(`/api/message-templates${q ? `?${q}` : ""}`);
}

export function getTemplate(id: string): Promise<{ ok: boolean; template: MessageTemplateView }> {
  return api.get(`/api/message-templates/${id}`);
}

export function getPrebuilt(): Promise<{ ok: boolean; templates: PrebuiltTemplate[] }> {
  return api.get("/api/message-templates/prebuilt");
}

export interface SaveInput {
  name: string;
  description?: string;
  category?: string;
  language?: string;
  deliveryMethod?: string;
  tags?: string[];
  payload: MessageTemplatePayload;
  status?: string;
}

export function createTemplate(input: SaveInput): Promise<{ ok: boolean; template: MessageTemplateView }> {
  return api.post("/api/message-templates", input);
}

export function updateTemplate(id: string, input: Partial<SaveInput> & { saveAsNewVersion?: boolean }): Promise<{ ok: boolean; template: MessageTemplateView }> {
  return api.put(`/api/message-templates/${id}`, input);
}

export function deleteTemplate(id: string): Promise<{ ok: boolean }> {
  return api.del(`/api/message-templates/${id}`);
}

export function duplicateTemplate(id: string, overrides?: { name?: string; language?: string }): Promise<{ ok: boolean; template: MessageTemplateView }> {
  return api.post(`/api/message-templates/${id}/duplicate`, overrides || {});
}

export function validateTemplate(payload: MessageTemplatePayload, deliveryMethod: DeliveryMethod): Promise<{ ok: boolean; valid: boolean; issues: ValidationIssue[] }> {
  return api.post("/api/message-templates/validate", { payload, deliveryMethod });
}

export function generateAiDraft(input: { objective: string; tone?: string; category?: string }): Promise<{ ok: boolean; draft: AiDraft }> {
  return api.post("/api/message-templates/ai-draft", input);
}

/** A business-specific starter suggestion for the "Choose a starter" screen. */
export interface StarterSuggestion {
  name: string;
  category: TemplateCategory;
  description: string;
  payload: MessageTemplatePayload;
}

export function getStarterSuggestions(): Promise<{ ok: boolean; suggestions: StarterSuggestion[]; fallbackToPrebuilt: boolean }> {
  return api.post("/api/message-templates/starter-suggestions", {});
}
