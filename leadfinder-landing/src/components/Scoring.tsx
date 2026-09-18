"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Globe, Star, Phone, BarChart3, CheckCircle2, XCircle } from "lucide-react";

const scoreCriteria = [
  { label: "No Website Detected", pts: 50, icon: Globe, color: "indigo", barWidth: "50%", desc: "Primary qualification filter" },
  { label: "Reviews > 100",       pts: 20, icon: Star,  color: "blue",   barWidth: "20%", desc: "High-intent customer flow" },
  { label: "Rating > 4.5 Stars",  pts: 20, icon: BarChart3, color: "violet", barWidth: "20%", desc: "Reputable quality signal" },
  { label: "Working Phone Line",  pts: 10, icon: Phone, color: "emerald", barWidth: "10%", desc: "Verifiable contact info" },
];

const barGradients: Record<string, string> = {
  indigo: "from-indigo-400 to-violet-400",
  blue:   "from-blue-400 to-indigo-400",
  violet: "from-violet-400 to-fuchsia-400",
  emerald:"from-emerald-400 to-teal-400",
};

function ScoreBar({ label, pts, icon: Icon, color, barWidth, desc }: typeof scoreCriteria[0]) {
  const [w, setW] = useState("0%");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setTimeout(() => setW(barWidth), 200); obs.disconnect(); }
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [barWidth]);

  return (
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center`}>
            <Icon className="w-3.5 h-3.5 text-white/80" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{label}</p>
            <p className="text-xs text-white/50">{desc}</p>
          </div>
        </div>
        <span className="text-lg font-extrabold text-white">+{pts}</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${barGradients[color]} transition-all duration-[1.5s] ease-out`} style={{ width: w }} />
      </div>
    </div>
  );
}

export default function Scoring() {
  const leads = [
    { name: "Sunrise Dental Clinic", meta: "Baner, Pune · ⭐ 4.8 · 234 reviews",
      checks: [true, true, true, true], score: 100 },
    { name: "Apex Eye Care Centre", meta: "Shivaji Nagar · ⭐ 4.3 · 89 reviews",
      checks: [true, false, false, true], score: 60 },
  ];

  const checkLabels = ["No Website", "Reviews >100", "Stars >4.5", "Phone"];

  return (
    <section id="scoring" className="relative py-24 overflow-hidden">
      {/* Dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900" />
      <div className="noise-overlay absolute inset-0 opacity-50" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

          {/* LEFT: Score bars */}
          <div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} className="mb-10">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-white/10 text-white/70 border border-white/10 mb-4">
                Scoring Algorithm
              </span>
              <h2 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-4">
                AI Lead Score<br />Out of <span className="gradient-text">100 Points</span>
              </h2>
              <p className="text-white/60 text-lg leading-relaxed">
                Every lead is automatically evaluated across four key dimensions. Your team spends time only on the highest-value prospects.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
              viewport={{ once: true }} transition={{ delay: 0.3 }}
              className="space-y-6">
              {scoreCriteria.map(c => <ScoreBar key={c.label} {...c} />)}
            </motion.div>
          </div>

          {/* RIGHT: Score cards */}
          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.2 }}
            className="space-y-5">
            <p className="text-xs font-bold text-white/40 uppercase tracking-widest mb-6">Live Score Breakdown</p>
            {leads.map((l, i) => (
              <div key={i} className={`bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm ${i === 0 ? "ring-1 ring-indigo-400/30" : "opacity-75"}`}>
                <p className="font-bold text-white mb-1">{l.name}</p>
                <p className="text-xs text-white/50 mb-4">{l.meta}</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {checkLabels.map((label, j) => (
                    <span key={label} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
                      l.checks[j]
                        ? "bg-indigo-500/20 border-indigo-400/30 text-indigo-300"
                        : "bg-white/5 border-white/10 text-white/30"
                    }`}>
                      {l.checks[j] ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {label}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-white/10">
                  <span className="text-xs text-white/40 font-medium">Total Lead Score</span>
                  <span className="text-3xl font-extrabold gradient-text">{l.score}<span className="text-base text-white/30">/100</span></span>
                </div>
              </div>
            ))}
          </motion.div>

        </div>
      </div>
    </section>
  );
}
