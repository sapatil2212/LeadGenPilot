"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, Zap, LogIn } from "lucide-react";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Outreach", href: "#outreach" },
  { label: "Scoring", href: "#scoring" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const total = document.body.scrollHeight - window.innerHeight;
      setProgress(total > 0 ? (window.scrollY / total) * 100 : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Scroll Progress */}
      <div className="scroll-progress-bar" style={{ width: `${progress}%` }} />

      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/90 backdrop-blur-xl border-b border-slate-100"
          : "bg-transparent"
      }`}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16 lg:h-[70px]">

          {/* Logo */}
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="LeadGenPilot" className="h-8 w-auto object-contain" />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map(l => (
              <a key={l.href} href={l.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  scrolled 
                    ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100" 
                    : "text-slate-300 hover:text-white hover:bg-white/5"
                }`}>
                {l.label}
              </a>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <a href="/app?mode=signin" className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 ${
              scrolled
                ? "text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                : "text-white border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"
            }`}>
              <LogIn className="w-4 h-4" />
              Log In
            </a>
            <a href="/app?mode=signup"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-200">
              <Zap className="w-4 h-4 text-indigo-600 fill-indigo-600" />
              Get Started Free
            </a>
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMenuOpen(!menuOpen)}
            className={`lg:hidden p-2 rounded-lg transition-colors ${
              scrolled ? "hover:bg-slate-100 text-slate-600" : "hover:bg-white/5 text-white"
            }`}
            aria-label="Toggle menu">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="lg:hidden bg-white/95 backdrop-blur-xl border-t border-slate-100">
            <div className="px-6 py-4 flex flex-col gap-1">
              {navLinks.map(l => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                  className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors">
                  {l.label}
                </a>
              ))}
              <div className="pt-3 border-t border-slate-100 mt-2 flex flex-col gap-2">
                <a href="/app?mode=signin" onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50">
                  <LogIn className="w-4 h-4" /> Log In
                </a>
                <a href="/app?mode=signup" onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-slate-900 bg-white border border-slate-200 hover:bg-slate-50">
                  <Zap className="w-4 h-4 text-indigo-600 fill-indigo-600" /> Get Started Free
                </a>
              </div>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
