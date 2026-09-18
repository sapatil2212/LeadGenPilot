/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI insight generator (growth intelligence).
 *
 * Produces a concise, sales-ready paragraph summarizing the biggest gaps and
 * the recommended pitch. It first tries the existing LLM-backed
 * `generateSalesInsight` (OpenRouter → Gemini) and, on any failure, falls back
 * to a deterministic rule-based summary built from the scorecard + opportunity.
 * This keeps the pipeline resilient and never blocks on the LLM.
 */

import {
  DigitalPresenceScorecard,
  OpportunityEstimate,
  WebsiteDeepAnalysis,
  SocialAnalysis,
  ReviewAnalysis,
} from "./types";
import { generateSalesInsight } from "../aiInsights";
import { logger } from "../logger";

export interface InsightInputs {
  businessName: string;
  category: string;
  rating: number;
  reviews: number;
  website: string;
  scorecard: DigitalPresenceScorecard;
  opportunity: OpportunityEstimate;
  websiteAnalysis?: WebsiteDeepAnalysis;
  social?: SocialAnalysis;
  reviews_analysis?: ReviewAnalysis;
  // Pre-resolved presence for the LLM prompt (reuses existing analyzer output).
  instagramStatus?: string;
  facebookStatus?: string;
  linkedinStatus?: string;
  whatsappPresent?: boolean;
  appointmentSystem?: boolean;
}

export async function generateGrowthInsight(inputs: InsightInputs): Promise<string> {
  try {
    const insight = await generateSalesInsight({
      businessName: inputs.businessName,
      category: inputs.category,
      rating: inputs.rating,
      reviews: inputs.reviews,
      website: inputs.website,
      websiteStatus: inputs.websiteAnalysis?.status ?? (inputs.website ? "WORKING" : "MISSING"),
      instagramStatus: inputs.instagramStatus ?? "NOT_FOUND",
      facebookStatus: inputs.facebookStatus ?? "NOT_FOUND",
      linkedinStatus: inputs.linkedinStatus ?? "NOT_FOUND",
      whatsappPresent: !!inputs.whatsappPresent,
      appointmentSystem: !!inputs.appointmentSystem,
      leadScore: inputs.scorecard.overallScore,
      leadPriority: inputs.opportunity.priority,
    });
    if (insight && insight.trim()) return insight.trim();
  } catch (err: any) {
    logger.warn(`Growth insight LLM step failed (non-fatal): ${err?.message || err}`);
  }
  return ruleBasedGrowthInsight(inputs);
}

/** Deterministic one-paragraph sales briefing. */
export function ruleBasedGrowthInsight(inputs: InsightInputs): string {
  const { scorecard, opportunity } = inputs;
  const parts: string[] = [];

  parts.push(`${inputs.businessName} has an overall digital presence score of ${scorecard.overallScore}/100.`);

  if (inputs.rating >= 4.3 && inputs.reviews >= 30) {
    parts.push(`Reputation is strong (${inputs.rating}★ across ${inputs.reviews} reviews)`);
  } else if (inputs.reviews > 0) {
    parts.push(`Reputation is modest (${inputs.rating}★, ${inputs.reviews} reviews)`);
  }

  const gaps: string[] = [];
  const ws = inputs.websiteAnalysis?.status;
  if (!inputs.website || ws === "MISSING") gaps.push("no website");
  else if (ws === "BROKEN") gaps.push("a broken website");
  else if (ws === "OUTDATED" || scorecard.websiteScore < 60) gaps.push("an outdated website");
  if (scorecard.seoScore < 60) gaps.push("weak local SEO");
  if (scorecard.socialScore < 50) gaps.push("thin social media activity");
  if (scorecard.conversionScore < 55) gaps.push("few conversion elements (no WhatsApp/booking)");

  if (gaps.length) parts.push(`but ${joinList(gaps)}`);

  const pitches: string[] = [];
  if (opportunity.websiteSale) pitches.push(opportunity.websiteSale >= 30000 ? "a new website" : "a website redesign");
  if (opportunity.seoSale) pitches.push("local SEO");
  if (opportunity.socialMediaSale) pitches.push("social media management");
  if (opportunity.adsSale) pitches.push("paid ads");
  if (opportunity.automationSale) pitches.push("WhatsApp/booking automation");

  if (pitches.length) {
    parts.push(
      `Strong candidate for ${joinList(pitches)} — estimated opportunity ₹${opportunity.totalOpportunity.toLocaleString(
        "en-IN"
      )} (${opportunity.priority}).`
    );
  } else {
    parts.push("Digital presence is solid; focus on retention and reputation upkeep.");
  }

  return parts.join(" ").replace(/\s+([.,])/g, "$1");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}
