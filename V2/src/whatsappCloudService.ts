/**
 * WhatsApp Business Cloud API (Meta) service.
 *
 * This is the "official" WhatsApp outreach path, an alternative to the
 * whatsapp-web.js QR gateway in outreachService.ts. Key differences that shape
 * the code below:
 *
 *  - Auth is a permanent System User access token scoped to a WABA, not a QR scan.
 *  - Sends go to Graph API POST /{phoneNumberId}/messages.
 *  - Free-form text is only allowed inside a 24h customer service window that
 *    opens when the user messages you first. Cold outreach MUST use an approved
 *    template. We surface that distinction explicitly instead of silently failing.
 *  - Inbound replies and delivery receipts arrive via a webhook we expose.
 */

import crypto from "crypto";
import axios from "axios";
import { logger } from "./logger";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaCloudConfig {
  /** Phone Number ID from the Meta App Dashboard (not the phone number itself). */
  phoneNumberId: string;
  /** WhatsApp Business Account ID. Optional, used for template listing. */
  wabaId?: string;
  /** Permanent System User access token. */
  accessToken: string;
  /** Arbitrary string the user invents; must match what they paste into Meta. */
  verifyToken: string;
  /** App Secret, enables X-Hub-Signature-256 verification on the webhook. */
  appSecret?: string;
  /** Template used for cold outreach (outside the 24h window). */
  defaultTemplateName?: string;
  /** Template language code, e.g. "en_US". */
  defaultTemplateLang?: string;
}

export interface CloudSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  /** Meta's numeric error code, useful for distinguishing failure modes. */
  errorCode?: number;
  /** True when the send failed specifically because the 24h window is closed. */
  requiresTemplate?: boolean;
}

export interface CloudStatus {
  connected: boolean;
  /** The human-readable number, e.g. "+91 96043 14675". */
  displayPhoneNumber?: string;
  verifiedName?: string;
  /** GREEN | YELLOW | RED — Meta's messaging quality signal. */
  qualityRating?: string;
  /** e.g. "CONNECTED", "PENDING", "FLAGGED". */
  platformStatus?: string;
  error?: string;
}

/**
 * Meta expects a plain E.164 number with no "+", no spaces, no @c.us suffix.
 * Mirrors the normalisation rules in outreachService.formatWhatsAppJid so both
 * providers accept the same messy scraped input.
 */
export function toE164(phone: string): string | null {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[^0-9]/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }
  // Country code followed by a stray trunk zero, e.g. 9109604314675.
  if (cleaned.startsWith("910") && cleaned.length === 13) {
    cleaned = "91" + cleaned.substring(3);
  }
  // Bare 10-digit local number: assume the default India region prefix.
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  if (cleaned.length < 10 || cleaned.length > 15) return null;
  return cleaned;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Meta error codes that represent a temporary condition rather than a bad
 * request. Retrying these is worthwhile; retrying anything else just burns quota
 * and delays the campaign.
 *   130429 — application request limit reached
 *   131056 — too many messages to this specific recipient pair
 *   133016 — account temporarily blocked / restricted
 *   131000 — generic internal error on Meta's side
 */
const TRANSIENT_META_CODES = new Set([130429, 131056, 133016, 131000]);

function isTransientGraphError(err: any): boolean {
  // No response at all means DNS/socket/timeout, which is worth another attempt.
  if (!err?.response) return true;
  const status = err.response.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const code = err.response?.data?.error?.code;
  return typeof code === "number" && TRANSIENT_META_CODES.has(code);
}

/**
 * POST to the Graph API, retrying only transient failures with exponential
 * backoff. Campaigns fire hundreds of sends, so a single blip should not be
 * recorded as a permanent delivery failure against a lead.
 */
