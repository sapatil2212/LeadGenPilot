/**
 * User Integration API Routes
 * Allows users to manage their own SMTP, Google Sheets, and WhatsApp integrations
 */

import express, { Request, Response } from "express";
import { requireAuth } from "./authRoutes.js";
import { attachEntitlements } from "./entitlements.js";
import { resolveTenantContext, ctxOf } from "./tenancy/context.js";
import {
  saveUserIntegration,
  getUserIntegration,
  getAllUserIntegrations,
  deleteUserIntegration,
  toggleUserIntegration,
  testSMTPConnection,
  testGoogleSheetWebhook,
  decryptIntegrationConfig,
  getWhatsAppCloudConfig,
  getWhatsAppProvider,
  setWhatsAppProvider,
  WhatsAppCloudConfig,
} from "./userIntegrationService.js";
import {
  verifyCloudCredentials,
  invalidateCloudStatusCache,
  sendCloudText,
  sendCloudTemplate,
  listCloudTemplates,
} from "./whatsappCloudService.js";
import { sendEmailOutreach } from "./outreachService.js";

const router = express.Router();

/** Placeholder the UI shows instead of a stored secret. */
const MASK = "••••••••";

// Extend Express Request type to include user
interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    sub?: string;
  };
}

// All routes require authentication
router.use(requireAuth);

// The session token payload stores the user id in `sub`. This router's handlers
// reference `req.user.userId`, so normalize it here in one place to avoid the
// "userId: undefined" Prisma error when saving integrations.
router.use((req: AuthRequest, _res, next) => {
  if (req.user && req.user.userId == null && (req.user as any).sub) {
    req.user.userId = (req.user as any).sub;
  }
  next();
});
router.use(attachEntitlements);
router.use(resolveTenantContext);

/**
 * GET /api/integrations
 * Get all user integrations (without sensitive data)
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const integrations = await getAllUserIntegrations(userId, ctxOf(req).tenantId);
    res.json({ ok: true, integrations });
  } catch (error: any) {
    console.error("Get integrations error:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch integrations" });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * WhatsApp Business Cloud API (Meta) — official outreach provider.
 * Declared before the generic GET "/:type" handler below, otherwise these
 * concrete paths get swallowed by the wildcard and rejected as invalid types.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Public callback URL the user must paste into the Meta App Dashboard. */
function buildWebhookUrl(req: AuthRequest): string {
  const configured = process.env.PUBLIC_BASE_URL;
  const base = configured
    ? configured.replace(/\/$/, "")
    : `${req.protocol}://${req.get("host")}`;
  return `${base}/api/webhooks/whatsapp`;
}

/**
 * GET /api/integrations/whatsapp-cloud
 * Saved credentials with secrets masked, plus the webhook URL to copy.
 */
router.get("/whatsapp-cloud", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const config = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    const provider = await getWhatsAppProvider(userId, ctxOf(req).tenantId);

    if (!config) {
      return res.json({
        ok: true,
        configured: false,
        provider,
        webhookUrl: buildWebhookUrl(req),
      });
    }

    res.json({
      ok: true,
      configured: true,
      provider,
      webhookUrl: buildWebhookUrl(req),
      config: {
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId || "",
        accessToken: config.accessToken ? MASK : "",
        verifyToken: config.verifyToken || "",
        appSecret: config.appSecret ? MASK : "",
        defaultTemplateName: config.defaultTemplateName || "",
        defaultTemplateLang: config.defaultTemplateLang || "en_US",
      },
    });
  } catch (error: any) {
    console.error("Get WhatsApp Cloud error:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch WhatsApp Cloud configuration" });
  }
});

/**
 * GET /api/integrations/whatsapp-cloud/status
 * Live status straight from the Graph API, so the dashboard shows Meta's real
 * view (quality rating, verified name) instead of just "credentials exist".
 */
