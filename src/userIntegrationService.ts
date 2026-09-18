/**
 * User Integration Service
 * Manages user-specific integrations (SMTP, Google Sheets, WhatsApp)
 * Configurations are encrypted before storage
 */

import { prisma } from "./prisma.js";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-32-char-encryption-key!!";
const ALGORITHM = "aes-256-cbc";

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName?: string;
}

interface GoogleSheetConfig {
  webhookUrl: string;
  sheetName?: string;
}

interface WhatsAppConfig {
  apiUrl?: string;
  apiKey?: string;
  phoneNumber?: string;
}

/**
 * Meta WhatsApp Business Cloud API credentials. Stored encrypted like every
 * other integration config. Mirrors MetaCloudConfig in whatsappCloudService.
 */
export interface WhatsAppCloudConfig {
  phoneNumberId: string;
  wabaId?: string;
  accessToken: string;
  verifyToken: string;
  appSecret?: string;
  defaultTemplateName?: string;
  defaultTemplateLang?: string;
}

/**
 * Which WhatsApp transport the user wants outreach to go through.
 * Persisted separately so switching providers does not discard either
 * credential set.
 */
export interface WhatsAppProviderPref {
  provider: "web" | "cloud";
}

export type IntegrationType =
  | "smtp"
  | "google_sheet"
  | "whatsapp"
  | "whatsapp_cloud"
  | "whatsapp_provider";

type IntegrationConfig =
  | SMTPConfig
  | GoogleSheetConfig
  | WhatsAppConfig
  | WhatsAppCloudConfig
  | WhatsAppProviderPref;

/**
 * Encrypt sensitive configuration data
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * Decrypt configuration data
 */
function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Create or update user integration
 */
export async function saveUserIntegration(
  userId: string,
  type: IntegrationType,
  config: IntegrationConfig,
  label?: string
) {
  const encryptedConfig = encrypt(JSON.stringify(config));

  // Check if integration already exists
  const existing = await prisma.userIntegration.findFirst({
    where: { userId, type },
  });

  if (existing) {
    return await prisma.userIntegration.update({
      where: { id: existing.id },
      data: {
        config: encryptedConfig,
        label: label || existing.label,
        updatedAt: new Date(),
      },
    });
  }

  return await prisma.userIntegration.create({
    data: {
      userId,
      type,
      config: encryptedConfig,
      label,
      enabled: true,
    },
  });
}

/**
 * Get user integration by type
 */
export async function getUserIntegration(
  userId: string,
  type: IntegrationType
): Promise<IntegrationConfig | null> {
  const integration = await prisma.userIntegration.findFirst({
    where: { userId, type, enabled: true },
  });

  if (!integration) return null;

  try {
    const decryptedConfig = decrypt(integration.config);
    return JSON.parse(decryptedConfig);
  } catch (error) {
    console.error(`Failed to decrypt ${type} config:`, error);
    return null;
  }
}

/**
 * List every enabled SMTP integration across all users, with decrypted
 * credentials. Used by the email-reply poller to know which mailboxes to watch.
 */
export async function getAllEnabledSmtpConfigs(): Promise<(SMTPConfig & { userId: string | null })[]> {
  const integrations = await prisma.userIntegration.findMany({
    where: { type: "smtp", enabled: true },
  });
  const results: (SMTPConfig & { userId: string | null })[] = [];
  for (const integ of integrations) {
    try {
      const cfg = JSON.parse(decrypt(integ.config)) as SMTPConfig;
      if (cfg && cfg.host && cfg.user && cfg.password) {
        results.push({ ...cfg, userId: integ.userId });
      }
    } catch {
      // skip undecryptable configs
    }
  }
  return results;
}

/**
 * Get all user integrations
 */
