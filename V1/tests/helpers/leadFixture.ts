/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Lead fixture builder for the characterization test suite.
 *
 * Defaults describe the "best possible" lead from the current agency-centric
 * scoring model's point of view: a working website with every tracking pixel,
 * contact channel and social profile present. That means the baseline lead
 * scores 0, so each test can add exactly one gap and assert its weight in
 * isolation.
 */

import type { Lead } from "../../src/types";

export function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    businessName: "Acme Diagnostics",
    phone: "+91 98765 43210",
    address: "12 MG Road, Pune, Maharashtra 411001",
    rating: 4.0,
    reviews: 50,
    website: "https://acme-diagnostics.example",
    mapsUrl: "https://maps.google.com/?cid=acme",
    category: "Diagnostic Center",
    websiteMissing: false,
    leadScore: 0,
    dateAdded: "2026-01-01",

    websiteStatus: "WORKING",
    instagramUrl: "https://instagram.com/acme",
    instagramStatus: "ACTIVE",
    instagramLastPost: "2026-01-01",
    facebookUrl: "https://facebook.com/acme",
    facebookStatus: "ACTIVE",
    facebookLastPost: "2026-01-01",
    whatsappPresent: true,
    appointmentSystem: true,
    leadPriority: "COLD",
    aiInsight: "",

    emails: ["contact@acme-diagnostics.example"],
    linkedinUrl: "https://linkedin.com/company/acme",
    linkedinStatus: "ACTIVE",
    googleAnalyticsPresent: true,
    metaPixelPresent: true,

    ...overrides,
  };
}
