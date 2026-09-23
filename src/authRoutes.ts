/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { env } from "./env";
import { logger } from "./logger";
import {
  signup,
  login,
  verifyOtp,
  resendOtp,
  requestPasswordReset,
  resetPassword,
  getUserById,
  verifySessionToken,
  sessionCookieOptions,
  AuthError,
  type RequestMeta,
  sendPhoneVerificationOtp,
  verifyPhoneOtp,
  resendPhoneOtp,
} from "./authService";
import { prisma } from "./prisma";
import { getEntitlements } from "./plans";
import { computeUsage } from "./entitlements";
import { ensureTenantForUser, findMembership, listMemberships } from "./tenancy/tenantService";

/** Extracts client metadata for audit logging. */
function metaOf(req: Request): RequestMeta {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    userAgent: req.headers["user-agent"],
  };
}

const router = Router();

// Stricter rate limiting for auth endpoints to resist brute force / abuse.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many code requests. Please try again later." },
});

// Guard: 503 if the database isn't configured yet.
function requireDatabase(req: Request, res: Response, next: NextFunction) {
  if (!env.isDatabaseConfigured()) {
    return res.status(503).json({
      error: "Authentication is not available yet. The database is not configured.",
      code: "db_unconfigured",
    });
  }
  next();
}

function handleError(res: Response, err: unknown) {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  }
  logger.error("Auth route error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again.", code: "internal" });
}

function getSessionToken(req: Request): string | undefined {
  return req.cookies?.[env.auth.cookieName] || req.cookies?.["nexaleadai_session"];
}

function getTenantCookie(req: Request): string {
  return String(req.cookies?.[env.auth.tenantCookieName] || req.cookies?.["nexaleadai_tenant"] || "").trim();
}

router.use(requireDatabase);

// ── Sign up ──
router.post("/signup", authLimiter, async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required.", code: "missing_fields" });
    }
    const result = await signup({ name, email, password, phone });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Verify OTP (completes signup or login) ──
router.post("/verify-otp", otpLimiter, async (req: Request, res: Response) => {
  try {
    const { email, code, purpose } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required.", code: "missing_fields" });
    }
    const { user } = await verifyOtp({ email, code, purpose });
    const clearOptions = { ...sessionCookieOptions(), maxAge: undefined };
    res.clearCookie(env.auth.cookieName, clearOptions);
    res.clearCookie(env.auth.tenantCookieName, clearOptions);
    res.json({ success: true, user, requiresLogin: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Resend OTP ──
router.post("/resend-otp", otpLimiter, async (req: Request, res: Response) => {
  try {
    const { email, purpose } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required.", code: "missing_fields" });
    await resendOtp({ email, purpose });
    res.json({ success: true, message: "If an account requires verification, a new code has been sent." });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Log in ──
router.post("/login", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required.", code: "missing_fields" });
    }
    const result = await login({ email, password }, metaOf(req));
    if ("requiresVerification" in result) {
      return res.json({ success: true, requiresVerification: true, email: result.email });
    }
    res.cookie(env.auth.cookieName, result.token, sessionCookieOptions());
    res.json({ success: true, user: result.user });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Forgot password: send reset code ──
router.post("/forgot-password", otpLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required.", code: "missing_fields" });
    await requestPasswordReset(email, metaOf(req));
    res.json({ success: true, message: "If an account exists for that email, a reset code has been sent." });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Reset password with code ──
router.post("/reset-password", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password) {
      return res.status(400).json({ error: "Email, code and new password are required.", code: "missing_fields" });
    }
    await resetPassword({ email, code, password }, metaOf(req));
    res.json({ success: true, message: "Password updated. You can now sign in." });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Current session and workspace context ──
router.get("/me", async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: "Not authenticated.", code: "no_session" });
    const payload = verifySessionToken(token);
    if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
    const dbUser = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!dbUser) return res.status(401).json({ error: "Account not found.", code: "no_user" });

    // Repair legacy accounts before the dashboard is rendered. A successful
    // auth response always has at least one usable workspace.
    await ensureTenantForUser(dbUser.id);
    const memberships = (await listMemberships(dbUser.id)).filter((m) => m.tenantStatus === "active");
    const workspaces = memberships.map((m) => ({
      id: m.tenantId,
      name: m.tenantName,
      slug: m.tenantSlug,
      role: m.role,
    }));
    if (workspaces.length === 0) {
      return res.status(403).json({
        error: "No active workspace is available for this account.",
        code: "no_active_workspace",
      });
    }

    const requestedTenantId = getTenantCookie(req);
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === requestedTenantId) ||
      (workspaces.length === 1 ? workspaces[0] : null);

    if (activeWorkspace) {
      res.cookie(env.auth.tenantCookieName, activeWorkspace.id, sessionCookieOptions());
    } else {
      res.clearCookie(env.auth.tenantCookieName, { ...sessionCookieOptions(), maxAge: undefined });
    }

    const user = await getUserById(payload.sub);
    const entitlements = getEntitlements(dbUser.plan);
    const usageInfo = computeUsage(dbUser, entitlements);
    res.json({
      user,
      workspace: activeWorkspace,
      workspaces,
      requiresWorkspaceSelection: workspaces.length > 1 && !activeWorkspace,
      plan: dbUser.plan,
      entitlements: {
        ...entitlements,
        monthlyLeadLimit: Number.isFinite(entitlements.monthlyLeadLimit) ? entitlements.monthlyLeadLimit : null,
      },
      usage: {
        used: usageInfo.used,
        limit: usageInfo.unlimited ? null : usageInfo.limit,
        remaining: usageInfo.unlimited ? null : usageInfo.remaining,
        period: usageInfo.period,
        unlimited: usageInfo.unlimited,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Select an active workspace ──
router.post("/select-workspace", authLimiter, async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) return res.status(401).json({ error: "Authentication required.", code: "no_session" });

    const tenantId = String(req.body?.tenantId || "").trim();
    if (!tenantId) return res.status(400).json({ error: "Workspace is required.", code: "missing_tenant" });

    const membership = await findMembership(payload.sub, tenantId);
    if (!membership || membership.tenantStatus !== "active") {
      return res.status(403).json({ error: "You do not have access to that workspace.", code: "tenant_forbidden" });
    }

    res.cookie(env.auth.tenantCookieName, tenantId, sessionCookieOptions());
    res.json({
      success: true,
      workspace: { id: membership.tenantId, name: membership.tenantName, slug: membership.tenantSlug, role: membership.role },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Log out ──
router.post("/logout", (req: Request, res: Response) => {
  const clearOptions = { ...sessionCookieOptions(), maxAge: undefined };
  res.clearCookie(env.auth.cookieName, clearOptions);
  res.clearCookie("nexaleadai_session", clearOptions);
  res.clearCookie(env.auth.tenantCookieName, clearOptions);
  res.clearCookie("nexaleadai_tenant", clearOptions);
  res.json({ success: true });
});

// ── Phone verification routes ──

// Send phone verification OTP
router.post("/phone/send-otp", otpLimiter, async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required.", code: "no_session" });

    const payload = verifySessionToken(token);
    if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });

    const { phone } = req.body || {};
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required.", code: "missing_fields" });
    }

    await sendPhoneVerificationOtp(payload.sub, phone);
    res.json({ success: true, message: "Verification code sent to your phone." });
  } catch (err) {
    handleError(res, err);
  }
});

// Verify phone OTP
router.post("/phone/verify-otp", otpLimiter, async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required.", code: "no_session" });

    const payload = verifySessionToken(token);
    if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });

    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Verification code is required.", code: "missing_fields" });
    }

    await verifyPhoneOtp(payload.sub, code);
    res.json({ success: true, message: "Phone number verified successfully." });
  } catch (err) {
    handleError(res, err);
  }
});

