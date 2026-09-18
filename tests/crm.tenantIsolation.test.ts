/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * REGRESSION TESTS — tenant isolation on /api/crm
 *
 * Guards the highest-severity finding in the audit. Before Phase 1:
 *   - /api/crm was mounted before the middleware that populates req.authUser,
 *     so the router's `req.authUser?.id ?? null` scope was always null;
 *   - the router treated a null scope as "no auth, operate globally";
 *   - GET /api/crm/lists/ALL/export therefore returned EVERY tenant's leads as
 *     CSV to an unauthenticated caller, and PATCH/DELETE on any list or lead id
 *     succeeded without an ownership check.
 *
 * Phase 2 moved the router onto workspace scope: `resolveTenantContext` supplies
 * req.ctx and all data access goes through the repository, which injects the
 * tenant predicate itself. These tests therefore assert two things at once —
 * that cross-workspace access is refused, and that the predicate handed to
 * Prisma actually mentions the caller's workspace.
 *
 * The fixture ids are the real ones from the Phase 0 backup, where 5 lists and
 * 52 leads split cleanly across two users.
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
  LIST_A,
  LIST_B,
  LEAD_B,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));
vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const crmRoutes = (await import("../crmRoutes")).default;
const { env } = await import("../src/env");

/**
 * Mirrors the middleware order in server.ts for the /api/crm mount.
 * The body limit matters: with express.json()'s 100kb default, a large bulk
 * import is rejected by the parser and never reaches the router's own guard,
 * which would make that test pass for the wrong reason.
 */
function buildApp() {
  const app = express();
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api/crm", crmRoutes);
  return app;
}

function sessionCookie(user: { id: string; email: string; role: string }) {
  const token = issueSessionToken(user);
  return `${env.auth.cookieName}=${token}`;
}

/** Serializes a Prisma `where` so assertions can look for an id anywhere in it. */
function whereJson(call: any): string {
  return JSON.stringify(call?.[0]?.where ?? {});
}

let app: express.Express;

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  app = buildApp();

  // attachEntitlements resolves the signed-in user from the session cookie.
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === TENANT_A.id) return TENANT_A;
    if (where.id === TENANT_B.id) return TENANT_B;
    return null;
  });

  // Each user owns exactly one workspace, as the backfill produces.
  withMemberships(mocks.prisma, [
    membershipRow({ user: TENANT_A, workspace: WORKSPACE_A }),
    membershipRow({ user: TENANT_B, workspace: WORKSPACE_B }),
  ]);
});

describe("authentication is mandatory", () => {
  const routes: [string, string][] = [
    ["get", "/api/crm/lists"],
    ["get", "/api/crm/leads"],
    ["post", "/api/crm/lists"],
    ["patch", `/api/crm/lists/${LIST_A.id}`],
    ["delete", `/api/crm/lists/${LIST_A.id}`],
    ["get", `/api/crm/lists/${LIST_A.id}/leads`],
    ["post", `/api/crm/lists/${LIST_A.id}/leads`],
    ["patch", "/api/crm/leads/any_id"],
    ["delete", "/api/crm/leads/any_id"],
    ["get", `/api/crm/lists/${LIST_A.id}/export`],
    ["get", "/api/crm/lists/ALL/export"],
  ];

  it.each(routes)("%s %s rejects an anonymous caller with 401", async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("no_session");
  });

  it("issues no lead query at all when unauthenticated", async () => {
    await request(app).get("/api/crm/lists/ALL/export");
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.leadList.findMany).not.toHaveBeenCalled();
  });

  it("refuses a signed-in account that has no workspace", async () => {
    withMemberships(mocks.prisma, []);
    const res = await request(app).get("/api/crm/lists").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_tenant");
    expect(mocks.prisma.leadList.findMany).not.toHaveBeenCalled();
  });
});

