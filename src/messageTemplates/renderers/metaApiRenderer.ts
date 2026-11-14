/**
 * Meta WhatsApp Cloud API Renderer
 *
 * Converts a MessageTemplatePayload into the structured JSON that the Meta
 * Graph API expects for sending a template message. This is the format required
 * by POST /{phone-number-id}/messages with type "template".
 *
 * The renderer produces the template *parameters* object, not the template
 * registration payload — registration is a separate step done in the Meta
 * Business Manager. This output fills the parameters of an already-approved
 * template with the per-recipient variable values.
 *
 * Where a source template uses a feature that the Meta API does not support
 * (e.g. more than 3 buttons), the renderer drops the excess and the
 * validation layer surfaces a warning beforehand.
 */

import type {
  MessageTemplatePayload,
  MetaApiOutput,
  MetaApiComponent,
  MetaApiParameter,
} from "../types";
import { META_MAX_ACTIONS } from "../types";
import { substituteVariables, VARIABLE_PATTERN } from "../variables";

/**
 * Render a template payload into Meta Cloud API structured JSON.
 *
 * @param payload       The template's component payload.
 * @param templateName  The approved Meta template name (slug).
 * @param languageCode  ISO 639-1 language code for the template.
 * @param values        Variable values for parameter substitution.
 */
export function renderForMetaApi(
  payload: MessageTemplatePayload,
  templateName: string,
  languageCode: string = "en",
  values: Record<string, string> = {}
): MetaApiOutput {
  const sub = (text: string) => substituteVariables(text, values, "blank");
  const components: MetaApiComponent[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  if (payload.header.type === "text" && payload.header.text?.trim()) {
    const params = extractOrderedParameters(payload.header.text, values);
    components.push({
      type: "header",
      ...(params.length > 0 ? { parameters: params } : {}),
    });
  } else if (payload.header.type === "image" && payload.header.mediaUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: payload.header.mediaUrl } }],
    });
  } else if (payload.header.type === "video" && payload.header.mediaUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "video", video: { link: payload.header.mediaUrl } }],
    });
  } else if (payload.header.type === "document" && payload.header.mediaUrl) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: payload.header.mediaUrl,
            filename: payload.header.mediaFileName || "document",
          },
        },
      ],
    });
  }

  // ── Body ────────────────────────────────────────────────────────────────
  if (payload.body.text?.trim()) {
    const params = extractOrderedParameters(payload.body.text, values);
    components.push({
      type: "body",
      ...(params.length > 0 ? { parameters: params } : {}),
    });
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  // Meta API footers are static text on the template registration side. They
  // don't accept runtime parameters. Include the component only as a signal
  // to the caller that a footer exists; the actual text is on the registered
  // template, not in the send payload.
  if (payload.footer.enabled && payload.footer.text?.trim()) {
    components.push({
      type: "footer",
      text: sub(payload.footer.text.trim()),
    });
  }

  // ── Buttons (actions + quick replies) ──────────────────────────────────
  // Meta allows up to 3 buttons total (CTA + quick reply combined). We emit
  // CTA URL buttons first, then quick replies, and silently truncate beyond 3.
  let buttonIndex = 0;
  const maxButtons = META_MAX_ACTIONS;

  for (const action of payload.actions) {
    if (buttonIndex >= maxButtons) break;
    if (action.type === "url" || action.type === "custom_url") {
      const urlParams = extractOrderedParameters(action.value || "", values);
      components.push({
        type: "button",
        sub_type: "url",
        index: buttonIndex,
        ...(urlParams.length > 0 ? { parameters: urlParams } : {}),
      });
      buttonIndex++;
    } else if (action.type === "phone") {
      // Phone buttons are defined at registration time; no runtime parameters.
      buttonIndex++;
    }
  }

  for (const qr of payload.quickReplies) {
    if (buttonIndex >= maxButtons) break;
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: buttonIndex,
      parameters: [{ type: "text", text: qr.payload || qr.display }],
    });
    buttonIndex++;
  }

  return {
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };
}

/**
 * Extract positional template parameters from a text containing {{variables}}.
 *
 * The Meta API uses positional parameters ({{1}}, {{2}}, etc.) rather than
 * named variables. This function finds all {{key}} tokens in order and returns
 * them as MetaApiParameter[] with substituted values.
 */
function extractOrderedParameters(
  text: string,
  values: Record<string, string>
): MetaApiParameter[] {
  const params: MetaApiParameter[] = [];
  const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = pattern.exec(text)) !== null) {
    const key = match[1];
    // Each unique variable becomes one positional parameter, in the order
    // it first appears.
    if (seen.has(key)) continue;
    seen.add(key);
    params.push({
      type: "text",
      text: values[key] || "",
    });
  }

  return params;
}
