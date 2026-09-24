/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Growth Intelligence Agent — the orchestrator.
 *
 * Runs the full analysis pipeline for a single business, reusing one browser
 * page for all page-based analyzers (website/SEO/performance/conversion/brand)
 * to minimize tabs and launches. Every step is isolated via `safeStep`, so a
 * single failing module never aborts the pipeline — partial results are always
 * returned.
 *
 *   website ─┐
 *   seo      ├─ (single page visit, reused session)
 *   perf     │
 *   convert  │
 *   brand   ─┘
 *   social → content
 *   gmb
 *   reviews
 *   competitors
 *        ↓
 *   scorecard → opportunity → aiInsight → proposal
 */

import type { Browser, Page } from "playwright";
import { logger } from "../logger";
import { BusinessContext, GrowthIntelligence } from "./types";
import { safeStep, withRetry, withTimeout } from "./retry";
import { analyzeWebsiteDeep, unreachableWebsite } from "./websiteDeepAnalyzer";
import { analyzeSeo } from "./seoAnalyzer";
import { analyzePerformance } from "./performanceAnalyzer";
import { analyzeConversion } from "./conversionAnalyzer";
import { analyzeBrand } from "./brandAnalyzer";
import { profilesFromContext, discoverExtraProfiles, buildSocialAnalysis } from "./socialAnalyzer";
import { analyzeContent } from "./contentAnalyzer";
import { analyzeGmb, GmbSignals } from "./gmbAnalyzer";
import { analyzeReviews } from "./reviewAnalyzer";
import { analyzeCompetitors } from "./competitorAnalyzer";
import { buildScorecard } from "./digitalPresenceScore";
import { estimateOpportunity } from "./opportunityEstimator";
import { generateGrowthInsight } from "./aiInsightGenerator";
import { generateProposalData } from "./proposalDataGenerator";

export interface AgentOptions {
  /** Also search Google for YouTube/TikTok/Threads profiles (extra tabs). */
  discoverExtraSocial?: boolean;
  /** Per-page navigation timeout. */
  navTimeoutMs?: number;
  /** GMB signals extracted by the caller from the Maps detail page. */
  gmbSignals?: GmbSignals;
}