async function graphPostWithRetry(
  url: string,
  body: unknown,
  accessToken: string,
  attempts = 3
): Promise<any> {
  let lastError: any;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      });
    } catch (err: any) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !isTransientGraphError(err)) throw err;

      const backoffMs = 1000 * Math.pow(3, attempt); // 1s, then 3s
      const { message } = describeGraphError(err);
      logger.warn(
        `Transient WhatsApp Cloud API error (attempt ${attempt + 1}/${attempts}): ${message}. Retrying in ${backoffMs / 1000}s.`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

/** Pull a usable message out of Meta's nested error envelope. */
function describeGraphError(err: any): { message: string; code?: number } {
  const data = err?.response?.data?.error;
  if (data) {
    const parts = [data.message];
    if (data.error_user_title && data.error_user_title !== data.message) parts.push(data.error_user_title);
    if (data.error_user_msg) parts.push(data.error_user_msg);
    return { message: parts.filter(Boolean).join(" — "), code: data.code };
  }
  return { message: err?.message || String(err) };
}

/*
 * Status cache.
 *
 * The dashboard polls connection status every few seconds. Without a cache each
 * poll became a live Graph API call, which is slow on the request path and walks
 * straight into Meta's rate limits. Successful checks are cached for a minute;
 * failures for much less, so a fixed token reflects quickly.
 */
const STATUS_CACHE_TTL_MS = 60_000;
const STATUS_CACHE_ERROR_TTL_MS = 15_000;
const statusCache = new Map<string, { at: number; status: CloudStatus }>();

/** Keyed on the token too, so rotating credentials invalidates the entry. */
function statusCacheKey(config: MetaCloudConfig): string {
  const tokenFingerprint = crypto
    .createHash("sha1")
    .update(config.accessToken || "")
    .digest("hex")
    .slice(0, 12);
  return `${config.phoneNumberId}:${tokenFingerprint}`;
}

export function invalidateCloudStatusCache(config?: MetaCloudConfig): void {
  if (config) statusCache.delete(statusCacheKey(config));
  else statusCache.clear();
}

/**
 * Confirms the credentials actually work by reading the phone number node.
 * Used by both the "Test connection" button and the live status badge, so the
 * dashboard reflects Meta's real state rather than just "credentials present".
 *
 * Pass { force: true } for user-initiated checks that must bypass the cache.
 */
export async function verifyCloudCredentials(
  config: MetaCloudConfig,
  options: { force?: boolean } = {}
): Promise<CloudStatus> {
  if (!config?.phoneNumberId || !config?.accessToken) {
    return { connected: false, error: "Phone Number ID and access token are required." };
  }

  const key = statusCacheKey(config);
  if (!options.force) {
    const hit = statusCache.get(key);
    if (hit) {
      const ttl = hit.status.connected ? STATUS_CACHE_TTL_MS : STATUS_CACHE_ERROR_TTL_MS;
      if (Date.now() - hit.at < ttl) return hit.status;
    }
  }

  try {
    const res = await axios.get(`${GRAPH_BASE}/${config.phoneNumberId}`, {
      params: { fields: "display_phone_number,verified_name,quality_rating,platform_type,status" },
      headers: { Authorization: `Bearer ${config.accessToken}` },
      timeout: 15000,
    });

    const status: CloudStatus = {
      connected: true,
      displayPhoneNumber: res.data?.display_phone_number,
      verifiedName: res.data?.verified_name,
      qualityRating: res.data?.quality_rating,
      platformStatus: res.data?.status,
    };
    statusCache.set(key, { at: Date.now(), status });
    return status;
  } catch (err: any) {
    const { message, code } = describeGraphError(err);
    // 190 = invalid/expired token, 100 = unknown node (usually a wrong ID).
    let hint = message;
    if (code === 190) hint = `${message} (the access token is invalid or expired)`;
    if (code === 100) hint = `${message} (check the Phone Number ID)`;
    const status: CloudStatus = { connected: false, error: hint };
    statusCache.set(key, { at: Date.now(), status });
    return status;
  }
}

/**
 * Sends a free-form text message. Only valid within the 24h customer service
 * window; Meta rejects it otherwise and we flag that via requiresTemplate so
 * callers can fall back to a template instead of reporting a generic failure.
 */
export async function sendCloudText(
  config: MetaCloudConfig,
  phone: string,
  text: string
): Promise<CloudSendResult> {
  const to = toE164(phone);
  if (!to) return { ok: false, error: `Invalid phone number format: ${phone}` };

  try {
    const res = await graphPostWithRetry(
      `${GRAPH_BASE}/${config.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      },
      config.accessToken
    );

    const messageId = res.data?.messages?.[0]?.id;
    logger.success(`WhatsApp Cloud message accepted for ${to} (id: ${messageId || "n/a"}).`);
    return { ok: true, messageId };
  } catch (err: any) {
    const { message, code } = describeGraphError(err);
    // 131047: re-engagement required. 470: outside the 24h window (legacy code).
    const requiresTemplate = code === 131047 || code === 470;
    if (requiresTemplate) {
      logger.warn(
        `Cannot send free-form text to ${to}: the 24-hour reply window is closed. An approved template is required.`
      );
    } else {
      logger.error(`WhatsApp Cloud send to ${to} failed: ${message}`);
    }
    return { ok: false, error: message, errorCode: code, requiresTemplate };
  }
}

/**
 * Sends an approved message template. This is the only legitimate way to open a
 * conversation with a lead who has never messaged you, which is exactly the
 * cold-outreach case this product is built around.
 */
export async function sendCloudTemplate(
  config: MetaCloudConfig,
  phone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = []
): Promise<CloudSendResult> {
  const to = toE164(phone);
  if (!to) return { ok: false, error: `Invalid phone number format: ${phone}` };
  if (!templateName) return { ok: false, error: "No template name configured." };

  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
    : undefined;

  try {
    const res = await graphPostWithRetry(
      `${GRAPH_BASE}/${config.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode || "en_US" },
          ...(components ? { components } : {}),
        },
      },
      config.accessToken
    );

    const messageId = res.data?.messages?.[0]?.id;
    logger.success(`WhatsApp Cloud template '${templateName}' accepted for ${to}.`);
    return { ok: true, messageId };
  } catch (err: any) {
    const { message, code } = describeGraphError(err);
    logger.error(`WhatsApp Cloud template send to ${to} failed: ${message}`);
    return { ok: false, error: message, errorCode: code };
  }
}

