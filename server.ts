/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { CONFIG } from "./src/config";
import { Lead } from "./src/types";
import {
  runScraper,
  cancelAllScrapes,
  CancellationToken,
  type ScrapeCriteria,
  type DiscoveryPlan,
} from "./src/mapsScraper";
import { logger } from "./src/logger";
import { duplicateChecker } from "./src/duplicateChecker";
import { loadFailedLeads, retryFailedLeads, sendLeadToWebhook, fetchLeadsFromGoogleSheet, fetchSheetNamesFromGoogleSheet } from "./src/googleSheetsWebhook";
import { 
  getWhatsAppStatus,
  disconnectWhatsApp,
  sendEmailOutreach,
  setIncomingWhatsAppHandler
} from "./src/outreachService";
import { normalizePhoneKey } from "./src/conversationStore";
import {
  recordInbound,
  recordOutbound,
  listConversations,
  getConversation,
  markConversationRead,
  setConversationStatus,
  deleteConversation,
} from "./src/conversations/conversationService";
import { generateOutreachCopy } from "./src/outreachCopy";
import { generateAICopy } from "./src/aiCopyGenerator";
import { env, validateEnv } from "./src/env";
import { readJson, writeJsonAtomic, withLock } from "./src/storage";
import cookieParser from "cookie-parser";
import authRoutes, { requireAuth, requireAdmin } from "./src/authRoutes";
import accountRoutes from "./src/accountRoutes";
import adminRoutes from "./src/adminRoutes";
import superAdminRoutes from "./src/superAdminRoutes";
import productionRoutes from "./src/productionRoutes";
import businessRoutes from "./src/business/businessRoutes";
import knowledgeRoutes from "./src/knowledge/knowledgeRoutes";
import assistantRoutes from "./src/assistant/assistantRoutes";
import icpRoutes from "./src/icp/icpRoutes";
import scoringRoutes from "./src/scoring/scoringRoutes";
import {
  resolveDefaultIcp,
  createIcpProfile,
  updateIcpProfile,
  type IcpView,
} from "./src/icp/icpService";
import { passesIcpFilters, buildSearchQueries } from "./src/icp/icpService";
import { scoreFit } from "./src/icp/fitService";
import { resolveActiveRuleSet, scoreLead } from "./src/scoring";
import { buildBusinessContext } from "./src/business/businessService";
import {
  clearDiscovered,
  loadSeenFingerprints,
  fingerprintOf,
  recordManyDiscovered,
} from "./src/discovery/dedupeService";
import { connectDatabase, disconnectDatabase } from "./src/prisma";
import crmRoutes, { appLeadToDbInput, dbLeadToAppLead } from "./crmRoutes";
import * as tenantRepo from "./src/tenancy/repository";
import { prisma } from "./src/prisma";
import {
  OutreachTemplate,
  compileTemplateText,
  compileTemplateSubject,
  templateNeedsAiBody,
} from "./src/outreachTemplates";
import {
  queryCampaignHistory,
  summarizeCampaignHistory,
  CampaignHistoryQuery,
} from "./src/campaignHistory";
import { exportCampaignHistoryToCsv, exportCampaignHistoryToPdf, exportCampaignHistoryToDocx } from "./src/campaignReportExporter";
import {
  getUserIntegration,
  saveUserIntegration,
  getAllEnabledSmtpConfigs,
  findCloudConfigByPhoneNumberId,
  findCloudConfigByVerifyToken,
} from "./src/userIntegrationService";
import { parseInboundWebhook, verifyMetaSignature } from "./src/whatsappCloudService";
import {
  sendWhatsAppUnified,
  getUnifiedWhatsAppStatus,
  resolveProvider as resolveWhatsAppProvider,
} from "./src/whatsappGateway";
import { startEmailReplyPolling, deriveImapHost, ImapMailbox } from "./src/emailReplyPoller";
import { startUnverifiedUserCleanup, stopUnverifiedUserCleanup } from "./src/cleanupUnverifiedUsers.js";
import {
  attachEntitlements,
  requireFeature,
  entOf,
  computeUsage,
  consumeLeads,
} from "./src/entitlements";
import {
  corsMiddleware,
  securityHeaders,
  compressionMiddleware,
  apiRateLimiter,
  heavyActionRateLimiter,
  apiKeyAuth,
} from "./src/security";
import { resolveTenantContext, requirePermission, ctxOf, type TenantContext } from "./src/tenancy/context";
import {
  startJob,
  finishJob,
  updateJobProgress,
  requestJobCancellation,
  isCancellationRequested,
  getJob,
  getLatestJob,
  listJobs,
  isTerminal,
  reclaimAbandonedJobs,
} from "./src/tenancy/jobService";
import { performanceMiddleware } from "./src/analytics";
import { scheduleAutomaticBackups } from "./src/backup";
import { notificationService } from "./src/notifications";
import { visitorTrackingMiddleware } from "./src/visitorTracker";

const app = express();
const PORT = env.port;

// Behind a proxy/load balancer (Render, etc.) — trust X-Forwarded-* so rate
// limiting and req.ip work against the real client address.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// ── Global middleware stack ──
app.use(compressionMiddleware());
app.use(securityHeaders());
app.use(corsMiddleware());
app.use(performanceMiddleware());
// The raw buffer is retained so the Meta WhatsApp webhook can verify its
// X-Hub-Signature-256 HMAC. Re-serialising req.body would alter the bytes and
// invalidate the digest.
app.use(
  express.json({
    limit: env.bodyLimit,
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: env.bodyLimit }));
app.use(cookieParser());

// ── Website visitor tracking (non-blocking, fire-and-forget) ──
app.use(visitorTrackingMiddleware());

// Wraps an async route handler so rejected promises reach the error handler
// instead of crashing the process or hanging the request.
const asyncHandler =
  (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Extracts per-run search criteria from a request body.
 *
 * A discovery run's parameters used to come from the shared mutable CONFIG
 * singleton, so they were process-global. They now travel with the request and
 * are stored on the Job row. CONFIG survives only as the default for fields the
 * caller omits and for the CLI entry point (src/main.ts).
 */
function readTenantCriteria(body: any): Partial<ScrapeCriteria> {
  const out: Partial<ScrapeCriteria> = {};
  if (!body || typeof body !== "object") return out;

  if (typeof body.businessType === "string" && body.businessType.trim()) {
    out.businessType = body.businessType.trim().slice(0, 300);
  }
  if (typeof body.location === "string" && body.location.trim()) {
    out.location = body.location.trim().slice(0, 300);
  }
  const max = parseInt(String(body.maxResults ?? ""), 10);
  if (Number.isFinite(max) && max >= 1 && max <= 5000) out.maxResults = max;
  if (body.enableSimulation !== undefined) out.enableSimulation = Boolean(body.enableSimulation);
  if (body.headless !== undefined) out.headless = Boolean(body.headless);
  const lat = parseFloat(String(body.lat ?? ""));
  const lng = parseFloat(String(body.lng ?? ""));
  const radius = parseFloat(String(body.radius ?? ""));
  if (Number.isFinite(lat)) out.lat = lat;
  if (Number.isFinite(lng)) out.lng = lng;
  if (Number.isFinite(radius)) out.radius = radius;

  return out;
}

// Persisted runtime config override (survives restarts, works on read-only
// source trees where writing src/config.ts is not possible).
//
// NOTE: this remains a single deployment-wide default, NOT per-tenant state.
// It seeds the form in the dashboard; a run's actual criteria come from the
// request and are recorded on the job. Per-tenant saved searches are a
// later phase.
const configOverridePath = path.join(process.cwd(), "leadfinder-config.json");

function persistConfigOverride() {
  try {
    writeJsonAtomic(configOverridePath, {
      businessType: CONFIG.businessType,
      location: CONFIG.location,
      maxResults: CONFIG.maxResults,
      enableSimulation: CONFIG.enableSimulation,
      headless: CONFIG.headless,
      lat: CONFIG.lat,
      lng: CONFIG.lng,
      radius: CONFIG.radius,
    });
  } catch (err) {
    logger.warn(`Could not persist runtime config override: ${(err as Error).message}`);
  }
}

function loadConfigOverride() {
  const override = readJson<Partial<typeof CONFIG> | null>(configOverridePath, null);
  if (override && typeof override === "object") {
    Object.assign(CONFIG, override);
    logger.info("Loaded persisted runtime configuration override.");
  }
}

// ── Health & readiness (public, no auth, not rate limited) ──
const bootTime = Date.now();

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.floor((Date.now() - bootTime) / 1000) });
});

app.get("/api/ready", (req, res) => {
  res.json({
    status: "ready",
    nodeEnv: env.nodeEnv,
    webhookConfigured: env.isWebhookConfigured(),
    smtpConfigured: env.isSmtpConfigured(),
    geminiConfigured: env.isGeminiConfigured(),
    databaseConfigured: env.isDatabaseConfigured(),
    whatsapp: getWhatsAppStatus().status,
    // Deliberately no longer reported here: whether a scrape is running is
    // per-workspace state, and this endpoint is public and unauthenticated.
    // Ask GET /api/status with a session instead.
    campaignRunning: isCampaignRunning,
    authEnabled: env.isAuthEnabled(),
  });
});

// ── Authentication routes (public: login/signup/verify/reset) ──
// Mounted before the API-key guard so users can authenticate without a key.
app.use("/api/auth", authRoutes);

// ── Account self-service + admin (session-authenticated, no API key needed) ──
app.use("/api/account", apiRateLimiter(), accountRoutes);
app.use("/api/admin", apiRateLimiter(), adminRoutes);

// ── Superadmin dedicated login route ──
// Requires email + password + SUPERADMIN_SECRET env variable.
// All attempts are logged to the audit log.
app.use("/api/superadmin", apiRateLimiter(), superAdminRoutes);

// ── Serve superadmin login HTML page at /superadmin ──
app.get("/superadmin", (req, res) => {
  const superAdminPage = path.join(process.cwd(), "public", "superadmin.html");
  if (fs.existsSync(superAdminPage)) {
    res.sendFile(superAdminPage);
  } else {
    res.status(404).send("Superadmin login page not found.");
  }
});

// ── Serve superadmin dashboard at /superadmin/dashboard ──
app.get("/superadmin/dashboard", (req, res) => {
  const dashboardPage = path.join(process.cwd(), "public", "superadmin-dashboard.html");
  if (fs.existsSync(dashboardPage)) {
    res.sendFile(dashboardPage);
  } else {
    res.status(404).send("Superadmin dashboard not found.");
  }
});

// ── User Integration Management (SMTP, Google Sheets, WhatsApp) ──
import integrationRoutes from "./src/integrationRoutes";
app.use("/api/integrations", apiRateLimiter(), integrationRoutes);

/* ── Meta WhatsApp Cloud API webhook ─────────────────────────────────────────
 * Mounted before the API-key guard because Meta's servers call this endpoint
 * and cannot present our key. Authenticity is established instead by the
 * verify token on the handshake and the App Secret HMAC on each delivery.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Webhook handshake. Meta issues GET ?hub.mode=subscribe&hub.verify_token=…
 * &hub.challenge=… and expects the challenge echoed back verbatim.
 * The token is matched against saved tenant configs, since Meta sends no
 * other identifier on this request.
 */
