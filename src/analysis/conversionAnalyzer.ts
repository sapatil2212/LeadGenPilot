/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Conversion analyzer — detects the presence of conversion-oriented elements
 * (CTAs, booking, payment, trust signals) on an already-open Playwright page.
 */

import type { Page } from "playwright";
import { ConversionAnalysis } from "./types";

export async function analyzeConversion(page: Page): Promise<ConversionAnalysis> {
  const raw = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    const bodyText = (document.body?.innerText || "").toLowerCase();
    const html = document.documentElement.innerHTML.toLowerCase();

    const callButton = anchors.some((a) => a.href.toLowerCase().startsWith("tel:"));
    const whatsapp = anchors.some((a) => /wa\.me|api\.whatsapp\.com|whatsapp\.com\/send/.test(a.href.toLowerCase()));

    // Sticky CTA: fixed/sticky positioned element containing an action verb.
    const stickyCta = Array.from(document.querySelectorAll("*")).slice(0, 4000).some((el) => {
      const style = window.getComputedStyle(el as Element);
      if (style.position !== "fixed" && style.position !== "sticky") return false;
      const t = (el as HTMLElement).innerText?.toLowerCase() || "";
      return /call|book|contact|whatsapp|enquire|appointment|get quote|buy/.test(t);
    });

    const appointmentBooking =
      /calendly|acuityscheduling|book (now|appointment)|schedule|zocdoc|setmore/.test(html) ||
      !!document.querySelector('iframe[src*="calendly"],iframe[src*="acuity"]');

    const onlinePayment =
      /razorpay|stripe|paypal|payu|ccavenue|checkout|add to cart|buy now|pay now/.test(html);

    const leadForm =
      !!document.querySelector('input[type="email"]') &&
      (!!document.querySelector("textarea") || !!document.querySelector('input[name*="message"],input[name*="phone"]'));

    const testimonials = /testimonial|what our (clients|customers|patients) say|reviews?/.test(bodyText);
    const trustBadges = /certified|iso |trusted|guarantee|award|accredited|verified/.test(bodyText);
    const reviewsEmbedded =
      /google reviews|trustpilot|elfsight|widget-reviews/.test(html) ||
      !!document.querySelector('[class*="review"],[id*="review"]');
    const faq = /frequently asked questions|faq/.test(bodyText) || !!document.querySelector('[class*="faq"],[id*="faq"]');
    const mapsEmbedded = !!document.querySelector('iframe[src*="google.com/maps"],iframe[src*="maps.google"]');

    return {
      callButton,
      whatsapp,
      stickyCta,
      appointmentBooking,
      onlinePayment,
      leadForm,
      testimonials,
      trustBadges,
      reviewsEmbedded,
      faq,
      mapsEmbedded,
    };
  });

  const weights: Record<keyof Omit<ConversionAnalysis, "conversionScore">, number> = {
    callButton: 15,
    whatsapp: 15,
    stickyCta: 8,
    appointmentBooking: 15,
    onlinePayment: 8,
    leadForm: 12,
    testimonials: 8,
    trustBadges: 6,
    reviewsEmbedded: 6,
    faq: 4,
    mapsEmbedded: 3,
  };

  let score = 0;
  (Object.keys(weights) as (keyof typeof weights)[]).forEach((k) => {
    if (raw[k]) score += weights[k];
  });

  return { ...raw, conversionScore: Math.min(100, score) };
}
