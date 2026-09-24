/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Website deep analyzer — structural / health checks on an already-open
 * Playwright page. Complements the existing top-level `websiteAnalyzer.ts`
 * (which the scraper still uses) by adding broken-link/image detection,
 * SSL validity, navigation quality, robots.txt and sitemap probing.
 *
 * This module does NOT replace `src/websiteAnalyzer.ts`.
 */

import type { Page, APIRequestContext } from "playwright";
import { WebsiteDeepAnalysis, WebsiteStatus } from "./types";

interface DeepOptions {
  /** Cap the number of links checked for "broken" status (perf). */
  maxLinksToCheck?: number;
}

export async function analyzeWebsiteDeep(
  page: Page,
  url: string,
  options: DeepOptions = {}
): Promise<WebsiteDeepAnalysis> {
  const maxLinks = options.maxLinksToCheck ?? 12;
  const https = url.toLowerCase().startsWith("https://");

  const dom = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").toLowerCase();
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];

    const responsive = (() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return !!meta && (meta.getAttribute("content") || "").includes("width=device-width");
    })();

    const contactPage = anchors.some((a) => /contact/i.test(a.href) || /contact/i.test(a.textContent || ""));
    const contactForm =
      !!document.querySelector('input[type="email"]') &&
      (!!document.querySelector("textarea") || !!document.querySelector('input[name*="message"]'));
    const whatsappButton = anchors.some((a) =>
      /wa\.me|api\.whatsapp\.com|whatsapp\.com\/send/.test(a.href.toLowerCase())
    );
    const appointmentBooking =
      /book appointment|appointment|schedule|book now|calendly|acuityscheduling/.test(bodyText) ||
      !!document.querySelector('iframe[src*="calendly"],iframe[src*="acuity"]');

    // Navigation quality: presence of a nav with a reasonable number of links.
    const nav = document.querySelector("nav,header");
    const navLinks = nav ? nav.querySelectorAll("a").length : 0;
    const navigationQuality = Math.max(0, Math.min(100, navLinks === 0 ? 20 : Math.min(100, 40 + navLinks * 8)));

    const copyrightYear = (() => {
      const m = (document.querySelector("footer")?.innerText || bodyText).match(/(?:©|copyright)\s*.*?\b(20\d{2})\b/i);
      return m ? parseInt(m[1], 10) : null;
    })();

    // Collect candidate links (same-origin, http) and image sources.
    const links = anchors
      .map((a) => a.href)
      .filter((h) => /^https?:\/\//i.test(h))
      .slice(0, 40);
    const images = Array.from(document.querySelectorAll("img"))
      .map((i) => ({ src: (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src, w: (i as HTMLImageElement).naturalWidth }))
      .filter((i) => !!i.src);

    return { responsive, contactPage, contactForm, whatsappButton, appointmentBooking, navigationQuality, copyrightYear, links, images };
  });

  // Broken images: naturalWidth === 0 after load usually means failed to render.
  const brokenImages = dom.images.filter((i) => i.w === 0).length;

  // Broken links: HEAD a sample of links via the page's request context.
  let brokenLinks = 0;
  const request = page.context().request;
  const sample = dom.links.slice(0, maxLinks);
  await Promise.all(
    sample.map(async (href) => {
      try {
        const resp = await request.head(href, { timeout: 6000 }).catch(() => request.get(href, { timeout: 6000 }));
        if (resp && resp.status() >= 400) brokenLinks++;
      } catch {
        brokenLinks++;
      }
    })
  );

  // robots.txt / sitemap.xml probing.
  const origin = safeOrigin(url);
  const hasRobotsTxt = origin ? await probe(request, `${origin}/robots.txt`) : false;
  const hasSitemap = origin
    ? (await probe(request, `${origin}/sitemap.xml`)) || (await probe(request, `${origin}/sitemap_index.xml`))
    : false;

  // SSL validity: if the https page loaded without throwing, treat cert as valid.
  const sslValid = https;

  const currentYear = new Date().getFullYear();
  const outdated = dom.copyrightYear !== null && currentYear - dom.copyrightYear >= 3;
  let status: WebsiteStatus;
  if (!dom.responsive || outdated || brokenImages > 3) status = "OUTDATED";
  else status = "WORKING";

  return {
    reachable: true,
    https,
    sslValid,
    responsive: dom.responsive,
    contactPage: dom.contactPage,
    contactForm: dom.contactForm,
    whatsappButton: dom.whatsappButton,
    appointmentBooking: dom.appointmentBooking,
    navigationQuality: dom.navigationQuality,
    brokenLinks,
    brokenImages,
    copyrightYear: dom.copyrightYear,
    hasSitemap,
    hasRobotsTxt,
    loadFailed: false,
    status,
  };
}

/** A "not reachable" fallback for when the page never loaded. */
export function unreachableWebsite(https: boolean): WebsiteDeepAnalysis {
  return {
    reachable: false,
    https,
    sslValid: false,
    responsive: false,
    contactPage: false,
    contactForm: false,
    whatsappButton: false,
    appointmentBooking: false,
    navigationQuality: 0,
    brokenLinks: 0,
    brokenImages: 0,
    copyrightYear: null,
    hasSitemap: false,
    hasRobotsTxt: false,
    loadFailed: true,
    status: "BROKEN",
  };
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function probe(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    const resp = await request.get(url, { timeout: 6000 });
    return resp.status() >= 200 && resp.status() < 400;
  } catch {
    return false;
  }
}
