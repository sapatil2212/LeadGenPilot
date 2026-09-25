"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, 
  MapPin, 
  Sparkles, 
  CheckCircle2, 
  ArrowRight, 
  Database, 
  Globe, 
  Star, 
  Phone, 
  Table, 
  ExternalLink,
  ShieldCheck,
  Zap,
  Flame
} from "lucide-react";

interface StepConfig {
  id: number;
  badge: string;
  title: string;
  subtitle: string;
  detail: string;
}

const stepsData: StepConfig[] = [
  {
    id: 0,
    badge: "Step 01",
    title: "Headless Map Scanner",
    subtitle: "Real-time Google Maps extraction",
    detail: "Set your target business category and geographic radius. Chromium scans Google Maps headlessly, extracting phone numbers, ratings, reviews, and social handles.",
  },
  {
    id: 1,
    badge: "Step 02",
    title: "AI Scoring & Qualification",
    subtitle: "Gemini AI opportunity filter",
    detail: "Our algorithm checks website availability, reputation signals, and phone numbers. High-intent businesses with no website get scored 0–100 with automated pitch angles.",
  },
  {
    id: 2,
    badge: "Step 03",
    title: "Instant Google Sheets Sync",
    subtitle: "Zero manual exports or CSVs",
    detail: "Every scored lead streams directly to your Google Sheet via custom Apps Script webhooks with color-coded priority flags and one-click outreach triggers.",
  },
];