// Resend phone OTP
router.post("/phone/resend-otp", otpLimiter, async (req: Request, res: Response) => {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required.", code: "no_session" });

    const payload = verifySessionToken(token);
    if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });

    await resendPhoneOtp(payload.sub);
    res.json({ success: true, message: "A new verification code has been sent." });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;

/**
 * Express middleware that requires a valid session. Attaches `req.user`.
 * Use to protect any route that must only be reachable by signed-in users.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required.", code: "no_session" });
  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });
  (req as any).user = payload;
  next();
}

/**
 * Requires an authenticated admin. Verifies the role against the database
 * (not just the token) so revoked admins lose access immediately.
 *
 * Special case: the env-based superadmin console signs in with no database row,
 * so its token (sub = "superadmin", role = "admin") cannot be verified against
 * the users table and is accepted on the strength of the signature alone.
 *
 * That makes it the single most valuable token in the system, so it is now
 * accepted only while the console it belongs to is actually configured. If
 * ADMIN_EMAILS / ADMIN_PASSWORD / SUPERADMIN_SECRET are not all set, the
 * console cannot issue a token, and any token claiming to be from it is
 * refused rather than trusted.
 *
 * Note this path is only as strong as JWT_SECRET, which is why a default
 * JWT_SECRET is now a fatal boot error in production (see validateEnv).
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required.", code: "no_session" });
  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: "Session expired.", code: "invalid_session" });

  // ── Synthetic superadmin (env-based console, no DB row) ──
  if (payload.sub === "superadmin") {
    if (payload.role === "admin" && env.isSuperAdminConfigured()) {
      (req as any).user = payload;
      (req as any).adminUser = { id: "superadmin", email: payload.email, role: "admin" };
      return next();
    }
    logger.warn(
      "Refused a superadmin token: the superadmin console is not fully configured " +
        "(ADMIN_EMAILS, ADMIN_PASSWORD and SUPERADMIN_SECRET must all be set)."
    );
    return res.status(403).json({ error: "Administrator access required.", code: "not_admin" });
  }

  if (!env.isDatabaseConfigured()) {
    return res.status(503).json({ error: "Admin features require a configured database.", code: "db_unconfigured" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Administrator access required.", code: "not_admin" });
    }
    (req as any).user = payload;
    (req as any).adminUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: "Authorization check failed.", code: "internal" });
  }
}
