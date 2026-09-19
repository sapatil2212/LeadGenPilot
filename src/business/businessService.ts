/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business profile, products and services.
 *
 * Every function takes a TenantContext and scopes by it, matching the pattern
 * established in src/tenancy/repository.ts: there is no function here that
 * accepts a bare id, so a route handler cannot read or write another
 * workspace's business data even by mistake.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import type { TenantContext } from "../tenancy/context";
import { generateStructuredOutput } from "../ai/aiService";
import {
  businessExtractionPrompt,
  validateBusinessExtraction,
  promptRef,
  type BusinessExtractionOutput,
} from "../prompts";

/**
 * Length caps. These fields are rendered in the dashboard and injected into
 * prompts, so unbounded text is both a storage concern and a way to crowd out
 * the rest of a prompt's context.
 */
const LIMITS = {
  name: 300,
  shortText: 500,
  description: 6000,
  listItem: 300,
  listLength: 50,
  value: 4000,
} as const;

function trimTo(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * JSON-encodes a string array column, or null for "not set".
 *
 * Distinguishing null from [] matters: null means the tenant has not told us,
 * while [] means they told us there are none. The assistant should ask in the
 * first case and not in the second.
 */
function encodeList(value: unknown): string | null | undefined {
  if (value === undefined) return undefined; // field absent from the patch
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((v) => trimTo(v, LIMITS.listItem))
    .filter((v): v is string => !!v)
    .slice(0, LIMITS.listLength);
  return JSON.stringify(cleaned);
}

function decodeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessProfileView {
  businessName: string | null;
  industry: string | null;
  businessType: string | null;
  website: string | null;
  description: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locationsServed: string[];
  targetCustomerTypes: string[];
  targetIndustries: string[];
  uniqueSellingPoints: string[];
  certifications: string[];
  decisionMakerRoles: string[];
  brandVoice: string | null;
  salesObjectives: string | null;
  aiConfidence: number | null;
  missingInformation: string[];
  lastExtractedAt: Date | null;
  /** Rough 0-100 measure of how much has been filled in. */
  completeness: number;
}

/** Fields that make the profile useful to later phases, and their weights. */
const COMPLETENESS_FIELDS: { has: (p: BusinessProfileView) => boolean; weight: number }[] = [
  { has: (p) => !!p.businessName, weight: 10 },
  { has: (p) => !!p.industry, weight: 10 },
  { has: (p) => !!p.businessType, weight: 5 },
  { has: (p) => !!p.description, weight: 15 },
  { has: (p) => p.targetCustomerTypes.length > 0, weight: 20 },
  { has: (p) => p.locationsServed.length > 0, weight: 15 },
  { has: (p) => p.uniqueSellingPoints.length > 0, weight: 15 },
  { has: (p) => p.decisionMakerRoles.length > 0, weight: 10 },
];

function toProfileView(row: any | null): BusinessProfileView {
  const view: BusinessProfileView = {
    businessName: row?.businessName ?? null,
    industry: row?.industry ?? null,
    businessType: row?.businessType ?? null,
    website: row?.website ?? null,
    description: row?.description ?? null,
    country: row?.country ?? null,
    state: row?.state ?? null,
    city: row?.city ?? null,
    contactEmail: row?.contactEmail ?? null,
    contactPhone: row?.contactPhone ?? null,
    locationsServed: decodeList(row?.locationsServed),
    targetCustomerTypes: decodeList(row?.targetCustomerTypes),
    targetIndustries: decodeList(row?.targetIndustries),
    uniqueSellingPoints: decodeList(row?.uniqueSellingPoints),
    certifications: decodeList(row?.certifications),
    decisionMakerRoles: decodeList(row?.decisionMakerRoles),
    brandVoice: row?.brandVoice ?? null,
    salesObjectives: row?.salesObjectives ?? null,
    aiConfidence: row?.aiConfidence ?? null,
    missingInformation: decodeList(row?.missingInformation),
    lastExtractedAt: row?.lastExtractedAt ?? null,
    completeness: 0,
  };

  view.completeness = COMPLETENESS_FIELDS.reduce(
    (sum, f) => sum + (f.has(view) ? f.weight : 0),
    0
  );
  return view;
}

export async function getBusinessProfile(ctx: TenantContext): Promise<BusinessProfileView> {
  const row = await prisma.businessProfile.findUnique({ where: { tenantId: ctx.tenantId } });
  return toProfileView(row);
}

export interface BusinessProfilePatch {
  businessName?: string | null;
  industry?: string | null;
  businessType?: string | null;
  website?: string | null;
  description?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  locationsServed?: string[] | null;
  targetCustomerTypes?: string[] | null;
  targetIndustries?: string[] | null;
  uniqueSellingPoints?: string[] | null;
  certifications?: string[] | null;
  decisionMakerRoles?: string[] | null;
  brandVoice?: string | null;
  salesObjectives?: string | null;
}

/** Builds a Prisma data object containing only the keys actually supplied. */
function profileData(patch: BusinessProfilePatch): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const text = (key: keyof BusinessProfilePatch, max: number) => {
    if (patch[key] !== undefined) data[key] = trimTo(patch[key], max);
  };

  text("businessName", LIMITS.name);
  text("industry", LIMITS.shortText);
  text("businessType", LIMITS.shortText);
  text("website", LIMITS.shortText);
  text("description", LIMITS.description);
  text("country", LIMITS.shortText);
  text("state", LIMITS.shortText);
  text("city", LIMITS.shortText);
  text("contactEmail", LIMITS.shortText);
  text("contactPhone", LIMITS.shortText);
  text("brandVoice", LIMITS.shortText);
  text("salesObjectives", LIMITS.description);

  for (const key of [
    "locationsServed",
    "targetCustomerTypes",
    "targetIndustries",
    "uniqueSellingPoints",
    "certifications",
    "decisionMakerRoles",
  ] as const) {
    const encoded = encodeList(patch[key]);
    if (encoded !== undefined) data[key] = encoded;
  }

  return data;
}

