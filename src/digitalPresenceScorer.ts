/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lead } from "./types";

export interface ScoreDetails {
  score: number;
  priority: "HOT" | "WARM" | "COLD";
}

export function calculateDigitalPresenceScore(lead: Omit<Lead, "leadScore" | "leadPriority" | "dateAdded" | "aiInsight">): ScoreDetails {
  let score = 0;

  // 1. Website status scoring (+50 / +40 / +30)
  if (lead.websiteStatus === "MISSING") {
    score += 50;
  } else if (lead.websiteStatus === "BROKEN") {
    score += 40;
  } else if (lead.websiteStatus === "OUTDATED") {
    score += 30;
  }

  // 2. Google Maps reputation checks (+20 / +20)
  if (lead.reviews > 100) {
    score += 20;
  }
  if (lead.rating > 4.5) {
    score += 20;
  }

  // 3. Instagram presence (+15 / +10)
  if (lead.instagramStatus === "NOT_FOUND") {
    score += 15;
  } else if (lead.instagramStatus === "INACTIVE") {
    score += 10;
  }

  // 4. Facebook presence (+10 / +10)
  if (lead.facebookStatus === "NOT_FOUND") {
    score += 10;
  } else if (lead.facebookStatus === "INACTIVE") {
    score += 10;
  }

  // 5. Contact channel elements on website (+10 / +10)
  if (lead.websiteStatus !== "MISSING" && lead.websiteStatus !== "BROKEN") {
    if (!lead.whatsappPresent) {
      score += 10;
    }
    if (!lead.appointmentSystem) {
      score += 10;
    }
  } else {
    // If website is missing/broken, contact channels are also considered missing
    score += 10;
    score += 10;
  }

  // 6. Tracking pixels & email audits (+10 / +10 / +5)
  if (lead.websiteStatus !== "MISSING" && lead.websiteStatus !== "BROKEN") {
    if (!lead.googleAnalyticsPresent) {
      score += 10;
    }
    if (!lead.metaPixelPresent) {
      score += 10;
    }
    if (!lead.emails || lead.emails.length === 0) {
      score += 5;
    }
  } else {
    score += 10; // no GA
    score += 10; // no Pixel
    score += 5;  // no Email
  }

  // 7. LinkedIn Presence check (+10)
  if (lead.linkedinStatus === "NOT_FOUND") {
    score += 10;
  }

  // Clamp at max 200
  score = Math.min(score, 200);

  // Calculate priority
  let priority: "HOT" | "WARM" | "COLD" = "COLD";
  if (score >= 100) {
    priority = "HOT";
  } else if (score >= 60) {
    priority = "WARM";
  }

  return {
    score,
    priority
  };
}
