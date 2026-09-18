/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CHARACTERIZATION TESTS — src/plans.ts
 *
 * Entitlement resolution is the only thing standing between a Free tenant and
 * unlimited AI + WhatsApp usage, so its exact behaviour is pinned here before
 * Phase 2 touches tenancy and Phase 9 introduces real plans.
 */

import { describe, it, expect } from "vitest";
import { getEntitlements, PLANS, ADMIN_ENTITLEMENTS } from "../src/plans";

describe("getEntitlements — known plans", () => {
  it("resolves free to a 100-lead cap with no WhatsApp and no AI", () => {
    const ent = getEntitlements("free");
    expect(ent.monthlyLeadLimit).toBe(100);
    expect(ent.whatsappOutreach).toBe(false);
    expect(ent.aiInsights).toBe(false);
  });

  it.each(["pro", "custom"])("resolves %s to unlimited leads with WhatsApp and AI", (plan) => {
    const ent = getEntitlements(plan);
    expect(ent.monthlyLeadLimit).toBe(Infinity);
    expect(ent.whatsappOutreach).toBe(true);
    expect(ent.aiInsights).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(getEntitlements("PRO")).toEqual(PLANS.pro);
    expect(getEntitlements("Free")).toEqual(PLANS.free);
  });

  it("resolves the admin pseudo-plan to full entitlements", () => {
    expect(getEntitlements("admin")).toEqual(ADMIN_ENTITLEMENTS);
  });

  it("falls back to free for an unrecognised plan name", () => {
    expect(getEntitlements("enterprise")).toEqual(PLANS.free);
    expect(getEntitlements("garbage")).toEqual(PLANS.free);
  });
});

describe("getEntitlements — documented security quirk", () => {
  /**
   * A falsy plan resolves to ADMIN_ENTITLEMENTS (unlimited everything), NOT to
   * free. Any user row whose `plan` column is null or an empty string silently
   * receives unlimited leads, WhatsApp outreach and AI.
   *
   * The Prisma schema defaults User.plan to "free", so this is not reachable
   * through normal signup today — but it is one bad migration or one manual
   * UPDATE away from being a billing bypass. Phase 9 must invert this default
   * to fail closed. These assertions document today's behaviour so the change
   * is deliberate and visible in the diff.
   */
  it.each([null, undefined, ""])("treats plan %j as unlimited rather than free", (plan) => {
    const ent = getEntitlements(plan as string | null | undefined);
    expect(ent).toEqual(ADMIN_ENTITLEMENTS);
    expect(ent.monthlyLeadLimit).toBe(Infinity);
    expect(ent.whatsappOutreach).toBe(true);
  });
});
