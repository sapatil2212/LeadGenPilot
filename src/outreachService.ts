/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer from "nodemailer";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { logger } from "./logger";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";

// SMTP Outreach Sending
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailSendOptions {
  /**
   * Stable per-message identity, reused on every retry of the same message.
   *
   * SMTP has no idempotency parameter, but it does have `Message-ID`, and that is
   * the closest thing available: a resend after an unknown outcome carries the
   * same Message-ID, so receiving servers and mail clients that deduplicate on it
   * collapse the duplicate instead of showing the recipient two copies. It also
   * makes a duplicate detectable afterwards, because the id is recorded on the
   * delivery report.
   */
  idempotencyKey?: string;
  attachments?: Array<{ filename: string; path?: string; content?: any; contentType?: string }>;
}

export async function sendEmailOutreach(
  to: string, 
  subject: string, 
  body: string,
  smtpConfig?: { host: string; port: number; secure: boolean; user: string; pass: string; from: string },
  options?: EmailSendOptions
): Promise<EmailSendResult> {
  const host = smtpConfig ? smtpConfig.host : (process.env.SMTP_HOST || "");
  const rawPort = smtpConfig ? String(smtpConfig.port) : (process.env.SMTP_PORT || "587");
  const port = Math.min(parseInt(rawPort, 10) || 587, 65535); // Sanitize port
  const user = smtpConfig ? smtpConfig.user : (process.env.SMTP_USER || "");
  const pass = smtpConfig ? smtpConfig.pass : (process.env.SMTP_PASS || "");
  const from = smtpConfig ? smtpConfig.from : (process.env.SMTP_FROM || "");

  if (!host || !user || !pass) {
    logger.error("SMTP parameters (host, user, pass) are not configured. Cannot send email.");
    return {
      success: false,
      error: "Email is not configured. Add SMTP host, user and password (Gmail needs an App Password) in Settings.",
    };
  }

  if (port <= 0 || port > 65535) {
    logger.error(`Invalid SMTP port: ${rawPort}. Port must be between 1 and 65535.`);
    return { success: false, error: `Invalid SMTP port: ${rawPort}.` };
  }

  try {
    logger.info(`Initializing SMTP Transporter for: ${host}:${port}...`);

    // Use Gmail service shortcut for reliable delivery when host is Gmail
    const isGmail = host.includes("gmail");
    const transportConfig: any = isGmail
      ? {
          service: "gmail",
          auth: { user, pass },
        }
      : {
          host,
          port,
          secure: smtpConfig ? smtpConfig.secure : port === 465,
          auth: { user, pass },
        };

    const transporter = nodemailer.createTransport(transportConfig);

    logger.info(`Sending email outreach to: ${to}...`);
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    const mailOptions: any = {
      from: from ? `"${from}" <${user}>` : `"Outreach Agent" <${user}>`,
      to,
      subject,
    };
    const stableMessageId = buildStableMessageId(options?.idempotencyKey, user);
    if (stableMessageId) mailOptions.messageId = stableMessageId;
    if (isHtml) {
      mailOptions.html = body;
      // Provide a plain-text fallback by stripping HTML tags
      mailOptions.text = body.replace(/<[^>]*>/g, "").replace(/\s{2,}/g, " ").trim();
    } else {
      mailOptions.text = body;
    }
    if (options?.attachments && options.attachments.length > 0) {
      mailOptions.attachments = options.attachments;
    }
    const info = await transporter.sendMail(mailOptions);

    logger.success(`Email outreach successfully sent to ${to}!`);
    return { success: true, messageId: info.messageId || undefined };
  } catch (error: any) {
    logger.error(`Failed to send email to ${to}: ${error}`);
    return { success: false, error: classifyEmailError(error) };
  }
}

/**
 * Builds an RFC 5322 Message-ID from a delivery idempotency key.
 *
 * Returns null for a missing or unusable key rather than guessing, because an
 * invalid Message-ID header is rejected by some servers and would turn a
 * deliverable message into a hard failure.
 */
export function buildStableMessageId(idempotencyKey: string | undefined, senderAddress: string): string | null {
  const key = String(idempotencyKey || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{8,128}$/.test(key)) return null;
  const domain = senderAddress.includes("@") ? senderAddress.split("@").pop()!.trim().toLowerCase() : "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return `<campaign-${key}@${domain}>`;
}

/** Turn a raw nodemailer/SMTP error into an actionable, user-facing message. */
function classifyEmailError(error: any): string {
  const code = error?.code || "";
  const response = String(error?.response || error?.message || error || "");
  if (code === "EAUTH" || response.includes("535") || /BadCredentials|Username and Password not accepted/i.test(response)) {
    return "SMTP authentication failed. Your email/password was rejected — Gmail requires an App Password (not your normal password). Update it in Settings.";
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || /timed out|ECONNREFUSED/i.test(response)) {
    return "Could not connect to the SMTP server. Check the host, port and your network.";
  }
  if (code === "EENVELOPE" || /no recipients|invalid.*address/i.test(response)) {
    return "The recipient address was rejected by the mail server.";
  }
  return "Failed to send email. Check your SMTP settings and try again.";
}

