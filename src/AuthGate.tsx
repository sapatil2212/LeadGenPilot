/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import App from "./App";
import AuthPage, { type AuthedUser } from "./AuthPage";

type Status = "loading" | "authed" | "guest" | "disabled";

export interface Entitlements {
  planName: string;
  monthlyLeadLimit: number | null; // null = unlimited
  whatsappOutreach: boolean;
  aiInsights: boolean;
  prioritySupport: boolean;
  customIntegrations: boolean;
}

export interface UsageInfo {
  used: number;
  limit: number | null;
  remaining: number | null;
  period: string;
  unlimited: boolean;
}

/**
 * Gates the dashboard behind authentication.
 *
 * On mount it checks the current session via /api/auth/me:
 *  - 200          → authenticated, render the dashboard
 *  - 401          → not signed in, render the auth page
 *  - 503 (db off) → auth not configured yet, render the dashboard directly
 *                   so the app remains usable until DATABASE_URL is provided
 */
export default function AuthGate() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setEntitlements(data.entitlements ?? null);
        setUsage(data.usage ?? null);
        setStatus("authed");
      } else if (res.status === 503) {
        // Database/auth not configured — do not block usage.
        setStatus("disabled");
      } else {
        setStatus("guest");
      }
    } catch {
      // Server unreachable — fail open to the auth page rather than a blank screen.
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    setUser(null);
    setStatus("guest");
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-3 font-sans">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <div className="text-slate-500 text-xs font-semibold tracking-wide uppercase mt-1">Loading…</div>
      </div>
    );
  }

  if (status === "guest") {
    return (
      <AuthPage
        onAuthenticated={() => {
          // Re-hydrate full account context (entitlements + usage) after auth.
          setStatus("loading");
          checkSession();
        }}
      />
    );
  }

  // authed or disabled → render the dashboard
  return (
    <App
      currentUser={user}
      entitlements={entitlements}
      usage={usage}
      onLogout={status === "authed" ? handleLogout : undefined}
      onRefreshAccount={checkSession}
    />
  );
}
