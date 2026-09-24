/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser } from "playwright";
import { logger } from "./logger";

export interface FacebookAnalysis {
  url: string;
  lastPostDate: string;
  status: "NOT_FOUND" | "ACTIVE" | "INACTIVE";
}

export function parseRelativeDate(text: string): Date | null {
  if (!text) return null;
  const clean = text.toLowerCase().trim();
  const now = new Date();
  
  if (clean.includes("hr") || clean.includes("hour") || clean.includes("min") || clean.includes("sec") || clean.includes("just now")) {
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

  const parsed = Date.parse(text);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return null;
}

export async function analyzeFacebook(browser: Browser, businessName: string): Promise<FacebookAnalysis> {
  const result: FacebookAnalysis = {
    url: "",
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

    const query = `${businessName} Facebook`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    logger.info(`Searching Google for Facebook page: ${query}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    const snippetData = await page.evaluate(() => {
      const results = Array.from(document.querySelectorAll('div.g'));
      for (const res of results) {
        const linkEl = res.querySelector('a[href]');
        if (linkEl) {
          const href = (linkEl as HTMLAnchorElement).href;
          if (href.includes('facebook.com/') && !href.includes('google.com') && !href.includes('/search') && !href.includes('sharer.php')) {
            return href;
          }
        }
      }
      const anchors = Array.from(document.querySelectorAll('a[href*="facebook.com/"]'));
      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        if (!href.includes('google.com') && !href.includes('/search') && !href.includes('sharer.php')) {
          return href;
        }
      }
      return '';
    });

    if (snippetData) {
      result.url = snippetData;
      result.status = "ACTIVE"; // Default if found

      try {
        logger.info(`Visiting Facebook page to check last post date: ${result.url}`);
        await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 10000 });
        
        const postDateText = await page.evaluate(() => {
          const timeEl = document.querySelector('time');
          if (timeEl) return timeEl.getAttribute('datetime') || timeEl.textContent || '';
          
          const postLinks = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink.php"], a[href*="/photos/"]'));
          for (const a of postLinks) {
            if (a.textContent && a.textContent.length > 2 && a.textContent.length < 25) {
              return a.textContent;
            }
          }
          return '';
        });

        if (postDateText) {
          const parsedDate = parseRelativeDate(postDateText);
          if (parsedDate) {
            result.lastPostDate = parsedDate.toISOString().split('T')[0];
            const diffMs = Date.now() - parsedDate.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays > 90) {
              result.status = "INACTIVE";
            } else {
              result.status = "ACTIVE";
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to inspect Facebook page directly: ${err}. Defaulting to status ACTIVE.`);
      }
    }
  } catch (error) {
    logger.warn(`Facebook analysis failed: ${error}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  return result;
}
