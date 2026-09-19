/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — suppression API over real HTTP.
 *
 * Service-level tests prove the queries are scoped; these prove the route in
 * front of them cannot be talked past. They exercise the actual middleware chain
 * (session → workspace → permission), so an anonymous caller, a caller from
 * another workspace and a caller without the permission are all answered by the
 * same code that answers a legitimate request in production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  prisma: new Proxy({}, { get: (_target, property) => (mocks.prisma as any)[property] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const suppressionRoutes = (await import("../src/compliance/suppressionRoutes")).default;
const { env } = await import("../src/env");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api/suppressions", suppressionRoutes);
  return app;
}

function sessionCookie(user: { id: string; email: string; role: string }) {
  return `${env.auth.cookieName}=${issueSessionToken(user)}`;
}

function whereJson(call: any): string {
  return JSON.stringify(call?.[0]?.where ?? {});
}

let app: express.Express;

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  app = buildApp();

  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === TENANT_A.id) return TENANT_A;
    if (where.id === TENANT_B.id) return TENANT_B;
    return null;
  });
  withMemberships(mocks.prisma, [
    membershipRow({ user: TENANT_A, workspace: WORKSPACE_A }),
    membershipRow({ user: TENANT_B, workspace: WORKSPACE_B }),
  ]);
});

describe("authentication and authorization", () => {
  it.each([
    ["get", "/api/suppressions"],
    ["post", "/api/suppressions"],
    ["delete", "/api/suppressions"],
  ])("%s %s rejects an anonymous caller", async (method, path) => {
    const res = await (request(app) as any)[method](path).send({ channel: "email", contact: "x@y.test" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("no_session");
    expect(mocks.prisma.suppressionEntry.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.suppressionEntry.findMany).not.toHaveBeenCalled();
  });

  it("refuses a signed-in account with no workspace", async () => {
    withMemberships(mocks.prisma, []);
    const res = await request(app).get("/api/suppressions").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_tenant");
  });

  it("refuses to record a suppression for a member whose edit permission was removed", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member", permissions: JSON.stringify(["VIEW_LEADS"]) }),
    ]);

    const res = await request(app)
      .post("/api/suppressions")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ channel: "email", contact: "owner@acme.test" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(mocks.prisma.suppressionEntry.upsert).not.toHaveBeenCalled();
  });

  it("still allows that member to read the list", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member", permissions: JSON.stringify(["VIEW_LEADS"]) }),
    ]);
    const res = await request(app).get("/api/suppressions").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(200);
  });
});

describe("request validation", () => {
  it("rejects an unsupported channel", async () => {
    const res = await request(app)
      .post("/api/suppressions")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ channel: "sms", contact: "+15550102030" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_channel");
    expect(mocks.prisma.suppressionEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing contact", async () => {
    const res = await request(app)
      .post("/api/suppressions")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ channel: "email", contact: "   " });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_contact");
  });

  it("rejects a delete without a channel", async () => {
    const res = await request(app)
      .delete("/api/suppressions?contact=owner@acme.test")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(400);
    expect(mocks.prisma.suppressionEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("does not leak internal error detail when the database fails", async () => {
    mocks.prisma.suppressionEntry.findMany.mockRejectedValue(
      new Error("Access denied for user 'root'@'10.0.0.5' (using password: YES)")
    );

    const res = await request(app).get("/api/suppressions").set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("suppression_error");
    expect(JSON.stringify(res.body)).not.toMatch(/password|root@|Access denied/i);
  });
});

describe("tenant scoping", () => {
  it("scopes the list query to the caller's workspace", async () => {
    await request(app).get("/api/suppressions").set("Cookie", sessionCookie(TENANT_A));

    const where = whereJson(mocks.prisma.suppressionEntry.findMany.mock.calls[0]);
    expect(where).toContain(WORKSPACE_A.id);
    expect(where).not.toContain(WORKSPACE_B.id);
  });

  it("stamps the caller's workspace on a new suppression", async () => {
    mocks.prisma.suppressionEntry.upsert.mockResolvedValue({
      id: "sup_1",
      channel: "email",
      contactKey: "owner@acme.test",
      reason: "manual",
      source: "api",
      notes: null,
      createdAt: new Date(),
    });

    const res = await request(app)
      .post("/api/suppressions")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ channel: "email", contact: "Owner@Acme.test" });

    expect(res.status).toBe(201);
    const call = mocks.prisma.suppressionEntry.upsert.mock.calls[0][0];
    expect(call.where.tenantId_channel_contactKey).toEqual({
      tenantId: WORKSPACE_A.id,
      channel: "email",
      contactKey: "owner@acme.test",
    });
    expect(call.create.tenantId).toBe(WORKSPACE_A.id);
  });

  it("answers 404 when clearing a suppression the caller does not own", async () => {
    mocks.prisma.suppressionEntry.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete("/api/suppressions?channel=email&contact=theirs@acme.test")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(whereJson(mocks.prisma.suppressionEntry.deleteMany.mock.calls[0])).toContain(WORKSPACE_A.id);
  });

  it("gives two callers two different scopes for the same contact", async () => {
    await request(app).get("/api/suppressions?search=shared@acme.test").set("Cookie", sessionCookie(TENANT_A));
    const whereA = whereJson(mocks.prisma.suppressionEntry.findMany.mock.calls[0]);
    mocks.prisma.suppressionEntry.findMany.mockClear();

    await request(app).get("/api/suppressions?search=shared@acme.test").set("Cookie", sessionCookie(TENANT_B));
    const whereB = whereJson(mocks.prisma.suppressionEntry.findMany.mock.calls[0]);

    expect(whereA).toContain(WORKSPACE_A.id);
    expect(whereB).toContain(WORKSPACE_B.id);
    expect(whereA).not.toEqual(whereB);
  });

  it("caps an oversized page size rather than reading the whole table", async () => {
    await request(app).get("/api/suppressions?pageSize=100000").set("Cookie", sessionCookie(TENANT_A));

    const call = mocks.prisma.suppressionEntry.findMany.mock.calls[0][0];
    expect(call.take).toBeLessThanOrEqual(200);
  });
});
