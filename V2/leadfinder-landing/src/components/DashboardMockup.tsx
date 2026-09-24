"use client";
import React from "react";
import { 
  LayoutDashboard, 
  MapPin, 
  Database, 
  Send, 
  Settings, 
  Search, 
  CheckCircle2, 
  Star, 
  Phone, 
  Globe, 
  ArrowRight,
  TrendingUp
} from "lucide-react";

export default function DashboardMockup() {
  const leads = [
    { name: "Sunrise Dental Clinic", loc: "Baner, Pune", rating: 4.8, reviews: 234, score: 98, type: "HOT", hasPhone: true, hasWebsite: false },
    { name: "Greenleaf Physiotherapy", loc: "Kothrud, Pune", rating: 4.6, reviews: 128, score: 90, type: "HOT", hasPhone: true, hasWebsite: false },
    { name: "Apex Eye Care Centre", loc: "Shivaji Nagar", rating: 4.3, reviews: 89, score: 70, type: "WARM", hasPhone: true, hasWebsite: true },
    { name: "City Yoga Studio", loc: "Viman Nagar", rating: 4.9, reviews: 312, score: 95, type: "HOT", hasPhone: true, hasWebsite: false },
    { name: "Heritage Bakery & Cafe", loc: "Kalyani Nagar", rating: 4.1, reviews: 56, score: 50, type: "COLD", hasPhone: false, hasWebsite: true },
  ];

  return (
    <div className="w-full bg-[#fafbfc] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden font-sans flex flex-col h-[520px]">
      {/* Browser Bar */}
      <div className="bg-slate-100 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex gap-1.5 items-center">
          {["#ff5f57", "#ffbd2e", "#28ca41"].map((c, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex-1 max-w-md bg-white border border-slate-200 rounded-lg h-6 mx-4 flex items-center px-3 justify-between">
          <span className="text-[10px] text-slate-400 font-mono tracking-tight truncate">https://app.leadgenpilot.com/dashboard</span>
          <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1 font-mono">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-ping" />
            Connected
          </span>
        </div>
        <div className="w-10" />
      </div>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-48 bg-white border-r border-slate-200 flex flex-col justify-between p-3.5">
          <div className="space-y-6">
            {/* Logo */}
            <div className="flex items-center px-2">
              <img src="/logo.png" alt="LeadGenPilot" className="h-5 w-auto object-contain" />
            </div>

            {/* Navigation links */}
            <div className="space-y-1">
              {[
                { icon: LayoutDashboard, label: "Dashboard", active: true },
                { icon: MapPin, label: "Lead Scraper", active: false },
                { icon: Database, label: "Leads database", active: false },
                { icon: Send, label: "Outreach CRM", active: false },
                { icon: Settings, label: "Integrations", active: false },
              ].map(item => (
                <div key={item.label} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all ${
                  item.active 
                    ? "bg-indigo-50 text-indigo-600" 
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}>
                  <item.icon className={`w-3.5 h-3.5 ${item.active ? "text-indigo-600" : "text-slate-400"}`} />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* System status */}
          <div className="px-2 space-y-1.5 border-t border-slate-100 pt-3">
            <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
              <span>Webhook Sync</span>
              <span className="text-emerald-500 font-bold">Active</span>
            </div>
            <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
              <span>WhatsApp API</span>
              <span className="text-emerald-500 font-bold">Connected</span>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-50 p-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
            <div>
              <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest font-mono">Geo Scraper Mode</p>
              <h2 className="text-sm font-bold text-slate-800 tracking-tight">Baner, Pune · Dental Clinics</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Live Scrape Active
              </span>
            </div>
          </div>

          {/* Grid Layout inside Main Content */}
          <div className="flex-grow grid grid-cols-12 gap-4 min-h-0 overflow-hidden">
            {/* Left table of leads */}
            <div className="col-span-8 bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Verified Lead List</span>
                <span className="text-[9px] text-slate-400 font-mono">5 items loaded</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {leads.map((l, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border border-slate-100 transition-all ${
                    l.type === "HOT" && i === 0 ? "bg-indigo-50/40 border-indigo-100" :
                    l.type === "HOT" && i === 3 ? "bg-green-50/30 border-green-100" :
                    "bg-white"
                  }`}>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-800 truncate">{l.name}</p>
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mt-0.5">
                        <MapPin className="w-2.5 h-2.5 text-slate-300" />
                        <span>{l.loc}</span>
                        <span>·</span>
                        <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                        <span>{l.rating} ({l.reviews} reviews)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-[8px] font-extrabold px-2 py-0.5 rounded-full border ${
                        l.type === "HOT" 
                          ? "bg-indigo-50 border-indigo-200 text-indigo-600" 
                          : l.type === "WARM"
                            ? "bg-amber-50 border-amber-200 text-amber-600"
                            : "bg-slate-50 border-slate-200 text-slate-500"
                      }`}>
                        {l.type} {l.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right sidebar maps/analytics */}
            <div className="col-span-4 flex flex-col gap-4">
              {/* Map Preview widget */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col flex-1 overflow-hidden relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Map View</span>
                  <span className="text-[8px] text-indigo-600 font-bold font-mono">BANER RAD: 2.5KM</span>
                </div>
                {/* Visual grid representing map grid */}
                <div className="flex-grow bg-slate-50 rounded-lg border border-slate-200 overflow-hidden relative flex items-center justify-center">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(#4f46e5 1px, transparent 1px)", backgroundSize: "12px 12px" }} />
                  {/* Decorative map graphics */}
                  <div className="absolute w-24 h-24 rounded-full border border-indigo-500/20 bg-indigo-500/5 animate-pulse" />
                  <div className="absolute w-12 h-12 rounded-full border border-indigo-500/35 bg-indigo-500/10" />
                  <div className="absolute w-2.5 h-2.5 rounded-full bg-indigo-600 border-2 border-white shadow-md shadow-indigo-600/50" />
                  
                  {/* Floating map pins */}
                  <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-indigo-500 border border-white" />
                  <div className="absolute bottom-1/3 left-1/2 w-2 h-2 rounded-full bg-indigo-500 border border-white" />
                  <div className="absolute top-1/3 right-1/4 w-2 h-2 rounded-full bg-emerald-500 border border-white animate-bounce" />
                  <div className="absolute bottom-1/4 right-1/3 w-2 h-2 rounded-full bg-indigo-500 border border-white" />
                </div>
              </div>

              {/* Sync bar */}
              <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 rounded-xl p-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-[10px] font-bold text-indigo-700">Google Sheets Connected</span>
                </div>
                <div className="flex justify-between items-center text-[8px] text-slate-400 font-mono">
                  <span>Sync status:</span>
                  <span>5 leads synced just now</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
