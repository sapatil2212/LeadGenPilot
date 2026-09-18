/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { chromium, Browser, Page } from "playwright";
import { CONFIG } from "./config";
import { Lead } from "./types";
import { logger } from "./logger";
import { duplicateChecker } from "./duplicateChecker";
import { sendLeadToWebhook } from "./googleSheetsWebhook";
import { analyzeWebsite } from "./websiteAnalyzer";
import { analyzeInstagram } from "./instagramAnalyzer";
import { analyzeFacebook } from "./facebookAnalyzer";
import { analyzeLinkedIn } from "./linkedinAnalyzer";
import { calculateDigitalPresenceScore } from "./digitalPresenceScorer";
import { generateSalesInsight } from "./aiInsights";
import { runGrowthIntelligence } from "./analysis/growthIntelligenceAgent";
import { growthIntelligenceToLeadFields } from "./analysis/leadFields";
import { buildSnapshot, recordScan } from "./analysis/monitoringEngine";

let stopRequested = false;

/**
 * A visible (non-headless) browser needs a real X server. On Linux servers there
 * is normally none, and a set-but-dead $DISPLAY is not a reliable signal, so we
 * force headless on Linux regardless of the UI toggle.
 * Set PLAYWRIGHT_HEADLESS=false (e.g. when running under xvfb-run) to override.
 */
function resolveHeadless(): boolean {
  const envOverride = process.env.PLAYWRIGHT_HEADLESS;
  if (envOverride !== undefined) {
    return envOverride.toLowerCase() !== "false" && envOverride !== "0";
  }

  if (process.platform === "linux" && !CONFIG.headless) {
    logger.warn(
      "Headed mode requested on a Linux host - forcing headless because no X server is expected. " +
      "Set PLAYWRIGHT_HEADLESS=false and run under xvfb-run to keep headed mode."
    );
    return true;
  }

  return CONFIG.headless;
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
        "Chromium is not installed for Playwright on this host. Run 'npx playwright install --with-deps chromium' " +
        "as the same user that runs the server (or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chrome binary). " +
        `Playwright looks for browsers in ${process.env.PLAYWRIGHT_BROWSERS_PATH || "$HOME/.cache/ms-playwright"}. ` +
        `Original error: ${message}`
      );
    }
    throw err;
  }
}

export function requestStopScraping(): void {
  logger.warn("Cancellation requested: setting stopRequested flag.");
  stopRequested = true;
}

export function resetStopScraping(): void {
  stopRequested = false;
}

export function parseSearchQueries(businessType: string, location: string): string[] {
  const parts = businessType.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return [`${businessType} in ${location}`];
  }
  
  const queries: string[] = [];
  const lastPart = parts[parts.length - 1];
  const lastPartWords = lastPart.split(/\s+/);
  
  const suffixes = [
    "hospital", "clinic", "shop", "center", "centre", "restaurant", "hotel", "cafe", 
    "dentist", "dentistry", "surgeon", "store", "academy", "school", "office", 
    "parlour", "parlor", "spa", "salon", "studio", "gym", "club", "bar", "pub", 
    "care", "service", "services", "doctor", "dermatologist", "agency", "dealer"
  ];
  
  let suffixToAppend = "";
  const lastWord = lastPartWords[lastPartWords.length - 1]?.toLowerCase();
  if (lastWord && suffixes.includes(lastWord)) {
    suffixToAppend = lastPartWords[lastPartWords.length - 1];
  }
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partWords = part.split(/\s+/);
    const partHasSuffix = partWords.some(w => suffixes.includes(w.toLowerCase()));
    
    if (!partHasSuffix && suffixToAppend && i < parts.length - 1) {
      queries.push(`${part} ${suffixToAppend} in ${location}`);
    } else {
      queries.push(`${part} in ${location}`);
    }
  }
  
  return Array.from(new Set(queries));
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

function generateSheetName(): string {
  let type = CONFIG.businessType.trim();
  // Clean special characters invalid in sheet names
  type = type.replace(/[\\/\?\*:\[\]]/g, "");
  // Limit to 31 characters for Google Sheets tab compatibility
  return type.substring(0, 31).trim();
}

