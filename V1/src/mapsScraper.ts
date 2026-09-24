/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { chromium, Browser, Page } from "playwright";
import { CONFIG as DEFAULT_CRITERIA } from "./config";
import { Config, Lead } from "./types";
import { logger } from "./logger";
import { duplicateChecker } from "./duplicateChecker";
import { sendLeadToWebhook } from "./googleSheetsWebhook";
import { analyzeWebsite } from "./websiteAnalyzer";
import { analyzeInstagram } from "./instagramAnalyzer";
import { analyzeFacebook } from "./facebookAnalyzer";
import { analyzeLinkedIn } from "./linkedinAnalyzer";
import { evaluate, builtInRuleSet, type ScorableLead } from "./scoring";
import { buildSearchQueries } from "./icp/icpService";
import { generateSalesInsight } from "./aiInsights";
import { runGrowthIntelligence } from "./analysis/growthIntelligenceAgent";
import { growthIntelligenceToLeadFields } from "./analysis/leadFields";
import { buildSnapshot, recordScan } from "./analysis/monitoringEngine";

/**
 * Search parameters for one discovery run.
 *
 * Previously the scraper read these from the shared mutable `CONFIG` singleton,
 * which made a run's parameters process-global: a second tenant saving their
 * search redirected a scrape already in flight, and the plan-quota capper
 * permanently lowered `maxResults` for everybody. Criteria now arrive as an
 * argument, so a run is described entirely by the job that started it.
 */
export type ScrapeCriteria = Config;

/** Progress snapshot for the job row backing this run. */
export interface ScrapeProgress {
  stage: string;
  current: number;
  total: number;
  added?: number;
  failed?: number;
  currentBusiness?: string;
}

export type ProgressReporter = (progress: ScrapeProgress) => void;

/**
 * Tenant-specific behaviour injected into a run.
 *
 * The scraper stays free of database access and of any tenant concept: it is
 * handed the queries to execute, a predicate for what to keep, a duplicate check
 * and a scorer, and it reports back what it saw. Everything workspace-shaped —
 * which rule set, whose dedupe history, which ICP — is resolved by the caller in
 * server.ts and passed in.
 *
 * That boundary is deliberate. The alternative, a scraper that reads the tenant's
 * configuration itself, is what produced the shared mutable CONFIG object: once
 * this module owns state, that state ends up process-global.
 *
 * Every hook is optional, so the CLI entry point still works with no plan at all.
 */
export interface DiscoveryPlan {
  /** Search queries to run. Falls back to businessType/location when absent. */
  queries?: string[];

  /**
   * Rejects a candidate before any analyzer runs. Each rejected business
   * otherwise costs four page loads to reach the same conclusion.
   */
  filter?: (candidate: {
    businessName: string;
    category: string;
    address: string;
    rating: number;
    reviews: number;
  }) => { keep: boolean; reason?: string };

  /** True when this workspace has already discovered the business. */
  isDuplicate?: (businessName: string, address: string) => boolean;

  /**
   * Called for every business examined, kept or not.
   *
   * Recording a rejection is what stops the next run re-analysing it. The old
   * duplicate store only learned about a business after its webhook delivery
   * succeeded, so anything filtered out — or persisted to the CRM without a
   * Sheets integration — was re-scraped in full on every subsequent run.
   */
  onSeen?: (info: {
    businessName: string;
    address: string;
    phone: string;
    category: string;
    kept: boolean;
    reason?: string;
  }) => void;

  /** Scores a lead. Defaults to the built-in rule set. */
  score?: (lead: ScorableLead) => {
    score: number;
    max: number;
    priority: "HOT" | "WARM" | "COLD";
    breakdown: { signal: string; label: string; points: number }[];
    ruleSetId?: string;
    ruleSetVersion: number;
  };

  /** Attribution written onto each lead. */
  icpProfileId?: string | null;

  /** Tenant attribution for AI calls, so usage is metered to the right workspace. */
  tenantId?: string;
  userId?: string;
}

/**
 * Per-run cancellation.
 *
 * Replaces the module-level `stopRequested` boolean, which was one flag for the
 * whole process — POST /api/stop-scraper aborted whichever tenant's scrape
 * happened to be running, with no ownership check. A token belongs to a single
 * run, so cancelling one cannot touch another.
 *
 * The scraper checks this synchronously at ~15 points; the caller is responsible
 * for deciding when to flip it (server.ts polls the job row, so cancellation
 * survives being requested by a different HTTP request or process).
 */
export class CancellationToken {
  private cancelled = false;
  private reason = "";

  cancel(reason = "cancelled"): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.reason = reason;
    logger.warn(`Cancellation requested: ${reason}`);
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get cancellationReason(): string {
    return this.reason;
  }
}

/**
 * Tokens for runs currently in flight, so process shutdown can stop all of them.
 *
 * This is the one legitimate global: SIGTERM must halt every run regardless of
 * which tenant owns it. Everything else addresses a specific token.
 */
const activeTokens = new Set<CancellationToken>();

/** Cancels every in-flight run. For shutdown only. Returns how many were signalled. */
export function cancelAllScrapes(reason = "server is shutting down"): number {
  const count = activeTokens.size;
  for (const token of activeTokens) token.cancel(reason);
  return count;
}

/**
 * A visible (non-headless) browser needs a real X server. On Linux servers there
 * is normally none, and a set-but-dead $DISPLAY is not a reliable signal, so we
 * force headless on Linux regardless of the UI toggle.
 * Set PLAYWRIGHT_HEADLESS=false (e.g. when running under xvfb-run) to override.
 */
function resolveHeadless(criteria: ScrapeCriteria): boolean {
  const envOverride = process.env.PLAYWRIGHT_HEADLESS;
  if (envOverride !== undefined) {
    return envOverride.toLowerCase() !== "false" && envOverride !== "0";
  }

  if (process.platform === "linux" && !criteria.headless) {
    logger.warn(
      "Headed mode requested on a Linux host - forcing headless because no X server is expected. " +
      "Set PLAYWRIGHT_HEADLESS=false and run under xvfb-run to keep headed mode."
    );
    return true;
  }

  return criteria.headless;
}

