/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import App from "./App";
import AuthPage, { type AuthedUser } from "./AuthPage";

const SUPPORT_EMAIL = "leadgenpilot.in@gmail.com";
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 5 * 1000;
const LAST_ACTIVITY_STORAGE_KEY = "leadgenpilot_last_activity";

type Status = "loading" | "authed" | "guest" | "workspace" | "suspended" | "unavailable";

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
 *  - 200                    → authenticated, render the dashboard
 *  - 401                    → not signed in, render the auth page
 *  - 403 account_suspended  → show the suspended-account contact screen
 *  - 503                    → authentication infrastructure is unavailable
 */
export default function AuthGate() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const logoutInProgressRef = useRef(false);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        logoutInProgressRef.current = false;

        // Platform administrators use the dedicated management dashboard.
        // Workspace owner/admin/member roles remain within the customer app.
        if (data.user?.role === "admin") {
          window.location.replace("/superadmin/dashboard");
          return;
        }

        setUser(data.user);
        setEntitlements(data.entitlements ?? null);
        setUsage(data.usage ?? null);
        setWorkspace(data.workspace ?? null);
        setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
        setStatus(data.requiresWorkspaceSelection ? "workspace" : "authed");
        return;
      }

      const error = await res.json().catch(() => ({}));
      if (error.code === "account_suspended") {
        setStatus("suspended");
      } else if (res.status === 503) {
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

  const handleLogout = useCallback(async (reason?: "inactive") => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;

    // Leave protected UI immediately; cookie invalidation can finish in the
    // background without keeping an expired dashboard visible.
    setUser(null);
    setEntitlements(null);
    setUsage(null);
    setWorkspace(null);
    setWorkspaces([]);
    setWorkspaceError("");
    setStatus("guest");
    window.history.replaceState(
      window.history.state,
      "",
      `/app?mode=signin${reason === "inactive" ? "&reason=inactive" : ""}`
    );
    try {
      localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    } catch {
      /* storage may be unavailable in privacy-restricted contexts */
    }

    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* The local auth gate remains closed if the server is unreachable. */
    }
  }, []);

  useEffect(() => {
    if (status !== "authed" && status !== "workspace") return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let localActivityAt = 0;
    let lastPersistedAt = 0;
    let activityHandledAt = 0;

    const readPersistedActivity = () => {
      try {
        const value = Number(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch {
        return 0;
      }
    };

    const latestActivityAt = () => Math.max(localActivityAt, readPersistedActivity());

    const expireSession = () => {
      if (logoutInProgressRef.current) return;
      void handleLogout("inactive");
    };

    const scheduleExpiry = () => {
      if (timeoutId) clearTimeout(timeoutId);
      const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - latestActivityAt());
      if (remaining <= 0) {
        expireSession();
        return;
      }
      timeoutId = setTimeout(scheduleExpiry, remaining);
    };

    const persistActivity = (timestamp: number, force = false) => {
      if (!force && timestamp - lastPersistedAt < ACTIVITY_WRITE_THROTTLE_MS) return;
      try {
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
        lastPersistedAt = timestamp;
      } catch {
        /* The in-memory timer still enforces inactivity for this tab. */
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      // Pointer movement can fire rapidly; one reset per second is sufficient.
      if (now - activityHandledAt < 1000) return;
      activityHandledAt = now;
      localActivityAt = now;
      persistActivity(now);
      scheduleExpiry();
    };

    const checkElapsedBeforeRecordingActivity = () => {
      if (Date.now() - latestActivityAt() >= INACTIVITY_TIMEOUT_MS) {
        expireSession();
        return;
      }
      recordActivity();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkElapsedBeforeRecordingActivity();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY) return;
      if (event.newValue === null) {
        // Another tab signed out, so close this tab's authenticated UI too.
        expireSession();
        return;
      }
      const timestamp = Number(event.newValue);
      if (Number.isFinite(timestamp) && timestamp > localActivityAt) {
        localActivityAt = timestamp;
        scheduleExpiry();
      }
    };

    // Preserve inactivity across reloads and browser suspension. A stale
    // authenticated cookie must not be revived merely by reopening the page.
    const now = Date.now();
    const persistedActivityAt = readPersistedActivity();
    if (persistedActivityAt > 0 && now - persistedActivityAt >= INACTIVITY_TIMEOUT_MS) {
      localActivityAt = persistedActivityAt;
      expireSession();
      return;
    }

    // With no stale activity record, reaching the authenticated page starts a
    // fresh ten-minute window. localStorage synchronizes it across tabs.
    localActivityAt = now;
    persistActivity(now, true);
    scheduleExpiry();

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "scroll",
      "touchstart",
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, recordActivity, { passive: true })
    );
    window.addEventListener("focus", checkElapsedBeforeRecordingActivity);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      window.removeEventListener("focus", checkElapsedBeforeRecordingActivity);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleLogout, status]);

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
          // A successful credential exchange starts a new inactivity window.
          try {
            localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
          } catch {
            /* The in-memory timer remains available when storage is blocked. */
          }
          // Re-hydrate full account context (entitlements + usage) after auth.
          setStatus("loading");
          checkSession();
        }}
      />
    );
  }

  if (status === "suspended") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/40 p-6 font-sans">
        <div className="w-full max-w-[360px] rounded-xl border border-rose-200/80 bg-white p-6 text-center shadow-none">
          <h1 className="text-base font-semibold text-slate-900 tracking-[-0.01em]">Account suspended</h1>
          <p className="mt-1.5 text-xs text-slate-600">
            Contact support at <span className="font-medium text-slate-800">{SUPPORT_EMAIL}</span> to restore access.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Suspended%20account%20support`}
            className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800"
          >
            Email support
          </a>
        </div>
      </div>
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
