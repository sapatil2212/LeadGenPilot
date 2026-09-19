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
} from "./src/mapsScraper";
import { logger } from "./src/logger";
import { duplicateChecker } from "./src/duplicateChecker";
import { loadFailedLeads, retryFailedLeads, sendLeadToWebhook, fetchLeadsFromGoogleSheet, fetchSheetNamesFromGoogleSheet } from "./src/googleSheetsWebhook";
import { 
  getWhatsAppStatus, 
  initializeWhatsApp, 
  disconnectWhatsApp,
  sendEmailOutreach, 
  sendWhatsAppTestMessage,
  setIncomingWhatsAppHandler
} from "./src/outreachService";
import {
  recordInbound as recordConvoInbound,
  recordOutbound as recordConvoOutbound,
  listConversations,
  getConversation,
  markConversationRead,
  setConversationStatus,
  deleteConversation,
  normalizePhoneKey,
} from "./src/conversationStore";
import { generateOutreachCopy } from "./src/outreachCopy";
import { generateAICopy } from "./src/aiCopyGenerator";
import { env, validateEnv } from "./src/env";
import { readJson, writeJsonAtomic, withLock } from "./src/storage";
import cookieParser from "cookie-parser";
import authRoutes from "./src/authRoutes";
import accountRoutes from "./src/accountRoutes";
import adminRoutes from "./src/adminRoutes";
import superAdminRoutes from "./src/superAdminRoutes";
import productionRoutes from "./src/productionRoutes";
import businessRoutes from "./src/business/businessRoutes";
import knowledgeRoutes from "./src/knowledge/knowledgeRoutes";
import assistantRoutes from "./src/assistant/assistantRoutes";
import { connectDatabase, disconnectDatabase } from "./src/prisma";
import crmRoutes, { appLeadToDbInput, dbLeadToAppLead } from "./crmRoutes";
import { prisma } from "./src/prisma";
import {
  OutreachTemplate,
  compileTemplateText,
  compileTemplateSubject,
  templateNeedsAiBody,
} from "./src/outreachTemplates";
import {
  appendCampaignHistory,
  queryCampaignHistory,
  summarizeCampaignHistory,
  CampaignHistoryQuery,
  getCampaignHistoryRecord,
  updateCampaignHistoryRecord,
  deleteCampaignHistoryRecord,
  deleteCampaignHistoryRecords,
} from "./src/campaignHistory";
import { exportCampaignHistoryToCsv, exportCampaignHistoryToPdf, exportCampaignHistoryToDocx } from "./src/campaignReportExporter";
import {
  getUserIntegration,
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
import { resolveTenantContext, requirePermission, ctxOf } from "./src/tenancy/context";
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

      for (const msg of messages) {
        const key = normalizePhoneKey(msg.from);
        if (!key) continue;

        const lead = await prisma.lead
          .findFirst({ where: { phone: { contains: key } } })
          .catch(() => null);

        await recordConvoInbound({
          channel: "whatsapp",
          phone: msg.from,
          text: msg.text,
          leadId: lead?.id,
          businessName: lead?.businessName,
        });

        if (lead?.id) {
          await prisma.lead
            .update({ where: { id: lead.id }, data: { conversationStatus: "REPLIED" } })
            .catch(() => {});
          logger.success(`Cloud API reply received from '${lead.businessName}' — conversation started.`);
        } else {
          logger.info(`Inbound Cloud API reply from unmatched number ${key} recorded in Conversations.`);
        }
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
          const sheetConfig = (await getUserIntegration(tenant.userId, "google_sheet").catch(
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
            .findFirst({ where: { phone: { contains: key } } })
            .catch(() => null);
          if (!lead) continue;

          await updateLeadOutreachStatus(
            lead.businessName,
            "whatsapp",
            "FAILED",
            lead.mapsUrl,
            sheetWebhookUrl
          ).catch((err) =>
            logger.warn(`Could not record WhatsApp delivery failure: ${err?.message || err}`)
          );
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

// API Routes
app.get("/api/config", (req, res) => {
  try {
    // Read directly from file to be updated on client changes
    const configPath = path.join(process.cwd(), "src/config.ts");
    if (fs.existsSync(configPath)) {
      // Find the CONFIG object via matching regex or serve import
      res.json(CONFIG);
    } else {
      res.json({ businessType: "Dental Clinic", location: "Baner Pune", maxResults: 10 });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to load config." });
  }
});

app.post("/api/config", (req, res) => {
  try {
    const { businessType, location, maxResults, enableSimulation, headless, lat, lng, radius } = req.body;
    if (!businessType || !location || maxResults === undefined) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // Validate numeric bounds
    const parsedMax = parseInt(maxResults, 10);
    if (!Number.isFinite(parsedMax) || parsedMax < 1 || parsedMax > 5000) {
      return res.status(400).json({ error: "maxResults must be a number between 1 and 5000." });
    }

    // Update current memory instance (source of truth for the running scraper)
    CONFIG.businessType = String(businessType);
    CONFIG.location = String(location);
    CONFIG.maxResults = parsedMax;
    CONFIG.enableSimulation = Boolean(enableSimulation);
    CONFIG.headless = Boolean(headless);
    CONFIG.lat = lat !== undefined && lat !== null ? parseFloat(lat) : undefined;
    CONFIG.lng = lng !== undefined && lng !== null ? parseFloat(lng) : undefined;
    CONFIG.radius = radius !== undefined && radius !== null ? parseFloat(radius) : undefined;

    // Persist a JSON override that is reloaded on startup (works everywhere).
    persistConfigOverride();

    // In development, also rewrite the source config for convenience. This is
    // skipped in production where the source tree is typically read-only.
    if (!env.isProduction) {
      try {
        const configPath = path.join(process.cwd(), "src/config.ts");
        const newContent = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from "./types";

export const CONFIG: Config = {
  businessType: ${JSON.stringify(CONFIG.businessType)},
  location: ${JSON.stringify(CONFIG.location)},
  maxResults: ${CONFIG.maxResults},
  enableSimulation: ${CONFIG.enableSimulation},
  headless: ${CONFIG.headless},
  lat: ${CONFIG.lat !== undefined ? CONFIG.lat : "undefined"},
  lng: ${CONFIG.lng !== undefined ? CONFIG.lng : "undefined"},
  radius: ${CONFIG.radius !== undefined ? CONFIG.radius : "undefined"}
};
`;
        fs.writeFileSync(configPath, newContent, "utf8");
      } catch (err) {
        logger.warn(`Could not rewrite src/config.ts (non-fatal): ${(err as Error).message}`);
      }
    }

    logger.info(`Configuration updated: ${CONFIG.businessType} in ${CONFIG.location} (max: ${CONFIG.maxResults}, coords: ${CONFIG.lat},${CONFIG.lng}, radius: ${CONFIG.radius}km)`);
    res.json({ success: true, config: CONFIG });
  } catch (error) {
    res.status(500).json({ error: "Failed to write configuration file." });
  }
});

app.get("/api/processed", (req, res) => {
  const leads = duplicateChecker.loadLeads();
  res.json(leads);
});

app.get("/api/failed", (req, res) => {
  const leads = loadFailedLeads();
  res.json(leads);
});

app.get("/api/logs", (req, res) => {
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

    // Per-run copy of the search criteria. Mutating this cannot affect any other
    // workspace, which is the whole point of taking a copy.
    const criteria: ScrapeCriteria = { ...CONFIG, ...readTenantCriteria(req.body) };

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
      const sheetConfig = (await getUserIntegration(scrapingUserId, "google_sheet")) as any;
      if (sheetConfig && sheetConfig.webhookUrl) {
        customWebhookUrl = sheetConfig.webhookUrl;
      }

      /*
       * Progress is written to the job row so any request (or a future worker
       * process) can read it. Throttled to one write every 2s: the scraper
       * reports per lead, and each write is a round trip to a remote database.
       */
      let lastProgressWrite = 0;
      const result = await runScraper(criteria, token, customWebhookUrl, (progress) => {
        const now = Date.now();
        const isFinalStage = progress.current >= progress.total && progress.total > 0;
        if (now - lastProgressWrite < 2000 && !isFinalStage) return;
        lastProgressWrite = now;
        void updateJobProgress(job.id, progress as any);
      });

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
            },
          });
          listCreated = true;

          // Insert leads one-by-one so a single bad row can't drop the batch.
          for (const lead of result.leads) {
            try {
              await prisma.lead.create({
                data: { ...appLeadToDbInput(lead, leadList.id, scrapingUserId), tenantId: ctx.tenantId },
              });
              persistedCount++;
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

      await finishJob(job.id, token.isCancelled ? "cancelled" : "completed", {
        result: {
          scannedCount: result.scannedCount,
          withoutWebsiteCount: result.withoutWebsiteCount,
          addedCount: result.addedCount,
          failedCount: result.failedCount,
          leadsFound: result.leads.length,
          leadsPersisted: persistedCount,
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

app.post("/api/retry-failed", async (req, res) => {
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

app.post("/api/test-webhook", async (req, res) => {
  try {
    let customWebhookUrl: string | undefined;
    const userId = req.authUser?.id;
    if (userId) {
      const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
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
});

app.post("/api/clear-leads", (req, res) => {
  try {
    const processedPath = path.join(process.cwd(), "processed-leads.json");
    const failedPath = path.join(process.cwd(), "failed-leads.json");
    
    writeJsonAtomic(processedPath, []);
    writeJsonAtomic(failedPath, []);
    logger.clear();
    logger.success("Processed and Failed Lead Caches have been successfully reset!");
    
    res.json({ success: true, message: "Lead caches cleared successfully." });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset lead caches." });
  }
});

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

// SMTP configurations endpoints
app.get("/api/config/smtp", (req, res) => {
  res.json({
    host: process.env.SMTP_HOST || "",
    port: process.env.SMTP_PORT || "587",
    user: process.env.SMTP_USER || "",
    from: process.env.SMTP_FROM || "",
    hasPassword: !!process.env.SMTP_PASS
  });
});

app.post("/api/config/smtp", (req, res) => {
  try {
    const { host, port, user, pass, from } = req.body;
    const envPath = path.join(process.cwd(), ".env");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf8");
    }

    const smtpKeys = {
      SMTP_HOST: host,
      SMTP_PORT: port,
      SMTP_USER: user,
      SMTP_PASS: pass,
      SMTP_FROM: from
    };

    for (const [key, val] of Object.entries(smtpKeys)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}="${val}"`);
      } else {
        envContent += `\n${key}="${val}"`;
      }
      process.env[key] = String(val);
    }

    fs.writeFileSync(envPath, envContent.trim() + "\n", "utf8");
    res.json({ success: true, message: "SMTP configuration updated successfully." });
  } catch (e) {
    res.status(500).json({ error: "Failed to write SMTP configurations." });
  }
});

// WhatsApp endpoints
// Provider-aware: reports the QR session for "web" users and live Graph API
// state for "cloud" users, while keeping the { status, qr } shape the
// dashboard already renders.
app.get(
  "/api/whatsapp/status",
  asyncHandler(async (req, res) => {
    const userId = (req as any).authUser?.id;
    if (!userId) {
      return res.json({ ...getWhatsAppStatus(), provider: "web" });
    }
    const status = await getUnifiedWhatsAppStatus(userId);
    res.json(status);
  })
);

app.post("/api/whatsapp/initialize", requireFeature("whatsappOutreach", "WhatsApp outreach"), (req, res) => {
  initializeWhatsApp();
  res.json({ success: true, message: "WhatsApp initialization launched." });
});

app.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    await disconnectWhatsApp();
    initializeWhatsApp();
    res.json({ success: true, message: "WhatsApp disconnected and re-initialized." });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post("/api/whatsapp/send-test", heavyActionRateLimiter(), requireFeature("whatsappOutreach", "WhatsApp outreach"), async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = (req as any).authUser?.id;

    // Cloud API users have no "message yourself" concept, so a destination is
    // mandatory there and the send goes through the unified gateway.
    const { provider } = await resolveWhatsAppProvider(userId);
    if (provider === "cloud") {
      if (!phone) {
        return res.status(400).json({ error: "Enter a destination number to test the Cloud API." });
      }
      const result = await sendWhatsAppUnified(phone, "Test message from NexaLeadAi.", {
        userId,
        allowTemplateFallback: true,
      });
      if (result.ok) {
        return res.json({ success: true, message: "Test message sent successfully.", provider });
      }
      return res.status(500).json({ error: result.error || "Failed to send test message." });
    }

    const success = await sendWhatsAppTestMessage(phone);
    if (success) {
      res.json({ success: true, message: "Test message sent successfully.", provider });
    } else {
      res.status(500).json({ error: "Failed to send test message." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

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

// Data Reset endpoint
app.post("/api/reset-data", (req, res) => {
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
async function trackManualOutreach(params: {
  leadId?: string;
  businessName: string;
  channel: "email" | "whatsapp";
  status: "SENT" | "FAILED";
  recipient: string;
  subject?: string;
  messageSnippet?: string;
}) {
  const { leadId, businessName, channel, status, recipient, subject, messageSnippet } = params;

  if (leadId) {
    const data: any = {};
    if (channel === "email") {
      data.emailStatus = status;
      data.emailSentDate = new Date().toISOString().split("T")[0];
    } else {
      data.whatsappStatus = status;
      data.whatsappSentDate = new Date().toISOString().split("T")[0];
    }
    await prisma.lead.update({ where: { id: leadId }, data }).catch((err) => {
      logger.warn(`Manual outreach: failed to update CRM lead ${leadId} status: ${err.message || err}`);
    });
  }

  await appendCampaignHistory({
    campaignId: "manual",
    businessName,
    channel,
    status,
    recipient,
    subject,
    messageSnippet,
    dryRun: false,
    sourceType: "manual",
    sourceLabel: "Manual Outreach",
  }).catch((err) => logger.warn(`Manual outreach: failed to record history: ${err.message || err}`));

  // Add the sent message to the conversation thread so replies land in context.
  if (status === "SENT") {
    await recordConvoOutbound({
      channel,
      leadId,
      businessName,
      phone: channel === "whatsapp" ? recipient : undefined,
      email: channel === "email" ? recipient : undefined,
      text: channel === "email" ? `${subject ? subject + "\n\n" : ""}${messageSnippet || ""}` : (messageSnippet || ""),
    }).catch((err) => logger.warn(`Manual outreach: failed to record conversation: ${err.message || err}`));
  }
}

/**
 * Resolve an inbound WhatsApp reply to a lead and record it as a conversation.
 * Registered once at startup; runs whenever a lead messages back.
 */
setIncomingWhatsAppHandler(async ({ from, body }) => {
  try {
    const key = normalizePhoneKey(from); // last 10 digits of sender
    if (!key) return;
    // Match to a CRM lead by the trailing digits of their stored phone.
    const lead = await prisma.lead.findFirst({ where: { phone: { contains: key } } }).catch(() => null);

    await recordConvoInbound({
      channel: "whatsapp",
      phone: from.replace("@c.us", ""),
      text: body,
      leadId: lead?.id,
      businessName: lead?.businessName,
    });

    if (lead?.id) {
      await prisma.lead.update({ where: { id: lead.id }, data: { conversationStatus: "REPLIED" } }).catch(() => {});
      logger.success(`Lead reply received from '${lead.businessName}' — conversation started.`);
    } else {
      logger.info(`Inbound WhatsApp reply from unmatched number ${key} recorded in Conversations.`);
    }
  } catch (err: any) {
    logger.warn(`Failed to handle inbound WhatsApp reply: ${err?.message || err}`);
  }
});

// ── Conversations (Inbox) endpoints ──
app.get("/api/conversations", (req, res) => {
  res.json(listConversations());
});

app.get("/api/conversations/:id", (req, res) => {
  const convo = getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found." });
  res.json(convo);
});

/**
 * POST /api/conversations/:id/reply  { text }
 * Send a WhatsApp reply within a thread and record it as outbound.
 */
app.post("/api/conversations/:id/reply", heavyActionRateLimiter(), asyncHandler(async (req, res) => {
  const { text, subject } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ error: "Message text is required." });
  const convo = getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found." });

  if (convo.channel === "whatsapp") {
    if (!convo.phone) return res.status(400).json({ error: "This conversation has no phone number." });
    // A thread reply is text the user typed, so never silently swap in a
    // template: surface the 24h-window error and let them decide.
    const result = await sendWhatsAppUnified(convo.phone, String(text), {
      userId: req.authUser?.id,
      allowTemplateFallback: false,
    });
    if (!result.ok) {
      return res.status(500).json({
        error: result.error || "Failed to send WhatsApp reply. Is the gateway connected?",
        requiresTemplate: result.requiresTemplate,
      });
    }
    const updated = await recordConvoOutbound({
      channel: "whatsapp",
      phone: convo.phone,
      text: String(text),
      leadId: convo.leadId,
      businessName: convo.businessName,
    });
    return res.json({ success: true, conversation: updated });
  }

  // Email reply — resolve SMTP config (user integration first, then env).
  if (!convo.email) return res.status(400).json({ error: "This conversation has no email address." });
  let userSmtpConfig: any = undefined;
  const userId = req.authUser?.id;
  if (userId) {
    const smtpConfig = await getUserIntegration(userId, "smtp") as any;
    if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.password) {
      userSmtpConfig = {
        host: smtpConfig.host,
        port: Number(smtpConfig.port) || 587,
        secure: Boolean(smtpConfig.secure),
        user: smtpConfig.user,
        pass: smtpConfig.password,
        from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>` : smtpConfig.fromEmail,
      };
    }
  }
  const replySubject = String(subject || `Re: ${convo.businessName}`).trim();
  const result = await sendEmailOutreach(convo.email, replySubject, String(text), userSmtpConfig);
  if (!result.success) return res.status(500).json({ error: result.error || "Failed to send email reply." });
  const updated = await recordConvoOutbound({
    channel: "email",
    email: convo.email,
    text: String(text),
    leadId: convo.leadId,
    businessName: convo.businessName,
  });
  res.json({ success: true, conversation: updated });
}));

app.post("/api/conversations/:id/read", asyncHandler(async (req, res) => {
  const convo = await markConversationRead(req.params.id);
  if (!convo) return res.status(404).json({ error: "Conversation not found." });
  res.json({ success: true, conversation: convo });
}));

app.patch("/api/conversations/:id/status", asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["AWAITING_REPLY", "REPLIED", "CLOSED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const convo = await setConversationStatus(req.params.id, status);
  if (!convo) return res.status(404).json({ error: "Conversation not found." });
  // Keep the linked CRM lead's conversation status in sync.
  if (convo.leadId) {
    await prisma.lead.update({ where: { id: convo.leadId }, data: { conversationStatus: status } }).catch(() => {});
  }
  res.json({ success: true, conversation: convo });
}));

app.delete("/api/conversations/:id", asyncHandler(async (req, res) => {
  const removed = await deleteConversation(req.params.id);
  if (!removed) return res.status(404).json({ error: "Conversation not found." });
  res.json({ success: true });
}));

// ── Email reply ingestion (IMAP polling) ──
// Watches every configured sending mailbox for new messages. When a lead
// replies by email, it is matched to a CRM lead, recorded as a conversation,
// and the lead's status flips to REPLIED — mirroring the WhatsApp reply path.
async function getPollableMailboxes(): Promise<ImapMailbox[]> {
  const mailboxes: ImapMailbox[] = [];

  // 1) Environment SMTP account (used when no per-user integration is set).
  const envHost = process.env.SMTP_HOST || "";
  const envUser = process.env.SMTP_USER || "";
  const envPass = process.env.SMTP_PASS || "";
  if (envHost && envUser && envPass) {
    const imapHost = process.env.IMAP_HOST || deriveImapHost(envHost);
    if (imapHost) {
      mailboxes.push({
        id: envUser.toLowerCase(),
        host: imapHost,
        port: Number(process.env.IMAP_PORT) || 993,
        secure: true,
        user: envUser,
        pass: envPass,
      });
    }
  }

  // 2) Every enabled per-user SMTP integration.
  try {
    const smtpConfigs = await getAllEnabledSmtpConfigs();
    for (const cfg of smtpConfigs) {
      const imapHost = deriveImapHost(cfg.host);
      if (imapHost && cfg.user && cfg.password) {
        mailboxes.push({
          id: cfg.user.toLowerCase(),
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
  async ({ from, subject, text }) => {
    try {
      // Match the sender email to a CRM lead (emails stored as a JSON string).
      const lead = await prisma.lead.findFirst({ where: { emails: { contains: from } } }).catch(() => null);

      await recordConvoInbound({
        channel: "email",
        email: from,
        text: subject ? `${subject}\n\n${text}` : text,
        leadId: lead?.id,
        businessName: lead?.businessName,
      });

      if (lead?.id) {
        await prisma.lead.update({ where: { id: lead.id }, data: { conversationStatus: "REPLIED" } }).catch(() => {});
        logger.success(`Email reply received from '${lead.businessName}' (${from}) — conversation started.`);
      } else {
        logger.info(`Inbound email reply from unmatched address ${from} recorded in Conversations.`);
      }
    } catch (err: any) {
      logger.warn(`Failed to handle inbound email reply: ${err?.message || err}`);
    }
  },
  Number(process.env.EMAIL_POLL_INTERVAL_MS) || 60000
);

// Outreach execution endpoints
app.post("/api/send-email", heavyActionRateLimiter(), asyncHandler(async (req, res) => {
  const { businessName, to, subject, body, leadId } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing parameters (to, subject, body)" });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(String(to))) {
    return res.status(400).json({ error: "Invalid recipient email address." });
  }

  let customWebhookUrl: string | undefined;
  let userSmtpConfig: any = undefined;
  const userId = req.authUser?.id;
  if (userId) {
    const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
    if (sheetConfig && sheetConfig.webhookUrl) {
      customWebhookUrl = sheetConfig.webhookUrl;
    }
    const smtpConfig = await getUserIntegration(userId, "smtp") as any;
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

  const result = await sendEmailOutreach(to, subject, body, userSmtpConfig);
  if (result.success) {
    await updateLeadOutreachStatus(businessName, "email", "SENT", undefined, customWebhookUrl);
    await trackManualOutreach({ leadId, businessName, channel: "email", status: "SENT", recipient: to, subject, messageSnippet: body });
    res.json({ success: true, message: "Email sent successfully." });
  } else {
    await updateLeadOutreachStatus(businessName, "email", "FAILED", undefined, customWebhookUrl);
    await trackManualOutreach({ leadId, businessName, channel: "email", status: "FAILED", recipient: to, subject, messageSnippet: result.error });
    res.status(500).json({ error: result.error || "Failed to send email." });
  }
}));

app.post("/api/send-whatsapp", heavyActionRateLimiter(), requireFeature("whatsappOutreach", "WhatsApp outreach"), asyncHandler(async (req, res) => {
  const { businessName, phone, message, leadId } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: "Missing parameters (phone, message)" });
  }

  let customWebhookUrl: string | undefined;
  const userId = req.authUser?.id;
  if (userId) {
    const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
    if (sheetConfig && sheetConfig.webhookUrl) {
      customWebhookUrl = sheetConfig.webhookUrl;
    }
  }

  const result = await sendWhatsAppUnified(phone, message, { userId });
  if (result.ok) {
    await updateLeadOutreachStatus(businessName, "whatsapp", "SENT", undefined, customWebhookUrl);
    await trackManualOutreach({ leadId, businessName, channel: "whatsapp", status: "SENT", recipient: phone, messageSnippet: message });
    res.json({ success: true, message: "WhatsApp message sent successfully.", provider: result.provider });
  } else {
    await updateLeadOutreachStatus(businessName, "whatsapp", "FAILED", undefined, customWebhookUrl);
    await trackManualOutreach({ leadId, businessName, channel: "whatsapp", status: "FAILED", recipient: phone, messageSnippet: "Delivery failed" });
    res.status(500).json({
      error: result.error || "Failed to send WhatsApp message.",
      requiresTemplate: result.requiresTemplate,
    });
  }
}));

app.post("/api/generate-copy", heavyActionRateLimiter(), async (req, res) => {
  const { lead } = req.body;
  if (!lead) {
    return res.status(400).json({ error: "Missing lead parameter." });
  }
  try {
    // Advanced AI insights (Gemini) are a Pro feature. Free plans get the
    // deterministic rule-based generator.
    const ent = entOf(req);
    const copy = ent.aiInsights ? await generateAICopy(lead) : generateOutreachCopy(lead);
    res.json(copy);
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Campaign variables
let isCampaignRunning = false;
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
  source: CampaignSource,
  filters: CampaignFilters,
  enableEmail: boolean,
  enableWhatsapp: boolean,
  webhookUrl?: string
): Promise<{ leads: Lead[]; error?: string }> {
  let leads: Lead[] = [];

  if (source.type === "list") {
    if (!source.listId) return { leads: [], error: "No lead list selected." };
    const dbLeads = await prisma.lead.findMany({ where: { listId: source.listId } });
    if (!dbLeads || dbLeads.length === 0) {
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
    await prisma.lead.update({ where: { id: lead.id }, data }).catch((err) => {
      logger.warn(`Campaign: failed to update CRM lead status for '${lead.businessName}': ${err.message || err}`);
    });
  } else {
    await updateLeadOutreachStatus(lead.businessName, channel, status, lead.mapsUrl, webhookUrl);
  }
}

async function runCampaignLoop(
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
  let sourceLabel = source.type === "list" ? (source.listId || "Lead List") : (source.sheetName || "All Sheets");
  if (source.type === "list" && source.listId) {
    const list = await prisma.leadList.findUnique({ where: { id: source.listId }, select: { name: true } }).catch(() => null);
    if (list?.name) sourceLabel = list.name;
  }
  const logDispatch = (channel: "email" | "whatsapp", status: "SENT" | "FAILED", lead: Lead, recipient: string, subject?: string, messageSnippet?: string) => {
    appendCampaignHistory({
      campaignId,
      businessName: lead.businessName,
      channel,
      status,
      recipient,
      subject,
      messageSnippet: messageSnippet ? messageSnippet.slice(0, 200) : undefined,
      dryRun,
      sourceType: source.type,
      sourceLabel,
    }).catch((err) => logger.warn(`Failed to record campaign history: ${err.message || err}`));
  };
  let webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  let userSmtpConfig: any = undefined;
  if (campaignUserId) {
    const sheetConfig = await getUserIntegration(campaignUserId, "google_sheet") as any;
    if (sheetConfig && sheetConfig.webhookUrl) {
      webhookUrl = sheetConfig.webhookUrl;
    } else if (source.type === "sheet") {
      logger.error("Outreach campaign aborted: Custom Google Sheet integration is not configured for the user.");
      campaignProgress.status = "Aborted: Google Sheet not configured";
      isCampaignRunning = false;
      return;
    }

    const smtpConfig = await getUserIntegration(campaignUserId, "smtp") as any;
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
  const waProvider = await resolveWhatsAppProvider(campaignUserId);
  const waStatusObj = await getUnifiedWhatsAppStatus(campaignUserId);
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
            await markCampaignOutreach(source, lead, "email", "SENT", webhookUrl);
            campaignProgress.emailsSent++;
            logDispatch("email", "SENT", lead, recipient, emailSubject, emailBody);
            recordConvoOutbound({ channel: "email", email: recipient, text: `${emailSubject ? emailSubject + "\n\n" : ""}${emailBody}`, leadId: lead.id, businessName: lead.businessName }).catch(() => {});
          } else {
            await markCampaignOutreach(source, lead, "email", "FAILED", webhookUrl);
            campaignProgress.emailsFailed++;
            logDispatch("email", "FAILED", lead, recipient, emailSubject, emailResult.error);
          }
        } else {
          logger.warn(`Skipping Email for '${lead.businessName}': SMTP parameters are not configured in settings.`);
          await markCampaignOutreach(source, lead, "email", "FAILED", webhookUrl);
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
            allowTemplateFallback: true,
          });
          if (sendResult.ok) {
            await markCampaignOutreach(source, lead, "whatsapp", "SENT", webhookUrl);
            campaignProgress.whatsappSent++;
            logDispatch("whatsapp", "SENT", lead, lead.phone, undefined, whatsappMessage);
            recordConvoOutbound({ channel: "whatsapp", phone: lead.phone, text: whatsappMessage, leadId: lead.id, businessName: lead.businessName }).catch(() => {});
          } else {
            await markCampaignOutreach(source, lead, "whatsapp", "FAILED", webhookUrl);
            campaignProgress.whatsappFailed++;
            logDispatch("whatsapp", "FAILED", lead, lead.phone, undefined, sendResult.error || "Delivery failed");
          }
        } else {
          logger.warn(`Skipping WhatsApp for '${lead.businessName}': the ${waProviderLabel} is not connected.`);
          await markCampaignOutreach(source, lead, "whatsapp", "FAILED", webhookUrl);
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
  campaignCancelRequested = false;
}

app.get("/api/campaign/status", (req, res) => {
  res.json({
    isRunning: isCampaignRunning,
    progress: campaignProgress
  });
});

app.get("/api/campaign/sheets", async (req, res) => {
  try {
    let customWebhookUrl: string | undefined;
    const userId = req.authUser?.id;
    if (userId) {
      const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
      if (sheetConfig && sheetConfig.webhookUrl) {
        customWebhookUrl = sheetConfig.webhookUrl;
      } else {
        // Return empty list if user hasn't set up their integration,
        // rather than falling back to process.env.GOOGLE_SHEET_WEBHOOK_URL.
        return res.json([]);
      }
    }
    const sheets = await fetchSheetNamesFromGoogleSheet(customWebhookUrl);
    res.json(sheets);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch Google Sheet tabs list." });
  }
});

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
app.post("/api/campaign/preview", heavyActionRateLimiter(), asyncHandler(async (req, res) => {
  const { source, filters } = parseCampaignRequest(req.body);
  const enableEmail = req.body.enableEmail !== undefined ? Boolean(req.body.enableEmail) : true;
  const enableWhatsapp = req.body.enableWhatsapp !== undefined ? Boolean(req.body.enableWhatsapp) : true;

  let webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  const userId = req.authUser?.id;
  if (userId) {
    const sheetConfig = await getUserIntegration(userId, "google_sheet") as any;
    if (sheetConfig && sheetConfig.webhookUrl) webhookUrl = sheetConfig.webhookUrl;
  }

  const { leads, error } = await resolveCampaignLeads(source, filters, enableEmail, enableWhatsapp, webhookUrl);
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

app.post("/api/campaign/start", heavyActionRateLimiter(), (req, res) => {
  if (isCampaignRunning) {
    return res.status(400).json({ error: "Campaign is already running." });
  }

  const { delaySeconds, enableEmail, enableWhatsapp, dryRun } = req.body;
  const { source, filters, templates } = parseCampaignRequest(req.body);
  const delaySec = parseInt(delaySeconds, 10) || 30;
  const mailActive = enableEmail !== undefined ? Boolean(enableEmail) : true;
  let waActive = enableWhatsapp !== undefined ? Boolean(enableWhatsapp) : true;
  const simulated = Boolean(dryRun);

  if (!mailActive && !waActive) {
    return res.status(400).json({ error: "Select at least one outreach channel (Email or WhatsApp)." });
  }
  if (source.type === "list" && !source.listId) {
    return res.status(400).json({ error: "Select a lead list to run the campaign against." });
  }

  // ── Plan enforcement ──
  const ent = entOf(req);
  // WhatsApp outreach is a Pro feature. If a Free plan requests it, either
  // block (WhatsApp-only) or continue with email only.
  if (waActive && !ent.whatsappOutreach) {
    if (!mailActive) {
      return res.status(403).json({
        error: `WhatsApp outreach is not included in your ${ent.planName} plan. Upgrade to Pro to unlock it.`,
        code: "plan_restricted",
        feature: "whatsappOutreach",
      });
    }
    logger.warn(`WhatsApp outreach disabled for this campaign: not included in the ${ent.planName} plan. Continuing with email only.`);
    waActive = false;
  }
  const useAiInsights = ent.aiInsights;

  isCampaignRunning = true;
  campaignCancelRequested = false;
  campaignProgress = {
    current: 0,
    total: 0,
    status: "Initializing",
    secondsRemaining: 0,
    emailsSent: 0,
    emailsFailed: 0,
    whatsappSent: 0,
    whatsappFailed: 0,
    skipped: 0
  };
  
  const campaignUserId = req.authUser?.id;
  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  runCampaignLoop(delaySec, mailActive, waActive, simulated, source, filters, templates, useAiInsights, campaignUserId, campaignId).catch(err => {
    logger.error(`Campaign crashed: ${err}`);
    isCampaignRunning = false;
    campaignProgress.status = `Error: ${err.message || err}`;
  });

  res.json({ success: true, message: "Outreach campaign started in the background.", campaignId });
});

/**
 * GET /api/campaign/history
 * Returns filtered dispatch history records + aggregate summary/timeline used
 * to power the campaign report table and animated charts.
 * Query params: channel, status, campaignId, from, to, search, limit
 */
app.get("/api/campaign/history", (req, res) => {
  const q: CampaignHistoryQuery = {
    channel: (req.query.channel as any) || "all",
    status: (req.query.status as any) || "all",
    campaignId: (req.query.campaignId as string) || undefined,
    from: (req.query.from as string) || undefined,
    to: (req.query.to as string) || undefined,
    search: (req.query.search as string) || undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 200,
  };
  const records = queryCampaignHistory(q);
  // Summary/timeline are computed over the SAME filters but without the
  // `limit` truncation, so charts reflect the full filtered dataset.
  const allFiltered = queryCampaignHistory({ ...q, limit: undefined });
  res.json({ records, summary: summarizeCampaignHistory(allFiltered) });
});

// NOTE: literal-path routes (/export, /bulk) are registered BEFORE the
// parameterized /:id routes below, since Express matches routes in
// registration order and "/export" or "/bulk" would otherwise be captured
// as an :id value by an earlier-registered /:id route.

/**
 * GET /api/campaign/history/export?format=csv|pdf|docx
 * Streams the filtered dispatch history as a downloadable report.
 */
app.get("/api/campaign/history/export", heavyActionRateLimiter(), asyncHandler(async (req, res) => {
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
  const records = queryCampaignHistory(q);
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
app.delete("/api/campaign/history/bulk", asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: any) => typeof id === "string") : [];
  if (ids.length === 0) return res.status(400).json({ error: "No record ids provided." });
  const removed = await deleteCampaignHistoryRecords(ids);
  res.json({ success: true, removed });
}));

/**
 * GET /api/campaign/history/:id
 * Fetch a single dispatch record — used by the Reports table's "view" action.
 */
app.get("/api/campaign/history/:id", (req, res) => {
  const record = getCampaignHistoryRecord(req.params.id);
  if (!record) return res.status(404).json({ error: "Dispatch record not found." });
  res.json(record);
});

/**
 * PATCH /api/campaign/history/:id
 * Edit a single dispatch record (business name, recipient, subject/message,
 * status) — used by the Reports table's "edit" action.
 */
app.patch("/api/campaign/history/:id", asyncHandler(async (req, res) => {
  const { businessName, recipient, subject, messageSnippet, status } = req.body;
  if (status && status !== "SENT" && status !== "FAILED") {
    return res.status(400).json({ error: "Invalid status. Use SENT or FAILED." });
  }
  const updated = await updateCampaignHistoryRecord(req.params.id, { businessName, recipient, subject, messageSnippet, status });
  if (!updated) return res.status(404).json({ error: "Dispatch record not found." });
  res.json({ success: true, record: updated });
}));

/**
 * DELETE /api/campaign/history/:id
 * Delete a single dispatch record — used by the Reports table's row delete action.
 */
app.delete("/api/campaign/history/:id", asyncHandler(async (req, res) => {
  const removed = await deleteCampaignHistoryRecord(req.params.id);
  if (!removed) return res.status(404).json({ error: "Dispatch record not found." });
  res.json({ success: true });
}));

app.post("/api/campaign/stop", (req, res) => {
  if (!isCampaignRunning) {
    return res.status(400).json({ error: "No campaign currently active." });
  }
  campaignCancelRequested = true;
  campaignProgress.status = "Cancelling...";
  res.json({ success: true, message: "Campaign cancellation requested." });
});

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
      campaignRunning: isCampaignRunning,
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
