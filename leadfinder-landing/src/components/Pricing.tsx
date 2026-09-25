"use client";
import { motion } from "framer-motion";
import { Check, X, Zap, Rocket, Building2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Pricing, published by the operator.
 *
 * The plans shown here come from GET /api/plans, which serves the catalogue
 * edited at /superadmin/dashboard/plans. That fetch happens in the browser on
 * purpose: this site is built with `output: "export"`, so anything read during
 * render is frozen into static HTML at build time and a price change would need
 * a redeploy to appear. A client fetch means an operator's edit shows up on the
 * next page load.
 *
 * The request is same-origin — the Express server serves this static export and
 * the API from one origin — so no API base URL or CORS setup is needed.
 *
 * FALLBACK_PLANS below is what renders before the response arrives and if the
 * request fails. It mirrors the backend's own compiled defaults, so a visitor
 * always sees a complete pricing table rather than an empty section.
 */

interface PlanFeature {
  label: string;
  on: boolean;
}

interface PlanCard {
  key: string;
  name: string;
  price: string;
  period: string;
  desc: string;
  cta: string;
  featured: boolean;
  features: PlanFeature[];
}

const FALLBACK_PLANS: PlanCard[] = [
  {
    key: "free",
    name: "Free Forever",
    price: "Free",
    period: "forever",
    desc: "Perfect for solo freelancers and small teams getting started with lead generation.",
    cta: "Get Started Free",
    featured: false,
    features: [
      { label: "100 leads / month", on: true },
      { label: "1 seat", on: true },
      { label: "WhatsApp outreach", on: false },
      { label: "Advanced AI insights & copy", on: false },
      { label: "Priority support", on: false },
      { label: "Custom integrations & API", on: false },
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "₹999",
    period: "/mo",
    desc: "For growing agencies and high-volume sales teams ready to accelerate booked calls.",
    cta: "Upgrade to Pro",
    featured: true,
    features: [
      { label: "Unlimited leads / month", on: true },
      { label: "Unlimited seats", on: true },
      { label: "WhatsApp outreach", on: true },
      { label: "Advanced AI insights & copy", on: true },
      { label: "Priority support", on: true },
      { label: "Custom integrations & API", on: true },
    ],
  },
];

/** One plan exactly as GET /api/plans publishes it. */
interface ApiPlan {
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  /** null means unlimited. */
  monthlyLeadLimit: number | null;
  /** null means unlimited. */
  seats: number | null;
  trialDays: number;
  features: string[];
  highlight: boolean;
}

interface ApiResponse {
  plans: ApiPlan[];
  featureKeys: string[];
  featureLabels: Record<string, string>;
}

/** Prices are stored in minor units (paise, cents) to avoid float drift. */
function formatPrice(minorUnits: number, currency: string): string {
  const major = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    // An unrecognised currency code must not break the pricing table.
    return `${currency} ${major.toLocaleString()}`;
  }
}

function toCard(plan: ApiPlan, featureKeys: string[], featureLabels: Record<string, string>): PlanCard {
  // A zero price is "Free" for the free tier and "Custom" for anything else,
  // which is how a negotiated, quote-only tier is published.
  const isQuoteOnly = plan.priceMonthly === 0 && plan.priceYearly === 0 && plan.key !== "free";
  const isFree = plan.priceMonthly === 0 && !isQuoteOnly;

  const leadLabel =
    plan.monthlyLeadLimit === null
      ? "Unlimited leads / month"
      : `${plan.monthlyLeadLimit.toLocaleString()} leads / month`;
  const seatLabel = plan.seats === null ? "Unlimited seats" : `${plan.seats} seat${plan.seats === 1 ? "" : "s"}`;

  return {
    key: plan.key,
    name: plan.name,
    price: isQuoteOnly ? "Custom" : isFree ? "Free" : formatPrice(plan.priceMonthly, plan.currency),
    period: isQuoteOnly ? "" : isFree ? "forever" : "/mo",
    desc: plan.description || "",
    cta: isQuoteOnly ? "Contact Sales" : isFree ? "Get Started Free" : `Upgrade to ${plan.name}`,
    featured: plan.highlight,
    features: [
      { label: leadLabel, on: true },
      { label: seatLabel, on: true },
      ...(plan.trialDays > 0 ? [{ label: `${plan.trialDays}-day free trial`, on: true }] : []),
      // Every plan lists the same feature rows in the same order, so the cards
      // read as a comparison table instead of three unrelated lists.
      ...featureKeys.map((featureKey) => ({
        label: featureLabels[featureKey] || featureKey,
        on: plan.features.includes(featureKey),
      })),
    ],
  };
}

/** Cycles the three icons so any number of published plans stays on-brand. */
const ICONS = [Rocket, Zap, Building2];

export default function Pricing() {
  const [plans, setPlans] = useState<PlanCard[]>(FALLBACK_PLANS);

  useEffect(() => {
    // Aborted on unmount so a slow response cannot set state on a dead component.
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/plans", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data: ApiResponse = await res.json();
        if (!Array.isArray(data.plans) || data.plans.length === 0) return;
        setPlans(data.plans.map((plan) => toCard(plan, data.featureKeys || [], data.featureLabels || {})));
      } catch {
        // Offline or server down: keep the fallback table on screen.
      }
    })();

    return () => controller.abort();
  }, []);

  return (
    <section id="pricing" className="py-24 bg-white border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto mb-14"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 mb-3">
            Simple Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight mb-3">
            Transparent Plans for <span className="gradient-text">Every Growth Stage</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-500 leading-relaxed max-w-md mx-auto">
            Start free without a credit card and scale as your client pipeline expands.
          </p>
        </motion.div>

        {/* Standardized Cards Grid */}
        <div
          className={`grid grid-cols-1 gap-6 items-stretch ${
            plans.length >= 3 ? "md:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2 max-w-3xl mx-auto" : "max-w-md mx-auto"
          }`}
        >
          {plans.map((p, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                whileHover={{ y: -4 }}
                className={`relative rounded-2xl border p-6 sm:p-7 transition-all duration-300 flex flex-col justify-between h-full ${
                  p.featured
                    ? "border-indigo-300 bg-gradient-to-b from-indigo-50/40 via-white to-white shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-200"
                    : "border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-md"
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider shadow-md">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.featured ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-600"}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{p.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">{p.price}</span>
                    {p.period && <span className="text-xs text-slate-400 font-medium">{p.period}</span>}
                  </div>
                  <p className="text-xs text-slate-500 mb-6 leading-relaxed min-h-[36px]">{p.desc}</p>

                  <hr className="border-slate-100 mb-6" />

                  <ul className="space-y-3 mb-8">
                    {p.features.map((f) => (
                      <li key={f.label} className={`flex items-center gap-2.5 text-xs ${f.on ? "text-slate-600 font-medium" : "text-slate-300"}`}>
                        {f.on ? (
                          <Check className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
                        ) : (
                          <X className="w-3.5 h-3.5 flex-shrink-0 text-slate-200" />
                        )}
                        {f.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href="/app"
                  className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                    p.featured
                      ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {p.featured && <Zap className="w-3.5 h-3.5 fill-white" />}
                  {p.cta}
                </a>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
