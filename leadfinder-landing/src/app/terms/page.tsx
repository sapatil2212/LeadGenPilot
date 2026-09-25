import React from "react";
import type { Metadata } from "next";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { FileCheck, ShieldAlert, Scale, AlertCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Terms of Service governing the use of LeadGenPilot and BookMyTime, operated by Brightwave Digital Products LLP.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Header */}
      <section className="bg-[#04060f] text-white py-14 sm:py-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-violet-500/20 text-violet-300 border border-violet-500/30 mb-4">
            <Scale className="w-3.5 h-3.5" /> User Agreement
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Terms of Service
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
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Agreement to Terms</h2>
            <p>
              These Terms of Service constitute a legally binding agreement between you ("User", "you") and <strong>Brightwave Digital Products LLP</strong> ("Company", "we", "us", or "our"), governing your access to and use of the <strong>LeadGenPilot</strong> software application and the <strong>BookMyTime</strong> web platform.
            </p>
            <p className="mt-2">
              By registering an account, accessing our dashboard, or executing any scraping or outreach queries, you acknowledge that you have read, understood, and agreed to be bound by these Terms in full.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Description of Services</h2>
            <p>
              LeadGenPilot provides automated lead intelligence, public Google Maps indexing tools, AI-powered business opportunity scoring, Google Sheets synchronization, and multichannel communication automation utilities. The service is provided on a Software-as-a-Service (SaaS) model.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Account Registration & Security</h2>
            <p>
              You must provide accurate, current, and complete registration information. You are solely responsible for maintaining the confidentiality of your account credentials and one-time verification passcodes (OTP). Any activities occurring under your account remain your legal responsibility.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Acceptable Use & Compliance Obligations</h2>
            <p>
              You agree to use LeadGenPilot exclusively for lawful commercial B2B prospecting purposes. When conducting outreach via WhatsApp or Email:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                You must comply with all applicable telecommunications, privacy, and anti-spam laws, including the CAN-SPAM Act, the GDPR, the Telecom Commercial Communications Customer Preference Regulations (TRAI DND), and WhatsApp Business Messaging policies.
              </li>
              <li>
                You must honor all opt-out or unsubscribe requests immediately through our suppression management system.
              </li>
              <li>
                You agree not to use our infrastructure to transmit unlawful, defamatory, harassing, or fraudulent communications.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Subscriptions, Credits, & Billing</h2>
            <p>
              Certain features, automated scraping quotas, and enrichment limits require an active subscription tier or prepaid credits. All subscription fees are billed in advance on a recurring monthly or annual basis. Fees are non-refundable except where explicitly required by applicable law or stated in writing. You may cancel your subscription at any time via your account settings.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Intellectual Property Rights</h2>
            <p>
              All software, source code, visual interfaces, graphic assets, trademarks, and documentation associated with LeadGenPilot and BookMyTime are the exclusive property of <strong>Brightwave Digital Products LLP</strong> or its licensors. You are granted a limited, revocable, non-exclusive, non-transferable license to access the service solely in accordance with these Terms.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Disclaimers & Limitation of Liability</h2>
            <p>
              The platform and indexed public business directory data are provided on an "AS IS" and "AS AVAILABLE" basis. While we strive for maximum accuracy, Brightwave Digital Products LLP makes no warranties regarding the absolute completeness of third-party public directory records.
            </p>
            <p className="mt-2">
              To the maximum extent permitted by law, Brightwave Digital Products LLP shall not be liable for any indirect, incidental, punitive, or consequential damages resulting from your use of the platform.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">8. Governing Law & Dispute Resolution</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of India. Any legal dispute, controversy, or claim arising out of or relating to these Terms or the service shall be subject to the exclusive jurisdiction of the competent courts located in <strong>Pune, Maharashtra, India</strong>.
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