describe("reads are scoped to the caller's workspace", () => {
  it("GET /lists filters by the caller's workspace", async () => {
    const res = await request(app).get("/api/crm/lists").set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    const where = whereJson(mocks.prisma.leadList.findMany.mock.calls[0]);
    expect(where).toContain(WORKSPACE_A.id);
    expect(where).not.toContain(WORKSPACE_B.id);
  });

  it("scopes each caller to a different workspace", async () => {
    await request(app).get("/api/crm/lists").set("Cookie", sessionCookie(TENANT_A));
    const whereA = whereJson(mocks.prisma.leadList.findMany.mock.calls[0]);

    mocks.prisma.leadList.findMany.mockClear();

    await request(app).get("/api/crm/lists").set("Cookie", sessionCookie(TENANT_B));
    const whereB = whereJson(mocks.prisma.leadList.findMany.mock.calls[0]);

    expect(whereA).toContain(WORKSPACE_A.id);
    expect(whereB).toContain(WORKSPACE_B.id);
    expect(whereA).not.toEqual(whereB);
  });

  it("GET /leads restricts the lead query to the workspace's own lists", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([
      { id: LIST_A.id, name: LIST_A.name, _count: { leads: 1 } },
    ]);
    const res = await request(app).get("/api/crm/leads").set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    const where = mocks.prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.listId).toEqual({ in: [LIST_A.id] });
  });

  it("GET /leads returns an empty array without querying leads when there are no lists", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([]);
    const res = await request(app).get("/api/crm/leads").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe("tenant A cannot reach tenant B's data", () => {
  beforeEach(() => {
    // Ownership lookups only ever match a list the caller's workspace owns.
    mocks.prisma.leadList.findFirst.mockImplementation(async ({ where }: any) => {
      const json = JSON.stringify(where);
      return json.includes(LIST_A.id) && json.includes(WORKSPACE_A.id) ? LIST_A : null;
    });
    mocks.prisma.lead.findFirst.mockResolvedValue(null);
  });

  it("PATCH /lists/:id on another workspace's list returns 404 and performs no update", async () => {
    const res = await request(app)
      .patch(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "hijacked" });

    expect(res.status).toBe(404);
    expect(mocks.prisma.leadList.update).not.toHaveBeenCalled();
  });

  it("DELETE /lists/:id on another workspace's list returns 404 and deletes nothing", async () => {
    const res = await request(app)
      .delete(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.leadList.delete).not.toHaveBeenCalled();
  });

  it("GET /lists/:id/leads on another workspace's list returns 404 and reads no leads", async () => {
    const res = await request(app)
      .get(`/api/crm/lists/${LIST_B.id}/leads`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("POST /lists/:id/leads cannot inject leads into another workspace's list", async () => {
    const res = await request(app)
      .post(`/api/crm/lists/${LIST_B.id}/leads`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ leads: [{ businessName: "Injected" }] });

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("PATCH /leads/:id on another workspace's lead returns 404 and performs no update", async () => {
    const res = await request(app)
      .patch(`/api/crm/leads/${LEAD_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "hijacked" });

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });

  it("DELETE /leads/:id on another workspace's lead returns 404 and deletes nothing", async () => {
    const res = await request(app)
      .delete(`/api/crm/leads/${LEAD_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send();

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.delete).not.toHaveBeenCalled();
  });

  it("GET /lists/:id/export on another workspace's list returns 404", async () => {
    const res = await request(app)
      .get(`/api/crm/lists/${LIST_B.id}/export`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("names the caller's workspace in the ownership lookup, never the id alone", async () => {
    await request(app)
      .patch(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "x" });

    const where = whereJson(mocks.prisma.leadList.findFirst.mock.calls[0]);
    expect(where).toContain(LIST_B.id);
    expect(where).toContain(WORKSPACE_A.id);
  });

  it("resolves a lead through its parent list rather than the lead's own columns", async () => {
    await request(app)
      .patch(`/api/crm/leads/${LEAD_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "x" });

    // Ownership must be decided by the list, because a lead's own tenant_id and
    // user_id are nullable and were historically left unset by some writers.
    const where = whereJson(mocks.prisma.lead.findFirst.mock.calls[0]);
    expect(where).toContain("list");
    expect(where).toContain(WORKSPACE_A.id);
  });
});

describe("GET /lists/ALL/export — the full-database dump", () => {
  it("exports only the caller's own lists", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([{ id: LIST_A.id }]);
    mocks.prisma.lead.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/crm/lists/ALL/export")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(whereJson(mocks.prisma.leadList.findMany.mock.calls[0])).toContain(WORKSPACE_A.id);

    // The regression: an unscoped `where: {}` would dump every tenant's leads.
    const where = mocks.prisma.lead.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ listId: { in: [LIST_A.id] } });
    expect(where).not.toEqual({});
  });

  it("returns only headers when the caller owns nothing, without querying leads", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/crm/lists/ALL/export")
      .set("Cookie", sessionCookie(TENANT_B));

    expect(res.status).toBe(200);
    expect(res.text.split("\n")).toHaveLength(1);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe("writes always record an owner", () => {
  it("POST /lists stamps both the workspace and the creating user", async () => {
    mocks.prisma.leadList.create.mockResolvedValue({
      id: "new_list",
      name: "New",
      businessType: "",
      location: "",
      scrapedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/crm/lists")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "New" });

    expect(res.status).toBe(200);
    const data = mocks.prisma.leadList.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    // userId is dual-written for the code paths that still read it.
    expect(data.userId).toBe(TENANT_A.id);
  });

  it("rejects a blank list name", async () => {
    const res = await request(app)
      .post("/api/crm/lists")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(mocks.prisma.leadList.create).not.toHaveBeenCalled();
  });
});

describe("role permissions", () => {
  /** A member may correct a lead but not destroy it, nor export the database. */
  it("refuses a member DELETE /leads/:id", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member" }),
    ]);

    const res = await request(app)
      .delete("/api/crm/leads/some_lead")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(mocks.prisma.lead.findFirst).not.toHaveBeenCalled();
  });

  it("allows a member to edit a lead", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member" }),
    ]);
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a", listId: LIST_A.id });
    mocks.prisma.lead.update.mockResolvedValue({ id: "lead_a", listId: LIST_A.id, businessName: "x" });

    const res = await request(app)
      .patch("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "a note" });

    expect(res.status).toBe(200);
  });

  /**
   * Creating and renaming a list is ordinary organising work, so a member may
   * do it. Deleting one cascades to every lead inside, so it needs DELETE_LEADS.
   */
  it("lets a member create a list but not delete one", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "member" }),
    ]);
    mocks.prisma.leadList.create.mockResolvedValue({
      id: "new_list",
      name: "New",
      businessType: "",
      location: "",
      scrapedAt: new Date(),
    });

    const create = await request(app)
      .post("/api/crm/lists")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "New" });
    expect(create.status).toBe(200);

    const remove = await request(app)
      .delete(`/api/crm/lists/${LIST_A.id}`)
      .set("Cookie", sessionCookie(TENANT_A));
    expect(remove.status).toBe(403);
    expect(remove.body.code).toBe("permission_denied");
    expect(mocks.prisma.leadList.delete).not.toHaveBeenCalled();
  });

  it("honours a permission override that restores an owner's missing capability", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({
        user: TENANT_A,
        workspace: WORKSPACE_A,
        role: "member",
        permissions: JSON.stringify(["VIEW_LEADS", "DELETE_LEADS"]),
      }),
    ]);
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a", listId: LIST_A.id });

    const res = await request(app)
      .delete("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(mocks.prisma.lead.delete).toHaveBeenCalled();
  });

  it("refuses an owner-stripped export", async () => {
    withMemberships(mocks.prisma, [
      membershipRow({
        user: TENANT_A,
        workspace: WORKSPACE_A,
        role: "owner",
        permissions: JSON.stringify(["VIEW_LEADS"]),
      }),
    ]);

    const res = await request(app)
      .get("/api/crm/lists/ALL/export")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(403);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe("input limits", () => {
  beforeEach(() => {
    mocks.prisma.leadList.findFirst.mockResolvedValue(LIST_A);
  });

  it("rejects an oversized bulk import instead of issuing 2N queries", async () => {
    const leads = Array.from({ length: 5001 }, (_, i) => ({ businessName: `Lead ${i}` }));

    const res = await request(app)
      .post(`/api/crm/lists/${LIST_A.id}/leads`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ leads });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("batch_too_large");
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("caps unbounded note text rather than storing it whole", async () => {
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a", listId: LIST_A.id });
    mocks.prisma.lead.update.mockResolvedValue({ id: "lead_a", listId: LIST_A.id, businessName: "x" });

    await request(app)
      .patch("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "z".repeat(50_000) });

    const data = mocks.prisma.lead.update.mock.calls[0][0].data;
    expect(data.notes.length).toBe(10_000);
  });

  it("rejects an unknown outreach status", async () => {
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a", listId: LIST_A.id });

    const res = await request(app)
      .patch("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ emailStatus: "DEFINITELY_NOT_A_STATUS" });

    expect(res.status).toBe(400);
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });
});
