"use client";
import React from "react";
import { motion } from "framer-motion";
import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    stars: 5,
    initials: "RK",
    name: "Rahul Kapoor",
    role: "Sales Director, WebPitch Agency",
    color: "from-indigo-500 to-violet-500",
    quote: "We went from spending 4 hours manually sourcing leads per day to having 200+ qualified HOT leads in our sheet every morning. Every 90+ scored lead converted into a sales call.",
    metric: "4hrs saved daily",
  },
  {
    stars: 5,
    initials: "PS",
    name: "Priya Sharma",
    role: "Freelance Web Designer, Pune",
    color: "from-blue-500 to-indigo-500",
    quote: "The WhatsApp outreach feature is a game-changer. Personalized messages go out automatically and I track replies directly in my sheet. Closed 11 website clients in my first month!",
    metric: "11 clients in month 1",
  },
  {
    stars: 5,
    initials: "AM",
    name: "Arjun Mehta",
    role: "Growth Lead, DigitalBoost Co.",
    color: "from-emerald-500 to-teal-500",
    quote: "Setup took 10 minutes. The deduplication is excellent — we've scraped the same city 8 times and never got a single duplicate. Highly reliable at this price point.",
    metric: "Zero duplicates ever",
  },
  {
    stars: 5,
    initials: "SN",
    name: "Sneha Nair",
    role: "Agency Founder, Apex Digital",
    color: "from-purple-500 to-pink-500",
    quote: "Our cold email open rates jumped to 42% because Gemini AI tailors pitch angles for every local business niche automatically.",
    metric: "42% open rate",
  },
  {
    stars: 5,
    initials: "VK",
    name: "Vikram Kulkarni",
    role: "B2B Outreach Manager",
    color: "from-amber-500 to-orange-500",
    quote: "Syncing leads live into Google Sheets made CRM onboarding instant for our 5 sales reps. Simple, bulletproof, and fast.",
    metric: "Instant CRM sync",
  },
  {
    stars: 5,
    initials: "TD",
    name: "Tanya Das",
    role: "SaaS Business Development",
    color: "from-cyan-500 to-blue-600",
    quote: "Extracted 1,500+ dental clinic prospects in 2 hours. The map radius search feature makes hyper-local targeting effortless.",
    metric: "1.5k leads in 2 hrs",
  },
];

// Duplicate for continuous marquee loop
const marqueeList = [...testimonials, ...testimonials];

export default function Testimonials() {
  return (
    <section id="testimonials" className="py-24 bg-gradient-to-b from-white to-slate-50 border-b border-slate-100 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 mb-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200/80 mb-3">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> Customer Stories
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight mb-3">
            Proven Results for <span className="gradient-text">Agencies & Founders</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-500 leading-relaxed max-w-lg mx-auto">
            See how forward-thinking sales professionals streamline client acquisition with LeadGenPilot.
          </p>
        </motion.div>
      </div>

      {/* Infinite Marquee Container */}
      <div className="relative w-full overflow-hidden py-3">
        {/* Left & Right Gradient Fade Overlays */}
        <div className="absolute top-0 bottom-0 left-0 w-20 sm:w-36 bg-gradient-to-r from-white via-white/80 to-transparent z-10 pointer-events-none" />
        <div className="absolute top-0 bottom-0 right-0 w-20 sm:w-36 bg-gradient-to-l from-white via-white/80 to-transparent z-10 pointer-events-none" />

        {/* Marquee Track */}
        <div className="animate-marquee gap-5 px-4">
          {marqueeList.map((t, i) => (
            <div
              key={i}
              className="w-[300px] sm:w-[350px] flex-shrink-0 relative bg-white rounded-2xl border border-slate-200/90 p-6 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 group flex flex-col justify-between min-h-[260px]"
            >
              <div>
                {/* Quote icon background */}
                <div className="absolute top-5 right-5 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Quote className="w-8 h-8 text-indigo-500" />
                </div>

                {/* Stars */}
                <div className="flex gap-1 mb-3">
                  {[...Array(t.stars)].map((_, j) => (
                    <Star key={j} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>

                {/* Quote */}
                <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-4 italic font-normal">
                  "{t.quote}"
                </p>
              </div>

              <div>
                {/* Metric pill */}
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold border border-indigo-100 mb-4">
                  <span>📈</span> {t.metric}
                </div>

                {/* Author */}
                <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                  <div
                    className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm`}
                  >
                    {t.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{t.role}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
