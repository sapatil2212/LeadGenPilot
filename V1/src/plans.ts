/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Subscription plans and their entitlements.
 *
 * These mirror the pricing tiers shown on the marketing site:
 *  - Free Forever : 100 leads/month, email outreach, AI scoring, Sheets sync,
 *                   basic dedup + analysis. No WhatsApp, no advanced AI insights.
 *  - Pro (₹999/mo): unlimited leads, WhatsApp outreach, advanced AI insights.
 *  - Custom       : everything in Pro, custom volume.
 *
 * The backend is the source of truth — the frontend only uses these to
 * render locks/upgrade prompts. All enforcement happens server-side.
 */

export type PlanId = "free" | "pro" | "custom" | "admin";

export interface Entitlements {
  /** Human-readable plan name. */
  planName: string;
  /** Max new leads that can be scraped per calendar month. Infinity = unlimited. */
  monthlyLeadLimit: number;
  /** Whether WhatsApp outreach (gateway, campaigns, sends) is available. */
  whatsappOutreach: boolean;
  /** Whether advanced AI (Gemini) copy/insights are available (else rule-based). */
  aiInsights: boolean;
  /** Priority support flag (informational). */
  prioritySupport: boolean;
  /** Custom integrations flag (informational). */
  customIntegrations: boolean;
}

export const PLANS: Record<Exclude<PlanId, "admin">, Entitlements> = {
  free: {
    planName: "Free Forever",
    monthlyLeadLimit: 100,
    whatsappOutreach: false,
    aiInsights: false,
    prioritySupport: false,
    customIntegrations: false,
  },
  pro: {
    planName: "Pro",
    monthlyLeadLimit: Infinity,
    whatsappOutreach: true,
    aiInsights: true,
    prioritySupport: true,
    customIntegrations: true,
  },
  custom: {
    planName: "Custom",
    monthlyLeadLimit: Infinity,
    whatsappOutreach: true,
    aiInsights: true,
    prioritySupport: true,
    customIntegrations: true,
  },
};

/**
 * Entitlements used when authentication is disabled (no DATABASE_URL) or for
 * internal/admin contexts — everything unlocked so the app stays usable.
 */
export const ADMIN_ENTITLEMENTS: Entitlements = {
  planName: "Unlimited",
  monthlyLeadLimit: Infinity,
  whatsappOutreach: true,
  aiInsights: true,
  prioritySupport: true,
  customIntegrations: true,
};

export function getEntitlements(planId: string | null | undefined): Entitlements {
  if (!planId) return ADMIN_ENTITLEMENTS;
  const key = planId.toLowerCase();
  if (key === "admin") return ADMIN_ENTITLEMENTS;
  return PLANS[(key as Exclude<PlanId, "admin">)] ?? PLANS.free;
}

/** Feature keys that can be gated with requireFeature(). */
export type GatedFeature = "whatsappOutreach" | "aiInsights";