router.get("/whatsapp-cloud/status", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const config = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    if (!config) {
      return res.json({ ok: true, connected: false, configured: false });
    }
    // The settings panel's explicit Refresh button sends force=1; the periodic
    // background poll uses the cached value.
    const status = await verifyCloudCredentials(config, { force: req.query.force === "1" });
    res.json({ ok: true, configured: true, ...status });
  } catch (error: any) {
    console.error("WhatsApp Cloud status error:", error);
    res.status(500).json({ ok: false, error: "Failed to check WhatsApp Cloud status" });
  }
});

/**
 * POST /api/integrations/whatsapp-cloud
 * Save or update Meta Cloud API credentials.
 */
router.post("/whatsapp-cloud", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let {
      phoneNumberId,
      wabaId,
      accessToken,
      verifyToken,
      appSecret,
      defaultTemplateName,
      defaultTemplateLang,
      label,
    } = req.body;

    if (!phoneNumberId || !verifyToken) {
      return res
        .status(400)
        .json({ ok: false, error: "Phone Number ID and Verify Token are required" });
    }

    // Masked values mean "keep what is stored" — the UI never receives the real
    // secret, so echoing the mask back must not overwrite it with dots.
    const existing = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    if ((!accessToken || accessToken === MASK) && existing?.accessToken) {
      accessToken = existing.accessToken;
    }
    if (appSecret === MASK && existing?.appSecret) {
      appSecret = existing.appSecret;
    }

    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "Access token is required" });
    }

    const config: WhatsAppCloudConfig = {
      phoneNumberId: String(phoneNumberId).trim(),
      wabaId: wabaId ? String(wabaId).trim() : undefined,
      accessToken: String(accessToken).trim(),
      verifyToken: String(verifyToken).trim(),
      appSecret: appSecret ? String(appSecret).trim() : undefined,
      defaultTemplateName: defaultTemplateName ? String(defaultTemplateName).trim() : undefined,
      defaultTemplateLang: defaultTemplateLang ? String(defaultTemplateLang).trim() : "en_US",
    };

    const integration = await saveUserIntegration(
      userId,
      "whatsapp_cloud",
      config,
      label || "WhatsApp Cloud API",
      ctxOf(req).tenantId
    );

    // Validate immediately so the user gets real feedback on save rather than
    // discovering broken credentials during a campaign. Forced, since freshly
    // entered credentials must never be judged by a stale cache entry.
    invalidateCloudStatusCache(config);
    const status = await verifyCloudCredentials(config, { force: true });

    res.json({
      ok: true,
      message: status.connected
        ? "WhatsApp Cloud API connected successfully"
        : "Credentials saved, but Meta rejected them. Check the details and test again.",
      id: integration.id,
      connected: status.connected,
      displayPhoneNumber: status.displayPhoneNumber,
      verifiedName: status.verifiedName,
      qualityRating: status.qualityRating,
      error: status.error,
    });
  } catch (error: any) {
    console.error("Save WhatsApp Cloud error:", error);
    res.status(500).json({ ok: false, error: "Failed to save WhatsApp Cloud configuration" });
  }
});

/**
 * POST /api/integrations/whatsapp-cloud/test
 * Validate credentials against the Graph API without saving them.
 */
router.post("/whatsapp-cloud/test", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let { phoneNumberId, accessToken, wabaId } = req.body;

    const existing = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    if ((!accessToken || accessToken === MASK) && existing?.accessToken) {
      accessToken = existing.accessToken;
    }
    if (!phoneNumberId && existing?.phoneNumberId) {
      phoneNumberId = existing.phoneNumberId;
    }

    if (!phoneNumberId || !accessToken) {
      return res
        .status(400)
        .json({ ok: false, error: "Phone Number ID and access token are required" });
    }

    const status = await verifyCloudCredentials(
      { phoneNumberId, accessToken, wabaId, verifyToken: "" },
      { force: true }
    );

    if (status.connected) {
      return res.json({
        ok: true,
        message: `Connected to ${status.displayPhoneNumber || "WhatsApp"}${
          status.verifiedName ? ` (${status.verifiedName})` : ""
        }`,
        ...status,
      });
    }
    res.json({ ok: false, error: status.error || "Meta rejected these credentials." });
  } catch (error: any) {
    console.error("Test WhatsApp Cloud error:", error);
    res.status(500).json({ ok: false, error: "Failed to test WhatsApp Cloud connection" });
  }
});

