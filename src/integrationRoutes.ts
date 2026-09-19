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
      : await sendCloudText(config, phone, message || "Test message from NexaLeadAi.");

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

export default router;
