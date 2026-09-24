/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authorization for targeting, scoring, and the routes Phase 4 locked down.
 *
 * Two kinds of test, for two reasons.
 *
 * The /api/icp and /api/scoring routers are exercised over HTTP, the same way
 * /api/crm and /api/business are: mounted on a test app with the real middleware
 * chain, then probed for session, workspace and permission enforcement.
 *
 * The five legacy routes are checked against server.ts's source instead. Their
 * handlers are declared inline in a module that opens listeners and starts
 * pollers on import, so they cannot be mounted in isolation. A source-level
 * assertion is a weaker test, and it is still worth having: the Phase 1
 * vulnerability was a router mounted before the middleware that populated
 * req.authUser, which is precisely a "the guard is not attached" bug, and this is
 * the kind of check that catches it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
  generateStructuredOutput: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
  embedTexts: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/ai/aiService", () => ({
  generateStructuredOutput: (...args: unknown[]) => mocks.generateStructuredOutput(...args),
  generateText: (...args: unknown[]) => mocks.generateText(...args),
  embedTexts: (...args: unknown[]) => mocks.embedTexts(...args),
  isAnyProviderConfigured: () => mocks.isAnyProviderConfigured(),
}));

const { issueSessionToken } = await import("../src/authService");
const { attachEntitlements } = await import("../src/entitlements");
const { env } = await import("../src/env");
const { TENANT_HEADER } = await import("../src/tenancy/context");
const { BUILT_IN_RULES } = await import("../src/scoring/ruleSet");
const icpRoutes = (await import("../src/icp/icpRoutes")).default;
const scoringRoutes = (await import("../src/scoring/scoringRoutes")).default;

function buildApp() {
  const app = express();
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(cookieParser());
  app.use("/api", attachEntitlements);
  app.use("/api/icp", icpRoutes);
  app.use("/api/scoring", scoringRoutes);
  return app;
}

function sessionCookie(user: { id: string; email: string; role: string }) {
  return `${env.auth.cookieName}=${issueSessionToken(user)}`;
}

function icpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "icp_1",
    tenantId: WORKSPACE_A.id,
    name: "Hospitals",
    description: null,
    targetCategories: JSON.stringify(["Multispecialty Hospital"]),
    targetIndustries: null,
    targetLocations: JSON.stringify(["Pune"]),
    decisionMakerRoles: null,
    excludeCategories: null,
    excludeKeywords: null,
    requiredSignals: null,
    preferredSignals: null,
    minRating: null,
    minReviews: null,
    maxResults: 50,
    radiusKm: null,
    deepAnalysis: false,
    isDefault: true,
    status: "active",
    aiConfidence: null,
    lastSuggestedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function ruleSetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rs_1",
    tenantId: WORKSPACE_A.id,
    name: "Digital presence opportunity",
    description: null,
    version: 1,
    rules: JSON.stringify(BUILT_IN_RULES),
    hotThreshold: 100 / 170,
    warmThreshold: 60 / 170,
    isDefault: true,
    isBuiltIn: true,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

let app: express.Express;

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  app = buildApp();

  mocks.generateStructuredOutput.mockReset();
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
    ["get", "/api/icp"],
    ["get", "/api/icp/default"],
    ["post", "/api/icp"],
    ["get", "/api/icp/icp_1"],
    ["patch", "/api/icp/icp_1"],
    ["delete", "/api/icp/icp_1"],
    ["post", "/api/icp/icp_1/default"],
    ["post", "/api/icp/suggest"],
    ["get", "/api/scoring/signals"],
    ["get", "/api/scoring/rule-sets"],
    ["get", "/api/scoring/active"],
    ["post", "/api/scoring/rule-sets"],
    ["get", "/api/scoring/rule-sets/rs_1"],
    ["patch", "/api/scoring/rule-sets/rs_1"],
    ["delete", "/api/scoring/rule-sets/rs_1"],
    ["post", "/api/scoring/rule-sets/rs_1/default"],
    ["post", "/api/scoring/rule-sets/rs_1/preview"],
  ];

  it.each(routes)("%s %s refuses an anonymous caller", async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("no_session");
  });

  it("never reaches the data layer without a session", async () => {
    await request(app).get("/api/icp");
    expect(mocks.prisma.icpProfile.findMany).not.toHaveBeenCalled();
  });
});