/**
 * POST /api/integrations/whatsapp-cloud/send-test
 * Send a real message so the user can confirm end-to-end delivery.
 * Body: { phone, message?, useTemplate?, templateName?, templateLang? }
 */
router.post("/whatsapp-cloud/send-test", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { phone, message, useTemplate, templateName, templateLang } = req.body;

    if (!phone) {
      return res.status(400).json({ ok: false, error: "A destination phone number is required" });
    }

    const config = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    if (!config) {
      return res.status(400).json({ ok: false, error: "Save your Cloud API credentials first" });
    }

    const wantsTemplate = Boolean(useTemplate) || Boolean(templateName);
    const result = wantsTemplate
      ? await sendCloudTemplate(
          config,
          phone,
          templateName || config.defaultTemplateName || "",
          templateLang || config.defaultTemplateLang || "en_US"
        )
      : await sendCloudText(config, phone, message || "Test message from LeadGenPilot.");

    if (result.ok) {
      return res.json({ ok: true, message: "Test message sent", messageId: result.messageId });
    }

    res.json({
      ok: false,
      error: result.requiresTemplate
        ? "This number has not messaged your business in the last 24 hours, so WhatsApp requires an approved template. Send a message to your business number first, or test with a template."
        : result.error,
      requiresTemplate: result.requiresTemplate,
    });
  } catch (error: any) {
    console.error("Send WhatsApp Cloud test error:", error);
    res.status(500).json({ ok: false, error: "Failed to send test message" });
  }
});

/**
 * GET /api/integrations/whatsapp-cloud/templates
 * Approved message templates for the connected WABA.
 */
router.get("/whatsapp-cloud/templates", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const config = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
    if (!config) {
      return res.status(400).json({ ok: false, error: "Save your Cloud API credentials first" });
    }
    const result = await listCloudTemplates(config);
    res.json(result);
  } catch (error: any) {
    console.error("List WhatsApp Cloud templates error:", error);
    res.status(500).json({ ok: false, error: "Failed to list templates" });
  }
});

/**
 * PUT /api/integrations/whatsapp-provider
 * Choose which transport outreach uses: "web" (QR) or "cloud" (official API).
 */
router.put("/whatsapp-provider", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { provider } = req.body;

    if (provider !== "web" && provider !== "cloud") {
      return res.status(400).json({ ok: false, error: "provider must be 'web' or 'cloud'" });
    }

    if (provider === "cloud") {
      const config = await getWhatsAppCloudConfig(userId, ctxOf(req).tenantId);
      if (!config) {
        return res.status(400).json({
          ok: false,
          error: "Connect your Meta Cloud API credentials before switching to the official provider.",
        });
      }
    }

    await setWhatsAppProvider(userId, provider, ctxOf(req).tenantId);
    res.json({ ok: true, provider, message: `WhatsApp provider set to ${provider}` });
  } catch (error: any) {
    console.error("Set WhatsApp provider error:", error);
    res.status(500).json({ ok: false, error: "Failed to set WhatsApp provider" });
  }
});

/**
 * GET /api/integrations/:type
 * Get specific integration configuration
 */
router.get("/:type", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const type = req.params.type as "smtp" | "google_sheet" | "whatsapp";

    if (!["smtp", "google_sheet", "whatsapp"].includes(type)) {
      return res.status(400).json({ ok: false, error: "Invalid integration type" });
    }

    const config = await getUserIntegration(userId, type, ctxOf(req).tenantId);
    
    if (!config) {
      return res.json({ ok: true, configured: false });
    }

    // Return config with sensitive data masked
    const maskedConfig = maskSensitiveData(config, type);
    res.json({ ok: true, configured: true, config: maskedConfig });
  } catch (error: any) {
    console.error("Get integration error:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch integration" });
  }
});

/**
 * POST /api/integrations/smtp
 * Save or update SMTP configuration
 */
