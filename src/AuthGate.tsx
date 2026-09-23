/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import App from "./App";
import AuthPage, { type AuthedUser } from "./AuthPage";

type Status = "loading" | "authed" | "guest" | "workspace" | "unavailable";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

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
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setEntitlements(data.entitlements ?? null);
        setUsage(data.usage ?? null);
        setWorkspace(data.workspace ?? null);
        setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
        setStatus(data.requiresWorkspaceSelection ? "workspace" : "authed");
      } else if (res.status === 503 || res.status === 403) {
        setStatus("unavailable");
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
    setWorkspace(null);
    setWorkspaces([]);
    setStatus("guest");
  }, []);

  const handleWorkspaceSelect = useCallback(async (tenantId: string) => {
    setWorkspaceError("");
    try {
      const res = await fetch("/api/auth/select-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWorkspaceError(data.error || "Could not open that workspace.");
        return;
      }
      setStatus("loading");
      await checkSession();
    } catch {
      setWorkspaceError("Could not connect to the server. Please try again.");
    }
  }, [checkSession]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50/60 gap-2.5 font-sans">
        <Loader2 className="w-5 h-5 text-slate-700 animate-spin" />
        <div className="text-slate-500 text-[11px] font-medium tracking-wider uppercase">Loading workspace…</div>
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

  if (status === "unavailable") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/40 p-6 font-sans">
        <div className="w-full max-w-[360px] rounded-xl border border-amber-200/80 bg-white p-6 text-center shadow-none">
          <h1 className="text-base font-semibold text-slate-900 tracking-[-0.01em]">Authentication unavailable</h1>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">The database is not configured or cannot be reached. The dashboard remains locked to prevent unscoped data access.</p>
          <button onClick={checkSession} className="mt-4 w-full h-9 rounded-lg bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-800 transition-colors cursor-pointer">Try again</button>
        </div>
      </div>
    );
  }

  if (status === "workspace") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/40 p-6 font-sans">
        <div className="w-full max-w-[360px] rounded-xl border border-slate-200/90 bg-white p-6 shadow-none">
          <h1 className="text-base font-semibold text-slate-900 tracking-[-0.01em]">Choose a workspace</h1>
          <p className="mt-0.5 text-xs text-slate-500">Select the workspace you want to open.</p>
          <div className="mt-4 space-y-2">
            {workspaces.map((item) => (
              <button key={item.id} onClick={() => handleWorkspaceSelect(item.id)} className="w-full rounded-lg border border-slate-200/90 p-2.5 text-left hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer">
                <div className="text-xs font-semibold text-slate-900">{item.name}</div>
                <div className="text-[11px] capitalize text-slate-500">{item.role}</div>
              </button>
            ))}
          </div>
          {workspaceError && <p className="mt-3 text-xs text-rose-600">{workspaceError}</p>}
          <button onClick={handleLogout} className="mt-4 text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer">Sign out</button>
        </div>
      </div>
    );
  }

  // Only an authenticated user with a validated workspace reaches the app.
  return (
    <App
      currentUser={user}
      currentWorkspace={workspace}
      entitlements={entitlements}
      usage={usage}
      onLogout={handleLogout}
      onRefreshAccount={checkSession}
    />
  );
}
