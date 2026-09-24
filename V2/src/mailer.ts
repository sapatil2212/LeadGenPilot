/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
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

function otpEmailHtml(code: string, purpose: string, hasLogo = false): string {
  const app = env.auth.appName;
  const heading =
    purpose === "login"
      ? "Sign-in code"
      : purpose === "reset"
      ? "Reset your password"
      : "Verify your email";
  const intro =
    purpose === "login"
      ? "Enter this 6-digit code to complete your sign in:"
      : purpose === "reset"
      ? "Use this 6-digit code to reset your account password:"
      : "Use this 6-digit code to verify your email address:";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${heading}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 28px 20px 28px;border-bottom:1px solid #f1f5f9;text-align:center;">
                ${
                  hasLogo
                    ? `<img src="cid:navbar-logo" alt="${app}" height="38" style="height:38px;max-height:38px;width:auto;margin:0 auto;display:block;border:0;outline:none;" />`
                    : `<span style="font-size:18px;font-weight:600;color:#0f172a;letter-spacing:-0.2px;display:block;text-align:center;">${app}</span>`
                }
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 28px 28px 28px;text-align:center;">
                <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:#0f172a;letter-spacing:-0.2px;line-height:1.3;text-align:center;">${heading}</h1>
                <p style="margin:0 auto 20px auto;max-width:340px;font-size:13px;line-height:1.5;color:#475569;text-align:center;">${intro}</p>
                <div style="text-align:center;margin:0 0 20px 0;">
                  <div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 28px;">
                    <span style="font-family:'Inter',monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#0f172a;">${code}</span>
                  </div>
                </div>
                <p style="margin:0 auto;max-width:340px;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">
                  This code expires in ${env.auth.otpTtlMinutes} minutes. If you didn't request it, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 28px;border-top:1px solid #f1f5f9;background:#fafbfc;text-align:center;">
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
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    const hasLogo = fs.existsSync(logoPath);

    const mailOptions: any = {
      from: `"${fromName}" <${env.smtp.user}>`,
      to,
      subject:
        purpose === "login"
          ? `${env.auth.appName} sign-in code: ${code}`
          : purpose === "reset"
          ? `${env.auth.appName} password reset code: ${code}`
          : `${env.auth.appName} verification code: ${code}`,
      text: `Your ${env.auth.appName} code is ${code}. It expires in ${env.auth.otpTtlMinutes} minutes.`,
      html: otpEmailHtml(code, purpose, hasLogo),
    };

    if (hasLogo) {
      mailOptions.attachments = [
        {
          filename: "logo.png",
          path: logoPath,
          cid: "navbar-logo",
        },
      ];
    }

    await transporter.sendMail(mailOptions);
    logger.success(`OTP email dispatched to ${to}.`);
    return true;
  } catch (err: any) {
    logger.error(`Failed to send OTP email to ${to}`, err);
    return false;
  }
}
