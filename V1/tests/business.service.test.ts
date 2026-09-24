/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business profile, products, services and AI-assisted extraction.
 *
 * The extraction tests are the important ones. This is the only place in the
 * product where a model writes to the record that later becomes the factual
 * basis of messages sent in the customer's name, so two behaviours are asserted
 * hard: nothing is written unless the caller explicitly applies it, and an
 * applied extraction never overwrites a field a human has already filled in.
 * A model summarising a brochure must not quietly replace a description someone
 * wrote by hand.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPrismaMock,
  type PrismaMock,
  TENANT_A,
  WORKSPACE_A,
} from "./helpers/prismaMock";

const mocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaMock,
  generateStructuredOutput: vi.fn(),
}));

vi.mock("../src/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, prop) => (mocks.prisma as any)[prop] }),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("../src/ai/aiService", () => ({
  generateStructuredOutput: (...args: unknown[]) => mocks.generateStructuredOutput(...args),
}));

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const business = await import("../src/business/businessService");
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

/** A stored profile row, with list columns already JSON-encoded. */
function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: WORKSPACE_A.id,
    businessName: null,
    industry: null,
    businessType: null,
    website: null,
    description: null,
    country: null,
    state: null,
    city: null,
    contactEmail: null,
    contactPhone: null,
    locationsServed: null,
    targetCustomerTypes: null,
    targetIndustries: null,
    uniqueSellingPoints: null,
    certifications: null,
    decisionMakerRoles: null,
    brandVoice: null,
    salesObjectives: null,
    aiConfidence: null,
    missingInformation: null,
    lastExtractedAt: null,
    ...overrides,
  };
}

/** A complete BusinessExtractionOutput, so tests can override one field at a time. */
function extraction(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "Brightwave Instruments",
    industry: "Medical Equipment Manufacturing",
    businessType: "Manufacturer",
    description: "Builds autoclaves for dental clinics.",
    products: [],
    services: [],
    targetCustomerTypes: [],
    targetIndustries: [],
    locationsServed: [],
    uniqueSellingPoints: [],
    certifications: [],
    decisionMakerRoles: [],
    brandVoice: "technical, precise",
    missingInformation: [],
    confidence: 0.8,
    ...overrides,
  };
}

function wireExtraction(value: Record<string, unknown>) {
  mocks.generateStructuredOutput.mockResolvedValue({
    value,
    result: { text: "", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 10 },
  });
}

beforeEach(() => {
  mocks.prisma = createPrismaMock();
  mocks.generateStructuredOutput.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getBusinessProfile", () => {
  it("scopes the lookup to the workspace", async () => {
    await business.getBusinessProfile(CTX_A);
    expect(mocks.prisma.businessProfile.findUnique).toHaveBeenCalledWith({
      where: { tenantId: WORKSPACE_A.id },
    });
  });

  it("returns an empty view when no profile row exists yet", async () => {
    const profile = await business.getBusinessProfile(CTX_A);
    expect(profile.businessName).toBeNull();
    expect(profile.targetCustomerTypes).toEqual([]);
    expect(profile.completeness).toBe(0);
  });

  it("decodes JSON list columns", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({ locationsServed: JSON.stringify(["Pune", "Mumbai"]) })
    );
    const profile = await business.getBusinessProfile(CTX_A);
    expect(profile.locationsServed).toEqual(["Pune", "Mumbai"]);
  });

  it("treats a corrupted list column as empty rather than throwing", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({ locationsServed: "{not json" })
    );
    const profile = await business.getBusinessProfile(CTX_A);
    expect(profile.locationsServed).toEqual([]);
  });

  it("filters non-strings out of a list column", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({ certifications: JSON.stringify(["ISO 13485", 7, null]) })
    );
    const profile = await business.getBusinessProfile(CTX_A);
    expect(profile.certifications).toEqual(["ISO 13485"]);
  });

  it("scores completeness from the fields later phases depend on", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({
        businessName: "Brightwave",
        industry: "Medical Equipment",
        description: "We build autoclaves.",
        targetCustomerTypes: JSON.stringify(["Dental clinics"]),
      })
    );
    // 10 + 10 + 15 + 20
    expect((await business.getBusinessProfile(CTX_A)).completeness).toBe(55);
  });

  it("reaches 100 when every weighted field is present", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({
        businessName: "Brightwave",
        industry: "Medical Equipment",
        businessType: "Manufacturer",
        description: "We build autoclaves.",
        targetCustomerTypes: JSON.stringify(["Dental clinics"]),
        locationsServed: JSON.stringify(["Pune"]),
        uniqueSellingPoints: JSON.stringify(["36-month warranty"]),
        decisionMakerRoles: JSON.stringify(["Clinic owner"]),
      })
    );
    expect((await business.getBusinessProfile(CTX_A)).completeness).toBe(100);
  });
});

