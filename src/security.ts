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

/**
 * CORS handler driven by env.corsOrigins. Supports "*" (dev) or an explicit
 * allow-list. Echoes the requesting origin when allow-listed so credentialed
 * requests work correctly.
 */
export function corsMiddleware(): RequestHandler {
  const allowAll = env.corsOrigins.includes("*");
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (allowAll) {
      // When credentials are in play, browsers reject `*` as the allowed
      // origin.  Echo the requesting origin instead so cookies work.
      if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
      } else {
        res.header("Access-Control-Allow-Origin", "*");
      }
    } else if (origin && env.corsOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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
 * Security headers. CSP is disabled here because the app serves a bundled
 * SPA + landing page with inline styles/scripts; enabling a strict CSP would
 * require per-asset nonces. Other protections (HSTS, no-sniff, frameguard)
 * remain active.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  });
}

export function compressionMiddleware(): RequestHandler {
  return compression();
}

/**
 * General API rate limiter. Applied to all /api routes.
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
 * Constant-time comparison to avoid timing attacks when checking API keys.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * API-key auth. Only enforced when API_KEY is set (opt-in), so local
 * development keeps working with zero configuration. Accepts the key via
 * the `X-API-Key` header or `Authorization: Bearer <key>`.
 */
export function apiKeyAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.isAuthEnabled()) return next();

    const headerKey = req.header("X-API-Key") || "";
    const authHeader = req.header("Authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const provided = headerKey || bearer;

    if (provided && safeEqual(provided, env.apiKey)) {
      return next();
    }

    logger.warn(
      `Unauthorized API access attempt: ${req.method} ${req.path} from ${req.ip}`
    );
    return res.status(401).json({ error: "Unauthorized. A valid API key is required." });
  };
}
