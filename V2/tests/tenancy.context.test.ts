/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TESTS — src/tenancy/context.ts
 *
 * The context guard decides which workspace a request acts on. Every branch is
 * covered, because a wrong answer here is a cross-tenant write.
 *
 * The critical property: an explicit tenant id is a PREFERENCE, never a grant.
 * Naming another workspace only works if the caller has an active membership in
 * it, so an attacker who learns a tenant id gains nothing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  createPrismaMock,
  membershipRow,
  withMemberships,
  type PrismaMock,
  TENANT_A,
  TENANT_B,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const { resolveTenantContext, requirePermission, TENANT_HEADER } = await import("../src/tenancy/context");
const { env } = await import("../src/env");

/** App that echoes the resolved context, so assertions can inspect it. */
function buildApp(extra?: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api", resolveTenantContext);
  if (extra) app.use("/api", extra);
  app.get("/api/probe", (req, res) =>
    res.json({
      userId: req.ctx!.userId,
      tenantId: req.ctx!.tenantId,
      role: req.ctx!.role,
      tenantName: req.ctx!.tenantName,
      permissions: Array.from(req.ctx!.permissions).sort(),
    })
  );
  return app;
}

function cookieFor(user: { id: string; email: string; role: string }) {
  return `${env.auth.cookieName}=${issueSessionToken(user)}`;
}

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === TENANT_A.id) return TENANT_A;
    if (where.id === TENANT_B.id) return TENANT_B;
    return null;
  });
});

describe("authentication", () => {
  it("refuses an anonymous request", async () => {
    const res = await request(buildApp()).get("/api/probe");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("no_session");
  });
});

describe("implicit resolution", () => {
  it("uses the caller's single workspace, so existing clients need no changes", async () => {
    withMemberships(mocks.prisma, [membershipRow({ user: TENANT_A, workspace: WORKSPACE_A })]);

    const res = await request(buildApp()).get("/api/probe").set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(WORKSPACE_A.id);
    expect(res.body.userId).toBe(TENANT_A.id);
    expect(res.body.role).toBe("owner");
    expect(res.body.tenantName).toBe(WORKSPACE_A.name);
  });

  it("resolves each caller to their own workspace", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A }),
      membershipRow({ user: TENANT_B, workspace: WORKSPACE_B }),
    ]);

    const app = buildApp();
    const a = await request(app).get("/api/probe").set("Cookie", cookieFor(TENANT_A));
    const b = await request(app).get("/api/probe").set("Cookie", cookieFor(TENANT_B));

    expect(a.body.tenantId).toBe(WORKSPACE_A.id);
    expect(b.body.tenantId).toBe(WORKSPACE_B.id);
    expect(a.body.tenantId).not.toBe(b.body.tenantId);
  });
});

describe("explicit resolution", () => {
  it("honours the header for a workspace the caller belongs to", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A }),
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_B, role: "member" }),
    ]);

    const res = await request(buildApp())
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A))
      .set(TENANT_HEADER, WORKSPACE_B.id);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(WORKSPACE_B.id);
    expect(res.body.role).toBe("member");
  });

  /** The security-critical branch: naming a workspace is not joining it. */
  it("refuses a workspace the caller does not belong to", async () => {
    withMemberships(mocks.prisma, [membershipRow({ user: TENANT_A, workspace: WORKSPACE_A })]);

    const res = await request(buildApp())
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A))
      .set(TENANT_HEADER, WORKSPACE_B.id);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_forbidden");
  });

  it("also accepts the id as a query parameter", async () => {
    withMemberships(mocks.prisma, [membershipRow({ user: TENANT_A, workspace: WORKSPACE_A })]);

    const res = await request(buildApp())
      .get(`/api/probe?tenantId=${WORKSPACE_A.id}`)
      .set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(WORKSPACE_A.id);
  });

  it("refuses a suspended workspace even for a member", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: { ...WORKSPACE_A, status: "suspended" } }),
    ]);

    const res = await request(buildApp())
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A))
      .set(TENANT_HEADER, WORKSPACE_A.id);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_suspended");
  });
});

describe("ambiguous and missing membership", () => {
  /**
   * Guessing would mean writing a lead into whichever workspace happened to
   * sort first, so the request is refused with the options listed.
   */
  it("asks the client to choose when several workspaces are available", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A }),
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_B, role: "member" }),
    ]);

    const res = await request(buildApp()).get("/api/probe").set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("tenant_required");
    expect(res.body.tenants.map((t: any) => t.id).sort()).toEqual(
      [WORKSPACE_A.id, WORKSPACE_B.id].sort()
    );
  });

  it("refuses an account with no workspace", async () => {
    withMemberships(mocks.prisma, []);

    const res = await request(buildApp()).get("/api/probe").set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_tenant");
  });

  it("ignores a suspended membership when resolving implicitly", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, status: "suspended" }),
    ]);

    const res = await request(buildApp()).get("/api/probe").set("Cookie", cookieFor(TENANT_A));
    expect(res.status).toBe(403);
  });
});

describe("requirePermission", () => {
  it("allows an owner through", async () => {
    withMemberships(mocks.prisma, [membershipRow({ user: TENANT_A, workspace: WORKSPACE_A })]);

    const res = await request(buildApp(requirePermission("DELETE_LEADS")))
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(200);
  });

  it("refuses a member a permission their role withholds", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member" }),
    ]);

    const res = await request(buildApp(requirePermission("DELETE_LEADS")))
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(res.body.permission).toBe("DELETE_LEADS");
    expect(res.body.role).toBe("member");
  });

  it("honours a per-member override", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({
        user: TENANT_A,
        workspace: WORKSPACE_A,
        role: "member",
        permissions: JSON.stringify(["VIEW_LEADS", "DELETE_LEADS"]),
      }),
    ]);

    const res = await request(buildApp(requirePermission("DELETE_LEADS")))
      .get("/api/probe")
      .set("Cookie", cookieFor(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(["DELETE_LEADS", "VIEW_LEADS"]);
  });

  /**
   * Mounted without a context this is a wiring bug, and a guard that fails open
   * on a wiring bug is worse than no guard.
   */
  it("fails closed when mounted without resolveTenantContext", async () => {
    const app = express();
    app.use(cookieParser());
    app.get("/api/probe", requirePermission("VIEW_LEADS"), (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/api/probe");
    expect(res.status).toBe(500);
  });
});