app.get(
  "/api/webhooks/whatsapp",
  asyncHandler(async (req, res) => {
    const mode = req.query["hub.mode"];
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = req.query["hub.challenge"];

    if (mode !== "subscribe" || !token) {
      return res.status(400).send("Bad Request");
    }

    // A global token lets the very first subscription succeed before any user
    // has saved credentials.
    const globalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (globalToken && token === globalToken) {
      logger.success("Meta WhatsApp webhook verified using the global verify token.");
      return res.status(200).send(String(challenge ?? ""));
    }

    const match = await findCloudConfigByVerifyToken(token);
    if (match) {
      logger.success("Meta WhatsApp webhook verified against a saved user configuration.");
      return res.status(200).send(String(challenge ?? ""));
    }

    logger.warn("Meta WhatsApp webhook verification rejected: unrecognised verify token.");
    res.status(403).send("Forbidden");
  })
);

/**
 * Inbound events: lead replies and delivery receipts.
 * Always answers 200 quickly — Meta retries with backoff and eventually
 * disables a webhook that errors or stalls, so processing failures must not
 * turn into a non-2xx response.
 */
app.post(
  "/api/webhooks/whatsapp",
  asyncHandler(async (req, res) => {
    const payload = req.body;

    if (payload?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const { messages, statuses } = parseInboundWebhook(payload);
    res.sendStatus(200);

    // Everything below runs after the ack.
    try {
      const phoneNumberId =
        messages[0]?.phoneNumberId ||
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      const tenant = await findCloudConfigByPhoneNumberId(phoneNumberId);

      // Verify the payload signature when the tenant supplied an App Secret.
      if (tenant?.appSecret) {
        const valid = verifyMetaSignature(
          tenant.appSecret,
          (req as any).rawBody,
          req.get("x-hub-signature-256")
        );
        if (!valid) {
          logger.warn("Rejected a WhatsApp webhook payload with an invalid signature.");
          return;
        }
      }

      if (!tenant?.tenantId) {
        logger.warn("Ignored WhatsApp Cloud webhook: integration has no workspace ownership.");
        return;
      }

      for (const msg of messages) {
        const key = normalizePhoneKey(msg.from);
        if (!key) continue;

        const lead = await prisma.lead
          .findFirst({ where: { tenantId: tenant.tenantId, phone: { contains: key } } })
          .catch(() => null);

        if (lead?.id) {
          await prisma.lead
            .update({ where: { id: lead.id }, data: { conversationStatus: "REPLIED" } })
            .catch(() => {});
          logger.success(`Cloud API reply matched inside workspace ${tenant.tenantId}.`);
        }

        await recordInbound({
          tenantId: tenant.tenantId,
          channel: "whatsapp",
          phone: msg.from,
          leadId: lead?.id,
          businessName: lead?.businessName || msg.from,
          text: msg.text || "",
          occurredAt: new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000),
          source: "cloud",
          provider: "meta_cloud",
          providerMessageId: msg.messageId,
        });
      }

      /*
       * Delivery receipts. The send API only reports that Meta *accepted* a
       * message; it can still fail afterwards (invalid number, blocked, no
       * WhatsApp account). Without this, a campaign records SENT for messages
       * that never arrived. Reconciling here keeps the CRM and the Google Sheet
       * honest about what was actually delivered.
       */
      if (statuses.length) {
        let sheetWebhookUrl: string | undefined;
        if (tenant?.userId) {
          const sheetConfig = (await getUserIntegration(tenant.userId, "google_sheet", tenant.tenantId || undefined).catch(
            () => null
          )) as any;
          if (sheetConfig?.webhookUrl) sheetWebhookUrl = sheetConfig.webhookUrl;
        }

        for (const st of statuses) {
          if (st.status !== "failed") continue;

          const key = normalizePhoneKey(st.recipient || "");
          logger.warn(
            `WhatsApp delivery failed for ${st.recipient || "unknown"}: ${st.error || "no reason given"}`
          );
          if (!key) continue;

          const lead = await prisma.lead
            .findFirst({ where: { tenantId: tenant.tenantId, phone: { contains: key } } })
            .catch(() => null);
          if (!lead) continue;

          await prisma.lead.update({
            where: { id: lead.id },
            data: { whatsappStatus: "FAILED", whatsappSentDate: new Date().toISOString().split("T")[0] },
          }).catch((err) => logger.warn(`Could not record WhatsApp delivery failure: ${err?.message || err}`));
          logger.info(`Marked '${lead.businessName}' WhatsApp status as FAILED after a delivery receipt.`);
        }
      }
    } catch (err: any) {
      logger.warn(`Failed to process WhatsApp Cloud webhook: ${err?.message || err}`);
    }
  })
);

// ── Protect all remaining API routes with rate limiting + auth ──
app.use("/api", apiRateLimiter());
app.use("/api", apiKeyAuth());
// Resolve the signed-in user's plan entitlements for downstream gating.
app.use("/api", attachEntitlements);

/*
 * CRM and production routers are mounted AFTER the auth middleware above.
 *
 * They used to be mounted before it, which meant `req.authUser` was never
 * populated inside them. crmRoutes read `req.authUser?.id ?? null` and treated
 * null as "no auth, so return everything" — so every list and lead in the
 * database was readable, editable and deletable by an unauthenticated caller,
 * and GET /api/crm/lists/ALL/export returned every tenant's leads as CSV.
 * productionRoutes imported requireAuth but never applied it, leaving its
 * backup endpoints anonymous.
 *
 * Mount order is the fix; the routers additionally enforce their own guards.
 */
// ── CRM: Lead Lists & DB-backed leads ──
app.use("/api/crm", crmRoutes);

// ── Production features (analytics, notifications, backups) ──
app.use("/api/production", productionRoutes);

/*
 * ── Business intelligence (Phase 3) ──────────────────────────────────────────
 *
 * Mounted here, after apiKeyAuth and attachEntitlements, for the same reason as
 * crmRoutes: each of these routers calls resolveTenantContext, which reads
 * req.authUser. Mounted any earlier they would see no session and refuse every
 * request — or worse, repeat the Phase 1 bug of treating "no user" as "no scope".
 */
app.use("/api/business", businessRoutes);
app.use("/api/knowledge", knowledgeRoutes);
app.use("/api/assistant", assistantRoutes);

/*
 * ── Targeting and scoring (Phase 4) ──────────────────────────────────────────
 *
 * Between them these replace the two pieces of deployment-global state that made
 * the product single-tenant in practice: the mutable CONFIG object holding one
 * vertical and one city, and the hardcoded scorer whose weights only suited a web
 * design agency.
 */
app.use("/api/icp", icpRoutes);
app.use("/api/scoring", scoringRoutes);

/*
 * ── Phase 5: Campaign generation with approval ──────────────────────────────
 *
 * The operator generates a batch of outreach messages, reviews each one, and
 * approves only what they're willing to claim. Replaces the fire-and-forget
 * campaign loop with a durable review workflow.
 */
import campaignRoutes from "./src/campaign/campaignRoutes";
import { recordDispatch } from "./src/campaign/dispatchService";
app.use("/api/campaigns", campaignRoutes);

/*
 * ── Discovery settings, formerly the global CONFIG ───────────────────────────
 *
 * These two routes used to read and write `CONFIG`, a mutable module-level object
 * shared by the entire deployment, with no tenant scope and no permission check
 * beyond "has a session". Any authenticated user could change what every other
 * workspace's next discovery run searched for, and in development POST rewrote
 * `src/config.ts` on disk so the change survived a restart.
 *
 * They are now a compatibility façade over the caller's own default ICP. The
 * request and response shapes are unchanged so the existing dashboard keeps
 * working without a frontend release; `/api/icp` is the real interface, and it
 * exposes the multi-category, multi-location targeting this shape cannot express.
 */

/** Presents an ICP in the legacy single-field config shape. */
function icpToLegacyConfig(profile: IcpView | null) {
  return {
    businessType: profile?.targetCategories.join(", ") ?? "",
    location: profile?.targetLocations.join(", ") ?? "",
    maxResults: profile?.maxResults ?? 50,
    enableSimulation: false,
    headless: true,
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
    radius: profile?.radiusKm ?? undefined,
    enableDeepAnalysis: profile?.deepAnalysis ?? false,
    /** Added fields, so a client can discover the richer interface. */
    icpProfileId: profile?.id ?? null,
    icpConfigured: !!profile,
  };
}

/** Splits a legacy comma-separated field into the ICP's array form. */
function splitLegacyList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// API Routes
app.get(
  "/api/config",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  asyncHandler(async (req, res) => {
    const profile = await resolveDefaultIcp(ctxOf(req));
    res.json(icpToLegacyConfig(profile));
  })
);

app.post(
  "/api/config",
  resolveTenantContext,
  requirePermission("MANAGE_BUSINESS_PROFILE"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { businessType, location, maxResults, radius, enableDeepAnalysis } = req.body || {};

    if (!businessType || !location || maxResults === undefined) {
      return res.status(400).json({ error: "Invalid parameters", code: "validation" });
    }

    const parsedMax = parseInt(String(maxResults), 10);
    if (!Number.isFinite(parsedMax) || parsedMax < 1 || parsedMax > 5000) {
      return res.status(400).json({ error: "maxResults must be a number between 1 and 5000." });
    }

    const patch = {
      targetCategories: splitLegacyList(businessType),
      targetLocations: splitLegacyList(location),
      maxResults: parsedMax,
      ...(radius !== undefined && radius !== null && Number.isFinite(parseFloat(String(radius)))
        ? { radiusKm: parseFloat(String(radius)) }
        : {}),
      ...(enableDeepAnalysis !== undefined ? { deepAnalysis: Boolean(enableDeepAnalysis) } : {}),
    };

    const existing = await resolveDefaultIcp(ctx);
    const profile = existing
      ? await updateIcpProfile(ctx, existing.id, patch)
      : await createIcpProfile(ctx, { name: "Default search", ...patch });

    logger.info(
      `Discovery settings updated for workspace ${ctx.tenantId}: ` +
        `${patch.targetCategories.join(", ")} in ${patch.targetLocations.join(", ")} (max ${parsedMax}).`
    );

    res.json({ success: true, config: icpToLegacyConfig(profile ?? null) });
  })
);

/**
 * GET /api/processed — full CRM leads owned by this workspace.
 *
 * The dashboard contract is a Lead array. Discovery fingerprints live behind
 * the dedupe service and are intentionally not returned here because they are
 * a different shape. Reads go through the tenant repository so no caller can
 * observe another workspace's list or leads.
 */
app.get(
  "/api/processed",
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => {
    const leads = await tenantRepo.findLeadsInWorkspace(
      ctxOf(req),
      {},
      { createdAt: "desc" }
    );
    res.json(leads.map(dbLeadToAppLead));
  })
);

/**
 * GET /api/failed — webhook delivery failures.
 *
 * `failed-leads.json` is a deployment-wide store holding lead records from every
 * workspace, so it cannot be tenant-scoped without the delivery pipeline moving
 * to the database. Until Phase 6 does that, it is an operator diagnostic and
 * requires admin rather than leaking across workspaces.
 */
app.get("/api/failed", requireAuth, requireAdmin, (req, res) => {
  const leads = loadFailedLeads();
  res.json(leads);
});

/**
 * GET /api/logs — the process log.
 *
 * Contains every workspace's search queries and discovered business names, so it
 * is operator-only. The per-workspace equivalent is GET /api/status and
 * GET /api/jobs, which report from the tenant's own job rows.
 */
app.get("/api/logs", requireAuth, requireAdmin, (req, res) => {
  const logs = logger.readLogs();
  res.json({ logs });
});

