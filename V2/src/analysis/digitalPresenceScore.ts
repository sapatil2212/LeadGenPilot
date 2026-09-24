/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Digital presence scorecard — combines the individual analyzer scores into a
 * single weighted 0-100 overall score. This is the "growth-intelligence"
 * counterpart to the existing `digitalPresenceScorer.ts` (which scores lead
 * *opportunity* out of 200 and is untouched here).
 */

import {
  DigitalPresenceScorecard,
  WebsiteDeepAnalysis,
  SeoAnalysis,
  PerformanceAnalysis,
  SocialAnalysis,
  GmbAnalysis,
  BrandAnalysis,
  ConversionAnalysis,
} from "./types";

export interface ScoreInputs {
  website?: WebsiteDeepAnalysis;
  seo?: SeoAnalysis;
  performance?: PerformanceAnalysis;
  social?: SocialAnalysis;
  gmb?: GmbAnalysis;
  brand?: BrandAnalysis;
  conversion?: ConversionAnalysis;
}

/** Map a WebsiteDeepAnalysis into a 0-100 health score. */
function websiteHealthScore(w?: WebsiteDeepAnalysis): number {
  if (!w || w.loadFailed) return 0;
  let s = 40; // reachable baseline
  if (w.https) s += 10;
  if (w.responsive) s += 15;
  if (w.contactPage) s += 5;
  if (w.contactForm) s += 5;
  if (w.appointmentBooking) s += 5;
  if (w.hasSitemap) s += 3;
  if (w.hasRobotsTxt) s += 2;
  s += Math.round(w.navigationQuality * 0.1);
  s -= Math.min(15, w.brokenLinks * 3);
  s -= Math.min(10, w.brokenImages * 2);
  if (w.status === "OUTDATED") s -= 15;
  return Math.max(0, Math.min(100, s));
}

const WEIGHTS = {
  website: 0.2,
  seo: 0.15,
  performance: 0.12,
  social: 0.15,
  gmb: 0.18,
  brand: 0.1,
  conversion: 0.1,
};

export function buildScorecard(inputs: ScoreInputs): DigitalPresenceScorecard {
  const websiteScore = websiteHealthScore(inputs.website);
  const seoScore = inputs.seo?.seoScore ?? 0;
  const performanceScore = inputs.performance?.performanceScore ?? 0;
  const socialScore = inputs.social?.socialScore ?? 0;
  const gmbScore = inputs.gmb?.gmbScore ?? 0;
  const brandScore = inputs.brand?.brandScore ?? 0;
  const conversionScore = inputs.conversion?.conversionScore ?? 0;

  const overallScore = Math.round(
    websiteScore * WEIGHTS.website +
      seoScore * WEIGHTS.seo +
      performanceScore * WEIGHTS.performance +
      socialScore * WEIGHTS.social +
      gmbScore * WEIGHTS.gmb +
      brandScore * WEIGHTS.brand +
      conversionScore * WEIGHTS.conversion
  );

  return {
    websiteScore,
    seoScore,
    performanceScore,
    socialScore,
    gmbScore,
    brandScore,
    conversionScore,
    overallScore: Math.max(0, Math.min(100, overallScore)),
  };
}
