/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — the passwordless login bypass
 *
 * resendOtp({ email, purpose: "login" }) used to mint a login OTP for ANY
 * existing account, and verifyOtp accepted the "login" purpose and returned a
 * full session. Together that was a complete password bypass for any known
 * email address: it never called bcrypt.compare, so the failed-login counter
 * and the account lockout were never consulted either.
 *
 * Also covers the JWT algorithm pinning added to verifySessionToken.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { createPrismaMock, type PrismaMock, TENANT_A } from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

// Never send real mail from a test.
const sendOtpEmail = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../src/mailer", () => ({ sendOtpEmail }));

const { resendOtp, verifyOtp, issueSessionToken, verifySessionToken, AuthError } =
  await import("../src/authService");
const { env } = await import("../src/env");

const UNVERIFIED = { ...TENANT_A, emailVerified: false };

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  sendOtpEmail.mockClear();
});

describe("resendOtp cannot mint a login code", () => {
  it("rejects purpose 'login'", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(TENANT_A);

    await expect(resendOtp({ email: TENANT_A.email, purpose: "login" })).rejects.toMatchObject({
      code: "unsupported_purpose",
    });
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(mocks.prisma.emailOtp.create).not.toHaveBeenCalled();
  });

  it("rejects purpose 'reset' too — password reset has its own endpoint", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(TENANT_A);

    await expect(resendOtp({ email: TENANT_A.email, purpose: "reset" })).rejects.toBeInstanceOf(AuthError);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("records the rejected attempt in the audit log", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(TENANT_A);
    await resendOtp({ email: TENANT_A.email, purpose: "login" }).catch(() => {});
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "otp_resend_rejected" }) })
    );
  });
});

describe("resendOtp still supports genuine email verification", () => {
  it("sends a verification code to an unverified account", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(UNVERIFIED);
    mocks.prisma.emailOtp.findFirst.mockResolvedValue(null);

    await expect(resendOtp({ email: UNVERIFIED.email, purpose: "verify" })).resolves.toEqual({ ok: true });
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.emailOtp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ purpose: "verify" }) })
    );
  });

  it("defaults to the verify purpose when none is given", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(UNVERIFIED);
    mocks.prisma.emailOtp.findFirst.mockResolvedValue(null);

    await expect(resendOtp({ email: UNVERIFIED.email })).resolves.toEqual({ ok: true });
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for an already-verified account, without revealing that", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(TENANT_A);

    await expect(resendOtp({ email: TENANT_A.email, purpose: "verify" })).resolves.toEqual({ ok: true });
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for an unknown address, without revealing that", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);

    await expect(resendOtp({ email: "nobody@example.test", purpose: "verify" })).resolves.toEqual({ ok: true });
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });
});

describe("verifyOtp cannot be used to sign in with a non-verify purpose", () => {
  it.each(["login", "reset"] as const)("rejects purpose %j before touching the OTP table", async (purpose) => {
    await expect(
      verifyOtp({ email: TENANT_A.email, code: "123456", purpose })
    ).rejects.toMatchObject({ code: "unsupported_purpose" });

    expect(mocks.prisma.emailOtp.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("verifySessionToken pins the signing algorithm", () => {
  it("accepts a token this server issued", () => {
    const token = issueSessionToken({ id: TENANT_A.id, email: TENANT_A.email, role: "user" });
    expect(verifySessionToken(token)?.sub).toBe(TENANT_A.id);
  });

  it("rejects an unsigned 'alg: none' token", () => {
    const unsigned = jwt.sign(
      { sub: "superadmin", email: "a@b.c", role: "admin" },
      "",
      { algorithm: "none" as any }
    );
    expect(verifySessionToken(unsigned)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = jwt.sign({ sub: TENANT_A.id, email: TENANT_A.email, role: "admin" }, "not-our-secret");
    expect(verifySessionToken(foreign)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign(
      { sub: TENANT_A.id, email: TENANT_A.email, role: "user" },
      env.auth.jwtSecret,
      { expiresIn: -10 }
    );
    expect(verifySessionToken(expired)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken("not.a.token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });
});
