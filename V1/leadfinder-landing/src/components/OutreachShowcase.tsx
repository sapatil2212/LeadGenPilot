"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Mail, 
  Send, 
  Sparkles, 
  CheckCircle, 
  RefreshCw, 
  Sliders, 
  ArrowRight,
  TrendingUp,
  Inbox,
  Clock,
  Flame,
  Check,
  Zap,
  MessageSquare
} from "lucide-react";

interface LeadOption {
  id: string;
  name: string;
  category: string;
  location: string;
  rating: number;
  reviews: number;
  gap: string;
  emailSubject: string;
  emailBody: string;
  whatsappMessage: string;
}

const leadsData: LeadOption[] = [
  {
    id: "dental",
    name: "Dr. Vikram Patel",
    category: "Sunrise Dental Clinic",
    location: "Baner, Pune",
    rating: 4.8,
    reviews: 234,
    gap: "No online booking portal",
    emailSubject: "Quick question about appointment booking at Sunrise Dental",
    emailBody: "Hi Dr. Patel,\n\nI was researching top healthcare clinics in Baner and noticed Sunrise Dental has a stellar 4.8★ reputation with 234 reviews on Google Maps.\n\nHowever, I noticed patients currently have to call directly because there's no instant mobile booking link on your listing. We recently built a WhatsApp booking integration for a Pune dental clinic that increased new patient appointments by 34% in 30 days.\n\nWould you be open to a 2-minute demo of how this would work for Sunrise Dental?",
    whatsappMessage: "Hi Dr. Patel, noticed Sunrise Dental has over 230 5-star reviews in Baner! Quick question: are you currently accepting new patient appointments online, or just via direct phone calls? We have a quick solution that automated 30+ patient bookings last month for clinics in Pune.",
  },
  {
    id: "yoga",
    name: "Ananya Rao",
    category: "City Yoga & Wellness",
    location: "Viman Nagar, Pune",
    rating: 4.9,
    reviews: 185,
    gap: "No trial class schedule portal",
    emailSubject: "Trial class scheduling for City Yoga & Wellness",
    emailBody: "Hi Ananya,\n\nCame across City Yoga in Viman Nagar — love what you've built, especially the glowing feedback from your 180+ Google reviews.\n\nI noticed new prospects looking for your weekly schedule on Maps don't have a direct schedule or pass booking page. We help boutique Pune fitness studios capture class leads straight into Google Sheets and WhatsApp instantly.\n\nCould I send over a quick 2-page preview of how it looks?",
    whatsappMessage: "Hi Ananya! Loved seeing City Yoga's 4.9★ rating on Google Maps. We designed a 1-click WhatsApp trial class booking flow for fitness studios in Pune. Would you be open to seeing a quick 60-second video of how it works?",
  },
  {
    id: "physio",
    name: "Dr. Rohan Joshi",
    category: "Greenleaf Physiotherapy",
    location: "Kothrud, Pune",
    rating: 4.6,
    reviews: 112,
    gap: "Missing emergency appointment workflow",
    emailSubject: "Patient intake & consultation flow for Greenleaf Physio",
    emailBody: "Hi Dr. Joshi,\n\nI noticed Greenleaf Physiotherapy is one of the highest-rated sports rehab centers in Kothrud.\n\nWhile reviewing your Maps listing, I saw potential patients have no digital intake or after-hours inquiry option. We help specialized clinics automate appointment capture 24/7 directly to their team's inbox and CRM.\n\nWould you be open to seeing how this works?",
    whatsappMessage: "Hi Dr. Joshi, came across Greenleaf Physio in Kothrud. Your patient reviews are fantastic! Quick note: we set up instant consultation inquiry flows for doctors that capture after-hours patient leads. Would you like a quick demo?",
  },
];