/**
 * POST /api/run-scraper
 *
 * Starts a lead-discovery run for the caller's workspace.
 *
 * Rewritten in Phase 2 to hold state in a per-tenant Job row. Previously this
 * handler used a process-global `isScrapingRunning` boolean and read its search
 * parameters from the shared mutable `CONFIG` singleton, which meant:
 *   - the second workspace in the entire deployment to press Start was refused;
 *   - saving a search in one workspace redirected a run already in flight in
 *     another;
 *   - the plan-quota capper wrote `CONFIG.maxResults = remaining`, permanently
 *     lowering the cap for every workspace that scraped afterwards.
 *
 * Criteria are now resolved per request and passed by argument, and admission is
 * per workspace, so two tenants can discover leads at the same time.
 */
app.post(
  "/api/run-scraper",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("RUN_LEAD_DISCOVERY"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);

    /*
     * Per-run criteria, resolved in this order:
     *   1. the workspace's default ICP — the multi-category, multi-location
     *      targeting it actually configured;
     *   2. anything explicitly overridden in the request body;
     *   3. the compile-time CONFIG, for the fields neither supplies.
     *
     * CONFIG is last and is only a source of defaults. It used to be the source
     * of truth: a shared mutable object holding one vertical and one city for the
     * whole deployment, which any tenant could redirect mid-run.
     */
    const icpProfile = await resolveDefaultIcp(ctx);
    const overrides = readTenantCriteria(req.body);

    const criteria: ScrapeCriteria = {
      ...CONFIG,
      ...(icpProfile
        ? {
            categories: icpProfile.targetCategories,
            locations: icpProfile.targetLocations,
            excludeCategories: icpProfile.excludeCategories,
            excludeKeywords: icpProfile.excludeKeywords,
            minRating: icpProfile.minRating,
            minReviews: icpProfile.minReviews,
            maxResults: icpProfile.maxResults,
            radius: icpProfile.radiusKm ?? undefined,
            enableDeepAnalysis: icpProfile.deepAnalysis,
            icpProfileId: icpProfile.id,
            // Kept in sync so logs, the sheet tab name and the generated list
            // name still describe the run.
            businessType: icpProfile.targetCategories.join(", ") || CONFIG.businessType,
            location: icpProfile.targetLocations.join(", ") || CONFIG.location,
          }
        : {}),
      ...overrides,
    };

    // An explicit businessType/location override replaces the ICP's arrays
    // rather than sitting alongside them, otherwise the override would be
    // silently ignored in favour of the profile.
    if (overrides.businessType !== undefined) {
      criteria.categories = overrides.businessType.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (overrides.location !== undefined) {
      criteria.locations = overrides.location.split(",").map((s) => s.trim()).filter(Boolean);
    }

    if (!criteria.categories?.length || !criteria.locations?.length) {
      return res.status(400).json({
        error:
          "There is nothing to search for yet. Set target categories and locations on your " +
          "customer profile, or send businessType and location with this request.",
        code: "icp_incomplete",
        icpConfigured: !!icpProfile,
      });
    }

    // ── Plan enforcement: monthly lead quota ──
    const ent = entOf(req);
    const authUser = req.authUser;
    if (!req.authDisabled && authUser && Number.isFinite(ent.monthlyLeadLimit)) {
      const usage = computeUsage(authUser, ent);
      if (usage.remaining <= 0) {
        return res.status(403).json({
          error: `You've reached your ${ent.planName} plan limit of ${ent.monthlyLeadLimit} leads this month. Upgrade to Pro for unlimited leads.`,
          code: "quota_exceeded",
          usage: { used: usage.used, limit: usage.limit },
        });
      }
      if (criteria.maxResults > usage.remaining) {
        logger.warn(
          `Capping this run to ${usage.remaining} lead(s) to respect the ${ent.planName} monthly limit (${usage.used}/${ent.monthlyLeadLimit} used).`
        );
        criteria.maxResults = usage.remaining;
      }
    }

    // Claims this workspace's discovery slot. Another workspace running a scrape
    // is irrelevant here; the same workspace running one is a conflict.
    const { job, conflict } = await startJob(ctx, "lead_discovery", criteria as any);
    if (!job) {
      return res.status(409).json({
        error: "A lead search is already running for this workspace.",
        code: "job_in_progress",
        jobId: conflict?.id,
        startedAt: conflict?.startedAt,
      });
    }

    res.json({
      success: true,
      message: "Lead search started.",
      jobId: job.id,
    });

    // ── Background execution ──
    const scrapingUserId = ctx.userId;
    const token = new CancellationToken();

    /*
     * Cancellation arrives as a database write from a different request (and
     * potentially a different process), so it is polled into the token rather
     * than read from a shared variable. 3s is frequent enough to abort between
     * leads — each takes several seconds — without adding meaningful load.
     */
    const cancelPoll = setInterval(() => {
      void isCancellationRequested(job.id)
        .then((requested) => {
          if (requested) token.cancel("cancelled by the workspace");
        })
        .catch(() => {
          /* a transient DB error must not abort the run */
        });
    }, 3000);

    try {
      logger.clear();
      let customWebhookUrl: string | undefined;
      const sheetConfig = (await getUserIntegration(scrapingUserId, "google_sheet", ctx.tenantId)) as any;
      if (sheetConfig && sheetConfig.webhookUrl) {
        customWebhookUrl = sheetConfig.webhookUrl;
      }

      /*
       * Progress is written to the job row so any request (or a future worker
       * process) can read it. Throttled to one write every 2s: the scraper
       * reports per lead, and each write is a round trip to a remote database.
       */
      /*
       * The workspace's scoring configuration and dedupe history, resolved once
       * per run and handed to the scraper.
       *
       * The scraper never touches the database: it receives the queries, the
       * filter, the duplicate check and the scorer as functions. That boundary is
       * why it has no tenant concept to get wrong, and it is the fix for the
       * original design where the module owned its own state and that state was
       * therefore process-global.
       */
      const ruleSet = await resolveActiveRuleSet(ctx);
      const seenFingerprints = await loadSeenFingerprints(ctx);
      const icpFilters = {
        excludeCategories: criteria.excludeCategories ?? [],
        excludeKeywords: criteria.excludeKeywords ?? [],
        minRating: criteria.minRating ?? null,
        minReviews: criteria.minReviews ?? null,
      };

      /** Businesses this run examined, written back after the scrape. */
      const seenThisRun: {
        businessName: string;
        address: string;
        phone: string;
        category: string;
        kept: boolean;
      }[] = [];

      const plan: DiscoveryPlan = {
        queries: buildSearchQueries(criteria.categories ?? [], criteria.locations ?? []),
        tenantId: ctx.tenantId,
        userId: scrapingUserId,
        icpProfileId: criteria.icpProfileId ?? null,
        filter: (candidate) => passesIcpFilters(candidate, icpFilters),
        isDuplicate: (businessName, address) =>
          seenFingerprints.has(fingerprintOf(businessName, address)),
        onSeen: (info) => {
          // Buffered rather than written per business: a discovery run examines
          // hundreds, and one round trip each to a remote database that is known
          // to drop connections would be both slow and fragile.
          seenThisRun.push(info);
          seenFingerprints.add(fingerprintOf(info.businessName, info.address));
        },
        score: (lead) => scoreLead(lead, ruleSet),
      };

      logger.info(
        `Discovery for workspace ${ctx.tenantId}: ${plan.queries!.length} quer(y|ies), ` +
          `scoring with "${ruleSet.name}" v${ruleSet.version} (max ${ruleSet.maxScore}), ` +
          `${seenFingerprints.size} business(es) already known.`
      );

      let lastProgressWrite = 0;
      const result = await runScraper(
        criteria,
        token,
        customWebhookUrl,
        (progress) => {
          const now = Date.now();
          const isFinalStage = progress.current >= progress.total && progress.total > 0;
          if (now - lastProgressWrite < 2000 && !isFinalStage) return;
          lastProgressWrite = now;
          void updateJobProgress(job.id, progress as any);
        },
        plan
      );

      // Persist harvested leads, then charge the monthly quota against what was
      // actually stored so the CRM count and quota never diverge.
      let persistedCount = 0;
      let listCreated = false;

      if (result && Array.isArray(result.leads) && result.leads.length > 0) {
        try {
          const now = new Date();
          const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
          const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
          const listName = `${criteria.businessType} — ${criteria.location} — ${timeStr} ${dateStr}`;
          const leadList = await prisma.leadList.create({
            data: {
              name: listName,
              businessType: criteria.businessType,
              location: criteria.location,
              // Both stamped: tenantId is the new scope, userId is still read by
              // code paths that have not migrated yet.
              tenantId: ctx.tenantId,
              userId: scrapingUserId,
              icpProfileId: criteria.icpProfileId ?? null,
            },
          });
          listCreated = true;

          /*
           * ICP fit, judged for the whole batch before persisting.
           *
           * Separate from the lead score on purpose: the score says how much
           * opportunity a business represents, fit says whether it is the right
           * kind of customer at all. Batched because it is a short comparison
           * and one request per lead would dominate the run.
           *
           * Non-fatal — leads persist unscored for fit rather than not at all.
           */
          const fitByRef = new Map<string, { fit: number | null; reason: string }>();
          if (icpProfile) {
            try {
              const business = await buildBusinessContext(ctx);
              const sellerSummary = [
                business.businessName,
                business.description,
                business.products.map((p) => p.name).join(", "),
              ]
                .filter(Boolean)
                .join(" — ");

              const verdicts = await scoreFit(
                ctx,
                result.leads.map((lead, index) => ({
                  ref: String(index),
                  businessName: lead.businessName,
                  category: lead.category,
                  address: lead.address,
                  rating: lead.rating,
                  reviews: lead.reviews,
                })),
                icpProfile,
                { sellerSummary: sellerSummary || null }
              );
              for (const [ref, verdict] of verdicts) {
                fitByRef.set(ref, { fit: verdict.fit, reason: verdict.reason });
              }
            } catch (fitErr: any) {
              logger.warn(`ICP fit scoring skipped for this run: ${fitErr?.message || fitErr}`);
            }
          }

          // Insert leads one-by-one so a single bad row can't drop the batch.
          for (const [index, lead] of result.leads.entries()) {
            try {
              const fit = fitByRef.get(String(index));
              const created = await prisma.lead.create({
                data: {
                  ...appLeadToDbInput(lead, leadList.id, scrapingUserId),
                  tenantId: ctx.tenantId,
                  icpProfileId: criteria.icpProfileId ?? null,
                  ...(fit && fit.fit !== null
                    ? { icpFitScore: fit.fit, icpFitReason: fit.reason }
                    : {}),
                },
              });
              persistedCount++;

              // Point the dedupe record at the stored lead, so the history can
              // answer "which lead did this business become".
              const seen = seenThisRun.find((s) => s.businessName === lead.businessName);
              if (seen) (seen as any).leadId = created.id;
            } catch (leadErr: any) {
              logger.warn(`CRM: Skipped lead "${lead.businessName}" — ${leadErr.message}`);
            }
          }

          if (persistedCount === 0) {
            // Nothing stored: drop the empty list so it doesn't show as "0 leads".
            await prisma.leadList.delete({ where: { id: leadList.id } }).catch(() => {});
            listCreated = false;
          } else {
            logger.success(
              `CRM: Saved ${persistedCount}/${result.leads.length} leads to list "${listName}" (id: ${leadList.id})`
            );
          }
        } catch (dbErr: any) {
          logger.error(`CRM: Failed to persist leads to DB: ${dbErr.message}`);
        }

        // If the DB was entirely unavailable, fall back to the harvested count
        // so usage still reflects the leads delivered to the sheet/webhook.
        const chargeCount = listCreated ? persistedCount : result.leads.length;
        if (chargeCount > 0) await consumeLeads(scrapingUserId, chargeCount);
        await notificationService.notifyScraperComplete(scrapingUserId, result.leads.length);
      } else if (result) {
        await notificationService.notifyScraperComplete(scrapingUserId, 0);
      }

      /*
       * Write the run's sightings, including the businesses that were filtered
       * out. Remembering a rejection is what stops the next run spending four
       * page loads to reach the same conclusion, and it is why this records
       * everything examined rather than only what was kept.
       */
      if (seenThisRun.length > 0) {
        await recordManyDiscovered(
          ctx,
          seenThisRun.map((s) => ({
            businessName: s.businessName,
            address: s.address,
            phone: s.phone,
            category: s.category,
            leadId: (s as any).leadId ?? null,
          }))
        );
      }

      await finishJob(job.id, token.isCancelled ? "cancelled" : "completed", {
        result: {
          scannedCount: result.scannedCount,
          withoutWebsiteCount: result.withoutWebsiteCount,
          addedCount: result.addedCount,
          failedCount: result.failedCount,
          leadsFound: result.leads.length,
          leadsPersisted: persistedCount,
          scoringRuleSet: ruleSet.name,
          scoringVersion: ruleSet.version,
          scoreMax: ruleSet.maxScore,
          icpProfileId: criteria.icpProfileId ?? null,
          examined: seenThisRun.length,
          excluded: seenThisRun.filter((s) => !s.kept).length,
        },
      });
    } catch (error) {
      logger.error("Scraper crash in server-runner execution thread", error);
      await notificationService.notifyScraperError(
        scrapingUserId,
        (error as Error).message || "Unknown error"
      );
      await finishJob(job.id, "failed", { error: (error as Error).message || "Unknown error" });
    } finally {
      clearInterval(cancelPoll);
    }
  })
);

