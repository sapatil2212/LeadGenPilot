/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proposal data generator — assembles structured, presentation-ready data for
 * a sales proposal from the scorecard and opportunity estimate. Pure function.
 */

import {
  ProposalData,
  DigitalPresenceScorecard,
  OpportunityEstimate,
  WebsiteDeepAnalysis,
  SeoAnalysis,
  ConversionAnalysis,
} from "./types";
import { PRICE_BOOK } from "./opportunityEstimator";

export interface ProposalInputs {
  businessName: string;
  scorecard: DigitalPresenceScorecard;
  opportunity: OpportunityEstimate;
  website?: WebsiteDeepAnalysis;
  seo?: SeoAnalysis;
  conversion?: ConversionAnalysis;
}

export function generateProposalData(inputs: ProposalInputs): ProposalData {
  const { businessName, scorecard, opportunity, website, seo, conversion } = inputs;

  const currentState: string[] = [];
  currentState.push(`Overall digital presence: ${scorecard.overallScore}/100`);
  if (website) currentState.push(`Website: ${website.status.toLowerCase()} (health ${scorecard.websiteScore}/100)`);
  currentState.push(`SEO: ${scorecard.seoScore}/100`);
  currentState.push(`Social: ${scorecard.socialScore}/100`);
  currentState.push(`Google Business: ${scorecard.gmbScore}/100`);
  currentState.push(`Conversion readiness: ${scorecard.conversionScore}/100`);

  const recommendedServices: ProposalData["recommendedServices"] = [];
  if (opportunity.websiteSale) {
    recommendedServices.push({
      service: opportunity.websiteSale >= PRICE_BOOK.websiteBuild ? "New Website" : "Website Redesign",
      rationale:
        !website || website.status === "MISSING"
          ? "No functional website to capture local search demand."
          : "Existing site is outdated and underperforming on mobile/SEO.",
      estimatedValue: opportunity.websiteSale,
    });
  }
  if (opportunity.seoSale) {
    recommendedServices.push({
      service: "Local SEO",
      rationale: `SEO score is ${scorecard.seoScore}/100${
        seo && seo.missing.length ? `; missing: ${seo.missing.slice(0, 4).join(", ")}` : ""
      }.`,
      estimatedValue: opportunity.seoSale,
    });
  }
  if (opportunity.socialMediaSale) {
    recommendedServices.push({
      service: "Social Media Management",
      rationale: `Social presence score is only ${scorecard.socialScore}/100.`,
      estimatedValue: opportunity.socialMediaSale,
    });
  }
  if (opportunity.adsSale) {
    recommendedServices.push({
      service: "Paid Advertising",
      rationale: "Good reputation but weak conversion funnel — ready to scale with ads.",
      estimatedValue: opportunity.adsSale,
    });
  }
  if (opportunity.automationSale) {
    const missing: string[] = [];
    if (!conversion?.whatsapp) missing.push("WhatsApp");
    if (!conversion?.appointmentBooking) missing.push("online booking");
    if (!conversion?.leadForm) missing.push("lead capture");
    recommendedServices.push({
      service: "Automation & Lead Capture",
      rationale: `Missing ${missing.join(", ") || "key automation"}.`,
      estimatedValue: opportunity.automationSale,
    });
  }

  const headline =
    opportunity.priority === "HOT"
      ? `${businessName}: high-impact growth opportunity`
      : opportunity.priority === "WARM"
      ? `${businessName}: clear room to grow online`
      : `${businessName}: fine-tune an already-solid presence`;

  return {
    businessName,
    headline,
    currentState,
    recommendedServices,
    estimatedTotalValue: opportunity.totalOpportunity,
    priority: opportunity.priority,
  };
}
