/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import crypto from "crypto";
import { env } from "./env";
import { logger } from "./logger";
import { verifySessionToken } from "./authService";

/**
 * CORS handler driven by env.corsOrigins.
 *
 * Credentialed cross-origin access is only granted to origins on an EXPLICIT
 * allow-list. Previously, the "*" setting echoed back whatever Origin the
 * caller sent while also sending `Access-Control-Allow-Credentials: true`,
 * which let any website read authenticated API responses on behalf of a
 * signed-in user — the session cookie's `sameSite: lax` does not stop this,
 * because the browser considers the request same-site-permitted once the
 * server opts in.
 *
 * Behaviour now:
 *   - Explicit allow-list          → echo the origin, allow credentials.
 *   - "*" outside production       → echo the origin, allow credentials.
 *                                    Kept for local development across ports;
 *                                    "*" is rejected at boot in production
 *                                    (see validateEnv).
 *   - "*" in production            → send a wildcard WITHOUT credentials, so
 *                                    the browser blocks credentialed reads.
 *   - Origin present but not allowed → send no CORS headers at all, so the
 *                                    browser blocks the response.
 *
 * Same-origin requests send no Origin header and are entirely unaffected, so
 * the bundled dashboard keeps working regardless of this setting.
 */
export function corsMiddleware(): RequestHandler {
  const allowAll = env.corsOrigins.includes("*");

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const explicitlyAllowed = !!origin && env.corsOrigins.includes(origin);

    if (explicitlyAllowed) {
      res.header("Access-Control-Allow-Origin", origin!);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    } else if (allowAll && !env.isProduction && origin) {
      // Development convenience only.
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    } else if (allowAll && !origin) {
      // Non-browser client (curl, server-to-server). No cookies involved.
      res.header("Access-Control-Allow-Origin", "*");
    } else if (allowAll && env.isProduction) {
      // Misconfigured production: allow reads, but never with credentials.
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Vary", "Origin");
    }
    // else: origin present and not allowed — deliberately no CORS headers.

    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key"
    );
    res.header("Access-Control-Max-Age", "600");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  };
}

/**
 * Content Security Policy.
 *
 * Enumerates exactly the third-party origins this application actually loads:
 *   unpkg.com                  Leaflet script + stylesheet (index.html)
 *   fonts.googleapis.com       Google Fonts stylesheets
 *   fonts.gstatic.com          Google Fonts font files
 *   *.basemaps.cartocdn.com    Leaflet map tiles
 *
 * `'unsafe-inline'` is still required for styles (Tailwind and the inline
 * <style> blocks in the superadmin and landing pages) and for scripts (inline
 * bootstrapping plus the eval used by jsPDF/html2canvas and the Vite dev
 * server). That means this policy does not yet stop injected inline script,
 * so it is defence in depth rather than an XSS cure — the stored-XSS vector
 * itself is closed by input validation. Tightening to per-asset nonces and
 * removing 'unsafe-inline' is Phase 10 work.
 *
 * What it does buy immediately: no script, frame, object or form target from
 * an origin outside the list above, and the app can no longer be framed.
 */
export function buildContentSecurityPolicy(): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com"],
    "style-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // blob: and data: cover the QR image, logo blob fetch and PDF generation.
    "img-src": ["'self'", "data:", "blob:", "https://*.basemaps.cartocdn.com", "https://unpkg.com"],
    "connect-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
}

/**
 * Security headers. HSTS / no-sniff / frameguard come from helmet defaults;
 * the CSP above is layered on top.
 *
 * crossOriginEmbedderPolicy and crossOriginResourcePolicy stay disabled: COEP
 * would block the unpkg and Google Fonts loads, which do not send the
 * corresponding CORP headers.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildContentSecurityPolicy(),
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  });
}

export function compressionMiddleware(): RequestHandler {
  return compression();
}

/**
 * General API rate limiter. Applied to all /api routes.
 *
 * NOTE: uses express-rate-limit's default in-process memory store, so limits
 * are per Node process and reset on restart. Moving to a shared store is
 * Phase 10 work; until then, do not rely on these numbers behind more than one
 * replica.
 */
export function apiRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again shortly." },
  });
}

/**
 * Stricter limiter for expensive/abuse-prone actions (scraper, campaigns,
 * outreach sends, AI generation).
 */
export function heavyActionRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: Math.max(5, Math.floor(env.rateLimitMax / 6)),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many sensitive operations. Please wait before retrying." },
  });
}

/**
 * Constant-time comparison to avoid timing attacks when checking secrets.
 * Exported so every credential comparison in the codebase can use one
 * implementation rather than `===`.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * API-key auth for machine clients. Only enforced when API_KEY is set.
 *
 * Accepts EITHER a valid API key (`X-API-Key` or `Authorization: Bearer`) OR a
 * valid session cookie. The session alternative matters: a browser cannot hold
 * a shared secret, so before this change, switching API_KEY on locked the
 * dashboard out of its own API and made the setting effectively unusable in
 * production. Both paths are real authentication; per-user authorization is
 * still enforced downstream by requireAuth / requireTenant, because the API key
 * identifies no user.
 */
export function apiKeyAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.isApiKeyEnabled()) return next();

    const headerKey = req.header("X-API-Key") || "";
    const authHeader = req.header("Authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const provided = headerKey || bearer;

    if (provided && safeEqual(provided, env.apiKey)) {
      return next();
    }

    const sessionToken = req.cookies?.[env.auth.cookieName];
    if (sessionToken && verifySessionToken(sessionToken)) {
      return next();
    }

    logger.warn(`Unauthorized API access attempt: ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({
      error: "Unauthorized. A valid API key or an active session is required.",
      code: "unauthorized",
    });
  };
}
