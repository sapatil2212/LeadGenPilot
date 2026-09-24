import React from "react";
import type { Metadata } from "next";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { Shield, Lock, Eye, FileText, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Privacy Policy for LeadGenPilot and BookMyTime, operated by Brightwave Digital Products LLP.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Header */}
      <section className="bg-[#04060f] text-white py-14 sm:py-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 mb-4">
            <Shield className="w-3.5 h-3.5" /> Legal & Transparency
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Privacy Policy
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
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Introduction & Overview</h2>
            <p>
              This Privacy Policy explains how <strong>Brightwave Digital Products LLP</strong> ("Company", "we", "us", or "our"), operating under the product brand <strong>BookMyTime</strong> and SaaS platform <strong>LeadGenPilot</strong>, collects, processes, and protects your personal and business information when you use our website, APIs, browser automations, and associated software services.
            </p>
            <p className="mt-2">
              We are committed to operating in full accordance with applicable privacy frameworks, including global data protection principles and Indian IT (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account Information:</strong> When you register an account, we collect your name, email address, password hash, and company name.
              </li>
              <li>
                <strong>Public Business Directory Data:</strong> LeadGenPilot retrieves publicly accessible commercial business listings from Google Maps, including business names, publicly listed phone numbers, physical addresses, review counts, star ratings, and web URLs. We do not extract private consumer data.
              </li>
              <li>
                <strong>Google Integration Tokens:</strong> If you connect Google Sheets for automated export, we securely store your OAuth2 refresh tokens in encrypted form to create and update designated spreadsheets on your behalf.
              </li>
              <li>
                <strong>Usage & Log Data:</strong> Standard server logs, IP addresses, browser types, scraping session timestamps, and error diagnostics to maintain system availability and security.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. How We Use Your Information</h2>
            <p>We process the information collected for legitimate commercial purposes including:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-semibold text-slate-900 block mb-1">Service Delivery</span>
                <span>Generating lead discovery plans, calculating lead opportunity scores, and updating spreadsheets.</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-semibold text-slate-900 block mb-1">Account Security</span>
                <span>Issuing single-use verification codes (OTP), authenticating sessions, and blocking brute-force attacks.</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-semibold text-slate-900 block mb-1">Outreach Automation</span>
                <span>Facilitating WhatsApp safety queues and email dispatch configured directly by your account.</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-semibold text-slate-900 block mb-1">Continuous Improvement</span>
                <span>Optimizing AI scoring models and preventing duplicate lead scraping across your workspace.</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Google API Services User Data Policy</h2>
            <p>
              LeadGenPilot's use and transfer to any other app of information received from Google APIs adheres to the{" "}
              <a 
                href="https://developers.google.com/terms/api-services-user-data-policy" 
                target="_blank" 
                rel="noreferrer" 
                className="text-indigo-600 underline font-medium"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We never sell your Google Sheets credentials or use customer spreadsheet contents for general AI training.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Data Retention & Security Architecture</h2>
            <p>
              All traffic is encrypted in transit using industry-standard TLS 1.3 protocol. User passwords are encrypted with salted one-way bcrypt hashing. OAuth tokens and sensitive connection credentials are encrypted at rest using AES-256-GCM. We maintain strict role-based access control (RBAC) across our backend infrastructure.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Your Data Rights & Deletion Requests</h2>
            <p>
              You maintain full ownership of your data. You may request a complete export of your workspace leads or request complete account deletion at any time by contacting our privacy compliance team at <strong>bookmytime1355@gmail.com</strong>. Upon verified request, all personal data, API tokens, and associated records will be permanently purged within 30 days.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Policy Modifications</h2>
            <p>
              We reserve the right to periodically update this policy to reflect technological advancements or regulatory revisions. We will notify active users of significant amendments via their registered email address or dashboard notice.
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
