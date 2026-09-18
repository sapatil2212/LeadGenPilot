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
} from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);

  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendIn, setResendIn] = useState(0);

  // Forgot-password sub-flow: "none" | "request" | "reset"
  const [forgotStep, setForgotStep] = useState<"none" | "request" | "reset">("none");
  const [newPassword, setNewPassword] = useState("");

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "otp") setTimeout(() => otpInputRef.current?.focus(), 100);
  }, [step]);

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep("credentials");
    setOtp("");
    resetMessages();
  };

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { ok, data } = await postJson("/api/auth/signup", { name, email, password });
        if (!ok) {
          setError(data.error || "Sign up failed.");
          return;
        }
        setNotice(`We sent a 6-digit code to ${email}.`);
        setStep("otp");
        setResendIn(30);
      } else {
        const { ok, data } = await postJson("/api/auth/login", { email, password });
        if (!ok) {
          setError(data.error || "Sign in failed.");
          return;
        }
        if (data.requiresVerification) {
          setNotice(`Please verify your email. We sent a code to ${email}.`);
          setStep("otp");
          setResendIn(30);
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
    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/verify-otp", { email, code: otp, purpose: "verify" });
      if (!ok) {
        setError(data.error || "Verification failed.");
        return;
      }
      onAuthenticated(data.user);
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
        setError(data.error || "Could not send reset code.");
        return;
      }
      setNotice(`If an account exists for ${email}, a reset code has been sent.`);
      setForgotStep("reset");
      setResendIn(30);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/auth/reset-password", { email, code: otp, password: newPassword });
      if (!ok) {
        setError(data.error || "Could not reset password.");
        return;
      }
      // Return to sign-in with a success message.
      setForgotStep("none");
      setMode("signin");
      setStep("credentials");
      setOtp("");
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
      await postJson("/api/auth/forgot-password", { email });
      setNotice(`A new reset code was sent to ${email}.`);
      setResendIn(30);
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
        setError(data.error || "Could not resend the code.");
        return;
      }
      setNotice(`A new code was sent to ${email}.`);
      setResendIn(30);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputBase =
    "w-full rounded-xl border border-slate-200 bg-white pl-11 pr-3 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all";

  return (
    <div className="min-h-screen w-full flex items-stretch bg-slate-50 font-sans">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#0b1020]">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-indigo-600/30 blur-[110px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] rounded-full bg-violet-600/20 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center">
            <a
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to home</span>
            </a>
          </div>
          <div className="space-y-5 max-w-md">
            <h1 className="text-4xl font-bold leading-tight tracking-tight">
              Turn Google Maps into a <span className="text-indigo-400">pipeline of qualified leads.</span>
            </h1>
            <p className="text-slate-400 text-base leading-relaxed">
              Sign in to run AI-powered lead discovery, score prospects automatically, and launch
              multi-channel outreach campaigns.
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-400 pt-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Secured with email verification
            </div>
          </div>
          <span className="text-xs text-slate-500">© {new Date().getFullYear()} NexaLeadAi</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile Back to Home */}
          <div className="lg:hidden flex items-center mb-8">
            <a
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to home</span>
            </a>
          </div>

          {forgotStep !== "none" ? (
            /* Forgot / reset password flow */
            <>
              <button
                onClick={() => {
                  setForgotStep("none");
                  resetMessages();
                  setOtp("");
                  setNewPassword("");
                }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </button>

              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <Lock className="h-6 w-6 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Reset your password</h2>
                <p className="text-slate-500 text-sm mt-1.5">
                  {forgotStep === "request"
                    ? "Enter your email and we'll send you a reset code."
                    : `Enter the code sent to ${email} and choose a new password.`}
                </p>
              </div>

              {forgotStep === "request" ? (
                <form onSubmit={handleForgotRequest} className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputBase}
                      autoComplete="email"
                      required
                    />
                  </div>
                  {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</div>}
                  {notice && !error && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</div>}
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Send reset code"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full text-center tracking-[0.5em] text-2xl font-bold rounded-xl border border-slate-200 bg-white py-4 text-slate-800 placeholder-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    required
                  />
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="New password (min. 8 chars)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={`${inputBase} pr-11`}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                    </button>
                  </div>
                  {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</div>}
                  {notice && !error && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</div>}
                  <button
                    type="submit"
                    disabled={busy || otp.length !== 6}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Reset password"}
                  </button>
                  <p className="text-center text-sm text-slate-500">
                    Didn't receive it?{" "}
                    {resendIn > 0 ? (
                      <span className="text-slate-400">Resend in {resendIn}s</span>
                    ) : (
                      <button type="button" onClick={handleForgotResend} disabled={busy} className="text-indigo-600 font-semibold hover:text-indigo-500 cursor-pointer disabled:opacity-60">
                        Resend code
                      </button>
                    )}
                  </p>
                </form>
              )}
            </>
          ) : step === "credentials" ? (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="text-slate-500 text-sm mt-1.5">
                  {mode === "signin"
                    ? "Sign in to access your lead dashboard."
                    : "Start finding qualified leads in minutes."}
                </p>
              </div>

              {/* Mode toggle */}
              <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
                <button
                  onClick={() => switchMode("signin")}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                    mode === "signin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => switchMode("signup")}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                    mode === "signup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <form onSubmit={handleSubmitCredentials} className="space-y-4">
                {mode === "signup" && (
                  <div className="relative">
                    <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputBase}
                      autoComplete="name"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputBase}
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder={mode === "signup" ? "Create a password (min. 8 chars)" : "Password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputBase} pr-11`}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>

                {mode === "signin" && (
                  <div className="flex justify-end -mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        resetMessages();
                        setForgotStep("request");
                      }}
                      className="text-xs text-indigo-600 font-semibold hover:text-indigo-500 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {error && (
                  <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
                {notice && !error && (
                  <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    {notice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <>
                      {mode === "signin" ? "Sign In" : "Create Account"}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-6">
                {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
                <button
                  onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                  className="text-indigo-600 font-semibold hover:text-indigo-500 cursor-pointer"
                >
                  {mode === "signin" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </>
          ) : (
            /* OTP step */
            <>
              <button
                onClick={() => {
                  setStep("credentials");
                  resetMessages();
                }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>

              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <ShieldCheck className="h-6 w-6 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Verify your email</h2>
                <p className="text-slate-500 text-sm mt-1.5">
                  Enter the 6-digit code we sent to <strong className="text-slate-700">{email}</strong>.
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <input
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full text-center tracking-[0.5em] text-2xl font-bold rounded-xl border border-slate-200 bg-white py-4 text-slate-800 placeholder-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  required
                />

                {error && (
                  <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
                {notice && !error && (
                  <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    {notice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || otp.length !== 6}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : "Verify & Continue"}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-6">
                Didn't receive the code?{" "}
                {resendIn > 0 ? (
                  <span className="text-slate-400">Resend in {resendIn}s</span>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={busy}
                    className="text-indigo-600 font-semibold hover:text-indigo-500 cursor-pointer disabled:opacity-60"
                  >
                    Resend code
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
