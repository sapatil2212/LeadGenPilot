/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TESTS — src/tenancy/permissions.ts
 *
 * Role definitions are the contract the whole authorization layer rests on, so
 * the deliberate restrictions are asserted explicitly rather than left implied
 * by the data structure.
 */

import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  resolvePermissions,
  serializePermissions,
  hasPermission,
  isPermission,
  isTenantRole,
  type Permission,
} from "../src/tenancy/permissions";

describe("role defaults", () => {
  it("gives an owner every permission", () => {
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(PERMISSIONS));
  });

  it("gives an admin everything except billing", () => {
    const admin = new Set(ROLE_PERMISSIONS.admin);
    expect(admin.has("MANAGE_BILLING")).toBe(false);
    expect(admin.has("MANAGE_TEAM")).toBe(true);
    expect(admin.has("SEND_CAMPAIGN")).toBe(true);
    expect(admin.size).toBe(PERMISSIONS.length - 1);
  });

  /**
   * The two restrictions that carry product meaning. A member prepares work; an
   * admin or owner commits the irreversible or metered part of it.
   */
  it("lets a member create a campaign but not send it", () => {
    const member = new Set(ROLE_PERMISSIONS.member);
    expect(member.has("CREATE_CAMPAIGN")).toBe(true);
    expect(member.has("SEND_CAMPAIGN")).toBe(false);
  });

  it("does not let a member spend the workspace's lead quota", () => {
    expect(new Set(ROLE_PERMISSIONS.member).has("RUN_LEAD_DISCOVERY")).toBe(false);
  });

  it("lets a member edit but not delete leads", () => {
    const member = new Set(ROLE_PERMISSIONS.member);
    expect(member.has("EDIT_LEADS")).toBe(true);
    expect(member.has("DELETE_LEADS")).toBe(false);
  });

  it("keeps workspace administration away from a member", () => {
    const member = new Set(ROLE_PERMISSIONS.member);
    for (const p of ["MANAGE_TEAM", "MANAGE_BILLING", "MANAGE_INTEGRATIONS", "MANAGE_BUSINESS_PROFILE"] as Permission[]) {
      expect(member.has(p)).toBe(false);
    }
  });
});

describe("resolvePermissions", () => {
  it("returns the role defaults when there is no override", () => {
    expect(resolvePermissions("member")).toEqual(new Set(ROLE_PERMISSIONS.member));
    expect(resolvePermissions("owner", null)).toEqual(new Set(ROLE_PERMISSIONS.owner));
  });

  it("treats an unrecognised role as the least-privileged one", () => {
    expect(resolvePermissions("superuser")).toEqual(new Set(ROLE_PERMISSIONS.member));
    expect(resolvePermissions("")).toEqual(new Set(ROLE_PERMISSIONS.member));
  });

  it("lets an override replace the role defaults entirely", () => {
    const granted = resolvePermissions("owner", JSON.stringify(["VIEW_LEADS"]));
    expect(granted).toEqual(new Set(["VIEW_LEADS"]));
    expect(granted.has("SEND_CAMPAIGN")).toBe(false);
  });

  it("can grant a member something their role normally withholds", () => {
    const granted = resolvePermissions("member", JSON.stringify(["VIEW_LEADS", "SEND_CAMPAIGN"]));
    expect(granted.has("SEND_CAMPAIGN")).toBe(true);
  });

  it("drops unknown permission strings instead of trusting them", () => {
    const granted = resolvePermissions("member", JSON.stringify(["VIEW_LEADS", "BECOME_ROOT"]));
    expect(granted).toEqual(new Set(["VIEW_LEADS"]));
  });

  /**
   * A corrupt column must not silently strip access (locking someone out) and
   * must certainly not widen it. Falling back to the role is the safe answer.
   */
  it.each(["not json at all", "{}", '"a string"', "42", "null"])(
    "falls back to role defaults for malformed override %j",
    (override) => {
      expect(resolvePermissions("member", override)).toEqual(new Set(ROLE_PERMISSIONS.member));
    }
  );

  it("yields no permissions for an explicitly empty override", () => {
    expect(resolvePermissions("owner", JSON.stringify([]))).toEqual(new Set());
  });
});

describe("serializePermissions", () => {
  it("returns null for null, meaning 'use role defaults'", () => {
    expect(serializePermissions(null)).toBeNull();
    expect(serializePermissions(undefined)).toBeNull();
  });

  it("de-duplicates and drops unknown entries", () => {
    const json = serializePermissions(["VIEW_LEADS", "VIEW_LEADS", "NOPE" as Permission]);
    expect(JSON.parse(json!)).toEqual(["VIEW_LEADS"]);
  });

  it("round-trips through resolvePermissions", () => {
    const json = serializePermissions(["VIEW_LEADS", "EXPORT_LEADS"]);
    expect(resolvePermissions("member", json)).toEqual(new Set(["VIEW_LEADS", "EXPORT_LEADS"]));
  });
});

describe("type guards", () => {
  it("recognises valid permissions and roles only", () => {
    expect(isPermission("VIEW_LEADS")).toBe(true);
    expect(isPermission("view_leads")).toBe(false);
    expect(isPermission(123)).toBe(false);
    expect(isTenantRole("owner")).toBe(true);
    expect(isTenantRole("root")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("answers against a resolved set", () => {
    const granted = resolvePermissions("member");
    expect(hasPermission(granted, "VIEW_LEADS")).toBe(true);
    expect(hasPermission(granted, "DELETE_LEADS")).toBe(false);
  });
});
