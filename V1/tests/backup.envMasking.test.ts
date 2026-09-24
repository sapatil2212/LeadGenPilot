/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — the archived copy of `.env` must not carry secrets.
 *
 * A backup archive is copied around, attached to tickets and kept far longer than
 * a deployment, so it is the wrong place for a credential. The masking used to be
 * a deny-list of secret names, which missed `ENCRYPTION_KEY` — the key that
 * protects stored tenant integration credentials — and wrote it out in clear text.
 * These tests pin the inverted rule: values are masked unless the key is a known
 * operational setting.
 */
import { describe, expect, it } from "vitest";
import { maskEnvContent } from "../src/backup";

describe("environment masking in backups", () => {
  it("masks a secret whose name was never on any deny-list", () => {
    const masked = maskEnvContent("ENCRYPTION_KEY=2f8a1c4e9b7d6f3a\n");
    expect(masked).toContain("ENCRYPTION_KEY=********");
    expect(masked).not.toContain("2f8a1c4e9b7d6f3a");
  });

  it.each([
    ["DATABASE_URL", "mysql://user:pa55word@db.internal:3306/app"],
    ["JWT_SECRET", "s3cret-signing-value"],
    ["SMTP_PASS", "mailbox-password"],
    ["GEMINI_API_KEY", "AIzaFAKEKEYVALUE"],
    ["OPENROUTER_API_KEY", "sk-or-v1-FAKE"],
    ["META_APP_SECRET", "meta-app-secret"],
    ["WHATSAPP_ACCESS_TOKEN", "EAA-FAKE-TOKEN"],
    ["SUPERADMIN_SECRET", "superadmin-value"],
    ["GOOGLE_SHEET_WEBHOOK_URL", "https://script.google.com/macros/s/FAKE/exec"],
    ["SOME_FUTURE_CREDENTIAL", "not-yet-invented"],
  ])("masks %s", (key, value) => {
    const masked = maskEnvContent(`${key}=${value}\n`);
    expect(masked).toBe(`${key}=********\n`);
    expect(masked).not.toContain(value);
  });

  it.each([
    ["NODE_ENV", "production"],
    ["PORT", "3000"],
    ["LOG_LEVEL", "info"],
    ["SMTP_HOST", "smtp.example.test"],
    ["SMTP_PORT", "587"],
    ["CAMPAIGN_WORKER_POLL_MS", "2000"],
  ])("keeps the operational setting %s readable", (key, value) => {
    expect(maskEnvContent(`${key}=${value}`)).toBe(`${key}=${value}`);
  });

  it("preserves comments, blank lines and key order", () => {
    const original = ["# Database", "DATABASE_URL=mysql://u:p@h/db", "", "# Runtime", "NODE_ENV=production", "PORT=3000"].join("\n");

    const masked = maskEnvContent(original);

    expect(masked.split("\n")).toEqual(["# Database", "DATABASE_URL=********", "", "# Runtime", "NODE_ENV=production", "PORT=3000"]);
  });

  it("leaves an empty value alone rather than inventing a secret", () => {
    expect(maskEnvContent("OPTIONAL_TOKEN=")).toBe("OPTIONAL_TOKEN=");
  });

  it("masks a value that contains an equals sign entirely", () => {
    const masked = maskEnvContent("JWT_SECRET=abc=def=ghi");
    expect(masked).toBe("JWT_SECRET=********");
    expect(masked).not.toContain("abc=def");
  });

  it("handles CRLF input without leaking the tail of the line", () => {
    const masked = maskEnvContent("ENCRYPTION_KEY=secret-value\r\nNODE_ENV=production\r\n");
    expect(masked).not.toContain("secret-value");
    expect(masked).toContain("NODE_ENV=production");
  });

  it("does not treat an indented assignment as a comment", () => {
    expect(maskEnvContent("   API_KEY=abcdef")).toBe("   API_KEY=********");
  });
});
