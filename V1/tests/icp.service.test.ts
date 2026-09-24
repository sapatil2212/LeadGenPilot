/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ideal Customer Profiles and tenant-scoped deduplication.
 *
 * Both replace deployment-global state, and the tests are shaped around what that
 * state used to get wrong:
 *
 *   `src/config.ts` held one vertical and one city in a mutable module object, so
 *   every query here asserts the workspace predicate.
 *
 *   `processed-leads.json` had no tenant dimension at all, so one workspace's
 *   harvest suppressed a business for every other workspace and
 *   `GET /api/processed` served the whole file to any authenticated caller.
 *
 * `buildSearchQueries` also has its own block. It replaced a heuristic that
 * expanded a category list by matching against thirty hardcoded English business
 * nouns, and the tests record that the expansion is gone deliberately.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({ prisma: null as unknown as PrismaMock }));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const icp = await import("../src/icp/icpService");
const dedupe = await import("../src/discovery/dedupeService");
const { resolvePermissions } = await import("../src/tenancy/permissions");

const CTX_A = {
  userId: TENANT_A.id,
  tenantId: WORKSPACE_A.id,
  membershipId: "tm_a",
  role: "owner",
  tenantName: WORKSPACE_A.name,
  tenantSlug: WORKSPACE_A.slug,
  permissions: resolvePermissions("owner"),
};

function icpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "icp_1",
    tenantId: WORKSPACE_A.id,
    name: "Mid-size hospitals",
    description: null,
    targetCategories: null,
    targetIndustries: null,
    targetLocations: null,
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
    isDefault: false,
    status: "active",
    aiConfidence: null,
    lastSuggestedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function wheres(fn: any): string[] {
  return fn.mock.calls.map((c: any[]) => JSON.stringify(c?.[0]?.where ?? {}));
}

beforeEach(() => {
  mocks.prisma = createPrismaMock();
});

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

describe("listIcpProfiles", () => {
  it("scopes to the workspace and hides archived profiles by default", async () => {
    await icp.listIcpProfiles(CTX_A);
    const where = mocks.prisma.icpProfile.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.status).toBe("active");
  });

  it("includes archived profiles on request", async () => {
    await icp.listIcpProfiles(CTX_A, true);
    expect(mocks.prisma.icpProfile.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });
});

describe("the profile view", () => {
  it("decodes JSON list columns", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(
      icpRow({
        targetCategories: JSON.stringify(["Multispecialty Hospital", "Diagnostic Centre"]),
        targetLocations: JSON.stringify(["Pune", "Nashik"]),
      })
    );
    const profile = await icp.getIcpProfile(CTX_A, "icp_1");
    expect(profile?.targetCategories).toEqual(["Multispecialty Hospital", "Diagnostic Centre"]);
    expect(profile?.targetLocations).toEqual(["Pune", "Nashik"]);
  });

  it("treats a corrupted list column as empty rather than throwing", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(
      icpRow({ targetCategories: "{not json" })
    );
    expect((await icp.getIcpProfile(CTX_A, "icp_1"))?.targetCategories).toEqual([]);
  });

  it("is not ready for discovery without both categories and locations", async () => {
    // Either alone produces zero search queries, so a run would find nothing and
    // the dashboard needs to know before it offers a Start button.
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(
      icpRow({ targetCategories: JSON.stringify(["Dental Clinic"]) })
    );
    expect((await icp.getIcpProfile(CTX_A, "icp_1"))?.readyForDiscovery).toBe(false);
  });

  it("is ready once both are set", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(
      icpRow({
        targetCategories: JSON.stringify(["Dental Clinic"]),
        targetLocations: JSON.stringify(["Pune"]),
      })
    );
    const profile = await icp.getIcpProfile(CTX_A, "icp_1");
    expect(profile?.readyForDiscovery).toBe(true);
    // Categories 35 + locations 30
    expect(profile?.completeness).toBe(65);
  });

  it("returns null for a profile in another workspace", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);
    expect(await icp.getIcpProfile(CTX_A, "icp_of_b")).toBeNull();
    expect(wheres(mocks.prisma.icpProfile.findFirst)[0]).toContain(WORKSPACE_A.id);
  });
});

