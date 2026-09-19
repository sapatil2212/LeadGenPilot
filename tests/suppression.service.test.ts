/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — opt-out / suppression compliance.
 *
 * A suppression is a promise to a person, so the tests assert the three
 * properties that make the promise meaningful: it belongs to one workspace, it
 * applies to one channel, and repeating it does not multiply it. The keyword
 * matcher is tested from both directions, because a matcher that is too eager
 * silently deletes an audience ("please stop by our office next week") and one
 * that is too timid ignores a legal request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeCampaignDb } from "./helpers/fakeCampaignDb";

const mocks = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, property) => mocks.prisma[property as any] }),
}));

const {
  canonicalSuppressionKey,
  isOptOutMessage,
  suppressContact,
  isSuppressed,
  filterSuppressed,
  listSuppressions,
  removeSuppression,
  suppressFromInboundReply,
} = await import("../src/compliance/suppressionService");

const CTX_A: any = {
  tenantId: "tenant-a", userId: "user-a", membershipId: "member-a", role: "owner",
  tenantName: "A", tenantSlug: "a", permissions: new Set<string>(),
};

let db: ReturnType<typeof createFakeCampaignDb>;

beforeEach(() => {
  db = createFakeCampaignDb();
  mocks.prisma = db.prisma;
});

describe("canonical contact keys", () => {
  it("treats differently formatted phone numbers as the same person", () => {
    expect(canonicalSuppressionKey("whatsapp", "+1 (555) 010-2030")).toBe("15550102030");
    expect(canonicalSuppressionKey("whatsapp", "15550102030")).toBe("15550102030");
  });

  it("treats email case as insignificant", () => {
    expect(canonicalSuppressionKey("email", "  Owner@Acme.TEST ")).toBe("owner@acme.test");
  });

  it("returns an empty key for an empty contact so it can be rejected", () => {
    expect(canonicalSuppressionKey("email", "   ")).toBe("");
  });
});

describe("opt-out keyword detection", () => {
  it.each(["STOP", "stop", "Unsubscribe", "please unsubscribe me", "opt out", "opt-out", "Remove me", "do not contact", "take me off"])(
    "recognises %s as an opt-out",
    (text) => expect(isOptOutMessage(text)).toBe(true)
  );

  it.each([
    "Sounds good, can you stop by on Tuesday?",
    "Yes please send more information",
    "who is this",
    "",
    // Long prose that merely mentions the word is a conversation, not a command.
    `Thanks for reaching out. ${"We are reviewing options with the team and will decide soon. ".repeat(3)} unsubscribe`,
  ])("does not treat %s as an opt-out", (text) => expect(isOptOutMessage(text)).toBe(false));
});

describe("recording suppressions", () => {
  it("is idempotent for the same contact", async () => {
    await suppressContact({ tenantId: "tenant-a", channel: "whatsapp", contact: "+15550102030", reason: "opt_out_reply" });
    await suppressContact({ tenantId: "tenant-a", channel: "whatsapp", contact: "1 555 010 2030", reason: "opt_out_reply" });

    expect(db.state.suppressions).toHaveLength(1);
    expect(await isSuppressed("tenant-a", "whatsapp", "+1-555-010-2030")).toBe(true);
  });

  it("rejects a contact that normalises to nothing", async () => {
    await expect(suppressContact({ tenantId: "tenant-a", channel: "email", contact: "  " })).rejects.toThrow(/required/i);
    expect(db.state.suppressions).toHaveLength(0);
  });

  it("rejects an unsupported channel", async () => {
    await expect(suppressContact({ tenantId: "tenant-a", channel: "sms" as any, contact: "x@y.test" })).rejects.toThrow(/email or whatsapp/i);
  });

  it("keeps one workspace's opt-out out of another's", async () => {
    await suppressContact({ tenantId: "tenant-a", channel: "email", contact: "shared@acme.test" });

    expect(await isSuppressed("tenant-a", "email", "shared@acme.test")).toBe(true);
    expect(await isSuppressed("tenant-b", "email", "shared@acme.test")).toBe(false);
  });

  it("keeps an email opt-out off the WhatsApp channel", async () => {
    await suppressContact({ tenantId: "tenant-a", channel: "email", contact: "owner@acme.test" });

    expect(await isSuppressed("tenant-a", "whatsapp", "owner@acme.test")).toBe(false);
  });
});

describe("bulk filtering for campaign generation", () => {
  it("returns the suppressed keys from a large candidate list in one query", async () => {
    await suppressContact({ tenantId: "tenant-a", channel: "email", contact: "no@acme.test" });
    const candidates = ["YES@acme.test", "No@Acme.test", "maybe@acme.test", "no@acme.test"];

    const suppressed = await filterSuppressed("tenant-a", "email", candidates);

    expect(suppressed.has("no@acme.test")).toBe(true);
    expect(suppressed.has("yes@acme.test")).toBe(false);
    expect(suppressed.size).toBe(1);
  });

  it("issues no query for an empty candidate list", async () => {
    const spy = vi.spyOn(db.prisma.suppressionEntry, "findMany");
    expect((await filterSuppressed("tenant-a", "email", [])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("listing and removing", () => {
  beforeEach(async () => {
    await suppressContact({ tenantId: "tenant-a", channel: "email", contact: "one@acme.test" });
    await suppressContact({ tenantId: "tenant-a", channel: "whatsapp", contact: "+15550102030" });
    await suppressContact({ tenantId: "tenant-b", channel: "email", contact: "theirs@acme.test" });
  });

  it("lists only the caller's workspace", async () => {
    const result = await listSuppressions(CTX_A);
    expect(result.total).toBe(2);
    expect(result.records.map((row) => row.contactKey).sort()).toEqual(["15550102030", "one@acme.test"]);
  });

  it("filters by channel", async () => {
    const result = await listSuppressions(CTX_A, { channel: "whatsapp" });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].contactKey).toBe("15550102030");
  });

  it("paginates rather than returning everything", async () => {
    const result = await listSuppressions(CTX_A, { pageSize: 1, page: 2 });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.pageSize).toBe(1);
  });

  it("cannot remove another workspace's suppression", async () => {
    expect(await removeSuppression(CTX_A, "email", "theirs@acme.test")).toBe(false);
    expect(db.state.suppressions).toHaveLength(3);
  });

  it("removes the caller's own suppression", async () => {
    expect(await removeSuppression(CTX_A, "email", "ONE@acme.test")).toBe(true);
    expect(await isSuppressed("tenant-a", "email", "one@acme.test")).toBe(false);
  });
});

describe("inbound replies", () => {
  it("suppresses on an opt-out reply and records where it came from", async () => {
    const record = await suppressFromInboundReply({
      tenantId: "tenant-a",
      channel: "whatsapp",
      contact: "+1 555 010 2030",
      text: "STOP",
    });

    expect(record).toMatchObject({ reason: "opt_out_reply", source: "inbound_whatsapp", contactKey: "15550102030" });
    expect(await isSuppressed("tenant-a", "whatsapp", "15550102030")).toBe(true);
  });

  it("leaves an ordinary reply alone", async () => {
    expect(await suppressFromInboundReply({ tenantId: "tenant-a", channel: "email", contact: "owner@acme.test", text: "Sure, let's talk Friday" })).toBeNull();
    expect(db.state.suppressions).toHaveLength(0);
  });
});
