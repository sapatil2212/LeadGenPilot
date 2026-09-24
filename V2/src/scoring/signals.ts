/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The signal registry: every fact about a lead that a scoring rule may test.
 *
 * A rule set is data — JSON naming signals from this registry — never anything
 * executable. That is the whole reason the registry exists: tenant-configurable
 * scoring must not mean tenant-supplied code, so a rule can only select among
 * extractors defined here, and an unknown signal id is dropped rather than
 * evaluated.
 *
 * Each signal is a pure predicate over the lead's observed attributes. It answers
 * "is this true of the business" and says nothing about whether that is good or
 * bad — the sign and size of the points live in the rule, because the same fact
 * means opposite things to different sellers. "Has no website" is a strong buying
 * signal for a web agency and irrelevant to someone selling hospital equipment.
 *
 * EXCLUSIVE GROUPS
 * ----------------
 * Signals reading the same underlying attribute share an `exclusiveGroup`, and
 * within a group they partition that attribute's value space, so at most one can
 * fire. This is what makes the achievable maximum computable: a rule set with
 * website rules worth 50, 40 and 30 has a ceiling of 50 from that group, not 120.
 *
 * Getting that wrong is the bug this replaces. The old scorer summed to a
 * reachable maximum of 170 and then clamped at a hardcoded 200 — a number that
 * appeared nowhere in the arithmetic, could never be reached, and was passed to
 * the AI prompt as the denominator, so every lead was described to the model as
 * roughly 15% weaker than it was.
 */

import type { Lead } from "../types";

/** What a signal can see. Everything the scraper knows before scoring. */
export type ScorableLead = Partial<
  Omit<Lead, "leadScore" | "leadPriority" | "dateAdded" | "aiInsight">
> & {
  businessName: string;
};

export type SignalCategory = "website" | "reputation" | "social" | "contact" | "tracking";

export interface SignalDefinition {
  id: string;
  label: string;
  category: SignalCategory;
  /** Human-readable description, surfaced in the rule editor. */
  description: string;
  /**
   * Signals sharing a group read the same attribute and cannot both fire, so the
   * group contributes only its highest-weighted member to the maximum.
   */
  exclusiveGroup?: string;
  /**
   * Optional numeric comparison the rule may override via `when`, e.g. the
   * review count for `reputation.many_reviews`. Signals without one ignore it.
   */
  thresholdLabel?: string;
  defaultThreshold?: number;
  test(lead: ScorableLead, threshold?: number): boolean;
}

const hasNoUsableWebsite = (lead: ScorableLead): boolean =>
  lead.websiteStatus === "MISSING" || lead.websiteStatus === "BROKEN";

/**
 * Absence of an on-site feature, treating an unreadable site as absence.
 *
 * When a site is missing or broken the analyzer cannot observe a WhatsApp link,
 * a booking widget or an analytics tag, so a raw `false` means "could not look"
 * rather than "looked and found nothing". Both are reported as absent because
 * the business conclusion is the same — there is no working channel there — and
 * each signal's description says so, since a tenant weighting it deserves to
 * know what they are weighting.
 */
const absentOrUnobservable = (lead: ScorableLead, observed: boolean | undefined): boolean =>
  hasNoUsableWebsite(lead) ? true : !observed;