router.post("/smtp", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let { host, port, secure, user, password, fromEmail, fromName, label } = req.body;

    if (!host || !port || !user || !password || !fromEmail) {
      return res.status(400).json({ ok: false, error: "Missing required SMTP fields" });
    }

    if (password === "••••••••") {
      const existing = await getUserIntegration(userId, "smtp", ctxOf(req).tenantId);
      if (existing && (existing as any).password) {
        password = (existing as any).password;
      }
    }

    const config = { host, port: Number(port), secure: Boolean(secure), user, password, fromEmail, fromName };

    const integration = await saveUserIntegration(userId, "smtp", config, label || "SMTP Email", ctxOf(req).tenantId);
    res.json({ ok: true, message: "SMTP configuration saved", id: integration.id });
  } catch (error: any) {
    console.error("Save SMTP error:", error);
    res.status(500).json({ ok: false, error: "Failed to save SMTP configuration" });
  }
});

/**
 * POST /api/integrations/smtp/test
 * Test SMTP connection without saving
 */
router.post("/smtp/test", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    let { host, port, secure, user, password, fromEmail, fromName } = req.body;

    if (!host || !port || !user || !password || !fromEmail) {
      return res.status(400).json({ ok: false, error: "Missing required SMTP fields" });
    }

    if (password === "••••••••") {
      const existing = await getUserIntegration(userId, "smtp", ctxOf(req).tenantId);
      if (existing && (existing as any).password) {
        password = (existing as any).password;
      }
    }

    const config = { host, port: Number(port), secure: Boolean(secure), user, password, fromEmail, fromName };
    const isValid = await testSMTPConnection(config);

    if (isValid) {
      res.json({ ok: true, message: "SMTP connection successful" });
    } else {
      res.json({ ok: false, error: "SMTP connection failed. Please check your credentials." });
    }
  } catch (error: any) {
    console.error("Test SMTP error:", error);
    res.status(500).json({ ok: false, error: "Failed to test SMTP connection" });
  }
});

/**
 * POST /api/integrations/google-sheet
 * Save or update Google Sheet webhook configuration
 */
router.post("/google-sheet", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { webhookUrl, sheetName, label } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: "Webhook URL is required" });
    }

    const config = { webhookUrl, sheetName };
    const integration = await saveUserIntegration(userId, "google_sheet", config, label || "Google Sheet", ctxOf(req).tenantId);
    
    res.json({ ok: true, message: "Google Sheet configuration saved", id: integration.id });
  } catch (error: any) {
    console.error("Save Google Sheet error:", error);
    res.status(500).json({ ok: false, error: "Failed to save Google Sheet configuration" });
  }
});

/**
 * POST /api/integrations/google-sheet/test
 * Test Google Sheet webhook without saving
 */
router.post("/google-sheet/test", async (req: AuthRequest, res: Response) => {
  try {
    const { webhookUrl, sheetName } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: "Webhook URL is required" });
    }

    const config = { webhookUrl, sheetName };
    const isValid = await testGoogleSheetWebhook(config);

    if (isValid) {
      res.json({ ok: true, message: "Google Sheet webhook is working" });
    } else {
      res.json({ ok: false, error: "Webhook test failed. Please check your URL and Apps Script setup." });
    }
  } catch (error: any) {
    console.error("Test Google Sheet error:", error);
    res.status(500).json({ ok: false, error: "Failed to test webhook" });
  }
});

/**
 * POST /api/integrations/whatsapp
 * Save or update WhatsApp configuration
 */
router.post("/whatsapp", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { apiUrl, apiKey, phoneNumber, label } = req.body;

    const config = { apiUrl, apiKey, phoneNumber };
    const integration = await saveUserIntegration(userId, "whatsapp", config, label || "WhatsApp", ctxOf(req).tenantId);
    
    res.json({ ok: true, message: "WhatsApp configuration saved", id: integration.id });
  } catch (error: any) {
    console.error("Save WhatsApp error:", error);
    res.status(500).json({ ok: false, error: "Failed to save WhatsApp configuration" });
  }
});

