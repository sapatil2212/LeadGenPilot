"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus } from "lucide-react";

const faqs = [
  { q: "Does NexaLeadAi work for any business type or location?",
    a: "Yes! It works with any business type that appears on Google Maps — dental clinics, gyms, restaurants, salons, law firms, and more. You can target any city or region worldwide." },
  { q: "Do I need coding experience to use it?",
    a: "Not at all. The web dashboard lets you configure everything visually. The one-time Google Sheets setup takes under 3 minutes using our copy-paste Apps Script. No coding needed." },
  { q: "How does deduplication work?",
    a: "Every lead gets a unique hash based on business name + address, stored in a local JSON cache. Before submitting any lead, the system checks for duplicates — so you'll never get the same business twice, even across multiple runs." },
  { q: "What happens if webhook delivery fails?",
    a: "The system automatically retries delivery 3 times with backoff delays. If all retries fail, the lead is archived in failed-leads.json and you can trigger a bulk retry from the dashboard at any time." },
  { q: "Is WhatsApp outreach automated and compliant?",
    a: "WhatsApp messaging uses whatsapp-web.js, connecting through your personal WhatsApp via QR code. You're in full control of content and volume. Gemini AI generates thoughtful, personalized messages." },
  { q: "Can I run NexaLeadAi on a server or cloud?",
    a: "Absolutely. NexaLeadAi ships with a Dockerfile and Render deployment config. It automatically falls back to High-Fidelity Simulation Mode in sandboxed environments." },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-slate-50">
      <div className="max-w-3xl mx-auto px-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} className="text-center mb-14">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-slate-200 text-slate-600 border border-slate-200 mb-4">
            FAQ
          </span>
          <h2 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            Got <span className="gradient-text">Questions?</span>
          </h2>
          <p className="text-slate-500 text-lg">Everything you need to know before getting started.</p>
        </motion.div>

        {/* Accordion */}
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.07 }}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                open === i ? "border-indigo-200 bg-white shadow-md shadow-indigo-500/10" : "border-slate-200 bg-white hover:border-slate-300"
              }`}>
              <button onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
                aria-expanded={open === i}>
                <span className="text-sm font-semibold text-slate-800">{f.q}</span>
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                  open === i ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"
                }`}>
                  {open === i ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                </div>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div key="answer"
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
                    <p className="px-6 pb-5 text-sm text-slate-500 leading-relaxed">{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
