"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight, LogIn } from "lucide-react";

export default function CompanyNavbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 inset-x-0 z-50 bg-white border-b border-slate-200/80 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 flex items-center justify-between h-16">
        {/* Brand Logo */}
        <div className="flex items-center">
          <Link
            href="/"
            className="group flex items-center transition-transform duration-200 hover:scale-[1.02]"
            aria-label="LeadGenPilot Home"
          >
            <img
              src="/assets/logo/light-logo.png"
              alt="LeadGenPilot"
              className="h-9 sm:h-[38px] w-auto object-contain"
            />
          </Link>
        </div>

        {/* Desktop Links */}
        <nav className="hidden md:flex items-center gap-1">
          <Link
            href="/"
            className="px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 hover:text-slate-950 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Home
          </Link>
          <Link
            href="/#features"
            className="px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 hover:text-slate-950 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Features
          </Link>
          <Link
            href="/#how-it-works"
            className="px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 hover:text-slate-950 rounded-lg hover:bg-slate-100 transition-colors"
          >
            How It Works
          </Link>
          <Link
            href="/#pricing"
            className="px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 hover:text-slate-950 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/about"
            className="px-3.5 py-1.5 text-[13.5px] font-medium text-slate-600 hover:text-slate-950 rounded-lg hover:bg-slate-100 transition-colors"
          >
            About
          </Link>
        </nav>

        {/* Desktop Action CTAs */}
        <div className="hidden sm:flex items-center gap-2.5">
          <a
            href="/app?mode=signin"
            className="h-9 px-3.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300 flex items-center gap-1.5 transition-all shadow-xs"
          >
            <LogIn className="w-3.5 h-3.5 opacity-80" />
            <span>Log In</span>
          </a>
          <a
            href="/app?mode=signup"
            className="group h-9 px-4 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 flex items-center gap-1.5 transition-all shadow-xs hover:shadow active:scale-[0.98]"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Toggle navigation"
        >
          {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden bg-white border-t border-slate-200 px-5 py-3 space-y-1 shadow-xl">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Home
          </Link>
          <Link
            href="/#features"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Features
          </Link>
          <Link
            href="/#pricing"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Pricing
          </Link>
          <Link
            href="/about"
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            About Us
          </Link>
          <div className="pt-2.5 mt-2 border-t border-slate-100 grid grid-cols-2 gap-2 pb-1">
            <a
              href="/app?mode=signin"
              className="h-8.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 bg-white flex items-center justify-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" /> Log In
            </a>
            <a
              href="/app?mode=signup"
              className="h-8.5 rounded-lg text-xs font-semibold text-white bg-slate-900 flex items-center justify-center gap-1.5"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
