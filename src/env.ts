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

/**
 * Insecure development fallbacks. Named constants so the "is this still the
 * default?" check can never drift from the value actually used, and so
 * validateEnv can refuse to boot production with either of them in place.
 */
export const DEV_FALLBACK_JWT_SECRET = "dev-insecure-jwt-secret-change-me";
/** Mirrors the fallback in src/userIntegrationService.ts. */
export const DEV_FALLBACK_ENCRYPTION_KEY = "default-32-char-encryption-key!!";

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get isDevelopment() {
    return this.nodeEnv !== "production";
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
    jwtSecret: process.env.JWT_SECRET || DEV_FALLBACK_JWT_SECRET,
    // Session lifetime in days. Values below one day are rejected to avoid
    // accidentally issuing immediately-expired cookies.
    sessionDays: Math.max(1, toInt(process.env.AUTH_SESSION_DAYS, 7)),
    superAdminSessionDays: Math.max(
      1,
      toInt(process.env.SUPERADMIN_SESSION_DAYS, toInt(process.env.AUTH_SESSION_DAYS, 7))
    ),
    // Ordinary users and the env-based superadmin deliberately use separate
    // host-wide cookies. Browser cookies are not port-scoped, so sharing this
    // name let normal login/logout activity invalidate the admin console.
    cookieName: process.env.AUTH_COOKIE_NAME || "leadgenpilot_session",
    tenantCookieName: process.env.AUTH_TENANT_COOKIE_NAME || "leadgenpilot_tenant",
    superAdminCookieName: process.env.SUPERADMIN_COOKIE_NAME || "leadgenpilot_superadmin_session",
    // OTP configuration.
    otpLength: 6,
    otpTtlMinutes: toInt(process.env.OTP_TTL_MINUTES, 10),
    otpMaxAttempts: toInt(process.env.OTP_MAX_ATTEMPTS, 5),
    // Minimum seconds between OTP resends for the same email.
    otpResendSeconds: toInt(process.env.OTP_RESEND_SECONDS, 60),
    // Product name shown in OTP emails.
    appName: process.env.APP_NAME || "LeadGenPilot",
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

  // Env-based superadmin console credentials (no database row).
  adminPassword: process.env.ADMIN_PASSWORD || "",
  superAdminSecret: process.env.SUPERADMIN_SECRET || "",

  // Key used to encrypt stored per-tenant integration credentials.
  encryptionKey: process.env.ENCRYPTION_KEY || "",

  /**
   * Backup restore extracts an archive over the working directory, which is an
   * arbitrary-file-overwrite primitive. Disabled unless an operator explicitly
   * opts in, and admin-only even then.
   */
  enableBackupRestore: toBool(process.env.ENABLE_BACKUP_RESTORE, false),

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
  /** True when a shared API key is configured for machine clients. */
  isApiKeyEnabled(): boolean {
    return this.apiKey.trim() !== "";
  },
  /**
   * @deprecated Misleading name — this only reports whether the shared API key
   * is set, not whether user authentication works. Kept so existing callers
   * (e.g. /api/ready) keep compiling; prefer isApiKeyEnabled().
   */
  isAuthEnabled(): boolean {
    return this.isApiKeyEnabled();
  },
  isDatabaseConfigured(): boolean {
    return this.databaseUrl.trim() !== "";
  },
  isBootstrapAdmin(email: string): boolean {
    return this.adminEmails.includes(String(email || "").trim().toLowerCase());
  },
  /** True when the session-signing secret is still the dev fallback. */
  isDefaultJwtSecret(): boolean {
    return this.auth.jwtSecret === DEV_FALLBACK_JWT_SECRET;
  },
  /** True when integration credentials are encrypted with the dev fallback key. */
  isDefaultEncryptionKey(): boolean {
    return this.encryptionKey.trim() === "" || this.encryptionKey === DEV_FALLBACK_ENCRYPTION_KEY;
  },
  /** Cookie namespaces are an authentication invariant, including locally. */
  isSuperAdminCookieNamespaceSafe(): boolean {
    return !new Set([
      this.auth.cookieName,
      this.auth.tenantCookieName,
      "nexaleadai_session",
      "nexaleadai_tenant",
    ]).has(this.auth.superAdminCookieName);
  },
  /**
   * The env-based superadmin console requires complete credentials and a cookie
   * namespace that ordinary auth flows cannot overwrite or clear.
   */
  isSuperAdminConfigured(): boolean {
    return (
      this.adminEmails.length > 0 &&
      this.adminPassword.trim() !== "" &&
      this.superAdminSecret.trim() !== "" &&
      this.isSuperAdminCookieNamespaceSafe()
    );
  },
};