describe("updateBusinessProfile", () => {
  beforeEach(() => {
    mocks.prisma.businessProfile.upsert.mockImplementation(async ({ create, update }: any) =>
      profileRow({ ...create, ...update })
    );
  });

  it("upserts on the workspace id", async () => {
    await business.updateBusinessProfile(CTX_A, { businessName: "Brightwave" });
    const call = mocks.prisma.businessProfile.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: WORKSPACE_A.id });
    expect(call.create.tenantId).toBe(WORKSPACE_A.id);
  });

  it("writes only the keys supplied, so a partial edit cannot blank the rest", async () => {
    await business.updateBusinessProfile(CTX_A, { industry: "Dentistry" });
    const data = mocks.prisma.businessProfile.upsert.mock.calls[0][0].update;
    expect(Object.keys(data)).toEqual(["industry"]);
  });

  it("writes null when a field is explicitly cleared", async () => {
    await business.updateBusinessProfile(CTX_A, { website: null });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.website).toBeNull();
  });

  it("treats an empty string as cleared", async () => {
    await business.updateBusinessProfile(CTX_A, { website: "   " });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.website).toBeNull();
  });

  it("JSON-encodes list fields", async () => {
    await business.updateBusinessProfile(CTX_A, { locationsServed: ["Pune", "Mumbai"] });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.locationsServed).toBe(
      JSON.stringify(["Pune", "Mumbai"])
    );
  });

  it("distinguishes 'not told us' from 'told us there are none'", async () => {
    // null means unknown, so the assistant should ask. [] means the user said
    // none, so it should not.
    await business.updateBusinessProfile(CTX_A, { certifications: [] });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.certifications).toBe("[]");

    mocks.prisma.businessProfile.upsert.mockClear();
    await business.updateBusinessProfile(CTX_A, { certifications: null });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.certifications).toBeNull();
  });

  it("drops blank list entries", async () => {
    await business.updateBusinessProfile(CTX_A, { locationsServed: ["Pune", "  ", ""] });
    expect(mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.locationsServed).toBe(
      JSON.stringify(["Pune"])
    );
  });

  it("caps a list at 50 entries and each entry's length", async () => {
    await business.updateBusinessProfile(CTX_A, {
      locationsServed: Array.from({ length: 80 }, (_, i) => `City ${i}`.padEnd(400, "x")),
    });
    const encoded = JSON.parse(
      mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.locationsServed
    );
    expect(encoded).toHaveLength(50);
    expect(encoded[0].length).toBe(300);
  });

  it("caps long free text", async () => {
    await business.updateBusinessProfile(CTX_A, { description: "x".repeat(10_000) });
    expect(
      mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.description
    ).toHaveLength(6_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("products", () => {
  beforeEach(() => {
    mocks.prisma.businessProduct.create.mockImplementation(async ({ data }: any) => ({
      id: "p1",
      status: "active",
      ...data,
    }));
    mocks.prisma.businessProduct.update.mockImplementation(async ({ data }: any) => ({
      id: "p1",
      name: "PX-100",
      status: "active",
      ...data,
    }));
  });

  it("lists only active products by default", async () => {
    await business.listProducts(CTX_A);
    const where = mocks.prisma.businessProduct.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: WORKSPACE_A.id, status: "active" });
  });

  it("includes archived products on request", async () => {
    await business.listProducts(CTX_A, true);
    expect(mocks.prisma.businessProduct.findMany.mock.calls[0][0].where).toEqual({
      tenantId: WORKSPACE_A.id,
    });
  });

  it("requires a name", async () => {
    await expect(business.createProduct(CTX_A, { name: "  " })).rejects.toThrow(/required/i);
    expect(mocks.prisma.businessProduct.create).not.toHaveBeenCalled();
  });

  it("stamps the workspace on create", async () => {
    await business.createProduct(CTX_A, { name: "PX-100", keyFeatures: ["18 litres"] });
    const data = mocks.prisma.businessProduct.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(WORKSPACE_A.id);
    expect(data.keyFeatures).toBe(JSON.stringify(["18 litres"]));
  });

  it("keeps price positioning as free text", async () => {
    // "from Rs 8L" and "on application" are as common as a figure, and the AI
    // must never invent a number that was not given.
    const product = await business.createProduct(CTX_A, {
      name: "PX-100",
      priceRange: "on application",
    });
    expect(product.priceRange).toBe("on application");
  });

  it("allow-lists status so an arbitrary value cannot be stored", async () => {
    await business.createProduct(CTX_A, { name: "PX-100", status: "nonsense" });
    expect(mocks.prisma.businessProduct.create.mock.calls[0][0].data.status).toBe("active");

    mocks.prisma.businessProduct.create.mockClear();
    await business.createProduct(CTX_A, { name: "PX-100", status: "archived" });
    expect(mocks.prisma.businessProduct.create.mock.calls[0][0].data.status).toBe("archived");
  });

  it("refuses to update a product in another workspace", async () => {
    mocks.prisma.businessProduct.findFirst.mockResolvedValue(null);

    expect(await business.updateProduct(CTX_A, "p_of_b", { name: "Hijacked" })).toBeNull();
    expect(mocks.prisma.businessProduct.update).not.toHaveBeenCalled();
    expect(
      JSON.stringify(mocks.prisma.businessProduct.findFirst.mock.calls[0][0].where)
    ).toContain(WORKSPACE_A.id);
  });

  it("ignores an update that would blank the name", async () => {
    mocks.prisma.businessProduct.findFirst.mockResolvedValue({ id: "p1" });

    await business.updateProduct(CTX_A, "p1", { name: "   ", category: "Sterilisation" });

    const data = mocks.prisma.businessProduct.update.mock.calls[0][0].data;
    expect(data.name).toBeUndefined();
    expect(data.category).toBe("Sterilisation");
  });

  it("refuses to delete a product in another workspace", async () => {
    mocks.prisma.businessProduct.findFirst.mockResolvedValue(null);
    expect(await business.deleteProduct(CTX_A, "p_of_b")).toBe(false);
    expect(mocks.prisma.businessProduct.delete).not.toHaveBeenCalled();
  });
});

describe("services", () => {
  it("does not carry a keyFeatures column", async () => {
    mocks.prisma.businessService.create.mockImplementation(async ({ data }: any) => ({
      id: "s1",
      status: "active",
      ...data,
    }));

    await business.createService(CTX_A, {
      name: "Annual maintenance contract",
      // Cast: keyFeatures is deliberately absent from ServiceInput, and this
      // asserts it is stripped even if a caller smuggles it in.
      ...({ keyFeatures: ["quarterly visits"] } as any),
    });

    const data = mocks.prisma.businessService.create.mock.calls[0][0].data;
    expect(data.keyFeatures).toBeUndefined();
    expect(data.tenantId).toBe(WORKSPACE_A.id);
  });

  it("refuses to update a service in another workspace", async () => {
    mocks.prisma.businessService.findFirst.mockResolvedValue(null);
    expect(await business.updateService(CTX_A, "s_of_b", { name: "Hijacked" })).toBeNull();
    expect(mocks.prisma.businessService.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("extractBusinessKnowledge", () => {
  it("returns the extraction for review without writing anything", async () => {
    wireExtraction(extraction());

    const result = await business.extractBusinessKnowledge(CTX_A, "Company brochure text.");

    expect(result.applied).toBe(false);
    expect(result.extracted.businessName).toBe("Brightwave Instruments");
    // The approval principle: the user sees what the model concluded first.
    expect(mocks.prisma.businessProfile.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.businessProfile.update).not.toHaveBeenCalled();
    expect(mocks.prisma.businessProduct.create).not.toHaveBeenCalled();
  });

  it("passes the prompt name and version to the AI layer for provenance", async () => {
    wireExtraction(extraction());

    await business.extractBusinessKnowledge(CTX_A, "Company brochure text.");

    const options = mocks.generateStructuredOutput.mock.calls[0][1];
    expect(options.promptName).toBe("business.extraction");
    expect(options.promptVersion).toBe(1);
    expect(options.tenantId).toBe(WORKSPACE_A.id);
  });

  it("gives the model what is already known, so it can fill gaps rather than restate", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({ businessName: "Brightwave", city: "Pune" })
    );
    wireExtraction(extraction());

    await business.extractBusinessKnowledge(CTX_A, "Company brochure text.");

    const prompt = JSON.stringify(mocks.generateStructuredOutput.mock.calls[0][0].messages);
    expect(prompt).toContain("Brightwave");
    expect(prompt).toContain("Pune");
  });

  describe("when applied", () => {
    beforeEach(() => {
      mocks.prisma.businessProfile.upsert.mockImplementation(async ({ create, update }: any) =>
        profileRow({ ...create, ...update })
      );
      mocks.prisma.businessProduct.create.mockImplementation(async ({ data }: any) => ({
        id: "p_new",
        status: "active",
        ...data,
      }));
      mocks.prisma.businessService.create.mockImplementation(async ({ data }: any) => ({
        id: "s_new",
        status: "active",
        ...data,
      }));
    });

    it("fills empty scalar fields", async () => {
      wireExtraction(extraction());

      await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      const data = mocks.prisma.businessProfile.upsert.mock.calls[0][0].update;
      expect(data.businessName).toBe("Brightwave Instruments");
      expect(data.industry).toBe("Medical Equipment Manufacturing");
    });

    it("never overwrites a scalar the user already filled in", async () => {
      mocks.prisma.businessProfile.findUnique.mockResolvedValue(
        profileRow({
          businessName: "Brightwave Instruments Pvt Ltd",
          description: "A description written by hand.",
        })
      );
      wireExtraction(extraction());

      await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      const data = mocks.prisma.businessProfile.upsert.mock.calls[0][0].update;
      expect(data.businessName).toBeUndefined();
      expect(data.description).toBeUndefined();
      // Empty fields are still filled.
      expect(data.industry).toBe("Medical Equipment Manufacturing");
    });

    it("unions list fields so a second document adds to the first", async () => {
      mocks.prisma.businessProfile.findUnique.mockResolvedValue(
        profileRow({ locationsServed: JSON.stringify(["Pune"]) })
      );
      wireExtraction(extraction({ locationsServed: ["Mumbai", "Pune"] }));

      await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      const data = mocks.prisma.businessProfile.upsert.mock.calls[0][0].update;
      expect(JSON.parse(data.locationsServed)).toEqual(["Pune", "Mumbai"]);
    });

    it("leaves a list alone when the model found nothing for it", async () => {
      mocks.prisma.businessProfile.findUnique.mockResolvedValue(
        profileRow({ locationsServed: JSON.stringify(["Pune"]) })
      );
      wireExtraction(extraction({ locationsServed: [] }));

      await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      expect(
        mocks.prisma.businessProfile.upsert.mock.calls[0][0].update.locationsServed
      ).toBeUndefined();
    });

    it("records provenance and the model's own open questions", async () => {
      wireExtraction(
        extraction({ confidence: 0.55, missingInformation: ["Pricing", "Certifications"] })
      );

      await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      const data = mocks.prisma.businessProfile.update.mock.calls[0][0].data;
      expect(data.aiConfidence).toBe(0.55);
      expect(JSON.parse(data.missingInformation)).toEqual(["Pricing", "Certifications"]);
      // Lets a surprising value be traced back to the exact prompt wording.
      expect(data.lastPromptName).toBe("business.extraction");
      expect(data.lastPromptVersion).toBe(1);
      expect(data.lastExtractedAt).toBeInstanceOf(Date);
    });

    it("creates products the catalogue does not already have", async () => {
      wireExtraction(
        extraction({
          products: [
            { name: "PX-100", category: "Autoclave", description: "18 litre chamber", keyFeatures: [], idealFor: [] },
          ],
        })
      );

      const result = await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      expect(result.createdProducts).toBe(1);
      expect(mocks.prisma.businessProduct.create.mock.calls[0][0].data.tenantId).toBe(
        WORKSPACE_A.id
      );
    });

    it("does not duplicate a product that already exists, matching case-insensitively", async () => {
      mocks.prisma.businessProduct.findMany.mockResolvedValue([
        { id: "p1", name: "px-100", status: "active", keyFeatures: null, idealFor: null },
      ]);
      wireExtraction(
        extraction({
          products: [
            { name: "PX-100", category: null, description: null, keyFeatures: [], idealFor: [] },
          ],
        })
      );

      const result = await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      // Re-processing the same document must not grow the catalogue.
      expect(result.createdProducts).toBe(0);
      expect(mocks.prisma.businessProduct.create).not.toHaveBeenCalled();
    });

    it("creates services the same way", async () => {
      wireExtraction(
        extraction({ services: [{ name: "Annual maintenance", description: "Four visits" }] })
      );

      const result = await business.extractBusinessKnowledge(CTX_A, "brochure", { apply: true });

      expect(result.createdServices).toBe(1);
      expect(mocks.prisma.businessService.create.mock.calls[0][0].data.tenantId).toBe(
        WORKSPACE_A.id
      );
    });
  });
});

describe("buildBusinessContext", () => {
  it("assembles the profile with its products and services", async () => {
    mocks.prisma.businessProfile.findUnique.mockResolvedValue(
      profileRow({
        businessName: "Brightwave",
        industry: "Medical Equipment",
        uniqueSellingPoints: JSON.stringify(["36-month warranty"]),
      })
    );
    mocks.prisma.businessProduct.findMany.mockResolvedValue([
      { id: "p1", name: "PX-100", category: "Autoclave", description: "18 litres", status: "active", keyFeatures: null, idealFor: null },
    ]);
    mocks.prisma.businessService.findMany.mockResolvedValue([
      { id: "s1", name: "AMC", description: "Four visits", status: "active", idealFor: null },
    ]);

    const context = await business.buildBusinessContext(CTX_A);

    expect(context.businessName).toBe("Brightwave");
    expect(context.uniqueSellingPoints).toEqual(["36-month warranty"]);
    expect(context.products).toEqual([
      { name: "PX-100", category: "Autoclave", description: "18 litres" },
    ]);
    expect(context.services).toEqual([{ name: "AMC", description: "Four visits" }]);
  });

  it("caps the catalogue so it cannot crowd out retrieved excerpts", async () => {
    mocks.prisma.businessProduct.findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        id: `p${i}`,
        name: `Product ${i}`,
        category: null,
        description: null,
        status: "active",
        keyFeatures: null,
        idealFor: null,
      }))
    );

    expect((await business.buildBusinessContext(CTX_A)).products).toHaveLength(40);
  });

  it("only considers active products and services", async () => {
    await business.buildBusinessContext(CTX_A);
    expect(mocks.prisma.businessProduct.findMany.mock.calls[0][0].where.status).toBe("active");
    expect(mocks.prisma.businessService.findMany.mock.calls[0][0].where.status).toBe("active");
  });
});