/**
 * POST /api/stop-scraper
 *
 * Cancels the caller's own run. Previously this flipped a process-global flag
 * and aborted whichever workspace's scrape happened to be in flight, with no
 * ownership check at all.
 */
app.post(
  "/api/stop-scraper",
  resolveTenantContext,
  requirePermission("RUN_LEAD_DISCOVERY"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : null;

    const target = jobId
      ? await getJob(ctx, jobId)
      : await getLatestJob(ctx, "lead_discovery");

    if (!target || isTerminal(target.status)) {
      return res.status(400).json({
        error: "No lead search is currently running for this workspace.",
        code: "no_active_job",
      });
    }

    const outcome = await requestJobCancellation(ctx, target.id);
    if (!outcome.ok) {
      return res.status(400).json({ error: "That run has already finished.", code: outcome.reason });
    }

    res.json({ success: true, message: "Stop requested.", jobId: target.id });
  })
);

app.post("/api/retry-failed", requireAuth, requireAdmin, async (req, res) => {
  try {
    let customWebhookUrl: string | undefined;
    const userId = req.authUser?.id;
    if (userId) {
      const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
      if (sheetConfig && sheetConfig.webhookUrl) {
        customWebhookUrl = sheetConfig.webhookUrl;
      }
    }
    const result = await retryFailedLeads(customWebhookUrl);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: "Failed to retry delivery." });
  }
});

app.post(
  "/api/test-webhook",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  asyncHandler(async (req, res) => {
  try {
    let customWebhookUrl: string | undefined;
    const ctx = ctxOf(req);
    const userId = ctx.userId;
    if (userId) {
      const sheetConfig = await getUserIntegration(userId, "google_sheet", ctx.tenantId) as any;
      if (sheetConfig && sheetConfig.webhookUrl) {
        customWebhookUrl = sheetConfig.webhookUrl;
      } else {
        return res.status(400).json({ success: false, error: "Please configure your Google Sheet integration first in settings." });
      }
    }

    const testLead: Lead = {
      businessName: "Test Lead (NexaLeadAi Verification)",
      phone: "+1 (555) 019-2831",
      address: "123 Diagnostic Lane, Silicon Valley, CA",
      rating: 4.9,
      reviews: 42,
      website: "",
      mapsUrl: "https://google.com/maps/test",
      category: "Software Testing",
      websiteMissing: true,
      leadScore: 95,
      dateAdded: new Date().toISOString(),
      websiteStatus: "MISSING",
      instagramUrl: "",
      instagramStatus: "NOT_FOUND",
      instagramLastPost: "",
      facebookUrl: "",
      facebookStatus: "NOT_FOUND",
      facebookLastPost: "",
      whatsappPresent: false,
      appointmentSystem: false,
      leadPriority: "HOT",
      aiInsight: "Excellent candidate for website creation and social presence.",
      emails: [],
      linkedinUrl: "",
      linkedinStatus: "NOT_FOUND",
      googleAnalyticsPresent: false,
      metaPixelPresent: false
    };
    
    const success = await sendLeadToWebhook(testLead, customWebhookUrl);
    if (success) {
      res.json({ success: true, message: "Webhook ping successful! Check your sheet for the test line." });
    } else {
      res.json({ success: false, error: "Authentication or setup error (status code 403 or server unreachable)." });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to issue test webhook call." });
  }
}));

/**
 * POST /api/clear-leads — forget this workspace's discovery history.
 *
 * Previously truncated the shared `processed-leads.json` and `failed-leads.json`
 * and cleared the process log, for every workspace at once, for any authenticated
 * caller. It now deletes only the caller's own discovered-business records, which
 * is what the button was for: letting a previously-seen business be found again.
 *
 * Requires DELETE_LEADS rather than a lesser permission because the effect is
 * destructive to the workspace's own history, and `member` should not be able to
 * make a run re-harvest and re-charge quota for businesses already seen.
 */
app.post(
  "/api/clear-leads",
  resolveTenantContext,
  requirePermission("DELETE_LEADS"),
  asyncHandler(async (req, res) => {
    const cleared = await clearDiscovered(ctxOf(req));
    res.json({
      success: true,
      cleared,
      message: `Forgot ${cleared} previously discovered business${cleared === 1 ? "" : "es"}.`,
    });
  })
);

async function updateLeadOutreachStatus(businessName: string, channel: "email" | "whatsapp", status: "SENT" | "FAILED", mapsUrl?: string, customWebhookUrl?: string) {
  try {
    // Serialize local file updates so concurrent sends don't clobber each other.
    const targetLead = await withLock("processed-leads", () => {
      const leads = duplicateChecker.loadLeads();
      let found: any = null;
      const updated = leads.map(lead => {
        if (lead.businessName === businessName || (mapsUrl && lead.mapsUrl === mapsUrl)) {
          found = lead;
          if (channel === "email") {
            lead.emailStatus = status;
            lead.emailSentDate = new Date().toISOString().split("T")[0];
          } else if (channel === "whatsapp") {
            lead.whatsappStatus = status;
            lead.whatsappSentDate = new Date().toISOString().split("T")[0];
          }
        }
        return lead;
      });
      const processedPath = path.join(process.cwd(), "processed-leads.json");
      writeJsonAtomic(processedPath, updated);
      return found;
    });

    // Sync back to Google Sheet
    const webhookUrl = customWebhookUrl || process.env.GOOGLE_SHEET_WEBHOOK_URL;
    if (webhookUrl && webhookUrl.trim() !== "" && webhookUrl !== "YOUR_WEBHOOK_URL") {
      try {
        const payload = {
          action: "updateOutreach",
          businessName,
          mapsUrl: mapsUrl || (targetLead ? targetLead.mapsUrl : ""),
          emailStatus: channel === "email" ? status : undefined,
          emailSentDate: channel === "email" ? new Date().toISOString().split("T")[0] : undefined,
          whatsappStatus: channel === "whatsapp" ? status : undefined,
          whatsappSentDate: channel === "whatsapp" ? new Date().toISOString().split("T")[0] : undefined
        };
        const axios = (await import("axios")).default;
        const response = await axios.post(webhookUrl, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 8000
        });
        
        let responseData = response.data;
        if (typeof responseData === "string") {
          try {
            responseData = JSON.parse(responseData);
          } catch (e) {
            // Ignore parse errors if it's not JSON
          }
        }
        if (responseData && typeof responseData === "object" && responseData.status === "error") {
          throw new Error(`Google Apps Script error: ${responseData.message}`);
        }
        
        logger.success(`Synchronized outreach status for '${businessName}' back to Google Sheet.`);
      } catch (err: any) {
        logger.warn(`Failed to sync outreach status back to Google Sheet: ${err.message || err}`);
      }
    }
  } catch (error) {
    console.error("Failed to update outreach status:", error);
  }
}

// Legacy SMTP compatibility endpoints now read and write only the signed-in
// user's encrypted integration. They never expose or mutate process-wide .env.
app.get(
  "/api/config/smtp",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  asyncHandler(async (req, res) => {
    const smtp = await getUserIntegration(ctxOf(req).userId, "smtp", ctxOf(req).tenantId) as any;
    res.json({
      host: smtp?.host || "",
      port: String(smtp?.port || 587),
      user: smtp?.user || "",
      from: smtp?.fromEmail || "",
      hasPassword: !!smtp?.password,
    });
  })
);

app.post(
  "/api/config/smtp",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { host, port, user, pass, from } = req.body || {};
    if (!host || !user || !from) {
      return res.status(400).json({ error: "SMTP host, user and sender email are required." });
    }

    const existing = await getUserIntegration(ctx.userId, "smtp", ctx.tenantId) as any;
    const password = pass && !String(pass).includes("•") ? String(pass) : existing?.password;
    if (!password) return res.status(400).json({ error: "SMTP password is required." });

    await saveUserIntegration(ctx.userId, "smtp", {
      host: String(host).trim(),
      port: Number(port) || 587,
      secure: Number(port) === 465,
      user: String(user).trim(),
      password,
      fromEmail: String(from).trim(),
    }, "SMTP", ctx.tenantId);
    res.json({ success: true, message: "SMTP configuration updated successfully." });
  })
);

// Tenant dashboards use the official per-user Cloud API integration. The
// legacy WhatsApp Web client has one process-global session and is therefore
// disabled here; sharing it would let one workspace affect another.
app.get(
  "/api/whatsapp/status",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const userId = ctx.userId;
    const { provider } = await resolveWhatsAppProvider(userId, ctx.tenantId);
    if (provider !== "cloud") {
      return res.json({
        status: "DISCONNECTED",
        qr: "",
        provider: "web",
        error: "The shared WhatsApp Web gateway is disabled for tenant isolation. Configure WhatsApp Cloud API in Integrations.",
      });
    }
    res.json(await getUnifiedWhatsAppStatus(userId, ctx.tenantId));
  })
);

app.post(
  "/api/whatsapp/initialize",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  (_req, res) => res.status(410).json({
    error: "The shared WhatsApp Web gateway is disabled. Configure WhatsApp Cloud API in Integrations.",
    code: "legacy_provider_disabled",
  })
);

app.post(
  "/api/whatsapp/disconnect",
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  (_req, res) => res.status(410).json({
    error: "Manage the tenant's WhatsApp Cloud API connection in Integrations.",
    code: "legacy_provider_disabled",
  })
);

