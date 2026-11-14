/**
 * Template validation.
 *
 * Two levels:
 *   - **pre-save**: issues that prevent the template from being stored
 *     (empty body, invalid action types).
 *   - **pre-send**: issues that would cause a send to fail or degrade
 *     (missing variables, broken URLs, Meta API restrictions, char limits).
 *
 * Both return an array of ValidationIssue rather than throwing, so the UI can
 * show all problems at once instead of fixing them one at a time.
 */

import type {
  MessageTemplatePayload,
  DeliveryMethod,
  ValidationIssue,
  TemplateAction,
  TemplateQuickReply,
} from "./types";
import {
  WHATSAPP_BODY_MAX_CHARS,
  HEADER_TEXT_MAX_CHARS,
  FOOTER_TEXT_MAX_CHARS,
  ACTION_LABEL_MAX_CHARS,
  QUICK_REPLY_MAX_CHARS,
  META_MAX_ACTIONS,
  META_MAX_QUICK_REPLIES,
} from "./types";
import { collectReferencedVariables, VARIABLE_PATTERN } from "./variables";

const URL_PATTERN = /^https?:\/\/.+/i;
const PHONE_PATTERN = /^\+?\d[\d\s\-()]{6,20}$/;

function error(field: string, message: string): ValidationIssue {
  return { severity: "error", field, message };
}
function warning(field: string, message: string): ValidationIssue {
  return { severity: "warning", field, message };
}

/**
 * Basic URL check that ignores variable placeholders (they're resolved later).
 * Returns true for URLs containing {{vars}} because the final URL is only
 * known after substitution.
 */
function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  if (VARIABLE_PATTERN.test(value)) return true; // has variables — can't validate yet
  return URL_PATTERN.test(value.trim());
}

