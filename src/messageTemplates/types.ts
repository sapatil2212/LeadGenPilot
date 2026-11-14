/**
 * Component-based WhatsApp message template types.
 *
 * The payload is the single source of truth for a template's content. It is
 * stored as JSON in MessageTemplate.payload and deserialized/validated in the
 * service layer. Renderers transform it into channel-specific output (plain
 * text for WhatsApp Web, structured JSON for Meta Cloud API) without any
 * channel knowledge leaking into the schema.
 *
 * Every field is user-editable from the builder UI. Nothing is hard-coded.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Template payload (persisted as JSON)
// ─────────────────────────────────────────────────────────────────────────────

export type HeaderType = "none" | "text" | "image" | "video" | "document";

export interface TemplateHeader {
  type: HeaderType;
  /** Header text line (for type "text"). Supports variables. */
  text?: string;
  /** URL or data-URI for image/video/document. */
  mediaUrl?: string;
  /** Optional caption shown below the media. */
  mediaCaption?: string;
  /** Original filename for document headers. */
  mediaFileName?: string;
  /** MIME type for media validation. */
  mediaMimeType?: string;
}

export interface TemplateBody {
  /**
   * The message text. Supports WhatsApp formatting:
   *   *bold*  _italic_  ~strikethrough~  ```monospace```
   * and variables: {{first_name}}, {{company_name}}, etc.
   */
  text: string;
}

export interface TemplateFooter {
  enabled: boolean;
  /** Short footer line, e.g. company name or "Reply STOP to opt out." */
  text: string;
}

export type ActionType = "url" | "phone" | "whatsapp_link" | "custom_url";

export interface TemplateAction {
  id: string;
  type: ActionType;
  /** Button label, e.g. "Visit Website", "Call Now". */
  label: string;
  /** URL, phone number, or wa.me link. Supports variables in URLs. */
  value: string;
}

export interface TemplateQuickReply {
  id: string;
  /** What the recipient sees, e.g. "Interested". */
  display: string;
  /** Internal machine-readable value, e.g. "INTERESTED". */
  payload: string;
}

export interface TemplateVariable {
  /** Variable key without braces, e.g. "first_name". */
  key: string;
  /** Human-readable label, e.g. "First Name". */
  label: string;
  /** Sample value for the live preview, e.g. "Rahul". */
  sampleValue: string;
  /** True when the user created this variable (vs. system-provided). */
  isCustom: boolean;
}

export type DeliveryMethod = "web" | "cloud_api";

export interface TemplateSettings {
  deliveryMethod: DeliveryMethod;
  /** When true, CRM contact fields are merged into the message at send time. */
  personalization: boolean;
}

/** The full component-based builder payload stored as JSON. */
export interface MessageTemplatePayload {
  header: TemplateHeader;
  body: TemplateBody;
  footer: TemplateFooter;
  /** CTA / action buttons. Up to 3 for Meta API; unlimited for Web (rendered as text). */
  actions: TemplateAction[];
  /** Quick reply buttons. Up to 3 for Meta API; rendered as text for Web. */
  quickReplies: TemplateQuickReply[];
  /** Variable definitions with sample values for the live preview. */
  variables: TemplateVariable[];
  settings: TemplateSettings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row-level metadata (Prisma columns + deserialized payload)
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateCategory = "marketing" | "sales" | "utility" | "support" | "custom";
export type TemplateStatus = "draft" | "active" | "archived";

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

// ─────────────────────────────────────────────────────────────────────────────
// Renderer output types
// ─────────────────────────────────────────────────────────────────────────────

/** Plain-text output for WhatsApp Web (sent via whatsapp-web.js). */
export interface WhatsAppWebOutput {
  /** The fully rendered plain text, ready to pass to client.sendMessage(). */
  text: string;
  /** Media URL to send as a separate message (WhatsApp Web limitation). */
  mediaUrl?: string;
  mediaCaption?: string;
}

/** Structured output for the Meta Cloud API template submission. */
export interface MetaApiOutput {
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: MetaApiComponent[];
  };
}

export interface MetaApiComponent {
  type: "header" | "body" | "footer" | "button";
  sub_type?: "url" | "quick_reply";
  index?: number;
  parameters?: MetaApiParameter[];
  text?: string;
}

export interface MetaApiParameter {
  type: "text" | "image" | "video" | "document";
  text?: string;
  image?: { link: string };
  video?: { link: string };
  document?: { link: string; filename?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation types
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  field: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum CTA buttons for Meta Cloud API templates. */
export const META_MAX_ACTIONS = 3;
/** Maximum quick reply buttons for Meta Cloud API templates. */
export const META_MAX_QUICK_REPLIES = 3;
/** Maximum body length for WhatsApp messages (characters). */
export const WHATSAPP_BODY_MAX_CHARS = 4096;
/** Maximum header text length. */
export const HEADER_TEXT_MAX_CHARS = 60;
/** Maximum footer text length. */
export const FOOTER_TEXT_MAX_CHARS = 60;
/** Maximum button label length. */
export const ACTION_LABEL_MAX_CHARS = 25;
/** Maximum quick reply display text length. */
export const QUICK_REPLY_MAX_CHARS = 25;

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  "marketing", "sales", "utility", "support", "custom",
];

export const SUPPORTED_LANGUAGES: readonly { code: string; label: string }[] = [
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