// WhatsApp Web Outreach Sending
//
// Multi-account support: the gateway maintains a pool of up to 5 independent
// WhatsApp Web sessions, each identified by a 1-based "slot" (1–5). Every slot
// has its own authenticated headless browser (its own LocalAuth clientId and
// .wwebjs_auth session folder) so a workspace can link up to five business
// lines at once. Campaign/outreach sending rotates across the connected slots
// for anti-spam pacing.
//
// Backward compatibility: slot 1 keeps the original clientId
// "leadgenpilot-outreach" (session folder session-leadgenpilot-outreach), and
// the legacy no-arg functions (initializeWhatsApp/getWhatsAppStatus/
// disconnectWhatsApp/sendWhatsAppMessage) all default to slot 1.

export const MAX_WHATSAPP_SESSIONS = 5;

/**
 * Session lifecycle:
 *   DISCONNECTED -> CONNECTING -> QR_READY -> AUTHENTICATING -> CONNECTED
 *
 * AUTHENTICATING exists because whatsapp-web.js emits `ready` from a single
 * page binding (`onAppStateHasSyncedEvent`). If WhatsApp's app-state sync never
 * fires, or the in-page `window.WWebJS` injection times out, that binding
 * throws *inside the browser context* and `ready` is simply never emitted —
 * no error ever reaches Node. Without this state the UI would sit on QR_READY
 * forever even though the phone has already accepted the pairing. We therefore
 * treat a scanned-but-not-yet-ready session as AUTHENTICATING and confirm
 * readiness by polling the live socket state instead of trusting `ready`.
 */
export type WhatsAppSessionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "QR_READY"
  | "AUTHENTICATING"
  | "CONNECTED";

interface WhatsAppSession {
  slot: number;
  client: any;
  qr: string;
  qrDataUrl: string;
  status: WhatsAppSessionState;
  /** E.164 phone number of the linked account, once known. */
  phoneNumber: string;
  /** WhatsApp profile (push) name of the linked account, once known. */
  pushName: string;
  /** Last failure surfaced to the UI, cleared on a successful connect. */
  lastError: string;
  /** WhatsApp's offline-sync progress percentage while loading (0-100). */
  loadingPercent: number;
  /** Handle for the readiness watchdog so it can be cancelled. */
  watchdog: NodeJS.Timeout | null;
  /** Generation counter: increments on every (re)initialize to orphan stale callbacks. */
  generation: number;
}

/** The pool of WhatsApp Web sessions keyed by 1-based slot number. */
const whatsappSessions = new Map<number, WhatsAppSession>();

/**
 * Whether this OS process ever attempted to host a WhatsApp Web session.
 *
 * The sessions are live headless browsers held in memory, so only the process
 * that launched them can send through them. The durable campaign worker runs as
 * a separate process (`npm run worker`) and never initializes the gateway, so a
 * WhatsApp send attempted there can never succeed. Tracking this lets us emit a
 * precise deployment error instead of the misleading "scan the QR code first".
 */
let gatewayHostProcess = false;

/** True when this process owns the WhatsApp Web session pool. */
export function isWhatsAppGatewayHost(): boolean {
  return gatewayHostProcess;
}

/**
 * How long to keep polling the socket state after the browser is up before
 * giving up on a session. Generous because a first-time link has to download
 * and sync history before WhatsApp reports CONNECTED.
 */
const READY_WATCHDOG_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.WHATSAPP_READY_TIMEOUT_MS) || 180_000
);
/** How often the watchdog samples the live socket state. */
const READY_WATCHDOG_INTERVAL_MS = 2_000;

/** Resolve the LocalAuth clientId for a slot (slot 1 keeps the legacy id). */
function clientIdForSlot(slot: number): string {
  return slot === 1 ? "leadgenpilot-outreach" : `leadgenpilot-outreach-${slot}`;
}

/** The on-disk session folder name for a slot. */
function sessionFolderForSlot(slot: number): string {
  return `session-${clientIdForSlot(slot)}`;
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_WHATSAPP_SESSIONS;
}

/** Lazily create (or fetch) the session record for a slot. */
function getSession(slot: number): WhatsAppSession {
  let session = whatsappSessions.get(slot);
  if (!session) {
    session = {
      slot,
      client: null,
      qr: "",
      qrDataUrl: "",
      status: "DISCONNECTED",
      phoneNumber: "",
      pushName: "",
      lastError: "",
      loadingPercent: 0,
      watchdog: null,
      generation: 0,
    };
    whatsappSessions.set(slot, session);
  }
  return session;
}

