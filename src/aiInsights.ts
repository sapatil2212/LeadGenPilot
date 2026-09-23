/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from "./logger";
import { generateText } from "./ai/aiService";
import { leadInsightPrompt, promptRef } from "./prompts";
import type { AiProviderId } from "./ai/types";

export interface InsightOptions {
  tenantId?: string;
  userId?: string;
  preferredProvider?: AiProviderId | null;
}

export async function generateSalesInsight(lead: {
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
  /**
   * The achievable maximum of the rule set that produced `leadScore`.
   *
   * Required for the score to mean anything to the model. Until Phase 4 no
   * caller could supply it — this parameter did not exist — so the prompt used
   * its 200 default while the only scorer in the product topped out at 170.
   * Every lead was therefore described as roughly 15% weaker than it was, and a
   * maximally-underserved business read as 85% rather than 100%.
   */
  scoreDenominator?: number;
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
}, options?: InsightOptions): Promise<string> {
  /*
   * Provider selection, retry, timeout and fallback now live in the AI service,
   * and the prompt lives in the registry. This function keeps only what is
   * specific to lead insights: the input mapping and the deterministic
   * rule-based fallback used when no provider can answer.
   *
   * Behaviour change worth knowing: the OpenRouter branch actually runs now.
   * It used to read process.env.OPENROUTER_API_KEY while every .env in this
   * project defines OPEN_ROUTER_API, so the configured key was never seen and
   * every call fell through to Gemini. The adapter accepts both names.
   */
  try {
    const result = await generateText(
      { messages: leadInsightPrompt.build(lead), timeoutMs: 15_000, maxTokens: 1_024 },
      {
        operation: "lead.insight",
        tenantId: options?.tenantId,
        userId: options?.userId,
        preferredProvider: options?.preferredProvider,
        ...promptRef(leadInsightPrompt),
      }
    );
    // Strip stray wrapping quotes, as the previous implementation did.
    const insight = result.text.replace(/^["']|["']$/g, "").trim();
    if (insight) return insight;
    logger.warn("AI insight came back empty. Falling back to the rule-based engine.");
  } catch (err: any) {
    logger.warn(
      `AI insight generation unavailable (${err?.message || err}). Using the rule-based engine.`
    );
  }

  return getRuleBasedInsight(lead);
}

function getMonthsSinceDate(dateStr?: string): string {
  if (!dateStr || dateStr.trim() === "" || dateStr.trim() === "None") return "unknown time";
  const postDate = new Date(dateStr);
  const now = new Date();
  if (isNaN(postDate.getTime())) return "unknown time";
  
  const diffMs = now.getTime() - postDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day";
  if (diffDays < 30) return `${diffDays} days`;
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month";
  return `${diffMonths} months`;
}

function getRuleBasedInsight(lead: {
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
}): string {
  const parts: string[] = [];
  
  // 1. Website status
  if (lead.websiteStatus === "MISSING") {
    parts.push("Missing website!");
  } else if (lead.websiteStatus === "BROKEN") {
    parts.push("Website is broken/offline!");
  } else if (lead.websiteStatus === "OUTDATED") {
    parts.push("Having website but it is outdated and not mobile-responsive.");
  } else {
    parts.push("Having website!");
  }
  
  // 2. Instagram
  if (lead.instagramStatus === "NOT_FOUND") {
    parts.push("No Instagram account found.");
  } else {
    const lastPostStr = lead.instagramLastPost ? ` but ${getMonthsSinceDate(lead.instagramLastPost)} since last posted` : "";
    parts.push(`Having Instagram account (${lead.instagramStatus.toLowerCase()})${lastPostStr}.`);
  }
  
  // 3. Facebook
  if (lead.facebookStatus === "NOT_FOUND") {
    parts.push("No Facebook page found.");
  } else {
    const lastPostStr = lead.facebookLastPost ? ` but ${getMonthsSinceDate(lead.facebookLastPost)} since last posted` : "";
    parts.push(`Facebook page is ${lead.facebookStatus.toLowerCase()}${lastPostStr}.`);
  }
  
  // 4. LinkedIn
  if (lead.linkedinStatus === "NOT_FOUND") {
    parts.push("No LinkedIn company presence.");
  } else if (lead.linkedinStatus) {
    parts.push(`LinkedIn is ${lead.linkedinStatus.toLowerCase()}.`);
  }
  
  const summaryDraft = parts.join(" ");
  
  // Actionable recommendations
  const recs: string[] = [];
  if (lead.websiteStatus === "MISSING") {
    recs.push("- Create a professional, mobile-responsive landing page to capture local search traffic.");
  } else if (lead.websiteStatus === "BROKEN") {
    recs.push("- Rebuild and restore the broken website immediately to avoid losing patient trust.");
  } else if (lead.websiteStatus === "OUTDATED") {
    recs.push("- Modernize the website layout and implement mobile responsiveness.");
  }
  
  if (lead.websiteStatus !== "MISSING" && lead.websiteStatus !== "BROKEN") {
    if (!lead.googleAnalyticsPresent) {
      recs.push("- Install Google Analytics (GA4) to track visitor traffic and page performance.");
    }
    if (!lead.metaPixelPresent) {
      recs.push("- Embed the Meta Pixel to run retargeting ads and trace ad conversions.");
    }
    if (!lead.whatsappPresent) {
      recs.push("- Add a direct WhatsApp chat button on the website for instant patient/client communication.");
    }
    if (!lead.appointmentSystem) {
      recs.push("- Integrate an automated online booking system (e.g., Calendly) to streamline appointments.");
    }
  }
  
  if (lead.instagramStatus === "INACTIVE" || lead.instagramStatus === "NOT_FOUND" || lead.facebookStatus === "INACTIVE" || lead.facebookStatus === "NOT_FOUND") {
    recs.push("- Revitalize social media branding by planning a consistent post schedule and utilizing automated posts.");
  }
  
  const recommendationsText = recs.length > 0 
    ? "\n\nRecommendations to Improve Business:\n" + recs.join("\n")
    : "\n\nDigital presence is solid! Maintain reputation and optimize local Google Maps ranking.";
    
  return `${summaryDraft}${recommendationsText}`;
}