/**
 * Wraps chromium.launch so a missing browser binary produces an actionable
 * message instead of Playwright's generic "Executable doesn't exist" dump.
 */
async function launchChromium(isHeadless: boolean): Promise<Browser> {
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: isHeadless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800",
    ]
  };

  // Allows pointing at a system Chrome/Chromium instead of Playwright's download.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    logger.info(`Using Chromium executable from environment: ${executablePath}`);
  }

  try {
    return await chromium.launch(launchOptions);
  } catch (err: any) {
    const message = String(err?.message || err);

    // Last-resort self-heal: a headed launch died because there is no X server.
    if (!isHeadless && /XServer|Missing X server|\$DISPLAY|platform failed to initialize/i.test(message)) {
      logger.warn("Headed launch failed (no X server available). Retrying in headless mode...");
      return await chromium.launch({ ...launchOptions, headless: true });
    }

    if (/Executable doesn'?t exist|Failed to launch|ENOENT/i.test(message)) {
      throw new Error(
        "Chromium is not installed for the Playwright runtime used by this server. Run 'npm run setup:browsers' " +
        "as the same user that runs the server (or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chrome binary). " +
        `Expected executable: ${chromium.executablePath()}. ` +
        `Original error: ${message}`
      );
    }
    throw err;
  }
}

/**
 * Search queries for a run, from the criteria alone.
 *
 * Prefers the explicit `categories` and `locations` arrays the ICP supplies, and
 * falls back to splitting the legacy comma-separated fields.
 *
 * WHAT WAS REMOVED, AND WHY
 * -------------------------
 * This function used to expand "dental, skin clinic" into "dental clinic" and
 * "skin clinic" by matching the last word of the final part against a hardcoded
 * list of thirty English business nouns — hospital, clinic, salon, dealer, spa
 * and so on. A fixed vocabulary of what a business can be is exactly what a
 * universal platform cannot have: any category outside the list was silently
 * searched for as written, the list was unreachable from the UI, and the rule
 * only applied when the LAST part happened to end in a listed word, so the same
 * input in a different order behaved differently.
 *
 * The ICP holds categories as an explicit array, so each one is stated in full
 * and no guessing is needed. A workspace that relied on the old expansion should
 * list "dental clinic" and "skin clinic" as two categories, which is what it was
 * trying to express.
 */
export function parseSearchQueries(businessType: string, location: string): string[] {
  const categories = businessType.split(",").map((p) => p.trim()).filter(Boolean);
  const locations = location.split(",").map((p) => p.trim()).filter(Boolean);
  return buildSearchQueries(
    categories.length ? categories : [businessType],
    locations.length ? locations : [location]
  );
}

/** Resolves the queries for a run, preferring an explicit plan. */
function resolveQueries(criteria: ScrapeCriteria, plan?: DiscoveryPlan): string[] {
  if (plan?.queries?.length) return plan.queries;

  if (criteria.categories?.length && criteria.locations?.length) {
    return buildSearchQueries(criteria.categories, criteria.locations);
  }

  return parseSearchQueries(criteria.businessType, criteria.location);
}

async function extractDetailsFromPage(page: Page) {
  return await page.evaluate(() => {
    let name = "";
    const nameEl = document.querySelector('h1') || document.querySelector('h1.DUwDvf') || document.querySelector('div.x3b7o h1');
    if (nameEl) name = (nameEl.textContent || "").trim();

    let ratingNum = 0;
    let reviewsNum = 0;

    // Extract rating
    const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') ||
                     document.querySelector('div.F7nice span span');
    if (ratingEl) {
      const match = ratingEl.textContent?.match(/([0-9]\.[0-9])/);
      if (match) {
        ratingNum = parseFloat(match[1]);
      } else {
        const clean = ratingEl.textContent?.replace(/[^0-9.]/g, "");
        if (clean) {
          const num = parseFloat(clean);
          if (!isNaN(num)) ratingNum = num;
        }
      }
    }

    // Extract reviews count
    const reviewsEl = document.querySelector('div.F7nice span[aria-label*="reviews"]') ||
                      document.querySelector('div.F7nice [aria-label*="reviews"]') ||
                      document.querySelector('[aria-label*="reviews"]');
    if (reviewsEl) {
      const ariaLabel = reviewsEl.getAttribute('aria-label');
      const matchLabel = ariaLabel?.replace(/[^0-9]/g, "");
      if (matchLabel) {
        reviewsNum = parseInt(matchLabel, 10);
      } else {
        const matchText = reviewsEl.textContent?.replace(/[^0-9]/g, "");
        if (matchText) reviewsNum = parseInt(matchText, 10);
      }
    } else {
      // Sibling fallback if aria-labels are missing (reviews is the second outer span)
      const spans = document.querySelectorAll('div.F7nice > span');
      if (spans.length > 1) {
        const matchText = spans[1].textContent?.replace(/[^0-9]/g, "");
        if (matchText) reviewsNum = parseInt(matchText, 10);
      }
    }

    let webUrl = "";
    const webEl = Array.from(document.querySelectorAll('a[href]')).find(a => {
      const itemId = a.getAttribute('data-item-id') || '';
      const label = a.getAttribute('aria-label') || '';
      const tooltip = a.getAttribute('data-tooltip') || '';
      return itemId === 'authority' || 
             label.toLowerCase().includes('website') || 
             tooltip.toLowerCase().includes('website');
    });
    if (webEl) webUrl = (webEl as HTMLAnchorElement).href;

    let phoneVal = "";
    const phoneEl = Array.from(document.querySelectorAll('*')).find(el => {
      const itemId = el.getAttribute('data-item-id') || '';
      const label = el.getAttribute('aria-label') || '';
      return itemId.startsWith('phone:tel:') || label.startsWith('Phone:');
    });
    if (phoneEl) {
      const attr = phoneEl.getAttribute('aria-label') || phoneEl.getAttribute('data-item-id') || phoneEl.textContent || "";
      phoneVal = attr.replace("Phone:", "").replace("phone:tel:", "").trim();
    } else {
      const telLink = document.querySelector('a[href^="tel:"]');
      if (telLink) phoneVal = telLink.getAttribute('href')?.replace('tel:', '').trim() || "";
    }

    let addressVal = "";
    const addressEl = Array.from(document.querySelectorAll('*')).find(el => {
      const itemId = el.getAttribute('data-item-id') || '';
      const label = el.getAttribute('aria-label') || '';
      const tooltip = el.getAttribute('data-tooltip') || '';
      return itemId === 'address' || label.startsWith('Address:') || tooltip.toLowerCase().includes('copy address');
    });
    if (addressEl) {
      const attr = addressEl.getAttribute('aria-label') || addressEl.getAttribute('data-item-id') || addressEl.textContent || "";
      addressVal = attr.replace("Address:", "").replace("address", "").trim();
    }

    let catVal = "";
    const catEl = document.querySelector("button[jsaction*='category']");
    if (catEl) catVal = catEl.textContent?.trim() || "";

    return {
      businessName: name,
      rating: ratingNum,
      reviews: reviewsNum,
      website: webUrl,
      phone: phoneVal,
      address: addressVal,
      category: catVal
    };
  });
}

