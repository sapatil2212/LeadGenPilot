/**
 * Unified WhatsApp send gateway.
 *
 * Outreach code should not care which transport a user configured. This module
 * resolves the active provider per user and dispatches accordingly:
 *
 *   "web"   -> whatsapp-web.js QR session (outreachService)
 *   "cloud" -> Meta WhatsApp Business Cloud API (whatsappCloudService)
 *
 * Returning a structured result rather than a bare boolean matters here, because
 * the Cloud API has a failure mode the web gateway does not: free-form text is
 * blocked outside the 24h customer service window and needs an approved template.
 */

import { logger } from "./logger";
import { sendWhatsAppMessage as sendViaWeb, getWhatsAppStatus } from "./outreachService";
import {
  sendCloudText,
  sendCloudTemplate,
  verifyCloudCredentials,
  MetaCloudConfig,
} from "./whatsappCloudService";
import { getWhatsAppCloudConfig, getWhatsAppProvider } from "./userIntegrationService";

export type WhatsAppProvider = "web" | "cloud";

export interface UnifiedSendResult {
  ok: boolean;
  provider: WhatsAppProvider;
  messageId?: string;
  error?: string;
  /** Set when the Cloud API refused free-form text and no template was available. */
  requiresTemplate?: boolean;
}

/**
 * Resolve the provider plus credentials for a user. Falls back to the web
 * gateway whenever cloud is selected but not usably configured, so a
 * half-finished setup degrades instead of silently dropping every message.
 */
export async function resolveProvider(
  userId?: string
): Promise<{ provider: WhatsAppProvider; cloudConfig?: MetaCloudConfig }> {
  if (!userId) return { provider: "web" };

  try {
    const preferred = await getWhatsAppProvider(userId);
    if (preferred !== "cloud") return { provider: "web" };

    const cloudConfig = await getWhatsAppCloudConfig(userId);
    if (!cloudConfig) {
      logger.warn(
        "Cloud API is selected as the WhatsApp provider but no valid credentials are saved. Falling back to the WhatsApp Web gateway."
      );
      return { provider: "web" };
    }
    return { provider: "cloud", cloudConfig };
  } catch (err: any) {
    logger.warn(`Could not resolve WhatsApp provider, defaulting to web: ${err?.message || err}`);
    return { provider: "web" };
  }
}

/**
 * Send a WhatsApp message through whichever provider the user has active.
 *
 * `allowTemplateFallback` controls cold-outreach behaviour on the Cloud API: if
 * the 24h window is closed and a default template is configured, we resend as a
 * template so campaigns are not blocked. Manual conversation replies pass false,
 * because silently substituting canned template copy for what the user typed
 * would be misleading.
 */
export async function sendWhatsAppUnified(
  phone: string,
  text: string,
  options: { userId?: string; allowTemplateFallback?: boolean } = {}
): Promise<UnifiedSendResult> {
  const { userId, allowTemplateFallback = true } = options;
  const { provider, cloudConfig } = await resolveProvider(userId);

  if (provider === "cloud" && cloudConfig) {
    const result = await sendCloudText(cloudConfig, phone, text);

    if (result.ok) {
      return { ok: true, provider: "cloud", messageId: result.messageId };
    }

    if (result.requiresTemplate && allowTemplateFallback && cloudConfig.defaultTemplateName) {
      logger.info(
        `Retrying ${phone} as approved template '${cloudConfig.defaultTemplateName}' (24h window closed).`
      );
      const templateResult = await sendCloudTemplate(
        cloudConfig,
        phone,
        cloudConfig.defaultTemplateName,
        cloudConfig.defaultTemplateLang || "en_US",
        [text]
      );
      return {
        ok: templateResult.ok,
        provider: "cloud",
        messageId: templateResult.messageId,
        error: templateResult.error,
      };
    }

    return {
      ok: false,
      provider: "cloud",
      error: result.requiresTemplate
        ? "This lead has not messaged you in the last 24 hours, so WhatsApp only allows an approved template. Configure a default template in Settings."
        : result.error,
      requiresTemplate: result.requiresTemplate,
    };
  }

  const ok = await sendViaWeb(phone, text);
  return {
    ok,
    provider: "web",
    error: ok ? undefined : "WhatsApp Web gateway is not connected or the number is not on WhatsApp.",
  };
}

/**
 * Connection status for whichever provider is active, normalised to the shape
 * the dashboard already consumes ({ status, qr }) plus cloud-specific detail.
 */
export async function getUnifiedWhatsAppStatus(userId?: string): Promise<{
  provider: WhatsAppProvider;
  status: string;
  qr: string;
  cloud?: {
    connected: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    error?: string;
  };
}> {
  const { provider, cloudConfig } = await resolveProvider(userId);

  if (provider === "cloud" && cloudConfig) {
    const status = await verifyCloudCredentials(cloudConfig);
    return {
      provider: "cloud",
      status: status.connected ? "CONNECTED" : "DISCONNECTED",
      qr: "",
      cloud: {
        connected: status.connected,
        displayPhoneNumber: status.displayPhoneNumber,
        verifiedName: status.verifiedName,
        qualityRating: status.qualityRating,
        error: status.error,
      },
    };
  }

  const web = getWhatsAppStatus();
  return { provider: "web", status: web.status, qr: web.qr };
}