describe("resolveDefaultIcp", () => {
  it("returns the default profile", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(icpRow({ isDefault: true }));
    const profile = await icp.resolveDefaultIcp(CTX_A);
    expect(profile?.id).toBe("icp_1");
    expect(wheres(mocks.prisma.icpProfile.findFirst)[0]).toContain(WORKSPACE_A.id);
  });

  it("falls back to the oldest active profile when none is flagged default", async () => {
    mocks.prisma.icpProfile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(icpRow({ id: "icp_oldest" }));
    expect((await icp.resolveDefaultIcp(CTX_A))?.id).toBe("icp_oldest");
  });

  it("returns null rather than inventing a profile", async () => {
    // Deliberately unlike the scoring rule set, which is seeded. Guessing target
    // categories for a business the platform knows nothing about is exactly the
    // fabrication this product must not do, and it would spend lead quota.
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);
    expect(await icp.resolveDefaultIcp(CTX_A)).toBeNull();
    expect(mocks.prisma.icpProfile.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

describe("createIcpProfile", () => {
  beforeEach(() => {
    mocks.prisma.icpProfile.create.mockImplementation(async ({ data }: any) => icpRow(data));
  });

  it("requires a name", async () => {
    await expect(icp.createIcpProfile(CTX_A, { name: "  " })).rejects.toThrow(
      icp.IcpValidationError
    );
    expect(mocks.prisma.icpProfile.create).not.toHaveBeenCalled();
  });

  it("stamps the workspace and the creator", async () => {
    await icp.createIcpProfile(CTX_A, { name: "Hospitals" });
    const data = mocks.prisma.icpProfile.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.createdById).toBe(TENANT_A.id);
  });

  it("makes the first profile in a workspace the default", async () => {
    mocks.prisma.icpProfile.count.mockResolvedValue(0);
    await icp.createIcpProfile(CTX_A, { name: "Hospitals" });
    expect(mocks.prisma.icpProfile.create.mock.calls[0][0].data.isDefault).toBe(true);
  });

  it("does not make a later profile default automatically", async () => {
    mocks.prisma.icpProfile.count.mockResolvedValue(2);
    await icp.createIcpProfile(CTX_A, { name: "Second" });
    expect(mocks.prisma.icpProfile.create.mock.calls[0][0].data.isDefault).toBe(false);
  });

  it("JSON-encodes and deduplicates list fields", async () => {
    await icp.createIcpProfile(CTX_A, {
      name: "Hospitals",
      targetCategories: ["Hospital", "Hospital", "  Clinic  ", ""],
    });
    const data = mocks.prisma.icpProfile.create.mock.calls[0][0].data;
    expect(JSON.parse(data.targetCategories)).toEqual(["Hospital", "Clinic"]);
  });

  it("accepts a comma-separated string as a list", async () => {
    await icp.createIcpProfile(CTX_A, { name: "X", targetLocations: "Pune, Nashik" });
    const data = mocks.prisma.icpProfile.create.mock.calls[0][0].data;
    expect(JSON.parse(data.targetLocations)).toEqual(["Pune", "Nashik"]);
  });

  it("drops signal ids this build does not know", async () => {
    // A rule set or profile naming a signal that no longer exists must not be
    // able to reintroduce it by round-tripping through storage.
    await icp.createIcpProfile(CTX_A, {
      name: "X",
      requiredSignals: ["website.missing", "website.on_fire"],
    });
    const data = mocks.prisma.icpProfile.create.mock.calls[0][0].data;
    expect(JSON.parse(data.requiredSignals)).toEqual(["website.missing"]);
  });

  it("validates the numeric bounds", async () => {
    await expect(icp.createIcpProfile(CTX_A, { name: "X", minRating: 9 })).rejects.toThrow(
      /between 0 and 5/
    );
    await expect(icp.createIcpProfile(CTX_A, { name: "X", minReviews: -1 })).rejects.toThrow(
      /cannot be negative/
    );
    await expect(icp.createIcpProfile(CTX_A, { name: "X", maxResults: 0 })).rejects.toThrow(
      /between 1 and 5000/
    );
    await expect(icp.createIcpProfile(CTX_A, { name: "X", radiusKm: 900 })).rejects.toThrow(
      /between 1 and 500/
    );
  });
});

describe("updateIcpProfile", () => {
  it("refuses a profile in another workspace", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);
    expect(await icp.updateIcpProfile(CTX_A, "icp_of_b", { name: "Mine" })).toBeNull();
    expect(mocks.prisma.icpProfile.update).not.toHaveBeenCalled();
  });

  it("writes only the fields supplied", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue({ id: "icp_1", isDefault: false });
    mocks.prisma.icpProfile.update.mockImplementation(async ({ data }: any) => icpRow(data));

    await icp.updateIcpProfile(CTX_A, "icp_1", { maxResults: 200 });

    const data = mocks.prisma.icpProfile.update.mock.calls[0][0].data;
    expect(data.maxResults).toBe(200);
    expect(data.targetCategories).toBeUndefined();
  });

  it("clears the AI confidence once a human edits the profile", async () => {
    // A suggested profile that has been hand-edited is no longer the model's
    // output, so its confidence no longer describes what is stored.
    mocks.prisma.icpProfile.findFirst.mockResolvedValue({ id: "icp_1", isDefault: false });
    mocks.prisma.icpProfile.update.mockImplementation(async ({ data }: any) => icpRow(data));

    await icp.updateIcpProfile(CTX_A, "icp_1", { name: "Renamed" });

    expect(mocks.prisma.icpProfile.update.mock.calls[0][0].data.aiConfidence).toBeNull();
  });

  it("takes the default flag off a profile being archived", async () => {
    // Otherwise the workspace's default points at something it cannot use.
    mocks.prisma.icpProfile.findFirst.mockResolvedValue({ id: "icp_1", isDefault: true });
    mocks.prisma.icpProfile.update.mockImplementation(async ({ data }: any) => icpRow(data));

    await icp.updateIcpProfile(CTX_A, "icp_1", { status: "archived" });

    const data = mocks.prisma.icpProfile.update.mock.calls[0][0].data;
    expect(data.status).toBe("archived");
    expect(data.isDefault).toBe(false);
  });
});

