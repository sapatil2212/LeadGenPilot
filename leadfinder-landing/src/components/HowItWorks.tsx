"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Link2, Play, Check, Copy, Terminal, CheckCircle2 } from "lucide-react";

interface StepItem {
  id: number;
  n: string;
  Icon: React.ElementType;
  title: string;
  desc: string;
}

const steps: StepItem[] = [
  {
    id: 0,
    n: "01",
    Icon: Settings,
    title: "Target Setup",
    desc: "Set business type and location.",
  },
  {
    id: 1,
    n: "02",
    Icon: Link2,
    title: "Connect Sheets",
    desc: "Paste Webhook URL once.",
  },
  {
    id: 2,
    n: "03",
    Icon: Play,
    title: "Launch Scraper",
    desc: "Start scan to collect leads.",
  },
];

export default function HowItWorks() {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);
  const [isScraping, setIsScraping] = useState<boolean>(false);

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="how-it-works" className="py-16 bg-white border-y border-slate-200">
      <div className="max-w-4xl mx-auto px-6">
        {/* Simple Header */}
        <div className="text-center max-w-lg mx-auto mb-10">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 border border-slate-200 rounded-full px-3 py-1 inline-block mb-3">
            Simple Setup
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
            3 Steps to Leads
          </h2>
          <p className="text-slate-500 text-xs sm:text-sm">
            Connect Google Sheets once and extract verified B2B leads.
          </p>
        </div>

        {/* 3 Step Selector Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {steps.map((step) => {
            const isActive = activeStep === step.id;
            const Icon = step.Icon;
            return (
              <button
                key={step.n}
                onClick={() => setActiveStep(step.id)}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  isActive
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isActive ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-700"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-mono ${isActive ? "text-slate-400" : "text-slate-400"}`}>
                      {step.n}
                    </span>
                    <h3 className="text-xs font-bold truncate">{step.title}</h3>
                  </div>
                  <p className={`text-[11px] mt-0.5 ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                    {step.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Compact Flat Live Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 min-h-[180px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {activeStep === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="space-y-3 max-w-md mx-auto w-full"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Business Type</label>
                    <input
                      type="text"
                      readOnly
                      value="Dental Clinics"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Location</label>
                    <input
                      type="text"
                      readOnly
                      value="Baner, Pune"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 text-center pt-1">
                  Ready to search for businesses in specified region.
                </div>
              </motion.div>
            )}

            {activeStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="space-y-3 max-w-md mx-auto w-full"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                  <span>Google Sheets Webhook</span>
                  <span className="flex items-center gap-1 text-slate-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value="https://script.google.com/macros/s/..."
                    className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-600"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-slate-800 transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </motion.div>
            )}

            {activeStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="space-y-3 max-w-md mx-auto w-full"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Terminal className="w-3.5 h-3.5" /> Scraper Tool
                  </div>
                  <button
                    onClick={() => setIsScraping(!isScraping)}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
                  >
                    {isScraping ? "Pause Scan" : "Start Scan"}
                  </button>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-3 text-[11px] font-mono text-slate-600 space-y-1">
                  <div className="flex justify-between border-b border-slate-100 pb-1">
                    <span>Status: {isScraping ? "Scanning Maps..." : "Ready"}</span>
                    <span className="font-bold text-slate-900">24 Leads Found</span>
                  </div>
                  <p className="text-slate-500 text-[10px]">Auto-exporting rows to Google Sheets in real-time.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
