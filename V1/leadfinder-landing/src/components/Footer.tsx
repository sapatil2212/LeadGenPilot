import { Mail, Phone, MapPin } from "lucide-react";

const featureLinks = [
  { label: "Google Maps Scraper", href: "#features" },
  { label: "AI Opportunity Analysis", href: "#features" },
  { label: "Smart 0–100 Lead Scoring", href: "#scoring" },
  { label: "Real-Time Google Sheets Sync", href: "#features" },
  { label: "Email & WhatsApp Outreach", href: "#outreach" },
  { label: "Deduplication & CRM", href: "#features" },
];

const navigationLinks = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Scoring Methodology", href: "#scoring" },
  { label: "Outreach Engine", href: "#outreach" },
  { label: "Pricing & Plans", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Launch Dashboard", href: "/app" },
];

const companyLinks = [
  { label: "About", href: "/about" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Cookie Policy", href: "/cookies" },
];

const legalLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookies", href: "/cookies" },
];

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-14">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center mb-4">
              {/* The footer sits on bg-slate-900, so the dark-background artwork. */}
              <img
                src="/assets/logo/logo-dark.png"
                alt="LeadGenPilot"
                className="h-11 sm:h-12 w-auto object-contain transition-all"
              />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              AI-powered Google Maps scraping and lead automation. Find, score, and reach local businesses — automatically.
            </p>
          </div>

          {/* Features Column */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Features</h4>
            <ul className="space-y-3">
              {featureLinks.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-sm text-slate-400 hover:text-indigo-400 transition-colors duration-200"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Navigation Column */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Navigation</h4>
            <ul className="space-y-3">
              {navigationLinks.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-sm text-slate-400 hover:text-indigo-400 transition-colors duration-200"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Company</h4>
            <ul className="space-y-3">
              {companyLinks.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-sm text-slate-400 hover:text-indigo-400 transition-colors duration-200"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Us Column */}
          <div className="lg:col-span-1">
            <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Contact Us</h4>
            <div className="space-y-4 text-xs text-slate-400">
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Email</span>
                <a
                  href="mailto:bookmytime1355@gmail.com"
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-indigo-400 transition-colors break-all"
                >
                  <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>bookmytime1355@gmail.com</span>
                </a>
              </div>
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Phone</span>
                <a
                  href="tel:+919168081355"
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-indigo-400 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>+91 9168 08 1355</span>
                </a>
              </div>
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Address</span>
                <div className="inline-flex items-start gap-1.5 text-slate-300 leading-relaxed">
                  <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                  <span>Pune, Maharashtra, India</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Copyright © 2026 BookMyTime All rights reserved. | A product of Brightwave Digital Products LLP.
          </p>
          <div className="flex gap-6 shrink-0">
            {legalLinks.map((item) => (
              <a key={item.label} href={item.href} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
