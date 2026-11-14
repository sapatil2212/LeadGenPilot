/**
 * Channel renderer abstraction.
 *
 * A template has one source of truth (the payload). Renderers transform that
 * into channel-specific output. Adding a new channel is one new renderer file
 * and one entry in the render() dispatcher — the template model and UI stay
 * the same.
 */

import type {
  MessageTemplatePayload,
  DeliveryMethod,
  WhatsAppWebOutput,
  MetaApiOutput,
} from "../types";
import { renderForWhatsAppWeb } from "./whatsappWebRenderer";
import { renderForMetaApi } from "./metaApiRenderer";

export { renderForWhatsAppWeb, renderForMetaApi };

/** Discriminated union of all renderer outputs. */
export type RenderResult =
  | { method: "web"; output: WhatsAppWebOutput }
  | { method: "cloud_api"; output: MetaApiOutput };

/**
 * Render a template payload using the appropriate channel renderer.
 *
 * @param payload        The template's component payload.
 * @param deliveryMethod Which renderer to use.
 * @param values         Variable values for substitution.
 * @param metaOptions    Required when method is "cloud_api".
 */
export function render(
  payload: MessageTemplatePayload,
  deliveryMethod: DeliveryMethod,
  values: Record<string, string> = {},
  metaOptions?: { templateName: string; languageCode?: string }
): RenderResult {
  if (deliveryMethod === "cloud_api") {
    if (!metaOptions?.templateName) {
      throw new Error("metaOptions.templateName is required for Meta Cloud API rendering.");
    }
    return {
      method: "cloud_api",
      output: renderForMetaApi(
        payload,
        metaOptions.templateName,
        metaOptions.languageCode || "en",
        values
      ),
    };
  }

  return {
    method: "web",
    output: renderForWhatsAppWeb(payload, values),
  };
}
