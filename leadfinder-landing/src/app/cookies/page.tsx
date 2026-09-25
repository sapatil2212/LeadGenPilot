import React from "react";
import type { Metadata } from "next";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { Cookie, Settings, CheckCircle2, Sliders } from "lucide-react";

export const metadata: Metadata = {
  title: "Cookie Policy — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Cookie Policy explaining how LeadGenPilot and BookMyTime use cookies and session storage.",
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Header */}
      <section className="bg-[#04060f] text-white py-14 sm:py-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-4">
            <Cookie className="w-3.5 h-3.5" /> Privacy Preferences
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Cookie Policy
          </h1>
          <p className="text-sm sm:text-base text-slate-400">
            Last Updated: January 1, 2026 • Effective Date: January 1, 2026
          </p>
        </div>
      </section>

      {/* Content Container */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1">
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-200/80 shadow-xs space-y-8 text-sm text-slate-700 leading-relaxed">
          
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. What Are Cookies?</h2>
            <p>
              Cookies are small text files that are stored on your computer or mobile device when you visit a website. They are widely used by online applications to make websites work properly, improve user authentication, and provide useful configuration feedback to service providers.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. How Brightwave Digital Products LLP Uses Cookies</h2>
            <p>
              When you use <strong>LeadGenPilot</strong> or <strong>BookMyTime</strong>, we use cookies and comparable browser storage technologies (such as localStorage) solely to ensure secure, rapid, and authenticated access to your lead workspace.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Categories of Cookies We Use</h2>
            
            <div className="space-y-4 mt-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Strictly Necessary Cookies (Essential)</span>
                </div>
                <p className="text-xs text-slate-600">
                  These cookies are indispensable for our service to function. They authenticate your account session, maintain CSRF security tokens, and manage secure API authorization headers. Without these, you cannot log in or manage your scraping tasks.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  <span>Preference & Functionality Cookies</span>
                </div>
                <p className="text-xs text-slate-600">
                  These cookies remember your customized preferences, such as selected city/niche filters, sidebar layout states, and table column visibility settings across sessions.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <Settings className="w-4 h-4 text-violet-600" />
                  <span>Performance & Telemetry Cookies</span>
                </div>
                <p className="text-xs text-slate-600">
                  We use aggregated, anonymized performance metrics to measure API response times, detect scraping anomalies, and optimize server latency across our infrastructure.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Third-Party Integrations</h2>
            <p>
              If you authenticate using Google Single Sign-On (SSO) or link your Google Sheets account, Google may set authentication and security cookies in your browser in accordance with Google's independent privacy policy. We do not control or read Google's proprietary third-party cookies.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Managing & Disabling Cookies</h2>
            <p>
              Most web browsers automatically accept cookies, but you can alter your browser settings to decline cookies if you prefer. Please note that disabling essential authentication cookies will prevent you from signing in to the LeadGenPilot dashboard or running automated lead searches.
            </p>
          </div>

        </div>

        {/* Company Contact Details Section */}
        <CompanyContactSection />
      </main>

      <Footer />
    </div>
  );
}
