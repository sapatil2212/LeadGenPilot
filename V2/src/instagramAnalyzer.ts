/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser } from "playwright";
import { logger } from "./logger";

export interface InstagramAnalysis {
  url: string;
  followers: number | null;
  posts: number | null;
  lastPostDate: string;
  status: "NOT_FOUND" | "ACTIVE" | "INACTIVE";
}

function extractInstagramHandle(url: string): string | null {
  if (!url) return null;
  const match = url.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (match) {
    const handle = match[1];
    if (["p", "explore", "reels", "direct", "stories"].includes(handle.toLowerCase())) {
      return null;
    }
    return handle;
  }
  return null;
}

function parseGoogleSearchDate(text: string): Date | null {
  if (!text) return null;
  const clean = text.toLowerCase().trim();
  const now = new Date();
  
  // 1. Relative dates: "X hours ago", "X days ago", "X weeks ago", "X months ago", "X years ago"
  if (clean.includes("hour") || clean.includes("hr") || clean.includes("minute") || clean.includes("min") || clean.includes("just now")) {
    return now;
  }
  
  const dayMatch = clean.match(/(\d+)\s*d/);
  if (dayMatch) {
    now.setDate(now.getDate() - parseInt(dayMatch[1], 10));
    return now;
  }
  const dayAgoMatch = clean.match(/(\d+)\s*day/);
  if (dayAgoMatch) {
    now.setDate(now.getDate() - parseInt(dayAgoMatch[1], 10));
    return now;
  }
  
  if (clean.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now;
  }
  
  const wkMatch = clean.match(/(\d+)\s*wk/);
  if (wkMatch) {
    now.setDate(now.getDate() - parseInt(wkMatch[1], 10) * 7);
    return now;
  }
  const weekAgoMatch = clean.match(/(\d+)\s*week/);
  if (weekAgoMatch) {
    now.setDate(now.getDate() - parseInt(weekAgoMatch[1], 10) * 7);
    return now;
  }
  
  const monthAgoMatch = clean.match(/(\d+)\s*month/);
  if (monthAgoMatch) {
    now.setMonth(now.getMonth() - parseInt(monthAgoMatch[1], 10));
    return now;
  }
  
  const yearAgoMatch = clean.match(/(\d+)\s*year/);
  if (yearAgoMatch) {
    now.setFullYear(now.getFullYear() - parseInt(yearAgoMatch[1], 10));
    return now;
  }
  
  // 2. Absolute dates: "27 May 2026", "May 27, 2026", "27-May-2026"
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }
  
  return null;
}