describe("cross-workspace access", () => {
  it("refuses an X-Tenant-Id the caller is not a member of", async () => {
    const res = await request(app)
      .get("/api/icp")
      .set("Cookie", sessionCookie(TENANT_A))
      .set(TENANT_HEADER, WORKSPACE_B.id);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_forbidden");
    expect(mocks.prisma.icpProfile.findMany).not.toHaveBeenCalled();
  });

  it("scopes a profile listing to the caller's workspace", async () => {
    const res = await request(app).get("/api/icp").set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(mocks.prisma.icpProfile.findMany.mock.calls[0][0].where.tenantId).toBe(WORKSPACE_A.id);
  });

  it("returns 404 for another workspace's profile rather than leaking its existence", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/icp/icp_of_b")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(404);
  });

  it("scopes a rule set listing to the caller's workspace", async () => {
    const res = await request(app)
      .get("/api/scoring/rule-sets")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(mocks.prisma.scoringRuleSet.findMany.mock.calls[0][0].where.tenantId).toBe(
      WORKSPACE_A.id
    );
  });
});

describe("a member can read targeting and scoring but not change them", () => {
  const cookie = () => sessionCookie(TENANT_B);

  const writes: [string, string, Record<string, unknown>][] = [
    ["post", "/api/icp", { name: "Smuggled" }],
    ["patch", "/api/icp/icp_1", { name: "Renamed" }],
    ["delete", "/api/icp/icp_1", {}],
    ["post", "/api/icp/icp_1/default", {}],
    ["post", "/api/icp/suggest", {}],
    ["post", "/api/scoring/rule-sets", { name: "Smuggled", rules: BUILT_IN_RULES }],
    ["patch", "/api/scoring/rule-sets/rs_1", { name: "Renamed" }],
    ["delete", "/api/scoring/rule-sets/rs_1", {}],
    ["post", "/api/scoring/rule-sets/rs_1/default", {}],
  ];

  it.each(writes)("%s %s is refused", async (method, path, body) => {
    const res = await (request(app) as any)[method](path).set("Cookie", cookie()).send(body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    // Targeting and scoring decide who the company contacts and spend the
    // metered lead quota, so they sit with business configuration.
    expect(res.body.permission).toBe("MANAGE_BUSINESS_PROFILE");
  });

  const reads: [string, string][] = [
    ["get", "/api/icp"],
    ["get", "/api/icp/default"],
    ["get", "/api/scoring/signals"],
    ["get", "/api/scoring/rule-sets"],
  ];

  it.each(reads)("%s %s is allowed", async (method, path) => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());
    const res = await (request(app) as any)[method](path).set("Cookie", cookie());
    expect(res.status).toBe(200);
  });

  it("can preview a rule set without being able to change it", async () => {
    // Understanding why a lead is prioritised is ordinary member work.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());

    const res = await request(app)
      .post("/api/scoring/rule-sets/rs_1/preview")
      .set("Cookie", cookie())
      .send({ businessName: "Test", websiteStatus: "MISSING" });

    expect(res.status).toBe(200);
    expect(res.body.max).toBe(170);
    expect(res.body.breakdown.length).toBeGreaterThan(0);
  });
});

describe("GET /api/icp/default", () => {
  it("reports an unconfigured workspace as 200 with a null profile", async () => {
    // "Not set up yet" is a normal state for a new workspace, not a missing
    // resource, and the dashboard has to tell the two apart to know whether to
    // prompt for setup.
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/icp/default")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: null, configured: false });
  });

  it("returns the default profile when one exists", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(icpRow());

    const res = await request(app)
      .get("/api/icp/default")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.body.configured).toBe(true);
    expect(res.body.profile.targetCategories).toEqual(["Multispecialty Hospital"]);
    expect(res.body.profile.readyForDiscovery).toBe(true);
  });
});

