/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead digital-presence audit insight.
 *
 * Lifted verbatim from the inline template literal that used to live in
 * src/aiInsights.ts, so output is unchanged apart from the grounding preamble
 * every prompt now carries.
 */

import type { AiMessage } from "../ai/types";
import { withGrounding, type PromptDefinition } from "./types";

export interface LeadInsightInput {
  businessName: string;
  rating: number;
  reviews: number;
  websiteStatus: string;
  instagramStatus: string;
  facebookStatus: string;
  whatsappPresent: boolean;
  appointmentSystem: boolean;
  leadScore: number;
  leadPriority: string;
  emails?: string[];
  linkedinStatus?: string;
  googleAnalyticsPresent?: boolean;
  metaPixelPresent?: boolean;
  instagramLastPost?: string;
  facebookLastPost?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  website?: string;
  category?: string;
  /**
   * Denominator for the score shown to the model.
   *
   * Defaults to 200 to preserve existing output exactly. It is a parameter
   * because 200 is wrong: the current scorer's reachable maximum is 170, so a
   * genuinely hot lead is presented to the model as roughly 50-60% rather than
   * 70-90%. Phase 4 replaces the hardcoded scorer with a configurable rule set
   * and will pass that rule set's real maximum here.
   */
  scoreDenominator?: number;
}

export const leadInsightPrompt: PromptDefinition<LeadInsightInput> = {
  name: "lead.insight",
  version: 1,
  description:
    "Digital-presence audit summary and improvement recommendations for a scraped lead. " +
    "Migrated unchanged from src/aiInsights.ts.",

  build(lead: LeadInsightInput): AiMessage[] {
    const currentDate = new Date().toISOString().split("T")[0];
    const denominator = lead.scoreDenominator ?? 200;

    const user = `Perform a comprehensive digital presence audit and create improvement insights for the business '${lead.businessName}'.
Analyze all of the following digital presence audit metrics:
- Business Category: ${lead.category || "Local Business"}
- Google Maps Rating: ${lead.rating} (${lead.reviews} reviews)
- Website Status: ${lead.websiteStatus} (Website URL: ${lead.website || "None"})
- Instagram Status: ${lead.instagramStatus} (URL: ${lead.instagramUrl || "None"}, Last Post Date: ${lead.instagramLastPost || "None"})
- Facebook Status: ${lead.facebookStatus} (URL: ${lead.facebookUrl || "None"}, Last Post Date: ${lead.facebookLastPost || "None"})
- LinkedIn Status: ${lead.linkedinStatus || "NOT_FOUND"} (URL: ${lead.linkedinUrl || "None"})
- Emails Found: ${lead.emails && lead.emails.length > 0 ? lead.emails.join(", ") : "None"}
- WhatsApp Chat Button on Site: ${lead.whatsappPresent ? "Present" : "Missing"}
- Online Booking System: ${lead.appointmentSystem ? "Present" : "Missing"}
- Google Analytics (GA4): ${lead.googleAnalyticsPresent ? "Present" : "Missing"}
- Meta Pixel: ${lead.metaPixelPresent ? "Present" : "Missing"}
- Digital Presence Score: ${lead.leadScore}/${denominator} (Priority: ${lead.leadPriority})
- Current Date: ${currentDate}

Audit Formatting Instructions:
1. **Summary Audit Draft**: Start the output with a single paragraph summarizing their current assets and activity. Use phrases like "Having website!", "Having instagram account but X months since last posted", "Fb account is active/inactive but Y months since last posted", etc. Compute the time differences between the Current Date (${currentDate}) and their last post dates.
2. **Business Improvement Recommendations**: Provide a detailed list of actionable suggestions explaining how they can grow their business and improve their digital presence (e.g. website creation/redesign, booking automation, pixel tracking, social media active posting). Keep the tone helpful, professional, and business-focused. Do not use placeholders or markdown bolding. Keep the whole audit under 150 words.`;

    return [
      withGrounding(
        "You produce concise, factual digital-presence audits. Report only what the supplied " +
          "metrics show; never assert a detail that is not listed."
      ),
      { role: "user", content: user },
    ];
  },
};
