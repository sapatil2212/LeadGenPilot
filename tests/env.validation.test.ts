/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — validateEnv()
 *
 * validateEnv() returned `{ warnings, errors }` but never pushed anything into
 * `errors`, and server.ts only logged warnings. A production deploy therefore
 * started normally with the publicly-known development JWT_SECRET and wildcard
 * CORS. These tests assert the fatal set.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  env,
  validateEnv,
  DEV_FALLBACK_JWT_SECRET,
  DEV_FALLBACK_ENCRYPTION_KEY,
} from "../src/env";

vi.mock("../src/prisma", () => ({
  prisma: {},
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const original = {
  nodeEnv: env.nodeEnv,
  corsOrigins: env.corsOrigins,
  jwtSecret: env.auth.jwtSecret,
  cookieSecure: env.auth.cookieSecure,
  cookieName: env.auth.cookieName,
  tenantCookieName: env.auth.tenantCookieName,
  superAdminCookieName: env.auth.superAdminCookieName,
  encryptionKey: env.encryptionKey,
  apiKey: env.apiKey,
  adminEmails: env.adminEmails,
  adminPassword: env.adminPassword,
  superAdminSecret: env.superAdminSecret,
  enableBackupRestore: env.enableBackupRestore,
};

afterEach(() => {
  env.nodeEnv = original.nodeEnv;
  env.corsOrigins = original.corsOrigins;
  env.auth.jwtSecret = original.jwtSecret;
  env.auth.cookieSecure = original.cookieSecure;
  env.auth.cookieName = original.cookieName;
  env.auth.tenantCookieName = original.tenantCookieName;
  env.auth.superAdminCookieName = original.superAdminCookieName;
  env.encryptionKey = original.encryptionKey;
  env.apiKey = original.apiKey;
  env.adminEmails = original.adminEmails;
  env.adminPassword = original.adminPassword;
  env.superAdminSecret = original.superAdminSecret;
  env.enableBackupRestore = original.enableBackupRestore;
});

/** A production configuration with nothing wrong in it. */
function secureProduction() {
  env.nodeEnv = "production";
  env.corsOrigins = ["https://app.example.com"];
  env.auth.jwtSecret = "a-genuinely-random-secret-value-for-tests-only";
  env.auth.cookieSecure = true;
  env.auth.cookieName = "test_user_session";
  env.auth.tenantCookieName = "test_tenant_session";
  env.auth.superAdminCookieName = "test_superadmin_session";
  env.encryptionKey = "0".repeat(64);
  env.apiKey = "some-api-key";
  env.enableBackupRestore = false;
}

describe("validateEnv — fatal in production", () => {
  it("reports no errors for a correctly configured production deploy", () => {
    secureProduction();
    expect(validateEnv().errors).toEqual([]);
  });

  it("fails on the development JWT_SECRET", () => {
    secureProduction();
    env.auth.jwtSecret = DEV_FALLBACK_JWT_SECRET;

    const { errors } = validateEnv();
    expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
  });

  it("fails on wildcard CORS", () => {
    secureProduction();
    env.corsOrigins = ["*"];

    const { errors } = validateEnv();
    expect(errors.some((e) => e.includes("CORS_ORIGINS"))).toBe(true);
  });

  it("fails on the development ENCRYPTION_KEY", () => {
    secureProduction();
    env.encryptionKey = DEV_FALLBACK_ENCRYPTION_KEY;

    const { errors } = validateEnv();
    expect(errors.some((e) => e.includes("ENCRYPTION_KEY"))).toBe(true);
  });

  it("fails on a missing ENCRYPTION_KEY", () => {
    secureProduction();
    env.encryptionKey = "";

    const { errors } = validateEnv();
    expect(errors.some((e) => e.includes("ENCRYPTION_KEY"))).toBe(true);
  });

  it("collects every problem at once rather than stopping at the first", () => {
    secureProduction();
    env.auth.jwtSecret = DEV_FALLBACK_JWT_SECRET;
    env.corsOrigins = ["*"];
    env.encryptionKey = "";

    expect(validateEnv().errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateEnv — advisory in development", () => {
  it("downgrades the JWT_SECRET problem to a warning outside production", () => {
    env.nodeEnv = "development";
    env.auth.jwtSecret = DEV_FALLBACK_JWT_SECRET;

    const { warnings, errors } = validateEnv();
    expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(false);
    expect(warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
  });

  it("does not treat wildcard CORS as fatal outside production", () => {
    env.nodeEnv = "development";
    env.corsOrigins = ["*"];

    expect(validateEnv().errors.some((e) => e.includes("CORS_ORIGINS"))).toBe(false);
  });
});

describe("validateEnv — warnings that must not block a boot", () => {
  it("warns but does not fail when cookies are insecure in production", () => {
    secureProduction();
    env.auth.cookieSecure = false;

    const { warnings, errors } = validateEnv();
    expect(warnings.some((w) => w.includes("COOKIE_SECURE"))).toBe(true);
    expect(errors.some((e) => e.includes("COOKIE_SECURE"))).toBe(false);
  });

  it("warns but does not fail when backup restore is enabled", () => {
    secureProduction();
    env.enableBackupRestore = true;

    const { warnings, errors } = validateEnv();
    expect(warnings.some((w) => w.includes("ENABLE_BACKUP_RESTORE"))).toBe(true);
    expect(errors.some((e) => e.includes("ENABLE_BACKUP_RESTORE"))).toBe(false);
  });

  it("warns but does not fail when no API key is configured", () => {
    secureProduction();
    env.apiKey = "";

    const { warnings, errors } = validateEnv();
    expect(warnings.some((w) => w.includes("API_KEY"))).toBe(true);
    expect(errors.some((e) => e.includes("API_KEY"))).toBe(false);
  });
});

describe("superadmin configuration detection", () => {
  it("requires complete credentials and a safe cookie namespace", () => {
    env.auth.cookieName = "test_user_session";
    env.auth.tenantCookieName = "test_tenant_session";
    env.auth.superAdminCookieName = "test_superadmin_session";
    env.adminEmails = ["admin@example.com"];
    env.adminPassword = "pw";
    env.superAdminSecret = "sec";
    expect(env.isSuperAdminConfigured()).toBe(true);

    env.superAdminSecret = "";
    expect(env.isSuperAdminConfigured()).toBe(false);

    env.superAdminSecret = "sec";
    env.adminPassword = "   ";
    expect(env.isSuperAdminConfigured()).toBe(false);

    env.adminPassword = "pw";
    env.adminEmails = [];
    expect(env.isSuperAdminConfigured()).toBe(false);

    env.adminEmails = ["admin@example.com"];
    env.auth.superAdminCookieName = env.auth.tenantCookieName;
    expect(env.isSuperAdminConfigured()).toBe(false);
  });
});

describe("default-secret detection", () => {
  it("recognises the development JWT secret", () => {
    env.auth.jwtSecret = DEV_FALLBACK_JWT_SECRET;
    expect(env.isDefaultJwtSecret()).toBe(true);

    env.auth.jwtSecret = "something-else";
    expect(env.isDefaultJwtSecret()).toBe(false);
  });

  it("treats an unset encryption key as a default", () => {
    env.encryptionKey = "";
    expect(env.isDefaultEncryptionKey()).toBe(true);

    env.encryptionKey = DEV_FALLBACK_ENCRYPTION_KEY;
    expect(env.isDefaultEncryptionKey()).toBe(true);

    env.encryptionKey = "0".repeat(64);
    expect(env.isDefaultEncryptionKey()).toBe(false);
  });
});
