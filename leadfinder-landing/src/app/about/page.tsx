import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { 
  Building2, 
  Target, 
  Sparkles, 
  MapPin, 
  Zap, 
  ShieldCheck, 
  Users, 
  CheckCircle2, 
  ArrowRight,
  TrendingUp,
  Cpu
} from "lucide-react";

export const metadata: Metadata = {
  title: "About Us — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Learn about LeadGenPilot, developed by Brightwave Digital Products LLP in Pune, India. AI-powered Google Maps automation and sales lead intelligence.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Hero Header */}
      <section className="bg-[#04060f] text-white py-16 sm:py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/30 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 mb-4">
            <Building2 className="w-3.5 h-3.5" /> About LeadGenPilot & BookMyTime
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-5">
            Empowering Sales Teams to Discover Untapped Local Markets
          </h1>
          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            LeadGenPilot is the AI-driven sales automation suite engineered by{" "}
            <strong className="text-white">Brightwave Digital Products LLP</strong>. We help agencies, freelancers, and B2B growth teams automate Google Maps lead generation and multichannel outreach.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-14 flex-1">
        {/* Mission & Vision Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-14">
          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-5">
              <Target className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Our Core Mission</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              To eliminate the manual drudgery of prospecting local businesses. By indexing public Google Maps listings, identifying high-intent businesses without modern web infrastructure, and scoring their digital footprint using AI, we turn hours of manual research into a 3-minute automated workflow.
            </p>
          </div>

          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mb-5">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Engineered for High Conversion</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Traditional cold email inboxes are oversaturated. We empower businesses to reach local founders directly through WhatsApp automation and hyper-personalized email outreach that prospects actually open, reply to, and convert into revenue.
            </p>
          </div>
        </div>

        {/* Why Choose Us */}
        <div className="bg-white rounded-3xl p-8 sm:p-10 border border-slate-200/80 shadow-xs mb-14">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            The Pillars of Our Engineering
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Cpu className="w-4 h-4 text-indigo-600" />
                <span>Zero-Hallucination AI</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Scoring models run strictly against verified Google Maps data, review counts, ratings, and social web links.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Zap className="w-4 h-4 text-emerald-600" />
                <span>Real-Time Sheets Sync</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Leads and status changes stream instantly to your connected Google Sheet without export lag or manual copy-pasting.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-violet-600" />
                <span>Human-Paced Safety</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Outreach respects WhatsApp safety delays and email anti-spam guidelines to safeguard sender domain reputation.
              </p>
            </div>
          </div>
        </div>

        {/* Company Contact Details Section */}
        <CompanyContactSection />

        {/* Call to action */}
        <div className="text-center py-8">
          <h3 className="text-xl font-bold text-slate-900 mb-3">Ready to scale your outreach pipeline?</h3>
          <p className="text-sm text-slate-500 mb-6">
            Start scraping qualified local leads in baner, pune, or any city worldwide in 60 seconds.
          </p>
          <a
            href="/app?mode=signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-sm"
          >
            Launch LeadGenPilot Dashboard
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </main>

      <Footer />
    </div>
  );
}
