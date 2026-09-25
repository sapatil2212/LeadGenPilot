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
import { sendSmsOtp, isValidPhone, normalizePhone } from "./smsService";
import { logger } from "./logger";
import { ensureTenantForUser, listMemberships } from "./tenancy/tenantService";

export type OtpPurpose = "verify" | "login" | "reset" | "phone_verify";

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
const SUPPORT_EMAIL = "leadgenpilot.in@gmail.com";
const ACCOUNT_SUSPENDED_MESSAGE =
  `This account has been suspended. Please contact support at ${SUPPORT_EMAIL} to restore access.`;

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
    { algorithm: "HS256", expiresIn: `${env.auth.sessionDays}d` }
  );
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
};

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    // Pin the algorithm. Without `algorithms`, jsonwebtoken accepts any
    // algorithm named in the token header, which is the classic algorithm-
    // confusion foothold. Tokens are issued with HS256, so only HS256 is
    // accepted here.
    return jwt.verify(token, env.auth.jwtSecret, { algorithms: ["HS256"] }) as SessionPayload;
  } catch {
    return null;
  }
}

const SUPERADMIN_TOKEN_AUDIENCE = "superadmin-console";
const SUPERADMIN_TOKEN_ISSUER = "leadgenpilot";

type SuperAdminSession = {
  sub: "superadmin";
  email: string;
  role: "admin";
  tokenType: "superadmin";
  iat?: number;
  exp?: number;
};

/** Issues a token that cannot be confused with an ordinary user/admin JWT. */
export function issueSuperAdminSessionToken(
  email: string,
  options?: { expiresAt?: number }
): string {
  const payload = { sub: "superadmin", email, role: "admin", tokenType: "superadmin" };
  const common = {
    algorithm: "HS256" as const,
    audience: SUPERADMIN_TOKEN_AUDIENCE,
    issuer: SUPERADMIN_TOKEN_ISSUER,
  };

  // Migration must preserve the legacy bearer's absolute expiry rather than
  // silently granting a fresh full-duration session.
  if (options?.expiresAt) {
    return jwt.sign({ ...payload, exp: options.expiresAt }, env.auth.jwtSecret, common);
  }

  return jwt.sign(payload, env.auth.jwtSecret, {
    ...common,
    expiresIn: `${env.auth.superAdminSessionDays}d`,
  });
}