export default function OutreachShowcase() {
  const [selectedLeadId, setSelectedLeadId] = useState<string>("dental");
  const [selectedChannel, setSelectedChannel] = useState<"email" | "whatsapp">("email");
  const [tone, setTone] = useState<"direct" | "friendly" | "consultative">("direct");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sentSuccess, setSentSuccess] = useState<boolean>(false);

  const activeLead = leadsData.find((l) => l.id === selectedLeadId) || leadsData[0];

  const handleSimulateSend = () => {
    setIsSending(true);
    setSentSuccess(false);
    setTimeout(() => {
      setIsSending(false);
      setSentSuccess(true);
      setTimeout(() => setSentSuccess(false), 4500);
    }, 1200);
  };

  return (
    <section id="outreach" className="py-24 bg-slate-50 border-b border-slate-200 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100 mb-3">
            <Mail className="w-3.5 h-3.5 text-indigo-600" /> Automated Outreach Engine
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight mb-3">
            AI-Personalized Cold Outreach
          </h2>
          <p className="text-sm sm:text-base text-slate-500 leading-relaxed">
            Every lead gets hyper-personalized copy based on their specific niche, Google rating, and missing website gaps. Dispatched automatically via SMTP or WhatsApp.
          </p>
        </div>

        {/* Interactive Campaign Workspace Container */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden">
          {/* Top Control Bar */}
          <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
            {/* Target selector pills */}
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              <span className="text-xs font-medium text-slate-400 mr-1 hidden sm:inline">Select Lead:</span>
              {leadsData.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => {
                    setSelectedLeadId(lead.id);
                    setSentSuccess(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                    selectedLeadId === lead.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {lead.category.split(" ")[0]} ({lead.location.split(",")[0]})
                </button>
              ))}
            </div>

            {/* Channel Switcher */}
            <div className="flex items-center bg-slate-800 rounded-xl p-1 border border-slate-700">
              <button
                onClick={() => setSelectedChannel("email")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedChannel === "email" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Email (SMTP)
              </button>
              <button
                onClick={() => setSelectedChannel("whatsapp")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedChannel === "whatsapp" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
              </button>
            </div>
          </div>

          {/* Main Display Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left Column: Prospect Intelligence Dossier */}
            <div className="lg:col-span-4 p-6 sm:p-7 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Prospect Profile</span>
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60 flex items-center gap-1">
                    <Flame className="w-3 h-3 fill-emerald-500" /> Hot Lead
                  </span>
                </div>

                <h3 className="text-base font-semibold text-slate-900">{activeLead.category}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeLead.name} · {activeLead.location}</p>

                <div className="mt-5 space-y-3">
                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                    <div className="text-[11px] text-slate-400 font-medium">Rating & Reviews</div>
                    <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                      <span className="text-amber-500">★ {activeLead.rating}</span>
                      <span className="text-slate-400 font-normal">({activeLead.reviews} verified reviews)</span>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                    <div className="text-[11px] text-slate-400 font-medium">Identified Opportunity Gap</div>
                    <div className="text-xs font-medium text-rose-600 mt-0.5">
                      {activeLead.gap}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                    <div className="text-[11px] text-slate-400 font-medium">Gemini AI Hook</div>
                    <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      "Leverage their high rating to propose an automated direct booking pipeline that prevents patient leakage."
                    </div>
                  </div>
                </div>
              </div>

              {/* Tone selection */}
              <div className="mt-6 pt-5 border-t border-slate-200">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Tone of Voice
                </label>
                <div className="grid grid-cols-3 gap-1.5 text-xs font-medium">
                  {(["direct", "consultative", "friendly"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`py-1.5 px-2 rounded-lg text-center capitalize transition-all ${
                        tone === t
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Dynamic Live Message Canvas */}
            <div className="lg:col-span-8 p-6 sm:p-7 flex flex-col justify-between">
              <div>
                {/* Header info */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-semibold text-slate-700">
                      Generated {selectedChannel === "email" ? "Email Message" : "WhatsApp Outreach"}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    Template: AI Custom Angle
                  </span>
                </div>

                {/* Email or WhatsApp preview */}
                <AnimatePresence mode="wait">
                  {selectedChannel === "email" ? (
                    <motion.div
                      key={`email-${selectedLeadId}-${tone}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      {/* Subject */}
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                        <span className="text-[11px] font-medium text-slate-400 block mb-1">Subject Line:</span>
                        <p className="text-sm font-semibold text-slate-800 font-sans">
                          {activeLead.emailSubject}
                        </p>
                      </div>

                      {/* Body */}
                      <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 min-h-[190px]">
                        <span className="text-[11px] font-medium text-slate-400 block mb-2">Message Body:</span>
                        <div className="text-xs text-slate-700 font-sans leading-relaxed whitespace-pre-line">
                          {activeLead.emailBody}
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`wa-${selectedLeadId}-${tone}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      <div className="bg-[#e7f8ef]/50 border border-emerald-200/80 rounded-2xl p-4 min-h-[220px]">
                        <div className="flex items-center justify-between pb-2 border-b border-emerald-100 mb-3">
                          <span className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp Cloud/Web Gateway
                          </span>
                          <span className="text-[10px] text-emerald-700 font-mono">Status: Connected</span>
                        </div>
                        <div className="bg-white rounded-xl p-3.5 shadow-sm border border-emerald-100/80 max-w-lg">
                          <p className="text-xs text-slate-800 leading-relaxed">
                            {activeLead.whatsappMessage}
                          </p>
                          <div className="text-right mt-1.5 text-[10px] text-slate-400 flex items-center justify-end gap-1">
                            <span>10:42 AM</span>
                            <span className="text-sky-500 font-bold">✓✓</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom Execution Bar */}
              <div className="pt-6 border-t border-slate-200 mt-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span>Deduplication & suppression verified</span>
                </div>

                <div className="flex items-center gap-3">
                  {sentSuccess && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Sent & Status Synced!
                    </motion.span>
                  )}

                  <button
                    onClick={handleSimulateSend}
                    disabled={isSending}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isSending ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Dispatching...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" /> Test Dispatch Campaign
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