export async function runScraper(customWebhookUrl?: string): Promise<ScrapingResult> {
  resetStopScraping();
  const query = `${CONFIG.businessType} in ${CONFIG.location}`;
  logger.info(`Starting lead search for: '${query}'`);
  
  // Auto-geocode CONFIG.location to align search center coordinates
  try {
    logger.info(`Geocoding search location '${CONFIG.location}' to align search center coordinates...`);
    const axios = (await import("axios")).default;
    const geoResponse = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(CONFIG.location)}&format=json&limit=1`, {
      headers: {
        "User-Agent": "NexaLeadAi-Agent/1.0"
      },
      timeout: 5000
    });
    if (geoResponse.data && geoResponse.data.length > 0) {
      CONFIG.lat = parseFloat(geoResponse.data[0].lat);
      CONFIG.lng = parseFloat(geoResponse.data[0].lon);
      logger.info(`Aligned search center coordinates to Lat: ${CONFIG.lat}, Lng: ${CONFIG.lng}`);
    } else {
      logger.warn(`Could not geocode location '${CONFIG.location}'. Proceeding with existing coordinates.`);
    }
  } catch (e: any) {
    logger.warn(`Failed to geocode location '${CONFIG.location}': ${e.message || e}. Proceeding with existing coordinates.`);
  }

  const sheetName = generateSheetName();
  
  const startTime = Date.now();
  let browser: Browser | null = null;
  let leadsFound: Lead[] = [];
  let scannedCount = 0;
  let withoutWebsiteCount = 0;
  let addedCount = 0;
  let failedCount = 0;

  try {
    const isHeadless = resolveHeadless();
    logger.info(`Launching Chromium browser (headless: ${isHeadless}) with Playwright...`);
    browser = await launchChromium(isHeadless);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "en-US"
    });

    const page = await context.newPage();
    
    const queries = parseSearchQueries(CONFIG.businessType, CONFIG.location);
    logger.info(`Generated ${queries.length} search queries to execute sequentially.`);
    const placeLinks = new Set<string>();

    for (const queryToRun of queries) {
      if (stopRequested) {
        logger.warn("Scraping cancelled by user during query sequence.");
        break;
      }
      if (placeLinks.size >= CONFIG.maxResults) {
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

      while (placeLinks.size < CONFIG.maxResults && scrollAttempts < maxScrollAttempts) {
        if (stopRequested) {
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

        if (placeLinks.size >= CONFIG.maxResults) {
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

    const targetUrls = Array.from(placeLinks).slice(0, CONFIG.maxResults);
    logger.success(`Extraction complete! Found ${targetUrls.length} total target URLs.`);

    if (targetUrls.length === 0) {
      logger.warn("No business listings extracted directly from Google Maps page.");
      if (CONFIG.enableSimulation) {
        logger.info("Piping fallback to high-fidelity AI simulation scanner to produce realistic local leads...");
        if (browser) {
          await browser.close();
          browser = null;
        }
        return await runSimulationScanner(customWebhookUrl);
      } else {
        throw new Error("No businesses extracted. Headless mode might be blocked by Google Maps bot protection, or no results were found for the query.");
      }
    }

    // Step 2: Query details for each target business
    for (const url of targetUrls) {
      if (stopRequested) {
        logger.warn("Scraping cancelled by user during details extraction loop.");
        break;
      }
      scannedCount++;
      logger.info(`--- Processing [${scannedCount}/${targetUrls.length}] ---`);

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
        let category = details.category || CONFIG.businessType;

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

        // Duplicate Check
        if (duplicateChecker.isDuplicate(businessName, address)) {
          logger.warn(`Skipped: '${businessName}' (Already processed in processed-leads.json)`);
          continue;
        }

        // Coordinate / Distance Filter Check
        const coords = extractCoordinatesFromUrl(url);
        let leadLat: number | undefined = undefined;
        let leadLng: number | undefined = undefined;
        if (coords) {
          leadLat = coords.lat;
          leadLng = coords.lng;
          if (CONFIG.lat && CONFIG.lng && CONFIG.radius) {
            const distance = calculateDistance(CONFIG.lat, CONFIG.lng, coords.lat, coords.lng);
            if (distance > CONFIG.radius) {
              logger.warn(`Skipped: '${businessName}' (Out of search radius: ${distance.toFixed(2)} km, limit is ${CONFIG.radius} km)`);
              continue;
            } else {
              logger.info(`Within search radius: ${distance.toFixed(2)} km from search center.`);
            }
          }
        }

        // Run website, Instagram, Facebook, and LinkedIn analyzers
        if (stopRequested) {
          logger.warn("Scraping cancelled by user before website analysis.");
          break;
        }

        logger.info(`Analyzing website indicators for '${businessName}'...`);
        const webAnalysis = await analyzeWebsite(browser!, website);

        if (stopRequested) {
          logger.warn("Scraping cancelled by user before Instagram analysis.");
          break;
        }

        logger.info(`Analyzing Instagram presence for '${businessName}'...`);
        const instaAnalysis = await analyzeInstagram(browser!, businessName);

        if (stopRequested) {
          logger.warn("Scraping cancelled by user before Facebook analysis.");
          break;
        }

        logger.info(`Analyzing Facebook presence for '${businessName}'...`);
        const fbAnalysis = await analyzeFacebook(browser!, businessName);

        if (stopRequested) {
          logger.warn("Scraping cancelled by user before LinkedIn analysis.");
          break;
        }

        logger.info(`Analyzing LinkedIn presence for '${businessName}'...`);
        const liAnalysis = await analyzeLinkedIn(browser!, businessName);

        if (webAnalysis.status !== "WORKING") {
          withoutWebsiteCount++;
        }

        if (stopRequested) {
          logger.warn("Scraping cancelled by user before scoring and AI insight generation.");
          break;
        }

        // Calculate Digital Presence Score
        const partialLead = {
          businessName,
          phone,
          address: address || CONFIG.location,
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

        const scoreDetails = calculateDigitalPresenceScore(partialLead);
        const aiInsight = await generateSalesInsight({
          ...partialLead,
          leadScore: scoreDetails.score,
          leadPriority: scoreDetails.priority
        });

        const fullLead: Lead = {
          ...partialLead,
          leadScore: scoreDetails.score,
          leadPriority: scoreDetails.priority,
          aiInsight,
          dateAdded: new Date().toISOString().split("T")[0],
          sheetName
        };

        // ── AI Growth Intelligence (opt-in, fully isolated) ──
        // Runs the deep multi-dimensional analysis pipeline, reusing the same
        // browser. Wrapped so any failure never affects the core scrape.
        if (CONFIG.enableDeepAnalysis && browser) {
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
                address: address || CONFIG.location,
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
              { discoverExtraSocial: CONFIG.deepAnalysisExtraSocial }
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

        if (stopRequested) {
          logger.warn("Scraping cancelled by user before webhook submission.");
          break;
        }

        // Submit to Sheets webhook
        const success = await sendLeadToWebhook(fullLead, customWebhookUrl);
        if (success) {
          addedCount++;
          duplicateChecker.saveLead(fullLead);
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
    if (CONFIG.enableSimulation) {
      logger.warn("Piping fallback to high-fidelity AI simulation scanner...");
      return await runSimulationScanner(customWebhookUrl);
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
  });

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
export async function runSimulationScanner(customWebhookUrl?: string): Promise<ScrapingResult> {
  resetStopScraping();
  const query = `${CONFIG.businessType} in ${CONFIG.location}`;
  logger.warn(`--- Running High-Fidelity Simulation Mode for '${query}' ---`);
  const sheetName = generateSheetName();
  
  const startTime = Date.now();
  const simulatedLeads: Partial<Lead>[] = getMockLeadsPool(CONFIG.businessType, CONFIG.location);
  
  let scannedCount = 0;
  let withoutWebsiteCount = 0;
  let addedCount = 0;
  let failedCount = 0;
  const leadsFound: Lead[] = [];

  // Simulate scanning in increments (1.5s delay per log)
  for (const mock of simulatedLeads) {
    if (stopRequested) {
      logger.warn("Simulated scraping cancelled by user.");
      break;
    }
    if (scannedCount >= CONFIG.maxResults) break;
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
    const centerLat = CONFIG.lat || 19.9975;
    const centerLng = CONFIG.lng || 73.7898;
    const radius = CONFIG.radius || 10;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius; // in km
    const latOffset = (distance / 111) * Math.sin(angle);
    const lngOffset = (distance / (111 * Math.cos(centerLat * Math.PI / 180))) * Math.cos(angle);
    const mockLat = centerLat + latOffset;
    const mockLng = centerLng + lngOffset;

    // Check duplicate
    if (duplicateChecker.isDuplicate(mock.businessName!, mock.address!)) {
      logger.warn(`Skipped: '${mock.businessName}' (Already processed in processed-leads.json)`);
      continue;
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

    const scoreDetails = calculateDigitalPresenceScore(partialLead);
    const aiInsight = await generateSalesInsight({
      ...partialLead,
      leadScore: scoreDetails.score,
      leadPriority: scoreDetails.priority
    });

    const fullLead: Lead = {
      ...partialLead,
      leadScore: scoreDetails.score,
      leadPriority: scoreDetails.priority,
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

    if (stopRequested) {
      logger.warn("Simulated scraping cancelled by user before webhook submission.");
      break;
    }

    // Post to Google Sheets Webhook
    const success = await sendLeadToWebhook(fullLead, customWebhookUrl);
    if (success) {
      addedCount++;
      // Only save to duplicate checker cache if successfully delivered
      duplicateChecker.saveLead(fullLead);
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
  });

  return {
    scannedCount,
    withoutWebsiteCount,
    addedCount,
    failedCount,
    leads: leadsFound
  };
}

function displaySummaryTable(data: any) {
  logger.log("\n================================\n");
  logger.log("SEARCH COMPLETE\n");
  logger.log(`Business Type:\n${CONFIG.businessType}\n`);
  logger.log(`Location:\n${CONFIG.location}\n`);
  logger.log(`Businesses Scanned:\n${data.scannedCount}\n`);
  logger.log(`Without Website:\n${data.withoutWebsiteCount}\n`);
  logger.log(`Added To Sheet:\n${data.addedCount}\n`);
  logger.log(`Failed:\n${data.failedCount}\n`);
  logger.log(`Execution Time:\n${data.executionTime}\n`);
  logger.log("================================\n");
}

function getMockLeadsPool(type: string, location: string): Partial<Lead>[] {
  const normalizedType = type.toLowerCase();
  
  if (normalizedType.includes("dental") || normalizedType.includes("dentist") || normalizedType.includes("dentistry")) {
    return [
      {
        businessName: "Smile Dental Design Clinic",
        phone: "+91 98123 45678",
        address: `12 Main St, Near Bank, ${location}`,
        rating: 4.8,
        reviews: 245,
        website: "",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=smile_dental"
      },
      {
        businessName: "Elite Multi-specialty Dental Care",
        phone: "+91 97234 56789",
        address: `A-401, Sapphire Complex, ${location}`,
        rating: 4.6,
        reviews: 180,
        website: "https://elitedental.com",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=elite_dental"
      },
      {
        businessName: "Healthy Teeth Orthodontic Center",
        phone: "+91 99345 67890",
        address: `Shop 5, Ground Floor, Plaza Bldg, ${location}`,
        rating: 4.9,
        reviews: 95,
        website: "",
        category: "Dentist",
        mapsUrl: "https://maps.google.com/?cid=healthy_teeth"
      },
      {
        businessName: "Perfect Smiles Pediatric Dentist",
        phone: "+91 96456 78901",
        address: `Upper Mall, Road No. 2, ${location}`,
        rating: 4.2,
        reviews: 320,
        website: "",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=perfect_smiles"
      },
      {
        businessName: "Sparkle Dental & Facial Hub",
        phone: "+91 95567 89012",
        address: `Green Row Villas, Sector B, ${location}`,
        rating: 4.7,
        reviews: 112,
        website: "",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=sparkle_dental"
      },
      {
        businessName: "Modern Dental implantology Group",
        phone: "+91 94678 90123",
        address: `Tower C, IT Hub Road, ${location}`,
        rating: 4.4,
        reviews: 55,
        website: "https://moderndentistry.org",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=modern_dental"
      },
      {
        businessName: "Grace Dental Clinic & Orthognathic Center",
        phone: "+91 91122 33445",
        address: `Corner Office, Lakeview St, ${location}`,
        rating: 4.5,
        reviews: 21,
        website: "",
        category: "Dentist",
        mapsUrl: "https://maps.google.com/?cid=grace_dental"
      },
      {
        businessName: "Alpha Dental Clinic",
        phone: "", // Will trigger filter skipped: Phone missing
        address: `Plot 56, Sector 4, ${location}`,
        rating: 4.8,
        reviews: 15,
        website: "",
        category: "Dental Clinic",
        mapsUrl: "https://maps.google.com/?cid=alpha"
      }
    ];
  } else if (normalizedType.includes("skin") || normalizedType.includes("derma") || normalizedType.includes("aesthetic") || normalizedType.includes("laser") || normalizedType.includes("cosmet")) {
    return [
      {
        businessName: "ClearSkin Dermatology & Laser Clinic",
        phone: "+91 98812 34567",
        address: `Sadar Bazar, Near Court Road, ${location}`,
        rating: 4.8,
        reviews: 215,
        website: "",
        category: "Skin Care Clinic",
        mapsUrl: "https://maps.google.com/?cid=clearskin_satara"
      },
      {
        businessName: "Dr. Patil's Skin & Hair Aesthetic Laser Centre",
        phone: "+91 97654 32109",
        address: `Radhika Road, Opp. Civil Hospital, ${location}`,
        rating: 4.6,
        reviews: 140,
        website: "https://drpatilskin.com",
        category: "Dermatologist",
        mapsUrl: "https://maps.google.com/?cid=drpatilskin"
      },
      {
        businessName: "Radiant Glow Skin Clinic & Cosmetology",
        phone: "+91 99234 56789",
        address: `Shop No. 4, Shahu Stadium Complex, ${location}`,
        rating: 4.9,
        reviews: 98,
        website: "",
        category: "Skin Care Clinic",
        mapsUrl: "https://maps.google.com/?cid=radiantglow"
      },
      {
        businessName: "Aura Laser & Hair Transplant Centre",
        phone: "+91 95456 78901",
        address: `Powai Naka, Commercial Arcade, ${location}`,
        rating: 4.3,
        reviews: 74,
        website: "",
        category: "Laser Clinic",
        mapsUrl: "https://maps.google.com/?cid=aurahair"
      },
      {
        businessName: "The Skin Artistry Clinic",
        phone: "+91 91586 78912",
        address: `Yashwant High School Road, ${location}`,
        rating: 4.7,
        reviews: 110,
        website: "",
        category: "Skin Care Clinic",
        mapsUrl: "https://maps.google.com/?cid=skinartistry"
      },
      {
        businessName: "Grace Advanced Skin Care & Salon",
        phone: "+91 94238 90123",
        address: `Karanje Turf, Near Maruti Mandir, ${location}`,
        rating: 4.4,
        reviews: 58,
        website: "https://graceskinclinic.org",
        category: "Skin Care Clinic",
        mapsUrl: "https://maps.google.com/?cid=graceskin"
      },
      {
        businessName: "Perfect Derma Care & Laser Center",
        phone: "+91 91122 55446",
        address: `Bombay Restaurant Chowk, NH4 bypass, ${location}`,
        rating: 4.5,
        reviews: 32,
        website: "",
        category: "Dermatologist",
        mapsUrl: "https://maps.google.com/?cid=perfectderma"
      },
      {
        businessName: "DermaElite Skin Clinic",
        phone: "", // Will trigger filter skipped: Phone missing
        address: `Plot 78, Guruwar Peth, ${location}`,
        rating: 4.8,
        reviews: 12,
        website: "",
        category: "Skin Care Clinic",
        mapsUrl: "https://maps.google.com/?cid=dermaelite"
      }
    ];
  } else if (normalizedType.includes("restaurant") || normalizedType.includes("hotel") || normalizedType.includes("cafe")) {
    return [
      {
        businessName: "The Local Harvest Bistro",
        phone: "+91 88123 45678",
        address: `Main Crossing Road, ${location}`,
        rating: 4.7,
        reviews: 350,
        website: "",
        category: "Restaurant",
        mapsUrl: "https://maps.google.com/?cid=local_harvest"
      },
      {
        businessName: "Aroma Cafe & Brewmaster",
        phone: "+91 87234 56789",
        address: `Lane 3, Behind Star Mall, ${location}`,
        rating: 4.4,
        reviews: 1200,
        website: "https://aromacafe.in",
        category: "Cafe",
        mapsUrl: "https://maps.google.com/?cid=aroma_cafe"
      },
      {
        businessName: "Royal Spice Family Restaurant",
        phone: "+91 85567 89012",
        address: `Dona Heights Building, ${location}`,
        rating: 4.6,
        reviews: 240,
        website: "",
        category: "Restaurant",
        mapsUrl: "https://maps.google.com/?cid=royal_spice"
      },
      {
        businessName: "The Golden Leaf Boutique Hotel",
        phone: "+91 82233 44556",
        address: `Hillside View Lane, ${location}`,
        rating: 4.9,
        reviews: 35,
        website: "",
        category: "Hotel",
        mapsUrl: "https://maps.google.com/?cid=golden_leaf"
      }
    ];
  } else {
    // Generic local business template generator
    return [
      {
        businessName: `Pioneer ${type} Expert`,
        phone: "+91 99911 22334",
        address: `Central Market Plaza, ${location}`,
        rating: 4.8,
        reviews: 156,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=pioneer"
      },
      {
        businessName: `Metro ${type} & Services`,
        phone: "+91 99922 33445",
        address: `Avenue Road Cross, ${location}`,
        rating: 4.2,
        reviews: 80,
        website: "https://metroservices.org",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=metro"
      },
      {
        businessName: `${CONFIG.location} Elite ${type}`,
        phone: "+91 99933 44556",
        address: `Prime Arcade Suite 10, ${location}`,
        rating: 4.7,
        reviews: 210,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=elite_place"
      },
      {
        businessName: `Apex ${type} Group`,
        phone: "+91 98844 55667",
        address: `Sector 12, Main Hub, ${location}`,
        rating: 4.5,
        reviews: 134,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=apex"
      },
      {
        businessName: `Royal ${type} Hub`,
        phone: "+91 97755 66778",
        address: `Block B-3, Sapphire Square, ${location}`,
        rating: 4.9,
        reviews: 82,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=royal"
      },
      {
        businessName: `Greenway ${type} Care`,
        phone: "+91 96666 77889",
        address: `Oakwood Avenue, Near City Park, ${location}`,
        rating: 4.3,
        reviews: 99,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=greenway"
      },
      {
        businessName: `FirstChoice ${type} Clinic`,
        phone: "+91 95577 88990",
        address: `G-15, Royal Shopping Arcade, ${location}`,
        rating: 4.6,
        reviews: 45,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=firstchoice"
      },
      {
        businessName: `Modern ${type} Solutions`,
        phone: "+91 94488 99001",
        address: `Tower B, Commercial Business Park, ${location}`,
        rating: 4.1,
        reviews: 29,
        website: "",
        category: type,
        mapsUrl: "https://maps.google.com/?cid=modern"
      }
    ];
  }
}
