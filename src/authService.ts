/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { env } from "./env";
import { sendOtpEmail } from "./mailer";
import { logger } from "./logger";

export type OtpPurpose = "verify" | "login" | "reset";

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Records a security/activity event to the audit log. Best-effort — failures
 * never block the primary operation.
 */
export async function writeAudit(
  action: string,
  opts: { userId?: string | null; meta?: RequestMeta; data?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId ?? null,
        ip: opts.meta?.ip ?? null,
        userAgent: opts.meta?.userAgent ?? null,
        metadata: opts.data ? JSON.stringify(opts.data) : null,
      },
    });
  } catch (err) {
    logger.warn(`Audit log write failed for '${action}': ${(err as Error).message}`);
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  emailVerified: boolean;
  createdAt: Date;
}

export class AuthError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function toPublicUser(user: any): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    plan: user.plan ?? "free",
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

function generateNumericCode(length: number): string {
  // Cryptographically secure numeric OTP.
  let code = "";
  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code.slice(0, length);
}

// ── JWT session helpers ──

export function issueSessionToken(user: { id: string; email: string; role: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.auth.jwtSecret,
    { expiresIn: `${env.auth.sessionDays}d` }
  );
}

export function verifySessionToken(token: string): { sub: string; email: string; role: string } | null {
  try {
    return jwt.verify(token, env.auth.jwtSecret) as any;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  // env.auth.cookieSecure is `undefined` when COOKIE_SECURE is not set →
  // fall back to auto-detect from NODE_ENV.  Explicit `false` lets HTTP-only
  // VPS deployments send session cookies over plain HTTP.
  const secure = env.auth.cookieSecure ?? env.isProduction;
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: env.auth.sessionDays * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

// ── OTP lifecycle ──

/**
 * Generates a fresh OTP for an email, persists its hash, and emails the code.
 * Enforces a resend cooldown to prevent spamming.
 */
async function createAndSendOtp(email: string, purpose: OtpPurpose, userId?: string | null): Promise<void> {
  // Resend cooldown: reject if a very recent unconsumed OTP exists.
  const recent = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumed: false },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    const ageSeconds = (Date.now() - new Date(recent.createdAt).getTime()) / 1000;
    if (ageSeconds < env.auth.otpResendSeconds) {
      throw new AuthError(
        429,
        "otp_cooldown",
        `Please wait ${Math.ceil(env.auth.otpResendSeconds - ageSeconds)}s before requesting another code.`
      );
    }
  }

  // Invalidate any prior outstanding codes for this email+purpose.
  await prisma.emailOtp.updateMany({
    where: { email, purpose, consumed: false },
    data: { consumed: true },
  });

  const code = generateNumericCode(env.auth.otpLength);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.auth.otpTtlMinutes * 60 * 1000);

  await prisma.emailOtp.create({
    data: { email, codeHash, purpose, expiresAt, userId: userId ?? null },
  });

  const sent = await sendOtpEmail(email, code, purpose);
  if (!sent) {
    throw new AuthError(502, "email_failed", "Failed to send the verification email. Please try again.");
  }
}

/**
 * Validates an OTP code for an email+purpose. Consumes it on success.
 */
async function consumeOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
  const otp = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumed: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    throw new AuthError(400, "otp_not_found", "No active verification code. Please request a new one.");
  }
  if (new Date(otp.expiresAt).getTime() < Date.now()) {
    throw new AuthError(400, "otp_expired", "This code has expired. Please request a new one.");
  }
  if (otp.attempts >= env.auth.otpMaxAttempts) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumed: true } });
    throw new AuthError(429, "otp_attempts", "Too many incorrect attempts. Please request a new code.");
  }

  const ok = await bcrypt.compare(String(code || ""), otp.codeHash);
  if (!ok) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const remaining = env.auth.otpMaxAttempts - (otp.attempts + 1);
    throw new AuthError(
      400,
      "otp_invalid",
      remaining > 0 ? `Incorrect code. ${remaining} attempt(s) remaining.` : "Incorrect code."
    );
  }

  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumed: true } });
}

// ── Public auth operations ──

/**
 * Registers a new user (unverified) and sends a verification OTP.
 * If an unverified account already exists, resends the code instead.
 */