/** Lists approved templates for the WABA so the UI can offer a real dropdown. */
export async function listCloudTemplates(
  config: MetaCloudConfig
): Promise<{ ok: boolean; templates?: any[]; error?: string }> {
  if (!config?.wabaId) {
    return { ok: false, error: "WhatsApp Business Account ID is required to list templates." };
  }
  try {
    const res = await axios.get(`${GRAPH_BASE}/${config.wabaId}/message_templates`, {
      params: { fields: "name,status,language,category,components", limit: 100 },
      headers: { Authorization: `Bearer ${config.accessToken}` },
      timeout: 15000,
    });
    const templates = (res.data?.data || []).map((t: any) => ({
      name: t.name,
      status: t.status,
      language: t.language,
      category: t.category,
    }));
    return { ok: true, templates };
  } catch (err: any) {
    const { message } = describeGraphError(err);
    return { ok: false, error: message };
  }
}

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body.
 * Uses a timing-safe comparison. Requires the unparsed body: re-serialising
 * req.body would change byte-for-byte content and break the digest.
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined
): boolean {
  if (!appSecret) return false;
  if (!rawBody || !signatureHeader) return false;

  const expected = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const digest = crypto
    .createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface InboundCloudMessage {
  from: string;
  text: string;
  timestamp: number;
  messageId?: string;
  /** Non-text messages still matter (a lead replying with an image is a reply). */
  type: string;
  phoneNumberId?: string;
}

export interface CloudStatusUpdate {
  messageId: string;
  status: string;
  recipient?: string;
  timestamp: number;
  error?: string;
}

/**
 * Flattens Meta's deeply nested webhook envelope into messages and delivery
 * receipts. Shape: entry[] -> changes[] -> value.{messages,statuses}.
 */
export function parseInboundWebhook(payload: any): {
  messages: InboundCloudMessage[];
  statuses: CloudStatusUpdate[];
} {
  const messages: InboundCloudMessage[] = [];
  const statuses: CloudStatusUpdate[] = [];

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;
      const phoneNumberId = value?.metadata?.phone_number_id;

      for (const msg of value.messages || []) {
        let text = "";
        switch (msg.type) {
          case "text":
            text = msg.text?.body || "";
            break;
          case "button":
            text = msg.button?.text || "";
            break;
          case "interactive":
            text =
              msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.title ||
              "";
            break;
          default:
            // Preserve the signal for media replies even without a caption.
            text = msg[msg.type]?.caption || `[${msg.type} message]`;
        }

        messages.push({
          from: msg.from,
          text,
          timestamp: Number(msg.timestamp) || Math.floor(Date.now() / 1000),
          messageId: msg.id,
          type: msg.type,
          phoneNumberId,
        });
      }

      for (const st of value.statuses || []) {
        statuses.push({
          messageId: st.id,
          status: st.status,
          recipient: st.recipient_id,
          timestamp: Number(st.timestamp) || Math.floor(Date.now() / 1000),
          error: st.errors?.[0]?.title,
        });
      }
    }
  }

  return { messages, statuses };
}
