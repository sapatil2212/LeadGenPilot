/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Competitor analyzer — compares the target business against nearby
 * competitors on rating, review volume and web presence, and determines a
 * competitive position. Competitor data is supplied by the caller (the scraper
 * already collects nearby businesses), keeping this module free of scraping.
 */

import { BusinessContext, CompetitorAnalysis, CompetitorSummary } from "./types";

export function analyzeCompetitors(ctx: BusinessContext, competitors: CompetitorSummary[]): CompetitorAnalysis {
  const list = (competitors || []).filter((c) => c.name && c.name !== ctx.businessName);

  if (list.length === 0) {
    return {
      competitivePosition: "AVERAGE",
      strengths: [],
      weaknesses: ["Insufficient competitor data to benchmark against."],
      topCompetitors: [],
    };
  }

  const avgRating = avg(list.map((c) => c.rating).filter((n) => n > 0));
  const avgReviews = avg(list.map((c) => c.reviews).filter((n) => n > 0));
  const withWebsite = list.filter((c) => c.hasWebsite).length;
  const websiteShare = list.length ? withWebsite / list.length : 0;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (ctx.rating >= avgRating) strengths.push(`Rating (${ctx.rating}) at or above local average (${avgRating.toFixed(1)}).`);
  else weaknesses.push(`Rating (${ctx.rating}) below local average (${avgRating.toFixed(1)}).`);

  if (ctx.reviews >= avgReviews) strengths.push(`Review volume (${ctx.reviews}) above local average (${Math.round(avgReviews)}).`);
  else weaknesses.push(`Review volume (${ctx.reviews}) below local average (${Math.round(avgReviews)}).`);

  const hasSite = !!ctx.website && ctx.website.trim() !== "";
  if (hasSite && websiteShare < 0.6) strengths.push("Has a website while many competitors do not.");
  if (!hasSite && websiteShare >= 0.5) weaknesses.push("Most competitors have websites; this business does not.");

  // Position: score relative to peers.
  let points = 0;
  if (ctx.rating >= avgRating) points++;
  if (ctx.reviews >= avgReviews) points++;
  if (hasSite) points++;
  const competitivePosition: CompetitorAnalysis["competitivePosition"] =
    points >= 3 ? "LEADER" : points >= 2 ? "AVERAGE" : "LAGGING";

  const topCompetitors = [...list]
    .sort((a, b) => b.reviews - a.reviews || b.rating - a.rating)
    .slice(0, 5);

  return { competitivePosition, strengths, weaknesses, topCompetitors };
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