app.post(
  "/api/whatsapp/send-test",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("MANAGE_INTEGRATIONS"),
  requireFeature("whatsappOutreach", "WhatsApp outreach"),
  asyncHandler(async (req, res) => {
    const { phone } = req.body || {};
    const ctx = ctxOf(req);
    const userId = ctx.userId;
    const { provider } = await resolveWhatsAppProvider(userId, ctx.tenantId);
    if (provider !== "cloud") {
      return res.status(410).json({ error: "Configure WhatsApp Cloud API before sending a test.", code: "legacy_provider_disabled" });
    }
    if (!phone) return res.status(400).json({ error: "Enter a destination number to test the Cloud API." });

    const result = await sendWhatsAppUnified(String(phone), "Test message from NexaLeadAi.", {
      userId,
      tenantId: ctx.tenantId,
      allowTemplateFallback: true,
    });
    if (result.ok) return res.json({ success: true, message: "Test message sent successfully.", provider });
    return res.status(500).json({ error: result.error || "Failed to send test message." });
  })
);

// Geocoding Proxy endpoints
app.get("/api/geocode/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query parameter 'q'." });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(String(q))}&format=json&limit=5`, {
      headers: {
        "User-Agent": "NexaLeadAi-Agent/1.0"
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get("/api/geocode/reverse", async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "Missing 'lat' or 'lon' parameters." });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: {
        "User-Agent": "NexaLeadAi-Agent/1.0"
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /api/reset-data — operator-only wipe of the deployment-wide JSON stores.
 *
 * Truncates files shared by every workspace and stops whatever campaign is
 * running, so it is destructive across tenants by construction. It was reachable
 * by any authenticated user; it now requires admin.
 *
 * A tenant wanting to reset their own state wants POST /api/clear-leads, which is
 * scoped to their workspace.
 */
app.post("/api/reset-data", requireAuth, requireAdmin, (req, res) => {
  try {
    const processedPath = path.join(process.cwd(), "processed-leads.json");
    const failedPath = path.join(process.cwd(), "failed-leads.json");
    const scraperLogPath = path.join(process.cwd(), "scraper-log.txt");

    writeJsonAtomic(processedPath, []);
    writeJsonAtomic(failedPath, []);
    fs.writeFileSync(scraperLogPath, "NexaLeadAi System reset successfully.\nReady.", "utf8");
    
    logger.clear();
    logger.success("Dashboard database has been completely wiped and reset!");

    // Also stop active campaign if running
    isCampaignRunning = false;
    campaignCancelRequested = true;

    res.json({ success: true, message: "System data completely reset." });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to reset system data." });
  }
});

/**
 * Records a MANUAL outreach send (from the Lead Outreach Console) so it is
 * tracked everywhere a campaign send would be:
 *  - updates the Prisma CRM lead's email/whatsapp status (when a leadId is
 *    known), so the Leads table reflects "SENT" immediately;
 *  - appends a dispatch-history record so it shows in the report + charts.
 * Best-effort and non-fatal — never blocks the send response.
 */
async function trackManualOutreach(
  ctx: TenantContext,
  params: {
    leadId: string;
    channel: "email" | "whatsapp";
    status: "SENT" | "FAILED";
    recipient: string;
    subject?: string;
    body: string;
    externalMessageId?: string;
    errorMessage?: string;
  }
) {
  const data: Record<string, unknown> = {};
  if (params.channel === "email") {
    data.emailStatus = params.status;
    data.emailSentDate = new Date().toISOString().split("T")[0];
  } else {
    data.whatsappStatus = params.status;
    data.whatsappSentDate = new Date().toISOString().split("T")[0];
  }

  await tenantRepo.updateLead(ctx, params.leadId, data);
  const lead = await prisma.lead.findFirst({
    where: { id: params.leadId, tenantId: ctx.tenantId },
    select: { businessName: true, phone: true, emails: true },
  });
  const businessName = lead?.businessName || "Manual outreach";

  await recordDispatch({
    tenantId: ctx.tenantId,
    leadId: params.leadId,
    businessName,
    recipient: params.recipient,
    channel: params.channel,
    status: params.status,
    sourceType: "manual",
    sourceLabel: "Manual outreach",
    subject: params.subject,
    messageSnippet: params.body,
    externalMessageId: params.externalMessageId,
    errorMessage: params.errorMessage,
  });

  if (params.status === "SENT") {
    await recordOutbound({
      tenantId: ctx.tenantId,
      channel: params.channel,
      email: params.channel === "email" ? params.recipient : undefined,
      phone: params.channel === "whatsapp" ? params.recipient : undefined,
      leadId: params.leadId,
      businessName,
      text: params.body,
      source: "manual",
      provider: params.channel === "email" ? "smtp" : "whatsapp",
      providerMessageId: params.externalMessageId,
    });
  }
}

/**
 * Resolve an inbound WhatsApp reply to a lead and record it as a conversation.
 * Registered once at startup; runs whenever a lead messages back.
 */
setIncomingWhatsAppHandler(async ({ from }) => {
  // The legacy WhatsApp Web callback carries no tenant identity. Persisting or
  // matching it would be an unscoped cross-workspace operation, so reject it.
  logger.warn(`Ignored inbound legacy WhatsApp Web message from ${normalizePhoneKey(from) || "unknown"}: no tenant identity.`);
});

// ── Tenant-owned conversations (Inbox) ──
app.get(
  "/api/conversations",
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => res.json(await listConversations(ctxOf(req))))
);

app.get(
  "/api/conversations/:id",
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => {
    const conversation = await getConversation(ctxOf(req), req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversation not found.", code: "not_found" });
    res.json({ conversation });
  })
);

app.post(
  "/api/conversations/:id/reply",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const conversation = await getConversation(ctx, req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversation not found.", code: "not_found" });

    const text = String(req.body?.text || "").trim();
    if (!text || text.length > 10_000) {
      return res.status(400).json({ error: "Reply text must be between 1 and 10,000 characters." });
    }

    let provider = "manual";
    let providerMessageId: string | undefined;
    if (conversation.channel === "email") {
      if (!conversation.email) return res.status(400).json({ error: "This conversation has no email recipient." });
      const smtp = await getUserIntegration(ctx.userId, "smtp", ctx.tenantId) as any;
      if (!smtp?.host || !smtp?.user || !smtp?.password) {
        return res.status(400).json({ error: "Email is not configured for this workspace." });
      }
      const result = await sendEmailOutreach(conversation.email, "Re: your enquiry", text, {
        host: smtp.host,
        port: Number(smtp.port) || 587,
        secure: Boolean(smtp.secure),
        user: smtp.user,
        pass: smtp.password,
        from: smtp.fromName || smtp.fromEmail || smtp.user,
      });
      if (!result.success) return res.status(502).json({ error: result.error || "Failed to send email reply." });
      provider = "smtp";
    } else {
      if (!conversation.phone) return res.status(400).json({ error: "This conversation has no phone recipient." });
      const result = await sendWhatsAppUnified(conversation.phone, text, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        allowTemplateFallback: false,
      });
      if (!result.ok) return res.status(502).json({ error: result.error || "Failed to send WhatsApp reply." });
      provider = result.provider;
      providerMessageId = result.messageId;
    }

    const updated = await recordOutbound({
      tenantId: ctx.tenantId,
      channel: conversation.channel,
      email: conversation.email,
      phone: conversation.phone,
      leadId: conversation.leadId,
      businessName: conversation.businessName,
      text,
      source: "manual_reply",
      provider,
      providerMessageId,
    });
    res.json({ conversation: updated });
  })
);

app.post(
  "/api/conversations/:id/read",
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => {
    const conversation = await markConversationRead(ctxOf(req), req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversation not found.", code: "not_found" });
    res.json({ conversation });
  })
);

app.patch(
  "/api/conversations/:id/status",
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  asyncHandler(async (req, res) => {
    const conversation = await setConversationStatus(ctxOf(req), req.params.id, req.body?.status);
    if (!conversation) return res.status(404).json({ error: "Conversation not found.", code: "not_found" });
    res.json({ conversation });
  })
);

app.delete(
  "/api/conversations/:id",
  resolveTenantContext,
  requirePermission("DELETE_LEADS"),
  asyncHandler(async (req, res) => {
    if (!await deleteConversation(ctxOf(req), req.params.id)) {
      return res.status(404).json({ error: "Conversation not found.", code: "not_found" });
    }
    res.json({ success: true });
  })
);

// ── Email reply ingestion (IMAP polling) ──
// Watches every configured sending mailbox for new messages. When a lead
// replies by email, it is matched to a CRM lead, recorded as a conversation,
// and the lead's status flips to REPLIED — mirroring the WhatsApp reply path.
async function getPollableMailboxes(): Promise<ImapMailbox[]> {
  const mailboxes: ImapMailbox[] = [];

  // Only tenant-owned SMTP integrations are polled. A platform environment
  // mailbox has no workspace identity and cannot be matched safely.
  try {
    const smtpConfigs = await getAllEnabledSmtpConfigs();
    for (const cfg of smtpConfigs) {
      const imapHost = deriveImapHost(cfg.host);
      if (cfg.tenantId && imapHost && cfg.user && cfg.password) {
        mailboxes.push({
          id: `${cfg.tenantId}:${cfg.user.toLowerCase()}`,
          tenantId: cfg.tenantId,
          host: imapHost,
          port: 993,
          secure: true,
          user: cfg.user,
          pass: cfg.password,
        });
      }
    }
  } catch (err: any) {
    logger.warn(`Email poller: failed to enumerate SMTP integrations: ${err?.message || err}`);
  }

  return mailboxes;
}

startEmailReplyPolling(
  getPollableMailboxes,
  async ({ tenantId, from, fromName, subject, text, messageId }) => {
    if (!tenantId) return;
    try {
      // The mailbox identifies the workspace, so sender matching cannot cross
      // into another tenant with the same prospect email.
      const lead = await prisma.lead.findFirst({
        where: { tenantId, emails: { contains: from } },
      }).catch(() => null);

      if (lead?.id) {
        await prisma.lead.update({ where: { id: lead.id }, data: { conversationStatus: "REPLIED" } }).catch(() => {});
        logger.success(`Email reply received for tenant ${tenantId} from ${from}.`);
      }

      await recordInbound({
        tenantId,
        channel: "email",
        email: from,
        leadId: lead?.id,
        businessName: lead?.businessName || fromName || from,
        text: subject ? `${subject}\n\n${text}` : text,
        source: "imap",
        provider: "imap",
        providerMessageId: messageId,
      });
    } catch (err: any) {
      logger.warn(`Failed to handle tenant email reply: ${err?.message || err}`);
    }
  },
  Number(process.env.EMAIL_POLL_INTERVAL_MS) || 60000
);

// Outreach execution endpoints. Every action requires an owned CRM lead; a
// caller cannot send or mutate status by naming another tenant's lead id.
app.post(
  "/api/send-email",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { to, subject, body, leadId } = req.body || {};
    if (!leadId || !to || !subject || !body) {
      return res.status(400).json({ error: "Missing parameters (leadId, to, subject, body)" });
    }
    if (!await tenantRepo.findLead(ctx, String(leadId))) {
      return res.status(404).json({ error: "Lead not found.", code: "not_found" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(to))) {
      return res.status(400).json({ error: "Invalid recipient email address." });
    }

    let userSmtpConfig: any = undefined;
    const smtpConfig = await getUserIntegration(ctx.userId, "smtp", ctx.tenantId) as any;
    if (smtpConfig?.host && smtpConfig?.user && smtpConfig?.password) {
      userSmtpConfig = {
        host: smtpConfig.host,
        port: Number(smtpConfig.port) || 587,
        secure: Boolean(smtpConfig.secure),
        user: smtpConfig.user,
        pass: smtpConfig.password,
        from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>` : smtpConfig.fromEmail,
      };
    }

    const result = await sendEmailOutreach(String(to), String(subject), String(body), userSmtpConfig);
    await trackManualOutreach(ctx, {
      leadId: String(leadId),
      channel: "email",
      status: result.success ? "SENT" : "FAILED",
      recipient: String(to),
      subject: String(subject),
      body: String(body),
      errorMessage: result.error,
    });
    if (result.success) return res.json({ success: true, message: "Email sent successfully." });
    return res.status(500).json({ error: result.error || "Failed to send email." });
  })
);