function isValidPhone(value: string): boolean {
  if (!value.trim()) return false;
  if (VARIABLE_PATTERN.test(value)) return true;
  return PHONE_PATTERN.test(value.replace(/\s/g, ""));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-save validation (can this be stored?)
// ─────────────────────────────────────────────────────────────────────────────

export function validateForSave(payload: MessageTemplatePayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Body is always required.
  if (!payload.body?.text?.trim()) {
    issues.push(error("body", "Message body cannot be empty."));
  }

  // Header text length.
  if (payload.header?.type === "text" && payload.header.text) {
    if (payload.header.text.length > HEADER_TEXT_MAX_CHARS) {
      issues.push(error("header", `Header text exceeds ${HEADER_TEXT_MAX_CHARS} characters.`));
    }
  }

  // Media header requires a URL.
  if (
    payload.header?.type &&
    payload.header.type !== "none" &&
    payload.header.type !== "text" &&
    !payload.header.mediaUrl?.trim()
  ) {
    issues.push(error("header.media", `A ${payload.header.type} header requires a media file.`));
  }

  // Footer length.
  if (payload.footer?.enabled && payload.footer.text) {
    if (payload.footer.text.length > FOOTER_TEXT_MAX_CHARS) {
      issues.push(error("footer", `Footer text exceeds ${FOOTER_TEXT_MAX_CHARS} characters.`));
    }
  }

  // Actions validation.
  for (let i = 0; i < (payload.actions?.length || 0); i++) {
    const action = payload.actions[i];
    if (!action.label?.trim()) {
      issues.push(error(`actions[${i}].label`, `Action ${i + 1} needs a button label.`));
    } else if (action.label.length > ACTION_LABEL_MAX_CHARS) {
      issues.push(error(`actions[${i}].label`, `Action ${i + 1} label exceeds ${ACTION_LABEL_MAX_CHARS} characters.`));
    }
    validateActionValue(action, i, issues);
  }

  // Quick reply validation.
  for (let i = 0; i < (payload.quickReplies?.length || 0); i++) {
    const qr = payload.quickReplies[i];
    if (!qr.display?.trim()) {
      issues.push(error(`quickReplies[${i}].display`, `Quick reply ${i + 1} needs display text.`));
    } else if (qr.display.length > QUICK_REPLY_MAX_CHARS) {
      issues.push(error(`quickReplies[${i}].display`, `Quick reply ${i + 1} exceeds ${QUICK_REPLY_MAX_CHARS} characters.`));
    }
    if (!qr.payload?.trim()) {
      issues.push(warning(`quickReplies[${i}].payload`, `Quick reply ${i + 1} has no internal payload value.`));
    }
  }

  // Unique quick reply payloads.
  const payloads = (payload.quickReplies || []).map((qr) => qr.payload?.trim().toUpperCase()).filter(Boolean);
  if (payloads.length !== new Set(payloads).size) {
    issues.push(error("quickReplies", "Quick reply payloads must be unique."));
  }

  return issues;
}

function validateActionValue(action: TemplateAction, index: number, issues: ValidationIssue[]) {
  const field = `actions[${index}].value`;
  if (!action.value?.trim()) {
    issues.push(error(field, `Action ${index + 1} needs a destination (URL or phone number).`));
    return;
  }
  if (action.type === "phone") {
    if (!isValidPhone(action.value)) {
      issues.push(error(field, `Action ${index + 1} has an invalid phone number.`));
    }
  } else {
    if (!isValidUrl(action.value)) {
      issues.push(error(field, `Action ${index + 1} has an invalid URL. Must start with http:// or https://.`));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-send validation (will this message deliver?)
// ─────────────────────────────────────────────────────────────────────────────

export function validateForSend(
  payload: MessageTemplatePayload,
  deliveryMethod: DeliveryMethod
): ValidationIssue[] {
  // Include all save-time issues first.
  const issues = validateForSave(payload);

  // Body character limit.
  if (payload.body?.text && payload.body.text.length > WHATSAPP_BODY_MAX_CHARS) {
    issues.push(error("body", `Message body exceeds ${WHATSAPP_BODY_MAX_CHARS} characters.`));
  }

  // Variable definitions.
  const referenced = collectReferencedVariables(payload);
  const defined = new Set((payload.variables || []).map((v) => v.key));
  for (const key of referenced) {
    if (!defined.has(key)) {
      issues.push(warning("variables", `Variable {{${key}}} is used in the template but not defined. It will appear as-is in the message.`));
    }
  }

  // Meta Cloud API specific restrictions.
  if (deliveryMethod === "cloud_api") {
    if ((payload.actions?.length || 0) > META_MAX_ACTIONS) {
      issues.push(error("actions", `Meta Cloud API allows a maximum of ${META_MAX_ACTIONS} action buttons. You have ${payload.actions.length}.`));
    }
    if ((payload.quickReplies?.length || 0) > META_MAX_QUICK_REPLIES) {
      issues.push(error("quickReplies", `Meta Cloud API allows a maximum of ${META_MAX_QUICK_REPLIES} quick replies. You have ${payload.quickReplies.length}.`));
    }
    // Combined button limit.
    const totalButtons = (payload.actions?.length || 0) + (payload.quickReplies?.length || 0);
    if (totalButtons > META_MAX_ACTIONS) {
      issues.push(warning("actions", `Meta Cloud API supports ${META_MAX_ACTIONS} buttons total (actions + quick replies combined). You have ${totalButtons}.`));
    }
    // Media header type check.
    if (payload.header?.type === "video") {
      issues.push(warning("header", "Video headers may require the video to be hosted on a publicly accessible URL for Meta Cloud API."));
    }
  }

  // WhatsApp Web specific notes.
  if (deliveryMethod === "web") {
    if ((payload.quickReplies?.length || 0) > 0) {
      issues.push(warning("quickReplies", "Quick replies are rendered as text instructions on WhatsApp Web. Recipients must type their reply manually."));
    }
    if (payload.actions?.length > 0) {
      issues.push(warning("actions", "Action buttons are rendered as text links on WhatsApp Web. Recipients must tap the link manually."));
    }
  }

  return issues;
}

/**
 * Quick boolean check: does this payload have any blocking errors?
 */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