export async function getAllUserIntegrations(userId: string) {
  const integrations = await prisma.userIntegration.findMany({
    where: { userId },
    select: {
      id: true,
      type: true,
      label: true,
      enabled: true,
      lastUsedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return integrations;
}

/**
 * Delete user integration
 */
export async function deleteUserIntegration(userId: string, integrationId: string) {
  return await prisma.userIntegration.deleteMany({
    where: { id: integrationId, userId },
  });
}

/**
 * Toggle integration enabled status
 */
export async function toggleUserIntegration(userId: string, integrationId: string, enabled: boolean) {
  return await prisma.userIntegration.updateMany({
    where: { id: integrationId, userId },
    data: { enabled },
  });
}

/**
 * Update last used timestamp
 */
export async function markIntegrationUsed(integrationId: string) {
  return await prisma.userIntegration.update({
    where: { id: integrationId },
    data: { lastUsedAt: new Date() },
  });
}

/**
 * Test SMTP connection
 */
export async function testSMTPConnection(config: SMTPConfig): Promise<boolean> {
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });

    await transporter.verify();
    return true;
  } catch (error) {
    console.error("SMTP test failed:", error);
    return false;
  }
}

/**
 * Test Google Sheet webhook
 */
export async function testGoogleSheetWebhook(config: GoogleSheetConfig): Promise<boolean> {
  try {
    const testData = {
      test: true,
      timestamp: new Date().toISOString(),
      message: "Test connection from NexaLeadAi",
    };

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testData),
    });

    return response.ok;
  } catch (error) {
    console.error("Google Sheet webhook test failed:", error);
    return false;
  }
}

/**
 * Fetch the decrypted Meta Cloud API credentials for a user, or null when the
 * integration is missing/disabled/undecryptable.
 */
export async function getWhatsAppCloudConfig(userId: string): Promise<WhatsAppCloudConfig | null> {
  const config = (await getUserIntegration(userId, "whatsapp_cloud")) as WhatsAppCloudConfig | null;
  if (!config || !config.phoneNumberId || !config.accessToken) return null;
  return config;
}

/**
 * Which WhatsApp transport this user has selected. Defaults to the legacy QR
 * web gateway so existing users keep their current behaviour untouched.
 */
export async function getWhatsAppProvider(userId: string): Promise<"web" | "cloud"> {
  const pref = (await getUserIntegration(userId, "whatsapp_provider")) as WhatsAppProviderPref | null;
  return pref?.provider === "cloud" ? "cloud" : "web";
}

export async function setWhatsAppProvider(userId: string, provider: "web" | "cloud") {
  return await saveUserIntegration(userId, "whatsapp_provider", { provider }, "WhatsApp Provider");
}

/**
 * Every enabled Cloud API integration with decrypted credentials.
 * The webhook needs this because Meta calls one shared callback URL for all
 * tenants; the owning user is identified by the phone_number_id in the payload.
 */
export async function getAllCloudConfigs(): Promise<(WhatsAppCloudConfig & { userId: string | null })[]> {
  const integrations = await prisma.userIntegration.findMany({
    where: { type: "whatsapp_cloud", enabled: true },
  });

  const results: (WhatsAppCloudConfig & { userId: string | null })[] = [];
  for (const integ of integrations) {
    try {
      const cfg = JSON.parse(decrypt(integ.config)) as WhatsAppCloudConfig;
      if (cfg?.phoneNumberId && cfg?.accessToken) {
        results.push({ ...cfg, userId: integ.userId });
      }
    } catch {
      // skip undecryptable configs
    }
  }
  return results;
}

/**
 * Resolve the tenant that owns an inbound webhook event by its phone number ID.
 */
export async function findCloudConfigByPhoneNumberId(
  phoneNumberId: string
): Promise<(WhatsAppCloudConfig & { userId: string | null }) | null> {
  if (!phoneNumberId) return null;
  const all = await getAllCloudConfigs();
  return all.find((c) => c.phoneNumberId === phoneNumberId) || null;
}

/**
 * Find a config whose verifyToken matches the one Meta presents during the
 * webhook handshake. Meta sends no tenant identifier on that GET request, so the
 * token itself is the only way to authorise it.
 */
export async function findCloudConfigByVerifyToken(
  verifyToken: string
): Promise<(WhatsAppCloudConfig & { userId: string | null }) | null> {
  if (!verifyToken) return null;
  const all = await getAllCloudConfigs();
  return all.find((c) => c.verifyToken && c.verifyToken === verifyToken) || null;
}
