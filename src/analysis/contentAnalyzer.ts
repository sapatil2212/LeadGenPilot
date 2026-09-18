/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content analyzer — estimates content strategy health from social activity
 * signals and suggests a content plan. Rule-based and deterministic.
 */

import { ContentAnalysis, SocialProfile } from "./types";

const CONTENT_CATEGORIES = [
  "Educational",
  "Testimonials",
  "Case Studies",
  "Before/After",
  "Offers",
  "Videos",
];

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function analyzeContent(profiles: SocialProfile[]): ContentAnalysis {
  const active = profiles.filter((p) => p.status === "ACTIVE");
  const recentDays = profiles
    .map((p) => daysSince(p.lastActivity))
    .filter((d): d is number => d !== null);
  const freshest = recentDays.length ? Math.min(...recentDays) : null;

  let postingFrequency: ContentAnalysis["postingFrequency"];
  if (active.length === 0) postingFrequency = "NONE";
  else if (freshest === null) postingFrequency = "LOW";
  else if (freshest <= 14) postingFrequency = "HIGH";
  else if (freshest <= 45) postingFrequency = "MEDIUM";
  else postingFrequency = "LOW";

  // Consistency: proportion of platforms that are active, scaled by freshness.
  const activeRatio = profiles.length ? active.length / profiles.length : 0;
  const freshnessFactor =
    freshest === null ? 0.4 : freshest <= 14 ? 1 : freshest <= 45 ? 0.7 : freshest <= 120 ? 0.4 : 0.2;
  const consistency = Math.round(activeRatio * freshnessFactor * 100);

  // Without post-level data we cannot detect categories, so we recommend the
  // full mix for low-activity businesses and a lighter set for active ones.
  const missingCategories =
    postingFrequency === "NONE" || postingFrequency === "LOW"
      ? [...CONTENT_CATEGORIES]
      : CONTENT_CATEGORIES.filter((c) => ["Case Studies", "Before/After", "Videos"].includes(c));

  const suggestedStrategy: string[] = [];
  if (postingFrequency === "NONE") {
    suggestedStrategy.push("Establish a baseline of 2-3 posts per week across Instagram and Facebook.");
    suggestedStrategy.push("Start with educational posts and customer testimonials to build trust.");
  } else if (postingFrequency === "LOW" || postingFrequency === "MEDIUM") {
    suggestedStrategy.push("Increase cadence to a consistent weekly schedule using batch-created content.");
    suggestedStrategy.push("Add short-form video (Reels/Shorts) to expand organic reach.");
  } else {
    suggestedStrategy.push("Maintain cadence and introduce case studies and before/after showcases.");
  }
  suggestedStrategy.push("Repurpose top posts into an offers/promotions series to drive conversions.");

  return { postingFrequency, consistency, missingCategories, suggestedStrategy };
}
