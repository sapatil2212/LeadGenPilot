/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Growth Intelligence layer — public barrel.
 *
 * This layer extends LeadFinder AI into a Business Growth Intelligence Platform
 * without modifying the existing scraper/analyzer modules. Import from here:
 *
 *   import { runGrowthIntelligence, BusinessContext } from "./analysis";
 */

export * from "./types";
export { runGrowthIntelligence } from "./growthIntelligenceAgent";
export type { AgentOptions } from "./growthIntelligenceAgent";

// Individual analyzers (for direct/standalone use or testing)
export { analyzeWebsiteDeep, unreachableWebsite } from "./websiteDeepAnalyzer";
export { analyzeSeo } from "./seoAnalyzer";
export { analyzePerformance } from "./performanceAnalyzer";
export { analyzeConversion } from "./conversionAnalyzer";
export { analyzeBrand } from "./brandAnalyzer";
export { profilesFromContext, discoverExtraProfiles, buildSocialAnalysis } from "./socialAnalyzer";
export { analyzeContent } from "./contentAnalyzer";
export { analyzeGmb } from "./gmbAnalyzer";
export type { GmbSignals } from "./gmbAnalyzer";
export { analyzeReviews } from "./reviewAnalyzer";
export { analyzeCompetitors } from "./competitorAnalyzer";
export { buildScorecard } from "./digitalPresenceScore";
export { estimateOpportunity, PRICE_BOOK } from "./opportunityEstimator";
export { generateGrowthInsight, ruleBasedGrowthInsight } from "./aiInsightGenerator";
export { generateProposalData } from "./proposalDataGenerator";
export {
  recordScan,
  buildSnapshot,
  getHistory,
  makeBusinessKey,
} from "./monitoringEngine";
export type { ScanSnapshot, ScanChange } from "./monitoringEngine";

// Resilience utilities
export { withRetry, withTimeout, safeStep, Throttle, sleep } from "./retry";
