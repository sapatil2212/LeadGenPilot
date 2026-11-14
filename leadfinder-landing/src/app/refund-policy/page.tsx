import React from "react";
import type { Metadata } from "next";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { RotateCcw, CheckCircle2, AlertCircle, CreditCard, Clock, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Cancellation & Refund Policy — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Cancellation and Refund Policy for LeadGenPilot and BookMyTime, operated by Brightwave Digital Products LLP.",
};

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Header */}
      <section className="bg-[#04060f] text-white py-14 sm:py-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 mb-4">
            <RotateCcw className="w-3.5 h-3.5" /> Billing & Guarantee
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Cancellation & Refund Policy
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
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Overview & Commitment</h2>
            <p>
              At <strong>Brightwave Digital Products LLP</strong> ("Company", "we", "us", or "our"), operating the <strong>LeadGenPilot</strong> software suite and <strong>BookMyTime</strong> web platform, customer satisfaction and transparent billing practices are foundational to our mission.
            </p>
            <p className="mt-2">
              This Cancellation & Refund Policy outlines the terms under which subscription cancellations and refund requests are handled for all digital services, paid subscriptions, and credit packages purchased through our website.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Subscription Cancellation Policy</h2>
            <p>
              We believe in giving our customers total autonomy over their billing commitments:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Cancel Anytime:</strong> You may cancel your active subscription at any time directly through your account dashboard or by notifying our support team in writing at <a href="mailto:leadgenpilot.in@gmail.com" className="text-indigo-600 hover:underline">leadgenpilot.in@gmail.com</a>.
              </li>
              <li>
                <strong>No Cancellation Fees:</strong> There are no cancellation penalties or hidden charges for terminating your subscription.
              </li>
              <li>
                <strong>Access Retention:</strong> Upon cancellation, your account will remain active with full access to paid features until the conclusion of your current paid billing period. After this date, your subscription will not renew, and your account will automatically revert to our free tier.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Refund Eligibility & 7-Day Guarantee</h2>
            <p>
              Because LeadGenPilot provides immediate digital access and software provisioning, the following refund standards apply:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/80">
                <div className="flex items-center gap-2 font-bold text-emerald-950 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Eligible for Refund</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  First-time subscription purchases are backed by a <strong>7-day satisfaction window</strong>. If our platform fails to operate as described or you encounter insurmountable technical issues that our support team cannot resolve within 48 hours, you are entitled to a full refund upon written request within 7 calendar days of your initial purchase.
                </p>
              </div>

              <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200/80">
                <div className="flex items-center gap-2 font-bold text-amber-950 mb-1">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Non-Refundable Scenarios</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Refunds are not granted for recurring renewals where cancellation was not requested prior to the renewal date, accounts suspended for violating our acceptable use or anti-spam rules, or standalone credit packages where credits have already been consumed for data scraping and enrichment.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Consumable Scraping & Enrichment Credits</h2>
            <p>
              Data extraction and enrichment queries incur direct computational and proxy infrastructure costs. Therefore, credits that have already been utilized to scrape, verify, or enrich lead records cannot be refunded. Any unused credits remaining in an active subscription cycle will remain in your account balance in accordance with your plan rules.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Refund Processing Timelines & Mechanism</h2>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900">Processing Window (5–7 Business Days)</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Once a refund is approved by our billing administration, the credit is initiated immediately. Depending on your bank, credit card issuer, or payment processor (e.g. Razorpay, Stripe, UPI), the refunded amount will reflect in your original payment method within <strong>5 to 7 business days</strong>.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 pt-2 border-t border-slate-200">
                <CreditCard className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900">Original Payment Route</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    All refunds are strictly returned to the original payment instrument used during checkout. In accordance with anti-fraud regulations, we do not issue cash refunds or send funds to third-party bank accounts.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Chargebacks & Friendly Resolution</h2>
            <p>
              We pride ourselves on transparent customer service. If you experience any billing discrepancies, duplicate charges, or dissatisfaction with service performance, please reach out to us first at <a href="mailto:leadgenpilot.in@gmail.com" className="text-indigo-600 hover:underline">leadgenpilot.in@gmail.com</a> or phone <a href="tel:+919168081355" className="text-indigo-600 hover:underline">+91 9168 08 1355</a>. We will investigate and resolve legitimate payment inquiries expeditiously.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. How to Submit a Refund Request</h2>
            <p>To request a refund, please send an email with the following details:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>Your registered LeadGenPilot account email address</li>
              <li>Transaction ID or invoice number</li>
              <li>Date of transaction</li>
              <li>A concise explanation of the reason for the refund request</li>
            </ul>
            <p className="mt-3">
              Our support team will acknowledge your request within 24 business hours.
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
