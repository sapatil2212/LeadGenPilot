"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageSquare, 
  Check, 
  CheckCheck, 
  Phone, 
  Video, 
  MoreVertical, 
  ShieldCheck, 
  RotateCcw,
  Zap,
  Clock,
  ArrowRight,
  Wifi,
  Battery,
  ChevronLeft,
  Plus,
  Camera,
  Mic,
  Lock
} from "lucide-react";

interface WhatsAppScenario {
  id: string;
  niche: string;
  leadName: string;
  avatar: string;
  businessName: string;
  location: string;
  rating: string;
  outboundMsg: string;
  inboundReply: string;
  dealOutcome: string;
}

const scenarios: WhatsAppScenario[] = [
  {
    id: "dental",
    niche: "Dental",
    leadName: "Dr. Vikram Patel",
    avatar: "VP",
    businessName: "Sunrise Dental Clinic",
    location: "Baner, Pune",
    rating: "4.8★ (234 reviews)",
    outboundMsg: "Hi Dr. Patel! Noticed Sunrise Dental has 230+ 5-star reviews on Maps in Baner, but no direct booking link. Are you taking on new patients this month?",
    inboundReply: "Hi! Yes, we are. Right now patients call the front desk which gets swamped. How does your booking link work?",
    dealOutcome: "Demo Booked • Status: HOT LEAD 🔥",
  },
  {
    id: "salon",
    niche: "Salon",
    leadName: "Meera Sen",
    avatar: "MS",
    businessName: "Luxe Glow Salon",
    location: "Koregaon Park, Pune",
    rating: "4.9★ (310 reviews)",
    outboundMsg: "Hello Meera! Loved Luxe Glow's 4.9★ rating on Maps. We made a 1-click WhatsApp booking menu that captures weekend bookings automatically. Open to a 30s preview?",
    inboundReply: "Hey! That would be super helpful for our weekend rush. Can you send over the preview link and pricing?",
    dealOutcome: "Demo Sent • Converted to Retainer 🚀",
  },
  {
    id: "gym",
    niche: "Fitness",
    leadName: "Coach Kabir",
    avatar: "CK",
    businessName: "IronCore Crossfit",
    location: "Wakad, Pune",
    rating: "4.7★ (180 reviews)",
    outboundMsg: "Hey Kabir! Came across IronCore Crossfit on Maps — awesome reviews! We built an automated trial pass generator that syncs leads directly to Sheets. Want to see it?",
    inboundReply: "Yes absolutely! We want to run a monsoon promotion. Does it sync with Google Sheets in real time?",
    dealOutcome: "Campaign Live • 48 Members Signed Up 💪",
  },
];