/**
 * Validates configuration at startup.
 *
 * `warnings` are advisory. `errors` are fatal in production: the caller
 * (server.ts) refuses to boot. Before this change `errors` was declared but
 * never populated, so a production deploy would start happily with a
 * publicly-known signing secret and wildcard CORS after printing three lines
 * nobody reads.
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
  } else if (!env.geminiApiKey.trim().startsWith("AIza")) {
    /*
     * A key that is present but the wrong kind. Google AI Studio keys always
     * begin with "AIza"; an "AQ."-prefixed value is an ephemeral Live-API token
     * that the generateContent endpoint rejects with 401
     * ACCESS_TOKEN_TYPE_UNSUPPORTED.
     *
     * Worth a boot-time warning rather than leaving it to the first request: the
     * key is non-empty, so every "is AI configured?" check passes and the
     * failure only surfaces later, as a generic "No AI provider answered" on
     * whichever feature the user happened to try first. .env.example shipped
     * such a token as its example value, so this was copied into real
     * deployments.
     */
    warnings.push(
      "GEMINI_API_KEY does not begin with \"AIza\", so it is not a Google AI Studio API key. " +
        "Ephemeral (\"AQ.\") and OAuth tokens are rejected by the Gemini REST API. " +
        "Gemini calls and all embeddings will fail until this is replaced with a long-lived key " +
        "from https://aistudio.google.com/apikey."
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
  if (!env.isSuperAdminCookieNamespaceSafe()) {
    const message =
      "SUPERADMIN_COOKIE_NAME must differ from AUTH_COOKIE_NAME, AUTH_TENANT_COOKIE_NAME, and legacy session/tenant aliases. Superadmin authentication is disabled until this is corrected.";
    if (env.isProduction) errors.push(`SECURITY: ${message}`);
    else warnings.push(`SECURITY: ${message}`);
  }
  if (env.isDefaultJwtSecret()) {
    const message =
      "JWT_SECRET is the publicly-known development default. Every session token can be forged by anyone " +
      "who has read this repository, including a token granting platform-admin access. " +
      "Set a strong random value: openssl rand -base64 48";
    if (env.isProduction) errors.push(`SECURITY: ${message}`);
    else warnings.push(`SECURITY: ${message}`);
  }

  if (env.isProduction) {
    if (env.corsOrigins.includes("*")) {
      errors.push(
        "SECURITY: CORS_ORIGINS is '*' in production. Credentialed cross-origin requests are refused in this " +
          "configuration, which will break any separately-hosted frontend. Set CORS_ORIGINS to your explicit " +
          "dashboard origin(s), e.g. CORS_ORIGINS=\"https://app.example.com\"."
      );
    }

    if (env.isDefaultEncryptionKey()) {
      errors.push(
        "SECURITY: ENCRYPTION_KEY is unset or the development default. Stored per-tenant SMTP and WhatsApp " +
          "credentials would be encrypted with a publicly-known key. Set a strong random value: openssl rand -hex 32"
      );
    }

    if (env.auth.cookieSecure === false) {
      warnings.push(
        "SECURITY: COOKIE_SECURE=false in production — session cookies will be sent over plain HTTP. " +
          "Only do this behind a trusted TLS-terminating proxy on a private network."
      );
    }

    if (!env.isApiKeyEnabled()) {
      warnings.push(
        "API_KEY is not set. Machine clients cannot authenticate; browser sessions still work normally."
      );
    }

    if (env.enableBackupRestore) {
      warnings.push(
        "SECURITY: ENABLE_BACKUP_RESTORE=true. The restore endpoint overwrites files in the application " +
          "working directory. Keep this off unless you are actively restoring."
      );
    }
  }

  return { warnings, errors };
}