/**
 * Creates or updates the workspace's profile.
 *
 * An upsert because the profile is conceptually part of the workspace: the row
 * simply may not exist yet, and a caller should not have to care.
 */
export async function updateBusinessProfile(
  ctx: TenantContext,
  patch: BusinessProfilePatch
): Promise<BusinessProfileView> {
  const data = profileData(patch);
  const row = await prisma.businessProfile.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, ...data },
    update: data,
  });
  return toProfileView(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Products and services
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductView {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  keyFeatures: string[];
  idealFor: string[];
  priceRange: string | null;
  status: string;
}

function toProductView(row: any): ProductView {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    description: row.description ?? null,
    keyFeatures: decodeList(row.keyFeatures),
    idealFor: decodeList(row.idealFor),
    priceRange: row.priceRange ?? null,
    status: row.status,
  };
}

export interface ProductInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  keyFeatures?: string[] | null;
  idealFor?: string[] | null;
  priceRange?: string | null;
  status?: string;
}

function productData(input: ProductInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = trimTo(input.name, LIMITS.name);
  if (input.category !== undefined) data.category = trimTo(input.category, LIMITS.shortText);
  if (input.description !== undefined) data.description = trimTo(input.description, LIMITS.description);
  if (input.priceRange !== undefined) data.priceRange = trimTo(input.priceRange, LIMITS.shortText);
  if (input.status !== undefined) {
    data.status = input.status === "archived" ? "archived" : "active";
  }
  const features = encodeList(input.keyFeatures);
  if (features !== undefined) data.keyFeatures = features;
  const idealFor = encodeList(input.idealFor);
  if (idealFor !== undefined) data.idealFor = idealFor;
  return data;
}