export default function WhatsAppShowcase() {
  const [activeScenarioId, setActiveScenarioId] = useState<string>("dental");
  const [phoneStyle, setPhoneStyle] = useState<"iphone" | "android">("iphone");
  const [chatStep, setChatStep] = useState<number>(0);

  const scenario = scenarios.find((s) => s.id === activeScenarioId) || scenarios[0];

  useEffect(() => {
    setChatStep(0);
    const t1 = setTimeout(() => setChatStep(1), 500);
    const t2 = setTimeout(() => setChatStep(2), 1200);
    const t3 = setTimeout(() => setChatStep(3), 1900);
    const t4 = setTimeout(() => setChatStep(4), 2600);
    const t5 = setTimeout(() => setChatStep(5), 3800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [activeScenarioId]);

  return (
    <section id="whatsapp-automation" className="py-16 sm:py-20 bg-white border-b border-slate-100 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* ──────────── LEFT PART: Reduced & Streamlined Content ──────────── */}
          <div className="lg:col-span-7 space-y-5">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200/80 mb-3">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> WhatsApp Automation
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-slate-900 tracking-tight mb-2.5 leading-tight">
                Connect via the Channel Prospects Actually Answer
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed font-normal">
                Skip crowded inboxes. Automated WhatsApp messages achieve 90%+ open rates with human-paced delivery and instant two-way CRM sync.
              </p>
            </div>

            {/* Compact Controls: Scenario Chips & Phone Switch */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">
                  Niche:
                </span>
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveScenarioId(s.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      activeScenarioId === s.id
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {s.niche}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  onClick={() => {
                    const curr = activeScenarioId;
                    setActiveScenarioId("");
                    setTimeout(() => setActiveScenarioId(curr), 30);
                  }}
                  title="Replay animation"
                  className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center bg-slate-200/80 rounded-lg p-0.5 border border-slate-200">
                  <button
                    onClick={() => setPhoneStyle("iphone")}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${
                      phoneStyle === "iphone" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    iOS
                  </button>
                  <button
                    onClick={() => setPhoneStyle("android")}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${
                      phoneStyle === "android" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Pixel
                  </button>
                </div>
              </div>
            </div>

            {/* 3 Compact Feature Pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-0.5">
              <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70">
                <div className="flex items-center gap-1.5 text-slate-900 font-semibold text-xs mb-1">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>90%+ Open Rate</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">Seen within 3 minutes on average</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70">
                <div className="flex items-center gap-1.5 text-slate-900 font-semibold text-xs mb-1">
                  <Clock className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                  <span>Human-Paced</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">30–60s safety pauses between sends</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70">
                <div className="flex items-center gap-1.5 text-slate-900 font-semibold text-xs mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-violet-600 flex-shrink-0" />
                  <span>2-Way CRM Sync</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">Replies auto-sync to Google Sheets</p>
              </div>
            </div>

            <div className="pt-1">
              <a
                href="/app"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-xs"
              >
                Launch WhatsApp Campaigns
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* ──────────── RIGHT PART: COMPACT SLENDER SMARTPHONE MOCKUP ──────────── */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-full max-w-[250px] sm:max-w-[265px]">
              
              {phoneStyle === "iphone" ? (
                /* ═══════════ COMPACT IPHONE 16 PRO MOCKUP ═══════════ */
                <div className="relative bg-[#2d3139] p-[7px] rounded-[42px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.12)] border border-slate-700/60">
                  {/* Left Side Buttons */}
                  <div className="absolute -left-[10px] top-20 w-[3px] h-6 bg-slate-600 rounded-l-xs" />
                  <div className="absolute -left-[10px] top-30 w-[3px] h-10 bg-slate-600 rounded-l-xs" />
                  <div className="absolute -left-[10px] top-43 w-[3px] h-10 bg-slate-600 rounded-l-xs" />
                  
                  {/* Right Side Button */}
                  <div className="absolute -right-[10px] top-30 w-[3px] h-12 bg-slate-600 rounded-r-xs" />

                  {/* Inner Screen Bezel with Compact Height */}
                  <div className="relative bg-[#efeae2] rounded-[35px] overflow-hidden flex flex-col justify-between shadow-inner select-none h-[435px]">
                    
                    {/* Top Status Bar with Dynamic Island */}
                    <div className="bg-white/90 backdrop-blur-md pt-2 pb-1.5 px-4 flex items-center justify-between z-20 border-b border-black/[0.04]">
                      <span className="text-[10px] font-semibold text-black tracking-tight">12:25</span>
                      
                      {/* Dynamic Island Capsule */}
                      <div className="w-[68px] h-[17px] bg-black rounded-full flex items-center justify-between px-1.5 shadow-2xs">
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-900 border border-slate-800" />
                      </div>

                      <div className="flex items-center gap-1 text-black">
                        <Wifi className="w-2.5 h-2.5 text-black stroke-[2.2]" />
                        <div className="w-3.5 h-1.5 border border-black rounded-xs p-0.5 flex items-center">
                          <div className="w-2 h-full bg-black rounded-2xs" />
                        </div>
                      </div>
                    </div>

                    {/* WhatsApp Top Navigation Bar */}
                    <div className="bg-white/95 backdrop-blur-md px-2.5 py-1.5 flex items-center justify-between border-b border-slate-200/80 z-20 shadow-2xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronLeft className="w-3.5 h-3.5 text-[#007aff] -ml-1 cursor-pointer flex-shrink-0" />
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-[9px] text-white shadow-2xs flex-shrink-0">
                          {scenario.avatar}
                        </div>
                        <div className="min-w-0 truncate">
                          <h4 className="text-[10.5px] font-semibold text-slate-900 truncate max-w-[95px] leading-tight">
                            {scenario.businessName}
                          </h4>
                          <p className="text-[8.5px] text-emerald-600 font-medium">online</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[#007aff] flex-shrink-0">
                        <Video className="w-3.5 h-3.5 stroke-[2]" />
                        <Phone className="w-3 h-3 stroke-[2]" />
                      </div>
                    </div>

                    {/* WhatsApp Chat Area */}
                    <div 
                      className="p-3 flex-1 flex flex-col justify-end space-y-2 relative bg-[#efeae2] overflow-hidden"
                      style={{
                        backgroundImage: `radial-gradient(#d5cdc4 1px, transparent 1px), radial-gradient(#d5cdc4 1px, #efeae2 1px)`,
                        backgroundSize: "24px 24px",
                        backgroundPosition: "0 0, 12px 12px"
                      }}
                    >
                      {/* Compact Encryption Badge */}
                      <div className="flex items-center justify-center gap-1 text-[9px] text-slate-500 bg-white/80 py-0.5 px-2.5 rounded-full mx-auto shadow-2xs border border-slate-200/60">
                        <Lock className="w-2.5 h-2.5 text-slate-400" />
                        <span>End-to-end encrypted</span>
                      </div>

                      {/* Automated Outbound Bubble */}
                      <AnimatePresence>
                        {chatStep >= 1 && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex justify-end"
                          >
                            <div className="bg-[#d9fdd3] text-[#111b21] rounded-2xl rounded-tr-xs p-2 max-w-[88%] shadow-2xs text-[10.5px] leading-snug border border-[#c1ebb8]/60">
                              <p>{scenario.outboundMsg}</p>
                              <div className="flex items-center justify-end gap-1 text-[8.5px] text-[#667781] mt-0.5">
                                <span>12:25 PM</span>
                                {chatStep === 1 && <Check className="w-2.5 h-2.5 text-[#8696a0]" />}
                                {chatStep === 2 && <CheckCheck className="w-2.5 h-2.5 text-[#8696a0]" />}
                                {chatStep >= 3 && <CheckCheck className="w-2.5 h-2.5 text-[#53bdeb]" />}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Typing indicator */}
                      {chatStep === 4 && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-1.5"
                        >
                          <div className="bg-white rounded-xl rounded-tl-xs px-2.5 py-1.5 flex items-center gap-1 shadow-2xs border border-slate-200/60">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
                          </div>
                          <span className="text-[9px] text-slate-500 font-medium">{scenario.leadName} is typing...</span>
                        </motion.div>
                      )}

                      {/* Inbound Prospect Reply Bubble */}
                      <AnimatePresence>
                        {chatStep >= 5 && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="flex justify-start"
                          >
                            <div className="bg-white text-[#111b21] rounded-2xl rounded-tl-xs p-2 max-w-[88%] shadow-2xs text-[10.5px] leading-snug border border-slate-200/80">
                              <p className="font-semibold text-emerald-700 text-[9.5px] mb-0.5">{scenario.leadName}</p>
                              <p>{scenario.inboundReply}</p>
                              <div className="text-right text-[8.5px] text-[#667781] mt-0.5">
                                12:26 PM
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Real-time CRM alert toast */}
                      <AnimatePresence>
                        {chatStep >= 5 && (
                          <motion.div
                            initial={{ opacity: 0, y: 4, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="bg-emerald-600 text-white rounded-lg p-1.5 px-2 flex items-center justify-between text-[10px] shadow-2xs"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                              <span className="text-[9.5px] font-medium truncate">
                                {scenario.dealOutcome}
                              </span>
                            </div>
                            <span className="text-[8.5px] font-bold bg-white/20 px-1 py-0.2 rounded">
                              CRM
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* WhatsApp iOS Bottom Input Bar & Home Indicator */}
                    <div className="bg-[#f6f6f6] px-2.5 pt-1.5 pb-2 border-t border-slate-200/80 z-20">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer flex-shrink-0">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                        
                        <div className="flex-1 bg-white border border-slate-300/80 rounded-full px-2.5 py-1 flex items-center justify-between text-slate-400 text-[10px]">
                          <span>Message</span>
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Camera className="w-3 h-3" />
                            <Mic className="w-3 h-3" />
                          </div>
                        </div>
                      </div>

                      {/* Subtle iOS Home Indicator */}
                      <div className="w-24 h-1 bg-slate-900/80 rounded-full mx-auto" />
                    </div>

                  </div>
                </div>
              ) : (
                /* ═══════════ COMPACT ANDROID / PIXEL MOCKUP ═══════════ */
                <div className="relative bg-[#1a1c1e] p-[6px] rounded-[38px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] border border-slate-700">
                  {/* Right Side Buttons */}
                  <div className="absolute -right-[9px] top-24 w-[3px] h-8 bg-slate-600 rounded-r-xs" />
                  <div className="absolute -right-[9px] top-36 w-[3px] h-12 bg-slate-600 rounded-r-xs" />

                  <div className="relative bg-[#efeae2] rounded-[32px] overflow-hidden flex flex-col justify-between shadow-inner select-none h-[435px]">
                    {/* Android Status bar */}
                    <div className="bg-white/90 pt-1.5 pb-1 px-3.5 flex items-center justify-between text-[9.5px] text-slate-800 font-mono z-20">
                      <span>2:50</span>
                      <div className="w-2.5 h-2.5 rounded-full bg-black border border-slate-800" />
                      <div className="flex items-center gap-1 text-[8.5px]">
                        <Wifi className="w-2.5 h-2.5 text-slate-800" />
                        <Battery className="w-3 h-3 text-slate-800" />
                      </div>
                    </div>

                    {/* Android WhatsApp Header */}
                    <div className="bg-white px-2.5 py-1.5 flex items-center justify-between border-b border-slate-200 z-20">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronLeft className="w-3.5 h-3.5 text-slate-700 cursor-pointer flex-shrink-0" />
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-[9px] text-white flex-shrink-0">
                          {scenario.avatar}
                        </div>
                        <div className="min-w-0 truncate">
                          <h4 className="text-[10.5px] font-semibold text-slate-900 truncate max-w-[95px] leading-tight">
                            {scenario.businessName}
                          </h4>
                          <p className="text-[8.5px] text-emerald-600 font-medium">online</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-slate-600 flex-shrink-0">
                        <Video className="w-3.5 h-3.5" />
                        <Phone className="w-3 h-3" />
                        <MoreVertical className="w-3 h-3" />
                      </div>
                    </div>

                    {/* Android Chat Area */}
                    <div 
                      className="p-3 flex-1 flex flex-col justify-end space-y-2 bg-[#efeae2] overflow-hidden"
                      style={{
                        backgroundImage: `radial-gradient(#d5cdc4 1px, transparent 1px), radial-gradient(#d5cdc4 1px, #efeae2 1px)`,
                        backgroundSize: "24px 24px",
                        backgroundPosition: "0 0, 12px 12px"
                      }}
                    >
                      {/* Compact Lock Badge */}
                      <div className="flex items-center justify-center gap-1 text-[9px] text-slate-500 bg-white/80 py-0.5 px-2.5 rounded-full mx-auto shadow-2xs border border-slate-200/60">
                        <Lock className="w-2.5 h-2.5 text-slate-400" />
                        <span>End-to-end encrypted</span>
                      </div>

                      {/* Outbound message */}
                      <AnimatePresence>
                        {chatStep >= 1 && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex justify-end"
                          >
                            <div className="bg-[#d9fdd3] text-[#111b21] rounded-2xl rounded-tr-xs p-2 max-w-[88%] shadow-2xs text-[10.5px] leading-snug">
                              <p>{scenario.outboundMsg}</p>
                              <div className="flex items-center justify-end gap-1 text-[8.5px] text-[#667781] mt-0.5">
                                <span>2:50 PM</span>
                                {chatStep >= 3 ? <CheckCheck className="w-2.5 h-2.5 text-[#53bdeb]" /> : <Check className="w-2.5 h-2.5 text-[#8696a0]" />}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Inbound reply */}
                      <AnimatePresence>
                        {chatStep >= 5 && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex justify-start"
                          >
                            <div className="bg-white text-[#111b21] rounded-2xl rounded-tl-xs p-2 max-w-[88%] shadow-2xs text-[10.5px] leading-snug">
                              <p className="font-semibold text-emerald-700 text-[9.5px] mb-0.5">{scenario.leadName}</p>
                              <p>{scenario.inboundReply}</p>
                              <div className="text-right text-[8.5px] text-[#667781] mt-0.5">
                                2:51 PM
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* CRM toast */}
                      <AnimatePresence>
                        {chatStep >= 5 && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-emerald-600 text-white rounded-lg p-1.5 px-2 flex items-center justify-between text-[10px] shadow-2xs"
                          >
                            <span className="text-[9.5px] font-medium truncate">{scenario.dealOutcome}</span>
                            <span className="text-[8.5px] font-bold bg-white/20 px-1 py-0.2 rounded">CRM</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Android input bar */}
                    <div className="bg-white px-2 py-1.5 flex items-center gap-1.5 border-t border-slate-200 z-20">
                      <div className="flex-1 bg-slate-100 rounded-full px-2.5 py-1 flex items-center justify-between text-slate-400 text-[10px]">
                        <span>Message</span>
                        <Camera className="w-3 h-3 text-slate-500" />
                      </div>
                      <div className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center text-white shadow-2xs flex-shrink-0">
                        <Mic className="w-3 h-3" />
                      </div>
                    </div>

                    {/* Android Gesture Bar */}
                    <div className="bg-white pb-1.5 flex justify-center">
                      <div className="w-20 h-1 bg-slate-800 rounded-full" />
                    </div>

                  </div>
                </div>
              )}

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
