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

// SMTP Outreach Sending
export interface EmailSendResult {
  success: boolean;
  error?: string;
}

export async function sendEmailOutreach(
  to: string, 
  subject: string, 
  body: string,
  smtpConfig?: { host: string; port: number; secure: boolean; user: string; pass: string; from: string }
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
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false },
        };

    const transporter = nodemailer.createTransport(transportConfig);

    logger.info(`Sending email outreach to: ${to}...`);
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    const mailOptions: any = {
      from: from ? `"${from}" <${user}>` : `"Outreach Agent" <${user}>`,
      to,
      subject,
    };
    if (isHtml) {
      mailOptions.html = body;
      // Provide a plain-text fallback by stripping HTML tags
      mailOptions.text = body.replace(/<[^>]*>/g, "").replace(/\s{2,}/g, " ").trim();
    } else {
      mailOptions.text = body;
    }
    await transporter.sendMail(mailOptions);

    logger.success(`Email outreach successfully sent to ${to}!`);
    return { success: true };
  } catch (error: any) {
    logger.error(`Failed to send email to ${to}: ${error}`);
    return { success: false, error: classifyEmailError(error) };
  }
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
let whatsappClient: any = null;
let whatsappQr = "";
let whatsappStatus: "DISCONNECTED" | "CONNECTING" | "QR_READY" | "CONNECTED" = "DISCONNECTED";

// Handler invoked when an INBOUND WhatsApp message (a lead reply) arrives.
// Registered by the server so it can match the sender to a lead and record the
// conversation. Kept as a simple module-level callback to avoid a hard import
// cycle between the outreach service and the conversation/CRM layers.
type IncomingWhatsAppHandler = (params: { from: string; body: string; timestamp: number }) => void;
let incomingWhatsAppHandler: IncomingWhatsAppHandler | null = null;

export function setIncomingWhatsAppHandler(handler: IncomingWhatsAppHandler) {
  incomingWhatsAppHandler = handler;
}

export function getWhatsAppStatus() {
  return {
    status: whatsappStatus,
    qr: whatsappQr
  };
}

export function initializeWhatsApp() {
  if (whatsappClient) {
    logger.info("WhatsApp client already initialized or active.");
    return;
  }

  logger.info("Launching WhatsApp Web virtual browser session...");
  whatsappStatus = "CONNECTING";
  whatsappQr = "";

  try {
    whatsappClient = new Client({
      authStrategy: new LocalAuth({
        clientId: "nexaleadai-outreach"
      }),
      webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
        strict: false
      },
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]
      }
    });

    whatsappClient.on("qr", (qr: string) => {
      logger.info("WhatsApp QR Code received. Scan from settings panel.");
      whatsappQr = qr;
      whatsappStatus = "QR_READY";
    });

    whatsappClient.on("ready", () => {
      logger.success("WhatsApp Web Client authenticated and active!");
      whatsappStatus = "CONNECTED";
      whatsappQr = "";
    });

    // Inbound replies from leads. whatsapp-web.js fires "message" for messages
    // received from others (not self). We forward the sender + body to the
    // registered handler, which matches it to a lead and records the reply.
    whatsappClient.on("message", (msg: any) => {
      try {
        if (!msg || msg.fromMe) return;
        // Ignore group chats and status broadcasts — only direct 1:1 leads.
        const from: string = msg.from || "";
        if (!from.endsWith("@c.us")) return;
        const body: string = msg.body || "";
        if (incomingWhatsAppHandler) {
          incomingWhatsAppHandler({ from, body, timestamp: (msg.timestamp || Math.floor(Date.now() / 1000)) });
        }
      } catch (err: any) {
        logger.warn(`Failed to process inbound WhatsApp message: ${err?.message || err}`);
      }
    });

    whatsappClient.on("auth_failure", (msg: string) => {
      logger.error(`WhatsApp Web auth failure: ${msg}`);
      whatsappStatus = "DISCONNECTED";
      whatsappClient = null;
      whatsappQr = "";
    });

    whatsappClient.on("disconnected", (reason: string) => {
      logger.warn(`WhatsApp session was disconnected: ${reason}`);
      whatsappStatus = "DISCONNECTED";
      whatsappClient = null;
      whatsappQr = "";
    });

    whatsappClient.initialize();
  } catch (error) {
    logger.error("Failed to initialize WhatsApp Web Client:", error);
    whatsappStatus = "DISCONNECTED";
    whatsappClient = null;
  }
}

