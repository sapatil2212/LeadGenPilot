/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Performance analyzer — derives approximate load metrics from the Navigation
 * Timing / Resource Timing APIs of an already-open Playwright page. No external
 * Lighthouse dependency; these are heuristics good enough for lead triage.
 */

import type { Page } from "playwright";
import { PerformanceAnalysis } from "./types";

export async function analyzePerformance(page: Page): Promise<PerformanceAnalysis> {
  const raw = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

    const loadTimeMs = nav ? Math.max(0, nav.responseEnd - nav.startTime) : 0;

    // Rough LCP proxy: time to first meaningful paint-ish, else domContentLoaded.
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint");
    const lcpEstimateMs = fcp ? fcp.startTime : nav ? nav.domContentLoadedEventEnd - nav.startTime : 0;

    const scripts = document.querySelectorAll("script").length;
    const css = document.querySelectorAll('link[rel="stylesheet"]').length;
    const imgs = Array.from(document.querySelectorAll("img"));
    const lazyLoading = imgs.some((i) => i.getAttribute("loading") === "lazy");

    // Heavy assets: resources whose transferSize exceeds ~500KB.
    const heavyAssets = resources.filter((r) => (r.transferSize || 0) > 500 * 1024).length;

    // "Optimized" heuristic: modern formats or explicit dimensions present.
    const modernImgs = imgs.filter((i) => /\.(webp|avif)(\?|$)/i.test(i.currentSrc || i.src || "")).length;
    const imagesOptimized = imgs.length === 0 || modernImgs / imgs.length >= 0.3 || lazyLoading;

    return {
      loadTimeMs: Math.round(loadTimeMs),
      lcpEstimateMs: Math.round(lcpEstimateMs),
      imagesOptimized,
      lazyLoading,
      scriptCount: scripts,
      cssCount: css,
      heavyAssets,
    };
  });

  // Score: penalize slow load, heavy JS/CSS, heavy assets; reward optimization.
  let score = 100;
  if (raw.loadTimeMs > 1500) score -= Math.min(30, Math.floor((raw.loadTimeMs - 1500) / 200) * 3);
  if (raw.lcpEstimateMs > 2500) score -= Math.min(20, Math.floor((raw.lcpEstimateMs - 2500) / 500) * 5);
  if (raw.scriptCount > 20) score -= Math.min(15, (raw.scriptCount - 20));
  if (raw.cssCount > 8) score -= Math.min(10, (raw.cssCount - 8) * 2);
  score -= Math.min(15, raw.heavyAssets * 5);
  if (!raw.imagesOptimized) score -= 10;
  if (raw.lazyLoading) score += 3;

  return { ...raw, performanceScore: Math.max(0, Math.min(100, score)) };
}
