/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";
import axios from "axios";

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
}): Promise<string> {
  const currentDate = new Date().toISOString().split("T")[0];
  const prompt = `Perform a comprehensive digital presence audit and create improvement insights for the business '${lead.businessName}'.
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
- Digital Presence Score: ${lead.leadScore}/200 (Priority: ${lead.leadPriority})
- Current Date: ${currentDate}

Audit Formatting Instructions:
1. **Summary Audit Draft**: Start the output with a single paragraph summarizing their current assets and activity. Use phrases like "Having website!", "Having instagram account but X months since last posted", "Fb account is active/inactive but Y months since last posted", etc. Compute the time differences between the Current Date (${currentDate}) and their last post dates.
2. **Business Improvement Recommendations**: Provide a detailed list of actionable suggestions explaining how they can grow their business and improve their digital presence (e.g., website creation/redesign, booking automation, pixel tracking, social media active posting). Keep the tone helpful, professional, and business-focused. Do not use placeholders or markdown bolding. Keep the whole audit under 150 words.`;

  // 1. Try OpenRouter API Key
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey && openRouterKey.trim() !== "" && openRouterKey !== "YOUR_OPENROUTER_API_KEY") {
    try {
      logger.info(`Generating AI Insight via OpenRouter for: '${lead.businessName}'`);
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        },
        {
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://nexaleadai.com",
            "X-Title": "NexaLeadAi"
          },
          timeout: 15000
        }
      );
      
      if (response.data && response.data.choices && response.data.choices[0]?.message?.content) {
        const insight = response.data.choices[0].message.content.trim();
        if (insight) {
          return insight.replace(/^["']|["']$/g, "");
        }
      }
    } catch (e: any) {
      logger.warn(`OpenRouter API Insight generation failed: ${e.message || e}. Trying Gemini fallback...`);
    }
  }

  // 2. Try Gemini API Key
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey.trim() !== "" && geminiKey !== "MY_GEMINI_API_KEY") {
    try {
      logger.info(`Generating AI Insight via Gemini for: '${lead.businessName}'`);
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });

      const insight = response.text ? response.text.trim() : "";
      if (insight) {
        return insight.replace(/^["']|["']$/g, "");
      }
    } catch (e) {
      logger.warn(`Gemini API Insight generation failed: ${e}. Falling back to rule-based engine.`);
    }
  }

  // 3. Rule-based fallback engine
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