app.post(
  "/api/send-whatsapp",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  requireFeature("whatsappOutreach", "WhatsApp outreach"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { phone, message, leadId } = req.body || {};
    if (!leadId || !phone || !message) {
      return res.status(400).json({ error: "Missing parameters (leadId, phone, message)" });
    }
    if (!await tenantRepo.findLead(ctx, String(leadId))) {
      return res.status(404).json({ error: "Lead not found.", code: "not_found" });
    }

    const result = await sendWhatsAppUnified(String(phone), String(message), { userId: ctx.userId, tenantId: ctx.tenantId });
    await trackManualOutreach(ctx, {
      leadId: String(leadId),
      channel: "whatsapp",
      status: result.ok ? "SENT" : "FAILED",
      recipient: String(phone),
      body: String(message),
      externalMessageId: result.messageId,
      errorMessage: result.error,
    });
    if (result.ok) {
      return res.json({ success: true, message: "WhatsApp message sent successfully.", provider: result.provider });
    }
    return res.status(500).json({
      error: result.error || "Failed to send WhatsApp message.",
      requiresTemplate: result.requiresTemplate,
    });
  })
);

app.post(
  "/api/generate-copy",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => {
    const submitted = req.body?.lead;
    if (!submitted?.id) return res.status(400).json({ error: "A saved lead is required." });

    const rows = await tenantRepo.findLeadsInWorkspace(ctxOf(req), { id: String(submitted.id) }, { createdAt: "desc" });
    const lead = rows[0] ? dbLeadToAppLead(rows[0]) : null;
    if (!lead) return res.status(404).json({ error: "Lead not found.", code: "not_found" });

    const ent = entOf(req);
    const copy = ent.aiInsights ? await generateAICopy(lead) : generateOutreachCopy(lead);
    res.json(copy);
  })
);

// Campaign variables
let isCampaignRunning = false;
let activeCampaignTenantId: string | null = null;
let campaignCancelRequested = false;
let campaignProgress = {
  current: 0,
  total: 0,
  status: "Idle",
  secondsRemaining: 0,
  emailsSent: 0,
  emailsFailed: 0,
  whatsappSent: 0,
  whatsappFailed: 0,
  skipped: 0
};

export interface CampaignSource {
  /** "sheet" = legacy Google Sheet source; "list" = Prisma CRM lead list. */
  type: "sheet" | "list";
  sheetName?: string;
  listId?: string;
}

export interface CampaignFilters {
  /** Restrict to these priorities only. Empty/undefined = all priorities. */
  priorities?: ("HOT" | "WARM" | "COLD")[];
  /** Only include leads that have never received this channel (default true semantics preserved). */
  skipAlreadySent?: boolean;
}

export interface CampaignTemplateSelection {
  email?: OutreachTemplate | null;
  whatsapp?: OutreachTemplate | null;
}

/**
 * Resolve the lead pool for a campaign from either a Google Sheet tab or a
 * saved Prisma CRM lead list, and apply the priority/outreach-status filters.
 * Kept isolated from the send loop so the "preview" endpoint can reuse it.
 */
async function resolveCampaignLeads(
  ctx: TenantContext,
  source: CampaignSource,
  filters: CampaignFilters,
  enableEmail: boolean,
  enableWhatsapp: boolean,
  webhookUrl?: string
): Promise<{ leads: Lead[]; error?: string }> {
  let leads: Lead[] = [];

  if (source.type === "list") {
    if (!source.listId) return { leads: [], error: "No lead list selected." };
    const dbLeads = await tenantRepo.findLeadsInList(ctx, source.listId, {}, { leadScore: "desc" });
    if (dbLeads === null) return { leads: [], error: "Lead list not found." };
    if (dbLeads.length === 0) {
      return { leads: [], error: "The selected lead list has no leads." };
    }
    leads = dbLeads.map((l: any) => dbLeadToAppLead(l));
  } else {
    if (!webhookUrl) return { leads: [], error: "Google Sheet is not configured." };
    const sheetLeads = await fetchLeadsFromGoogleSheet(source.sheetName, webhookUrl);
    if (!sheetLeads || sheetLeads.length === 0) {
      return { leads: [], error: "Failed to fetch leads from Google Sheet, or the sheet is empty." };
    }
    leads = sheetLeads;
  }

  const priorities = filters.priorities && filters.priorities.length > 0 ? new Set(filters.priorities) : null;
  const skipSent = filters.skipAlreadySent !== false; // default true

  const targetLeads = leads.filter((lead) => {
    if (priorities && !priorities.has(lead.leadPriority)) return false;
    const needsEmail = enableEmail && lead.emails && lead.emails.length > 0 && (!skipSent || lead.emailStatus !== "SENT");
    const needsWhatsapp = enableWhatsapp && !!lead.phone && (!skipSent || lead.whatsappStatus !== "SENT");
    return needsEmail || needsWhatsapp;
  });

  return { leads: targetLeads };
}

/** Persist outreach status back to whichever source the campaign is using. */
async function markCampaignOutreach(
  ctx: TenantContext,
  source: CampaignSource,
  lead: Lead,
  channel: "email" | "whatsapp",
  status: "SENT" | "FAILED",
  webhookUrl?: string
) {
  if (source.type === "list" && lead.id) {
    const data: any = {};
    if (channel === "email") {
      data.emailStatus = status;
      data.emailSentDate = new Date().toISOString().split("T")[0];
    } else {
      data.whatsappStatus = status;
      data.whatsappSentDate = new Date().toISOString().split("T")[0];
    }
    await tenantRepo.updateLead(ctx, lead.id, data).catch((err) => {
      logger.warn(`Campaign: failed to update CRM lead status for '${lead.businessName}': ${err.message || err}`);
    });
  } else {
    await updateLeadOutreachStatus(lead.businessName, channel, status, lead.mapsUrl, webhookUrl);
  }
}

