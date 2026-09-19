/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authorization and isolation for /api/business, /api/knowledge and
 * /api/assistant.
 *
 * These three routers are the Phase 3 attack surface, and the risk is the one
 * Phase 1 had to fix by hand on /api/crm: a router that reads its scope from
 * something that may be absent. Every route here is asserted to require a
 * session, to refuse a workspace the caller is not a member of, and to demand
 * the right capability.
 *
 * The permission split under test:
 *   - reads need VIEW_ANALYTICS, which every role has;
 *   - writes need MANAGE_BUSINESS_PROFILE, which `member` does NOT have.
 *
 * That is not arbitrary. These fields and documents become the factual basis of
 * every AI-generated message sent in the company's name, so editing them is
 * closer to editing brand collateral than to editing a CRM record.
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

const mocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaMock,
  generateText: vi.fn(),
  generateStructuredOutput: vi.fn(),
  embedTexts: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/ai/aiService", () => ({
  generateText: (...args: unknown[]) => mocks.generateText(...args),
  generateStructuredOutput: (...args: unknown[]) => mocks.generateStructuredOutput(...args),
  embedTexts: (...args: unknown[]) => mocks.embedTexts(...args),
  isAnyProviderConfigured: () => mocks.isAnyProviderConfigured(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const { env } = await import("../src/env");
const { TENANT_HEADER } = await import("../src/tenancy/context");
const businessRoutes = (await import("../src/business/businessRoutes")).default;
const knowledgeRoutes = (await import("../src/knowledge/knowledgeRoutes")).default;
const assistantRoutes = (await import("../src/assistant/assistantRoutes")).default;

/** Mirrors the middleware order server.ts uses for these mounts. */
function buildApp() {
  const app = express();
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api/business", businessRoutes);
  app.use("/api/knowledge", knowledgeRoutes);
  app.use("/api/assistant", assistantRoutes);
  return app;
}

function sessionCookie(user: { id: string; email: string; role: string }) {
  return `${env.auth.cookieName}=${issueSessionToken(user)}`;
}

let app: express.Express;

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  app = buildApp();

  mocks.generateText.mockReset();
  mocks.generateStructuredOutput.mockReset();
  mocks.embedTexts.mockReset();
  mocks.isAnyProviderConfigured.mockReset();
  mocks.isAnyProviderConfigured.mockReturnValue(true);

  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === TENANT_A.id) return TENANT_A;
    if (where.id === TENANT_B.id) return TENANT_B;
    return null;
  });

  // A owns workspace A. B is a plain member of workspace B.
  withMemberships(mocks.prisma, [
    membershipRow({ user: TENANT_A, workspace: WORKSPACE_A, role: "owner" }),
    membershipRow({ user: TENANT_B, workspace: WORKSPACE_B, role: "member" }),
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("authentication is mandatory", () => {
  const routes: [string, string][] = [
    ["get", "/api/business/profile"],
    ["put", "/api/business/profile"],
    ["get", "/api/business/products"],
    ["post", "/api/business/products"],
    ["patch", "/api/business/products/p1"],
    ["delete", "/api/business/products/p1"],
    ["get", "/api/business/services"],
    ["post", "/api/business/services"],
    ["post", "/api/business/extract"],
    ["get", "/api/business/context"],
    ["get", "/api/knowledge/documents"],
    ["post", "/api/knowledge/documents"],
    ["get", "/api/knowledge/documents/d1"],
    ["delete", "/api/knowledge/documents/d1"],
    ["post", "/api/knowledge/documents/d1/reprocess"],
    ["post", "/api/knowledge/search"],
    ["get", "/api/knowledge/stats"],
    ["get", "/api/knowledge/items"],
    ["post", "/api/knowledge/items"],
    ["delete", "/api/knowledge/items/i1"],
    ["get", "/api/assistant/status"],
    ["get", "/api/assistant/conversations"],
    ["post", "/api/assistant/conversations"],
    ["get", "/api/assistant/conversations/c1"],
    ["delete", "/api/assistant/conversations/c1"],
    ["post", "/api/assistant/ask"],
  ];

  it.each(routes)("%s %s refuses an anonymous caller", async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("no_session");
  });

  it("never reaches the data layer without a session", async () => {
    await request(app).get("/api/business/profile");
    expect(mocks.prisma.businessProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe("cross-workspace access", () => {
  it("refuses an X-Tenant-Id the caller is not a member of", async () => {
    const res = await request(app)
      .get("/api/business/profile")
      .set("Cookie", sessionCookie(TENANT_A))
      .set(TENANT_HEADER, WORKSPACE_B.id);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_forbidden");
    expect(mocks.prisma.businessProfile.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a ?tenantId= query parameter just the same", async () => {
    const res = await request(app)
      .get("/api/knowledge/documents")
      .set("Cookie", sessionCookie(TENANT_A))
      .query({ tenantId: WORKSPACE_B.id });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_forbidden");
  });

  it("scopes a read to the caller's own workspace", async () => {
    const res = await request(app)
      .get("/api/business/profile")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(mocks.prisma.businessProfile.findUnique).toHaveBeenCalledWith({
      where: { tenantId: WORKSPACE_A.id },
    });
  });

  it("scopes a document listing to the caller's own workspace", async () => {
    const res = await request(app)
      .get("/api/knowledge/documents")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    const where = mocks.prisma.knowledgeDocument.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("a member can read but not change the business record", () => {
  const cookie = () => sessionCookie(TENANT_B);

  const writes: [string, string, Record<string, unknown>][] = [
    ["put", "/api/business/profile", { businessName: "Renamed" }],
    ["post", "/api/business/products", { name: "Smuggled" }],
    ["patch", "/api/business/products/p1", { name: "Renamed" }],
    ["delete", "/api/business/products/p1", {}],
    ["post", "/api/business/services", { name: "Smuggled" }],
    ["patch", "/api/business/services/s1", { name: "Renamed" }],
    ["delete", "/api/business/services/s1", {}],
    ["post", "/api/business/extract", { text: "x".repeat(200) }],
    ["post", "/api/knowledge/items", { label: "L", value: "V" }],
    ["delete", "/api/knowledge/items/i1", {}],
    ["delete", "/api/knowledge/documents/d1", {}],
    ["post", "/api/knowledge/documents/d1/reprocess", {}],
    ["delete", "/api/assistant/conversations/c1", {}],
  ];

  it.each(writes)("%s %s is refused", async (method, path, body) => {
    const res = await (request(app) as any)[method](path).set("Cookie", cookie()).send(body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(res.body.permission).toBe("MANAGE_BUSINESS_PROFILE");
  });

  it("refuses a document upload", async () => {
    const res = await request(app)
      .post("/api/knowledge/documents")
      .set("Cookie", cookie())
      .attach("file", Buffer.from("some text"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(403);
    expect(res.body.permission).toBe("MANAGE_BUSINESS_PROFILE");
    expect(mocks.prisma.knowledgeDocument.create).not.toHaveBeenCalled();
  });

  const reads: [string, string][] = [
    ["get", "/api/business/profile"],
    ["get", "/api/business/products"],
    ["get", "/api/business/services"],
    ["get", "/api/business/context"],
    ["get", "/api/knowledge/documents"],
    ["get", "/api/knowledge/stats"],
    ["get", "/api/knowledge/items"],
    ["get", "/api/knowledge/categories"],
    ["get", "/api/assistant/status"],
    ["get", "/api/assistant/conversations"],
  ];

  it.each(reads)("%s %s is allowed", async (method, path) => {
    mocks.prisma.knowledgeDocument.groupBy.mockResolvedValue([]);
    const res = await (request(app) as any)[method](path).set("Cookie", cookie());
    expect(res.status).toBe(200);
  });

  it("can search the knowledge base", async () => {
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/knowledge/search")
      .set("Cookie", cookie())
      .send({ query: "autoclave chamber" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it("can ask the assistant", async () => {
    // Understanding the workspace's own data is ordinary member work.
    mocks.prisma.aiConversation.create.mockResolvedValue({
      id: "conv_1",
      title: "Q",
      kind: "assistant",
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.prisma.aiMessage.create.mockImplementation(async ({ data }: any) => ({
      id: "m1",
      createdAt: new Date(),
      ...data,
    }));
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    mocks.generateText.mockResolvedValue({
      text: "An answer.",
      provider: "gemini",
      model: "gemini-2.5-flash",
      latencyMs: 10,
    });

    const res = await request(app)
      .post("/api/assistant/ask")
      .set("Cookie", cookie())
      .send({ question: "What do we sell?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("An answer.");
    expect(mocks.prisma.aiMessage.create.mock.calls[0][0].data.tenantId).toBe(WORKSPACE_B.id);
  });

  it("can archive its own thread without the stronger permission", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue({ id: "conv_1" });

    const res = await request(app)
      .post("/api/assistant/conversations/conv_1/archive")
      .set("Cookie", cookie());

    expect(res.status).toBe(200);
  });
});

describe("an owner can change the business record", () => {
  const cookie = () => sessionCookie(TENANT_A);

  beforeEach(() => {
    mocks.prisma.businessProfile.upsert.mockImplementation(async ({ create, update }: any) => ({
      tenantId: WORKSPACE_A.id,
      ...create,
      ...update,
    }));
    mocks.prisma.businessProduct.create.mockImplementation(async ({ data }: any) => ({
      id: "p_new",
      status: "active",
      ...data,
    }));
  });

  it("updates the profile", async () => {
    const res = await request(app)
      .put("/api/business/profile")
      .set("Cookie", cookie())
      .send({ businessName: "Brightwave Instruments", industry: "Medical Equipment" });

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe("Brightwave Instruments");
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].where).toEqual({
      tenantId: WORKSPACE_A.id,
    });
  });

  it("accepts a comma-separated list as well as an array", async () => {
    // The dashboard sends arrays; a CSV import or a curl call sends a string.
    await request(app)
      .put("/api/business/profile")
      .set("Cookie", cookie())
      .send({ locationsServed: "Pune, Mumbai , Nashik" });

    expect(
      JSON.parse(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.locationsServed)
    ).toEqual(["Pune", "Mumbai", "Nashik"]);
  });

  it("creates a product and returns 201", async () => {
    const res = await request(app)
      .post("/api/business/products")
      .set("Cookie", cookie())
      .send({ name: "PX-100", keyFeatures: ["18 litre chamber"] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("PX-100");
  });

  it("rejects a product with no name", async () => {
    const res = await request(app)
      .post("/api/business/products")
      .set("Cookie", cookie())
      .send({ category: "Autoclave" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
    expect(mocks.prisma.businessProduct.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a product id outside the workspace", async () => {
    mocks.prisma.businessProduct.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/business/products/p_of_b")
      .set("Cookie", cookie())
      .send({ name: "Renamed" });

    expect(res.status).toBe(404);
    expect(mocks.prisma.businessProduct.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/business/extract", () => {
  const cookie = () => sessionCookie(TENANT_A);

  it("needs more than a sentence to work from", async () => {
    const res = await request(app)
      .post("/api/business/extract")
      .set("Cookie", cookie())
      .send({ text: "We sell things." });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
    expect(mocks.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it("returns the extraction for review without writing by default", async () => {
    mocks.generateStructuredOutput.mockResolvedValue({
      value: {
        businessName: "Brightwave Instruments",
        industry: null,
        businessType: null,
        description: null,
        products: [],
        services: [],
        targetCustomerTypes: [],
        targetIndustries: [],
        locationsServed: [],
        uniqueSellingPoints: [],
        certifications: [],
        decisionMakerRoles: [],
        brandVoice: null,
        missingInformation: ["Pricing"],
        confidence: 0.6,
      },
      result: { text: "", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 10 },
    });

    const res = await request(app)
      .post("/api/business/extract")
      .set("Cookie", cookie())
      .send({ text: "Brightwave Instruments manufactures autoclaves. ".repeat(5) });

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.extracted.businessName).toBe("Brightwave Instruments");
    expect(mocks.prisma.businessProfile.upsert).not.toHaveBeenCalled();
  });

  it("reports an AI outage as 503, not 500", async () => {
    const { AiUnavailableError } = await import("../src/ai/types");
    mocks.generateStructuredOutput.mockRejectedValue(
      new AiUnavailableError("every provider failed", [
        { provider: "gemini", message: "429 rate limited" },
      ])
    );

    const res = await request(app)
      .post("/api/business/extract")
      .set("Cookie", cookie())
      .send({ text: "Brightwave Instruments manufactures autoclaves. ".repeat(5) });

    // "Every provider failed" is an operational fact the caller can act on.
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ai_unavailable");
    expect(res.body.attempts).toHaveLength(1);
  });
});

describe("POST /api/knowledge/documents", () => {
  const cookie = () => sessionCookie(TENANT_A);

  it("requires a file", async () => {
    const res = await request(app).post("/api/knowledge/documents").set("Cookie", cookie());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file/i);
  });

  it("rejects an unsupported type as a 400, not a 500", async () => {
    const res = await request(app)
      .post("/api/knowledge/documents")
      .set("Cookie", cookie())
      .attach("file", Buffer.from("\x89PNG"), {
        filename: "logo.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
    expect(mocks.prisma.knowledgeDocument.create).not.toHaveBeenCalled();
  });

  it("ingests a text file and stamps the workspace on it", async () => {
    const row: Record<string, any> = {
      id: "doc_1",
      tenantId: WORKSPACE_A.id,
      title: "notes",
      originalName: "notes.txt",
      mimeType: "text/plain",
      fileType: "txt",
      sizeBytes: 10,
      checksum: "c",
      status: "pending",
      createdAt: new Date(),
    };
    mocks.prisma.knowledgeDocument.create.mockImplementation(async ({ data }: any) => {
      Object.assign(row, data);
      return { ...row };
    });
    mocks.prisma.knowledgeDocument.update.mockImplementation(async ({ data }: any) => {
      Object.assign(row, data);
      return { ...row };
    });
    mocks.embedTexts.mockResolvedValue({
      vectors: [[1, 0]],
      provider: "gemini",
      model: "text-embedding-004",
      dimensions: 2,
      latencyMs: 5,
    });

    const content =
      "Brightwave Instruments manufactures autoclaves and sterilisation equipment for dental clinics across India.";

    const res = await request(app)
      .post("/api/knowledge/documents")
      .set("Cookie", cookie())
      .field("title", "Company notes")
      .attach("file", Buffer.from(content), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(201);
    expect(res.body.document.status).toBe("ready");
    expect(mocks.prisma.knowledgeDocument.create.mock.calls[0][0].data.tenantId).toBe(
      WORKSPACE_A.id
    );
    expect(mocks.prisma.knowledgeDocument.create.mock.calls[0][0].data.title).toBe(
      "Company notes"
    );
  });
});

describe("POST /api/knowledge/search", () => {
  it("requires a query", async () => {
    const res = await request(app)
      .post("/api/knowledge/search")
      .set("Cookie", sessionCookie(TENANT_A))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });
});

describe("GET /api/assistant/status", () => {
  it("says why the assistant cannot answer when nothing is configured", async () => {
    mocks.isAnyProviderConfigured.mockReturnValue(false);

    const res = await request(app)
      .get("/api/assistant/status")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toMatch(/GEMINI_API_KEY/);
  });
});

describe("POST /api/assistant/ask", () => {
  const cookie = () => sessionCookie(TENANT_A);

  it("requires a question", async () => {
    const res = await request(app).post("/api/assistant/ask").set("Cookie", cookie()).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns 404 for a conversation in another workspace", async () => {
    mocks.prisma.aiConversation.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/assistant/ask")
      .set("Cookie", cookie())
      .send({ conversationId: "conv_of_b", question: "What do we sell?" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("reports an AI outage as 503", async () => {
    const { AiUnavailableError } = await import("../src/ai/types");
    mocks.prisma.aiConversation.create.mockResolvedValue({
      id: "conv_1",
      title: "Q",
      kind: "assistant",
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.prisma.aiMessage.create.mockImplementation(async ({ data }: any) => ({
      id: "m1",
      createdAt: new Date(),
      ...data,
    }));
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    mocks.generateText.mockRejectedValue(new AiUnavailableError("all down", []));

    const res = await request(app)
      .post("/api/assistant/ask")
      .set("Cookie", cookie())
      .send({ question: "What do we sell?" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ai_unavailable");
    // The user's question was still saved, so the client can retry it.
    expect(mocks.prisma.aiMessage.create).toHaveBeenCalledTimes(1);
  });
});