/**
 * DELETE /api/integrations/:id
 * Delete an integration
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const integrationId = req.params.id;

    await deleteUserIntegration(userId, integrationId, ctxOf(req).tenantId);
    res.json({ ok: true, message: "Integration deleted" });
  } catch (error: any) {
    console.error("Delete integration error:", error);
    res.status(500).json({ ok: false, error: "Failed to delete integration" });
  }
});

/**
 * PATCH /api/integrations/:id/toggle
 * Enable or disable an integration
 */
router.patch("/:id/toggle", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const integrationId = req.params.id;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "enabled must be a boolean" });
    }

    await toggleUserIntegration(userId, integrationId, enabled, ctxOf(req).tenantId);
    res.json({ ok: true, message: `Integration ${enabled ? "enabled" : "disabled"}` });
  } catch (error: any) {
    console.error("Toggle integration error:", error);
    res.status(500).json({ ok: false, error: "Failed to toggle integration" });
  }
});

/**
 * Helper: Mask sensitive data in configs
 */
function maskSensitiveData(config: any, type: string) {
  if (type === "smtp") {
    return {
      ...config,
      password: config.password ? "••••••••" : "",
    };
  }
  if (type === "whatsapp") {
    return {
      ...config,
      apiKey: config.apiKey ? "••••••••" : "",
    };
  }
  return config;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Multi-sender management (Feature 1 & 6)
 *
 * Manages up to 5 WhatsApp or SMTP sender accounts per tenant.
 * Sender slots are stored as UserIntegration rows with typed keys:
 *   slot 1: "whatsapp" / "smtp"       (primary, unchanged)
 *   slot 2: "whatsapp_2" / "smtp_2"
 *   …
 *   slot 5: "whatsapp_5" / "smtp_5"
 * ──────────────────────────────────────────────────────────────────────────── */

import {
  listSenderIntegrations,
  nextAvailableSlot,
  senderTypeForSlot,
  slotForSenderType,
  MAX_SENDERS,
  type SenderChannel,
} from "./campaign/senderRotationService.js";

/**
 * GET /api/integrations/senders/:channel
 * List all sender integrations for a channel (whatsapp | email).
 */
router.get("/senders/:channel", async (req: AuthRequest, res: Response) => {
  try {
    const channel = req.params.channel as SenderChannel;
    if (channel !== "whatsapp" && channel !== "email") {
      return res.status(400).json({ ok: false, error: "channel must be whatsapp or email" });
    }
    const ctx = ctxOf(req);
    const senders = await listSenderIntegrations(ctx.tenantId, channel);
    res.json({ ok: true, senders, maxSenders: MAX_SENDERS });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Failed to list senders." });
  }
});

/**
 * Validate and normalise an email (SMTP) sender payload.
 *
 * This matters more than it looks. The campaign executor turns a stored config
 * into a usable transport via resolvedSmtpFromConfig, which requires host, user
 * and password and an integer port in 1-65535. A config that fails those checks
 * is not rejected at send time with a useful message — it surfaces as
 * "Email is not configured for this workspace" for every message routed to that
 * slot, permanently. So the coercion has to happen here, on the way in:
 *   - `port` must become a real number (the form sends a string)
 *   - `secure` must become a real boolean (Boolean("false") is true)
 */
export interface NormalizedEmailSender {
  /** The config to persist, or null when validation failed. */
  config: Record<string, unknown> | null;
  /** Why validation failed, suitable for showing the user verbatim. */
  error?: string;
}

/**
 * Map a stored SMTP config onto the transport shape sendEmailOutreach expects.
 *
 * The key names deliberately change here: the stored config uses `password`
 * and `fromName`/`fromEmail`, while the mail layer wants `pass` and a single
 * `from` display name. This mirrors resolvedSmtpFromConfig in campaignExecutor
 * so a test send goes out through exactly the same shape a campaign would use —
 * otherwise a passing test would not prove a campaign will work.
 */
export function toSmtpTransportConfig(config: Record<string, unknown>): {
  host: string; port: number; secure: boolean; user: string; pass: string; from: string;
} {
  return {
    host: String(config.host),
    port: Number(config.port),
    secure: Boolean(config.secure),
    user: String(config.user),
    pass: String(config.password),
    from: String(config.fromName || config.fromEmail || config.user),
  };
}

export function normalizeEmailSenderConfig(body: any): NormalizedEmailSender {
  const src = body || {};
  const host = typeof src.host === "string" ? src.host.trim() : "";
  const user = typeof src.user === "string" ? src.user.trim() : "";
  const password = typeof src.password === "string" ? src.password : "";
  const fromEmail = typeof src.fromEmail === "string" ? src.fromEmail.trim() : "";
  const fromName = typeof src.fromName === "string" ? src.fromName.trim() : "";

  if (!host) return { config: null, error: "SMTP host is required." };
  if (!user) return { config: null, error: "SMTP username is required." };
  if (!password) return { config: null, error: "SMTP password is required." };
  if (!fromEmail) return { config: null, error: "From email is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    return { config: null, error: "From email is not a valid address." };
  }

  const port = Number(src.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { config: null, error: "Port must be a whole number between 1 and 65535." };
  }

  return {
    config: { host, port, secure: Boolean(src.secure), user, password, fromEmail, fromName },
  };
}

/** Read and decrypt a sender row scoped to the tenant, or null. */
async function findSenderRow(id: string, tenantId: string) {
  return await prisma.userIntegration.findFirst({
    where: { id, tenantId },
    select: { id: true, type: true, label: true, enabled: true, config: true },
  });
}

/**
 * Substitute the stored password when the client submits the mask placeholder.
 * Without this, saving an edited sender without retyping the password would
 * persist the literal bullet characters as the credential.
 */
async function resolveMaskedPassword(
  body: any,
  existingConfig: Record<string, unknown> | null
): Promise<any> {
  if (body?.password === MASK && existingConfig && typeof existingConfig.password === "string") {
    return { ...body, password: existingConfig.password };
  }
  return body;
}

/** Decrypt a sender row's config, returning null when unreadable. */
function decryptSenderConfig(encrypted: string): Record<string, unknown> | null {
  try {
    return JSON.parse(decryptIntegrationConfig(encrypted));
  } catch {
    return null;
  }
}

/**
 * POST /api/integrations/senders/:channel
 * Add a new sender account for a channel. Assigns it to the next available slot.
 * Body for email: { host, port, secure, user, password, fromEmail, fromName, label }
 * Body for WhatsApp: depends on provider — { apiUrl, apiKey, phoneNumber, label }
 */
router.post("/senders/:channel", async (req: AuthRequest, res: Response) => {
  try {
    const channel = req.params.channel as SenderChannel;
    if (channel !== "whatsapp" && channel !== "email") {
      return res.status(400).json({ ok: false, error: "channel must be whatsapp or email" });
    }
    const userId = req.user!.userId;
    const ctx = ctxOf(req);
    const existing = await listSenderIntegrations(ctx.tenantId, channel);
    const existingTypes = existing.map((s) => s.type);
    const slot = nextAvailableSlot(existingTypes, channel);
    if (!slot) {
      return res.status(400).json({ ok: false, error: `Maximum of ${MAX_SENDERS} ${channel} senders already configured.` });
    }
    const type = senderTypeForSlot(channel, slot);
    const { label, ...rest } = req.body;

    let config: Record<string, unknown> = rest;
    if (channel === "email") {
      const normalized = normalizeEmailSenderConfig(rest);
      if (!normalized.config) return res.status(400).json({ ok: false, error: normalized.error });
      config = normalized.config;
    }

    const row = await saveUserIntegration(userId, type as any, config as any, label || `${channel === "email" ? "SMTP" : "WhatsApp"} Sender ${slot}`, ctx.tenantId);
    res.status(201).json({ ok: true, id: row.id, type, slot });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message || "Failed to add sender." });
  }
});

