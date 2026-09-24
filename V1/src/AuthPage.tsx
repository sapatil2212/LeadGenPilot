/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Eye,
  EyeOff,
  Phone,
  Check,
  X,
  MapPin,
  Bot,
  Send,
} from "lucide-react";

function GoogleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
}

type Mode = "signin" | "signup";
type Step = "credentials" | "otp";

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, data };
}

function getInitialMode(): Mode {
  if (typeof window === "undefined") return "signin";
  const param = new URLSearchParams(window.location.search).get("mode");
  return param === "signup" ? "signup" : "signin";
}

export default function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthedUser) => void }) {
  const [mode, setMode] = useState<Mode>(getInitialMode);
  const [step, setStep] = useState<Step>("credentials");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP state - array of 6 digits
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendIn, setResendIn] = useState(0);

  // Validation states
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);

  // Forgot-password sub-flow: "none" | "request" | "reset"
  const [forgotStep, setForgotStep] = useState<"none" | "request" | "reset">("none");
  const [newPassword, setNewPassword] = useState("");

  // Resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "otp") setTimeout(() => otpRefs.current[0]?.focus(), 80);
  }, [step]);

  // Live password requirements
  const reqLength = password.length >= 8;
  const reqCases = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const reqNumOrSym = /\d/.test(password) || /[^a-zA-Z0-9]/.test(password);

  // Password strength check
  const getPasswordStrength = (pwd: string): { strength: number; label: string; color: string; labelColor: string } => {
    if (!pwd) return { strength: 0, label: "", color: "", labelColor: "text-slate-400" };
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd) && /[^a-zA-Z0-9]/.test(pwd)) strength++;

    if (strength <= 1) return { strength: 1, label: "Weak", color: "bg-rose-500", labelColor: "text-rose-600" };
    if (strength <= 2) return { strength: 2, label: "Fair", color: "bg-amber-500", labelColor: "text-amber-600" };
    if (strength <= 3) return { strength: 3, label: "Good", color: "bg-blue-500", labelColor: "text-blue-600" };
    return { strength: 4, label: "Strong", color: "bg-emerald-500", labelColor: "text-emerald-600" };
  };

  const passwordStrength = getPasswordStrength(password);
  const passwordsMatch = Boolean(confirmPassword && password === confirmPassword);
  const passwordsDontMatch = Boolean(confirmPassword && password !== confirmPassword);

  // Handle OTP digit input
  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = [...otpDigits];

    for (let i = 0; i < pastedData.length && i < 6; i++) {
      newDigits[i] = pastedData[i];
    }

    setOtpDigits(newDigits);
    const nextEmptyIndex = newDigits.findIndex((d) => !d);
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    otpRefs.current[focusIndex]?.focus();
  };

  const getOtpString = () => otpDigits.join("");

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", m);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setStep("credentials");
    setOtpDigits(["", "", "", "", "", ""]);
    setConfirmPassword("");
    setPhone("");
    setPasswordTouched(false);
    setConfirmPasswordTouched(false);
    resetMessages();
  };

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (mode === "signup") {
      if (!confirmPasswordTouched) {
        setError("Please confirm your password.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const { ok, data } = await postJson("/api/auth/signup", { name, email, password, phone });
        if (!ok) {
          setError(data.error || "Sign up failed.");
          return;
        }
        setNotice(`We sent a 6-digit verification code to ${email}.`);
        setStep("otp");
        setResendIn(60);
      } else {
        const { ok, data } = await postJson("/api/auth/login", { email, password });
        if (!ok) {
          setError(data.error || "Sign in failed.");
          return;
        }
        if (data.requiresVerification) {
          setNotice(`Please verify your email. We sent a code to ${email}.`);
          setStep("otp");
          setResendIn(60);
          return;
        }
        onAuthenticated(data.user);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = getOtpString();

    if (otpCode.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/verify-otp", { email, code: otpCode, purpose: "verify" });
      if (!ok) {
        setError(data.error || "Verification failed.");
        setOtpDigits(["", "", "", "", "", ""]);
        otpRefs.current[0]?.focus();
        return;
      }
      setMode("signin");
      setStep("credentials");
      setOtpDigits(["", "", "", "", "", ""]);
      setPassword("");
      setConfirmPassword("");
      setError("");
      setNotice("Email verified successfully. Please sign in to open your workspace.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/forgot-password", { email });
      if (!ok) {
        setError(data.error || "No account exists with this email address. Please register first.");
        return;
      }
      setNotice(data.message || `A 6-digit reset code has been sent to ${email}.`);
      setForgotStep("reset");
      setResendIn(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = getOtpString();

    if (otpCode.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/reset-password", { email, code: otpCode, password: newPassword });
      if (!ok) {
        setError(data.error || "Could not reset password.");
        return;
      }
      setForgotStep("none");
      setMode("signin");
      setStep("credentials");
      setOtpDigits(["", "", "", "", "", ""]);
      setNewPassword("");
      setPassword("");
      setError("");
      setNotice("Password updated. Please sign in with your new password.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgotResend = async () => {
    if (resendIn > 0) return;
    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/forgot-password", { email });
      if (!ok) {
        setError(data.error || "Could not resend code. Please wait before retrying.");
        return;
      }
      setNotice(data.message || `A new 6-digit reset code was sent to ${email}. Previous codes have been invalidated.`);
      setOtpDigits(["", "", "", "", "", ""]);
      setResendIn(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/resend-otp", { email, purpose: "verify" });
      if (!ok) {
        setError(data.error || "Could not resend code.");
        return;
      }
      setNotice(`A new code was sent to ${email}. Previous codes have been invalidated.`);
      setOtpDigits(["", "", "", "", "", ""]);
      setResendIn(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    setBusy(true);
    resetMessages();
    try {
      const res = await fetch(`/api/auth/google?mode=${mode}&json=1`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(
        data.error ||
        "Google Sign-In is not configured yet. Please configure GOOGLE_CLIENT_ID in your .env file or use email and password."
      );
    } catch {
      setError("Could not connect to Google authentication.");
    } finally {
      setBusy(false);
    }
  };

  // Base input class: Compact, shadowless, faint borders, refined typography
  const inputClass =
    "w-full h-9 rounded-lg border border-slate-200/90 bg-white pl-8 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/15 focus:outline-none transition-all duration-150";

  return (
    <div className="min-h-screen w-full flex items-stretch bg-white font-sans text-slate-900 selection:bg-indigo-500/20 selection:text-indigo-900">
      {/* Left brand panel (desktop only) */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[44%] relative overflow-hidden bg-[#090d16] border-r border-slate-800/80">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative z-10 flex flex-col justify-between p-10 xl:p-12 text-white w-full">
          {/* Top navigation & tag */}
          <div className="flex items-center justify-between">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to home</span>
            </a>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900/90 border border-slate-800 text-[10px] text-slate-300 font-mono tracking-tight">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LeadGenPilot v2.5
            </div>
          </div>

          {/* Center value propositions */}
          <div className="space-y-6 max-w-sm my-auto py-8">
            <div className="space-y-2">
              <h1 className="text-2xl xl:text-3xl font-semibold leading-snug tracking-tight text-white">
                Turn Google Maps into a pipeline of qualified leads.
              </h1>
              <p className="text-xs xl:text-sm text-slate-400 leading-relaxed">
                Autonomous geo-discovery, AI ICP qualification, and multi-channel outreach campaigns in one unified workspace.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/40 flex items-start gap-3">
                <div className="w-7 h-7 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200">Autonomous Map Scraping</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Extract verified businesses by niche and geo-coordinates without Google API fees.
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/40 flex items-start gap-3">
                <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200">AI Qualification & Scoring</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Instant ICP grading, website technology detection, and digital presence audits.
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/40 flex items-start gap-3">
                <div className="w-7 h-7 rounded-md bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Send className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200">Multi-Channel Outreach</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Automated personalized email templates and direct WhatsApp engagement.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Enterprise-grade authentication • Workspace isolated</span>
            </div>
          </div>

          {/* Bottom attribution */}
          <div className="text-[11px] text-slate-500 border-t border-slate-800/60 pt-4 flex items-center justify-between">
            <span>© 2026 Brightwave Digital</span>
            <span>All rights reserved</span>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 bg-slate-50/40">
        <div className="w-full max-w-[360px] mx-auto">
          {/* Mobile Back Link */}
          <div className="lg:hidden flex items-center mb-6">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to home</span>
            </a>
          </div>

          {/* Forgot / Reset password sub-flow */}
          {forgotStep !== "none" ? (
            <div>
              <button
                type="button"
                onClick={() => {
                  setForgotStep("none");
                  resetMessages();
                  setOtpDigits(["", "", "", "", "", ""]);
                  setNewPassword("");
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-4 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to sign in</span>
              </button>

              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 tracking-[-0.01em]">
                  {forgotStep === "request" ? "Reset your password" : "Enter verification code"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  {forgotStep === "request"
                    ? "Enter your account email to receive a 6-digit reset code."
                    : `Enter the 6-digit code sent to ${email} and set your new password.`}
                </p>
              </div>

              {forgotStep === "request" ? (
                <form onSubmit={handleForgotRequest} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1 leading-none">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="email"
                        placeholder="name@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        autoComplete="email"
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="space-y-2">
                      <div className="text-[12px] text-rose-700 bg-rose-50/70 border border-rose-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5 leading-relaxed">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 shrink-0" />
                        <span className="flex-1">{error}</span>
                      </div>
                      {error.toLowerCase().includes("register") && (
                        <button
                          type="button"
                          onClick={() => {
                            setForgotStep("none");
                            switchMode("signup");
                          }}
                          className="w-full text-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 py-1 transition-colors cursor-pointer"
                        >
                          Don't have an account? Sign up now &rarr;
                        </button>
                      )}
                    </div>
                  )}
                  {notice && !error && (
                    <div className="text-[12px] text-emerald-700 bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                      <span className="flex-1">{notice}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-9 rounded-lg text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send reset code"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-3">
                  {/* Compact 6-Digit OTP Cells */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1.5 text-center leading-none">
                      Verification code
                    </label>
                    <div className="flex gap-1.5 justify-center">
                      {otpDigits.map((digit, index) => (
                        <input
                          key={index}
                          ref={(el) => {
                            otpRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(index, e)}
                          onPaste={index === 0 ? handleOtpPaste : undefined}
                          className={`w-9 h-11 sm:w-10 sm:h-11 text-center text-base font-semibold rounded-lg border transition-all duration-150 ${digit
                              ? "border-slate-300 bg-slate-50/80 text-slate-900"
                              : "border-slate-200/90 bg-white text-slate-900 hover:border-slate-300"
                            } focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/15 focus:outline-none`}
                          autoComplete="off"
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1 leading-none">
                      New password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="At least 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`${inputClass} pr-8`}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 transition-colors cursor-pointer"
                        tabIndex={-1}
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="text-[12px] text-rose-700 bg-rose-50/70 border border-rose-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 shrink-0" />
                      <span className="flex-1">{error}</span>
                    </div>
                  )}
                  {notice && !error && (
                    <div className="text-[12px] text-emerald-700 bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                      <span className="flex-1">{notice}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || getOtpString().length !== 6 || newPassword.length < 8}
                    className="w-full h-9 rounded-lg text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update password"}
                  </button>

                  <div className="text-center text-xs text-slate-500 pt-1">
                    Didn't receive code?{" "}
                    {resendIn > 0 ? (
                      <span className="text-slate-400 font-mono text-[11px]">Resend in {resendIn}s</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleForgotResend}
                        disabled={busy}
                        className="text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer disabled:opacity-50"
                      >
                        Resend code
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          ) : step === "credentials" ? (
            /* Main Credentials Form: Sign In / Sign Up */
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 tracking-[-0.01em]">
                  {mode === "signin" ? "Welcome back" : "Create an account"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  {mode === "signin"
                    ? "Enter your credentials to access your dashboard."
                    : "Get started with automated B2B lead discovery."}
                </p>
              </div>

              {/* Refined Segmented Mode Toggle (No heavy shadow) */}
              <div className="w-full grid grid-cols-2 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200/70 mb-4">
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className={`py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${mode === "signin"
                      ? "bg-white text-slate-900 font-semibold shadow-none border border-slate-200/40"
                      : "text-slate-500 hover:text-slate-900"
                    }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className={`py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${mode === "signup"
                      ? "bg-white text-slate-900 font-semibold shadow-none border border-slate-200/40"
                      : "text-slate-500 hover:text-slate-900"
                    }`}
                >
                  Sign Up
                </button>
              </div>

              <form onSubmit={handleSubmitCredentials} className="space-y-3">
                {/* Full name (Sign up only) */}
                {mode === "signup" && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1 leading-none">
                      Full name
                    </label>
                    <div className="relative">
                      <UserIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputClass}
                        autoComplete="name"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* Email address */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1 leading-none">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                {/* Phone number (Sign up optional) */}
                {mode === "signup" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-slate-600 leading-none">Phone number</label>
                      <span className="text-[10px] text-slate-400">Optional</span>
                    </div>
                    <div className="relative">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={inputClass}
                        autoComplete="tel"
                      />
                    </div>
                  </div>
                )}

                {/* Password field */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-600 leading-none">Password</label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setForgotStep("request");
                        }}
                        className="text-[11px] text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer"
                      >
                        Forgot Password?
                      </button>
                    )}
                    {mode === "signup" && password && (
                      <span className={`text-[10px] font-medium ${passwordStrength.labelColor}`}>
                        {passwordStrength.label}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder={mode === "signup" ? "Min. 8 characters" : "Enter your password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setPasswordTouched(true);
                      }}
                      className={`${inputClass} pr-8`}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {/* Interactive Micro-Meter & Requirements Checklist (Signup only) */}
                  {mode === "signup" && passwordTouched && password && (
                    <div className="pt-1.5 space-y-2">
                      {/* 4-bar thin meter */}
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((level) => (
                          <div
                            key={level}
                            className={`h-1 rounded-full transition-all duration-200 ${passwordStrength.strength >= level ? passwordStrength.color : "bg-slate-200/90"
                              }`}
                          />
                        ))}
                      </div>

                      {/* Interactive rule pills */}
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${reqLength
                              ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-700 font-medium"
                              : "bg-slate-50 border-slate-200/80 text-slate-400"
                            }`}
                        >
                          <Check className="w-2.5 h-2.5" /> 8+ chars
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${reqCases
                              ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-700 font-medium"
                              : "bg-slate-50 border-slate-200/80 text-slate-400"
                            }`}
                        >
                          <Check className="w-2.5 h-2.5" /> Upper & lower
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${reqNumOrSym
                              ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-700 font-medium"
                              : "bg-slate-50 border-slate-200/80 text-slate-400"
                            }`}
                        >
                          <Check className="w-2.5 h-2.5" /> Number or symbol
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password (Sign up only) */}
                {mode === "signup" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-slate-600 leading-none">Confirm password</label>
                      {confirmPasswordTouched && confirmPassword && (
                        passwordsMatch ? (
                          <span className="text-[10px] font-medium text-emerald-600 flex items-center gap-0.5">
                            <Check className="w-2.5 h-2.5" /> Matches
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-rose-500 flex items-center gap-0.5">
                            <X className="w-2.5 h-2.5" /> Doesn't match
                          </span>
                        )
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setConfirmPasswordTouched(true);
                        }}
                        className={`${inputClass} pr-8 ${confirmPasswordTouched && confirmPassword
                            ? passwordsMatch
                              ? "border-emerald-400/80 focus:border-emerald-500 focus:ring-emerald-500/15"
                              : "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15"
                            : ""
                          }`}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 transition-colors cursor-pointer"
                        tabIndex={-1}
                        aria-label="Toggle confirm password visibility"
                      >
                        {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline error or notice (Subtle faint border, no heavy box) */}
                {error && (
                  <div className="text-[12px] text-rose-700 bg-rose-50/70 border border-rose-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 shrink-0" />
                    <span className="flex-1">{error}</span>
                  </div>
                )}
                {notice && !error && (
                  <div className="text-[12px] text-emerald-700 bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                    <span className="flex-1">{notice}</span>
                  </div>
                )}

                {/* Primary Submit Button: Sharp, clean, shadowless */}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-9 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>{mode === "signin" ? "Sign In" : "Create Account"}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>

                {/* Clean Divider */}
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200/80"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                    <span className="bg-slate-50/80 px-2 text-slate-400 font-medium">Or</span>
                  </div>
                </div>

                {/* Google Sign-In / Sign-Up Button */}
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={busy}
                  className="w-full h-9 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <GoogleIcon />
                  <span>{mode === "signin" ? "Sign in with Google" : "Sign up with Google"}</span>
                </button>
              </form>

              {/* Bottom toggle helper */}
              <p className="text-center text-xs text-slate-500 mt-5">
                {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                  className="text-indigo-600 font-semibold hover:text-indigo-700 cursor-pointer ml-0.5"
                >
                  {mode === "signin" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </div>
          ) : (
            /* OTP Verification Step */
            <div>
              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  resetMessages();
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-4 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to credentials</span>
              </button>

              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 tracking-[-0.01em]">Check your email</h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  We sent a 6-digit confirmation code to <strong className="text-slate-800 font-medium">{email}</strong>.
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {/* 6-cell Digit Inputs */}
                <div className="flex gap-1.5 justify-center py-1">
                  {otpDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        otpRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={index === 0 ? handleOtpPaste : undefined}
                      className={`w-9 h-11 sm:w-10 sm:h-11 text-center text-base font-semibold rounded-lg border transition-all duration-150 ${digit
                          ? "border-slate-300 bg-slate-50/80 text-slate-900"
                          : "border-slate-200/90 bg-white text-slate-900 hover:border-slate-300"
                        } focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/15 focus:outline-none`}
                      autoComplete="off"
                    />
                  ))}
                </div>

                {error && (
                  <div className="text-[12px] text-rose-700 bg-rose-50/70 border border-rose-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1 shrink-0" />
                    <span className="flex-1">{error}</span>
                  </div>
                )}
                {notice && !error && (
                  <div className="text-[12px] text-emerald-700 bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-2 flex items-start gap-1.5 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                    <span className="flex-1">{notice}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || getOtpString().length !== 6}
                  className="w-full h-9 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify & Continue"}
                </button>
              </form>

              <div className="text-center text-xs text-slate-500 mt-4">
                Didn't receive code?{" "}
                {resendIn > 0 ? (
                  <span className="text-slate-400 font-mono text-[11px]">Resend in {resendIn}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={busy}
                    className="text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer disabled:opacity-50"
                  >
                    Resend code
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
