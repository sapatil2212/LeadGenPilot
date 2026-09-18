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
}
