/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser } from "playwright";
import { logger } from "./logger";

export interface WebsiteAnalysis {
  reachable: boolean;
  loading: boolean;
  responsive: boolean;
  https: boolean;
  whatsappPresent: boolean;
  contactFormPresent: boolean;
  appointmentSystem: boolean;
  copyrightYear: number | null;
  status: "MISSING" | "WORKING" | "BROKEN" | "OUTDATED";
  emails: string[];
  googleAnalyticsPresent: boolean;
  metaPixelPresent: boolean;
}

export async function analyzeWebsite(browser: Browser, url: string): Promise<WebsiteAnalysis> {
  const analysis: WebsiteAnalysis = {
    reachable: false,
    loading: false,
    responsive: false,
    https: false,
    whatsappPresent: false,
    contactFormPresent: false,
    appointmentSystem: false,
    copyrightYear: null,
    status: "MISSING",
    emails: [],
    googleAnalyticsPresent: false,
    metaPixelPresent: false
  };

  if (!url || url.trim() === "") {
    return analysis;
  }

  analysis.https = url.toLowerCase().startsWith("https://");

  let page = null;
  try {
    // Open a lightweight new browser context to isolate session cookies
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });
    page = await context.newPage();

    logger.info(`Analyzing website: ${url}`);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    analysis.reachable = true;
    if (response && response.status() >= 200 && response.status() < 400) {
      analysis.loading = true;
    }

    if (analysis.loading) {
      // Analyze mobile responsiveness
      analysis.responsive = await page.evaluate(() => {
        const meta = document.querySelector("meta[name='viewport']");
        if (!meta) return false;
        const content = meta.getAttribute("content") || "";
        return content.includes("width=device-width");
      });

      // Analyze WhatsApp presence
      analysis.whatsappPresent = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const hasWhatsAppLink = anchors.some(a => {
          const href = (a as HTMLAnchorElement).href.toLowerCase();
          return href.includes("wa.me") || href.includes("api.whatsapp.com") || href.includes("whatsapp.com/send");
        });
        const hasWhatsAppWidget = !!document.querySelector('[class*="whatsapp"]') || 
                                  !!document.querySelector('[id*="whatsapp"]') ||
                                  !!document.querySelector('iframe[src*="whatsapp"]');
        return hasWhatsAppLink || hasWhatsAppWidget;
      });

      // Analyze Contact Form presence
      analysis.contactFormPresent = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('form'));
        const hasForm = forms.some(form => {
          const action = form.getAttribute("action") || "";
          const id = form.getAttribute("id") || "";
          const text = form.innerText.toLowerCase();
          return text.includes("contact") || text.includes("email") || text.includes("message") || action.includes("contact") || id.includes("contact");
        });
        const hasContactFields = !!document.querySelector('input[type="email"]') && (!!document.querySelector('textarea') || !!document.querySelector('input[name*="message"]'));
        return hasForm || hasContactFields;
      });

      // Analyze Appointment System presence
      analysis.appointmentSystem = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        const keywords = ["book appointment", "appointment", "schedule visit", "consultation booking", "book now", "schedule an appointment", "calendly.com", "acuityscheduling.com"];
        const hasKeyword = keywords.some(keyword => bodyText.includes(keyword));
        const hasBookingWidget = !!document.querySelector('iframe[src*="calendly"]') || 
                                 !!document.querySelector('iframe[src*="acuity"]') ||
                                 !!document.querySelector('a[href*="calendly.com"]') ||
                                 !!document.querySelector('a[href*="acuityscheduling.com"]');
        return hasKeyword || hasBookingWidget;
      });

      // Extract copyright year
      analysis.copyrightYear = await page.evaluate(() => {
        const regex = /(?:©|copyright|copywrite|all rights reserved)\s*(?:.*?\b(20\d{2})\b)/i;
        const match = document.body.innerText.match(regex);
        if (match) return parseInt(match[1], 10);
        
        const footer = document.querySelector('footer');
        const text = footer ? footer.innerText : document.body.innerText;
        const match2 = text.match(/(?:©|copyright)\s*([0-9]{4})/i);
        if (match2) return parseInt(match2[1], 10);
        
        return null;
      });

      // Extract emails
      analysis.emails = await page.evaluate(() => {
        const mailtoEmails = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
          .map(a => (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").trim().split("?")[0])
          .filter(email => email.includes("@"));
        
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const textEmails = document.body.innerText.match(emailRegex) || [];
        
        return Array.from(new Set([...mailtoEmails, ...textEmails]))
          .map(e => e.toLowerCase().trim())
          .filter(e => {
            const ext = e.split('.').pop() || '';
            return !['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js'].includes(ext);
          })
          .slice(0, 3);
      });

      // Detect Google Analytics / Tag Manager
      analysis.googleAnalyticsPresent = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        const hasGaSrc = scripts.some(s => {
          const src = s.src || "";
          return src.includes("googletagmanager.com") || src.includes("google-analytics.com");
        });
        const hasGaInText = scripts.some(s => {
          const text = s.text || "";
          return text.includes("gtag") || text.includes("ga(") || text.includes("GoogleAnalyticsObject");
        });
        return hasGaSrc || hasGaInText || (window as any).dataLayer !== undefined;
      });

      // Detect Meta Pixel
      analysis.metaPixelPresent = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        const hasPixelSrc = scripts.some(s => {
          const src = s.src || "";
          return src.includes("connect.facebook.net");
        });
        const hasPixelInText = scripts.some(s => {
          const text = s.text || "";
          return text.includes("fbq") || text.includes("fbpx") || text.includes("_fbq");
        });
        return hasPixelSrc || hasPixelInText || (window as any).fbq !== undefined;
      });

      // Compute Website Status
      const currentYear = new Date().getFullYear();
      const isOutdatedCopyright = analysis.copyrightYear !== null && (currentYear - analysis.copyrightYear >= 3);
      
      if (!analysis.responsive || isOutdatedCopyright) {
        analysis.status = "OUTDATED";
      } else {
        analysis.status = "WORKING";
      }
    } else {
      analysis.status = "BROKEN";
    }

  } catch (error) {
    logger.warn(`Website analysis failed or timed out for ${url}: ${error}`);
    analysis.status = "BROKEN";
  } finally {
    if (page) {
      await page.close();
    }
  }

  return analysis;
}