async function runCampaignLoop(
  ctx: TenantContext,
  delaySeconds = 30,
  enableEmail = true,
  enableWhatsapp = true,
  dryRun = false,
  source: CampaignSource = { type: "sheet" },
  filters: CampaignFilters = {},
  templates: CampaignTemplateSelection = {},
  useAiInsights = true,
  campaignUserId?: string,
  campaignId = `camp_${Date.now()}`
) {
  // Deployment-global campaign-history.json is intentionally not written from
  // tenant campaigns. Durable reporting resumes when history has tenant-owned
  // database storage; status remains available through this workspace's job UI.
  const logDispatch = (..._args: unknown[]) => {};
  let webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  let userSmtpConfig: any = undefined;
  if (campaignUserId) {
    const sheetConfig = await getUserIntegration(campaignUserId, "google_sheet", ctx.tenantId) as any;
    if (sheetConfig && sheetConfig.webhookUrl) {
      webhookUrl = sheetConfig.webhookUrl;
    } else if (source.type === "sheet") {
      logger.error("Outreach campaign aborted: Custom Google Sheet integration is not configured for the user.");
      campaignProgress.status = "Aborted: Google Sheet not configured";
      isCampaignRunning = false;
      return;
    }

    const smtpConfig = await getUserIntegration(campaignUserId, "smtp", ctx.tenantId) as any;
    if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.password) {
      userSmtpConfig = {
        host: smtpConfig.host,
        port: Number(smtpConfig.port) || 587,
        secure: Boolean(smtpConfig.secure),
        user: smtpConfig.user,
        pass: smtpConfig.password,
        from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>` : smtpConfig.fromEmail
      };
    }
  }

  // Google Sheet is only required when the campaign source IS the sheet.
  if (source.type === "sheet") {
    const isSheetConfigured = webhookUrl && webhookUrl.trim() !== "" && webhookUrl !== "YOUR_WEBHOOK_URL";
    if (!isSheetConfigured) {
      logger.error("Outreach campaign aborted: Google Sheet Webhook URL is not configured.");
      campaignProgress.status = "Aborted: Google Sheet not configured";
      isCampaignRunning = false;
      return;
    }
  }

  const host = userSmtpConfig ? userSmtpConfig.host : (process.env.SMTP_HOST || "");
  const user = userSmtpConfig ? userSmtpConfig.user : (process.env.SMTP_USER || "");
  const pass = userSmtpConfig ? userSmtpConfig.pass : (process.env.SMTP_PASS || "");
  const emailAvailable = !!(host && user && pass);

  // Resolve the campaign's WhatsApp transport once, up front. Cloud API users
  // have no QR session, so the web client's state must not gate their campaign.
  const waProvider = await resolveWhatsAppProvider(campaignUserId, ctx.tenantId);
  const waStatusObj = await getUnifiedWhatsAppStatus(campaignUserId, ctx.tenantId);
  const whatsappAvailable = waStatusObj.status === "CONNECTED";
  const waProviderLabel = waProvider.provider === "cloud" ? "WhatsApp Cloud API" : "WhatsApp Web gateway";

  if (!dryRun) {
    if (enableEmail && !emailAvailable) {
      logger.error("Outreach campaign aborted: Email outreach is active but SMTP is not configured in settings.");
      campaignProgress.status = "Aborted: SMTP not configured";
      isCampaignRunning = false;
      return;
    }
    if (enableWhatsapp && !whatsappAvailable) {
      logger.error(
        `Outreach campaign aborted: WhatsApp outreach is active but the ${waProviderLabel} is not connected.` +
          (waProvider.provider === "cloud" && waStatusObj.cloud?.error ? ` (${waStatusObj.cloud.error})` : "")
      );
      campaignProgress.status = "Aborted: WhatsApp not connected";
      isCampaignRunning = false;
      return;
    }
    if (!enableEmail && !enableWhatsapp) {
      logger.error("Outreach campaign aborted: Neither Email nor WhatsApp channel is enabled for delivery.");
      campaignProgress.status = "Aborted: No channels active";
      isCampaignRunning = false;
      return;
    }
  }

  campaignProgress.status = source.type === "list" ? "Loading leads from selected list..." : "Fetching leads from Google Sheet...";
  const { leads: targetLeads, error: resolveError } = await resolveCampaignLeads(
    ctx,
    source,
    filters,
    enableEmail,
    enableWhatsapp,
    webhookUrl
  );

  if (resolveError) {
    logger.error(`Outreach campaign aborted: ${resolveError}`);
    campaignProgress.status = `Aborted: ${resolveError}`;
    isCampaignRunning = false;
    return;
  }

  campaignProgress.total = targetLeads.length;
  campaignProgress.current = 0;
  campaignProgress.emailsSent = 0;
  campaignProgress.emailsFailed = 0;
  campaignProgress.whatsappSent = 0;
  campaignProgress.whatsappFailed = 0;
  campaignProgress.skipped = 0;

  if (targetLeads.length === 0) {
    campaignProgress.status = "Completed (No pending leads found)";
    logger.info("Outreach campaign completed: No pending leads found requiring outreach.");
    isCampaignRunning = false;
    return;
  }

  campaignProgress.status = dryRun ? "Running (Simulation Mode)" : "Running";
  logger.info(`Starting automated outreach campaign (${dryRun ? "SIMULATION" : "LIVE"}) for ${targetLeads.length} leads...`);

  for (let i = 0; i < targetLeads.length; i++) {
    if (campaignCancelRequested) {
      logger.warn("Outreach campaign cancelled by user.");
      campaignProgress.status = "Cancelled";
      break;
    }

    const lead = targetLeads[i];
    campaignProgress.current = i + 1;
    campaignProgress.status = `Processing lead ${i + 1}/${targetLeads.length}: ${lead.businessName}`;
    logger.info(`Campaign dispatching lead ${i + 1}/${targetLeads.length}: ${lead.businessName}`);

    // Advanced AI copy is Pro-only; Free plans use the rule-based generator.
    // Only pay for AI generation when a channel actually needs an AI body
    // (either no template selected, or the selected template relies on AI).
    const emailNeedsAi = !templates.email || templateNeedsAiBody(templates.email);
    const whatsappNeedsAi = !templates.whatsapp || templateNeedsAiBody(templates.whatsapp);
    const copy = (emailNeedsAi || whatsappNeedsAi)
      ? (useAiInsights ? await generateAICopy(lead) : generateOutreachCopy(lead))
      : { emailSubject: "", emailBody: "", whatsappMessage: "" };

    // Compile the final subject/body per channel: apply the selected template
    // (substituting lead variables) with the AI copy injected where the
    // template needs an AI-generated body; otherwise use the AI copy directly.
    const emailSubject = templates.email
      ? compileTemplateSubject(templates.email, lead, copy.emailSubject)
      : copy.emailSubject;
    const emailBody = templates.email
      ? compileTemplateText(templates.email, lead, copy.emailBody)
      : copy.emailBody;
    const whatsappMessage = templates.whatsapp
      ? compileTemplateText(templates.whatsapp, lead, copy.whatsappMessage)
      : copy.whatsappMessage;

    let skippedLead = true;

    // Send Email
    const recipient = lead.emails && lead.emails.length > 0 ? lead.emails[0] : "";
    if (enableEmail && recipient && lead.emailStatus !== "SENT") {
      skippedLead = false;
      if (dryRun) {
        logger.info(`[SIMULATION] Email would be sent to ${lead.businessName} (${recipient}) with subject: "${emailSubject}"`);
        campaignProgress.emailsSent++;
        logDispatch("email", "SENT", lead, recipient, emailSubject, emailBody);
      } else {
        if (emailAvailable) {
          logger.info(`Campaign sending email to ${lead.businessName} (${recipient})...`);
          const emailResult = await sendEmailOutreach(recipient, emailSubject, emailBody, userSmtpConfig);
          if (emailResult.success) {
            await markCampaignOutreach(ctx, source, lead, "email", "SENT", webhookUrl);
            campaignProgress.emailsSent++;
            logDispatch("email", "SENT", lead, recipient, emailSubject, emailBody);
          } else {
            await markCampaignOutreach(ctx, source, lead, "email", "FAILED", webhookUrl);
            campaignProgress.emailsFailed++;
            logDispatch("email", "FAILED", lead, recipient, emailSubject, emailResult.error);
          }
        } else {
          logger.warn(`Skipping Email for '${lead.businessName}': SMTP parameters are not configured in settings.`);
          await markCampaignOutreach(ctx, source, lead, "email", "FAILED", webhookUrl);
          campaignProgress.emailsFailed++;
          logDispatch("email", "FAILED", lead, recipient, emailSubject, "SMTP not configured");
        }
      }
    }

    // Send WhatsApp
    if (enableWhatsapp && lead.phone && lead.whatsappStatus !== "SENT") {
      skippedLead = false;
      if (dryRun) {
        logger.info(`[SIMULATION] WhatsApp message would be sent to ${lead.businessName} (${lead.phone})`);
        campaignProgress.whatsappSent++;
        logDispatch("whatsapp", "SENT", lead, lead.phone, undefined, whatsappMessage);
      } else {
        if (whatsappAvailable) {
          logger.info(`Campaign sending WhatsApp to ${lead.businessName} (${lead.phone}) via ${waProviderLabel}...`);
          const sendResult = await sendWhatsAppUnified(lead.phone, whatsappMessage, {
            userId: campaignUserId,
            tenantId: ctx.tenantId,
            allowTemplateFallback: true,
          });
          if (sendResult.ok) {
            await markCampaignOutreach(ctx, source, lead, "whatsapp", "SENT", webhookUrl);
            campaignProgress.whatsappSent++;
            logDispatch("whatsapp", "SENT", lead, lead.phone, undefined, whatsappMessage);
          } else {
            await markCampaignOutreach(ctx, source, lead, "whatsapp", "FAILED", webhookUrl);
            campaignProgress.whatsappFailed++;
            logDispatch("whatsapp", "FAILED", lead, lead.phone, undefined, sendResult.error || "Delivery failed");
          }
        } else {
          logger.warn(`Skipping WhatsApp for '${lead.businessName}': the ${waProviderLabel} is not connected.`);
          await markCampaignOutreach(ctx, source, lead, "whatsapp", "FAILED", webhookUrl);
          campaignProgress.whatsappFailed++;
          logDispatch("whatsapp", "FAILED", lead, lead.phone, undefined, "WhatsApp gateway not connected");
        }
      }
    }

    if (skippedLead) {
      campaignProgress.skipped++;
    }

    // Wait delaySeconds seconds
    if (i < targetLeads.length - 1 && !campaignCancelRequested) {
      logger.info(`Time gap: Waiting ${delaySeconds} seconds before dispatching the next lead...`);
      for (let sec = delaySeconds; sec > 0; sec--) {
        if (campaignCancelRequested) break;
        campaignProgress.secondsRemaining = sec;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      campaignProgress.secondsRemaining = 0;
    }
  }

  if (!campaignCancelRequested) {
    campaignProgress.status = "Completed";
    logger.success(`Automated outreach campaign successfully completed! (${dryRun ? "Simulation" : "Live"})`);
    // Notify user of campaign completion
    if (campaignUserId) {
      await notificationService.notifyCampaignComplete(campaignUserId, {
        sent: campaignProgress.emailsSent + campaignProgress.whatsappSent,
        failed: campaignProgress.emailsFailed + campaignProgress.whatsappFailed,
      });
    }
  }
  isCampaignRunning = false;
  if (activeCampaignTenantId === ctx.tenantId) activeCampaignTenantId = null;
  campaignCancelRequested = false;
}

app.get(
  "/api/campaign/status",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  (req, res) => {
    const ownsActiveCampaign = isCampaignRunning && activeCampaignTenantId === ctxOf(req).tenantId;
    res.json({
      isRunning: ownsActiveCampaign,
      progress: ownsActiveCampaign ? campaignProgress : {
        current: 0,
        total: 0,
        status: "Idle",
        secondsRemaining: 0,
        emailsSent: 0,
        emailsFailed: 0,
        whatsappSent: 0,
        whatsappFailed: 0,
        skipped: 0,
      },
    });
  }
);

app.get(
  "/api/campaign/sheets",
  resolveTenantContext,
  requirePermission("VIEW_LEADS"),
  asyncHandler(async (req, res) => {
  try {
    const sheetConfig = await getUserIntegration(ctxOf(req).userId, "google_sheet", ctxOf(req).tenantId) as any;
    if (!sheetConfig?.webhookUrl) return res.json([]);
    const sheets = await fetchSheetNamesFromGoogleSheet(sheetConfig.webhookUrl);
    res.json(sheets);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch Google Sheet tabs list." });
  }
  })
);

/**
 * Normalize the request body into a CampaignSource + CampaignFilters +
 * CampaignTemplateSelection triple. Shared by /preview and /start so the
 * wizard's "review" step and the actual launch see identical lead counts.
 */
function parseCampaignRequest(body: any): {
  source: CampaignSource;
  filters: CampaignFilters;
  templates: CampaignTemplateSelection;
} {
  const listId = typeof body.listId === "string" && body.listId.trim() ? body.listId.trim() : undefined;
  const sheetName = typeof body.sheetName === "string" ? body.sheetName : undefined;
  const source: CampaignSource = listId ? { type: "list", listId } : { type: "sheet", sheetName };

  const rawPriorities = Array.isArray(body.priorities) ? body.priorities : null;
  const priorities = rawPriorities
    ? rawPriorities.filter((p: any) => p === "HOT" || p === "WARM" || p === "COLD")
    : undefined;

  const filters: CampaignFilters = {
    priorities: priorities && priorities.length > 0 ? priorities : undefined,
    skipAlreadySent: body.skipAlreadySent !== undefined ? Boolean(body.skipAlreadySent) : true,
  };

  const templates: CampaignTemplateSelection = {
    email: body.emailTemplate && typeof body.emailTemplate === "object" ? body.emailTemplate : null,
    whatsapp: body.whatsappTemplate && typeof body.whatsappTemplate === "object" ? body.whatsappTemplate : null,
  };

  return { source, filters, templates };
}

/**
 * POST /api/campaign/preview
 * Resolves the lead pool for the given source/filters WITHOUT sending
 * anything — lets the wizard's "Review" step show an accurate target count
 * and a sample of leads before the user commits to launching.
 */
app.post(
  "/api/campaign/preview",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("CREATE_CAMPAIGN"),
  asyncHandler(async (req, res) => {
  const ctx = ctxOf(req);
  const { source, filters } = parseCampaignRequest(req.body);
  const enableEmail = req.body.enableEmail !== undefined ? Boolean(req.body.enableEmail) : true;
  const enableWhatsapp = req.body.enableWhatsapp !== undefined ? Boolean(req.body.enableWhatsapp) : true;

  let webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  const userId = ctx.userId;
  if (userId) {
    const sheetConfig = await getUserIntegration(userId, "google_sheet", ctx.tenantId) as any;
    if (sheetConfig && sheetConfig.webhookUrl) webhookUrl = sheetConfig.webhookUrl;
  }

  const { leads, error } = await resolveCampaignLeads(ctx, source, filters, enableEmail, enableWhatsapp, webhookUrl);
  if (error) {
    return res.status(400).json({ error });
  }

  res.json({
    total: leads.length,
    withEmail: leads.filter(l => l.emails && l.emails.length > 0).length,
    withPhone: leads.filter(l => !!l.phone).length,
    sample: leads.slice(0, 5).map(l => ({
      businessName: l.businessName,
      leadPriority: l.leadPriority,
      hasEmail: !!(l.emails && l.emails.length > 0),
      hasPhone: !!l.phone,
    })),
  });
}));

/**
 * Legacy immediate-send campaigns are retired. The reviewed campaign workflow
 * at POST /api/campaigns is the only allowed delivery path.
 */
function legacyCampaignRetired(res: express.Response) {
  return res.status(410).json({
    error: "Legacy campaigns are retired. Generate, review, approve, and send through /api/campaigns instead.",
    code: "legacy_campaign_retired",
  });
}

app.post(
  "/api/campaign/start",
  heavyActionRateLimiter(),
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  (_req, res) => legacyCampaignRetired(res)
);

/**
 * GET /api/campaign/history
 * Returns filtered dispatch history records + aggregate summary/timeline used
 * to power the campaign report table and animated charts.
 * Query params: channel, status, campaignId, from, to, search, limit
 */
app.get(
  "/api/campaign/history",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const channel = req.query.channel === "email" || req.query.channel === "whatsapp" ? req.query.channel : undefined;
    const status = req.query.status === "SENT" || req.query.status === "FAILED" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = await prisma.campaignDispatch.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(channel ? { channel } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { businessName: { contains: search } },
          { recipient: { contains: search } },
          { subject: { contains: search } },
          { messageSnippet: { contains: search } },
        ] } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
    const records = rows.map((row) => ({
      id: row.id,
      campaignId: row.campaignId || "manual",
      timestamp: row.occurredAt.toISOString(),
      businessName: row.businessName,
      channel: row.channel,
      status: row.status,
      recipient: row.recipient,
      subject: row.subject || undefined,
      messageSnippet: row.messageSnippet || undefined,
      dryRun: row.dryRun,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
    }));
    res.json({ records, summary: summarizeCampaignHistory(records as any) });
  })
);

// NOTE: literal-path routes (/export, /bulk) are registered BEFORE the
// parameterized /:id routes below, since Express matches routes in
// registration order and "/export" or "/bulk" would otherwise be captured
// as an :id value by an earlier-registered /:id route.

/**
 * GET /api/campaign/history/export?format=csv|pdf|docx
 * Streams the filtered dispatch history as a downloadable report.
 */
app.get("/api/campaign/history/export", heavyActionRateLimiter(), resolveTenantContext, requirePermission("VIEW_ANALYTICS"), asyncHandler(async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  const q: CampaignHistoryQuery = {
    channel: (req.query.channel as any) || "all",
    status: (req.query.status as any) || "all",
    campaignId: (req.query.campaignId as string) || undefined,
    from: (req.query.from as string) || undefined,
    to: (req.query.to as string) || undefined,
    search: (req.query.search as string) || undefined,
    limit: undefined,
  };
  // Legacy history is deployment-global and therefore never exposed through a
  // tenant request. Exports stay empty until history is moved to tenant-owned storage.
  const records: ReturnType<typeof queryCampaignHistory> = [];
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = exportCampaignHistoryToCsv(records);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-report-${stamp}.csv"`);
    return res.send(csv);
  }
  if (format === "pdf") {
    const buf = exportCampaignHistoryToPdf(records);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-report-${stamp}.pdf"`);
    return res.send(buf);
  }
  if (format === "docx" || format === "word") {
    const buf = await exportCampaignHistoryToDocx(records);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-report-${stamp}.docx"`);
    return res.send(buf);
  }
  return res.status(400).json({ error: "Unsupported export format. Use csv, pdf, or docx." });
}));

