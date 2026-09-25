"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ArrowRight, LogIn } from "lucide-react";

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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(total > 0 ? (window.scrollY / total) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Scroll Progress Bar with Glowing Gradient */}
      <div
        className="fixed top-0 left-0 right-0 h-[2.5px] z-[60] bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 transition-all duration-75 pointer-events-none"
        style={{ width: `${progress}%` }}
      />

      <motion.header
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-white border-b border-slate-200/80 shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link
              href="/"
              className="group flex items-center transition-transform duration-200 hover:scale-[1.02]"
              aria-label="LeadGenPilot Home"
            >
              <img
                src={scrolled ? "/assets/logo/light-logo.png" : "/assets/logo/logo-dark.png"}
                alt="LeadGenPilot"
                className="h-9 sm:h-[38px] w-auto object-contain transition-all duration-200"
              />
            </Link>
          </div>

          {/* Desktop Navigation Links with animated sliding hover pill */}
          <nav
            className="hidden md:flex items-center p-1 rounded-full border border-transparent transition-colors"
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {navLinks.map((l, idx) => (
              <a
                key={l.href}
                href={l.href}
                onMouseEnter={() => setHoveredIdx(idx)}
                className={`relative px-3.5 py-1.5 text-[13.5px] font-medium rounded-lg transition-colors duration-150 ${
                  scrolled
                    ? "text-slate-600 hover:text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                {hoveredIdx === idx && (
                  <motion.span
                    layoutId="navHoverPill"
                    className={`absolute inset-0 rounded-md -z-10 ${
                      scrolled ? "bg-slate-100" : "bg-white/[0.08]"
                    }`}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                  />
                )}
                {l.label}
              </a>
            ))}
          </nav>

          {/* Desktop Action CTAs */}
          <div className="hidden sm:flex items-center gap-2.5">
            <a
              href="/app?mode=signin"
              className={`h-9 px-3.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all duration-150 ${
                scrolled
                  ? "text-slate-700 hover:text-slate-950 border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                  : "text-slate-200 hover:text-white border-white/15 bg-white/[0.05] hover:bg-white/[0.1] hover:border-white/25"
              }`}
            >
              <LogIn className="w-3.5 h-3.5 opacity-80" />
              <span>Log In</span>
            </a>
            <a
              href="/app?mode=signup"
              className={`relative group h-9 px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 shadow-sm hover:shadow active:scale-[0.98] ${
                scrolled
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-white text-slate-950 hover:bg-slate-100"
              }`}
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Mobile hamburger button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`sm:hidden p-2 rounded-lg border transition-colors ${
              scrolled
                ? "border-slate-200 text-slate-700 hover:bg-slate-100"
                : "border-white/15 text-white hover:bg-white/10"
            }`}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Mobile Dropdown Menu with Animation */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="sm:hidden overflow-hidden bg-white border-t border-slate-200 shadow-xl"
            >
              <div className="px-5 py-3 space-y-1">
                {navLinks.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 transition-colors"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="pt-2.5 mt-2 border-t border-slate-100 grid grid-cols-2 gap-2 pb-1">
                  <a
                    href="/app?mode=signin"
                    onClick={() => setMenuOpen(false)}
                    className="h-8.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <LogIn className="w-3.5 h-3.5" /> Log In
                  </a>
                  <a
                    href="/app?mode=signup"
                    onClick={() => setMenuOpen(false)}
                    className="h-8.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </>
  );
}