/**
 * GET /api/integrations/senders/:channel/:id
 * Read one sender's configuration with secrets masked, so the UI can populate
 * an edit form. The generic GET /api/integrations/:type cannot do this because
 * it whitelists only the primary types and would reject "smtp_3".
 */
router.get("/senders/:channel/:id", async (req: AuthRequest, res: Response) => {
  try {
    const channel = req.params.channel as SenderChannel;
    if (channel !== "whatsapp" && channel !== "email") {
      return res.status(400).json({ ok: false, error: "channel must be whatsapp or email" });
    }
    const ctx = ctxOf(req);
    const row = await findSenderRow(req.params.id, ctx.tenantId);
    if (!row) return res.status(404).json({ ok: false, error: "Sender not found." });

    const config = decryptSenderConfig(row.config);
    if (!config) {
      return res.status(409).json({
        ok: false,
        error: "This sender's stored credentials could not be read. Delete it and add it again.",
      });
    }
    res.json({
      ok: true,
      id: row.id,
      type: row.type,
      label: row.label,
      enabled: row.enabled,
      slot: slotForSenderType(row.type),
      config: maskSensitiveData(config, channel === "email" ? "smtp" : "whatsapp"),
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Failed to read sender." });
  }
});

/**
 * PUT /api/integrations/senders/:channel/:id
 * Update an existing sender in place, keeping its slot.
 *
 * POST cannot serve this: it always allocates the next free slot, so editing
 * through it would either renumber the sender or exhaust the five slots.
 */
router.put("/senders/:channel/:id", async (req: AuthRequest, res: Response) => {
  try {
    const channel = req.params.channel as SenderChannel;
    if (channel !== "whatsapp" && channel !== "email") {
      return res.status(400).json({ ok: false, error: "channel must be whatsapp or email" });
    }
    const userId = req.user!.userId;
    const ctx = ctxOf(req);
    const row = await findSenderRow(req.params.id, ctx.tenantId);
    if (!row) return res.status(404).json({ ok: false, error: "Sender not found." });

    const existingConfig = decryptSenderConfig(row.config);
    const { label, ...rest } = await resolveMaskedPassword(req.body, existingConfig);

    let config: Record<string, unknown> = rest;
    if (channel === "email") {
      const normalized = normalizeEmailSenderConfig(rest);
      if (!normalized.config) return res.status(400).json({ ok: false, error: normalized.error });
      config = normalized.config;
    }

    // saveUserIntegration upserts on { tenantId, type }, so passing the row's
    // existing type updates this slot rather than creating another.
    await saveUserIntegration(userId, row.type as any, config as any, label || row.label || undefined, ctx.tenantId);
    res.json({ ok: true, id: row.id, type: row.type, slot: slotForSenderType(row.type) });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message || "Failed to update sender." });
  }
});