interface ScrapingResult {
  scannedCount: number;
  withoutWebsiteCount: number;
  addedCount: number;
  failedCount: number;
  leads: Lead[];
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function extractCoordinatesFromUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null;
  const matchPlace = url.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
  if (matchPlace) {
    return {
      lat: parseFloat(matchPlace[1]),
      lng: parseFloat(matchPlace[2])
    };
  }
  const matchAt = url.match(/@(-?[0-9.]+),(-?[0-9.]+)/);
  if (matchAt) {
    return {
      lat: parseFloat(matchAt[1]),
      lng: parseFloat(matchAt[2])
    };
  }
  return null;
}

/**
 * Normalizes rating string to number
 */
function parseRating(text: string | null): number {
  if (!text) return 0;
  const match = text.match(/([0-9]\.[0-9])/);
  if (match) {
    return parseFloat(match[1]);
  }
  const clean = text.replace(/[^0-9.]/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalizes reviews count string to number
 */
function parseReviews(text: string | null): number {
  if (!text) return 0;
  // match digits optionally separated by commas or dots or 'K' helper
  const clean = text.replace(/[^0-9]/g, "");
  const num = parseInt(clean, 10);
  return isNaN(num) ? 0 : num;
}

function generateSheetName(criteria: ScrapeCriteria): string {
  let type = criteria.businessType.trim();
  // Clean special characters invalid in sheet names
  type = type.replace(/[\\/\?\*:\[\]]/g, "");
  // Limit to 31 characters for Google Sheets tab compatibility
  return type.substring(0, 31).trim();
}

/**
 * Runs one lead-discovery pass.
 *
 * @param criteria  Search parameters for THIS run. Defaults to the compile-time
 *                  CONFIG so the CLI entry point (src/main.ts) keeps working
 *                  unchanged; the server always passes per-job criteria.
 * @param token     Per-run cancellation. A fresh token means "never cancelled".
 * @param customWebhookUrl  Tenant's Google Sheets webhook, when configured.
 */
export async function runScraper(
  criteria: ScrapeCriteria = DEFAULT_CRITERIA,
  token: CancellationToken = new CancellationToken(),
  customWebhookUrl?: string,
  onProgress?: ProgressReporter,
  plan?: DiscoveryPlan
): Promise<ScrapingResult> {
  activeTokens.add(token);
  try {
    return await executeScrape(criteria, token, customWebhookUrl, onProgress, plan);
  } finally {
    activeTokens.delete(token);
  }
}

/** Scores with the plan's rule set, or the built-in one for the CLI path. */
function resolveScorer(plan?: DiscoveryPlan) {
  if (plan?.score) return plan.score;
  const fallback = builtInRuleSet();
  return (lead: ScorableLead) => {
    const result = evaluate(lead, fallback);
    return {
      score: result.score,
      max: result.max,
      priority: result.priority,
      breakdown: result.breakdown,
      ruleSetId: result.ruleSetId,
      ruleSetVersion: result.ruleSetVersion,
    };
  };
}

async function executeScrape(
  criteria: ScrapeCriteria,
  token: CancellationToken,
  customWebhookUrl?: string,
  onProgress?: ProgressReporter,
  plan?: DiscoveryPlan
): Promise<ScrapingResult> {
  /** Reports progress without ever letting a reporting failure break the run. */
  const report = (progress: ScrapeProgress) => {
    try {
      onProgress?.(progress);
    } catch {
      /* progress reporting is best-effort */
    }
  };
  const query = `${criteria.businessType} in ${criteria.location}`;
  logger.info(`Starting lead search for: '${query}'`);
  
  // Auto-geocode criteria.location to align search center coordinates
  try {
    logger.info(`Geocoding search location '${criteria.location}' to align search center coordinates...`);
    const axios = (await import("axios")).default;
    const geoResponse = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(criteria.location)}&format=json&limit=1`, {
      headers: {
        "User-Agent": "LeadGenPilot-Agent/1.0"
      },
      timeout: 5000
    });
    if (geoResponse.data && geoResponse.data.length > 0) {
      criteria.lat = parseFloat(geoResponse.data[0].lat);
      criteria.lng = parseFloat(geoResponse.data[0].lon);
      logger.info(`Aligned search center coordinates to Lat: ${criteria.lat}, Lng: ${criteria.lng}`);
    } else {
      logger.warn(`Could not geocode location '${criteria.location}'. Proceeding with existing coordinates.`);
    }
  } catch (e: any) {
    logger.warn(`Failed to geocode location '${criteria.location}': ${e.message || e}. Proceeding with existing coordinates.`);
  }

  const sheetName = generateSheetName(criteria);
  
  const startTime = Date.now();
  let browser: Browser | null = null;
  let leadsFound: Lead[] = [];
  let scannedCount = 0;
  let withoutWebsiteCount = 0;
  let addedCount = 0;
  let failedCount = 0;

  try {
    const isHeadless = resolveHeadless(criteria);
    logger.info(`Launching Chromium browser (headless: ${isHeadless}) with Playwright...`);
    browser = await launchChromium(isHeadless);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "en-US"
    });

    const page = await context.newPage();
    
    const queries = resolveQueries(criteria, plan);
    logger.info(`Generated ${queries.length} search queries to execute sequentially.`);
    if (queries.length === 0) {
      throw new Error(
        "Nothing to search for: this run has no target categories or locations. " +
          "Set them on your customer profile."
      );
    }
    const scorer = resolveScorer(plan);
    const placeLinks = new Set<string>();

    for (const queryToRun of queries) {
      if (token.isCancelled) {
        logger.warn("Scraping cancelled by user during query sequence.");
        break;
      }
      if (placeLinks.size >= criteria.maxResults) {
        break;
      }

      logger.info(`Searching Google Maps for query: '${queryToRun}'`);
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(queryToRun)}`;
      logger.info(`Navigating directly to Google Maps search page: ${searchUrl}`);
      
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch (err: any) {
        logger.error(`Failed to navigate to search URL for query '${queryToRun}':`, err);
        continue;
      }
      
      // Handle European / Cookie Consent Modal if it appears
      try {
        const consentButtons = [
          "button[aria-label*='Accept all']",
          "button[aria-label*='Agree']",
          "button:has-text('Accept all')",
          "button:has-text('I agree')",
          "button[class*='VfP3Zd']", // German consent buttons classes
        ];
        for (const selector of consentButtons) {
          const btn = page.locator(selector).first();
          if (await btn.isVisible()) {
            logger.info(`Clicking cookie/consent accept button matching: ${selector}`);
            await btn.click();
            await page.waitForTimeout(2000);
            break;
          }
        }
      } catch (e) {
        // safe to proceed
      }

      // Wait for results container or list to load
      logger.info("Waiting for search results feed...");
      try {
        await page.waitForSelector("a[href*='/maps/place/']", { timeout: 10000 });
      } catch (e) {
        logger.warn("Could not find place link results container. checking fallback list...");
      }

      // Scroll results feed to discover listings
      logger.info(`Scanning and scrolling business results panel for '${queryToRun}'...`);
      let queryPrevSize = placeLinks.size;
      let scrollAttempts = 0;
      const maxScrollAttempts = 15; // Limit per query scroll to prevent taking too long

      while (placeLinks.size < criteria.maxResults && scrollAttempts < maxScrollAttempts) {
        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user during scrolling.");
          break;
        }
        scrollAttempts++;
        
        // Select all links referencing detailed coordinates or place identifiers
        const links = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
          return anchors.map(a => (a as HTMLAnchorElement).href).filter(Boolean);
        });

        for (const link of links) {
          placeLinks.add(link);
        }

        logger.info(`Scrolling... Found ${placeLinks.size} business URLs so far...`);

        if (placeLinks.size >= criteria.maxResults) {
          logger.info(`Reached goal: extracted ${placeLinks.size} links.`);
          break;
        }

        // Perform human-like scroll down on the results panel robustly
        await page.evaluate(() => {
          const findScrollContainer = () => {
            let el = document.querySelector('div[role="feed"]');
            if (el) return el;
            const link = document.querySelector('a[href*="/maps/place/"]');
            if (link) {
              let parent = link.parentElement;
              while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                  return parent;
                }
                parent = parent.parentElement;
              }
            }
            return document.querySelector('.m67Bo') || document.querySelector('div[role="main"]');
          };
          const container = findScrollContainer() as HTMLElement;
          if (container) {
            container.scrollBy(0, 1000);
          } else {
            window.scrollBy(0, 1000);
          }
        });

        // Randomized delays to mimic human interaction
        await page.waitForTimeout(1000 + Math.random() * 1000);

        // Break if we've reached the very bottom of listings
        const isEnd = await page.evaluate(() => {
          const endText = ["You've reached the end of the list.", "No more results", "End of list"];
          return endText.some(text => document.body.innerText.includes(text));
        });

        if (isEnd) {
          logger.success("Google Maps matches complete for this query. Reached the end of list.");
          break;
        }

        // If size hasn't grown in multiple iterations, stop
        if (placeLinks.size === queryPrevSize) {
          if (scrollAttempts > 5) {
            logger.info("Scroller paused. No new listings found for this query after multiple attempts.");
            break;
          }
        }
        queryPrevSize = placeLinks.size;
      }
    }

    const targetUrls = Array.from(placeLinks).slice(0, criteria.maxResults);
    logger.success(`Extraction complete! Found ${targetUrls.length} total target URLs.`);
    report({ stage: "discovered", current: 0, total: targetUrls.length });

    if (targetUrls.length === 0) {
      logger.warn("No business listings extracted directly from Google Maps page.");
      if (criteria.enableSimulation) {
        logger.info("Piping fallback to high-fidelity AI simulation scanner to produce realistic local leads...");
        if (browser) {
          await browser.close();
          browser = null;
        }
        return await runSimulationScanner(criteria, token, customWebhookUrl, plan);
      } else {
        throw new Error("No businesses extracted. Headless mode might be blocked by Google Maps bot protection, or no results were found for the query.");
      }
    }

    // Step 2: Query details for each target business
    for (const url of targetUrls) {
      if (token.isCancelled) {
        logger.warn("Scraping cancelled by user during details extraction loop.");
        break;
      }
      scannedCount++;
      logger.info(`--- Processing [${scannedCount}/${targetUrls.length}] ---`);
      report({
        stage: "analysing",
        current: scannedCount,
        total: targetUrls.length,
        added: addedCount,
        failed: failedCount,
      });

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        try {
          await page.waitForSelector("h1", { timeout: 8000 });
        } catch (e) {
          // Proceed anyway
        }
        await page.waitForTimeout(1000 + Math.random() * 1000); // Wait for content paint

        // --- EXTRACT BUSINESS DETAILS WITH ROBUST EVALUATIONS ---
        let details = await extractDetailsFromPage(page);
        if (!details.phone || !details.address) {
          logger.info(`Missing phone or address. Waiting 2.5s for dynamic content...`);
          await page.waitForTimeout(2500);
          details = await extractDetailsFromPage(page);
        }

        let businessName = details.businessName;
        let rating = details.rating;
        let reviews = details.reviews;
        let website = details.website;
        let phone = details.phone;
        let address = details.address;
        let category = details.category || criteria.businessType;

        if (!businessName) {
          logger.warn("Skipping place: Missing business name.");
          continue;
        }

        // Validate basic Filters (Name, Phone/Website, Rating must exist)
        const hasPhone = phone && phone.toLowerCase() !== "not found" && phone.trim() !== "";
        const hasWebsite = website && website.trim() !== "";

        if (!hasPhone && !hasWebsite) {
          logger.warn(`Skipped: '${businessName}' (Missing both Phone Number and Website)`);
          continue;
        }

        // Stash placeholder for missing phone number so we have a valid string value
        if (!hasPhone) {
          phone = "Not Found";
        }

        if (rating === 0) {
          logger.warn(`Skipped: '${businessName}' (No Ratings/Score)`);
          continue;
        }

        /*
         * Duplicate check.
         *
         * The plan supplies a workspace-scoped check. The legacy
         * duplicateChecker is the fallback for the CLI entry point only: it reads
         * one process-wide JSON file, so under the server it suppressed a
         * business for every tenant once any tenant had seen it.
         */
        const isDuplicate = plan?.isDuplicate
          ? plan.isDuplicate(businessName, address)
          : duplicateChecker.isDuplicate(businessName, address);
        if (isDuplicate) {
          logger.warn(`Skipped: '${businessName}' (already discovered by this workspace)`);
          continue;
        }

        /*
         * ICP exclusions and the reputation floor, applied before the analyzers.
         *
         * Ordering matters for cost, not correctness: each rejected business
         * would otherwise cost four page loads — website, Instagram, Facebook,
         * LinkedIn — to reach a conclusion available from the listing alone.
         * A search for "clinic" returns the tenant's own competitors as readily
         * as prospects, so this rejects a real share of results.
         */
        if (plan?.filter) {
          const verdict = plan.filter({ businessName, category, address, rating, reviews });
          if (!verdict.keep) {
            logger.warn(`Skipped: '${businessName}' (${verdict.reason || "excluded by the customer profile"})`);
            plan.onSeen?.({
              businessName,
              address,
              phone,
              category,
              kept: false,
              reason: verdict.reason,
            });
            continue;
          }
        }

        // Coordinate / Distance Filter Check
        const coords = extractCoordinatesFromUrl(url);
        let leadLat: number | undefined = undefined;
        let leadLng: number | undefined = undefined;
        if (coords) {
          leadLat = coords.lat;
          leadLng = coords.lng;
          if (criteria.lat && criteria.lng && criteria.radius) {
            const distance = calculateDistance(criteria.lat, criteria.lng, coords.lat, coords.lng);
            if (distance > criteria.radius) {
              logger.warn(`Skipped: '${businessName}' (Out of search radius: ${distance.toFixed(2)} km, limit is ${criteria.radius} km)`);
              continue;
            } else {
              logger.info(`Within search radius: ${distance.toFixed(2)} km from search center.`);
            }
          }
        }

        // Run website, Instagram, Facebook, and LinkedIn analyzers
        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before website analysis.");
          break;
        }

        logger.info(`Analyzing website indicators for '${businessName}'...`);
        const webAnalysis = await analyzeWebsite(browser!, website);

        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before Instagram analysis.");
          break;
        }

        logger.info(`Analyzing Instagram presence for '${businessName}'...`);
        const instaAnalysis = await analyzeInstagram(browser!, businessName);

        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before Facebook analysis.");
          break;
        }

        logger.info(`Analyzing Facebook presence for '${businessName}'...`);
        const fbAnalysis = await analyzeFacebook(browser!, businessName);

        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before LinkedIn analysis.");
          break;
        }

        logger.info(`Analyzing LinkedIn presence for '${businessName}'...`);
        const liAnalysis = await analyzeLinkedIn(browser!, businessName);

        if (webAnalysis.status !== "WORKING") {
          withoutWebsiteCount++;
        }

        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before scoring and AI insight generation.");
          break;
        }

        // Calculate Digital Presence Score
        const partialLead = {
          businessName,
          phone,
          address: address || criteria.location,
          rating,
          reviews,
          website: website || "",
          mapsUrl: url,
          category,
          websiteMissing: !website || website.trim() === "",
          lat: leadLat,
          lng: leadLng,
          
          websiteStatus: webAnalysis.status,
          instagramUrl: instaAnalysis.url,
          instagramStatus: instaAnalysis.status,
          instagramLastPost: instaAnalysis.lastPostDate,
          facebookUrl: fbAnalysis.url,
          facebookStatus: fbAnalysis.status,
          facebookLastPost: fbAnalysis.lastPostDate,
          whatsappPresent: webAnalysis.whatsappPresent,
          appointmentSystem: webAnalysis.appointmentSystem,
          emails: webAnalysis.emails,
          googleAnalyticsPresent: webAnalysis.googleAnalyticsPresent,
          metaPixelPresent: webAnalysis.metaPixelPresent,
          linkedinUrl: liAnalysis.url,
          linkedinStatus: liAnalysis.status
        };

        const scoreDetails = scorer(partialLead);

        /*
         * The denominator is the rule set's real maximum.
         *
         * Before Phase 4 this call could not pass one: the parameter did not
         * exist, the prompt defaulted to 200, and the only scorer in the product
         * topped out at 170 — so every lead was described to the model as about
         * 15% weaker than it was, and a maximally-underserved business read as
         * 85% instead of 100%.
         */
        const aiInsight = await generateSalesInsight(
          {
            ...partialLead,
            leadScore: scoreDetails.score,
            leadPriority: scoreDetails.priority,
            scoreDenominator: scoreDetails.max,
          },
          { tenantId: plan?.tenantId, userId: plan?.userId }
        );

        const fullLead: Lead = {
          ...partialLead,
          leadScore: scoreDetails.score,
          leadPriority: scoreDetails.priority,
          scoreMax: scoreDetails.max,
          scoreBreakdown: scoreDetails.breakdown,
          scoringRuleSetId: scoreDetails.ruleSetId,
          scoringVersion: scoreDetails.ruleSetVersion,
          ...(plan?.icpProfileId ? { icpProfileId: plan.icpProfileId } : {}),
          aiInsight,
          dateAdded: new Date().toISOString().split("T")[0],
          sheetName
        };

        // ── AI Growth Intelligence (opt-in, fully isolated) ──
        // Runs the deep multi-dimensional analysis pipeline, reusing the same
        // browser. Wrapped so any failure never affects the core scrape.
        if (criteria.enableDeepAnalysis && browser) {
          try {
            logger.info(`Running AI Growth Intelligence for '${businessName}'...`);
            const intel = await runGrowthIntelligence(
              browser,
              {
                businessName,
                category,
                website: website || "",
                rating,
                reviews,
                phone,
                address: address || criteria.location,
                lat: leadLat,
                lng: leadLng,
                instagramUrl: instaAnalysis.url,
                instagramStatus: instaAnalysis.status,
                instagramLastPost: instaAnalysis.lastPostDate,
                facebookUrl: fbAnalysis.url,
                facebookStatus: fbAnalysis.status,
                facebookLastPost: fbAnalysis.lastPostDate,
                linkedinUrl: liAnalysis.url,
                linkedinStatus: liAnalysis.status,
              },
              { discoverExtraSocial: criteria.deepAnalysisExtraSocial }
            );

            Object.assign(fullLead, growthIntelligenceToLeadFields(intel));
            fullLead.growthIntelligence = intel;

            // Monitoring: record snapshot and surface any changes vs last scan.
            const change = recordScan(
              buildSnapshot({
                businessName,
                address: fullLead.address,
                hasWebsite: !fullLead.websiteMissing,
                rating,
                reviews,
                intel,
              })
            );
            if (change) {
              logger.info(`Change detected for '${businessName}': ${change.changes.join("; ")}`);
            }
            logger.log(`Digital Presence Score:\n${intel.scorecard?.overallScore}/100`);
            logger.log(`Opportunity:\n₹${(intel.opportunity?.totalOpportunity || 0).toLocaleString("en-IN")} (${intel.opportunity?.priority})`);
          } catch (giErr: any) {
            logger.warn(`Growth intelligence failed for '${businessName}' (non-fatal): ${giErr?.message || giErr}`);
          }
        }

        // Premium Console Log
        logger.log(`\nFound:\n${businessName}`);
        logger.log(`Website:\n${webAnalysis.status}`);
        logger.log(`Emails:\n${webAnalysis.emails.join(", ") || "None"}`);
        logger.log(`Google Analytics:\n${webAnalysis.googleAnalyticsPresent ? "Present" : "Missing"}`);
        logger.log(`Meta Pixel:\n${webAnalysis.metaPixelPresent ? "Present" : "Missing"}`);
        logger.log(`Instagram:\n${instaAnalysis.status}`);
        logger.log(`Facebook:\n${fbAnalysis.status}`);
        logger.log(`LinkedIn:\n${liAnalysis.status}`);
        logger.log(`Lead Score:\n${scoreDetails.score}`);
        logger.log(`Priority:\n${scoreDetails.priority}\n`);

        leadsFound.push(fullLead);

        /*
         * Recorded as seen the moment it is kept, not after the webhook succeeds.
         *
         * The old ordering only remembered a business once Google Sheets accepted
         * it, so a workspace with no Sheets integration — or with a webhook
         * having a bad day — re-scraped and re-analysed the same businesses on
         * every subsequent run, paying the full four-page-load cost each time and
         * charging the lead quota again.
         */
        plan?.onSeen?.({ businessName, address, phone, category, kept: true });

        if (token.isCancelled) {
          logger.warn("Scraping cancelled by user before webhook submission.");
          break;
        }

        // Submit to Sheets webhook
        const success = await sendLeadToWebhook(fullLead, customWebhookUrl);
        if (success) {
          addedCount++;
          // Legacy process-wide cache, for the CLI path. Under the server the
          // plan's onSeen hook has already recorded it against the workspace.
          if (!plan?.onSeen) duplicateChecker.saveLead(fullLead);
          logger.success(`Added To Sheet`);
        } else {
          failedCount++;
          logger.warn(`Webhook delivery failed for '${businessName}'. Lead retained in failed cache for retry.`);
        }

      } catch (err) {
        logger.error(`Error extracting business coordinates for url: ${url}`, err);
      }
    }

  } catch (error: any) {
    logger.error("Scraper encountered a critical error during execution:", error);
    if (criteria.enableSimulation) {
      logger.warn("Piping fallback to high-fidelity AI simulation scanner...");
      return await runSimulationScanner(criteria, token, customWebhookUrl, plan);
    } else {
      throw error;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const durationMs = Date.now() - startTime;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = ((durationMs % 60000) / 1000).toFixed(0);
  const executionTimeString = `${minutes}m ${seconds}s`;

  displaySummaryTable({
    scannedCount,
    withoutWebsiteCount,
    addedCount,
    failedCount,
    executionTime: executionTimeString
  }, criteria);

  return {
    scannedCount,
    withoutWebsiteCount,
    addedCount,
    failedCount,
    leads: leadsFound
  };
}

/**
 * Runs a high-fidelity simulation in case Playwright is restricted, blocked by CAPTCHAs, 
 * or runs inside a headless docker environment without display drivers.
 */
export async function runSimulationScanner(
  criteria: ScrapeCriteria = DEFAULT_CRITERIA,
  token: CancellationToken = new CancellationToken(),
  customWebhookUrl?: string,
  plan?: DiscoveryPlan
): Promise<ScrapingResult> {
  const query = `${criteria.businessType} in ${criteria.location}`;
  logger.warn(`--- Running High-Fidelity Simulation Mode for '${query}' ---`);
  const sheetName = generateSheetName(criteria);
  const scorer = resolveScorer(plan);

  const startTime = Date.now();
  // Generated from the first target category, so a simulated run reflects what
  // this workspace actually searches for.
  const simulationCategory = criteria.categories?.[0] || criteria.businessType;
  const simulatedLeads: Partial<Lead>[] = getMockLeadsPool(simulationCategory, criteria.location);
  
  let scannedCount = 0;
  let withoutWebsiteCount = 0;
  let addedCount = 0;
  let failedCount = 0;
  const leadsFound: Lead[] = [];

  // Simulate scanning in increments (1.5s delay per log)
  for (const mock of simulatedLeads) {
    if (token.isCancelled) {
      logger.warn("Simulated scraping cancelled by user.");
      break;
    }
    if (scannedCount >= criteria.maxResults) break;
    scannedCount++;
    
    logger.info(`Scanning: Google Maps place listing [${scannedCount}/${simulatedLeads.length}]`);
    await new Promise(resolve => setTimeout(resolve, 800));

    // Validate core Filters: name, phone, rating
    const hasPhone = mock.phone && mock.phone.toLowerCase() !== "not found" && mock.phone.trim() !== "";
    const hasWebsite = mock.website && mock.website.trim() !== "";

    if (!hasPhone && !hasWebsite) {
      logger.warn(`Skipped: '${mock.businessName}' (Missing both Phone Number and Website)`);
      continue;
    }

    if (!hasPhone) {
      mock.phone = "Not Found";
    }

    if (!mock.rating) {
      logger.warn(`Skipped: '${mock.businessName}' (Missing Rating Score)`);
      continue;
    }

    // Generate simulated coordinate within search radius
    const centerLat = criteria.lat || 19.9975;
    const centerLng = criteria.lng || 73.7898;
    const radius = criteria.radius || 10;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius; // in km
    const latOffset = (distance / 111) * Math.sin(angle);
    const lngOffset = (distance / (111 * Math.cos(centerLat * Math.PI / 180))) * Math.cos(angle);
    const mockLat = centerLat + latOffset;
    const mockLng = centerLng + lngOffset;

    // Check duplicate — workspace-scoped when a plan is supplied.
    const simIsDuplicate = plan?.isDuplicate
      ? plan.isDuplicate(mock.businessName!, mock.address!)
      : duplicateChecker.isDuplicate(mock.businessName!, mock.address!);
    if (simIsDuplicate) {
      logger.warn(`Skipped: '${mock.businessName}' (already discovered by this workspace)`);
      continue;
    }

    if (plan?.filter) {
      const verdict = plan.filter({
        businessName: mock.businessName!,
        category: mock.category || "",
        address: mock.address || "",
        rating: mock.rating || 0,
        reviews: mock.reviews || 0,
      });
      if (!verdict.keep) {
        logger.warn(`Skipped: '${mock.businessName}' (${verdict.reason || "excluded by the customer profile"})`);
        continue;
      }
    }

    // Determine mock statuses dynamically to make it realistic
    const websiteStatus = (mock.websiteStatus as any) || (mock.website ? "WORKING" : "MISSING");
    const instagramStatus = (mock.instagramStatus as any) || (mock.businessName?.includes("Elite") ? "INACTIVE" : "NOT_FOUND");
    const instagramUrl = mock.instagramUrl || (instagramStatus !== "NOT_FOUND" ? `https://instagram.com/${mock.businessName?.toLowerCase().replace(/[^a-z]/g, '')}` : "");
    const instagramLastPost = mock.instagramLastPost || (instagramStatus === "ACTIVE" ? "2026-05-15" : instagramStatus === "INACTIVE" ? "2025-08-10" : "");

    const facebookStatus = (mock.facebookStatus as any) || (mock.businessName?.includes("Smile") || mock.businessName?.includes("Harvest") ? "ACTIVE" : "NOT_FOUND");
    const facebookUrl = mock.facebookUrl || (facebookStatus !== "NOT_FOUND" ? `https://facebook.com/${mock.businessName?.toLowerCase().replace(/[^a-z]/g, '')}` : "");
    const facebookLastPost = mock.facebookLastPost || (facebookStatus === "ACTIVE" ? "2026-06-01" : facebookStatus === "INACTIVE" ? "2025-09-12" : "");

    const whatsappPresent = mock.whatsappPresent !== undefined ? mock.whatsappPresent : (websiteStatus === "WORKING" && mock.businessName!.includes("Design"));
    const appointmentSystem = mock.appointmentSystem !== undefined ? mock.appointmentSystem : (websiteStatus === "WORKING" && mock.businessName!.includes("Care"));

    const emails = mock.emails || (websiteStatus === "WORKING" ? [`info@${mock.businessName?.toLowerCase().replace(/[^a-z]/g, '')}.com`] : []);
    const googleAnalyticsPresent = mock.googleAnalyticsPresent !== undefined ? mock.googleAnalyticsPresent : (websiteStatus === "WORKING" && !mock.businessName!.includes("Design"));
    const metaPixelPresent = mock.metaPixelPresent !== undefined ? mock.metaPixelPresent : (websiteStatus === "WORKING" && mock.businessName!.includes("Care"));
    
    const linkedinStatus = (mock.linkedinStatus as any) || (mock.businessName?.includes("Elite") || mock.businessName?.includes("Hub") ? "ACTIVE" : "NOT_FOUND");
    const linkedinUrl = mock.linkedinUrl || (linkedinStatus !== "NOT_FOUND" ? `https://linkedin.com/company/${mock.businessName?.toLowerCase().replace(/[^a-z]/g, '')}` : "");

    if (websiteStatus !== "WORKING") {
      withoutWebsiteCount++;
    }

    // Score
    const partialLead = {
      businessName: mock.businessName!,
      phone: mock.phone!,
      address: mock.address!,
      rating: mock.rating!,
      reviews: mock.reviews!,
      website: mock.website || "",
      mapsUrl: mock.mapsUrl!,
      category: mock.category!,
      websiteMissing: !mock.website,
      lat: mockLat,
      lng: mockLng,
      
      websiteStatus,
      instagramUrl,
      instagramStatus,
      instagramLastPost,
      facebookUrl,
      facebookStatus,
      facebookLastPost,
      whatsappPresent,
      appointmentSystem,
      emails,
      googleAnalyticsPresent,
      metaPixelPresent,
      linkedinUrl,
      linkedinStatus
    };

    const scoreDetails = scorer(partialLead);
    const aiInsight = await generateSalesInsight(
      {
        ...partialLead,
        leadScore: scoreDetails.score,
        leadPriority: scoreDetails.priority,
        scoreDenominator: scoreDetails.max,
      },
      { tenantId: plan?.tenantId, userId: plan?.userId }
    );

    const fullLead: Lead = {
      ...partialLead,
      leadScore: scoreDetails.score,
      leadPriority: scoreDetails.priority,
      scoreMax: scoreDetails.max,
      scoreBreakdown: scoreDetails.breakdown,
      scoringRuleSetId: scoreDetails.ruleSetId,
      scoringVersion: scoreDetails.ruleSetVersion,
      ...(plan?.icpProfileId ? { icpProfileId: plan.icpProfileId } : {}),
      aiInsight,
      dateAdded: new Date().toISOString().split("T")[0],
      sheetName
    };

    logger.log(`\nFound:\n${fullLead.businessName}`);
    logger.log(`Website:\n${websiteStatus}`);
    logger.log(`Emails:\n${fullLead.emails.join(", ") || "None"}`);
    logger.log(`Google Analytics:\n${fullLead.googleAnalyticsPresent ? "Present" : "Missing"}`);
    logger.log(`Meta Pixel:\n${fullLead.metaPixelPresent ? "Present" : "Missing"}`);
    logger.log(`Instagram:\n${instagramStatus}`);
    logger.log(`Facebook:\n${facebookStatus}`);
    logger.log(`LinkedIn:\n${linkedinStatus}`);
    logger.log(`Lead Score:\n${scoreDetails.score}`);
    logger.log(`Priority:\n${scoreDetails.priority}\n`);

    leadsFound.push(fullLead);

    plan?.onSeen?.({
      businessName: fullLead.businessName,
      address: fullLead.address,
      phone: fullLead.phone,
      category: fullLead.category,
      kept: true,
    });

    if (token.isCancelled) {
      logger.warn("Simulated scraping cancelled by user before webhook submission.");
      break;
    }

    // Post to Google Sheets Webhook
    const success = await sendLeadToWebhook(fullLead, customWebhookUrl);
    if (success) {
      addedCount++;
      // Legacy process-wide cache, for the CLI path only.
      if (!plan?.onSeen) duplicateChecker.saveLead(fullLead);
      logger.success(`Added To Sheet`);
    } else {
      failedCount++;
      logger.warn(`Webhook delivery failed for '${fullLead.businessName}'. Lead retained in failed-leads.json for future retry.`);
    }
  }

  const durationMs = Date.now() - startTime;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = ((durationMs % 60000) / 1000).toFixed(0);
  const executionTimeString = `${minutes}m ${seconds}s`;

  displaySummaryTable({
    scannedCount,
    withoutWebsiteCount,
    addedCount,
    failedCount,
    executionTime: executionTimeString
  }, criteria);

  return {
    scannedCount,
    withoutWebsiteCount,
    addedCount,
    failedCount,
    leads: leadsFound
  };
}

function displaySummaryTable(data: any, criteria: ScrapeCriteria) {
  logger.log("\n================================\n");
  logger.log("SEARCH COMPLETE\n");
  logger.log(`Business Type:\n${criteria.businessType}\n`);
  logger.log(`Location:\n${criteria.location}\n`);
  logger.log(`Businesses Scanned:\n${data.scannedCount}\n`);
  logger.log(`Without Website:\n${data.withoutWebsiteCount}\n`);
  logger.log(`Added To Sheet:\n${data.addedCount}\n`);
  logger.log(`Failed:\n${data.failedCount}\n`);
  logger.log(`Execution Time:\n${data.executionTime}\n`);
  logger.log("================================\n");
}

/**
 * Synthetic leads for simulation mode, generated from the requested category.
 *
 * WHAT WAS REMOVED, AND WHY
 * -------------------------
 * This function used to branch on the search term and return one of three
 * hand-written pools: eight named dental clinics, six dermatology clinics, four
 * restaurants, plus a generic fallback. Roughly three hundred lines of fabricated
 * businesses with Indian phone numbers and invented addresses.
 *
 * Three problems made it worse than useless for a universal platform. Anyone
 * outside those three verticals got the generic branch, so simulation told them
 * nothing about their own market. Anyone inside them saw plausible, specific,
 * entirely fictional businesses — "Smile Dental Design Clinic" with a rating and a
 * review count — which is precisely the kind of fabricated data this product
 * promises never to produce. And the pools encoded the assumption that the
 * platform sells to dentists, dermatologists and restaurants.
 *
 * The replacement is deliberately, visibly synthetic. Names are built from the
 * caller's own category, phone numbers use the reserved 555 range, and every
 * record is prefixed so it cannot be mistaken for a real business if it reaches a
 * CRM or a spreadsheet. Simulation exists to exercise the pipeline without a
 * browser, not to show a customer what their market looks like.
 */
function getMockLeadsPool(type: string, location: string): Partial<Lead>[] {
  const category = (type || "Business").trim() || "Business";

  /*
   * Fixed shapes rather than random values, so a simulated run is reproducible
   * and the scoring path is exercised across every band: a missing website with
   * strong reputation scores HOT, a working well-instrumented site scores COLD.
   */
  const shapes: {
    prefix: string;
    rating: number;
    reviews: number;
    hasWebsite: boolean;
  }[] = [
    { prefix: "Sample A", rating: 4.8, reviews: 245, hasWebsite: false },
    { prefix: "Sample B", rating: 4.6, reviews: 180, hasWebsite: true },
    { prefix: "Sample C", rating: 4.9, reviews: 95, hasWebsite: false },
    { prefix: "Sample D", rating: 4.2, reviews: 320, hasWebsite: false },
    { prefix: "Sample E", rating: 4.4, reviews: 55, hasWebsite: true },
    { prefix: "Sample F", rating: 3.9, reviews: 18, hasWebsite: false },
    { prefix: "Sample G", rating: 4.7, reviews: 112, hasWebsite: false },
    { prefix: "Sample H", rating: 4.1, reviews: 29, hasWebsite: true },
  ];

  return shapes.map((shape, index) => {
    const businessName = `[SIMULATED] ${shape.prefix} ${category}`;
    const slug = `sim-${index + 1}`;
    return {
      businessName,
      // The 555 exchange is reserved for fiction precisely so it cannot reach a
      // real person if a simulated lead escapes into an outreach campaign.
      phone: `+1 555 0100 ${String(index + 1).padStart(2, "0")}`,
      address: `Unit ${index + 1}, Example Street, ${location}`,
      rating: shape.rating,
      reviews: shape.reviews,
      website: shape.hasWebsite ? `https://example.com/${slug}` : "",
      category,
      mapsUrl: `https://maps.google.com/?cid=${slug}`,
    };
  });
}
