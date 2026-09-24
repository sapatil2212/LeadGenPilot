/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tenant-owned scoring rule sets: persistence, seeding and isolation.
 *
 * Two behaviours carry most of the weight here. The version bump on every edit,
 * because leads store the version they were scored under and without it a
 * changed weight leaves yesterday's scores and today's in the same column on
 * different scales. And the lazy seed, because a workspace with no rule set must
 * still be able to run discovery — a first run should not fail on setup the user
 * was never asked to do.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPrismaMock, type PrismaMock, TENANT_A, WORKSPACE_A } from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const service = await import("../src/scoring/scoringService");
const { BUILT_IN_RULES, RuleSetValidationError } = await import("../src/scoring/ruleSet");
const { resolvePermissions } = await import("../src/tenancy/permissions");
const { makeLead } = await import("./helpers/leadFixture");

const CTX_A = {
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
  membershipId: "tm_a",
  role: "owner",
  tenantName: WORKSPACE_A.name,
  tenantSlug: WORKSPACE_A.slug,
  permissions: resolvePermissions("owner"),
};

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

beforeEach(() => {
  mocks.prisma = createPrismaMock();
});

describe("the rule set view", () => {
  it("derives the maximum from the rules rather than storing it", async () => {
    // A denormalised maximum would be one edit away from disagreeing with the
    // rules that produce it, and it is the denominator every score and every AI
    // prompt is expressed against.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());

    const view = await service.getRuleSet(CTX_A, "rs_1");

    expect(view?.maxScore).toBe(170);
    expect(view?.hotAtPoints).toBe(100);
    expect(view?.warmAtPoints).toBe(60);
  });

  it("surfaces a corrupted rules column as an empty set instead of a 500", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ rules: "{not json" }));

    const view = await service.getRuleSet(CTX_A, "rs_1");

    expect(view?.rules).toEqual([]);
    expect(view?.maxScore).toBe(0);
  });

  it("returns null for a rule set in another workspace", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(null);
    expect(await service.getRuleSet(CTX_A, "rs_of_b")).toBeNull();
    expect(
      JSON.stringify(mocks.prisma.scoringRuleSet.findFirst.mock.calls[0][0].where)
    ).toContain(WORKSPACE_A.id);
  });
});

describe("listRuleSets", () => {
  it("scopes to the workspace and puts the default first", async () => {
    await service.listRuleSets(CTX_A);
    const call = mocks.prisma.scoringRuleSet.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe(WORKSPACE_A.id);
    expect(call.where.status).toBe("active");
    expect(call.orderBy[0]).toEqual({ isDefault: "desc" });
  });
});

describe("resolveActiveRuleSet", () => {
  it("returns the existing default", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());

    const ruleSet = await service.resolveActiveRuleSet(CTX_A);

    expect(ruleSet.id).toBe("rs_1");
    expect(mocks.prisma.scoringRuleSet.create).not.toHaveBeenCalled();
  });

  it("seeds the built-in set for a workspace that has none", async () => {
    // Unlike the ICP, a default here can be guessed at: the shipped weights are a
    // reasonable starting point for anyone, and a first run must not fail on
    // setup nobody asked for.
    mocks.prisma.scoringRuleSet.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ruleSetRow({ id: "rs_seeded" }));

    const ruleSet = await service.resolveActiveRuleSet(CTX_A);

    expect(ruleSet.id).toBe("rs_seeded");
    const data = mocks.prisma.scoringRuleSet.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.isDefault).toBe(true);
    expect(data.isBuiltIn).toBe(true);
    expect(JSON.parse(data.rules)).toHaveLength(BUILT_IN_RULES.length);
  });

  it("promotes an existing set rather than seeding a second built-in", async () => {
    // A workspace can have rule sets but no default, e.g. after archiving one.
    mocks.prisma.scoringRuleSet.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rs_orphan" });
    mocks.prisma.scoringRuleSet.update.mockResolvedValue(ruleSetRow({ id: "rs_orphan" }));

    const ruleSet = await service.resolveActiveRuleSet(CTX_A);

    expect(ruleSet.id).toBe("rs_orphan");
    expect(mocks.prisma.scoringRuleSet.create).not.toHaveBeenCalled();
    expect(mocks.prisma.scoringRuleSet.update).toHaveBeenCalledWith({
      where: { id: "rs_orphan" },
      data: { isDefault: true },
    });
  });

  it("falls back to the in-code default when the seeded row cannot be read back", async () => {
    // The database is in trouble, but a discovery run already underway should
    // score with the built-in weights rather than fail.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(null);

    const ruleSet = await service.resolveActiveRuleSet(CTX_A);

    expect(ruleSet.id).toBe("built-in");
    expect(ruleSet.maxScore).toBe(170);
  });
});

describe("createRuleSet", () => {
  beforeEach(() => {
    mocks.prisma.scoringRuleSet.create.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data, isDefault: false, isBuiltIn: false })
    );
  });

  it("requires a name", async () => {
    await expect(
      service.createRuleSet(CTX_A, { name: " ", rules: BUILT_IN_RULES })
    ).rejects.toThrow(RuleSetValidationError);
  });

  it("stamps the workspace and starts at version 1", async () => {
    await service.createRuleSet(CTX_A, { name: "Equipment sellers", rules: BUILT_IN_RULES });
    const data = mocks.prisma.scoringRuleSet.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.createdById).toBe(TENANT_A.id);
    expect(data.version).toBe(1);
    expect(data.isBuiltIn).toBe(false);
  });

  it("refuses a set where nothing can score", async () => {
    // Every rule a penalty means every lead grades COLD forever. That is a
    // configuration mistake, not a preference.
    await expect(
      service.createRuleSet(CTX_A, {
        name: "Penalties only",
        rules: [{ signal: "website.working", points: -10 }],
      })
    ).rejects.toThrow(/must award positive points/);
  });

  it("validates the thresholds", async () => {
    await expect(
      service.createRuleSet(CTX_A, {
        name: "Bad bands",
        rules: BUILT_IN_RULES,
        hotThreshold: 0.3,
        warmThreshold: 0.5,
      })
    ).rejects.toThrow(/below the HOT threshold/);
  });
});

