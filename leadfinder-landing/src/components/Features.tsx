"use client";
import { motion } from "framer-motion";
import { Search, Sparkles, Zap, Database, Mail, Shield } from "lucide-react";

const features = [
  {
    Icon: Search, color: "indigo",
    iconBg: "bg-indigo-100", iconColor: "text-indigo-600",
    tag: "Scraping", tagBg: "bg-indigo-50", tagColor: "text-indigo-600",
    title: "Google Maps Automation",
    desc: "Playwright-powered Chromium headlessly scans any business type in any city — extracting name, phone, address, ratings, reviews, and all social handles automatically.",
    stat: "100+ listings/run",
  },
  {
    Icon: Sparkles, color: "violet",
    iconBg: "bg-violet-100", iconColor: "text-violet-600",
    tag: "AI", tagBg: "bg-violet-50", tagColor: "text-violet-600",
    title: "Gemini AI Insights",
    desc: "Each lead gets a unique AI-generated insight: opportunity gaps, digital weakness analysis, and a personalized outreach angle — powered by Google Gemini.",
    stat: "AI-powered per lead",
  },
  {
    Icon: Zap, color: "blue",
    iconBg: "bg-blue-100", iconColor: "text-blue-600",
    tag: "Scoring", tagBg: "bg-blue-50", tagColor: "text-blue-600",
    title: "Smart Lead Scoring",
    desc: "Every lead is scored 0–100 across website presence, review count, star rating, and phone availability. Focus exclusively on HOT and WARM leads.",
    stat: "0–100 score engine",
  },
  {
    Icon: Database, color: "emerald",
    iconBg: "bg-emerald-100", iconColor: "text-emerald-600",
    tag: "Delivery", tagBg: "bg-emerald-50", tagColor: "text-emerald-600",
    title: "Real-Time Google Sheets Sync",
    desc: "Leads stream directly to your Google Sheet via Apps Script webhooks the moment they're scored. No manual exports, no CSVs, no delays.",
    stat: "<2s sync time",
  },
  {
    Icon: Mail, color: "amber",
    iconBg: "bg-amber-100", iconColor: "text-amber-600",
    tag: "Outreach", tagBg: "bg-amber-50", tagColor: "text-amber-700",
    title: "Email & WhatsApp Outreach",
    desc: "Send AI-crafted, fully personalized emails and WhatsApp messages directly from the dashboard. Delivery status syncs back to your sheet automatically.",
    stat: "1-click outreach",
  },
  {
    Icon: Shield, color: "rose",
    iconBg: "bg-rose-100", iconColor: "text-rose-600",
    tag: "Reliability", tagBg: "bg-rose-50", tagColor: "text-rose-600",
    title: "Deduplication & Failure Safety",
    desc: "Hash-based deduplication eliminates duplicate leads across every run. 3-retry webhook delivery with offline fallback ensures zero lead is ever lost.",
    stat: "98% accuracy",
  },
];

const container = { hidden: {}, visible: { transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6 } } };

export default function Features() {
  return (
    <section id="features" className="py-24 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} className="text-center max-w-2xl mx-auto mb-16">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-indigo-50 text-indigo-600 border border-indigo-100 mb-4">
            <Sparkles className="w-3.5 h-3.5" /> Everything You Need
          </span>
          <h2 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            Built for Serious<br /><span className="gradient-text">Lead Generation</span>
          </h2>
          <p className="text-slate-500 text-lg leading-relaxed">
            A complete AI automation stack — from scraping to outreach — with intelligence at every step.
          </p>
        </motion.div>

        {/* Grid */}
        <motion.div variants={container} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <motion.div key={f.title} variants={item}
              whileHover={{ y: -6, transition: { duration: 0.2 } }}
              className="group relative bg-white rounded-3xl border border-slate-200 p-8 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 cursor-default overflow-hidden">

              {/* Gradient hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/0 to-violet-50/0 group-hover:from-indigo-50/40 group-hover:to-violet-50/20 transition-all duration-500 rounded-3xl pointer-events-none" />

              <div className="relative">
                <div className={`w-12 h-12 rounded-2xl ${f.iconBg} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
                  <f.Icon className={`w-6 h-6 ${f.iconColor}`} />
                </div>
                <span className={`inline-block text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3 ${f.tagBg} ${f.tagColor}`}>
                  {f.tag}
                </span>
                <h3 className="text-base font-bold text-slate-900 mb-3">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-5">{f.desc}</p>
                <div className="flex items-center gap-2 pt-4 border-t border-slate-100">
                  <span className={`text-xs font-bold ${f.iconColor}`}>{f.stat}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
