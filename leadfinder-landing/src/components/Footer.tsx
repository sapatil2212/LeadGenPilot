import { Zap, ExternalLink, Code2, MessageSquare, Briefcase } from "lucide-react";

const footerLinks = {
  Product: ["Features", "How It Works", "Lead Scoring", "Pricing", "Changelog", "Roadmap"],
  Resources: ["Documentation", "API Reference", "GitHub", "Deployment Guide", "FAQ", "Blog"],
  Company: ["About", "Contact", "Privacy Policy", "Terms of Service", "Cookie Policy"],
};

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-14">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center mb-4">
              <img src="/logo.png" alt="NexaLeadAi" className="h-8 w-auto object-contain" />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-6 max-w-xs">
              AI-powered Google Maps scraping and lead automation. Find, score, and reach local businesses — automatically.
            </p>
            <div className="flex gap-3">
              {[
                { icon: Code2,        href: "https://github.com/sapatil2212/Lead-Finder-Automation", label: "GitHub" },
                { icon: MessageSquare, href: "#", label: "Twitter" },
                { icon: Briefcase,   href: "#", label: "LinkedIn" },
              ].map(s => (
                <a key={s.label} href={s.href} aria-label={s.label} target={s.href !== "#" ? "_blank" : undefined} rel="noopener noreferrer"
                  className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white transition-all duration-200">
                  <s.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([section, links]) => (
            <div key={section}>
              <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">{section}</h4>
              <ul className="space-y-3">
                {links.map(l => (
                  <li key={l}>
                    <a href="#" className="text-sm text-slate-400 hover:text-indigo-400 transition-colors duration-200 flex items-center gap-1 group">
                      {l}
                      {l === "GitHub" && <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">© 2025 NexaLeadAi. All rights reserved. Built with ❤️ for sales teams.</p>
          <div className="flex gap-6">
            {["Privacy", "Terms", "Cookies"].map(l => (
              <a key={l} href="#" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
