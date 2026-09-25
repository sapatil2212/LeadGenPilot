/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Social analyzer — composes the social presence picture.
 *
 * The existing scraper already resolves Instagram / Facebook / LinkedIn via the
 * top-level analyzers. This module reuses those results (passed via
 * BusinessContext) and additionally performs best-effort discovery of YouTube,
 * TikTok and Threads. It then produces a normalized SocialProfile[] and a
 * 0-100 social score.
 */

import type { Browser } from "playwright";
import { BusinessContext, SocialAnalysis, SocialProfile, PresenceStatus } from "./types";
import { logger } from "../logger";

/** Build normalized profiles from the pre-resolved IG/FB/LI context. */
export function profilesFromContext(ctx: BusinessContext): SocialProfile[] {
  const profiles: SocialProfile[] = [];

  profiles.push({
    platform: "instagram",
    profileUrl: ctx.instagramUrl || "",
    found: (ctx.instagramStatus ?? "NOT_FOUND") !== "NOT_FOUND",
    followers: null,
    postCount: null,
    lastActivity: ctx.instagramLastPost || "",
    status: ctx.instagramStatus ?? "NOT_FOUND",
  });
  profiles.push({
    platform: "facebook",
    profileUrl: ctx.facebookUrl || "",
    found: (ctx.facebookStatus ?? "NOT_FOUND") !== "NOT_FOUND",
    followers: null,
    postCount: null,
    lastActivity: ctx.facebookLastPost || "",
    status: ctx.facebookStatus ?? "NOT_FOUND",
  });
  profiles.push({
    platform: "linkedin",
    profileUrl: ctx.linkedinUrl || "",
    found: (ctx.linkedinStatus ?? "NOT_FOUND") !== "NOT_FOUND",
    followers: null,
    postCount: null,
    lastActivity: "",
    status: (ctx.linkedinStatus ?? "NOT_FOUND") === "ACTIVE" ? "ACTIVE" : "NOT_FOUND",
  });

  return profiles;
}

const EXTRA_PLATFORMS: { platform: SocialProfile["platform"]; domain: string }[] = [
  { platform: "youtube", domain: "youtube.com" },
  { platform: "tiktok", domain: "tiktok.com" },
  { platform: "threads", domain: "threads.net" },
];

/**
 * Best-effort discovery of YouTube / TikTok / Threads via a Google site-search.
 * Never throws — returns NOT_FOUND profiles on any failure.
 */
export async function discoverExtraProfiles(browser: Browser, businessName: string): Promise<SocialProfile[]> {
  const results: SocialProfile[] = [];

  for (const { platform, domain } of EXTRA_PLATFORMS) {
    let found: SocialProfile = {
      platform,
      profileUrl: "",
      found: false,
      followers: null,
      postCount: null,
      lastActivity: "",
      status: "NOT_FOUND",
    };

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    try {
      const query = encodeURIComponent(`${businessName} site:${domain}`);
      await page.goto(`https://www.google.com/search?q=${query}`, {
        waitUntil: "domcontentloaded",
        timeout: 12000,
      });
      const href = await page.evaluate((dom: string) => {
        const links = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
        const match = links
          .map((a) => a.href)
          .find((h) => h.includes(dom) && !h.includes("/search?") && !h.includes("google.com"));
        return match || "";
      }, domain);

      if (href) {
        found = { ...found, profileUrl: href, found: true, status: "ACTIVE" };
      }
    } catch (err: any) {
      logger.warn(`Social discovery for ${platform} failed (non-fatal): ${err?.message || err}`);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }

    results.push(found);
  }

  return results;
}

/** Compute the aggregate social score from a set of profiles. */
export function buildSocialAnalysis(profiles: SocialProfile[]): SocialAnalysis {
  const weight: Record<PresenceStatus, number> = { ACTIVE: 1, INACTIVE: 0.5, NOT_FOUND: 0 };
  // Core platforms carry more weight than niche ones.
  const platformWeight: Record<SocialProfile["platform"], number> = {
    instagram: 25,
    facebook: 25,
    linkedin: 20,
    youtube: 15,
    tiktok: 8,
    threads: 7,
  };

  let score = 0;
  let max = 0;
  for (const p of profiles) {
    const pw = platformWeight[p.platform];
    max += pw;
    score += pw * weight[p.status];
  }
  const socialScore = max > 0 ? Math.round((score / max) * 100) : 0;
  return { profiles, socialScore };
}
