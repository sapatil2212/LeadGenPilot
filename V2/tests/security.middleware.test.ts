/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — src/security.ts
 *
 * Covers three Phase 1 fixes:
 *   1. CORS no longer reflects an arbitrary Origin together with
 *      Access-Control-Allow-Credentials, which let any website read
 *      authenticated API responses on behalf of a signed-in user.
 *   2. A Content-Security-Policy is now sent (there was none).
 *   3. apiKeyAuth accepts a session cookie as well as the shared API key, so
 *      turning API_KEY on no longer locks the browser dashboard out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createPrismaMock, type PrismaMock, TENANT_A } from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const {
  corsMiddleware,
  securityHeaders,
  apiKeyAuth,
  safeEqual,
  buildContentSecurityPolicy,
} = await import("../src/security");
const { issueSessionToken } = await import("../src/authService");
const { env } = await import("../src/env");

const original = {
  corsOrigins: env.corsOrigins,
  nodeEnv: env.nodeEnv,
  apiKey: env.apiKey,
};

beforeEach(() => {
  mocks.prisma = createPrismaMock();
});

afterEach(() => {
  env.corsOrigins = original.corsOrigins;
  env.nodeEnv = original.nodeEnv;
  env.apiKey = original.apiKey;
});

/** Builds a tiny app with the middleware under test and one echo route. */
function appWith(...middleware: express.RequestHandler[]) {
  const app = express();
  app.use(cookieParser());
  middleware.forEach((m) => app.use(m));
  app.get("/probe", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("CORS — explicit allow-list", () => {
  beforeEach(() => {
    env.corsOrigins = ["https://app.example.com"];
  });

  it("echoes an allow-listed origin and permits credentials", async () => {
    const res = await request(appWith(corsMiddleware()))
      .get("/probe")
      .set("Origin", "https://app.example.com");

    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toContain("Origin");
  });

  it("sends no CORS headers for an origin that is not allow-listed", async () => {
    const res = await request(appWith(corsMiddleware()))
      .get("/probe")
      .set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers preflight with 204", async () => {
    const res = await request(appWith(corsMiddleware()))
      .options("/probe")
      .set("Origin", "https://app.example.com");

    expect(res.status).toBe(204);
  });
});

describe("CORS — wildcard configuration", () => {
  /**
   * THE REGRESSION. With CORS_ORIGINS="*" the old middleware echoed whatever
   * Origin arrived AND set Allow-Credentials: true, so any site could issue a
   * credentialed request and read the response.
   */
  it("never pairs a reflected origin with credentials in production", async () => {
    env.corsOrigins = ["*"];
    env.nodeEnv = "production";

    const res = await request(appWith(corsMiddleware()))
      .get("/probe")
      .set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
  });

  it("still reflects with credentials outside production, for local dev across ports", async () => {
    env.corsOrigins = ["*"];
    env.nodeEnv = "development";

    const res = await request(appWith(corsMiddleware()))
      .get("/probe")
      .set("Origin", "http://localhost:5173");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("serves a plain wildcard to non-browser clients that send no Origin", async () => {
    env.corsOrigins = ["*"];
    env.nodeEnv = "production";

    const res = await request(appWith(corsMiddleware())).get("/probe");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("Content-Security-Policy", () => {
  it("is sent on responses", async () => {
    const res = await request(appWith(securityHeaders())).get("/probe");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("blocks framing, plugins and stray base tags", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("allows exactly the third-party origins the app loads and no others", () => {
    const csp = buildContentSecurityPolicy();
    // Leaflet
    expect(csp["script-src"]).toContain("https://unpkg.com");
    // Google Fonts stylesheet + font files
    expect(csp["style-src"]).toContain("https://fonts.googleapis.com");
    expect(csp["font-src"]).toContain("https://fonts.gstatic.com");
    // Map tiles
    expect(csp["img-src"]).toContain("https://*.basemaps.cartocdn.com");
    // External connections are restricted to the one CDN asset source. Vite
    // websocket origins are allowed only in development.
    expect(csp["connect-src"]).toContain("'self'");
    expect(csp["connect-src"]).toContain("https://unpkg.com");
    expect(csp["connect-src"]).toContain("ws://localhost:*");
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).not.toContain("*");
    expect(csp["script-src"]).not.toContain("https:");
  });
});

describe("apiKeyAuth", () => {
  it("is a no-op when API_KEY is not configured", async () => {
    env.apiKey = "";
    const res = await request(appWith(apiKeyAuth())).get("/probe");
    expect(res.status).toBe(200);
  });

  it("rejects a request with neither key nor session", async () => {
    env.apiKey = "s3cret-api-key";
    const res = await request(appWith(apiKeyAuth())).get("/probe");
    expect(res.status).toBe(401);
  });

  it("accepts the key via X-API-Key", async () => {
    env.apiKey = "s3cret-api-key";
    const res = await request(appWith(apiKeyAuth())).get("/probe").set("X-API-Key", "s3cret-api-key");
    expect(res.status).toBe(200);
  });

  it("accepts the key via Authorization: Bearer", async () => {
    env.apiKey = "s3cret-api-key";
    const res = await request(appWith(apiKeyAuth()))
      .get("/probe")
      .set("Authorization", "Bearer s3cret-api-key");
    expect(res.status).toBe(200);
  });

  it("rejects a wrong key", async () => {
    env.apiKey = "s3cret-api-key";
    const res = await request(appWith(apiKeyAuth())).get("/probe").set("X-API-Key", "wrong");
    expect(res.status).toBe(401);
  });

  /**
   * A browser cannot hold a shared secret. Before this change, setting API_KEY
   * returned 401 for every dashboard request, so the setting was unusable and
   * production ran without it.
   */
  it("accepts a valid session cookie instead of a key", async () => {
    env.apiKey = "s3cret-api-key";
    const token = issueSessionToken({ id: TENANT_A.id, email: TENANT_A.email, role: "user" });

    const res = await request(appWith(apiKeyAuth()))
      .get("/probe")
      .set("Cookie", `${env.auth.cookieName}=${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects a forged session cookie", async () => {
    env.apiKey = "s3cret-api-key";
    const res = await request(appWith(apiKeyAuth()))
      .get("/probe")
      .set("Cookie", `${env.auth.cookieName}=not.a.real.token`);

    expect(res.status).toBe(401);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects strings of differing length without throwing", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });

  it("handles empty and nullish input", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual(undefined as any, "")).toBe(true);
    expect(safeEqual("x", undefined as any)).toBe(false);
  });
});
