/**
 * WhatsApp Web Renderer
 *
 * Converts a MessageTemplatePayload into a plain-text message suitable for
 * whatsapp-web.js's client.sendMessage(). WhatsApp Web does not support native
 * interactive buttons, so CTAs and quick replies are rendered as clean
 * text-based actions with emoji signifiers. Media headers are returned as a
 * separate mediaUrl for the caller to send as a preceding message.
 *
 * This renderer NEVER fakes unsupported functionality. What WhatsApp Web can't
 * do natively (tappable buttons, quick-reply chips, media inside the message
 * card) is represented honestly as text the recipient can read and act on.
 */

import type { MessageTemplatePayload, WhatsAppWebOutput } from "../types";
import { substituteVariables } from "../variables";

/** Emoji prefixes for each action type, consistent across every render. */
const ACTION_EMOJI: Record<string, string> = {
  url: "🌐",
  phone: "📞",
  whatsapp_link: "💬",
  custom_url: "🔗",
};

/**
 * Render a template payload into a WhatsApp Web plain-text message.
 *
 * @param payload   The template's component payload.
 * @param values    Variable values to substitute (sample data for preview, lead
 *                  data for send). Keys without braces: { first_name: "Rahul" }.
 */
export function renderForWhatsAppWeb(
  payload: MessageTemplatePayload,
  values: Record<string, string> = {}
): WhatsAppWebOutput {
  const sub = (text: string) => substituteVariables(text, values);
  const parts: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  if (payload.header.type === "text" && payload.header.text?.trim()) {
    // Bold header with a star emoji to visually separate it.
    parts.push(`⭐ *${sub(payload.header.text.trim())}*`);
  }
  // Image/video/document headers are not inline in WhatsApp Web text. They're
  // returned as a separate media attachment for the caller to send first.

  // ── Body ────────────────────────────────────────────────────────────────
  if (payload.body.text?.trim()) {
    parts.push(sub(payload.body.text.trim()));
  }

  // ── Actions (CTA buttons → text links) ──────────────────────────────────
  for (const action of payload.actions) {
    if (!action.label?.trim()) continue;
    const emoji = ACTION_EMOJI[action.type] || "🔗";
    const label = sub(action.label.trim());
    const value = sub(action.value?.trim() || "");

    if (action.type === "phone") {
      parts.push(`${emoji} *${label}*\n${value}`);
    } else if (value) {
      parts.push(`${emoji} *${label}*\n${value}`);
    } else {
      parts.push(`${emoji} *${label}*`);
    }
  }

  // ── Quick replies (→ text instructions) ────────────────────────────────
  if (payload.quickReplies.length > 0) {
    const options = payload.quickReplies
      .filter((qr) => qr.display?.trim())
      .map((qr) => `*${qr.display.trim()}*`);
    if (options.length === 1) {
      parts.push(`💬 Reply ${options[0]} if you'd like more details.`);
    } else if (options.length > 1) {
      const last = options.pop();
      parts.push(`💬 Reply ${options.join(", ")} or ${last} to let us know.`);
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  if (payload.footer.enabled && payload.footer.text?.trim()) {
    parts.push(`_${sub(payload.footer.text.trim())}_`);
  }

  // ── Media ───────────────────────────────────────────────────────────────
  let mediaUrl: string | undefined;
  let mediaCaption: string | undefined;
  if (payload.header.type !== "none" && payload.header.type !== "text" && payload.header.mediaUrl) {
    mediaUrl = payload.header.mediaUrl;
    mediaCaption = payload.header.mediaCaption
      ? sub(payload.header.mediaCaption)
      : undefined;
  }

  return {
    text: parts.filter(Boolean).join("\n\n"),
    mediaUrl,
    mediaCaption,
  };
}