/**
 * DELETE /api/campaign/history/bulk
 * Delete multiple dispatch records at once — used by the Reports table's
 * checkbox multi-select "Delete selected" action.
 * Body: { ids: string[] }
 */
app.delete(
  "/api/campaign/history/bulk",
  resolveTenantContext,
  requirePermission("DELETE_LEADS"),
  asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: any) => typeof id === "string") : [];
  if (ids.length === 0) return res.status(400).json({ error: "No record ids provided." });
  res.json({ success: true, removed: 0 });
}));

/**
 * GET /api/campaign/history/:id
 * Fetch a single dispatch record — used by the Reports table's "view" action.
 */
app.get(
  "/api/campaign/history/:id",
  resolveTenantContext,
  requirePermission("VIEW_ANALYTICS"),
  (_req, res) => res.status(404).json({ error: "Dispatch record not found.", code: "not_found" })
);

/**
 * PATCH /api/campaign/history/:id
 * Edit a single dispatch record (business name, recipient, subject/message,
 * status) — used by the Reports table's "edit" action.
 */
app.patch(
  "/api/campaign/history/:id",
  resolveTenantContext,
  requirePermission("EDIT_LEADS"),
  (_req, res) => res.status(404).json({ error: "Dispatch record not found.", code: "not_found" })
);

/**
 * DELETE /api/campaign/history/:id
 * Delete a single dispatch record — used by the Reports table's row delete action.
 */
app.delete(
  "/api/campaign/history/:id",
  resolveTenantContext,
  requirePermission("DELETE_LEADS"),
  (_req, res) => res.status(404).json({ error: "Dispatch record not found.", code: "not_found" })
);

app.post(
  "/api/campaign/stop",
  resolveTenantContext,
  requirePermission("SEND_CAMPAIGN"),
  (_req, res) => legacyCampaignRetired(res)
);

/**
 * GET /api/status
 *
 * Discovery status for the CALLER'S workspace, read from their most recent job
 * row rather than from process globals. Previously every caller saw the same
 * `isScrapingRunning` / `scraperResult` pair, so one workspace's progress and
 * final counts were visible to all of them.
 *
 * The response keeps its original shape so the existing dashboard polling keeps
 * working, with `jobId` and `progress` added.
 */
app.get(
  "/api/status",
  resolveTenantContext,
  asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const job = await getLatestJob(ctx, "lead_discovery");
    const running = !!job && !isTerminal(job.status);

    res.json({
      isRunning: running,
      lastResult: job && isTerminal(job.status) ? job.result : null,
      jobId: job?.id ?? null,
      jobStatus: job?.status ?? null,
      progress: job?.progress ?? null,
      cancelRequested: job?.cancelRequested ?? false,
      webhookUrlConfigured:
        !!process.env.GOOGLE_SHEET_WEBHOOK_URL &&
        process.env.GOOGLE_SHEET_WEBHOOK_URL !== "YOUR_WEBHOOK_URL",
      whatsappConnected: getWhatsAppStatus().status === "CONNECTED",
      campaignRunning: isCampaignRunning && activeCampaignTenantId === ctx.tenantId,
    });
  })
);

/**
 * GET /api/jobs — recent jobs for the caller's workspace.
 * Gives the dashboard a history rather than only "what is happening now",
 * which the single global slot could never express.
 */
app.get(
  "/api/jobs",
  resolveTenantContext,
  asyncHandler(async (req, res) => {
    const kind = req.query.kind === "campaign" || req.query.kind === "lead_discovery"
      ? (req.query.kind as "campaign" | "lead_discovery")
      : undefined;
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    res.json(await listJobs(ctxOf(req), kind, Number.isFinite(limit) ? limit : 20));
  })
);

async function startServer() {
  const nextOutPath = path.join(process.cwd(), "leadfinder-landing", "out");
  const indexPath   = path.join(process.cwd(), "index.html");

  // Load any persisted runtime configuration override before serving traffic.
  loadConfigOverride();

  // Unmatched API routes return JSON 404 (never the SPA HTML shell).
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // No site favicon by design. Browsers request /favicon.ico regardless of the
  // markup, so answer with 204 to stop the request falling through to the SPA
  // shell or a stale cached icon.
  app.get(["/favicon.ico", "/favicon.png", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"], (_req, res) => {
    res.status(204).end();
  });

  // Serve all Next.js landing page static export files (HTML, CSS, images, etc.)
  app.use(express.static(nextOutPath));

  // Explicit landing page route at "/"
  app.get("/", (_req, res, next) => {
    const landingHtmlPath = path.join(nextOutPath, "index.html");
    const rootLandingPath = path.join(process.cwd(), "landing.html");

    if (fs.existsSync(landingHtmlPath)) {
      return res.sendFile(landingHtmlPath);
    } else if (fs.existsSync(rootLandingPath)) {
      return res.sendFile(rootLandingPath);
    }
    next();
  });

  // ── React dashboard explicitly at /app ──
  // (Vite will also handle this via SPA middleware for dev HMR)

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      // Use "custom" so Vite doesn't intercept "/" before our handler
      appType: "custom",
    });
    app.use(vite.middlewares);

    // Fallback: serve index.html for /app and any non-API route so
    // React Router (if used) still works
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      // Don't interfere with API routes, the landing page, or superadmin pages
      if (url.startsWith("/api") || url === "/" || url.startsWith("/superadmin")) return next();
      try {
        let html = fs.readFileSync(indexPath, "utf-8");
        html = await vite.transformIndexHtml(url, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ── Centralized error handler (must be last) ──
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Malformed JSON body
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON payload." });
    }
    // Payload too large
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request payload too large." });
    }
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return;
    res.status(500).json({
      error: env.isProduction ? "Internal server error." : String(err?.message || err),
    });
  });

  // Track cleanup job interval for graceful shutdown
  let cleanupJobInterval: NodeJS.Timeout | null = null;

  const server = app.listen(PORT, env.host, () => {
    console.log(`NexaLeadAi Server running on http://localhost:${PORT} (${env.nodeEnv})`);
    console.log(`  Landing page : http://localhost:${PORT}/`);
    console.log(`  Dashboard    : http://localhost:${PORT}/app`);
    console.log(`  Health check : http://localhost:${PORT}/api/health`);

    const { warnings, errors } = validateEnv();
    warnings.forEach((w) => logger.warn(w));

    /*
     * Fatal configuration is fatal. Previously these were warnings, so a
     * production deploy with a publicly-known JWT_SECRET and wildcard CORS
     * started normally and looked healthy. Refusing to boot is noisy on
     * purpose: a server that cannot protect its sessions should not serve
     * traffic.
     */
    if (errors.length > 0) {
      errors.forEach((e) => logger.error(e));
      if (env.isProduction) {
        logger.error(
          `Refusing to start with ${errors.length} fatal configuration error(s). ` +
            "Fix the values above, or run with NODE_ENV=development to start anyway."
        );
        process.exit(1);
      }
    }

    // Establish the database connection (non-blocking; auth routes guard on config).
    void connectDatabase().then((connected) => {
      /*
       * A job left "running" by a process that died would occupy its workspace's
       * slot forever, so no new run could ever start there. Marking them failed
       * at boot is safe because nothing is executing them any more.
       *
       * Startup-only on purpose: with several replicas this would also reclaim
       * another instance's live jobs. Worker heartbeats replace it in Phase 6.
       */
      if (connected) {
        void reclaimAbandonedJobs().catch((err) =>
          logger.warn(`Could not reclaim interrupted jobs: ${err?.message || err}`)
        );
      }
    });
    
    // Start cleanup job for unverified users (removes accounts after 10 minutes)
    cleanupJobInterval = startUnverifiedUserCleanup();
    // The backup service owns retention; this boot hook activates its daily run.
    scheduleAutomaticBackups();
  });

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Stop accepting new connections.
    server.close(() => logger.info("HTTP server closed."));

    // Stop unverified user cleanup job
    if (cleanupJobInterval) {
      stopUnverifiedUserCleanup(cleanupJobInterval);
      cleanupJobInterval = null;
    }

    // Cancel any in-flight work and release the WhatsApp browser session.
    // cancelAllScrapes is the one place a process-wide signal is correct:
    // shutdown must halt every workspace's run, not just one.
    campaignCancelRequested = true;
    const halted = cancelAllScrapes("server is shutting down");
    if (halted > 0) logger.warn(`Signalled ${halted} in-flight lead search(es) to stop.`);
    try {
      await Promise.race([
        disconnectWhatsApp(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (err) {
      logger.warn(`WhatsApp cleanup during shutdown failed: ${(err as Error).message}`);
    }

    await disconnectDatabase();

    // Force-exit if something keeps the loop alive.
    setTimeout(() => process.exit(0), 1000).unref();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// ── Global safety nets: never let an unhandled error silently kill the app ──
process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled promise rejection", reason);
});
process.on("uncaughtException", (err: Error) => {
  logger.error("Uncaught exception", err);
  // For truly unexpected state, exit so the process manager can restart cleanly.
  if (env.isProduction) {
    setTimeout(() => process.exit(1), 500).unref();
  }
});

startServer().catch((err) => {
  logger.error("Fatal error during server startup", err);
  process.exit(1);
});