export async function disconnectWhatsApp(): Promise<boolean> {
  logger.info("Processing WhatsApp disconnect request...");
  
  if (whatsappClient) {
    try {
      logger.info("Logging out WhatsApp web client (3s timeout)...");
      await Promise.race([
        whatsappClient.logout(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      logger.info("WhatsApp soft logout completed.");
    } catch (err: any) {
      logger.warn("WhatsApp logout bypassed/failed: " + (err?.message || String(err)));
    }

    try {
      logger.info("Destroying WhatsApp browser session...");
      await Promise.race([
        whatsappClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      logger.info("WhatsApp browser destroyed.");
    } catch (err: any) {
      logger.warn("WhatsApp destroy failed: " + (err?.message || String(err)));
      if (whatsappClient.pupBrowser) {
        try {
          logger.info("Forcing closure of Puppeteer browser...");
          await whatsappClient.pupBrowser.close();
        } catch (closeErr: any) {
          logger.warn("Forcing browser close failed: " + (closeErr?.message || String(closeErr)));
        }
      }
    }
    whatsappClient = null;
  }

  // Hard logout: Wipe session credentials from disk to release locks and clear session
  try {
    const sessionPath = path.join(process.cwd(), ".wwebjs_auth", "session-nexaleadai-outreach");
    logger.info(`Session Path: ${sessionPath} | Exists: ${fs.existsSync(sessionPath)}`);
    if (fs.existsSync(sessionPath)) {
      logger.info("Wiping local session authentication directories...");
      // Introduce a slight delay (1000ms) to allow OS to release any file locks after destroy()
      await new Promise(resolve => setTimeout(resolve, 1000));
      fs.rmSync(sessionPath, { recursive: true, force: true });
      logger.success("Session credentials wiped from disk.");
    }
  } catch (err: any) {
    logger.warn("Failed to delete session files: " + (err?.message || String(err)));
  }

  whatsappStatus = "DISCONNECTED";
  whatsappQr = "";
  logger.success("WhatsApp disconnected successfully.");
  return true;
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

export async function sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
  if (whatsappStatus !== "CONNECTED" || !whatsappClient) {
    logger.error("WhatsApp client is not connected. Scan the QR code in the dashboard first.");
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
      const isRegistered = await whatsappClient.isRegisteredUser(chatId);
      if (!isRegistered) {
        logger.warn(`WhatsApp number ${phone} (${chatId}) is NOT registered on WhatsApp. Skipping.`);
        return false;
      }
    } catch (validationErr: any) {
      logger.warn(`Could not verify WhatsApp registration for ${phone}: ${validationErr?.message || JSON.stringify(validationErr)}. Attempting send anyway...`);
    }

    logger.info(`Sending automated WhatsApp outreach message to: ${chatId}`);
    
    await whatsappClient.sendMessage(chatId, text);
    logger.success(`WhatsApp outreach successfully sent to ${phone}!`);
    return true;
  } catch (error: any) {
    // Properly serialize error (fixes the cryptic "t: t" display)
    const errorMsg = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));
    logger.error(`Failed to send WhatsApp message to ${phone}: ${errorMsg}`);
    return false;
  }
}

export async function sendWhatsAppTestMessage(phone?: string): Promise<boolean> {
  if (whatsappStatus !== "CONNECTED" || !whatsappClient) {
    logger.error("WhatsApp client is not connected for sending test message.");
    return false;
  }
  try {
    let targetChatId = "";
    if (phone && phone.trim() !== "") {
      const formatted = formatWhatsAppJid(phone);
      if (!formatted) {
        logger.error(`Invalid phone number format for test message: ${phone}`);
        return false;
      }
      targetChatId = formatted;
    } else {
      if (whatsappClient.info && whatsappClient.info.wid) {
        targetChatId = whatsappClient.info.wid._serialized;
      } else {
        logger.error("No self number available and no test number provided.");
        return false;
      }
    }
    
    // Validate registration
    try {
      logger.info(`Validating if ${targetChatId} is registered on WhatsApp...`);
      const isRegistered = await whatsappClient.isRegisteredUser(targetChatId);
      if (!isRegistered) {
        logger.error(`WhatsApp target ${targetChatId} is NOT registered on WhatsApp. Cannot send test message.`);
        return false;
      }
      logger.info(`Target ${targetChatId} is a registered WhatsApp user.`);
    } catch (valErr: any) {
      logger.warn(`Could not verify WhatsApp registration for ${targetChatId}: ${valErr?.message || String(valErr)}. Sending anyway...`);
    }
    
    const text = "Hello from NexaLeadAi! This is a test outreach message verifying your gateway connection. 🚀";
    logger.info(`Sending test WhatsApp message to: ${targetChatId}`);
    await whatsappClient.sendMessage(targetChatId, text);
    logger.success(`Test WhatsApp message successfully sent to ${targetChatId}!`);
    return true;
  } catch (error: any) {
    const errorMsg = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));
    logger.error(`Failed to send test WhatsApp message: ${errorMsg}`);
    return false;
  }
}



