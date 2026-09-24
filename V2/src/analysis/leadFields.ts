/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps a GrowthIntelligence result onto the flat scalar fields consumed by the
 * Lead record / Google Sheet. Returns a plain object so this layer stays
 * decoupled from the app's Lead type.
 */

import { GrowthIntelligence } from "./types";

export interface LeadGrowthFields {
  websiteScore?: number;
  seoScore?: number;
  performanceScore?: number;
  socialScore?: number;
  brandScore?: number;
  conversionScore?: number;
  gmbScore?: number;
  digitalPresenceScore?: number;
  opportunityScore?: number;
  youtubeStatus?: "ACTIVE" | "INACTIVE" | "NOT_FOUND";
  youtubeUrl?: string;
}

export function growthIntelligenceToLeadFields(intel: GrowthIntelligence): LeadGrowthFields {
  const yt = intel.social?.profiles.find((p) => p.platform === "youtube");
  return {
    websiteScore: intel.scorecard?.websiteScore,
    seoScore: intel.scorecard?.seoScore,
    performanceScore: intel.scorecard?.performanceScore,
    socialScore: intel.scorecard?.socialScore,
    brandScore: intel.scorecard?.brandScore,
    conversionScore: intel.scorecard?.conversionScore,
    gmbScore: intel.scorecard?.gmbScore,
    digitalPresenceScore: intel.scorecard?.overallScore,
    opportunityScore: intel.opportunity?.totalOpportunity,
    youtubeStatus: yt?.status ?? "NOT_FOUND",
    youtubeUrl: yt?.profileUrl || "",
  };
}