export async function listProducts(ctx: TenantContext, includeArchived = false): Promise<ProductView[]> {
  const rows = await prisma.businessProduct.findMany({
    where: { tenantId: ctx.tenantId, ...(includeArchived ? {} : { status: "active" }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toProductView);
}

export async function createProduct(ctx: TenantContext, input: ProductInput): Promise<ProductView> {
  const name = trimTo(input.name, LIMITS.name);
  if (!name) throw new Error("Product name is required.");
  const row = await prisma.businessProduct.create({
    data: { tenantId: ctx.tenantId, ...productData(input), name },
  });
  return toProductView(row);
}

export async function updateProduct(
  ctx: TenantContext,
  productId: string,
  input: ProductInput
): Promise<ProductView | null> {
  const owned = await prisma.businessProduct.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return null;

  const data = productData(input);
  // An update that blanks the name would leave an unusable row.
  if ("name" in data && !data.name) delete data.name;

  const row = await prisma.businessProduct.update({ where: { id: owned.id }, data });
  return toProductView(row);
}

export async function deleteProduct(ctx: TenantContext, productId: string): Promise<boolean> {
  const owned = await prisma.businessProduct.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  await prisma.businessProduct.delete({ where: { id: owned.id } });
  return true;
}

export interface ServiceView {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  idealFor: string[];
  priceRange: string | null;
  status: string;
}

function toServiceView(row: any): ServiceView {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    description: row.description ?? null,
    idealFor: decodeList(row.idealFor),
    priceRange: row.priceRange ?? null,
    status: row.status,
  };
}

export type ServiceInput = Omit<ProductInput, "keyFeatures">;

function serviceData(input: ServiceInput): Record<string, unknown> {
  const data = productData(input as ProductInput);
  delete data.keyFeatures;
  return data;
}

export async function listServices(ctx: TenantContext, includeArchived = false): Promise<ServiceView[]> {
  const rows = await prisma.businessService.findMany({
    where: { tenantId: ctx.tenantId, ...(includeArchived ? {} : { status: "active" }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toServiceView);
}

export async function createService(ctx: TenantContext, input: ServiceInput): Promise<ServiceView> {
  const name = trimTo(input.name, LIMITS.name);
  if (!name) throw new Error("Service name is required.");
  const row = await prisma.businessService.create({
    data: { tenantId: ctx.tenantId, ...serviceData(input), name },
  });
  return toServiceView(row);
}

export async function updateService(
  ctx: TenantContext,
  serviceId: string,
  input: ServiceInput
): Promise<ServiceView | null> {
  const owned = await prisma.businessService.findFirst({
    where: { id: serviceId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return null;

  const data = serviceData(input);
  if ("name" in data && !data.name) delete data.name;

  const row = await prisma.businessService.update({ where: { id: owned.id }, data });
  return toServiceView(row);
}

export async function deleteService(ctx: TenantContext, serviceId: string): Promise<boolean> {
  const owned = await prisma.businessService.findFirst({
    where: { id: serviceId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!owned) return false;
  await prisma.businessService.delete({ where: { id: owned.id } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-assisted extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  extracted: BusinessExtractionOutput;
  applied: boolean;
  createdProducts: number;
  createdServices: number;
}

/**
 * Turns free text about the business into structured fields.
 *
 * `apply` decides whether the result is written or only returned for review.
 * Defaulting to review is the point of the platform's approval principle: the
 * user should see what the model concluded before it becomes the factual basis
 * for outreach sent in their name.
 *
 * Writes never overwrite a field the user has already filled in — extraction
 * fills gaps. A model summarising a brochure should not quietly replace a
 * description someone wrote by hand.
 */
export async function extractBusinessKnowledge(
  ctx: TenantContext,
  sourceText: string,
  options: { apply?: boolean; sourceDocumentId?: string } = {}
): Promise<ExtractionResult> {
  const existing = await getBusinessProfile(ctx);

  const { value, result } = await generateStructuredOutput<BusinessExtractionOutput>(
    {
      messages: businessExtractionPrompt.build({
        sourceText: sourceText.slice(0, 60_000),
        known: {
          businessName: existing.businessName,
          industry: existing.industry,
          businessType: existing.businessType,
          website: existing.website,
          country: existing.country,
          city: existing.city,
        },
      }),
      timeoutMs: 60_000,
    },
    {
      operation: "business.extraction",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      validate: validateBusinessExtraction,
      ...promptRef(businessExtractionPrompt),
    }
  );

  if (!options.apply) {
    return { extracted: value, applied: false, createdProducts: 0, createdServices: 0 };
  }

  // Scalars: fill only what is currently empty.
  const patch: BusinessProfilePatch = {};
  if (!existing.businessName && value.businessName) patch.businessName = value.businessName;
  if (!existing.industry && value.industry) patch.industry = value.industry;
  if (!existing.businessType && value.businessType) patch.businessType = value.businessType;
  if (!existing.description && value.description) patch.description = value.description;
  if (!existing.brandVoice && value.brandVoice) patch.brandVoice = value.brandVoice;

  // Lists: union, so a second document adds to what the first found.
  const mergeList = (current: string[], incoming: string[]) =>
    Array.from(new Set([...current, ...incoming])).slice(0, LIMITS.listLength);

  if (value.locationsServed.length) {
    patch.locationsServed = mergeList(existing.locationsServed, value.locationsServed);
  }
  if (value.targetCustomerTypes.length) {
    patch.targetCustomerTypes = mergeList(existing.targetCustomerTypes, value.targetCustomerTypes);
  }
  if (value.targetIndustries.length) {
    patch.targetIndustries = mergeList(existing.targetIndustries, value.targetIndustries);
  }
  if (value.uniqueSellingPoints.length) {
    patch.uniqueSellingPoints = mergeList(existing.uniqueSellingPoints, value.uniqueSellingPoints);
  }
  if (value.certifications.length) {
    patch.certifications = mergeList(existing.certifications, value.certifications);
  }
  if (value.decisionMakerRoles.length) {
    patch.decisionMakerRoles = mergeList(existing.decisionMakerRoles, value.decisionMakerRoles);
  }

  await updateBusinessProfile(ctx, patch);

  // Provenance and the model's own open questions.
  await prisma.businessProfile.update({
    where: { tenantId: ctx.tenantId },
    data: {
      aiConfidence: value.confidence,
      missingInformation: JSON.stringify(value.missingInformation.slice(0, 20)),
      lastExtractedAt: new Date(),
      lastPromptName: businessExtractionPrompt.name,
      lastPromptVersion: businessExtractionPrompt.version,
    },
  });

  // Products and services: add new names only, matched case-insensitively, so
  // re-processing a document does not duplicate the catalogue.
  const [currentProducts, currentServices] = await Promise.all([
    listProducts(ctx, true),
    listServices(ctx, true),
  ]);
  const productNames = new Set(currentProducts.map((p) => p.name.toLowerCase()));
  const serviceNames = new Set(currentServices.map((s) => s.name.toLowerCase()));

  let createdProducts = 0;
  for (const product of value.products) {
    if (productNames.has(product.name.toLowerCase())) continue;
    await createProduct(ctx, {
      name: product.name,
      category: product.category,
      description: product.description,
      keyFeatures: product.keyFeatures,
      idealFor: product.idealFor,
    });
    productNames.add(product.name.toLowerCase());
    createdProducts++;
  }

  let createdServices = 0;
  for (const service of value.services) {
    if (serviceNames.has(service.name.toLowerCase())) continue;
    await createService(ctx, { name: service.name, description: service.description });
    serviceNames.add(service.name.toLowerCase());
    createdServices++;
  }

  logger.info(
    `Business extraction applied for workspace ${ctx.tenantId} via ${result.provider}: ` +
      `+${createdProducts} product(s), +${createdServices} service(s).`
  );

  return { extracted: value, applied: true, createdProducts, createdServices };
}

/**
 * Assembles the business context the AI layer injects into prompts.
 *
 * Capped at 40 products and services: a large catalogue would otherwise crowd
 * out the retrieved document excerpts, which are usually the more specific and
 * more useful half of the context.
 */
export async function buildBusinessContext(ctx: TenantContext) {
  const [profile, products, services] = await Promise.all([
    getBusinessProfile(ctx),
    listProducts(ctx),
    listServices(ctx),
  ]);

  return {
    businessName: profile.businessName,
    industry: profile.industry,
    businessType: profile.businessType,
    description: profile.description,
    locationsServed: profile.locationsServed,
    uniqueSellingPoints: profile.uniqueSellingPoints,
    targetCustomerTypes: profile.targetCustomerTypes,
    products: products.slice(0, 40).map((p) => ({
      name: p.name,
      category: p.category,
      description: p.description,
    })),
    services: services.slice(0, 40).map((s) => ({ name: s.name, description: s.description })),
  };
}
