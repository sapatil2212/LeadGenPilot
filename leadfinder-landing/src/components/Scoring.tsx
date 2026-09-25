"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Globe, Star, Phone, BarChart3, CheckCircle2, XCircle, Sliders } from "lucide-react";

const scoreCriteria = [
  { label: "No Website Detected", pts: 50, icon: Globe, color: "indigo", barWidth: "50%", desc: "Primary qualification filter for web design / software outreach" },
  { label: "Reviews > 100",       pts: 20, icon: Star,  color: "blue",   barWidth: "20%", desc: "High-intent customer footfall and proven business volume" },
  { label: "Rating > 4.5 Stars",  pts: 20, icon: BarChart3, color: "violet", barWidth: "20%", desc: "Strong reputation signal with verified local trustworthiness" },
  { label: "Working Direct Phone",pts: 10, icon: Phone, color: "emerald", barWidth: "10%", desc: "Instantly reachable for cold calls and WhatsApp outreach" },
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
    <div ref={ref} className="space-y-2 bg-white/[0.03] border border-white/5 rounded-xl p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-white/80" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-semibold text-white">{label}</p>
            <p className="text-[11px] text-white/50">{desc}</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-sky-400 font-mono">+{pts} pts</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-1">
        <div className={`h-full rounded-full bg-gradient-to-r ${barGradients[color]} transition-all duration-[1.5s] ease-out`} style={{ width: w }} />
      </div>
    </div>
  );
}

export default function Scoring() {
  const leads = [
    { name: "Sunrise Dental Clinic", meta: "Baner, Pune · ⭐ 4.8 · 234 reviews",
      checks: [true, true, true, true], score: 98, priority: "HOT LEAD" },
    { name: "Apex Eye Care Centre", meta: "Shivaji Nagar · ⭐ 4.3 · 89 reviews",
      checks: [true, false, false, true], score: 60, priority: "WARM LEAD" },
  ];

  const checkLabels = ["No Website", "Reviews >100", "Stars >4.5", "Phone Line"];

  return (
    <section id="scoring" className="relative py-24 overflow-hidden bg-slate-950 text-white">
      {/* Dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/60 pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* LEFT: Score criteria */}
          <div>
            <motion.div 
              initial={{ opacity: 0, y: 16 }} 
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} 
              className="mb-8"
            >
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-white/10 text-white/80 border border-white/10 mb-3">
                <Sliders className="w-3.5 h-3.5" /> Qualification Engine
              </span>
              <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-3">
                Scientific <span className="gradient-text">0–100 Point</span> Scoring
              </h2>
              <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                Stop wasting hours sorting unverified spreadsheets. Our scoring system immediately surfaces the highest-converting opportunities based on quantifiable digital weakness signals.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }} 
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }} 
              transition={{ delay: 0.2 }}
              className="space-y-3"
            >
              {scoreCriteria.map(c => <ScoreBar key={c.label} {...c} />)}
            </motion.div>
          </div>

          {/* RIGHT: Live score breakdown cards */}
          <motion.div 
            initial={{ opacity: 0, y: 16 }} 
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} 
            transition={{ duration: 0.5, delay: 0.2 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Scored Comparison</span>
              <span className="text-xs text-sky-400 font-mono">Real-time Evaluation</span>
            </div>

            {leads.map((l, i) => (
              <div 
                key={i} 
                className={`bg-slate-900/80 border rounded-2xl p-6 backdrop-blur-sm transition-all ${
                  i === 0 
                    ? "border-indigo-400/40 shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-400/20" 
                    : "border-white/10 opacity-80"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-base font-semibold text-white">{l.name}</h4>
                  <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${
                    i === 0 
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" 
                      : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                  }`}>
                    {l.priority}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-4">{l.meta}</p>

                <div className="flex flex-wrap gap-2 mb-5">
                  {checkLabels.map((label, j) => (
                    <span 
                      key={label} 
                      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border ${
                        l.checks[j]
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                          : "bg-white/5 border-white/10 text-slate-500"
                      }`}
                    >
                      {l.checks[j] ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-slate-500" />}
                      {label}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/10">
                  <span className="text-xs text-slate-400 font-medium">Computed Opportunity Score</span>
                  <span className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">
                    {l.score}<span className="text-xs text-slate-400 font-normal">/100</span>
                  </span>
                </div>
              </div>
            ))}
          </motion.div>

        </div>
      </div>
    </section>
  );
}