/** Reset a session's volatile fields back to a disconnected baseline. */
function resetSessionState(session: WhatsAppSession, error?: string) {
  stopReadyWatchdog(session);
  session.client = null;
  session.status = "DISCONNECTED";
  session.qr = "";
  session.qrDataUrl = "";
  session.phoneNumber = "";
  session.pushName = "";
  session.loadingPercent = 0;
  if (error !== undefined) session.lastError = error;
}

function stopReadyWatchdog(session: WhatsAppSession) {
  if (session.watchdog) {
    clearInterval(session.watchdog);
    session.watchdog = null;
  }
}

/**
 * Promote a session to CONNECTED and capture the linked account's identity so
 * the UI can show *which* number is connected rather than a bare "connected".
 */
async function markSessionConnected(session: WhatsAppSession) {
  stopReadyWatchdog(session);
  const wasConnected = session.status === "CONNECTED";
  session.status = "CONNECTED";
  session.qr = "";
  session.qrDataUrl = "";
  session.lastError = "";
  session.loadingPercent = 100;

  // Resolve which number is linked, so the UI can say "connected as +91…".
  //
  // client.info is only populated inside whatsapp-web.js's `ready` path. When
  // the watchdog promotes a session that never emitted `ready`, info is absent,
  // so fall back to reading the logged-in user straight from the page. Both
  // paths are best-effort: a missing identity must not demote a working session.
  try {
    const info = session.client?.info;
    let wid = info?.wid?._serialized || info?.wid?.user || "";
    let pushName = info?.pushname || "";

    if (!wid && session.client?.pupPage) {
      const fromPage = await session.client.pupPage.evaluate(() => {
        try {
          const me = (window as any).require("WAWebUserPrefsMeUser");
          const user = me.getMaybeMePnUser?.() || me.getMaybeMeLidUser?.();
          const conn = (window as any).require("WAWebConnModel")?.Conn;
          return {
            wid: user?._serialized || user?.user || "",
            pushName: conn?.pushname || "",
          };
        } catch {
          return { wid: "", pushName: "" };
        }
      });
      wid = fromPage?.wid || wid;
      pushName = fromPage?.pushName || pushName;
    }

    const digits = String(wid).replace(/@.*$/, "");
    if (digits) session.phoneNumber = digits;
    if (pushName) session.pushName = String(pushName);
  } catch {
    /* identity is cosmetic; never fail a connect over it */
  }

  if (!wasConnected) {
    const who = session.phoneNumber
      ? ` as +${session.phoneNumber}${session.pushName ? ` (${session.pushName})` : ""}`
      : "";
    logger.success(`WhatsApp account ${session.slot} connected${who}.`);
  }
}

/**
 * Start polling the live socket state until the session is genuinely usable.
 *
 * This is the load-bearing reliability fix. `client.getState()` evaluates
 * `WAWebSocketModel.Socket.state` in the page, which is the authoritative
 * signal, whereas the `ready` event depends on a one-shot app-state-sync
 * binding that is known to silently never fire. Polling converges on the truth
 * regardless of whether `ready` ever arrives.
 */
function startReadyWatchdog(session: WhatsAppSession) {
  stopReadyWatchdog(session);
  const generation = session.generation;
  /**
   * When the post-scan sync window opened. Deliberately null until we observe
   * a state that means the phone has engaged (PAIRING/OPENING/CONNECTED) — a
   * session sitting at UNPAIRED is simply waiting for the user to pick up their
   * phone, and must never be failed for taking too long. The QR auto-refreshes
   * (qrMaxRetries: 0), so waiting here is free.
   */
  let syncStartedAt: number | null = null;

  session.watchdog = setInterval(async () => {
    // A re-initialize or disconnect happened; abandon this watchdog.
    if (session.generation !== generation) {
      clearInterval(session.watchdog!);
      session.watchdog = null;
      return;
    }
    if (!session.client) return;

    let state: string | null = null;
    try {
      state = await session.client.getState();
    } catch {
      // The page may still be booting, or the browser is gone. Keep waiting
      // until the timeout below decides the outcome.
      state = null;
    }

    if (state === "CONNECTED") {
      // The socket is live. Make sure the helper bundle is actually injected
      // before declaring the session usable, otherwise sendMessage would throw.
      let usable = true;
      try {
        usable = await session.client.pupPage.evaluate("window.WWebJS != undefined");
      } catch {
        usable = false;
      }
      if (usable) {
        await markSessionConnected(session);
        return;
      }
      // Socket up but helpers missing: report progress and keep polling.
      if (session.status === "QR_READY" || session.status === "CONNECTING") {
        session.status = "AUTHENTICATING";
      }
    } else if (state === "PAIRING" || state === "OPENING" || state === "TIMEOUT") {
      // The phone accepted the pairing and the session is syncing.
      if (session.status !== "CONNECTED") session.status = "AUTHENTICATING";
      if (syncStartedAt === null) syncStartedAt = Date.now();
    }

    // `authenticated` also puts us in AUTHENTICATING without a socket state
    // change having been sampled yet; start the clock from that too.
    if (syncStartedAt === null && session.status === "AUTHENTICATING") {
      syncStartedAt = Date.now();
    }

    // Only enforce a deadline once the phone has actually engaged. Until then
    // the session is legitimately idle waiting for a scan.
    if (syncStartedAt !== null && Date.now() - syncStartedAt > READY_WATCHDOG_TIMEOUT_MS) {
      stopReadyWatchdog(session);
      if (session.status !== "CONNECTED") {
        logger.warn(
          `WhatsApp account ${session.slot} did not finish syncing within ${Math.round(READY_WATCHDOG_TIMEOUT_MS / 1000)}s (last socket state: ${state ?? "unknown"}).`
        );
        session.lastError =
          "The scan was accepted but WhatsApp did not finish syncing. Press Regenerate QR Code and scan again.";
        // Leave the browser running: a later state change can still promote it.
      }
    }
  }, READY_WATCHDOG_INTERVAL_MS);
}

