/**
 * Multi-SMTP sender tests.
 *
 * These lock the config-key contract that spans three layers and was previously
 * unguarded by any test:
 *
 *   SMTP form  ->  POST/PUT /senders/email  ->  stored config
 *   stored config  ->  resolvedSmtpFromConfig  ->  nodemailer
 *
 * The contract is easy to break silently because the key names change on the
 * way out (`password` becomes `pass`, `fromName`/`fromEmail` collapse into
 * `from`). A mismatch does not surface as a validation error at send time — the
 * executor just reports "Email is not configured for this workspace" for every
 * message routed to that slot, permanently. Hence the explicit coverage.
 */

import { describe, it, expect } from "vitest";
import { normalizeEmailSenderConfig, toSmtpTransportConfig } from "../src/integrationRoutes";
import { slotForSenderType, senderTypeForSlot, MAX_SENDERS } from "../src/campaign/senderRotationService";

/**
 * Local mirror of campaignExecutor's private resolvedSmtpFromConfig. Kept
 * byte-faithful to that implementation so these tests fail if the executor's
 * expectations and the route's output ever drift apart.
 */
function resolvedSmtpFromConfig(config: Record<string, unknown>) {
  const port = Number(config.port);
  if (!config.host || !config.user || !config.password) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    host: String(config.host),
    port,
    secure: Boolean(config.secure),
    user: String(config.user),
    pass: String(config.password),
    from: String(config.fromName || config.fromEmail || config.user),
  };
}

/** A realistic body as the multi-SMTP dialog sends it. */
function formBody(overrides: Record<string, unknown> = {}) {
  return {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    user: "sales@example.com",
    password: "app-password-1234",
    fromEmail: "sales@example.com",
    fromName: "Sales Team",
    ...overrides,
  };
}

describe("normalizeEmailSenderConfig", () => {
  it("accepts a complete payload and coerces port and secure", () => {
    const result = normalizeEmailSenderConfig(formBody({ port: "465", secure: "yes" }));
    expect(result.error).toBeUndefined();
    expect(result.config).toMatchObject({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "sales@example.com",
      password: "app-password-1234",
      fromEmail: "sales@example.com",
      fromName: "Sales Team",
    });
    // Port must be a real number, not the string the form field produces.
    expect(typeof result.config!.port).toBe("number");
  });

  it("trims surrounding whitespace on text fields", () => {
    const result = normalizeEmailSenderConfig(formBody({ host: "  smtp.gmail.com  ", user: " me@x.com " }));
    expect(result.config).toMatchObject({ host: "smtp.gmail.com", user: "me@x.com" });
  });

  it.each([
    ["host", { host: "" }, "SMTP host is required."],
    ["user", { user: "" }, "SMTP username is required."],
    ["password", { password: "" }, "SMTP password is required."],
    ["fromEmail", { fromEmail: "" }, "From email is required."],
  ])("rejects a missing %s", (_field, override, expected) => {
    const result = normalizeEmailSenderConfig(formBody(override));
    expect(result.config).toBeNull();
    expect(result.error).toBe(expected);
  });

  it("rejects a malformed from address", () => {
    const result = normalizeEmailSenderConfig(formBody({ fromEmail: "not-an-email" }));
    expect(result.config).toBeNull();
    expect(result.error).toBe("From email is not a valid address.");
  });

  it.each([
    ["empty", ""],
    ["non-numeric", "abc"],
    ["zero", 0],
    ["negative", -1],
    ["above the valid range", 70000],
    ["fractional", 587.5],
  ])("rejects a %s port", (_label, port) => {
    const result = normalizeEmailSenderConfig(formBody({ port }));
    expect(result.config).toBeNull();
    expect(result.error).toBe("Port must be a whole number between 1 and 65535.");
  });

  it("rejects an empty port rather than storing it as 0", () => {
    // This is the specific regression that made a slot fail permanently: an
    // empty port used to be stored verbatim, and Number("") is 0, which
    // resolvedSmtpFromConfig rejects at send time with a misleading message.
    const result = normalizeEmailSenderConfig(formBody({ port: "" }));
    expect(result.config).toBeNull();
  });

  it("tolerates a completely absent body", () => {
    expect(normalizeEmailSenderConfig(undefined).config).toBeNull();
    expect(normalizeEmailSenderConfig(null).config).toBeNull();
  });
});