describe("updateRuleSet", () => {
  it("refuses a rule set in another workspace", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(null);
    expect(await service.updateRuleSet(CTX_A, "rs_of_b", { name: "Mine" })).toBeNull();
    expect(mocks.prisma.scoringRuleSet.update).not.toHaveBeenCalled();
  });

  it("bumps the version when the weights change", async () => {
    // Leads carry the version they were scored under; without the bump the old
    // and new scales become indistinguishable.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ version: 4 }));
    mocks.prisma.scoringRuleSet.update.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data })
    );

    await service.updateRuleSet(CTX_A, "rs_1", {
      rules: [{ signal: "website.missing", points: 80 }],
    });

    expect(mocks.prisma.scoringRuleSet.update.mock.calls[0][0].data.version).toBe(5);
  });

  it("bumps the version when only a threshold changes", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ version: 2 }));
    mocks.prisma.scoringRuleSet.update.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data })
    );

    await service.updateRuleSet(CTX_A, "rs_1", { hotThreshold: 0.7 });

    expect(mocks.prisma.scoringRuleSet.update.mock.calls[0][0].data.version).toBe(3);
  });

  it("does not bump the version for a rename", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ version: 2 }));
    mocks.prisma.scoringRuleSet.update.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data })
    );

    await service.updateRuleSet(CTX_A, "rs_1", { name: "Renamed" });

    expect(mocks.prisma.scoringRuleSet.update.mock.calls[0][0].data.version).toBeUndefined();
  });

  it("stops calling a set built-in once its weights are edited", async () => {
    // Editing it is the point of the phase, but it is no longer the shipped
    // configuration and should not claim to be.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ isBuiltIn: true }));
    mocks.prisma.scoringRuleSet.update.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data })
    );

    await service.updateRuleSet(CTX_A, "rs_1", {
      rules: [{ signal: "website.missing", points: 10 }],
    });

    expect(mocks.prisma.scoringRuleSet.update.mock.calls[0][0].data.isBuiltIn).toBe(false);
  });

  it("takes the default flag off a set being archived", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow({ isDefault: true }));
    mocks.prisma.scoringRuleSet.update.mockImplementation(async ({ data }: any) =>
      ruleSetRow({ ...data })
    );

    await service.updateRuleSet(CTX_A, "rs_1", { status: "archived" });

    const data = mocks.prisma.scoringRuleSet.update.mock.calls[0][0].data;
    expect(data.status).toBe("archived");
    expect(data.isDefault).toBe(false);
  });

  it("refuses an edit that makes nothing scoreable", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());
    await expect(
      service.updateRuleSet(CTX_A, "rs_1", { rules: [{ signal: "website.working", points: -5 }] })
    ).rejects.toThrow(/must award positive points/);
  });
});

describe("setDefaultRuleSet", () => {
  it("clears the flag from every other set in the workspace", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue({ id: "rs_2" });

    expect(await service.setDefaultRuleSet(CTX_A, "rs_2")).toBe(true);

    const where = mocks.prisma.scoringRuleSet.updateMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.id).toEqual({ not: "rs_2" });
  });

  it("refuses a set in another workspace", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(null);
    expect(await service.setDefaultRuleSet(CTX_A, "rs_of_b")).toBe(false);
    expect(mocks.prisma.scoringRuleSet.updateMany).not.toHaveBeenCalled();
  });
});

describe("deleteRuleSet", () => {
  it("refuses a set in another workspace", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(null);
    expect(await service.deleteRuleSet(CTX_A, "rs_of_b")).toBe(false);
  });

  it("refuses to delete the workspace's only configuration", async () => {
    // Otherwise the next discovery run has nothing to score with.
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue({ id: "rs_1", isDefault: true });
    mocks.prisma.scoringRuleSet.count.mockResolvedValue(1);

    await expect(service.deleteRuleSet(CTX_A, "rs_1")).rejects.toThrow(/only scoring configuration/);
    expect(mocks.prisma.scoringRuleSet.delete).not.toHaveBeenCalled();
  });

  it("promotes another set when the default is deleted", async () => {
    mocks.prisma.scoringRuleSet.findFirst
      .mockResolvedValueOnce({ id: "rs_1", isDefault: true })
      .mockResolvedValueOnce({ id: "rs_2" });
    mocks.prisma.scoringRuleSet.count.mockResolvedValue(2);

    expect(await service.deleteRuleSet(CTX_A, "rs_1")).toBe(true);
    expect(mocks.prisma.scoringRuleSet.update).toHaveBeenCalledWith({
      where: { id: "rs_2" },
      data: { isDefault: true },
    });
  });
});

describe("scoreLeadForTenant", () => {
  it("scores with the workspace's active rule set", async () => {
    mocks.prisma.scoringRuleSet.findFirst.mockResolvedValue(ruleSetRow());

    const result = await service.scoreLeadForTenant(
      CTX_A,
      makeLead({ websiteStatus: "MISSING", reviews: 500, rating: 4.9 })
    );

    expect(result.max).toBe(170);
    expect(result.score).toBe(135);
    expect(result.priority).toBe("HOT");
    expect(result.ruleSetId).toBe("rs_1");
    expect(result.ruleSetVersion).toBe(1);
  });
});
