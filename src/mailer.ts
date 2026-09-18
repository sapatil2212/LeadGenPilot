/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Builds a nodemailer transport from the configured SMTP settings.
 * Uses the Gmail service shortcut when the host is Gmail for reliable delivery.
 */
function createTransport() {
  const { host, port, user, pass } = env.smtp;
  const isGmail = host.includes("gmail");
  if (isGmail) {
    return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

function otpEmailHtml(code: string, purpose: string): string {
  const app = env.auth.appName;
  const heading =
    purpose === "login"
      ? "Your sign-in code"
      : purpose === "reset"
      ? "Reset your password"
      : "Verify your email";
  const intro =
    purpose === "login"
      ? "Use the code below to sign in to your account."
      : purpose === "reset"
      ? "We received a request to reset your password. Use the code below to continue. If you didn't request this, you can safely ignore this email."
      : "Welcome! Use the code below to verify your email address and activate your account.";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${app}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a;">${heading}</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">${intro}</p>
                <div style="text-align:center;margin:0 0 24px;">
                  <div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 28px;">
                    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4f46e5;">${code}</span>
                  </div>
                </div>
                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
                  This code expires in ${env.auth.otpTtlMinutes} minutes. If you didn't request it, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
                <span style="font-size:11px;color:#94a3b8;">&copy; ${new Date().getFullYear()} ${app}. All rights reserved.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Sends a one-time password code to the given email address.
 * Returns true on success. In development without SMTP configured, the code
 * is logged to the console so the flow can still be tested end-to-end.
 */
export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: string
): Promise<boolean> {
  if (!env.isSmtpConfigured()) {
    if (!env.isProduction) {
      logger.warn(
        `SMTP not configured — OTP for ${to} (dev fallback): ${code}`
      );
      return true;
    }
    logger.error("Cannot send OTP email: SMTP is not configured.");
    return false;
  }

  try {
    const transporter = createTransport();
    const fromName = env.smtp.from || env.auth.appName;
    await transporter.sendMail({
      from: `"${fromName}" <${env.smtp.user}>`,
      to,
      subject:
        purpose === "login"
          ? `${env.auth.appName} sign-in code: ${code}`
          : purpose === "reset"
          ? `${env.auth.appName} password reset code: ${code}`
          : `${env.auth.appName} verification code: ${code}`,
      text: `Your ${env.auth.appName} code is ${code}. It expires in ${env.auth.otpTtlMinutes} minutes.`,
      html: otpEmailHtml(code, purpose),
    });
    logger.success(`OTP email dispatched to ${to}.`);
    return true;
  } catch (err: any) {
    logger.error(`Failed to send OTP email to ${to}`, err);
    return false;
  }
}