/**
 * POST /api/integrations/senders/email/:id/test
 *
 * Verify a saved SMTP sender's credentials. Unlike /smtp/test, this resolves a
 * masked password against *this* sender's stored row rather than the primary,
 * which is what makes testing slots 2-5 possible at all. Email-only: there is
 * no equivalent credential check for a WhatsApp Web session (that is the QR
 * link state, exposed via /api/whatsapp/sessions).
 */
router.post("/senders/email/:id/test", async (req: AuthRequest, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const row = await findSenderRow(req.params.id, ctx.tenantId);
    if (!row) return res.status(404).json({ ok: false, error: "Sender not found." });

    const existingConfig = decryptSenderConfig(row.config);
    // An empty body means "test exactly what is saved".
    const hasBody = req.body && Object.keys(req.body).length > 0;
    const source = hasBody ? await resolveMaskedPassword(req.body, existingConfig) : existingConfig;
    if (!source) {
      return res.status(409).json({ ok: false, error: "This sender has no readable configuration to test." });
    }

    const normalized = normalizeEmailSenderConfig(source);
    if (!normalized.config) return res.status(400).json({ ok: false, error: normalized.error });

    const isValid = await testSMTPConnection(normalized.config as any);
    if (isValid) return res.json({ ok: true, message: "SMTP connection successful." });
    return res.json({ ok: false, error: "SMTP connection failed. Check the host, port and credentials." });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Failed to test sender." });
  }
});

/** Default copy for a test email, so the dialog opens ready to send. */
const DEFAULT_TEST_EMAIL_SUBJECT = "LeadGenPilot test email";
const DEFAULT_TEST_EMAIL_BODY =
  "This is a test email from LeadGenPilot confirming this SMTP account can deliver outreach messages.";