export async function signup(input: { name?: string; email: string; password: string }): Promise<{ requiresVerification: true }> {
  const email = normalizeEmail(input.email);
  const name = (input.name || "").trim() || null;
  const password = String(input.password || "");

  if (!EMAIL_RE.test(email)) throw new AuthError(400, "invalid_email", "Please enter a valid email address.");
  if (password.length < 8) throw new AuthError(400, "weak_password", "Password must be at least 8 characters.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.emailVerified) {
      throw new AuthError(409, "email_taken", "An account with this email already exists. Please sign in.");
    }
    // Account exists but not verified — update password/name and resend OTP.
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name: name ?? existing.name } });
    await createAndSendOtp(email, "verify", existing.id);
    return { requiresVerification: true };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, emailVerified: false },
  });
  await createAndSendOtp(email, "verify", user.id);
  await writeAudit("signup", { userId: user.id });
  logger.info(`New signup pending verification: ${email}`);
  return { requiresVerification: true };
}

/**
 * Verifies a signup/login OTP. On success, marks the email verified (if needed)
 * and returns the user plus a session token.
 */
export async function verifyOtp(input: { email: string; code: string; purpose?: OtpPurpose }): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email);
  const purpose: OtpPurpose = input.purpose === "login" ? "login" : "verify";

  await consumeOtp(email, input.code, purpose);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError(404, "user_not_found", "Account not found.");

  const role = env.isBootstrapAdmin(email) ? "admin" : user.role;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, role },
  });

  await writeAudit("email_verified", { userId: updated.id });
  const token = issueSessionToken(updated);
  return { user: toPublicUser(updated), token };
}

// ── Password reset ──

/**
 * Sends a password-reset OTP. Always resolves successfully to avoid revealing
 * whether an account exists.
 */
export async function requestPasswordReset(email: string, meta?: RequestMeta): Promise<{ ok: true }> {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) throw new AuthError(400, "invalid_email", "Please enter a valid email address.");
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (user) {
    try {
      await createAndSendOtp(normalized, "reset", user.id);
      await writeAudit("password_reset_requested", { userId: user.id, meta });
    } catch (err) {
      // Swallow cooldown errors so the response stays uniform.
      if (!(err instanceof AuthError && err.code === "otp_cooldown")) throw err;
    }
  }
  return { ok: true };
}

/**
 * Completes a password reset: validates the OTP and sets the new password.
 */
export async function resetPassword(
  input: { email: string; code: string; password: string },
  meta?: RequestMeta
): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  if (password.length < 8) throw new AuthError(400, "weak_password", "Password must be at least 8 characters.");

  await consumeOtp(email, input.code, "reset");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError(404, "user_not_found", "Account not found.");

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, emailVerified: true, failedLoginAttempts: 0, lockedUntil: null },
  });
  await writeAudit("password_reset_completed", { userId: user.id, meta });
  return { ok: true };
}

// ── Account self-service ──

export async function updateProfile(userId: string, input: { name?: string }): Promise<PublicUser> {
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 120) || null : undefined;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { ...(name !== undefined ? { name } : {}) },
  });
  return toPublicUser(updated);
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  meta?: RequestMeta
): Promise<{ ok: true }> {
  const newPassword = String(input.newPassword || "");
  if (newPassword.length < 8) throw new AuthError(400, "weak_password", "New password must be at least 8 characters.");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError(404, "user_not_found", "Account not found.");

  const ok = await bcrypt.compare(String(input.currentPassword || ""), user.passwordHash);
  if (!ok) throw new AuthError(400, "invalid_current_password", "Your current password is incorrect.");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await writeAudit("password_changed", { userId, meta });
  return { ok: true };
}

export async function deleteAccount(
  userId: string,
  input: { password: string },
  meta?: RequestMeta
): Promise<{ ok: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError(404, "user_not_found", "Account not found.");
  const ok = await bcrypt.compare(String(input.password || ""), user.passwordHash);
  if (!ok) throw new AuthError(400, "invalid_current_password", "Password is incorrect.");
  await writeAudit("account_deleted", { userId, meta, data: { email: user.email } });
  await prisma.user.delete({ where: { id: userId } });
  return { ok: true };
}

// ── Admin operations ──

const VALID_PLANS = ["free", "pro", "custom"];
const VALID_ROLES = ["user", "admin"];