describe("stored config is consumable by the campaign executor", () => {
  it("produces a config resolvedSmtpFromConfig accepts", () => {
    const normalized = normalizeEmailSenderConfig(formBody());
    expect(normalized.config).not.toBeNull();

    const resolved = resolvedSmtpFromConfig(normalized.config!);
    expect(resolved).not.toBeNull();
    expect(resolved).toEqual({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "sales@example.com",
      // The rename the executor performs: `password` -> `pass`.
      pass: "app-password-1234",
      // fromName wins over fromEmail, which in turn wins over user.
      from: "Sales Team",
    });
  });

  it("every value the route stores round-trips through the executor for all 5 slots", () => {
    for (let slot = 1; slot <= MAX_SENDERS; slot++) {
      const type = senderTypeForSlot("email", slot);
      expect(slotForSenderType(type)).toBe(slot);

      const normalized = normalizeEmailSenderConfig(
        formBody({ user: `slot${slot}@example.com`, fromName: `Sender ${slot}` })
      );
      const resolved = resolvedSmtpFromConfig(normalized.config!);
      expect(resolved).not.toBeNull();
      expect(resolved!.user).toBe(`slot${slot}@example.com`);
      expect(resolved!.from).toBe(`Sender ${slot}`);
    }
  });

  it("falls back to fromEmail then user for the From display name", () => {
    const noName = resolvedSmtpFromConfig(
      normalizeEmailSenderConfig(formBody({ fromName: "" })).config!
    );
    expect(noName!.from).toBe("sales@example.com");

    // fromEmail is required by the route, so the user-only fallback is only
    // reachable for configs written by other paths. Verified directly.
    const bare = resolvedSmtpFromConfig({
      host: "h", port: 25, user: "u@x.com", password: "p",
    });
    expect(bare!.from).toBe("u@x.com");
  });

  it("never emits the legacy key names the executor does not read", () => {
    const config = normalizeEmailSenderConfig(formBody()).config!;
    // `pass` and `from` are executor-side names. Storing them instead of
    // `password`/`fromName` would make the sender silently unusable.
    expect(config).not.toHaveProperty("pass");
    expect(config).not.toHaveProperty("from");
    expect(config).toHaveProperty("password");
  });

  it("drops unknown keys so a stray field cannot overwrite a credential", () => {
    const config = normalizeEmailSenderConfig(
      formBody({ pass: "injected", from: "injected", enabled: false }) as any
    ).config!;
    expect(Object.keys(config).sort()).toEqual(
      ["fromEmail", "fromName", "host", "password", "port", "secure", "user"].sort()
    );
  });
});

describe("toSmtpTransportConfig (test-email send path)", () => {
  it("matches resolvedSmtpFromConfig exactly, so a passing test proves campaigns work", () => {
    // The whole value of the "Send Test Email" button rests on it using the
    // same transport shape a campaign send uses. If these two ever diverge, a
    // green test would stop being evidence of anything.
    const stored = normalizeEmailSenderConfig(formBody()).config!;
    expect(toSmtpTransportConfig(stored)).toEqual(resolvedSmtpFromConfig(stored));
  });

  it("performs the password -> pass rename the mail layer requires", () => {
    const stored = normalizeEmailSenderConfig(formBody()).config!;
    const transport = toSmtpTransportConfig(stored);
    expect(transport.pass).toBe("app-password-1234");
    expect(transport).not.toHaveProperty("password");
  });

  it("collapses fromName/fromEmail into a single from display name", () => {
    const withName = toSmtpTransportConfig(normalizeEmailSenderConfig(formBody()).config!);
    expect(withName.from).toBe("Sales Team");

    const withoutName = toSmtpTransportConfig(
      normalizeEmailSenderConfig(formBody({ fromName: "" })).config!
    );
    expect(withoutName.from).toBe("sales@example.com");
  });

  it("keeps port numeric and secure boolean after coercion", () => {
    const stored = normalizeEmailSenderConfig(formBody({ port: "465", secure: "on" })).config!;
    const transport = toSmtpTransportConfig(stored);
    expect(transport.port).toBe(465);
    expect(transport.secure).toBe(true);
  });

  it("agrees with the executor mapping for every slot", () => {
    for (let slot = 1; slot <= MAX_SENDERS; slot++) {
      const stored = normalizeEmailSenderConfig(
        formBody({ user: `slot${slot}@example.com`, fromName: `Sender ${slot}` })
      ).config!;
      expect(toSmtpTransportConfig(stored)).toEqual(resolvedSmtpFromConfig(stored));
    }
  });
});