export const SIGNALS: SignalDefinition[] = [
  // ── Website ── (exclusive: websiteStatus holds exactly one of these)
  {
    id: "website.missing",
    label: "No website at all",
    category: "website",
    exclusiveGroup: "website",
    description: "Google Maps lists no website for the business.",
    test: (lead) => lead.websiteStatus === "MISSING",
  },
  {
    id: "website.broken",
    label: "Website does not load",
    category: "website",
    exclusiveGroup: "website",
    description: "A website is listed but returned an error or failed to load.",
    test: (lead) => lead.websiteStatus === "BROKEN",
  },
  {
    id: "website.outdated",
    label: "Website is dated",
    category: "website",
    exclusiveGroup: "website",
    description:
      "The site loads but is not mobile-responsive, or its copyright notice is three or more years old.",
    test: (lead) => lead.websiteStatus === "OUTDATED",
  },
  {
    id: "website.working",
    label: "Website is current",
    category: "website",
    exclusiveGroup: "website",
    description: "The site loads, is responsive and looks maintained.",
    test: (lead) => lead.websiteStatus === "WORKING",
  },

  // ── Reputation ──
  {
    id: "reputation.many_reviews",
    label: "Many Google reviews",
    category: "reputation",
    exclusiveGroup: "reviews",
    description:
      "Review count above the threshold — a proxy for an established business with real customer volume.",
    thresholdLabel: "More than this many reviews",
    defaultThreshold: 100,
    test: (lead, threshold) => (lead.reviews ?? 0) > (threshold ?? 100),
  },
  {
    id: "reputation.few_reviews",
    label: "Few Google reviews",
    category: "reputation",
    exclusiveGroup: "reviews",
    description: "Review count at or below the threshold.",
    thresholdLabel: "At most this many reviews",
    defaultThreshold: 20,
    test: (lead, threshold) => (lead.reviews ?? 0) <= (threshold ?? 20),
  },
  {
    id: "reputation.high_rating",
    label: "Strong rating",
    category: "reputation",
    exclusiveGroup: "rating",
    description:
      "Average rating above the threshold. A well-regarded business has something worth marketing.",
    thresholdLabel: "Above this rating",
    defaultThreshold: 4.5,
    test: (lead, threshold) => (lead.rating ?? 0) > (threshold ?? 4.5),
  },
  {
    id: "reputation.low_rating",
    label: "Weak rating",
    category: "reputation",
    exclusiveGroup: "rating",
    description:
      "Average rating below the threshold. Unrated businesses are excluded, since no rating is " +
      "not the same as a bad one.",
    thresholdLabel: "Below this rating",
    defaultThreshold: 3.5,
    test: (lead, threshold) => (lead.rating ?? 0) > 0 && (lead.rating ?? 0) < (threshold ?? 3.5),
  },

  // ── Social ──
  {
    id: "social.instagram_missing",
    label: "No Instagram presence",
    category: "social",
    exclusiveGroup: "instagram",
    description: "No Instagram profile was found for the business name.",
    test: (lead) => lead.instagramStatus === "NOT_FOUND",
  },
  {
    id: "social.instagram_inactive",
    label: "Instagram dormant",
    category: "social",
    exclusiveGroup: "instagram",
    description: "An Instagram profile exists but has not posted recently.",
    test: (lead) => lead.instagramStatus === "INACTIVE",
  },
  {
    id: "social.instagram_active",
    label: "Instagram active",
    category: "social",
    exclusiveGroup: "instagram",
    description: "An Instagram profile exists and posts regularly.",
    test: (lead) => lead.instagramStatus === "ACTIVE",
  },
  {
    id: "social.facebook_missing",
    label: "No Facebook presence",
    category: "social",
    exclusiveGroup: "facebook",
    description: "No Facebook page was found for the business name.",
    test: (lead) => lead.facebookStatus === "NOT_FOUND",
  },
  {
    id: "social.facebook_inactive",
    label: "Facebook dormant",
    category: "social",
    exclusiveGroup: "facebook",
    description:
      "A Facebook page exists but has not posted recently. Worth the same as no page in most " +
      "rule sets: an abandoned page and an undiscoverable one both mean no reachable audience.",
    test: (lead) => lead.facebookStatus === "INACTIVE",
  },
  {
    id: "social.facebook_active",
    label: "Facebook active",
    category: "social",
    exclusiveGroup: "facebook",
    description: "A Facebook page exists and posts regularly.",
    test: (lead) => lead.facebookStatus === "ACTIVE",
  },
  {
    id: "social.linkedin_missing",
    label: "No LinkedIn presence",
    category: "social",
    exclusiveGroup: "linkedin",
    description: "No LinkedIn company page or profile was found.",
    test: (lead) => lead.linkedinStatus === "NOT_FOUND",
  },
  {
    id: "social.linkedin_present",
    label: "LinkedIn present",
    category: "social",
    exclusiveGroup: "linkedin",
    description:
      "A LinkedIn company page or profile was found — often the difference between a consumer " +
      "storefront and a business that buys from other businesses.",
    test: (lead) => lead.linkedinStatus === "ACTIVE",
  },

  // ── Contact channels ──
  {
    id: "contact.no_whatsapp",
    label: "No WhatsApp channel",
    category: "contact",
    description:
      "No WhatsApp link on the site. Counted as absent when the site is missing or broken, " +
      "since there is then no channel to reach either way.",
    test: (lead) => absentOrUnobservable(lead, lead.whatsappPresent),
  },
  {
    id: "contact.no_booking",
    label: "No online booking",
    category: "contact",
    description:
      "No appointment or booking system detected. Counted as absent when the site is missing " +
      "or broken.",
    test: (lead) => absentOrUnobservable(lead, lead.appointmentSystem),
  },
  {
    id: "contact.no_email",
    label: "No published email",
    category: "contact",
    exclusiveGroup: "email",
    description:
      "No email address found on the site. Counted as absent when the site is missing or broken.",
    test: (lead) => (hasNoUsableWebsite(lead) ? true : !lead.emails || lead.emails.length === 0),
  },
  {
    id: "contact.has_email",
    label: "Published email",
    category: "contact",
    exclusiveGroup: "email",
    description: "At least one email address was found, so the business is reachable by email.",
    test: (lead) => !hasNoUsableWebsite(lead) && !!lead.emails && lead.emails.length > 0,
  },
  {
    id: "contact.has_phone",
    label: "Published phone number",
    category: "contact",
    description: "A usable phone number is listed.",
    test: (lead) => {
      const phone = (lead.phone ?? "").trim().toLowerCase();
      return phone.length > 0 && phone !== "not found";
    },
  },

  // ── Tracking ──
  {
    id: "tracking.no_analytics",
    label: "No web analytics",
    category: "tracking",
    exclusiveGroup: "analytics",
    description:
      "No Google Analytics or Tag Manager tag found. Counted as absent when the site is " +
      "missing or broken.",
    test: (lead) => absentOrUnobservable(lead, lead.googleAnalyticsPresent),
  },
  {
    id: "tracking.has_analytics",
    label: "Web analytics installed",
    category: "tracking",
    exclusiveGroup: "analytics",
    description:
      "An analytics tag is present, which suggests someone is already measuring marketing.",
    test: (lead) => !hasNoUsableWebsite(lead) && !!lead.googleAnalyticsPresent,
  },
  {
    id: "tracking.no_pixel",
    label: "No advertising pixel",
    category: "tracking",
    description:
      "No Meta Pixel found, so the business is not retargeting visitors. Counted as absent " +
      "when the site is missing or broken.",
    test: (lead) => absentOrUnobservable(lead, lead.metaPixelPresent),
  },
];

const BY_ID = new Map<string, SignalDefinition>(SIGNALS.map((s) => [s.id, s]));

export function getSignal(id: string): SignalDefinition | undefined {
  return BY_ID.get(id);
}

export function isKnownSignal(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

export interface SignalListing {
  id: string;
  label: string;
  category: SignalCategory;
  description: string;
  exclusiveGroup?: string;
  thresholdLabel?: string;
  defaultThreshold?: number;
}

/** Registry listing for the rule editor. */
export function listSignals(): SignalListing[] {
  return SIGNALS.map(({ test: _test, ...rest }) => rest);
}