export async function analyzeInstagram(browser: Browser, businessName: string): Promise<InstagramAnalysis> {
  const result: InstagramAnalysis = {
    url: "",
    followers: null,
    posts: null,
    lastPostDate: "",
    status: "NOT_FOUND"
  };

  let page = null;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "en-US"
    });
    page = await context.newPage();

    const query = `${businessName} Instagram`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    logger.info(`Searching Google for Instagram profile: ${query}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    const snippetData = await page.evaluate(() => {
      const results = Array.from(document.querySelectorAll('div.g'));
      for (const res of results) {
        const linkEl = res.querySelector('a[href]');
        if (linkEl) {
          const href = (linkEl as HTMLAnchorElement).href;
          if (href.includes('instagram.com/') && !href.includes('google.com') && !href.includes('/search')) {
            return {
              href,
              text: res.textContent || ''
            };
          }
        }
      }
      const anchors = Array.from(document.querySelectorAll('a[href*="instagram.com/"]'));
      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        if (!href.includes('google.com') && !href.includes('/search')) {
          let parent = a.parentElement;
          for (let i = 0; i < 5; i++) {
            if (parent && (parent.classList.contains('g') || parent.textContent!.length > 100)) {
              return { href, text: parent.textContent || '' };
            }
            parent = parent?.parentElement || null;
          }
          return { href, text: '' };
        }
      }
      return null;
    });

    if (snippetData && snippetData.href) {
      result.url = snippetData.href;
      result.status = "ACTIVE"; // Default if found

      // Try to parse followers and posts from the Google Snippet text
      const snippetText = snippetData.text;
      
      const followersMatch = snippetText.match(/([\d,.]*[KkMm]?)\s*Followers/i);
      if (followersMatch) {
        const raw = followersMatch[1].toLowerCase();
        let val = parseFloat(raw.replace(/[^0-9.]/g, ''));
        if (raw.includes('k')) val *= 1000;
        if (raw.includes('m')) val *= 1000000;
        result.followers = isNaN(val) ? null : Math.round(val);
      }

      const postsMatch = snippetText.match(/([\d,.]*)\s*Posts/i);
      if (postsMatch) {
        const raw = postsMatch[1].toLowerCase();
        const val = parseInt(raw.replace(/[^0-9]/g, ''), 10);
        result.posts = isNaN(val) ? null : val;
      }

      // Try checking the Instagram last post date via Google Search snippets
      const handle = extractInstagramHandle(result.url);
      let newestDate: Date | null = null;

      if (handle) {
        try {
          const siteSearchUrl = `https://www.google.com/search?q=site%3Ainstagram.com+%22${handle}%22`;
          logger.info(`Searching Google index for Instagram posts of ${handle}: ${siteSearchUrl}`);
          await page.goto(siteSearchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

          const rawDates = await page.evaluate(() => {
            const list: string[] = [];
            
            // 1. Selector matches standard snippet dates
            const spans = document.querySelectorAll('div.VwiC3b span.YrbPuc > span');
            spans.forEach(span => {
              if (span.textContent) list.push(span.textContent);
            });
            
            // 2. Scan snippet containers for general date patterns
            const divs = document.querySelectorAll('div.VwiC3b');
            divs.forEach(div => {
              const text = div.textContent || "";
              // Relative match
              const relMatch = text.match(/(\d+\s+(?:days|day|weeks|week|months|month|years|year|hours|hour|mins|min|hrs|hr)\s+ago)/i);
              if (relMatch) list.push(relMatch[1]);
              if (text.toLowerCase().includes("yesterday")) list.push("yesterday");

              // Absolute match: e.g. "June 7, 2026" or "7 June 2026"
              const absMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4})/i) ||
                               text.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i);
              if (absMatch) list.push(absMatch[1]);
            });

            // 3. Scan cite tags for dates
            const cites = document.querySelectorAll('cite');
            cites.forEach(cite => {
              const text = cite.textContent || "";
              if (text.includes('·')) {
                const parts = text.split('·');
                list.push(parts[parts.length - 1]);
              } else if (text.toLowerCase().includes("ago") || text.toLowerCase().includes("yesterday")) {
                list.push(text);
              }
            });

            return list;
          });

          // Parse collected date strings and track the newest one
          for (const rawStr of rawDates) {
            const parsed = parseGoogleSearchDate(rawStr);
            if (parsed) {
              if (!newestDate || parsed > newestDate) {
                newestDate = parsed;
              }
            }
          }
        } catch (searchErr) {
          logger.warn(`Google index search failed for handle ${handle}: ${searchErr}`);
        }
      }

      if (newestDate) {
        result.lastPostDate = newestDate.toISOString().split('T')[0];
        const diffMs = Date.now() - newestDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 90) {
          result.status = "INACTIVE";
        } else {
          result.status = "ACTIVE";
        }
        logger.success(`Instagram last post date extracted via Google: ${result.lastPostDate} (Status: ${result.status})`);
      } else {
        // Direct profile page visitor fallback
        try {
          logger.info(`Visiting Instagram profile directly as fallback: ${result.url}`);
          await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 10000 });
          
          const timeVal = await page.evaluate(() => {
            const timeEl = document.querySelector('time');
            return timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent || '' : '';
          });

          if (timeVal) {
            result.lastPostDate = timeVal.split('T')[0];
            const diffMs = Date.now() - new Date(timeVal).getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays > 90) {
              result.status = "INACTIVE";
            } else {
              result.status = "ACTIVE";
            }
            logger.success(`Instagram last post date extracted directly: ${result.lastPostDate} (Status: ${result.status})`);
          }
        } catch (err) {
          logger.warn(`Failed to inspect Instagram page directly: ${err}. Defaulting to status ACTIVE.`);
        }
      }
    }
  } catch (error) {
    logger.warn(`Instagram analysis failed: ${error}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  return result;
}
