/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Opportunity estimator — turns the digital-presence gaps into an estimated
 * revenue opportunity per service line and an overall priority. Values are in
 * INR and configurable via the price book below.
 */

import { DigitalPresenceScorecard, OpportunityEstimate, Priority, WebsiteDeepAnalysis, ConversionAnalysis } from "./types";

/** Indicative service price book (INR). Tune to your market. */
export const PRICE_BOOK = {
  websiteBuild: 35000,
  websiteRedesign: 20000,
  seoRetainerAnnual: 60000,
  socialMediaAnnual: 48000,
  adsSetupAndManageAnnual: 72000,
  automationSetup: 25000,
};

export interface OpportunityInputs {
  scorecard: DigitalPresenceScorecard;
  website?: WebsiteDeepAnalysis;
  conversion?: ConversionAnalysis;
}

export function estimateOpportunity(inputs: OpportunityInputs): OpportunityEstimate {
  const { scorecard, website, conversion } = inputs;

  // Website sale: full build if missing/broken, redesign if weak/outdated.
  let websiteSale = 0;
  if (!website || website.loadFailed || website.status === "BROKEN" || website.status === "MISSING") {
    websiteSale = PRICE_BOOK.websiteBuild;
  } else if (website.status === "OUTDATED" || scorecard.websiteScore < 60) {
    websiteSale = PRICE_BOOK.websiteRedesign;
  }

  // SEO sale: proportional to how poor SEO is.
  const seoSale = scorecard.seoScore < 70 ? PRICE_BOOK.seoRetainerAnnual : 0;

  // Social sale: weak social presence.
  const socialMediaSale = scorecard.socialScore < 60 ? PRICE_BOOK.socialMediaAnnual : 0;

  // Ads sale: strong reputation but weak funnel = good ads candidate.
  const adsSale = scorecard.gmbScore >= 40 && scorecard.conversionScore < 60 ? PRICE_BOOK.adsSetupAndManageAnnual : 0;

  // Automation sale: missing WhatsApp / booking / lead capture.
  const missingAutomation =
    !conversion || !conversion.whatsapp || !conversion.appointmentBooking || !conversion.leadForm;
  const automationSale = missingAutomation ? PRICE_BOOK.automationSetup : 0;

  const totalOpportunity = websiteSale + seoSale + socialMediaSale + adsSale + automationSale;

  // Priority: lower overall presence + higher opportunity = hotter.
  let priority: Priority = "COLD";
  if (scorecard.overallScore < 45 || totalOpportunity >= 120000) priority = "HOT";
  else if (scorecard.overallScore < 70 || totalOpportunity >= 60000) priority = "WARM";

  return { websiteSale, seoSale, socialMediaSale, adsSale, automationSale, totalOpportunity, priority };
}