// Handler invoked when an INBOUND WhatsApp message (a lead reply) arrives.
// Registered by the server so it can match the sender to a lead and record the
// conversation. Kept as a simple module-level callback to avoid a hard import
// cycle between the outreach service and the conversation/CRM layers. The slot
// that received the message is included so replies can be attributed to the
// business line that was contacted.
type IncomingWhatsAppHandler = (params: { from: string; body: string; timestamp: number; slot: number }) => void;
let incomingWhatsAppHandler: IncomingWhatsAppHandler | null = null;

export function setIncomingWhatsAppHandler(handler: IncomingWhatsAppHandler) {
  incomingWhatsAppHandler = handler;
}

/** Status for a single slot. Defaults to slot 1 for backward compatibility. */
export function getWhatsAppStatus(slot: number = 1) {
  const session = whatsappSessions.get(slot);
  return {
    slot,
    status: session?.status ?? "DISCONNECTED",
    qr: session?.qr ?? "",
    qrDataUrl: session?.qrDataUrl ?? "",
    phoneNumber: session?.phoneNumber ?? "",
    pushName: session?.pushName ?? "",
    error: session?.lastError ?? "",
    loadingPercent: session?.loadingPercent ?? 0,
    /** True when credentials exist on disk, so this slot can auto-restore. */
    hasSavedSession: hasStoredCredentials(slot),
  };
}

/**
 * Whether a slot has WhatsApp credentials persisted on disk. Used to decide
 * which sessions can be restored after a restart without a fresh QR scan.
 */
export function hasStoredCredentials(slot: number): boolean {
  try {
    // LocalAuth keeps the Chrome profile under .wwebjs_auth/session-<clientId>.
    // The IndexedDB directory only appears once WhatsApp has stored keys, so it
    // is a better "was linked" signal than the folder merely existing.
    const base = path.join(process.cwd(), ".wwebjs_auth", sessionFolderForSlot(slot));
    const indexedDb = path.join(base, "Default", "IndexedDB");
    if (!fs.existsSync(indexedDb)) return false;
    return fs.readdirSync(indexedDb).some((entry) => entry.includes("whatsapp"));
  } catch {
    return false;
  }
}

/** Status for every slot in the pool (1..MAX_WHATSAPP_SESSIONS). */
export function getAllWhatsAppStatuses() {
  const sessions = [];
  for (let slot = 1; slot <= MAX_WHATSAPP_SESSIONS; slot++) {
    sessions.push(getWhatsAppStatus(slot));
  }
  return sessions;
}

/** True when at least one slot in the pool is fully connected. */
export function hasAnyConnectedWhatsAppSession(): boolean {
  for (const session of whatsappSessions.values()) {
    if (session.status === "CONNECTED") return true;
  }
  return false;
}

/** The 1-based slots that are currently connected, in ascending order. */
export function getConnectedWhatsAppSlots(): number[] {
  const slots: number[] = [];
  for (let slot = 1; slot <= MAX_WHATSAPP_SESSIONS; slot++) {
    if (whatsappSessions.get(slot)?.status === "CONNECTED") slots.push(slot);
  }
  return slots;
}

