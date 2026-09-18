/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from "dotenv";

dotenv.config();

/**
 * Centralized, validated environment configuration.
 *
 * This module is the single source of truth for reading environment variables.
 * It normalizes types, applies sensible defaults, and surfaces configuration
 * warnings at startup so production deployments fail loud rather than silent.
 */

function toInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  return (
    v === "" ||
    v === "YOUR_WEBHOOK_URL" ||
    v === "MY_GEMINI_API_KEY" ||
    v === "YOUR_OPENROUTER_API_KEY" ||
    v === "MY_APP_URL"
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  get isProduction() {
    return this.nodeEnv === "production";
  },

  // Render/most PaaS inject PORT. Fall back to 3000 for local dev.
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",

  // Optional API key. When set, all /api/* mutating routes require it.
  apiKey: process.env.API_KEY || "",

  // Comma-separated list of allowed origins. "*" allows all (dev default).
  corsOrigins: (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Rate limiting
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 300),

  // Request body size limit
  bodyLimit: process.env.BODY_LIMIT || "1mb",

  // Logging
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  logMaxBytes: toInt(process.env.LOG_MAX_BYTES, 5 * 1024 * 1024), // 5MB

  // Feature integrations
  googleSheetWebhookUrl: process.env.GOOGLE_SHEET_WEBHOOK_URL || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",

  // SMTP
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: toInt(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "",
  },

  // Database (MySQL via Prisma)
  databaseUrl: process.env.DATABASE_URL || "",

  // Authentication
  auth: {
    // Secret used to sign session JWTs. MUST be set to a strong random value
    // in production. Falls back to a dev-only default locally.
    jwtSecret: process.env.JWT_SECRET || "dev-insecure-jwt-secret-change-me",
    // Session lifetime in days.
    sessionDays: toInt(process.env.AUTH_SESSION_DAYS, 7),
    // Cookie name for the session token.
    cookieName: process.env.AUTH_COOKIE_NAME || "nexaleadai_session",
    // OTP configuration.
    otpLength: 6,
    otpTtlMinutes: toInt(process.env.OTP_TTL_MINUTES, 10),
    otpMaxAttempts: toInt(process.env.OTP_MAX_ATTEMPTS, 5),
    // Minimum seconds between OTP resends for the same email.
    otpResendSeconds: toInt(process.env.OTP_RESEND_SECONDS, 30),
    // Product name shown in OTP emails.
    appName: process.env.APP_NAME || "NexaLeadAi",
    // Brute-force lockout.
    maxFailedLogins: toInt(process.env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: toInt(process.env.LOCKOUT_MINUTES, 15),
    // When true, session cookies are marked `Secure` (HTTPS-only). Defaults to
    // true in production. Set COOKIE_SECURE=false for HTTP-only VPS deployments.
    cookieSecure: process.env.COOKIE_SECURE !== undefined
      ? toBool(process.env.COOKIE_SECURE)
      : undefined, // undefined → auto-detect from isProduction at call site
  },

  // Comma-separated list of emails auto-granted the admin role on sign-in.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Helpers used across the app
  isWebhookConfigured(): boolean {
    return !isPlaceholder(this.googleSheetWebhookUrl);
  },
  isGeminiConfigured(): boolean {
    return !isPlaceholder(this.geminiApiKey);
  },
  isSmtpConfigured(): boolean {
    return !!(this.smtp.host && this.smtp.user && this.smtp.pass);
  },
  isAuthEnabled(): boolean {
    return this.apiKey.trim() !== "";
  },
  isDatabaseConfigured(): boolean {
    return this.databaseUrl.trim() !== "";
  },
  isBootstrapAdmin(email: string): boolean {
    return this.adminEmails.includes(String(email || "").trim().toLowerCase());
  },
};

/**
 * Validates configuration at startup and returns a list of human-readable
 * warnings. Critical issues (production without auth/webhook) are highlighted.
 */
export function validateEnv(): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!env.isWebhookConfigured()) {
    warnings.push(
      "GOOGLE_SHEET_WEBHOOK_URL is not configured. Lead delivery and campaigns will be disabled."
    );
  }
  if (!env.isGeminiConfigured()) {
    warnings.push(
      "GEMINI_API_KEY is not configured. AI copy generation will fall back to the rule-based engine."
    );
  }
  if (!env.isSmtpConfigured()) {
    warnings.push("SMTP is not configured. Email outreach and OTP delivery will be unavailable.");
  }
  if (!env.isDatabaseConfigured()) {
    warnings.push(
      "DATABASE_URL is not configured. Authentication (login/signup) will be unavailable until a MySQL database URL is provided."
    );
  }
  if (env.isProduction && env.auth.jwtSecret === "dev-insecure-jwt-secret-change-me") {
    warnings.push(
      "SECURITY: JWT_SECRET is using the insecure development default in production. Set a strong random JWT_SECRET."
    );
  }

  if (env.isProduction) {
    if (!env.isAuthEnabled()) {
      warnings.push(
        "SECURITY: Running in production without API_KEY set. All API endpoints are publicly accessible. Set API_KEY to protect mutating routes."
      );
    }
    if (env.corsOrigins.includes("*")) {
      warnings.push(
        "SECURITY: CORS is set to allow all origins ('*') in production. Set CORS_ORIGINS to your dashboard origin(s)."
      );
    }
  }

  return { warnings, errors };
}
