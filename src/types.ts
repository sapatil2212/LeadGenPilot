/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Lead {
  // CRM DB fields (populated when lead comes from DB)
  id?: string;
  listId?: string;
  notes?: string;

  businessName: string;
  phone: string;
  address: string;
  rating: number;
  reviews: number;
  website: string;
  mapsUrl: string;
  category: string;
  websiteMissing: boolean;
  leadScore: number;
  dateAdded: string;
  sheetName?: string;

  // Digital Presence fields
  websiteStatus: "MISSING" | "WORKING" | "BROKEN" | "OUTDATED";
  instagramUrl: string;
  instagramStatus: "NOT_FOUND" | "ACTIVE" | "INACTIVE";
  instagramLastPost: string;
  facebookUrl: string;
  facebookStatus: "NOT_FOUND" | "ACTIVE" | "INACTIVE";
  facebookLastPost: string;
  whatsappPresent: boolean;
  appointmentSystem: boolean;
  leadPriority: "HOT" | "WARM" | "COLD";
  aiInsight: string;

  // Expanded Auditing fields
  emails: string[];
  linkedinUrl: string;
  linkedinStatus: "NOT_FOUND" | "ACTIVE";
  googleAnalyticsPresent: boolean;
  metaPixelPresent: boolean;

  // Outreach tracking fields
  emailStatus?: "PENDING" | "SENT" | "FAILED";
  whatsappStatus?: "PENDING" | "SENT" | "FAILED";
  emailSentDate?: string;
  whatsappSentDate?: string;
  lat?: number;
  lng?: number;

  // Conversation lifecycle: set to REPLIED once the lead replies to outreach.
  conversationStatus?: "AWAITING_REPLY" | "REPLIED" | "CLOSED";

  // ── Score provenance (Phase 4) ──
  // `leadScore` on its own cannot be read as a proportion or compared against a
  // lead scored under different weights. These say what it was out of, which
  // rules fired, and which version of which rule set produced it.
  scoreMax?: number;
  scoreBreakdown?: { signal: string; label: string; points: number }[];
  scoringRuleSetId?: string;
  scoringVersion?: number;

  // ── ICP fit (Phase 4) ──
  // Whether this is the right kind of customer, which is a different question
  // from how much opportunity it represents.
  icpProfileId?: string;
  icpFitScore?: number;
  icpFitReason?: string;

  // ── AI Growth Intelligence fields (optional, additive) ──
  // Populated only when deep analysis is enabled. All optional so existing
  // consumers and the CRM/DB mapping remain fully backward compatible.
  websiteScore?: number;
  seoScore?: number;
  performanceScore?: number;
  socialScore?: number;
  brandScore?: number;
  conversionScore?: number;
  gmbScore?: number;
  digitalPresenceScore?: number;
  opportunityScore?: number;
  youtubeStatus?: "ACTIVE" | "INACTIVE" | "NOT_FOUND";
  youtubeUrl?: string;
  /** Full structured growth-intelligence result (see src/analysis/types.ts). */
  growthIntelligence?: import("./analysis/types").GrowthIntelligence;
}

/** A named collection of leads from one scrape session */
export interface LeadList {
  id: string;
  name: string;
  businessType: string;
  location: string;
  scrapedAt: string;
  createdAt: string;
  leadCount: number;
}

export interface Config {
  /**
   * Legacy single-field targeting, kept for the CLI entry point and for
   * displaying what a run searched for.
   *
   * `categories` and `locations` below are the real inputs: a workspace targets
   * several kinds of business across several places, which one comma-separated
   * string could only express by guessing where the boundaries were.
   */
  businessType: string;
  location: string;
  maxResults: number;
  enableSimulation: boolean;
  headless: boolean;
  lat?: number;
  lng?: number;
  radius?: number;
  /** Enable the AI Growth Intelligence deep-analysis pipeline (opt-in). */
  enableDeepAnalysis?: boolean;
  /** Also discover YouTube/TikTok/Threads during deep analysis (extra tabs). */
  deepAnalysisExtraSocial?: boolean;

  // ── ICP-derived targeting (Phase 4) ──
  /** Business kinds to search for, each stated in full. */
  categories?: string[];
  /** Places to search. Every category is searched in every location. */
  locations?: string[];
  /** Categories a search for the above would wrongly return. */
  excludeCategories?: string[];
  excludeKeywords?: string[];
  /** Reputation floor, applied before any analyzer runs. */
  minRating?: number | null;
  minReviews?: number | null;
  /** The profile this run came from, recorded on the lead list and the leads. */
  icpProfileId?: string | null;
}