export function initializeWhatsApp(slot: number = 1) {
  if (!isValidSlot(slot)) {
    logger.error(`Invalid WhatsApp slot ${slot}. Must be 1-${MAX_WHATSAPP_SESSIONS}.`);
    return;
  }

  gatewayHostProcess = true;
  const session = getSession(slot);

  if (session.client && session.status === "CONNECTED") {
    logger.info(`WhatsApp client (slot ${slot}) already initialized and active.`);
    return;
  }

  // If a previous client is lingering or in a failed state, destroy it first
  if (session.client) {
    try {
      session.client.destroy().catch(() => {});
    } catch {}
    session.client = null;
  }

  // Release any stale Chrome SingletonLock left by previous unexpected process crashes
  try {
    const lockPath = path.join(process.cwd(), ".wwebjs_auth", sessionFolderForSlot(slot), "SingletonLock");
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {}

  logger.info(`Launching WhatsApp Web virtual browser session (slot ${slot})...`);
  // Every launch gets a generation stamp. Event handlers from a previous client
  // can still fire after a re-initialize (the old browser takes time to die);
  // comparing against this stamp makes those stale callbacks no-ops instead of
  // letting them clobber the new session's state.
  session.generation++;
  const generationAtLaunch = session.generation;
  session.status = "CONNECTING";
  session.qr = "";
  session.qrDataUrl = "";
  session.phoneNumber = "";
  session.pushName = "";
  session.lastError = "";
  session.loadingPercent = 0;

  try {
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: clientIdForSlot(slot)
      }),
      // Deliberately NOT pinning a remote web version by default.
      //
      // This used to force `{ type: "remote", remotePath: <wa-version repo> }`.
      // When that HTML's WhatsApp build drifts from the module names this
      // library injects, `window.WWebJS` never gets defined, whatsapp-web.js
      // throws "ready timeout" *inside a page binding*, and the `ready` event
      // silently never fires — the exact "QR scans but never connects" symptom.
      // The library's own default (`{ type: "local" }` + its tested webVersion)
      // is the supported path. Override only if you must pin a build.
      ...(process.env.WHATSAPP_WEB_REMOTE_PATH
        ? {
            webVersionCache: {
              type: "remote" as const,
              remotePath: process.env.WHATSAPP_WEB_REMOTE_PATH,
              strict: false,
            },
          }
        : {}),
      ...(process.env.WHATSAPP_WEB_VERSION ? { webVersion: process.env.WHATSAPP_WEB_VERSION } : {}),
      // Never let the library give up on its own: our watchdog owns timeouts,
      // and qrMaxRetries 0 keeps refreshing the QR while the user fetches their phone.
      authTimeoutMs: 0,
      qrMaxRetries: 0,
      takeoverOnConflict: true,
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          // Chrome throttles timers in background tabs, which stalls WhatsApp's
          // app-state sync in a headless profile and delays/blocks `ready`.
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ]
      }
    });
    session.client = client;

    client.on("qr", async (qr: string) => {
      if (session.generation !== generationAtLaunch) return;
      logger.info(`WhatsApp QR Code received for slot ${slot} (${qr.length} chars). Scan from settings panel.`);
      session.qr = qr;
      try {
        session.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 256 });
      } catch (err: any) {
        logger.warn("Failed to generate QR data URL: " + err?.message);
      }
      // Only step back to QR_READY if we have not already progressed past it.
      if (session.status === "CONNECTING" || session.status === "QR_READY") {
        session.status = "QR_READY";
      }
    });

    // The phone accepted the pairing. `ready` may still never arrive (see the
    // WhatsAppSessionState docblock), so this is where we hand off to the
    // watchdog that confirms readiness from the live socket state.
    client.on("authenticated", () => {
      if (session.generation !== generationAtLaunch) return;
      logger.info(`WhatsApp account ${slot} authenticated; waiting for WhatsApp to finish syncing...`);
      session.qr = "";
      session.qrDataUrl = "";
      if (session.status !== "CONNECTED") session.status = "AUTHENTICATING";
      startReadyWatchdog(session);
    });

    // Offline-sync progress, so the UI can show real movement instead of a spinner.
    client.on("loading_screen", (percent: number) => {
      if (session.generation !== generationAtLaunch) return;
      const pct = Number(percent);
      if (Number.isFinite(pct)) session.loadingPercent = pct;
      if (session.status === "QR_READY" || session.status === "CONNECTING") {
        session.status = "AUTHENTICATING";
      }
    });

    // Live socket transitions. This is the most reliable connect signal we get
    // as an event, and it catches sessions restored from disk that never emit
    // `authenticated` because they were already paired.
    client.on("change_state", (state: string) => {
      if (session.generation !== generationAtLaunch) return;
      logger.info(`WhatsApp account ${slot} socket state: ${state}`);
      if (state === "CONNECTED") {
        void markSessionConnected(session);
      } else if (state === "PAIRING" || state === "OPENING") {
        if (session.status !== "CONNECTED") session.status = "AUTHENTICATING";
      }
    });

    client.on("ready", () => {
      if (session.generation !== generationAtLaunch) return;
      void markSessionConnected(session);
    });

    // Inbound replies from leads. whatsapp-web.js fires "message" for messages
    // received from others (not self). We forward the sender + body to the
    // registered handler, which matches it to a lead and records the reply.
    client.on("message", (msg: any) => {
      try {
        if (!msg || msg.fromMe) return;
        // Ignore group chats and status broadcasts — only direct 1:1 leads.
        const from: string = msg.from || "";
        if (!from.endsWith("@c.us")) return;
        const body: string = msg.body || "";
        if (incomingWhatsAppHandler) {
          incomingWhatsAppHandler({ from, body, timestamp: (msg.timestamp || Math.floor(Date.now() / 1000)), slot });
        }
      } catch (err: any) {
        logger.warn(`Failed to process inbound WhatsApp message: ${err?.message || err}`);
      }
    });

    client.on("auth_failure", async (msg: string) => {
      if (session.generation !== generationAtLaunch) return;
      logger.error(`WhatsApp Web auth failure (slot ${slot}): ${msg}`);
      try {
        if (session.client) await session.client.destroy();
      } catch {}
      resetSessionState(session, `Authentication failed: ${msg || "WhatsApp rejected the session"}. Scan the QR code again.`);
    });

    client.on("disconnected", async (reason: string) => {
      if (session.generation !== generationAtLaunch) return;
      logger.warn(`WhatsApp session (slot ${slot}) was disconnected: ${reason}`);
      try {
        if (session.client) await session.client.destroy();
      } catch {}
      resetSessionState(
        session,
        reason === "LOGOUT"
          ? "This account was unlinked from the phone. Scan the QR code again to reconnect."
          : `The session dropped (${reason}). Scan the QR code again to reconnect.`
      );
    });

    // Kick off the watchdog immediately rather than only on `authenticated`:
    // a session restored from disk is already paired and may emit neither `qr`
    // nor `authenticated`, so polling is the only thing that will notice it
    // came up.
    startReadyWatchdog(session);

    client.initialize().catch(async (err: any) => {
      if (session.generation !== generationAtLaunch) return;
      const detail = err?.message || String(err);
      logger.error(`Failed to initialize WhatsApp Web Client (slot ${slot}): ${detail}`);
      try {
        if (session.client) await session.client.destroy();
      } catch {}
      resetSessionState(session, `Could not start the gateway: ${detail}`);
    });
  } catch (error: any) {
    const detail = error?.message || String(error);
    logger.error(`Failed to initialize WhatsApp Web Client (slot ${slot}): ${detail}`);
    try {
      if (session.client) session.client.destroy().catch(() => {});
    } catch {}
    resetSessionState(session, `Could not start the gateway: ${detail}`);
  }
}

