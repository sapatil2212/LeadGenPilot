"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const stats = [
  { value: 50, suffix: "K+", label: "Leads Delivered", desc: "Across all users" },
  { value: 98, suffix: "%", label: "Dedup Accuracy", desc: "Zero duplicates" },
  { value: 2,  prefix: "<", suffix: "s", label: "Sheet Sync Time", desc: "Real-time delivery" },
  { value: 500, suffix: "+", label: "Active Teams", desc: "And growing daily" },
];

function Counter({ value, suffix, prefix = "" }: { value: number; suffix: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const animated = useRef(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !animated.current) {
        animated.current = true;
        const duration = 1800;
        const start = performance.now();
        const step = (ts: number) => {
          const p = Math.min((ts - start) / duration, 1);
          setCount(Math.floor((1 - Math.pow(1 - p, 3)) * value));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value]);
  return <div ref={ref} className="text-4xl lg:text-5xl font-extrabold tracking-tight text-white">{prefix}{count}{suffix}</div>;
}

export default function Stats() {
  return (
    <section className="relative py-20 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700" />
      <div className="noise-overlay absolute inset-0" />
      {/* Decorative orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-violet-400/10 rounded-full blur-3xl" />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((s, i) => (
            <motion.div key={s.label}
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.1, duration: 0.6 }}
              className="text-center">
              <Counter value={s.value} suffix={s.suffix} prefix={s.prefix} />
              <p className="text-white font-semibold mt-2 text-sm lg:text-base">{s.label}</p>
              <p className="text-white/50 text-xs mt-1">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
