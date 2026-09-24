"use client";
import { motion } from "framer-motion";
import { Check, Zap, Rocket, Building2 } from "lucide-react";

const plans = [
  {
    icon: Rocket,
    name: "Free Forever",
    price: "Free",
    period: "forever",
    desc: "Perfect for solo freelancers and small teams getting started with lead generation.",
    cta: "Get Started Free",
    ctaStyle: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    featured: false,
    features: [
      { label: "100 leads / month",        on: true },
      { label: "Email Outreach (SMTP)",   on: true },
      { label: "AI Lead Scoring (0-100)", on: true },
      { label: "Google Sheets Live Sync", on: true },
      { label: "Duplicate Cache Detection",on: true },
      { label: "Basic Opportunity Notes", on: true },
      { label: "WhatsApp Outreach",      on: false },
      { label: "Advanced AI Pitch Copy", on: false },
      { label: "Priority Live Support",  on: false },
    ],
  },
  {
    icon: Zap,
    name: "Pro Scale",
    price: "₹999",
    period: "/mo",
    desc: "For growing agencies and high-volume sales teams ready to accelerate booked calls.",
    cta: "Upgrade to Pro",
    ctaStyle: "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500",
    featured: true,
    features: [
      { label: "Unlimited leads / month", on: true },
      { label: "AI Lead Scoring (0-100)", on: true },
      { label: "Google Sheets Live Sync", on: true },
      { label: "Smart Hash Deduplication",on: true },
      { label: "Email Outreach (SMTP)",   on: true },
      { label: "WhatsApp Web & Cloud API",on: true },
      { label: "Gemini 2.0 AI Pitch Copy",on: true },
      { label: "Priority Response Support",on: true },
      { label: "Custom CRM Webhooks",     on: true },
    ],
  },
  {
    icon: Building2,
    name: "Custom Agency",
    price: "Custom",
    period: "",
    desc: "For enterprise agencies requiring custom scraper workers, SLAs, and integrations.",
    cta: "Contact Sales",
    ctaStyle: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    featured: false,
    features: [
      { label: "Everything in Pro Scale", on: true },
      { label: "Custom multi-worker VPS", on: true },
      { label: "Multi-city simultaneous runs", on: true },
      { label: "Dedicated account manager", on: true },
      { label: "Custom integrations & API", on: true },
      { label: "White-label reports",     on: true },
      { label: "99.9% uptime SLA",        on: true },
      { label: "1-on-1 workflow setup",   on: true },
    ],
  },
];

export default function Pricing() {
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {plans.map((p, i) => (
            <motion.div 
              key={p.name}
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
                    <p.icon className="w-5 h-5" />
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
                  {p.features.map(f => (
                    <li key={f.label} className={`flex items-center gap-2.5 text-xs ${f.on ? "text-slate-600 font-medium" : "text-slate-300"}`}>
                      <Check className={`w-3.5 h-3.5 flex-shrink-0 ${f.on ? "text-emerald-500" : "text-slate-200"}`} />
                      {f.label}
                    </li>
                  ))}
                </ul>
              </div>

              <a 
                href="/app" 
                className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${p.ctaStyle}`}
              >
                {p.featured && <Zap className="w-3.5 h-3.5 fill-white" />}
                {p.cta}
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
