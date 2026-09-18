/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GMB analyzer — evaluates the completeness of a Google Business Profile.
 *
 * The scraper already extracts several GMB signals from the Maps detail page.
 * This module accepts whatever signals are available (as a partial input) and
 * produces a normalized 0-100 completeness score. Unknown signals are treated
 * as absent so the score is conservative rather than optimistic.
 */

import { GmbAnalysis } from "./types";

export interface GmbSignals {
  description?: boolean;
  primaryCategory?: string;
  secondaryCategories?: number;
  services?: boolean;
  products?: boolean;
  faqs?: boolean;
  businessHours?: boolean;
  photos?: number;
  videos?: number;
  logo?: boolean;
  coverImage?: boolean;
  reviewReplies?: boolean;
  website?: boolean;
  phone?: boolean;
  bookingLink?: boolean;
  messaging?: boolean;
}

export function analyzeGmb(signals: GmbSignals): GmbAnalysis {
  const a: GmbAnalysis = {
    description: !!signals.description,
    primaryCategory: signals.primaryCategory || "",
    secondaryCategories: signals.secondaryCategories ?? 0,
    services: !!signals.services,
    products: !!signals.products,
    faqs: !!signals.faqs,
    businessHours: !!signals.businessHours,
    photos: signals.photos ?? 0,
    videos: signals.videos ?? 0,
    logo: !!signals.logo,
    coverImage: !!signals.coverImage,
    reviewReplies: !!signals.reviewReplies,
    website: !!signals.website,
    phone: !!signals.phone,
    bookingLink: !!signals.bookingLink,
    messaging: !!signals.messaging,
    gmbScore: 0,
  };

  let score = 0;
  score += a.description ? 8 : 0;
  score += a.primaryCategory ? 8 : 0;
  score += a.secondaryCategories > 0 ? 5 : 0;
  score += a.services ? 6 : 0;
  score += a.products ? 5 : 0;
  score += a.faqs ? 4 : 0;
  score += a.businessHours ? 8 : 0;
  score += a.photos >= 10 ? 10 : a.photos > 0 ? 5 : 0;
  score += a.videos > 0 ? 5 : 0;
  score += a.logo ? 5 : 0;
  score += a.coverImage ? 5 : 0;
  score += a.reviewReplies ? 8 : 0;
  score += a.website ? 6 : 0;
  score += a.phone ? 6 : 0;
  score += a.bookingLink ? 5 : 0;
  score += a.messaging ? 6 : 0;

  a.gmbScore = Math.min(100, score);
  return a;
}