/** Verifies the dedicated token type, audience, issuer and synthetic identity. */
export function verifySuperAdminSessionToken(token: string): SuperAdminSession | null {
  try {
    const payload = jwt.verify(token, env.auth.jwtSecret, {
      algorithms: ["HS256"],
      audience: SUPERADMIN_TOKEN_AUDIENCE,
      issuer: SUPERADMIN_TOKEN_ISSUER,
    }) as SuperAdminSession;

    if (
      payload.sub !== "superadmin" ||
      payload.role !== "admin" ||
      payload.tokenType !== "superadmin" ||
      typeof payload.email !== "string" ||
      payload.email.trim() === ""
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function baseSessionCookieOptions(maxAge: number) {
  // env.auth.cookieSecure is `undefined` when COOKIE_SECURE is not set →
  // fall back to auto-detect from NODE_ENV. Explicit `false` supports local
  // HTTP development; production should terminate TLS and use secure cookies.
  const secure = env.auth.cookieSecure ?? env.isProduction;
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

export function sessionCookieOptions() {
  return baseSessionCookieOptions(env.auth.sessionDays * 24 * 60 * 60 * 1000);
}

export function superAdminSessionCookieOptions(
  maxAge = env.auth.superAdminSessionDays * 24 * 60 * 60 * 1000
) {
  return baseSessionCookieOptions(maxAge);
}

// ── OTP lifecycle ──

/**
 * Generates a fresh OTP for an email or phone, persists its hash, and sends the code.
 * Enforces a resend cooldown to prevent spamming.
 */
async function createAndSendOtp(
  target: string,
  purpose: OtpPurpose,
  userId?: string | null,
  targetType: "email" | "phone" = "email"
): Promise<void> {
  // OTPs for phone verification are bound to the account that requested them;
  // knowing a code issued for the same phone on another account is insufficient.
  const whereClause = {
    ...(targetType === "email" ? { email: target, phone: null } : { phone: target, email: null }),
    purpose,
    consumed: false,
    ...(userId ? { userId } : {}),
  };

  // Resend cooldown: reject if a very recent unconsumed OTP exists.
  const recent = await prisma.emailOtp.findFirst({
    where: whereClause,
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

  // Invalidate any prior outstanding codes for this target+purpose.
  await prisma.emailOtp.updateMany({
    where: {
      ...(targetType === "email" ? { email: target, phone: null } : { phone: target, email: null }),
      purpose,
      consumed: false,
    },
    data: { consumed: true },
  });

  const code = generateNumericCode(env.auth.otpLength);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.auth.otpTtlMinutes * 60 * 1000);

  const otpData: any = {
    codeHash,
    purpose,
    expiresAt,
    userId: userId ?? null,
  };

  if (targetType === "email") {
    otpData.email = target;
    otpData.phone = null;
  } else {
    otpData.phone = target;
    otpData.email = null;
  }

  const createdOtp = await prisma.emailOtp.create({ data: otpData });

  // Send via appropriate channel. A failed delivery must not leave a valid
  // code behind that can be recovered from logs or block a retry by cooldown.
  let sent = false;
  if (targetType === "email") {
    sent = await sendOtpEmail(target, code, purpose);
    if (!sent) {
      await prisma.emailOtp.update({ where: { id: createdOtp.id }, data: { consumed: true } });
      throw new AuthError(502, "email_failed", "Failed to send the verification email. Please try again.");
    }
  } else {
    sent = await sendSmsOtp({ phone: target, code, purpose: purpose as any });
    if (!sent) {
      await prisma.emailOtp.update({ where: { id: createdOtp.id }, data: { consumed: true } });
      throw new AuthError(502, "sms_failed", "Failed to send the verification SMS. Please try again.");
    }
  }
}

/**
 * Validates an OTP code for an email or phone + purpose. Consumes it on success.
 */
async function consumeOtp(
  target: string,
  code: string,
  purpose: OtpPurpose,
  targetType: "email" | "phone" = "email",
  userId?: string
): Promise<void> {
  const whereClause = {
    ...(targetType === "email" ? { email: target, phone: null } : { phone: target, email: null }),
    purpose,
    consumed: false,
    ...(userId ? { userId } : {}),
  };

  const otp = await prisma.emailOtp.findFirst({
    where: whereClause,
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
export async function signup(input: {
  name?: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<{ requiresVerification: true }> {
  const email = normalizeEmail(input.email);
  const name = (input.name || "").trim() || null;
  const password = String(input.password || "");
  const phone = input.phone ? normalizePhone(input.phone) : null;

  if (!EMAIL_RE.test(email)) throw new AuthError(400, "invalid_email", "Please enter a valid email address.");
  if (password.length < 8) throw new AuthError(400, "weak_password", "Password must be at least 8 characters.");

  // Validate phone if provided
  if (phone && !isValidPhone(phone)) {
    throw new AuthError(400, "invalid_phone", "Please enter a valid phone number with country code (e.g., +91XXXXXXXXXX).");
  }
  if (phone) {
    const phoneOwner = await prisma.user.findFirst({ where: { phone } });
    if (phoneOwner && phoneOwner.email !== email) {
      throw new AuthError(409, "phone_taken", "This phone number is already registered to another account.");
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.emailVerified) {
      throw new AuthError(409, "email_taken", "An account with this email already exists. Please sign in.");
    }
    // Account exists but not verified — update password/name/phone and resend OTP.
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name ?? existing.name,
        phone: phone ?? existing.phone,
      }
    });
    await createAndSendOtp(email, "verify", existing.id, "email");
    return { requiresVerification: true };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, phone, emailVerified: false, phoneVerified: false },
  });
  await createAndSendOtp(email, "verify", user.id, "email");
  await writeAudit("signup", { userId: user.id });
  logger.info(`New signup pending verification: ${email}`);
  return { requiresVerification: true };
}

/**
 * Verifies a signup/login OTP. On success, marks the email verified (if needed)
 * and returns the verified user. A password login creates the session.
 */
export async function verifyOtp(input: { email: string; code: string; purpose?: OtpPurpose }): Promise<{ user: PublicUser }> {
  const email = normalizeEmail(input.email);

  /*
   * Only email-verification codes can be exchanged for a session here.
   *
   * No "login"-purpose OTP can exist any more (resendOtp refuses to mint one,
   * and login() only ever creates "verify"), so this branch is already
   * unreachable in practice. Rejecting it explicitly keeps the password-bypass
   * path from reappearing the moment someone adds a new OTP producer.
   * "reset" codes are exchanged by resetPassword, never for a session.
   */
  if (input.purpose && input.purpose !== "verify") {
    await writeAudit("otp_verify_rejected", { data: { email, requestedPurpose: input.purpose } });
    throw new AuthError(
      400,
      "unsupported_purpose",
      "This code cannot be used to sign in."
    );
  }
  const purpose: OtpPurpose = "verify";

  await consumeOtp(email, input.code, purpose, "email");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError(404, "user_not_found", "Account not found.");

  const role = env.isBootstrapAdmin(email) ? "admin" : user.role;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, role },
  });

  // A session without a workspace is unusable and produces authorization
  // failures on every tenant route. Provision first and fail the verification
  // request if workspace creation fails; the next login can safely retry.
  await ensureTenantForUser(updated.id);

  await writeAudit("email_verified", { userId: updated.id });
  return { user: toPublicUser(updated) };
}

// ── Password reset ──

/**
 * Sends a password-reset OTP. Verifies account existence first.
 */
export async function requestPasswordReset(email: string, meta?: RequestMeta): Promise<{ ok: true }> {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) throw new AuthError(400, "invalid_email", "Please enter a valid email address.");
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    throw new AuthError(404, "user_not_found", "No account exists with this email address. Please register first.");
  }
  await createAndSendOtp(normalized, "reset", user.id, "email");
  await writeAudit("password_reset_requested", { userId: user.id, meta });
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

  await consumeOtp(email, input.code, "reset", "email");

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
  if (!user) {
    await writeAudit("login_failed", { meta, data: { email, reason: "no_user" } });
    throw new AuthError(404, "email_not_registered", "This email is not registered.");
  }

  // Account lockout check.
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
    throw new AuthError(423, "account_locked", `Account temporarily locked after too many attempts. Try again in ${mins} minute(s).`);
  }

  /*
   * Administrative suspension.
   *
   * Checked after the lockout test but before bcrypt, and worded plainly rather
   * than as "invalid credentials": a suspended customer needs to know to contact
   * support, not to keep retrying a password that is in fact correct. The
   * enumeration concern that justifies the uniform error above does not apply
   * here, because reaching this line already required knowing the address
   * belongs to a real account.
   */
  if (user.status === "suspended") {
    await writeAudit("login_refused_suspended", { userId: user.id, meta });
    throw new AuthError(
      403,
      "account_suspended",
      ACCOUNT_SUSPENDED_MESSAGE
    );
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
    throw new AuthError(401, "wrong_password", "The password you entered is incorrect.");
  }

  // A workspace suspension is separate from an individual user suspension. If
  // every active membership belongs to a suspended tenant, deny a fresh login
  // without changing the user or membership records. Users who still have at
  // least one active workspace remain able to sign in there.
  const memberships = await listMemberships(user.id);
  if (memberships.length > 0 && !memberships.some((membership) => membership.tenantStatus === "active")) {
    await writeAudit("login_refused_suspended_tenant", {
      userId: user.id,
      meta,
      data: { tenantIds: memberships.map((membership) => membership.tenantId) },
    });
    throw new AuthError(403, "account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
  }

  if (!user.emailVerified) {
    await createAndSendOtp(email, "verify", user.id, "email");
    return { requiresVerification: true, email };
  }

  // Successful login: reset lockout counters and bootstrap admin role if configured.
  const role = env.isBootstrapAdmin(email) ? "admin" : user.role;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null, role },
  });

  // Do not issue a session that cannot resolve a workspace. This is
  // idempotent and repairs legacy accounts on their next successful login.
  await ensureTenantForUser(updated.id);

  await writeAudit("login_success", { userId: user.id, meta });
  const token = issueSessionToken(updated);
  return { user: toPublicUser(updated), token };
}

