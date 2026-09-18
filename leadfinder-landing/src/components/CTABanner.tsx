"use client";
import { motion } from "framer-motion";

export default function CTABanner() {
  return (
    <section id="cta" className="relative py-24 md:py-28 overflow-hidden bg-[#060a14]">
      {/* Base dark background */}
      <div className="absolute inset-0 bg-[#060a14]" />

      {/* Soft grid lines */}
      <div className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }} />

      {/* Centered blue radial glow behind the headline */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[420px] rounded-full bg-blue-600/30 blur-[100px]" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[260px] rounded-full bg-blue-400/25 blur-[80px]" />

      {/* Vignette to fade edges to black */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#060a14_85%)]" />

      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.7 }}>

          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-5 leading-tight">
            Ready to Simplify Your<br />
            <span className="text-blue-500">Lead Generation Process?</span>
          </h2>

          <p className="text-slate-400 text-base md:text-lg mb-8 max-w-xl mx-auto leading-relaxed">
            Automate prospecting, cut out manual research, and deliver a seamless outreach
            experience with NexaLeadAi. Let AI handle the leads while you focus on closing deals.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="/app"
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-colors duration-200">
              Start your 7-day free trial
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
