"use client";
import { motion } from "framer-motion";
import { Check, Zap, Rocket, Building2 } from "lucide-react";

const plans = [
  {
    icon: Rocket, name: "Free Forever", price: "Free", period: "forever",
    desc: "Perfect for solo freelancers and small teams getting started. No credit card required.",
    cta: "Get Started Free", ctaStyle: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    featured: false,
    features: [
      { label: "100 leads/month",        on: true },
      { label: "Email Outreach",         on: true },
      { label: "AI Lead Scoring",        on: true },
      { label: "Google Sheets Sync",     on: true },
      { label: "Basic Deduplication",    on: true },
      { label: "Basic Lead Analysis",    on: true },
      { label: "WhatsApp Outreach",      on: false },
      { label: "Advanced AI Insights",   on: false },
      { label: "Priority Support",       on: false },
    ],
  },
  {
    icon: Zap, name: "Pro", price: "₹999", period: "/mo",
    desc: "For growing agencies and serious sales teams ready to scale outreach.",
    cta: "Upgrade to Pro", ctaStyle: "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30 hover:from-indigo-500 hover:to-violet-500",
    featured: true,
    features: [
      { label: "Unlimited leads/month",   on: true },
      { label: "AI Lead Scoring",         on: true },
      { label: "Google Sheets Sync",      on: true },
      { label: "Smart Deduplication",     on: true },
      { label: "Email Outreach (SMTP)",   on: true },
      { label: "WhatsApp Outreach",       on: true },
      { label: "Advanced AI Insights",    on: true },
      { label: "Priority Support",        on: true },
      { label: "Custom Integrations",     on: true },
    ],
  },
  {
    icon: Building2, name: "Custom", price: "Custom", period: "",
    desc: "For large teams and agencies with custom volume, SLA, and integration needs.",
    cta: "Contact Sales", ctaStyle: "border border-slate-200 bg-white text-slate-705 hover:bg-slate-50",
    featured: false,
    features: [
      { label: "Everything in Pro",        on: true },
      { label: "Custom lead volume",       on: true },
      { label: "Multi-city campaigns",     on: true },
      { label: "Dedicated account manager", on: true },
      { label: "Custom integrations & API", on: true },
      { label: "White-label option",       on: true },
      { label: "SLA guarantee",            on: true },
      { label: "Onboarding & training",    on: true },
    ],
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} className="text-center max-w-2xl mx-auto mb-16">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-indigo-50 text-indigo-600 border border-indigo-100 mb-4">
            Pricing
          </span>
          <h2 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            Simple, <span className="gradient-text">Transparent</span> Pricing
          </h2>
          <p className="text-slate-500 text-lg">Start free and scale as your lead generation grows. No hidden fees.</p>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {plans.map((p, i) => (
            <motion.div key={p.name}
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.12, duration: 0.6 }}
              whileHover={{ y: -4 }}
              className={`relative rounded-3xl border p-8 transition-all duration-300 ${
                p.featured
                  ? "border-indigo-300 bg-gradient-to-b from-indigo-50/60 to-white shadow-2xl shadow-indigo-500/15 ring-1 ring-indigo-200"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg"
              }`}>

              {p.featured && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold rounded-full uppercase tracking-widest shadow-lg">
                  Most Popular
                </div>
              )}

              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-5 ${p.featured ? "bg-indigo-100" : "bg-slate-100"}`}>
                <p.icon className={`w-5 h-5 ${p.featured ? "text-indigo-600" : "text-slate-600"}`} />
              </div>

              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">{p.name}</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-extrabold text-slate-900 tracking-tight">{p.price}</span>
                {p.period && <span className="text-slate-400 font-medium">{p.period}</span>}
              </div>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">{p.desc}</p>

              <hr className="border-slate-100 mb-6" />

              <ul className="space-y-3 mb-8">
                {p.features.map(f => (
                  <li key={f.label} className={`flex items-center gap-3 text-sm ${f.on ? "text-slate-600" : "text-slate-300"}`}>
                    <Check className={`w-4 h-4 flex-shrink-0 ${f.on ? "text-emerald-500" : "text-slate-200"}`} />
                    {f.label}
                  </li>
                ))}
              </ul>

              <a href="#cta" className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 hover:-translate-y-0.5 ${p.ctaStyle}`}>
                {p.featured && <Zap className="w-4 h-4 fill-white" />}
                {p.cta}
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
