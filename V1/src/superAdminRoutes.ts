/**
 * Super-Admin login routes.
 *
 * Authenticates using env-based credentials only — no database account needed:
 *   ADMIN_EMAILS      → the allowed admin email
 *   ADMIN_PASSWORD    → the admin password (plaintext in .env)
 *   SUPERADMIN_SECRET → an additional secret key required on every login
 *
 * Routes:
 *   POST /api/superadmin/login    → validates credentials, issues session token
 *   POST /api/superadmin/logout   → clears session cookie
 *   GET  /api/superadmin/verify   → checks if current session is a valid admin
 */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  issueSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  writeAudit,
  type RequestMeta,
} from "./authService";
import { env } from "./env";
import { logger } from "./logger";
import { safeEqual } from "./security";

const router = Router();

/** Very strict rate limit for the superadmin login endpoint. */
const superadminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many superadmin login attempts. Try again in 15 minutes.", code: "rate_limited" },
});

function metaOf(req: Request): RequestMeta {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    userAgent: req.headers["user-agent"],
  };
}

/**
 * POST /api/superadmin/login
 *
 * Body: { email, password, secret }
 *   - email must match ADMIN_EMAILS env var
 *   - password must match ADMIN_PASSWORD env var
 *   - secret must match SUPERADMIN_SECRET env var
 *
 * No database is required — credentials are validated directly against .env.
 */
router.post("/login", superadminLimiter, async (req: Request, res: Response) => {
  const { email, password, secret } = req.body || {};

  // 1. Validate required fields
  if (!email || !password || !secret) {
    return res.status(400).json({ error: "Email, password and secret are required.", code: "missing_fields" });
  }

  // Reject non-string input before calling string methods on it. This handler
  // is async with no try/catch, so `email.trim()` on a number previously threw
  // an unhandled rejection and left the request hanging.
  if (typeof email !== "string" || typeof password !== "string" || typeof secret !== "string") {
    return res.status(400).json({ error: "Email, password and secret must be strings.", code: "invalid_fields" });
  }

  // 2. Read env credentials
  const adminEmail = env.adminEmails[0] || "";
  const adminPassword = env.adminPassword.trim();
  const expectedSecret = env.superAdminSecret.trim();

  if (!env.isSuperAdminConfigured()) {
    logger.error("Superadmin: ADMIN_EMAILS, ADMIN_PASSWORD or SUPERADMIN_SECRET not configured in .env");
    return res.status(503).json({
      error: "Superadmin login is not fully configured. Check ADMIN_EMAILS, ADMIN_PASSWORD and SUPERADMIN_SECRET in your .env.",
      code: "not_configured",
    });
  }

  /*
   * 3. Validate all three credentials.
   *
   * Every comparison is timing-safe and all three run unconditionally, so the
   * response time does not reveal which factor was wrong. The previous code
   * used `===` (short-circuiting on the first mismatch) while the comment
   * claimed constant-time behaviour.
   */
  const emailMatch = safeEqual(email.trim().toLowerCase(), adminEmail);
  const passwordMatch = safeEqual(password, adminPassword);
  const secretMatch = safeEqual(secret, expectedSecret);

  if (!emailMatch || !passwordMatch || !secretMatch) {
    logger.warn(`Superadmin login failed from ${metaOf(req).ip}`);
    // The file header promised an audit trail that was never written. Record
    // the attempt without echoing the submitted email into the log or the DB.
    await writeAudit("superadmin_login_failed", {
      meta: metaOf(req),
      data: { emailMatch, passwordMatch, secretMatch },
    });
    return res.status(401).json({ error: "Invalid credentials or secret.", code: "unauthorized" });
  }

  // 4. Issue a JWT session token for the admin (synthetic user — no DB needed)
  const token = issueSessionToken({
    id: "superadmin",
    email: adminEmail,
    role: "admin",
  });

  res.cookie(env.auth.cookieName, token, sessionCookieOptions());

  logger.info(`Superadmin login successful from ${metaOf(req).ip}`);
  await writeAudit("superadmin_login_success", { meta: metaOf(req) });

  return res.json({
    success: true,
    user: {
      id: "superadmin",
      email: adminEmail,
      role: "admin",
    },
    redirectTo: "/superadmin/dashboard",
  });
});

/**
 * POST /api/superadmin/logout
 */
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(env.auth.cookieName, { ...sessionCookieOptions(), maxAge: undefined });
  res.clearCookie("nexaleadai_session", { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ success: true });
});

/**
 * GET /api/superadmin/verify
 * Returns session info if the current session is a valid admin.
 */
router.get("/verify", (req: Request, res: Response) => {
  const token = req.cookies?.[env.auth.cookieName] || req.cookies?.["nexaleadai_session"];
  if (!token) return res.status(401).json({ error: "Not authenticated.", code: "no_session" });

  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });

  if (payload.role !== "admin") {
    return res.status(403).json({ error: "Admin access required.", code: "not_admin" });
  }

  return res.json({
    authenticated: true,
    user: {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    },
  });
});

export default router;
