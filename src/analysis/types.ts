/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared type contracts for the AI Growth Intelligence layer.
 *
 * These types are additive and self-contained. They intentionally do NOT modify
 * the existing `Lead` shape — the orchestrator composes them into an optional
 * `GrowthIntelligence` block that is attached to a lead without breaking any
 * existing consumer.
 */

export type WebsiteStatus = "MISSING" | "WORKING" | "BROKEN" | "OUTDATED";
export type PresenceStatus = "ACTIVE" | "INACTIVE" | "NOT_FOUND";
export type Priority = "HOT" | "WARM" | "COLD";

/** Result of the deep website structural analysis. */
export interface WebsiteDeepAnalysis {
  reachable: boolean;
  https: boolean;
  sslValid: boolean;
  responsive: boolean;
  contactPage: boolean;
  contactForm: boolean;
  whatsappButton: boolean;
  appointmentBooking: boolean;
  navigationQuality: number; // 0-100 heuristic
  brokenLinks: number;
  brokenImages: number;
  copyrightYear: number | null;
  hasSitemap: boolean;
  hasRobotsTxt: boolean;
  loadFailed: boolean;
  status: WebsiteStatus;
}

/** Result of the SEO analysis. */
export interface SeoAnalysis {
  metaTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  openGraphTags: number;
  twitterTags: number;
  hasSchemaOrg: boolean;
  hasLocalBusinessSchema: boolean;
  googleAnalyticsPresent: boolean;
  facebookPixelPresent: boolean;
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
  seoScore: number; // 0-100
  missing: string[];
}

/** Result of the performance analysis. */
export interface PerformanceAnalysis {
  loadTimeMs: number;
  lcpEstimateMs: number;
  imagesOptimized: boolean;
  lazyLoading: boolean;
  scriptCount: number;
  cssCount: number;
  heavyAssets: number;
  performanceScore: number; // 0-100
}

/** Result of the conversion-readiness analysis. */
export interface ConversionAnalysis {
  callButton: boolean;
  whatsapp: boolean;
  stickyCta: boolean;
  appointmentBooking: boolean;
  onlinePayment: boolean;
  leadForm: boolean;
  testimonials: boolean;
  trustBadges: boolean;
  reviewsEmbedded: boolean;
  faq: boolean;
  mapsEmbedded: boolean;
  conversionScore: number; // 0-100
}

/** Result of the brand analysis. */
export interface BrandAnalysis {
  logoQuality: number; // 0-100
  brandConsistency: number; // 0-100
  typographyConsistency: number; // 0-100
  colorConsistency: number; // 0-100
  professionalAppearance: number; // 0-100
  brandScore: number; // 0-100
  strengths: string[];
  weaknesses: string[];
}

/** One social platform profile summary. */
export interface SocialProfile {
  platform: "instagram" | "facebook" | "linkedin" | "youtube" | "tiktok" | "threads";
  profileUrl: string;
  found: boolean;
  followers: number | null;
  postCount: number | null;
  lastActivity: string; // ISO date or ""
  status: PresenceStatus;
}

export interface SocialAnalysis {
  profiles: SocialProfile[];
  socialScore: number; // 0-100
}

/** Content-strategy analysis. */
export interface ContentAnalysis {
  postingFrequency: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  consistency: number; // 0-100
  missingCategories: string[];
  suggestedStrategy: string[];
}

/** Google Business Profile (GMB) analysis. */
export interface GmbAnalysis {
  description: boolean;
  primaryCategory: string;
  secondaryCategories: number;
  services: boolean;
  products: boolean;
  faqs: boolean;
  businessHours: boolean;
  photos: number;
  videos: number;
  logo: boolean;
  coverImage: boolean;
  reviewReplies: boolean;
  website: boolean;
  phone: boolean;
  bookingLink: boolean;
  messaging: boolean;
  gmbScore: number; // 0-100
}

/** Review-mining analysis. */
export interface ReviewAnalysis {
  positiveTopics: string[];
  complaints: string[];
  keywords: string[];
  sentimentSummary: string;
  suggestedImprovements: string[];
  sentimentScore: number; // 0-100
}

/** Competitor comparison. */
export interface CompetitorSummary {
  name: string;
  rating: number;
  reviews: number;
  hasWebsite: boolean;
}

export interface CompetitorAnalysis {
  competitivePosition: "LEADER" | "AVERAGE" | "LAGGING";
  strengths: string[];
  weaknesses: string[];
  topCompetitors: CompetitorSummary[];
}

/** Aggregate digital-presence scorecard. */
export interface DigitalPresenceScorecard {
  websiteScore: number;
  seoScore: number;
  performanceScore: number;
  socialScore: number;
  gmbScore: number;
  brandScore: number;
  conversionScore: number;
  overallScore: number; // 0-100
}

/** Revenue opportunity estimate. */
export interface OpportunityEstimate {
  websiteSale: number;
  seoSale: number;
  socialMediaSale: number;
  adsSale: number;
  automationSale: number;
  totalOpportunity: number;
  priority: Priority;
}

/** Structured data for building a sales proposal. */
export interface ProposalData {
  businessName: string;
  headline: string;
  currentState: string[];
  recommendedServices: { service: string; rationale: string; estimatedValue: number }[];
  estimatedTotalValue: number;
  priority: Priority;
}

/** The full growth-intelligence block attached to a lead. */
export interface GrowthIntelligence {
  website?: WebsiteDeepAnalysis;
  seo?: SeoAnalysis;
  performance?: PerformanceAnalysis;
  conversion?: ConversionAnalysis;
  brand?: BrandAnalysis;
  social?: SocialAnalysis;
  content?: ContentAnalysis;
  gmb?: GmbAnalysis;
  reviews?: ReviewAnalysis;
  competitors?: CompetitorAnalysis;
  scorecard?: DigitalPresenceScorecard;
  opportunity?: OpportunityEstimate;
  proposal?: ProposalData;
  aiInsight?: string;
  /** Names of analysis steps that failed (for observability). */
  failedSteps: string[];
  /** Total execution time of the intelligence pipeline in ms. */
  executionTimeMs: number;
  analyzedAt: string; // ISO timestamp
}

/** Minimal business context the agent needs to run its pipeline. */
export interface BusinessContext {
  businessName: string;
  category: string;
  website: string;
  rating: number;
  reviews: number;
  phone: string;
  address: string;
  lat?: number;
  lng?: number;
  // Optional pre-computed presence from the existing scraper analyzers.
  instagramUrl?: string;
  instagramStatus?: PresenceStatus;
  instagramLastPost?: string;
  facebookUrl?: string;
  facebookStatus?: PresenceStatus;
  facebookLastPost?: string;
  linkedinUrl?: string;
  linkedinStatus?: "ACTIVE" | "NOT_FOUND";
  reviewTexts?: string[];
  competitors?: CompetitorSummary[];
}
