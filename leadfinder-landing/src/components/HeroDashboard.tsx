"use client";
import React from "react";
import {
  LayoutDashboard,
  MapPin,
  Database,
  Send,
  Settings,
  Search,
  Star,
  TrendingUp,
  MoreHorizontal,
  ArrowUpRight,
  Bell,
  Compass,
} from "lucide-react";

/**
 * Composed hero visual: two dark, translucent product windows stacked in
 * perspective — a dimmer "navigation" app behind-left and the brighter main
 * dashboard in front-right. Designed to be tilted and edge-faded by the Hero.
 */
export default function HeroDashboard() {
  const watchlist = [
    { sym: "DENT", name: "Sunrise Dental", price: "98", change: "+12.3%", up: true },
    { sym: "YOGA", name: "City Yoga Studio", price: "95", change: "+8.6%", up: true },
    { sym: "PHYS", name: "Greenleaf Physio", price: "90", change: "+6.1%", up: true },
    { sym: "EYES", name: "Apex Eye Care", price: "71", change: "-3.7%", up: false },
  ];

  const markets = [
    { sym: "DENT", name: "Sunrise Dental Clinic", price: "98.0", change: "+2.23", pct: "+4.72%", up: true },
    { sym: "YOGA", name: "City Yoga Studio", price: "95.0", change: "+1.90", pct: "+3.50%", up: true },
    { sym: "PHYS", name: "Greenleaf Physio", price: "90.0", change: "+1.05", pct: "+2.32%", up: true },
    { sym: "EYES", name: "Apex Eye Care Centre", price: "71.0", change: "-1.52", pct: "-3.05%", up: false },
    { sym: "BAKE", name: "Heritage Bakery Cafe", price: "52.0", change: "-1.21", pct: "-4.14%", up: false },
  ];

  return (
    <div className="relative w-full">
      {/* ─────────── Back window: navigation / watchlist (dimmer) ─────────── */}
      <div
        className="absolute left-0 top-6 w-[280px] h-[520px] rounded-2xl border border-white/[0.05] bg-[#0a0b10]/70 backdrop-blur-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] overflow-hidden opacity-80"
        style={{ transform: "translateZ(-50px) translateX(-60px)" }}
      >
        <div className="p-4 flex flex-col h-full">
          {/* logo */}
          <div className="flex items-center mb-5">
            {/* Mock window is bg-[#0a0b10], so the dark-background artwork. */}
            <img src="/logo-dark.png" alt="LeadGenPilot" className="h-5 w-auto object-contain" />
          </div>

          {/* search */}
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.05] px-2.5 py-2 mb-5">
            <Search className="w-3 h-3 text-slate-600" />
            <span className="text-[10px] text-slate-600">Search</span>
            <span className="ml-auto text-[8px] text-slate-700 border border-white/10 rounded px-1 font-mono">⌘K</span>
          </div>

          {/* nav */}
          <div className="space-y-1 mb-6">
            {[
              { icon: LayoutDashboard, label: "Dashboard", active: true },
              { icon: MapPin, label: "Lead Scraper" },
              { icon: Database, label: "Leads Database" },
              { icon: Compass, label: "Market Overview" },
              { icon: Send, label: "Outreach CRM" },
              { icon: Settings, label: "Settings" },
            ].map((n) => (
              <div
                key={n.label}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium ${
                  n.active ? "bg-white/[0.05] text-slate-200" : "text-slate-500"
                }`}
              >
                <n.icon className="w-3 h-3" />
                {n.label}
              </div>
            ))}
          </div>

          {/* watchlist */}
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600 mb-2 px-1">Priority Leads</p>
          <div className="space-y-2">
            {watchlist.map((w) => (
              <div key={w.sym} className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-white/[0.05] flex items-center justify-center text-[7px] font-bold text-slate-400">
                    {w.sym.slice(0, 2)}
                  </div>
                  <span className="text-[10px] text-slate-400">{w.name}</span>
                </div>
                <span className={`text-[9px] font-bold ${w.up ? "text-emerald-400" : "text-rose-400"}`}>
                  {w.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─────────── Front window: main dashboard (brighter) ─────────── */}
      <div className="relative ml-[150px] w-[720px] rounded-2xl border border-white/[0.08] bg-[#0c0d13]/85 backdrop-blur-xl shadow-[0_40px_120px_-20px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05]">
          <div className="flex items-center gap-2 text-slate-300">
            <LayoutDashboard className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px] font-semibold">Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <Bell className="w-3.5 h-3.5 text-slate-500" />
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
          </div>
        </div>

        <div className="p-5">
          {/* welcome */}
          <h3 className="text-lg font-bold text-white">Welcome back, User!</h3>
          <p className="text-[10px] text-slate-500 mb-4">Monday, 14 July 2026</p>

          {/* top row: risk indicator + balance */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* Lead quality indicator (spans 2) */}
            <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-slate-300">Lead Quality Indicator</span>
                <MoreHorizontal className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 border border-emerald-400/25 px-2 py-1 text-[9px] font-bold text-emerald-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                  High Intent
                </span>
                {/* mini line chart */}
                <svg viewBox="0 0 160 40" preserveAspectRatio="none" className="flex-1 h-9">
                  <path d="M0,32 C20,28 30,20 45,24 C60,28 70,10 90,14 C110,18 120,6 140,10 C150,12 156,8 160,6"
                    fill="none" stroke="#34d399" strokeWidth="2" />
                </svg>
                <div className="text-right">
                  <p className="text-sm font-bold text-white">12.4%</p>
                  <p className="text-[8px] text-emerald-400">+$8.5k</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3">
                {[
                  { v: "$22.5k", l: "Dental" },
                  { v: "$18.8k", l: "Wellness" },
                  { v: "$15.1k", l: "Clinics" },
                  { v: "$11.2k", l: "Cafes" },
                ].map((s) => (
                  <div key={s.l}>
                    <p className="text-[11px] font-bold text-white">{s.v}</p>
                    <p className="text-[8px] text-slate-500">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Balance overview */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3 h-3 text-sky-400" />
                <span className="text-[10px] font-semibold text-slate-300">Pipeline Value</span>
              </div>
              <p className="text-lg font-bold text-white">$75,230</p>
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-400">
                <ArrowUpRight className="w-2.5 h-2.5" /> +5.3%
              </span>
              <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" />
              </div>
              <p className="text-[8px] text-slate-500 mt-1.5">Estimated deal value</p>
            </div>
          </div>

          {/* markets / best leads table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-slate-300">Today&apos;s Best Leads</span>
              <span className="text-[8px] text-sky-400 font-bold">View all</span>
            </div>
            {/* header */}
            <div className="grid grid-cols-12 text-[8px] font-bold uppercase tracking-wider text-slate-600 px-2 pb-1.5 border-b border-white/[0.05]">
              <span className="col-span-2">Code</span>
              <span className="col-span-5">Business</span>
              <span className="col-span-2 text-right">Score</span>
              <span className="col-span-3 text-right">Change</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {markets.map((m) => (
                <div key={m.sym} className="grid grid-cols-12 items-center px-2 py-1.5 text-[10px]">
                  <span className="col-span-2 font-mono font-bold text-slate-400">{m.sym}</span>
                  <span className="col-span-5 text-slate-300 truncate">{m.name}</span>
                  <span className="col-span-2 text-right font-semibold text-white">{m.price}</span>
                  <span className={`col-span-3 text-right font-bold ${m.up ? "text-emerald-400" : "text-rose-400"}`}>
                    {m.pct}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