/**
 * Resends a verification OTP for an email (only if the account is unverified).
 *
 * SECURITY: this used to honour `purpose: "login"`, which issued a login OTP
 * for ANY existing account — verified or not. Since verifyOtp accepts the
 * "login" purpose and returns a full session, that combination was a complete
 * password bypass: request a code for any known email, read it from the inbox,
 * and receive a session. It also never touched bcrypt.compare, so the failed-
 * login counter and account lockout were never consulted.
 *
 * Passwordless login is a legitimate feature, but it is not this one — it would
 * need its own deliberate flow, rate limiting and audit trail. Until then the
 * only purpose this endpoint can issue is "verify", and only for an account
 * that has not yet verified its email address.
 */
export async function resendOtp(input: { email: string; purpose?: OtpPurpose }): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);

  if (input.purpose && input.purpose !== "verify") {
    await writeAudit("otp_resend_rejected", { data: { email, requestedPurpose: input.purpose } });
    throw new AuthError(
      400,
      "unsupported_purpose",
      "Only email-verification codes can be requested here. Use the password form to sign in, " +
        "or 'Forgot password' to reset it."
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Do not reveal whether the account exists; only send when appropriate.
  if (user && !user.emailVerified) {
    await createAndSendOtp(email, "verify", user.id, "email");
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

/**
 * Sends an OTP to verify phone number
 */
export async function sendPhoneVerificationOtp(
  userId: string,
  phone: string
): Promise<{ ok: true }> {
  const normalized = normalizePhone(phone);

  if (!isValidPhone(normalized)) {
    throw new AuthError(400, "invalid_phone", "Please enter a valid phone number with country code.");
  }

  // A normalized phone is an account identifier and cannot be shared, even
  // while verification is pending. The database unique index is the final
  // arbiter for concurrent requests.
  const existing = await prisma.user.findFirst({
    where: {
      phone: normalized,
      id: { not: userId }
    }
  });

  if (existing) {
    throw new AuthError(409, "phone_taken", "This phone number is already registered to another account.");
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { phone: normalized, phoneVerified: false }
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw new AuthError(409, "phone_taken", "This phone number is already registered to another account.");
    }
    throw err;
  }

  await createAndSendOtp(normalized, "phone_verify", userId, "phone");
  await writeAudit("phone_verification_requested", { userId });

  return { ok: true };
}

/**
 * Verifies phone OTP and marks phone as verified
 */
export async function verifyPhoneOtp(
  userId: string,
  code: string
): Promise<{ ok: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.phone) {
    throw new AuthError(400, "no_phone", "No phone number associated with this account.");
  }

  await consumeOtp(user.phone, code, "phone_verify", "phone", userId);

  await prisma.user.update({
    where: { id: userId },
    data: { phoneVerified: true }
  });

  await writeAudit("phone_verified", { userId });

  return { ok: true };
}

/**
 * Resends phone verification OTP
 */
export async function resendPhoneOtp(userId: string): Promise<{ ok: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || !user.phone) {
    throw new AuthError(400, "no_phone", "No phone number associated with this account.");
  }

  if (user.phoneVerified) {
    throw new AuthError(400, "already_verified", "Phone number is already verified.");
  }

  await createAndSendOtp(user.phone, "phone_verify", userId, "phone");

  return { ok: true };
}
