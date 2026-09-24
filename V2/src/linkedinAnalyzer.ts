/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser } from "playwright";
import { logger } from "./logger";

export interface LinkedInAnalysis {
  url: string;
  status: "NOT_FOUND" | "ACTIVE";
}

export async function analyzeLinkedIn(browser: Browser, businessName: string): Promise<LinkedInAnalysis> {
  const result: LinkedInAnalysis = {
    url: "",
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

    const query = `${businessName} LinkedIn`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    logger.info(`Searching Google for LinkedIn presence: ${query}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    const snippetData = await page.evaluate(() => {
      const results = Array.from(document.querySelectorAll('div.g'));
      for (const res of results) {
        const linkEl = res.querySelector('a[href]');
        if (linkEl) {
          const href = (linkEl as HTMLAnchorElement).href;
          if ((href.includes('linkedin.com/company/') || href.includes('linkedin.com/in/')) && 
              !href.includes('google.com') && 
              !href.includes('/search')) {
            return href;
          }
        }
      }
      const anchors = Array.from(document.querySelectorAll('a[href*="linkedin.com/company/"], a[href*="linkedin.com/in/"]'));
      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        if (!href.includes('google.com') && !href.includes('/search')) {
          return href;
        }
      }
      return '';
    });

    if (snippetData) {
      result.url = snippetData;
      result.status = "ACTIVE";
      logger.success(`LinkedIn page identified: ${result.url}`);
    } else {
      logger.info(`No LinkedIn presence identified for: ${businessName}`);
    }
  } catch (error) {
    logger.warn(`LinkedIn analysis failed: ${error}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  return result;
}
