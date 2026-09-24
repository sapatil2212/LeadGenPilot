"use client";
import { motion } from "framer-motion";
import { ArrowRight, Star, Sparkles, MapPin, Send, Mail, Database, Sliders, TrendingUp, Download, CheckCircle, Target, Radio, Webhook, UserPlus } from "lucide-react";
import HeroDashboard from "./HeroDashboard";

// Stable twinkling stars generated once (kept to the left/top region)
const stars = [
  { top: "12%", left: "15%", size: 1.5, delay: 0.5, duration: 3 },
  { top: "25%", left: "8%", size: 2.0, delay: 1.2, duration: 4 },
  { top: "8%", left: "45%", size: 1.0, delay: 0.2, duration: 2 },
  { top: "18%", left: "38%", size: 2.5, delay: 2.1, duration: 5 },
  { top: "5%", left: "62%", size: 1.2, delay: 0.8, duration: 3 },
  { top: "35%", left: "22%", size: 1.8, delay: 1.5, duration: 4 },
  { top: "45%", left: "12%", size: 2.2, delay: 0.3, duration: 3.5 },
  { top: "55%", left: "30%", size: 1.5, delay: 2.5, duration: 4 },
  { top: "62%", left: "6%", size: 2.0, delay: 1.9, duration: 3 },
  { top: "72%", left: "18%", size: 1.0, delay: 0.7, duration: 2.5 },
  { top: "30%", left: "48%", size: 1.5, delay: 1.4, duration: 3 },
  { top: "78%", left: "42%", size: 1.2, delay: 2.8, duration: 4.5 },
  { top: "15%", left: "28%", size: 2.3, delay: 1.7, duration: 4 },
  { top: "88%", left: "10%", size: 1.6, delay: 0.6, duration: 3.5 },
  { top: "40%", left: "55%", size: 1.2, delay: 1.3, duration: 3 },
  { top: "20%", left: "5%", size: 2.5, delay: 0.2, duration: 5 },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[#04060f] text-white pt-32 pb-16">
      {/* ──────────── Background FX ──────────── */}

      {/* Top blue glow arc - shifted more to the right */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease }}
        className="pointer-events-none absolute -top-40 left-[55%] -translate-x-1/3 w-[1100px] h-[600px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.28),rgba(37,99,235,0.08)_45%,transparent_70%)] blur-2xl z-0"
      />

      {/* Secondary pulsing indigo glow behind dashboard - shifted more to the right */}
      <motion.div
        animate={{ opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute top-[6%] right-[-2%] w-[720px] h-[720px] rounded-full bg-[radial-gradient(circle,rgba(79,70,229,0.22),transparent_65%)] blur-3xl z-0"
      />

      {/* Thin luminous line under the glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent z-0" />

      {/* Grid overlay - smaller grid */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)] z-0" />

      {/* Twinkling stars */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {stars.map((s, i) => (
          <motion.div
            key={i}
            style={{
              position: "absolute",
              top: s.top,
              left: s.left,
              width: `${s.size}px`,
              height: `${s.size}px`,
              backgroundColor: s.size > 2 ? "#bae6fd" : "#ffffff",
              borderRadius: "50%",
              boxShadow: s.size > 2 ? "0 0 8px #38bdf8" : "none",
            }}
            animate={{ opacity: [0.15, 1, 0.15], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: s.duration, repeat: Infinity, ease: "easeInOut", delay: s.delay }}
          />
        ))}
      </div>

      {/* ──────────── Static 3D dashboard: slides in from right, half hidden off the right edge ──────────── */}
      <div
        className="pointer-events-none absolute top-[160px] left-[52%] right-0 bottom-0 hidden lg:block z-[4] [perspective:3400px]"
        style={{
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 14%, black 100%)",
          maskImage: "linear-gradient(to right, transparent 0%, black 14%, black 100%)",
        }}
      >
        {/* soft glow behind the cluster */}
        <div className="absolute top-0 left-[20%] w-[70%] h-[55%] rounded-[40px] bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.18),transparent_60%)] blur-2xl" />

        <motion.div
          initial={{ opacity: 0, x: 140, rotateX: 2, rotateY: -9, rotateZ: 1 }}
          animate={{ opacity: 1, x: 0, rotateX: 2, rotateY: -9, rotateZ: 1 }}
          transition={{ duration: 1, delay: 0.25, ease }}
          className="relative origin-top-left"
          style={{ transformStyle: "preserve-3d" }}
        >
          <HeroDashboard />
        </motion.div>
      </div>

      {/* ──────────── Left copy ──────────── */}
      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <div className="max-w-xl flex flex-col items-start text-left">
          {/* Announcement pill */}
          <motion.a
            href="#features"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="group inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 pl-1.5 pr-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-sm hover:bg-white/[0.08] transition-colors mb-8"
          >
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              New
            </span>
            Explore Our New AI Outreach Engine
            <ArrowRight className="w-3 h-3 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </motion.a>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease }}
            className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[0.98] mb-6"
          >
            Smarter
            <br />
            Lead Finding
            <br />
            <span className="bg-gradient-to-r from-sky-300 via-indigo-300 to-violet-400 bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(56,189,248,0.35)]">
              Starts Here
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease }}
            className="text-base sm:text-lg text-slate-400 max-w-md leading-relaxed mb-9"
          >
            Powerful Google Maps scraping, AI lead scoring, and automated outreach — all in one intuitive platform.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease }}
            className="flex flex-col sm:flex-row items-center gap-4 mb-14"
          >
            <a
              href="/app"
              className="group flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-slate-900 shadow-[0_0_40px_rgba(56,189,248,0.25)] hover:shadow-[0_0_55px_rgba(56,189,248,0.45)] hover:-translate-y-0.5 transition-all duration-300"
            >
              Start Finding Leads
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </motion.div>

          {/* Rating cards removed */}
        </div>
      </div>

      {/* ──────────── Bottom infinite marquee: portal features ──────────── */}
      <div className="relative z-10 w-full mt-24 pt-10 border-t border-white/[0.06] overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 text-center mb-6">
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
            Powerful features built for growth
          </p>
        </div>
        
        {/* Marquee container */}
        <div className="relative px-6">
          {/* Fade masks on edges */}
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-48 bg-gradient-to-r from-[#04060f] via-[#04060f]/85 to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-48 bg-gradient-to-l from-[#04060f] via-[#04060f]/85 to-transparent z-10" />
          
          {/* Infinite scroll track */}
          <div className="flex">
            <motion.div
              animate={{ x: [0, -1400] }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              className="flex shrink-0 gap-1"
            >
              {[
                { icon: Sparkles, label: "AI Lead Scoring" },
                { icon: MapPin, label: "Google Maps Scraper" },
                { icon: Send, label: "WhatsApp Integration" },
                { icon: Mail, label: "Email Campaigns" },
                { icon: Database, label: "Google Sheets Sync" },
                { icon: Sparkles, label: "Gemini AI Insights" },
                { icon: Sliders, label: "Smart Filters" },
                { icon: TrendingUp, label: "Real-time Analytics" },
                { icon: Download, label: "CRM Export" },
                { icon: CheckCircle, label: "Duplicate Detection" },
                { icon: Target, label: "Priority Routing" },
                { icon: Radio, label: "Multi-Channel Outreach" },
                { icon: Webhook, label: "Custom Webhooks" },
                { icon: UserPlus, label: "Lead Enrichment" },
              ].map((feature, i) => (
                <div
                  key={`a-${i}`}
                  className="flex items-center gap-2 px-5 py-2.5 whitespace-nowrap"
                >
                  <feature.icon className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-300">{feature.label}</span>
                </div>
              ))}
            </motion.div>
            
            {/* Duplicate for seamless loop */}
            <motion.div
              animate={{ x: [0, -1400] }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              className="flex shrink-0 gap-1"
            >
              {[
                { icon: Sparkles, label: "AI Lead Scoring" },
                { icon: MapPin, label: "Google Maps Scraper" },
                { icon: Send, label: "WhatsApp Integration" },
                { icon: Mail, label: "Email Campaigns" },
                { icon: Database, label: "Google Sheets Sync" },
                { icon: Sparkles, label: "Gemini AI Insights" },
                { icon: Sliders, label: "Smart Filters" },
                { icon: TrendingUp, label: "Real-time Analytics" },
                { icon: Download, label: "CRM Export" },
                { icon: CheckCircle, label: "Duplicate Detection" },
                { icon: Target, label: "Priority Routing" },
                { icon: Radio, label: "Multi-Channel Outreach" },
                { icon: Webhook, label: "Custom Webhooks" },
                { icon: UserPlus, label: "Lead Enrichment" },
              ].map((feature, i) => (
                <div
                  key={`b-${i}`}
                  className="flex items-center gap-2 px-5 py-2.5 whitespace-nowrap"
                >
                  <feature.icon className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-300">{feature.label}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