export async function runGrowthIntelligence(
  browser: Browser,
  ctx: BusinessContext,
  options: AgentOptions = {}
): Promise<GrowthIntelligence> {
  const started = Date.now();
  const failedSteps: string[] = [];
  const navTimeout = options.navTimeoutMs ?? 15000;
  const intel: GrowthIntelligence = { failedSteps, executionTimeMs: 0, analyzedAt: new Date().toISOString() };

  const hasWebsite = !!ctx.website && ctx.website.trim() !== "";

  // ── Page-based analyzers: one page visit, reused across modules ──
  if (hasWebsite) {
    let context = null;
    let page: Page | null = null;
    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      });
      page = await context.newPage();

      const loaded = await safeStep(
        "website:navigate",
        async () => {
          await withRetry(
            () => withTimeout(page!.goto(ctx.website, { waitUntil: "domcontentloaded", timeout: navTimeout }).then(() => {}), navTimeout + 2000, "goto"),
            { retries: 1, label: `goto ${ctx.website}` }
          );
          return true;
        },
        false,
        failedSteps
      );

      if (loaded && page) {
        const p = page;
        intel.website = await safeStep("website", () => analyzeWebsiteDeep(p, ctx.website), unreachableWebsite(ctx.website.startsWith("https://")), failedSteps);
        intel.seo = await safeStep(
          "seo",
          () => analyzeSeo(p, { hasRobotsTxt: intel.website?.hasRobotsTxt, hasSitemap: intel.website?.hasSitemap }),
          undefined as any,
          failedSteps
        );
        intel.performance = await safeStep("performance", () => analyzePerformance(p), undefined as any, failedSteps);
        intel.conversion = await safeStep("conversion", () => analyzeConversion(p), undefined as any, failedSteps);
        intel.brand = await safeStep("brand", () => analyzeBrand(p), undefined as any, failedSteps);
      } else {
        intel.website = unreachableWebsite(ctx.website.startsWith("https://"));
      }
    } catch (err: any) {
      failedSteps.push("website:context");
      logger.warn(`Website analysis context failed (non-fatal): ${err?.message || err}`);
      intel.website = unreachableWebsite(ctx.website.startsWith("https://"));
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  // ── Social + content ──
  const baseProfiles = profilesFromContext(ctx);
  const extraProfiles = options.discoverExtraSocial
    ? await safeStep("social:discover", () => discoverExtraProfiles(browser, ctx.businessName), [], failedSteps)
    : [];
  intel.social = buildSocialAnalysis([...baseProfiles, ...extraProfiles]);
  intel.content = analyzeContent(intel.social.profiles);

  // ── GMB ──
  const gmbSignals: GmbSignals = {
    ...options.gmbSignals,
    primaryCategory: options.gmbSignals?.primaryCategory ?? ctx.category,
    website: options.gmbSignals?.website ?? hasWebsite,
    phone: options.gmbSignals?.phone ?? (!!ctx.phone && ctx.phone.toLowerCase() !== "not found"),
  };
  intel.gmb = safeStepSync("gmb", () => analyzeGmb(gmbSignals), failedSteps);

  // ── Reviews ──
  intel.reviews = safeStepSync("reviews", () => analyzeReviews(ctx.reviewTexts || [], ctx.rating), failedSteps);

  // ── Competitors ──
  intel.competitors = safeStepSync("competitors", () => analyzeCompetitors(ctx, ctx.competitors || []), failedSteps);

  // ── Scorecard ──
  intel.scorecard = buildScorecard({
    website: intel.website,
    seo: intel.seo,
    performance: intel.performance,
    social: intel.social,
    gmb: intel.gmb,
    brand: intel.brand,
    conversion: intel.conversion,
  });

  // ── Opportunity ──
  intel.opportunity = estimateOpportunity({
    scorecard: intel.scorecard,
    website: intel.website,
    conversion: intel.conversion,
  });

  // ── AI insight (LLM with rule-based fallback) ──
  intel.aiInsight = await safeStep(
    "aiInsight",
    () =>
      generateGrowthInsight({
        businessName: ctx.businessName,
        category: ctx.category,
        rating: ctx.rating,
        reviews: ctx.reviews,
        website: ctx.website,
        scorecard: intel.scorecard!,
        opportunity: intel.opportunity!,
        websiteAnalysis: intel.website,
        social: intel.social,
        reviews_analysis: intel.reviews,
        instagramStatus: ctx.instagramStatus,
        facebookStatus: ctx.facebookStatus,
        linkedinStatus: ctx.linkedinStatus,
        whatsappPresent: intel.website?.whatsappButton,
        appointmentSystem: intel.website?.appointmentBooking,
      }),
    "",
    failedSteps
  );

  // ── Proposal ──
  intel.proposal = generateProposalData({
    businessName: ctx.businessName,
    scorecard: intel.scorecard,
    opportunity: intel.opportunity,
    website: intel.website,
    seo: intel.seo,
    conversion: intel.conversion,
  });

  intel.executionTimeMs = Date.now() - started;
  logger.info(
    `Growth intelligence for '${ctx.businessName}' complete in ${intel.executionTimeMs}ms ` +
      `(score ${intel.scorecard?.overallScore}/100, ${intel.opportunity?.priority}, ` +
      `${failedSteps.length} step(s) degraded).`
  );

  return intel;
}

/** Synchronous safe wrapper for pure-computation steps. */
function safeStepSync<T>(name: string, fn: () => T, failedSteps: string[]): T | undefined {
  try {
    return fn();
  } catch (err: any) {
    failedSteps.push(name);
    logger.warn(`Growth intelligence step "${name}" failed (non-fatal): ${err?.message || err}`);
    return undefined;
  }
}