/**
 * POST /api/integrations/senders/email/:id/send-test
 *
 * Actually deliver a test email from one SMTP slot.
 *
 * This is distinct from /test above, which only runs transporter.verify(). That
 * proves the credentials authenticate but not that mail leaves the server and
 * arrives — providers can accept a login and still reject or silently drop the
 * send. This route goes through sendEmailOutreach, the same function campaigns
 * use, so a success here means a campaign send will work.
 *
 * Body: { to, subject?, message?, ...optional draft credentials }
 */
router.post("/senders/email/:id/send-test", async (req: AuthRequest, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const row = await findSenderRow(req.params.id, ctx.tenantId);
    if (!row) return res.status(404).json({ ok: false, error: "Sender not found." });

    const { to, subject, message, ...draft } = req.body || {};

    const recipient = typeof to === "string" ? to.trim() : "";
    if (!recipient) return res.status(400).json({ ok: false, error: "Enter the email address to send the test to." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ ok: false, error: "That is not a valid email address." });
    }
    if (typeof subject === "string" && subject.length > 500) {
      return res.status(400).json({ ok: false, error: "Subject is too long (500 characters max)." });
    }
    if (typeof message === "string" && message.length > 50_000) {
      return res.status(400).json({ ok: false, error: "Message is too long (50000 characters max)." });
    }

    const existingConfig = decryptSenderConfig(row.config);
    // Credentials in the body let the user test an edited-but-unsaved account;
    // otherwise send using exactly what is stored.
    const hasDraftCredentials = draft && Object.keys(draft).length > 0;
    const source = hasDraftCredentials ? await resolveMaskedPassword(draft, existingConfig) : existingConfig;
    if (!source) {
      return res.status(409).json({ ok: false, error: "This sender has no readable configuration to send with." });
    }

    const normalized = normalizeEmailSenderConfig(source);
    if (!normalized.config) return res.status(400).json({ ok: false, error: normalized.error });

    const result = await sendEmailOutreach(
      recipient,
      typeof subject === "string" && subject.trim() ? subject.trim() : DEFAULT_TEST_EMAIL_SUBJECT,
      typeof message === "string" && message.trim() ? message.trim() : DEFAULT_TEST_EMAIL_BODY,
      toSmtpTransportConfig(normalized.config)
    );

    if (result.success) {
      return res.json({
        ok: true,
        message: `Test email sent to ${recipient}.`,
        to: recipient,
        messageId: result.messageId,
        // The envelope address is always the SMTP user, regardless of fromEmail.
        sentFrom: String(normalized.config.user),
      });
    }
    // sendEmailOutreach already classifies SMTP errors into actionable text.
    return res.status(400).json({ ok: false, error: result.error || "Failed to send the test email." });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || "Failed to send the test email." });
  }
});

/**
 * DELETE /api/integrations/senders/:channel/:id
 * Remove a specific sender integration.
 */
router.delete("/senders/:channel/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const ctx = ctxOf(req);
    const { id } = req.params;
    // Prevent deletion of the primary integration via this endpoint (use /api/integrations/:type).
    const row = await prisma.userIntegration.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { type: true } });
    if (!row) return res.status(404).json({ ok: false, error: "Sender not found." });
    if (row.type === "whatsapp" || row.type === "smtp") {
      return res.status(400).json({ ok: false, error: "Cannot delete the primary sender via this endpoint. Use the Integration settings instead." });
    }
    await deleteUserIntegration(userId, id, ctx.tenantId);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message || "Failed to delete sender." });
  }
});

/**
 * PATCH /api/integrations/senders/:channel/:id/toggle
 * Enable or disable a specific sender.
 */
router.patch("/senders/:channel/:id/toggle", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const ctx = ctxOf(req);
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ ok: false, error: "enabled must be a boolean." });
    await toggleUserIntegration(userId, req.params.id, enabled, ctx.tenantId);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ ok: false, error: error.message || "Failed to toggle sender." });
  }
});

// Prisma client for the senders delete endpoint above.
import { prisma } from "./prisma.js";

export default router;

