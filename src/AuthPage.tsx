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

  // Password validation states
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
    if (step === "otp") setTimeout(() => otpRefs.current[0]?.focus(), 100);
  }, [step]);

  // Password strength check
  const getPasswordStrength = (pwd: string): { strength: number; label: string; color: string } => {
    if (!pwd) return { strength: 0, label: "", color: "" };
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd)) strength++;
    if (/[^a-zA-Z0-9]/.test(pwd)) strength++;

    if (strength <= 1) return { strength: 1, label: "Weak", color: "bg-red-500" };
    if (strength <= 3) return { strength: 2, label: "Fair", color: "bg-yellow-500" };
    if (strength <= 4) return { strength: 3, label: "Good", color: "bg-blue-500" };
    return { strength: 4, label: "Strong", color: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength(password);
  const passwordsMatch = confirmPassword && password === confirmPassword;
  const passwordsDontMatch = confirmPassword && password !== confirmPassword;

  // Handle OTP digit input
  const handleOtpChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1);

    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);

    // Auto-focus next input
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

    // Focus the next empty field or last field
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

    // Validation for signup
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
      setNotice("Email verified successfully. Sign in to open your workspace.");
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
      // Return to sign-in with a success message.
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
      await postJson("/api/auth/forgot-password", { email });
      setNotice(`A new reset code was sent to ${email}.`);
      setOtpDigits(["", "", "", "", "", ""]);
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
      setOtpDigits(["", "", "", "", "", ""]);
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
          <span className="text-xs text-slate-500">Copyright © 2026 BookMyTime All rights reserved. | A product of Brightwave Digital Products LLP.</span>
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
                  setOtpDigits(["", "", "", "", "", ""]);
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
                  {/* Animated OTP Input Boxes */}
                  <div className="flex gap-2 justify-center">
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
                        className={`w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 transition-all duration-200 ${
                          digit
                            ? "border-indigo-500 bg-indigo-50 text-indigo-900 scale-105"
                            : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                        } focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20`}
                        autoComplete="off"
                      />
                    ))}
                  </div>

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
                  {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">{error}</div>}
                  {notice && !error && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">{notice}</div>}
                  <button
                    type="submit"
                    disabled={busy || getOtpString().length !== 6}
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
                      required
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

                {mode === "signup" && (
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type="tel"
                      placeholder="Phone (with country code, e.g., +91XXXXXXXXXX)"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputBase}
                      autoComplete="tel"
                    />
                  </div>
                )}

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder={mode === "signup" ? "Create a password (min. 8 chars)" : "Password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordTouched(true);
                    }}
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

                {mode === "signup" && passwordTouched && password && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">Password strength:</span>
                      <span className={`font-semibold ${
                        passwordStrength.strength === 1 ? "text-red-600" :
                        passwordStrength.strength === 2 ? "text-yellow-600" :
                        passwordStrength.strength === 3 ? "text-blue-600" :
                        "text-green-600"
                      }`}>
                        {passwordStrength.label}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${passwordStrength.color} transition-all duration-300 ease-out`}
                        style={{ width: `${(passwordStrength.strength / 4) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {mode === "signup" && (
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setConfirmPasswordTouched(true);
                      }}
                      className={`${inputBase} pr-11 ${
                        confirmPasswordTouched && passwordsMatch ? "border-green-500 focus:border-green-500 focus:ring-green-500/20" :
                        confirmPasswordTouched && passwordsDontMatch ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" :
                        ""
                      }`}
                      autoComplete="new-password"
                      required
                    />
                    <div className="absolute right-11 top-1/2 -translate-y-1/2">
                      {confirmPasswordTouched && passwordsMatch && (
                        <Check className="h-4.5 w-4.5 text-green-600 animate-in zoom-in duration-200" />
                      )}
                      {confirmPasswordTouched && passwordsDontMatch && (
                        <X className="h-4.5 w-4.5 text-red-600 animate-in zoom-in duration-200" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((s) => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                    </button>
                  </div>
                )}

                {mode === "signup" && confirmPasswordTouched && passwordsDontMatch && (
                  <div className="text-xs text-red-600 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <X className="h-3.5 w-3.5" />
                    <span>Passwords do not match</span>
                  </div>
                )}

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

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-slate-50 px-2 text-slate-500">Or continue with</span>
                  </div>
                </div>

                {/* Quick Dev Sign-In Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setEmail("swapnilpatil221298@gmail.com");
                      setPassword("password123");
                      setBusy(true);
                      resetMessages();
                      try {
                        const { ok, data } = await postJson("/api/auth/login", {
                          email: "swapnilpatil221298@gmail.com",
                          password: "password123",
                        });
                        if (ok && data.user) {
                          onAuthenticated(data.user);
                        } else {
                          setError(data.error || "Quick sign-in failed.");
                        }
                      } catch {
                        setError("Could not reach the server.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/80 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20 transition-all cursor-pointer shadow-xs btn-interactive"
                  >
                    <span>⚡ Quick Sign-In as Swapnil Patil</span>
                    <span className="text-[10px] font-normal opacity-75">(1-Click Dev Access)</span>
                  </button>
                </div>
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
                {/* Animated OTP Input Boxes */}
                <div className="flex gap-2 justify-center">
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
                      className={`w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 transition-all duration-200 ${
                        digit
                          ? "border-indigo-500 bg-indigo-50 text-indigo-900 scale-105"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                      } focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20`}
                      autoComplete="off"
                    />
                  ))}
                </div>

                {error && (
                  <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {error}
                  </div>
                )}
                {notice && !error && (
                  <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {notice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || getOtpString().length !== 6}
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
