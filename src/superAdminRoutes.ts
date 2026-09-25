/**
 * Super-Admin login routes.
 *
 * Authenticates using env-based credentials only — no database account needed:
 *   ADMIN_EMAILS      → the allowed admin email
 *   ADMIN_PASSWORD    → the admin password (plaintext in .env)
 *   SUPERADMIN_SECRET → an additional secret key required on every login
 *
 * The console uses a dedicated, typed JWT cookie. Keeping it separate from the
 * ordinary user cookie prevents normal login/logout activity in another tab
 * (or another localhost port) from silently invalidating the admin session.
 */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  issueSuperAdminSessionToken,
  superAdminSessionCookieOptions,
  verifySessionToken,
  sessionCookieOptions,
  writeAudit,
  type RequestMeta,
} from "./authService";
import { requireAdmin } from "./authRoutes";
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

function clearLegacySuperAdminCookies(req: Request, res: Response): void {
  const options = { ...sessionCookieOptions(), maxAge: undefined };
  const names = new Set([env.auth.cookieName, "nexaleadai_session"]);

  // Inspect and clear each alias independently. One alias may hold an ordinary
  // user while the other still contains a pre-separation synthetic session.
  for (const name of names) {
    const token = req.cookies?.[name];
    const payload = token ? verifySessionToken(token) : null;
    if (payload?.sub === "superadmin") res.clearCookie(name, options);
  }
}

/** POST /api/superadmin/login */
router.post("/login", superadminLimiter, async (req: Request, res: Response) => {
  const { email, password, secret } = req.body || {};

  if (!email || !password || !secret) {
    return res.status(400).json({ error: "Email, password and secret are required.", code: "missing_fields" });
  }
  if (typeof email !== "string" || typeof password !== "string" || typeof secret !== "string") {
    return res.status(400).json({ error: "Email, password and secret must be strings.", code: "invalid_fields" });
  }

  const adminEmail = env.adminEmails[0] || "";
  const adminPassword = env.adminPassword.trim();
  const expectedSecret = env.superAdminSecret.trim();

  if (!env.isSuperAdminConfigured()) {
    logger.error("Superadmin login is disabled: credentials are incomplete or the cookie namespace is unsafe.");
    return res.status(503).json({
      error: "Superadmin login is not safely configured. Check the credentials and cookie-name settings.",
      code: "not_configured",
    });
  }

  const emailMatch = safeEqual(email.trim().toLowerCase(), adminEmail);
  const passwordMatch = safeEqual(password, adminPassword);
  const secretMatch = safeEqual(secret, expectedSecret);

  if (!emailMatch || !passwordMatch || !secretMatch) {
    logger.warn(`Superadmin login failed from ${metaOf(req).ip}`);
    await writeAudit("superadmin_login_failed", {
      meta: metaOf(req),
      data: { emailMatch, passwordMatch, secretMatch },
    });
    return res.status(401).json({ error: "Invalid credentials or secret.", code: "unauthorized" });
  }

  const token = issueSuperAdminSessionToken(adminEmail);
  res.cookie(env.auth.superAdminCookieName, token, superAdminSessionCookieOptions());
  clearLegacySuperAdminCookies(req, res);

  logger.info(`Superadmin login successful from ${metaOf(req).ip}`);
  await writeAudit("superadmin_login_success", { meta: metaOf(req) });

  return res.json({
    success: true,
    user: { id: "superadmin", email: adminEmail, role: "admin" },
    redirectTo: "/superadmin/dashboard",
    expiresInDays: env.auth.superAdminSessionDays,
  });
});

/** POST /api/superadmin/logout — clears only the console session. */
router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie(env.auth.superAdminCookieName, {
    ...superAdminSessionCookieOptions(),
    maxAge: undefined,
  });
  // Clean up a pre-separation synthetic cookie without touching a normal user.
  clearLegacySuperAdminCookies(req, res);
  res.json({ success: true });
});

/**
 * GET /api/superadmin/verify
 *
 * Reuses the exact authorization contract protecting /api/admin so verification
 * cannot disagree with the dashboard. This also supports database-backed admins.
 */
router.get("/verify", requireAdmin, (req: Request, res: Response) => {
  const payload = (req as any).user;
  const actor = (req as any).adminUser;

  return res.json({
    authenticated: true,
    user: {
      id: actor?.id || payload?.sub,
      email: actor?.email || payload?.email,
      role: "admin",
    },
    kind: actor?.id === "superadmin" ? "superadmin_console" : "admin_user",
    expiresAt: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
  });
});

export default router;
