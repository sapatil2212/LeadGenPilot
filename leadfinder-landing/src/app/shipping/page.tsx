import React from "react";
import type { Metadata } from "next";
import CompanyNavbar from "@/components/CompanyNavbar";
import Footer from "@/components/Footer";
import CompanyContactSection from "@/components/CompanyContactSection";
import { Truck, Zap, Mail, Globe2, CheckCircle2, Clock, ShieldCheck, FileCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Shipping & Delivery Policy — LeadGenPilot | Brightwave Digital Products LLP",
  description: "Shipping and Delivery Policy for LeadGenPilot and BookMyTime, operated by Brightwave Digital Products LLP. Explaining digital service provisioning and fulfillment timelines.",
};

export default function ShippingDeliveryPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <CompanyNavbar />

      {/* Header */}
      <section className="bg-[#04060f] text-white py-14 sm:py-20 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 mb-4">
            <Truck className="w-3.5 h-3.5" /> Digital Delivery & Fulfillment
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Shipping & Delivery Policy
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
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Nature of Services (100% Digital Delivery)</h2>
            <p>
              <strong>Brightwave Digital Products LLP</strong> ("Company", "we", "us", or "our") operates <strong>LeadGenPilot</strong> and the <strong>BookMyTime</strong> web platform as a Software-as-a-Service (SaaS) provider.
            </p>
            <p className="mt-2">
              All products, subscriptions, and data enrichment credits sold on this platform are <strong>entirely digital in nature</strong>. We do not manufacture, package, inventory, or physically ship any tangible goods. Therefore, standard physical logistics, courier handling, and postal deliveries are not applicable to our services.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Delivery Method & Fulfillment Process</h2>
            <p>
              When you purchase a subscription plan or top-up credit pack, electronic fulfillment takes place through our automated provisioning systems:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <Zap className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Instant Activation</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Platform access and subscription permissions are provisioned instantaneously on your authenticated dashboard upon payment confirmation.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Email Confirmation</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  A transaction confirmation, account details, and tax invoice are automatically dispatched to your registered email address.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-1">
                  <Globe2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Cloud Accessible</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  All lead data, enrichment reports, and exported Google Sheets are accessible from any standard web browser worldwide.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Delivery Timelines & Service Levels</h2>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900">Standard Delivery Timeline: Immediate (0–15 Minutes)</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    In greater than 99% of transactions, account provisioning and quota credit allocation occur <strong>immediately upon successful payment verification</strong> by our payment gateway partners (e.g., Razorpay, Stripe).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 pt-2 border-t border-slate-200">
                <FileCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900">Maximum Provisioning Window: Within 24 Hours</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    In the unusual event of banking server latency, automated fraud inspection, or payment gateway settlement delays, account provisioning will be completed within a maximum of <strong>24 hours</strong>. If your access has not been activated within this timeframe, our engineering team will manually investigate and resolve your account provisioning.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Shipping & Handling Charges</h2>
            <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/80 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-emerald-950">Zero Shipping Costs (Free Digital Fulfillment)</h4>
                <p className="text-xs text-slate-700 leading-relaxed mt-1">
                  Because all services, exports, lead indexes, and outreach tools are fulfilled electronically via the internet, there are <strong>zero shipping, freight, handling, or courier fees (₹0.00 / $0.00)</strong> charged to your account. The price displayed during checkout is the total price inclusive of electronic service delivery.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. International Availability</h2>
            <p>
              Our cloud infrastructure is hosted in top-tier global data centers. Our digital services are available to commercial customers globally. As long as you have an active internet connection and a compatible modern web browser, you can access LeadGenPilot and BookMyTime from anywhere across the globe without geographical shipping barriers.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Troubleshooting Access & Non-Delivery Support</h2>
            <p>
              If you have successfully made a payment but cannot access your paid subscription features, please verify the following:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>Ensure you are logged in using the exact email address used during purchase.</li>
              <li>Check your email inbox and Spam/Junk folder for your payment receipt and activation confirmation.</li>
              <li>Perform a hard refresh on your browser (<kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono">Ctrl+F5</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono">Cmd+Shift+R</kbd>).</li>
            </ul>
            <p className="mt-3">
              If your paid status does not reflect within 15 minutes, please reach out to our dedicated support team immediately at:
            </p>
            <div className="mt-2 text-xs font-medium text-slate-700 space-y-1">
              <div>Email: <a href="mailto:leadgenpilot.in@gmail.com" className="text-indigo-600 hover:underline">leadgenpilot.in@gmail.com</a></div>
              <div>Phone: <a href="tel:+919168081355" className="text-indigo-600 hover:underline">+91 9168 08 1355</a></div>
              <div>Hours: Monday to Friday, 9:00 AM – 6:00 PM IST</div>
            </div>
          </div>

        </div>

        {/* Company Contact Details Section */}
        <CompanyContactSection />
      </main>

      <Footer />
    </div>
  );
}