export async function adminListUsers(input: { page?: number; pageSize?: number; search?: string }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 20));
  const where = input.search
    ? { OR: [{ email: { contains: input.search } }, { name: { contains: input.search } }] }
    : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      plan: u.plan,
      emailVerified: u.emailVerified,
      leadsUsed: u.leadsUsed,
      usagePeriod: u.usagePeriod,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
  };
}

export async function adminUpdateUser(
  targetUserId: string,
  input: { plan?: string; role?: string },
  actorId?: string,
  meta?: RequestMeta
): Promise<PublicUser> {
  const data: any = {};
  if (input.plan !== undefined) {
    const plan = String(input.plan).toLowerCase();
    if (!VALID_PLANS.includes(plan)) throw new AuthError(400, "invalid_plan", `Plan must be one of: ${VALID_PLANS.join(", ")}.`);
    data.plan = plan;
  }
  if (input.role !== undefined) {
    const role = String(input.role).toLowerCase();
    if (!VALID_ROLES.includes(role)) throw new AuthError(400, "invalid_role", `Role must be one of: ${VALID_ROLES.join(", ")}.`);
    data.role = role;
  }
  if (Object.keys(data).length === 0) throw new AuthError(400, "no_changes", "Nothing to update.");

  const updated = await prisma.user.update({ where: { id: targetUserId }, data }).catch(() => null);
  if (!updated) throw new AuthError(404, "user_not_found", "Target user not found.");
  await writeAudit("admin_updated_user", { userId: actorId, meta, data: { targetUserId, ...data } });
  return toPublicUser(updated);
}

export async function adminListAuditLogs(input: { page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize || 50));
  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { email: true } } },
    }),
  ]);
  return { total, page, pageSize, logs };
}

/**
 * Authenticates with email + password.
 * - If credentials are valid and the email is verified, returns a session.
 * - If the email is not verified, sends a verification OTP and signals the
 *   client to complete verification.
 */
export async function login(
  input: { email: string; password: string },
  meta?: RequestMeta
): Promise<{ user: PublicUser; token: string } | { requiresVerification: true; email: string }> {
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");

  if (!EMAIL_RE.test(email)) throw new AuthError(400, "invalid_email", "Please enter a valid email address.");

  const user = await prisma.user.findUnique({ where: { email } });
  // Uniform error to avoid leaking which emails are registered.
  if (!user) {
    await writeAudit("login_failed", { meta, data: { email, reason: "no_user" } });
    throw new AuthError(401, "invalid_credentials", "Invalid email or password.");
  }

  // Account lockout check.
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
    throw new AuthError(423, "account_locked", `Account temporarily locked after too many attempts. Try again in ${mins} minute(s).`);
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const data: any = { failedLoginAttempts: attempts };
    let locked = false;
    if (attempts >= env.auth.maxFailedLogins) {
      data.lockedUntil = new Date(Date.now() + env.auth.lockoutMinutes * 60 * 1000);
      data.failedLoginAttempts = 0;
      locked = true;
    }
    await prisma.user.update({ where: { id: user.id }, data });
    await writeAudit("login_failed", { userId: user.id, meta, data: { attempts, locked } });
    if (locked) {
      throw new AuthError(423, "account_locked", `Too many failed attempts. Your account is locked for ${env.auth.lockoutMinutes} minutes.`);
    }
    throw new AuthError(401, "invalid_credentials", "Invalid email or password.");
  }

  if (!user.emailVerified) {
    await createAndSendOtp(email, "verify", user.id);
    return { requiresVerification: true, email };
  }

  // Successful login: reset lockout counters and bootstrap admin role if configured.
  const role = env.isBootstrapAdmin(email) ? "admin" : user.role;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, role },
  });
  await writeAudit("login_success", { userId: user.id, meta });
  const token = issueSessionToken(updated);
  return { user: toPublicUser(updated), token };
}

/**
 * Resends a verification OTP for an email (only if the account is unverified).
 */
export async function resendOtp(input: { email: string; purpose?: OtpPurpose }): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);
  const purpose: OtpPurpose = input.purpose === "login" ? "login" : "verify";

  const user = await prisma.user.findUnique({ where: { email } });
  // Do not reveal whether the account exists; only send when appropriate.
  if (user && (purpose === "login" || !user.emailVerified)) {
    await createAndSendOtp(email, purpose, user.id);
  }
  return { ok: true };
}

/**
 * Fetches the current user by id (for session hydration).
 */
export async function getUserById(id: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toPublicUser(user) : null;
}
