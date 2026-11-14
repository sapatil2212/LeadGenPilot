/**
 * Client-side rendering helpers for instant preview.
 *
 * These mirror the server renderers (src/messageTemplates/renderers) closely
 * enough for a faithful live preview, so the builder doesn't round-trip to the
 * server on every keystroke. The server remains the source of truth at send
 * time; this is presentation only.
 */

import type { MessageTemplatePayload } from "./api";

const VARIABLE_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Replace {{key}} tokens with sample values, keeping unknown ones visible. */
export function substitute(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (token, key) =>
    key in values && values[key] ? values[key] : token
  );
}

/** Extract unique variable keys referenced in a text. */
export function extractKeys(text: string): string[] {
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  const p = new RegExp(VARIABLE_PATTERN.source, "g");
  while ((m = p.exec(text)) !== null) keys.add(m[1]);
  return [...keys];
}

export interface PreviewLine {
  kind: "header" | "body" | "action" | "quickReplyHint" | "footer";
  text: string;
}

const ACTION_EMOJI: Record<string, string> = {
  url: "🌐",
  phone: "📞",
  whatsapp_link: "💬",
  custom_url: "🔗",
};

/**
 * Produce the ordered text lines a WhatsApp Web message would contain, as the
 * server renderer does — used to drive the chat-bubble preview.
 */
export function renderWebLines(
  payload: MessageTemplatePayload,
  values: Record<string, string>
): PreviewLine[] {
  const sub = (t: string) => substitute(t, values);
  const lines: PreviewLine[] = [];

  if (payload.header.type === "text" && payload.header.text?.trim()) {
    lines.push({ kind: "header", text: `⭐ ${sub(payload.header.text.trim())}` });
  }
  if (payload.body.text?.trim()) {
    lines.push({ kind: "body", text: sub(payload.body.text.trim()) });
  }
  for (const action of payload.actions) {
    if (!action.label?.trim()) continue;
    const emoji = ACTION_EMOJI[action.type] || "🔗";
    const value = sub(action.value?.trim() || "");
    lines.push({ kind: "action", text: value ? `${emoji} ${sub(action.label.trim())}\n${value}` : `${emoji} ${sub(action.label.trim())}` });
  }
  if (payload.quickReplies.length > 0) {
    const opts = payload.quickReplies.filter((q) => q.display?.trim()).map((q) => q.display.trim());
    if (opts.length === 1) {
      lines.push({ kind: "quickReplyHint", text: `💬 Reply ${opts[0]} if you'd like more details.` });
    } else if (opts.length > 1) {
      const last = opts[opts.length - 1];
      lines.push({ kind: "quickReplyHint", text: `💬 Reply ${opts.slice(0, -1).join(", ")} or ${last} to let us know.` });
    }
  }
  if (payload.footer.enabled && payload.footer.text?.trim()) {
    lines.push({ kind: "footer", text: sub(payload.footer.text.trim()) });
  }
  return lines;
}

/**
 * Convert WhatsApp markup (*bold* _italic_ ~strike~) into safe HTML for the
 * preview bubble. Escapes HTML first so user text can never inject markup.
 */
export function whatsappMarkupToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*(?!\s)([^*\n]+?)(?!\s)\*/g, "<strong>$1</strong>")
    .replace(/_(?!\s)([^_\n]+?)(?!\s)_/g, "<em>$1</em>")
    .replace(/~(?!\s)([^~\n]+?)(?!\s)~/g, "<s>$1</s>")
    .replace(/```([^`]+?)```/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
}
