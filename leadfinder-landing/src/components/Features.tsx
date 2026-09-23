"use client";
import { motion } from "framer-motion";
import { Search, Sparkles, Zap, Database, Mail, Shield } from "lucide-react";

const features = [
  {
    Icon: Search,
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-600",
    tag: "Scraping",
    tagBg: "bg-indigo-50",
    tagColor: "text-indigo-600",
    title: "Google Maps Automation",
    desc: "Playwright-powered Chromium headlessly scans any business category in any city — extracting name, verified phone, address, ratings, reviews, and social handles.",
    stat: "100+ listings per run",
  },
  {
    Icon: Sparkles,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    tag: "AI Insights",
    tagBg: "bg-violet-50",
    tagColor: "text-violet-600",
    title: "Gemini AI Opportunity Analysis",
    desc: "Every lead receives an automated pitch angle highlighting operational gaps, lack of mobile booking portals, and reputation strengths.",
    stat: "Powered by Gemini 2.0",
  },
  {
    Icon: Zap,
    iconBg: "bg-sky-50",
    iconColor: "text-sky-600",
    tag: "Scoring",
    tagBg: "bg-sky-50",
    tagColor: "text-sky-600",
    title: "Smart 0–100 Lead Scoring",
    desc: "Leads are evaluated across website absence, review volume, star rating, and direct phone lines so your sales team only focuses on HOT opportunities.",
    stat: "Automated qualification",
  },
  {
    Icon: Database,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    tag: "Delivery",
    tagBg: "bg-emerald-50",
    tagColor: "text-emerald-600",
    title: "Real-Time Google Sheets Sync",
    desc: "Streams directly to your Google Sheet via custom Apps Script webhooks the second leads are scored. Zero manual exports or messy CSV uploads.",
    stat: "< 1.5s webhook latency",
  },
  {
    Icon: Mail,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    tag: "Outreach",
    tagBg: "bg-amber-50",
    tagColor: "text-amber-700",
    title: "Email & WhatsApp Outreach",
    desc: "Dispatch AI-personalized emails via custom SMTP and automated WhatsApp conversations with human-paced delivery to protect account health.",
    stat: "1-click multi-channel",
  },
  {
    Icon: Shield,
    iconBg: "bg-rose-50",
    iconColor: "text-rose-600",
    tag: "Reliability",
    tagBg: "bg-rose-50",
    tagColor: "text-rose-600",
    title: "Deduplication & Failure Safety",
    desc: "Unique name and address hash caching guarantees you never scrape the same business twice. Automatic 3-retry webhook delivery ensures zero data loss.",
    stat: "100% duplicate protection",
  },
];

const container = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

export default function Features() {
  return (
    <section id="features" className="py-24 bg-gradient-to-b from-slate-50 to-white border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <motion.div 
          initial={{ opacity: 0, y: 16 }} 
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} 
          className="text-center max-w-2xl mx-auto mb-14"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Platform Capabilities
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight mb-3">
            Engineered for Modern <span className="gradient-text">Outbound Sales</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-500 leading-relaxed max-w-lg mx-auto">
            Everything your agency or sales team needs to find, score, and close high-value local business clients.
          </p>
        </motion.div>

        {/* Standardized 6-Card Grid */}
        <motion.div 
          variants={container} 
          initial="hidden" 
          whileInView="visible" 
          viewport={{ once: true, margin: "-40px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((f) => (
            <motion.div 
              key={f.title} 
              variants={item}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="group relative bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 cursor-default flex flex-col justify-between h-full"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-xl ${f.iconBg} flex items-center justify-center group-hover:scale-105 transition-transform duration-300`}>
                    <f.Icon className={`w-5 h-5 ${f.iconColor}`} />
                  </div>
                  <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${f.tagBg} ${f.tagColor}`}>
                    {f.tag}
                  </span>
                </div>

                <h3 className="text-base font-semibold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed mb-4">{f.desc}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className={`text-xs font-semibold ${f.iconColor}`}>{f.stat}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