/**
 * Re-launch every slot that already has credentials on disk.
 *
 * Called once at server start so a restart does not force the user to re-scan
 * five QR codes. Sessions that were never linked are left alone.
 */
export function restoreWhatsAppSessions(): number {
  let restored = 0;
  for (let slot = 1; slot <= MAX_WHATSAPP_SESSIONS; slot++) {
    if (!hasStoredCredentials(slot)) continue;
    const session = whatsappSessions.get(slot);
    if (session?.client) continue; // already running
    logger.info(`Restoring saved WhatsApp session for account ${slot}...`);
    initializeWhatsApp(slot);
    restored++;
  }
  if (restored === 0) logger.info("No saved WhatsApp sessions to restore.");
  return restored;
}

/**
 * Tear down browsers without logging out or wiping credentials.
 *
 * Used on graceful shutdown: a full `disconnectWhatsApp` would delete the
 * session folders and force every account to be re-scanned on the next boot.
 */
export async function shutdownWhatsAppSessions(): Promise<void> {
  for (const session of whatsappSessions.values()) {
    stopReadyWatchdog(session);
    if (!session.client) continue;
    try {
      await Promise.race([
        session.client.destroy(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      try {
        await session.client.pupBrowser?.close();
      } catch {}
    }
    session.client = null;
    session.status = "DISCONNECTED";
  }
}

export async function disconnectWhatsApp(slot: number = 1): Promise<boolean> {
  logger.info(`Processing WhatsApp disconnect request (slot ${slot})...`);

  if (!isValidSlot(slot)) {
    logger.error(`Invalid WhatsApp slot ${slot}. Must be 1-${MAX_WHATSAPP_SESSIONS}.`);
    return false;
  }

  const session = getSession(slot);
  // Orphan any in-flight event handlers and the watchdog before tearing down,
  // so nothing resurrects this slot mid-disconnect.
  session.generation++;
  stopReadyWatchdog(session);

  if (session.client) {
    try {
      logger.info(`Logging out WhatsApp web client slot ${slot} (3s timeout)...`);
      await Promise.race([
        session.client.logout(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      logger.info("WhatsApp soft logout completed.");
    } catch (err: any) {
      logger.warn("WhatsApp logout bypassed/failed: " + (err?.message || String(err)));
    }

    try {
      logger.info("Destroying WhatsApp browser session...");
      await Promise.race([
        session.client.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      logger.info("WhatsApp browser destroyed.");
    } catch (err: any) {
      logger.warn("WhatsApp destroy failed: " + (err?.message || String(err)));
      if (session.client?.pupBrowser) {
        try {
          logger.info("Forcing closure of Puppeteer browser...");
          await session.client.pupBrowser.close();
        } catch (closeErr: any) {
          logger.warn("Forcing browser close failed: " + (closeErr?.message || String(closeErr)));
        }
      }
    }
    session.client = null;
  }

  // Hard logout: Wipe session credentials from disk to release locks and clear session
  try {
    const sessionPath = path.join(process.cwd(), ".wwebjs_auth", sessionFolderForSlot(slot));
    // Legacy folder only ever existed for the primary slot.
    const legacySessionPath = slot === 1
      ? path.join(process.cwd(), ".wwebjs_auth", "session-nexaleadai-outreach")
      : null;
    logger.info(`Session Path: ${sessionPath} | Exists: ${fs.existsSync(sessionPath)}`);
    if (fs.existsSync(sessionPath) || (legacySessionPath && fs.existsSync(legacySessionPath))) {
      logger.info("Wiping local session authentication directories...");
      // Introduce a slight delay (1000ms) to allow OS to release any file locks after destroy()
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
      if (legacySessionPath && fs.existsSync(legacySessionPath)) fs.rmSync(legacySessionPath, { recursive: true, force: true });
    }
    logger.success("Session credentials wiped from disk.");
  } catch (err: any) {
    logger.warn("Failed to delete session files: " + (err?.message || String(err)));
  }

  resetSessionState(session, "");
  logger.success(`WhatsApp (slot ${slot}) disconnected successfully.`);
  return true;
}

/** Disconnect every slot in the pool. Returns true if all succeeded. */
export async function disconnectAllWhatsApp(): Promise<boolean> {
  let allOk = true;
  for (let slot = 1; slot <= MAX_WHATSAPP_SESSIONS; slot++) {
    const session = whatsappSessions.get(slot);
    if (session?.client || session?.status === "CONNECTED") {
      const ok = await disconnectWhatsApp(slot).catch(() => false);
      allOk = allOk && ok;
    }
  }
  return allOk;
}

export function formatWhatsAppJid(phone: string): string | null {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[^0-9]/g, "");

  // Strip leading zero if present (e.g. 09604314675 -> 9604314675)
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  // Handle case where country code is followed by a leading zero (e.g. 9109604314675 -> 919604314675)
  if (cleaned.startsWith("910") && cleaned.length === 13) {
    cleaned = "91" + cleaned.substring(3);
  }

  // Prepend default Indian region prefix if number is exactly 10 digits
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  // Validate standard digit length range (10 to 15 digits including country code)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return null;
  }

  return `${cleaned}@c.us`;
}

/**
 * Return the live, connected client for a slot, or null if that slot is not
 * currently connected.
 */
function connectedClientForSlot(slot: number): any | null {
  const session = whatsappSessions.get(slot);
  if (session && session.status === "CONNECTED" && session.client) return session.client;
  return null;
}

/** Round-robin cursor for picking a connected slot when none is specified. */
let roundRobinCursor = 0;

/**
 * Pick a connected slot to send from. If `preferredSlot` is connected it is
 * used; otherwise the next connected slot is chosen in round-robin order so
 * sends spread across all linked accounts. Returns null if nothing connected.
 */
export function pickConnectedSlot(preferredSlot?: number): number | null {
  if (preferredSlot && connectedClientForSlot(preferredSlot)) return preferredSlot;
  const connected = getConnectedWhatsAppSlots();
  if (connected.length === 0) return null;
  const slot = connected[roundRobinCursor % connected.length];
  roundRobinCursor = (roundRobinCursor + 1) % connected.length;
  return slot;
}

/**
 * Send an outreach message through a specific WhatsApp Web session slot.
 *
 * `slot` selects which linked account sends the message (1-based). When it is
 * omitted or that slot is not connected, a connected slot is chosen in
 * round-robin order so campaigns rotate across all linked business lines.
 */
export async function sendWhatsAppMessage(phone: string, text: string, slot?: number): Promise<boolean> {
  const chosenSlot = pickConnectedSlot(slot);
  if (!chosenSlot) {
    if (!gatewayHostProcess) {
      // Almost certainly the campaign worker: the sessions live in the API
      // process, so this one has nothing to send through no matter how many
      // accounts the user linked in the dashboard.
      logger.error(
        "WhatsApp send attempted in a process that does not host the WhatsApp Web gateway. " +
          "The session pool lives in the API server process; this process has none. " +
          "Run campaigns in the API process, or expose the gateway to the worker."
      );
    } else {
      logger.error("No WhatsApp client is connected. Scan a QR code in the dashboard first.");
    }
    return false;
  }
  const client = connectedClientForSlot(chosenSlot);
  if (!client) {
    logger.error(`WhatsApp client (slot ${chosenSlot}) is not connected.`);
    return false;
  }

  try {
    const chatId = formatWhatsAppJid(phone);
    if (!chatId) {
      logger.error(`Invalid phone number format for WhatsApp delivery: ${phone}`);
      return false;
    }

    // Validate number is registered on WhatsApp before sending
    try {
      const isRegistered = await client.isRegisteredUser(chatId);
      if (!isRegistered) {
        logger.warn(`WhatsApp number ${phone} (${chatId}) is NOT registered on WhatsApp. Skipping.`);
        return false;
      }
    } catch (validationErr: any) {
      logger.warn(`Could not verify WhatsApp registration for ${phone}: ${validationErr?.message || JSON.stringify(validationErr)}. Attempting send anyway...`);
    }

    logger.info(`Sending automated WhatsApp outreach message to ${chatId} via slot ${chosenSlot}.`);

    await client.sendMessage(chatId, text);
    logger.success(`WhatsApp outreach successfully sent to ${phone} via slot ${chosenSlot}!`);
    return true;
  } catch (error: any) {
    // Properly serialize error (fixes the cryptic "t: t" display)
    const errorMsg = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));
    logger.error(`Failed to send WhatsApp message to ${phone} via slot ${chosenSlot}: ${errorMsg}`);
    return false;
  }
}

/** Outcome of a test send, with a reason the UI can show the user verbatim. */
export interface WhatsAppTestSendResult {
  ok: boolean;
  error?: string;
  /** The normalised JID the message was addressed to, when resolved. */
  target?: string;
}

/** The copy used when the caller does not supply their own test message. */
export const DEFAULT_WHATSAPP_TEST_MESSAGE =
  "Hello from LeadGenPilot! This is a test outreach message verifying your gateway connection. 🚀";

/**
 * Send a one-off test message from a specific linked account.
 *
 * Returns a structured result rather than a bare boolean so the caller can tell
 * an unconnected gateway apart from a bad number or an unregistered recipient,
 * and surface that difference instead of a generic failure.
 */
export async function sendWhatsAppTestMessage(
  phone?: string,
  slot: number = 1,
  message?: string
): Promise<WhatsAppTestSendResult> {
  const client = connectedClientForSlot(slot);
  if (!client) {
    logger.error(`WhatsApp client (slot ${slot}) is not connected for sending test message.`);
    return {
      ok: false,
      error: `WhatsApp account ${slot} is not connected. Link it by scanning the QR code first.`,
    };
  }
  try {
    let targetChatId = "";
    if (phone && phone.trim() !== "") {
      const formatted = formatWhatsAppJid(phone);
      if (!formatted) {
        logger.warn(`Rejected test message: "${phone}" is not a valid WhatsApp number.`);
        return {
          ok: false,
          error:
            "That is not a valid WhatsApp number. Enter digits with the country code, for example 919876543210.",
        };
      }
      targetChatId = formatted;
    } else {
      if (client.info && client.info.wid) {
        targetChatId = client.info.wid._serialized;
      } else {
        return {
          ok: false,
          error: "No recipient was provided and this account's own number is not available yet.",
        };
      }
    }

    // Validate registration
    try {
      logger.info(`Validating if ${targetChatId} is registered on WhatsApp...`);
      const isRegistered = await client.isRegisteredUser(targetChatId);
      if (!isRegistered) {
        logger.warn(`WhatsApp target ${targetChatId} is NOT registered on WhatsApp.`);
        return {
          ok: false,
          target: targetChatId,
          error: "That number is not registered on WhatsApp.",
        };
      }
      logger.info(`Target ${targetChatId} is a registered WhatsApp user.`);
    } catch (valErr: any) {
      logger.warn(`Could not verify WhatsApp registration for ${targetChatId}: ${valErr?.message || String(valErr)}. Sending anyway...`);
    }

    const text = message && message.trim() !== "" ? message : DEFAULT_WHATSAPP_TEST_MESSAGE;
    logger.info(`Sending test WhatsApp message to ${targetChatId} via slot ${slot}.`);
    await client.sendMessage(targetChatId, text);
    logger.success(`Test WhatsApp message successfully sent to ${targetChatId} via slot ${slot}!`);
    return { ok: true, target: targetChatId };
  } catch (error: any) {
    const errorMsg = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));
    logger.error(`Failed to send test WhatsApp message: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}



