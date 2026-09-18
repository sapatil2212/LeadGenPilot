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
 * The fixture ids are the real ones from the Phase 0 backup, where 5 lists and
 * 52 leads split cleanly across two users — so these tests describe the exact
 * data that was exposed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  TENANT_B,
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

  it("issues no database query at all when unauthenticated", async () => {
    await request(app).get("/api/crm/lists/ALL/export");
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.leadList.findMany).not.toHaveBeenCalled();
  });
});

describe("reads are scoped to the signed-in owner", () => {
  it("GET /lists filters by the caller's userId", async () => {
    const res = await request(app).get("/api/crm/lists").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(200);
    expect(mocks.prisma.leadList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TENANT_A.id } })
    );
  });

  it("GET /leads restricts the lead query to the caller's own lists", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([{ id: LIST_A.id, name: LIST_A.name }]);
    const res = await request(app).get("/api/crm/leads").set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(mocks.prisma.leadList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TENANT_A.id } })
    );
    const where = mocks.prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.listId).toEqual({ in: [LIST_A.id] });
  });

  it("GET /leads returns an empty array without querying leads when the caller owns no lists", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([]);
    const res = await request(app).get("/api/crm/leads").set("Cookie", sessionCookie(TENANT_A));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe("tenant A cannot reach tenant B's data", () => {
  beforeEach(() => {
    // Ownership lookups only ever match a list/lead the caller owns.
    mocks.prisma.leadList.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === LIST_A.id && where.userId === TENANT_A.id ? LIST_A : null
    );
    mocks.prisma.lead.findFirst.mockResolvedValue(null);
  });

  it("PATCH /lists/:id on another tenant's list returns 404 and performs no update", async () => {
    const res = await request(app)
      .patch(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "hijacked" });

    expect(res.status).toBe(404);
    expect(mocks.prisma.leadList.update).not.toHaveBeenCalled();
  });

  it("DELETE /lists/:id on another tenant's list returns 404 and deletes nothing", async () => {
    const res = await request(app)
      .delete(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.leadList.delete).not.toHaveBeenCalled();
  });

  it("GET /lists/:id/leads on another tenant's list returns 404 and reads no leads", async () => {
    const res = await request(app)
      .get(`/api/crm/lists/${LIST_B.id}/leads`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("POST /lists/:id/leads cannot inject leads into another tenant's list", async () => {
    const res = await request(app)
      .post(`/api/crm/lists/${LIST_B.id}/leads`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ leads: [{ businessName: "Injected" }] });

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("PATCH /leads/:id on another tenant's lead returns 404 and performs no update", async () => {
    const res = await request(app)
      .patch(`/api/crm/leads/${LEAD_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "hijacked" });

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });

  it("DELETE /leads/:id on another tenant's lead returns 404 and deletes nothing", async () => {
    const res = await request(app)
      .delete(`/api/crm/leads/${LEAD_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send();

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.delete).not.toHaveBeenCalled();
  });

  it("GET /lists/:id/export on another tenant's list returns 404", async () => {
    const res = await request(app)
      .get(`/api/crm/lists/${LIST_B.id}/export`)
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("scopes ownership lookups by BOTH id and userId, never id alone", async () => {
    await request(app)
      .patch(`/api/crm/lists/${LIST_B.id}`)
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ name: "x" });

    expect(mocks.prisma.leadList.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LIST_B.id, userId: TENANT_A.id } })
    );
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
    expect(mocks.prisma.leadList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TENANT_A.id } })
    );

    // The regression: an unscoped `where: {}` would dump every tenant's leads.
    const where = mocks.prisma.lead.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ listId: { in: [LIST_A.id] } });
    expect(where).not.toEqual({});
  });

  it("returns only headers when the caller owns nothing", async () => {
    mocks.prisma.leadList.findMany.mockResolvedValue([]);
    mocks.prisma.lead.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/crm/lists/ALL/export")
      .set("Cookie", sessionCookie(TENANT_B));

    expect(res.status).toBe(200);
    expect(res.text.split("\n")).toHaveLength(1);
    expect(mocks.prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { listId: { in: [] } } })
    );
  });
});

describe("writes always record an owner", () => {
  it("POST /lists stamps the creating user, never null", async () => {
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
    expect(data.userId).toBe(TENANT_A.id);
    expect(data.userId).not.toBeNull();
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

describe("input limits", () => {
  it("rejects an oversized bulk import instead of issuing 2N queries", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue(LIST_A);
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
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a" });
    mocks.prisma.lead.update.mockResolvedValue({ id: "lead_a", listId: LIST_A.id, businessName: "x" });

    await request(app)
      .patch("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ notes: "z".repeat(50_000) });

    const data = mocks.prisma.lead.update.mock.calls[0][0].data;
    expect(data.notes.length).toBe(10_000);
  });

  it("rejects an unknown outreach status", async () => {
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead_a" });

    const res = await request(app)
      .patch("/api/crm/leads/lead_a")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({ emailStatus: "DEFINITELY_NOT_A_STATUS" });

    expect(res.status).toBe(400);
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });
});
