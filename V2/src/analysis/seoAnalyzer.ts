/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SEO analyzer — inspects an already-open Playwright page for on-page SEO
 * signals and returns a 0-100 score plus a list of missing items.
 * Accepts a `Page` (dependency injection) so the browser session is reused.
 */

import type { Page } from "playwright";
import { SeoAnalysis } from "./types";

export interface SeoProbeExtras {
  hasRobotsTxt?: boolean;
  hasSitemap?: boolean;
}

export async function analyzeSeo(page: Page, extras: SeoProbeExtras = {}): Promise<SeoAnalysis> {
  const raw = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel);
    const metaContent = (sel: string) => (q(sel) as HTMLMetaElement | null)?.content?.trim() || null;

    const scripts = Array.from(document.querySelectorAll("script"));
    const gaPresent =
      scripts.some((s) => (s.src || "").match(/googletagmanager\.com|google-analytics\.com/)) ||
      scripts.some((s) => (s.textContent || "").match(/gtag\(|GoogleAnalyticsObject/)) ||
      (window as any).dataLayer !== undefined;
    const pixelPresent =
      scripts.some((s) => (s.src || "").includes("connect.facebook.net")) ||
      scripts.some((s) => (s.textContent || "").includes("fbq")) ||
      (window as any).fbq !== undefined;

    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const ldText = ldScripts.map((s) => s.textContent || "").join(" ");
    const hasSchema = ldScripts.length > 0 || !!q("[itemscope]");
    const hasLocalBusiness = /LocalBusiness|Dentist|MedicalBusiness|Physician|Restaurant|Store|ProfessionalService/i.test(ldText);

    return {
      metaTitle: (document.querySelector("title")?.textContent || "").trim() || null,
      metaDescription: metaContent('meta[name="description"]'),
      h1: (document.querySelector("h1")?.textContent || "").trim() || null,
      canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || null,
      openGraphTags: document.querySelectorAll('meta[property^="og:"]').length,
      twitterTags: document.querySelectorAll('meta[name^="twitter:"]').length,
      hasSchemaOrg: hasSchema,
      hasLocalBusinessSchema: hasLocalBusiness,
      googleAnalyticsPresent: gaPresent,
      facebookPixelPresent: pixelPresent,
    };
  });

  const missing: string[] = [];
  let score = 0;

  const add = (ok: boolean, points: number, label: string) => {
    if (ok) score += points;
    else missing.push(label);
  };

  add(!!raw.metaTitle, 15, "Meta Title");
  add(!!raw.metaDescription, 15, "Meta Description");
  add(!!raw.h1, 10, "H1 heading");
  add(!!raw.canonical, 8, "Canonical URL");
  add(raw.openGraphTags >= 3, 10, "Open Graph tags");
  add(raw.twitterTags >= 2, 7, "Twitter card tags");
  add(raw.hasSchemaOrg, 10, "Schema.org markup");
  add(raw.hasLocalBusinessSchema, 10, "LocalBusiness schema");
  add(raw.googleAnalyticsPresent, 5, "Google Analytics");
  add(raw.facebookPixelPresent, 5, "Facebook Pixel");
  add(!!extras.hasRobotsTxt, 2, "robots.txt");
  add(!!extras.hasSitemap, 3, "sitemap.xml");

  return {
    ...raw,
    hasRobotsTxt: !!extras.hasRobotsTxt,
    hasSitemap: !!extras.hasSitemap,
    seoScore: Math.min(100, score),
    missing,
  };
}
