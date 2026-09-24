import React from "react";
import { Mail, Phone, MapPin, Building, ShieldCheck } from "lucide-react";

export default function CompanyContactSection() {
  return (
    <section className="bg-slate-900 text-white rounded-3xl p-8 sm:p-10 border border-slate-800 shadow-xl my-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-800">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-3">
              <Building className="w-3.5 h-3.5" /> Official Business Entity
            </span>
            <h3 className="text-2xl font-bold tracking-tight text-white">
              Brightwave Digital Products LLP
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Operating brand: <strong className="text-slate-200">BookMyTime</strong> • Platform: <strong className="text-slate-200">LeadGenPilot</strong>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2 rounded-xl">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Verified Corporate Identity</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
          {/* Email */}
          <div className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Email Support
            </span>
            <a
              href="mailto:bookmytime1355@gmail.com"
              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2 break-all"
            >
              <Mail className="w-4 h-4 shrink-0" />
              <span>bookmytime1355@gmail.com</span>
            </a>
            <p className="text-[11px] text-slate-400 mt-2">
              Replies typically sent within 24 hours.
            </p>
          </div>

          {/* Phone */}
          <div className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Direct Phone Line
            </span>
            <a
              href="tel:+919168081355"
              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2"
            >
              <Phone className="w-4 h-4 shrink-0" />
              <span>+91 9168 08 1355</span>
            </a>
            <p className="text-[11px] text-slate-400 mt-2">
              Mon–Fri, 9:00 AM – 6:00 PM IST.
            </p>
          </div>

          {/* Address */}
          <div className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Headquarters Location
            </span>
            <div className="text-sm font-semibold text-slate-200 flex items-start gap-2">
              <MapPin className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>Pune, Maharashtra, India</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Registered office & development operations.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center text-xs text-slate-400">
          Copyright © 2026 BookMyTime All rights reserved. | A product of Brightwave Digital Products LLP.
        </div>
      </div>
    </section>
  );
}
