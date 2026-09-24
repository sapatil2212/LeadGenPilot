"use client";
import React from "react";
import { motion } from "framer-motion";
import { Sparkles, Layers } from "lucide-react";
import StepsVisual from "./StepsVisual";

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-white border-b border-slate-100 relative">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <motion.div 
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto mb-14"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 mb-3">
            <Layers className="w-3.5 h-3.5" /> 3-Step Workflow
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight mb-3">
            How LeadGenPilot Works
          </h2>
          <p className="text-sm sm:text-base text-slate-500 max-w-lg mx-auto leading-relaxed">
            From headless geographic scraping to AI evaluation and live Google Sheets delivery — fully automated in three easy steps.
          </p>
        </motion.div>

        {/* Animated Interactive Steps Component */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <StepsVisual />
        </motion.div>
      </div>
    </section>
  );
}
