/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brand analyzer — heuristically evaluates visual brand quality from an
 * already-open Playwright page: logo presence, typography and color
 * consistency, and overall professional appearance.
 */

import type { Page } from "playwright";
import { BrandAnalysis } from "./types";

export async function analyzeBrand(page: Page): Promise<BrandAnalysis> {
  const raw = await page.evaluate(() => {
    // Logo detection.
    const logoEl =
      document.querySelector('img[alt*="logo" i],img[src*="logo" i],[class*="logo" i] img,header img') ||
      document.querySelector("header svg");
    const logoQuality = logoEl
      ? (() => {
          const img = logoEl as HTMLImageElement;
          const w = img.naturalWidth || img.width || 0;
          if (logoEl.tagName.toLowerCase() === "svg") return 90; // vector = crisp
          if (w >= 200) return 85;
          if (w >= 100) return 70;
          if (w > 0) return 55;
          return 60;
        })()
      : 20;

    // Typography consistency: fewer distinct font families = more consistent.
    const sample = Array.from(document.querySelectorAll("h1,h2,h3,p,a,span,div")).slice(0, 400);
    const fonts = new Set<string>();
    const colors = new Set<string>();
    sample.forEach((el) => {
      const s = window.getComputedStyle(el as Element);
      const fam = (s.fontFamily || "").split(",")[0].trim().toLowerCase();
      if (fam) fonts.add(fam);
      const col = s.color;
      if (col) colors.add(col);
    });

    const fontCount = fonts.size;
    const colorCount = colors.size;

    // Storefront/hero imagery presence.
    const heroImg = !!document.querySelector('[class*="hero" i] img,[class*="banner" i] img,section img');

    return { logoQuality, fontCount, colorCount, hasLogoEl: !!logoEl, heroImg };
  });

  const typographyConsistency =
    raw.fontCount <= 2 ? 95 : raw.fontCount <= 3 ? 80 : raw.fontCount <= 4 ? 65 : raw.fontCount <= 6 ? 45 : 30;
  const colorConsistency =
    raw.colorCount <= 4 ? 92 : raw.colorCount <= 6 ? 78 : raw.colorCount <= 9 ? 60 : raw.colorCount <= 12 ? 45 : 30;
  const professionalAppearance = Math.round(
    (raw.logoQuality + typographyConsistency + colorConsistency + (raw.heroImg ? 85 : 55)) / 4
  );
  const brandConsistency = Math.round((typographyConsistency + colorConsistency) / 2);
  const brandScore = Math.round(
    raw.logoQuality * 0.3 + brandConsistency * 0.35 + professionalAppearance * 0.35
  );

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (raw.hasLogoEl && raw.logoQuality >= 70) strengths.push("Clear, good-quality logo");
  else weaknesses.push("Weak or missing logo");
  if (typographyConsistency >= 75) strengths.push("Consistent typography");
  else weaknesses.push("Inconsistent typography (too many fonts)");
  if (colorConsistency >= 75) strengths.push("Cohesive color palette");
  else weaknesses.push("Fragmented color palette");
  if (raw.heroImg) strengths.push("Uses hero/brand imagery");
  else weaknesses.push("No prominent brand imagery");

  return {
    logoQuality: raw.logoQuality,
    brandConsistency,
    typographyConsistency,
    colorConsistency,
    professionalAppearance,
    brandScore: Math.max(0, Math.min(100, brandScore)),
    strengths,
    weaknesses,
  };
}