describe("setDefaultIcpProfile", () => {
  it("clears the flag from every other profile in the workspace", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue({ id: "icp_2" });

    expect(await icp.setDefaultIcpProfile(CTX_A, "icp_2")).toBe(true);

    const where = mocks.prisma.icpProfile.updateMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(WORKSPACE_A.id);
    expect(where.id).toEqual({ not: "icp_2" });
    expect(mocks.prisma.icpProfile.update).toHaveBeenCalledWith({
      where: { id: "icp_2" },
      data: { isDefault: true },
    });
  });

  it("refuses a profile in another workspace", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);
    expect(await icp.setDefaultIcpProfile(CTX_A, "icp_of_b")).toBe(false);
    expect(mocks.prisma.icpProfile.updateMany).not.toHaveBeenCalled();
  });
});

describe("deleteIcpProfile", () => {
  it("refuses a profile in another workspace", async () => {
    mocks.prisma.icpProfile.findFirst.mockResolvedValue(null);
    expect(await icp.deleteIcpProfile(CTX_A, "icp_of_b")).toBe(false);
    expect(mocks.prisma.icpProfile.delete).not.toHaveBeenCalled();
  });

  it("promotes another profile when the default is deleted", async () => {
    mocks.prisma.icpProfile.findFirst
      .mockResolvedValueOnce({ id: "icp_1", isDefault: true })
      .mockResolvedValueOnce({ id: "icp_2" });

    expect(await icp.deleteIcpProfile(CTX_A, "icp_1")).toBe(true);
    expect(mocks.prisma.icpProfile.update).toHaveBeenCalledWith({
      where: { id: "icp_2" },
      data: { isDefault: true },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query building
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSearchQueries", () => {
  it("crosses every category with every location", async () => {
    expect(icp.buildSearchQueries(["Dental Clinic", "Orthodontist"], ["Pune", "Nashik"])).toEqual([
      "Dental Clinic in Pune",
      "Orthodontist in Pune",
      "Dental Clinic in Nashik",
      "Orthodontist in Nashik",
    ]);
  });

  it("returns nothing when either side is empty", async () => {
    expect(icp.buildSearchQueries([], ["Pune"])).toEqual([]);
    expect(icp.buildSearchQueries(["Dental Clinic"], [])).toEqual([]);
  });

  it("ignores blank entries", async () => {
    expect(icp.buildSearchQueries(["Dental Clinic", "  "], ["Pune", ""])).toEqual([
      "Dental Clinic in Pune",
    ]);
  });

  it("does not scrape the same query twice", async () => {
    expect(icp.buildSearchQueries(["Clinic", "clinic"], ["Pune"])).toEqual(["Clinic in Pune"]);
  });

  it("no longer guesses a missing category suffix", async () => {
    /*
     * The removed heuristic turned "dental, skin clinic" into "dental clinic" and
     * "skin clinic" by matching the last word against a hardcoded list of thirty
     * English business nouns. A fixed vocabulary of what a business can be is
     * exactly what a universal platform cannot have, and the rule only applied
     * when the LAST part happened to end in a listed word — so the same input in
     * a different order behaved differently.
     *
     * Each category is now searched as written. A workspace that relied on the
     * expansion lists both categories in full, which is what it meant.
     */
    expect(icp.buildSearchQueries(["dental", "skin clinic"], ["Pune"])).toEqual([
      "dental in Pune",
      "skin clinic in Pune",
    ]);
  });
});

describe("toDiscoveryCriteria", () => {
  const profile = {
    ...icpRow(),
    id: "icp_1",
    name: "Hospitals",
    description: null,
    targetCategories: ["Hospital"],
    targetIndustries: [],
    targetLocations: ["Pune"],
    decisionMakerRoles: [],
    excludeCategories: ["Pharmacy"],
    excludeKeywords: [],
    requiredSignals: [],
    preferredSignals: [],
    minRating: 4,
    minReviews: 20,
    maxResults: 100,
    radiusKm: 25,
    deepAnalysis: false,
    isDefault: true,
    status: "active",
    aiConfidence: null,
    lastSuggestedAt: null,
    completeness: 80,
    readyForDiscovery: true,
  } as any;

  it("snapshots the profile's targeting", () => {
    const criteria = icp.toDiscoveryCriteria(profile);
    expect(criteria.categories).toEqual(["Hospital"]);
    expect(criteria.locations).toEqual(["Pune"]);
    expect(criteria.maxResults).toBe(100);
    expect(criteria.icpProfileId).toBe("icp_1");
  });

  it("lets a run override the profile without changing it", () => {
    // The criteria are written to the job row, so editing the profile mid-run
    // cannot change what is being searched for. That was the exact failure mode
    // of the shared CONFIG object.
    const criteria = icp.toDiscoveryCriteria(profile, { locations: ["Nashik"], maxResults: 10 });
    expect(criteria.locations).toEqual(["Nashik"]);
    expect(criteria.maxResults).toBe(10);
    expect(profile.targetLocations).toEqual(["Pune"]);
  });
});

describe("passesIcpFilters", () => {
  const base = {
    excludeCategories: [] as string[],
    excludeKeywords: [] as string[],
    minRating: null as number | null,
    minReviews: null as number | null,
  };

  it("keeps a candidate with no filters configured", () => {
    expect(
      icp.passesIcpFilters({ businessName: "Acme", category: "Hospital" }, base).keep
    ).toBe(true);
  });

  it("drops an excluded category", () => {
    const verdict = icp.passesIcpFilters(
      { businessName: "City Pharmacy", category: "Pharmacy" },
      { ...base, excludeCategories: ["Pharmacy"] }
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toContain("Pharmacy");
  });

  it("matches an excluded keyword in the name as well as the category", () => {
    // A search for "clinic" returns the tenant's own competitors as readily as
    // prospects, so name matching is the practical half of exclusion.
    expect(
      icp.passesIcpFilters(
        { businessName: "Brightwave Equipment Supplies", category: "Wholesaler" },
        { ...base, excludeKeywords: ["brightwave"] }
      ).keep
    ).toBe(false);
  });

  it("applies the reputation floor", () => {
    expect(
      icp.passesIcpFilters(
        { businessName: "Acme", rating: 3.2, reviews: 50 },
        { ...base, minRating: 4 }
      ).keep
    ).toBe(false);
    expect(
      icp.passesIcpFilters(
        { businessName: "Acme", rating: 4.5, reviews: 5 },
        { ...base, minReviews: 20 }
      ).keep
    ).toBe(false);
    expect(
      icp.passesIcpFilters(
        { businessName: "Acme", rating: 4.5, reviews: 50 },
        { ...base, minRating: 4, minReviews: 20 }
      ).keep
    ).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      icp.passesIcpFilters(
        { businessName: "Acme", category: "PHARMACY" },
        { ...base, excludeCategories: ["pharmacy"] }
      ).keep
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("fingerprintOf", () => {
  it("ignores punctuation, case and spacing", () => {
    expect(dedupe.fingerprintOf("Dr. Patil's Clinic", "12 Main St.")).toBe(
      dedupe.fingerprintOf("dr patils clinic", "12 main st")
    );
  });

  it("distinguishes two branches of the same chain", () => {
    // The name alone collides across branches — two Apollo Diagnostics in
    // different suburbs are two prospects.
    expect(dedupe.fingerprintOf("Apollo Diagnostics", "Baner, Pune")).not.toBe(
      dedupe.fingerprintOf("Apollo Diagnostics", "Kothrud, Pune")
    );
  });

  it("distinguishes two businesses at one address", () => {
    expect(dedupe.fingerprintOf("Acme Dental", "Tower A")).not.toBe(
      dedupe.fingerprintOf("Beta Dental", "Tower A")
    );
  });

  it("tolerates a missing address", () => {
    expect(dedupe.fingerprintOf("Acme", null)).toBe(dedupe.fingerprintOf("Acme", undefined));
  });

  it("keeps accented characters distinct", () => {
    // Stripping accents would merge genuinely different names in scripts where
    // the mark is not decoration.
    expect(dedupe.fingerprintOf("Café Noir", "1 St")).not.toBe(
      dedupe.fingerprintOf("Cafe Noir", "1 St")
    );
  });
});

describe("isAlreadyDiscovered", () => {
  it("looks up the composite key, so it cannot cross a workspace", async () => {
    mocks.prisma.discoveredBusiness.findUnique.mockResolvedValue({ id: "db_1" });

    expect(await dedupe.isAlreadyDiscovered(CTX_A, "Acme", "1 Main St")).toBe(true);

    const where = mocks.prisma.discoveredBusiness.findUnique.mock.calls[0][0].where;
    expect(where.tenantId_fingerprint.tenantId).toBe(WORKSPACE_A.id);
    expect(where.tenantId_fingerprint.tenantId).not.toBe(WORKSPACE_B.id);
    expect(where.tenantId_fingerprint.fingerprint).toBe(
      dedupe.fingerprintOf("Acme", "1 Main St")
    );
  });

  it("is false when the workspace has not seen it", async () => {
    mocks.prisma.discoveredBusiness.findUnique.mockResolvedValue(null);
    expect(await dedupe.isAlreadyDiscovered(CTX_A, "Acme", "1 Main St")).toBe(false);
  });
});

describe("loadSeenFingerprints", () => {
  it("fetches the workspace's set in one query", async () => {
    // One query per run rather than one per candidate: a run examines hundreds of
    // businesses against a remote database known to drop connections.
    mocks.prisma.discoveredBusiness.findMany.mockResolvedValue([
      { fingerprint: "aaa" },
      { fingerprint: "bbb" },
    ]);

    const seen = await dedupe.loadSeenFingerprints(CTX_A);

    expect(seen.has("aaa")).toBe(true);
    expect(seen.size).toBe(2);
    expect(mocks.prisma.discoveredBusiness.findMany.mock.calls[0][0].where.tenantId).toBe(
      WORKSPACE_A.id
    );
  });
});

describe("recordDiscovered", () => {
  it("upserts on the workspace-scoped key", async () => {
    await dedupe.recordDiscovered(CTX_A, {
      businessName: "Acme",
      address: "1 Main St",
      leadId: "lead_1",
    });

    const call = mocks.prisma.discoveredBusiness.upsert.mock.calls[0][0];
    expect(call.where.tenantId_fingerprint.tenantId).toBe(WORKSPACE_A.id);
    expect(call.create.tenantId).toBe(WORKSPACE_A.id);
    expect(call.create.leadId).toBe("lead_1");
  });

  it("bumps the counter on a second sighting rather than failing", async () => {
    await dedupe.recordDiscovered(CTX_A, { businessName: "Acme" });
    const call = mocks.prisma.discoveredBusiness.upsert.mock.calls[0][0];
    expect(call.update.timesSeen).toEqual({ increment: 1 });
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
  });

  it("never clears an existing leadId", async () => {
    // The first successful persist is the pointer worth keeping.
    await dedupe.recordDiscovered(CTX_A, { businessName: "Acme", leadId: null });
    expect(mocks.prisma.discoveredBusiness.upsert.mock.calls[0][0].update.leadId).toBeUndefined();
  });

  it("swallows a write failure rather than aborting the run", async () => {
    // The expensive work — finding and analysing the business — is already done.
    mocks.prisma.discoveredBusiness.upsert.mockRejectedValue(new Error("deadlock"));
    await expect(dedupe.recordDiscovered(CTX_A, { businessName: "Acme" })).resolves.toBeUndefined();
  });

  it("records a business that was filtered out, with no lead", async () => {
    // Remembering a rejection is what stops the next run spending four page
    // loads to reach the same conclusion.
    await dedupe.recordDiscovered(CTX_A, { businessName: "City Pharmacy", leadId: null });
    expect(mocks.prisma.discoveredBusiness.upsert.mock.calls[0][0].create.leadId).toBeNull();
  });
});

describe("listDiscovered", () => {
  it("scopes and paginates", async () => {
    mocks.prisma.discoveredBusiness.findMany.mockResolvedValue([]);
    mocks.prisma.discoveredBusiness.count.mockResolvedValue(0);

    await dedupe.listDiscovered(CTX_A, { limit: 10, offset: 20 });

    const call = mocks.prisma.discoveredBusiness.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe(WORKSPACE_A.id);
    expect(call.take).toBe(10);
    expect(call.skip).toBe(20);
  });

  it("caps the page size", async () => {
    mocks.prisma.discoveredBusiness.findMany.mockResolvedValue([]);
    mocks.prisma.discoveredBusiness.count.mockResolvedValue(0);
    await dedupe.listDiscovered(CTX_A, { limit: 100_000 });
    expect(mocks.prisma.discoveredBusiness.findMany.mock.calls[0][0].take).toBe(500);
  });
});

describe("clearDiscovered", () => {
  it("deletes only the caller's workspace", async () => {
    mocks.prisma.discoveredBusiness.deleteMany.mockResolvedValue({ count: 7 });

    expect(await dedupe.clearDiscovered(CTX_A)).toBe(7);
    expect(mocks.prisma.discoveredBusiness.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: WORKSPACE_A.id },
    });
  });
});