export default function StepsVisual() {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);

  // Auto-play interval with progress bar
  useEffect(() => {
    if (!isAutoPlaying) return;
    const intervalTime = 50; // 50ms ticks
    const stepDuration = 5500; // 5.5s per step
    const stepIncrement = (intervalTime / stepDuration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setActiveStep((curr) => (curr + 1) % stepsData.length);
          return 0;
        }
        return prev + stepIncrement;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isAutoPlaying, activeStep]);

  const handleStepSelect = (index: number) => {
    setIsAutoPlaying(false);
    setActiveStep(index);
    setProgress(0);
  };

  return (
    <div className="w-full">
      {/* Step Selector Pills / Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
        {stepsData.map((step, idx) => {
          const isActive = activeStep === idx;
          return (
            <button
              key={step.id}
              onClick={() => handleStepSelect(idx)}
              className={`relative text-left p-4 rounded-2xl border transition-all duration-300 overflow-hidden flex flex-col justify-between ${
                isActive
                  ? "bg-white border-indigo-300 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-200"
                  : "bg-slate-50/80 border-slate-200/80 hover:bg-slate-100/70 hover:border-slate-300"
              }`}
            >
              {/* Active step progress indicator */}
              {isActive && (
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-75"
                  style={{ width: `${progress}%` }}
                />
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full ${
                    isActive ? "bg-indigo-50 text-indigo-600 border border-indigo-200/60" : "bg-slate-200/60 text-slate-500"
                  }`}>
                    {step.badge}
                  </span>
                  {isActive && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600" />
                    </span>
                  )}
                </div>
                <h4 className={`text-sm font-semibold mb-1 ${isActive ? "text-slate-900" : "text-slate-700"}`}>
                  {step.title}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {step.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Interactive Stage Container */}
      <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl p-4 sm:p-6 lg:p-8 text-white relative overflow-hidden min-h-[440px] flex flex-col justify-center">
        {/* Background glow & subtle grid */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        <AnimatePresence mode="wait">
          {/* ─────── STEP 01: RADAR MAP SCANNER ─────── */}
          {activeStep === 0 && (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
            >
              {/* Left explanation */}
              <div className="lg:col-span-5 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" /> Live Scanning Coordinates
                </div>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                  Extract Unclaimed Local Businesses
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Target high-opportunity local niches. The scraper simulates human browsing behaviors to capture phone numbers, verified addresses, and operational hours.
                </p>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Keyword: <strong className="text-white font-medium">"Dental Clinics in Baner, Pune"</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Radius: <strong className="text-white font-medium">10 km radius • 140+ prospects parsed</strong></span>
                  </div>
                </div>
              </div>

              {/* Right Radar Mockup */}
              <div className="lg:col-span-7 bg-[#0b0f19] border border-white/10 rounded-2xl p-5 relative overflow-hidden shadow-inner">
                {/* Radar grid display */}
                <div className="relative h-64 w-full flex items-center justify-center overflow-hidden rounded-xl bg-slate-950/80 border border-white/5">
                  {/* Concentric radar rings */}
                  <div className="absolute w-20 h-20 rounded-full border border-sky-500/20" />
                  <div className="absolute w-36 h-36 rounded-full border border-sky-500/20" />
                  <div className="absolute w-52 h-52 rounded-full border border-sky-500/20" />
                  <div className="absolute w-68 h-68 rounded-full border border-sky-500/10" />

                  {/* Crosshairs */}
                  <div className="absolute inset-x-0 h-px bg-sky-500/15" />
                  <div className="absolute inset-y-0 w-px bg-sky-500/15" />

                  {/* Rotating radar sweep */}
                  <div className="absolute w-56 h-56 rounded-full animate-radar pointer-events-none">
                    <div className="w-1/2 h-1/2 bg-gradient-to-br from-sky-400/40 via-sky-500/10 to-transparent rounded-tl-full" />
                  </div>

                  {/* Center coordinates marker */}
                  <div className="relative z-10 w-3 h-3 rounded-full bg-sky-400 shadow-[0_0_12px_#38bdf8]" />

                  {/* Found business pins */}
                  <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="absolute top-10 right-16 flex items-center gap-1.5 bg-slate-900/90 border border-emerald-500/40 rounded-lg px-2.5 py-1 text-[11px] shadow-lg"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-white font-medium">Sunrise Dental</span>
                    <span className="text-emerald-400 font-bold ml-1">4.8★</span>
                  </motion.div>

                  <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="absolute bottom-12 left-12 flex items-center gap-1.5 bg-slate-900/90 border border-sky-500/40 rounded-lg px-2.5 py-1 text-[11px] shadow-lg"
                  >
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <span className="text-white font-medium">City Yoga Center</span>
                    <span className="text-sky-400 font-bold ml-1">4.9★</span>
                  </motion.div>

                  <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="absolute bottom-16 right-20 flex items-center gap-1.5 bg-slate-900/90 border border-amber-500/40 rounded-lg px-2.5 py-1 text-[11px] shadow-lg"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-white font-medium">Elite Physiotherapy</span>
                    <span className="text-amber-400 font-bold ml-1">4.6★</span>
                  </motion.div>
                </div>

                {/* Status bar */}
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-white/5 font-mono">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Scraping in progress...
                  </span>
                  <span>142 leads identified</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─────── STEP 02: AI QUALIFICATION & SCORING ─────── */}
          {activeStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
            >
              <div className="lg:col-span-5 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" /> AI Scoring & Insights
                </div>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                  Only Target High-Converting Prospects
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Stop pitching dead contacts. Gemini AI inspects every profile, verifies missing websites, checks review authenticity, and computes an automated 0–100 point score.
                </p>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <span>No Website: <strong className="text-emerald-400 font-medium">+50 Points</strong> (Prime Prospect)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <span>Reviews &gt; 100: <strong className="text-emerald-400 font-medium">+20 Points</strong> (Active Customers)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <span>Verified Phone: <strong className="text-emerald-400 font-medium">+10 Points</strong> (Ready for Outreach)</span>
                  </div>
                </div>
              </div>

              {/* Right Lead Breakdown Card */}
              <div className="lg:col-span-7 bg-[#0b0f19] border border-white/10 rounded-2xl p-5 relative overflow-hidden">
                <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-semibold text-white">Sunrise Dental Clinic</h4>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <Flame className="w-3 h-3 fill-emerald-400" /> HOT LEAD
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">Baner Road, Pune · Category: Dental Care</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">
                      98<span className="text-xs text-slate-400">/100</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">Confidence 99%</span>
                  </div>
                </div>

                {/* Score breakdown metrics */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-white/[0.03] border border-white/5 rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-rose-400" /> Website</span>
                      <span className="text-rose-400 font-medium">None Found (+50)</span>
                    </div>
                  </div>
                  <div className="bg-white/[0.03] border border-white/5 rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-400" /> Reviews</span>
                      <span className="text-amber-400 font-medium">4.8★ (234) (+20)</span>
                    </div>
                  </div>
                  <div className="bg-white/[0.03] border border-white/5 rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-emerald-400" /> Phone</span>
                      <span className="text-emerald-400 font-medium">Verified (+10)</span>
                    </div>
                  </div>
                  <div className="bg-white/[0.03] border border-white/5 rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-sky-400" /> Rating</span>
                      <span className="text-sky-400 font-medium">4.5+ Stars (+18)</span>
                    </div>
                  </div>
                </div>

                {/* Gemini AI Angle Box */}
                <div className="bg-violet-950/30 border border-violet-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-xs text-violet-300 font-semibold mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Gemini AI Pitch Angle
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    "High patient volume (234 reviews) but loses direct appointment bookings to third-party aggregators because there is no mobile booking site."
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─────── STEP 03: GOOGLE SHEETS & CRM SYNC ─────── */}
          {activeStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
            >
              <div className="lg:col-span-5 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Database className="w-3.5 h-3.5 text-emerald-400" /> Live Data Synchronization
                </div>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                  Real-time Google Sheet Delivery
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Every lead is streamed immediately via webhook as soon as it's processed. Your team or CRM receives formatted rows with contact information, scores, and status flags.
                </p>

                <div className="pt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Webhook Latency: <strong className="text-white font-medium">&lt; 1.2s per record</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Smart Deduplication: <strong className="text-white font-medium">Zero duplicate records</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>Auto-Status Updates: <strong className="text-white font-medium">Syncs email & WhatsApp replies</strong></span>
                  </div>
                </div>
              </div>

              {/* Right Spreadsheet Mockup */}
              <div className="lg:col-span-7 bg-[#0b0f19] border border-white/10 rounded-2xl p-4 sm:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                      <Table className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white">Qualified Leads (2026) - Google Sheets</h4>
                      <p className="text-[10px] text-slate-400 font-mono">Webhook status: 200 OK • Auto-saving</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live Sync
                  </span>
                </div>

                {/* Table representation */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase font-semibold text-slate-400">
                        <th className="py-2 px-2">Business</th>
                        <th className="py-2 px-2">Phone</th>
                        <th className="py-2 px-2 text-center">Score</th>
                        <th className="py-2 px-2 text-center">Priority</th>
                        <th className="py-2 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                      <tr className="bg-emerald-500/10 text-white animate-pulse">
                        <td className="py-2.5 px-2 font-sans font-medium text-white truncate max-w-[130px]">
                          Sunrise Dental Clinic
                        </td>
                        <td className="py-2.5 px-2 text-slate-300">+91 98230 ...</td>
                        <td className="py-2.5 px-2 text-center font-bold text-emerald-400">98</td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            HOT
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <span className="text-[10px] font-sans font-medium text-sky-400 hover:underline cursor-pointer">
                            Outreach &rarr;
                          </span>
                        </td>
                      </tr>
                      <tr className="text-slate-300">
                        <td className="py-2.5 px-2 font-sans font-medium text-white truncate max-w-[130px]">
                          City Yoga Studio
                        </td>
                        <td className="py-2.5 px-2 text-slate-400">+91 94220 ...</td>
                        <td className="py-2.5 px-2 text-center font-bold text-emerald-400">95</td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            HOT
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <span className="text-[10px] font-sans font-medium text-sky-400 hover:underline cursor-pointer">
                            Outreach &rarr;
                          </span>
                        </td>
                      </tr>
                      <tr className="text-slate-300">
                        <td className="py-2.5 px-2 font-sans font-medium text-white truncate max-w-[130px]">
                          Greenleaf Physio
                        </td>
                        <td className="py-2.5 px-2 text-slate-400">+91 88060 ...</td>
                        <td className="py-2.5 px-2 text-center font-bold text-sky-400">90</td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                            WARM
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <span className="text-[10px] font-sans font-medium text-sky-400 hover:underline cursor-pointer">
                            Outreach &rarr;
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Synced in real-time to Google Sheet Tab "Baner Leads"</span>
                  <span className="text-emerald-400 font-medium">Sync Active • 0 Errors</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