describe("POST /api/icp", () => {
  const cookie = () => sessionCookie(TENANT_A);

  beforeEach(() => {
    mocks.prisma.icpProfile.create.mockImplementation(async ({ data }: any) => icpRow(data));
  });

  it("requires a name", async () => {
    const res = await request(app)
      .post("/api/icp")
      .set("Cookie", cookie())
      .send({ targetCategories: ["Hospital"] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
    expect(mocks.prisma.icpProfile.create).not.toHaveBeenCalled();
  });

  it("creates a profile and returns 201", async () => {
    const res = await request(app)
      .post("/api/icp")
      .set("Cookie", cookie())
      .send({
        name: "Hospitals in Maharashtra",
        targetCategories: ["Multispecialty Hospital", "Diagnostic Centre"],
        targetLocations: ["Pune", "Nashik"],
      });

    expect(res.status).toBe(201);
    const data = mocks.prisma.icpProfile.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(JSON.parse(data.targetCategories)).toEqual([
      "Multispecialty Hospital",
      "Diagnostic Centre",
    ]);
  });

  it("reports a bad numeric bound as 400", async () => {
    const res = await request(app)
      .post("/api/icp")
      .set("Cookie", cookie())
      .send({ name: "X", minRating: 12 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });
});

describe("POST /api/icp/suggest", () => {
  const cookie = () => sessionCookie(TENANT_A);

  it("refuses when no AI provider is configured", async () => {
    mocks.isAnyProviderConfigured.mockReturnValue(false);

    const res = await request(app).post("/api/icp/suggest").set("Cookie", cookie()).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("precondition");
    expect(res.body.error).toMatch(/GEMINI_API_KEY/);
  });

  it("refuses when the workspace has told the platform nothing about itself", async () => {
    // A model asked to invent target markets for an unknown company returns a
    // generic list that looks like an answer and sends discovery — and the lead
    // quota — somewhere arbitrary.
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(null);
    mocks.prisma.businessProduct.findMany.mockResolvedValue([]);
    mocks.prisma.businessService.findMany.mockResolvedValue([]);
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    const res = await request(app).post("/api/icp/suggest").set("Cookie", cookie()).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/business profile or upload a document/i);
    expect(mocks.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it("returns a suggestion for review without writing it", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue({
      tenantId: WORKSPACE_A.id,
      businessName: "Brightwave Instruments",
      description: "We manufacture autoclaves for hospitals.",
    });
    mocks.prisma.businessProduct.findMany.mockResolvedValue([]);
    mocks.prisma.businessService.findMany.mockResolvedValue([]);
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    mocks.generateStructuredOutput.mockResolvedValue({
      value: {
        name: "Hospitals in Maharashtra",
        description: "Mid-size hospitals that sterilise in volume.",
        targetCategories: ["Multispecialty Hospital"],
        targetIndustries: [],
        targetLocations: ["Pune"],
        decisionMakerRoles: ["Procurement Manager"],
        excludeCategories: ["Pharmacy"],
        excludeKeywords: [],
        rationale: "They manufacture autoclaves, which hospitals buy.",
        missingInformation: [],
        confidence: 0.7,
      },
      result: { text: "", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 10 },
    });

    const res = await request(app).post("/api/icp/suggest").set("Cookie", cookie()).send({});

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.suggestion.targetCategories).toEqual(["Multispecialty Hospital"]);
    // The approval principle: a run that spends quota is not started from an
    // unreviewed target list.
    expect(mocks.prisma.icpProfile.create).not.toHaveBeenCalled();
  });

  it("reports an AI outage as 503", async () => {
    const { AiUnavailableError } = await import("../src/ai/types");
    mocks.prisma.businessProfile.findUnique.mockResolvedValue({
      tenantId: WORKSPACE_A.id,
      businessName: "Brightwave Instruments",
    });
    mocks.prisma.businessProduct.findMany.mockResolvedValue([]);
    mocks.prisma.businessService.findMany.mockResolvedValue([]);
    mocks.prisma.knowledgeChunk.findFirst.mockResolvedValue(null);
    mocks.generateStructuredOutput.mockRejectedValue(new AiUnavailableError("all down", []));

    const res = await request(app).post("/api/icp/suggest").set("Cookie", cookie()).send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ai_unavailable");
  });
});

describe("GET /api/scoring/signals", () => {
  it("lists what the product can observe, without the predicates", async () => {
    const res = await request(app)
      .get("/api/scoring/signals")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.signals.length).toBeGreaterThan(10);
    for (const signal of res.body.signals) {
      expect(signal.id).toBeTruthy();
      expect(signal.description.length).toBeGreaterThan(20);
      expect(signal.test).toBeUndefined();
    }
  });
});

describe("GET /api/scoring/active", () => {
  it("seeds the built-in configuration for a workspace with none", async () => {
    mocks.prisma.scoringRuleSet.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ruleSetRow());
    mocks.prisma.scoringRuleSet.create.mockResolvedValue(ruleSetRow());

    const res = await request(app)
      .get("/api/scoring/active")
      .set("Cookie", sessionCookie(TENANT_A));

    expect(res.status).toBe(200);
    expect(res.body.maxScore).toBe(170);
    expect(res.body.hotAtPoints).toBe(100);
    expect(res.body.warmAtPoints).toBe(60);
    expect(mocks.prisma.scoringRuleSet.create.mock.calls[0][0].data.tenantId).toBe(WORKSPACE_A.id);
  });
});

describe("POST /api/scoring/rule-sets", () => {
  const cookie = () => sessionCookie(TENANT_A);

  it("rejects rules that are not an array", async () => {
    const res = await request(app)
      .post("/api/scoring/rule-sets")
      .set("Cookie", cookie())
      .send({ name: "Bad", rules: "everything" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });

  it("rejects a set where no rule can score", async () => {
    const res = await request(app)
      .post("/api/scoring/rule-sets")
      .set("Cookie", cookie())
      .send({ name: "Penalties", rules: [{ signal: "website.working", points: -10 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive points/);
  });

  it("rejects thresholds given as points rather than shares", async () => {
    const res = await request(app)
      .post("/api/scoring/rule-sets")
      .set("Cookie", cookie())
      .send({ name: "X", rules: BUILT_IN_RULES, hotThreshold: 100, warmThreshold: 60 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 0 and 1/);
  });

  it("creates a rule set and returns 201", async () => {
    mocks.prisma.scoringRuleSet.create.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data, isDefault: false, isBuiltIn: false })
    );

    const res = await request(app)
      .post("/api/scoring/rule-sets")
      .set("Cookie", cookie())
      .send({
        name: "Equipment buyers",
        rules: [
          { signal: "reputation.many_reviews", points: 40, when: 200 },
          { signal: "social.linkedin_present", points: 30 },
        ],
        hotThreshold: 0.7,
        warmThreshold: 0.4,
      });

    expect(res.status).toBe(201);
    expect(res.body.maxScore).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The legacy routes, checked against server.ts's source
// ─────────────────────────────────────────────────────────────────────────────

describe("the routes Phase 4 locked down", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");

  /**
   * The source with comments stripped.
   *
   * Needed because the file documents the bugs it fixed, so the literal text
   * `CONFIG.maxResults = remaining` still appears — in a comment explaining that
   * the quota capper used to write it. Asserting against the raw source would
   * mean deleting the explanation to make the test pass, which is the wrong trade.
   */
  const code = source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*/")
      );
    })
    .join("\n");

  /** The registration call for a route, plus enough of what follows to see its guards. */
  function registration(method: string, routePath: string): string {
    const needle = `app.${method}(\n  "${routePath}"`;
    const compact = `app.${method}("${routePath}"`;
    const index = source.indexOf(needle) >= 0 ? source.indexOf(needle) : source.indexOf(compact);
    expect(index, `no registration found for ${method.toUpperCase()} ${routePath}`).toBeGreaterThan(
      -1
    );
    return source.slice(index, index + 400);
  }

  it.each([
    ["get", "/api/config", "VIEW_ANALYTICS"],
    ["post", "/api/config", "MANAGE_BUSINESS_PROFILE"],
    ["get", "/api/processed", "VIEW_LEADS"],
    ["post", "/api/clear-leads", "DELETE_LEADS"],
  ])("%s %s resolves a workspace and requires %s", (method, routePath, permission) => {
    const block = registration(method, routePath);
    expect(block).toContain("resolveTenantContext");
    expect(block).toContain(`requirePermission("${permission}")`);
  });

  it.each([
    ["get", "/api/failed"],
    ["get", "/api/logs"],
    ["post", "/api/reset-data"],
  ])("%s %s is operator-only", (method, routePath) => {
    // These read or truncate deployment-wide JSON stores holding every
    // workspace's lead data, so they cannot be tenant-scoped until the delivery
    // pipeline moves to the database. Admin is the correct guard meanwhile.
    const block = registration(method, routePath);
    expect(block).toContain("requireAuth");
    expect(block).toContain("requireAdmin");
  });

  it("no longer rewrites src/config.ts from a request", () => {
    // POST /api/config used to regenerate the module on disk in development, so a
    // single request permanently changed the deployment's default search.
    expect(code).not.toContain("export const CONFIG: Config = {");
    expect(code).not.toContain("fs.writeFileSync(configPath");
  });

  it("no longer mutates the shared CONFIG object from a request", () => {
    for (const field of ["businessType", "location", "maxResults", "enableSimulation"]) {
      expect(code).not.toContain(`CONFIG.${field} =`);
    }
  });

  it("no longer serves the shared processed-leads file", () => {
    // It had no tenant dimension, so it disclosed every workspace's prospect
    // list: business names, addresses and phone numbers harvested by others.
    const block = registration("get", "/api/processed");
    expect(block).not.toContain("duplicateChecker.loadLeads");
    expect(block).toContain("tenantRepo.findLeadsInWorkspace");
    expect(block).toContain("dbLeadToAppLead");
  });

  it("mounts the new routers after the auth middleware", () => {
    // The Phase 1 vulnerability was a router mounted before the middleware that
    // populates req.authUser, so mount order is asserted rather than assumed.
    const authIndex = source.indexOf('app.use("/api", apiKeyAuth())');
    expect(authIndex).toBeGreaterThan(-1);
    for (const mount of ['app.use("/api/icp"', 'app.use("/api/scoring"']) {
      const mountIndex = source.indexOf(mount);
      expect(mountIndex, `${mount} is not mounted`).toBeGreaterThan(-1);
      expect(mountIndex).toBeGreaterThan(authIndex);
    }
  });
});
