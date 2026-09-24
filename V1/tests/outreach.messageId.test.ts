/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — SMTP Message-ID as the delivery idempotency handle.
 *
 * SMTP has no idempotency parameter. `Message-ID` is the nearest equivalent: a
 * resend after an unknown outcome that carries the id of the first attempt can be
 * collapsed by receiving servers and mail clients, and is recognisable afterwards
 * in the delivery report. The header must be well formed — an invalid Message-ID
 * is rejected by some servers, which would turn a deliverable message into a hard
 * failure — so a key or sender it cannot build from is declined rather than
 * guessed at.
 */
import { describe, expect, it } from "vitest";
import { buildStableMessageId } from "../src/outreachService";

describe("stable Message-ID construction", () => {
  it("builds an RFC 5322 id from the key and the sender domain", () => {
    expect(buildStableMessageId("a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender@acme.test")).toBe(
      "<campaign-a3f19c7d4b2e8016a3f19c7d4b2e8016@acme.test>"
    );
  });

  it("is deterministic, so a retry produces the same header", () => {
    const first = buildStableMessageId("a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender@acme.test");
    const second = buildStableMessageId("a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender@acme.test");
    expect(first).toBe(second);
  });

  it("distinguishes two different messages", () => {
    const a = buildStableMessageId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sender@acme.test");
    const b = buildStableMessageId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "sender@acme.test");
    expect(a).not.toBe(b);
  });

  it("lowercases the domain so the header is canonical", () => {
    expect(buildStableMessageId("a3f19c7d4b2e8016a3f19c7d4b2e8016", "Sender@ACME.Test")).toContain("@acme.test>");
  });

  it.each([
    ["no key", undefined, "sender@acme.test"],
    ["empty key", "", "sender@acme.test"],
    ["key too short", "abc123", "sender@acme.test"],
    ["key with header-breaking characters", "abc\r\nBcc: attacker@evil.test", "sender@acme.test"],
    ["key with spaces", "a3f19c7d 4b2e8016", "sender@acme.test"],
    ["sender without a domain", "a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender"],
    ["sender with an unqualified domain", "a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender@localhost"],
    ["empty sender", "a3f19c7d4b2e8016a3f19c7d4b2e8016", ""],
  ])("declines to build a header for %s", (_label, key, sender) => {
    expect(buildStableMessageId(key as string | undefined, sender)).toBeNull();
  });

  it("never emits a newline, so the key cannot inject a header", () => {
    const built = buildStableMessageId("a3f19c7d4b2e8016a3f19c7d4b2e8016", "sender@acme.test");
    expect(built).not.toMatch(/[\r\n]/);
  });
});
