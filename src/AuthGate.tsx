/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import App from "./App";
import { DialogProvider } from "./ui/DialogContext";
import AuthPage, { type AuthedUser } from "./AuthPage";

const SUPPORT_EMAIL = "leadgenpilot.in@gmail.com";
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 5 * 1000;
const LAST_ACTIVITY_STORAGE_KEY = "leadgenpilot_last_activity";
const RETURN_TO_STORAGE_KEY = "leadgenpilot_return_to";

function readPersistedActivity(): number {
  try {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function persistActivity(timestamp: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {}
}

function clearPersistedActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {}
}

function saveReturnPath(): void {
  if (typeof window === "undefined") return;
  const currentPath = window.location.pathname;
  if (currentPath.startsWith("/app/") && currentPath !== "/app") {
    try {
      sessionStorage.setItem(RETURN_TO_STORAGE_KEY, currentPath + window.location.search);
    } catch {}
  }
}

function restoreReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    const returnTo = sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    if (returnTo && returnTo.startsWith("/app/")) {
      sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
      window.history.replaceState(null, "", returnTo);
    }
  } catch {}
}

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

  const handleLogout = useCallback(async (reason?: "inactive" | "expired") => {
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

    clearPersistedActivity();
    saveReturnPath();

    const query =
      reason === "inactive"
        ? "?mode=signin&reason=inactive"
        : reason === "expired"
        ? "?mode=signin&reason=expired"
        : "?mode=signin";
    window.history.replaceState(null, "", `/app${query}`);

    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* The local auth gate remains closed if the server is unreachable. */
    } finally {
      logoutInProgressRef.current = false;
    }
  }, []);

  const checkSession = useCallback(async () => {
    // 1. Inactivity check: verify before attempting to mount dashboard or check session
    const persistedActivityAt = readPersistedActivity();
    const now = Date.now();
    if (persistedActivityAt > 0 && now - persistedActivityAt >= INACTIVITY_TIMEOUT_MS) {
      clearPersistedActivity();
      saveReturnPath();
      setUser(null);
      setEntitlements(null);
      setUsage(null);
      setWorkspace(null);
      setWorkspaces([]);
      setStatus("guest");
      window.history.replaceState(null, "", "/app?mode=signin&reason=inactive");
      void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
      return;
    }

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
        persistActivity(Date.now());

        // Restore previously requested dashboard route if any
        restoreReturnPath();

        setStatus(data.requiresWorkspaceSelection ? "workspace" : "authed");
        return;
      }

      const error = await res.json().catch(() => ({}));
      clearPersistedActivity();
      setUser(null);
      if (error.code === "account_suspended") {
        setStatus("suspended");
      } else if (res.status === 503) {
        setStatus("unavailable");
      } else {
        saveReturnPath();
        setStatus("guest");
        if (typeof window !== "undefined" && !window.location.search.includes("mode=signup")) {
          const reason = error.code === "invalid_session" ? "&reason=expired" : "";
          window.history.replaceState(null, "", `/app?mode=signin${reason}`);
        }
      }
    } catch {
      // Server unreachable — fail open to the auth page rather than a blank screen.
      clearPersistedActivity();
      setUser(null);
      setStatus("guest");
      if (typeof window !== "undefined" && !window.location.search.includes("mode=signup")) {
        window.history.replaceState(null, "", "/app?mode=signin");
      }
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Global handler for 401 Unauthorized API responses across the app
  useEffect(() => {
    const onUnauthorized = () => {
      void handleLogout("expired");
    };
    window.addEventListener("leadgenpilot:unauthorized", onUnauthorized);
    return () => window.removeEventListener("leadgenpilot:unauthorized", onUnauthorized);
  }, [handleLogout]);

  useEffect(() => {
    if (status !== "authed" && status !== "workspace") return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let localActivityAt = Date.now();
    let lastPersistedAt = Date.now();
    let activityHandledAt = 0;

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

    const handleUserActivity = () => {
      const now = Date.now();
      // First verify that session has not already timed out!
      if (now - latestActivityAt() >= INACTIVITY_TIMEOUT_MS) {
        expireSession();
        return;
      }
      if (now - activityHandledAt < 1000) return;
      activityHandledAt = now;
      localActivityAt = now;
      if (now - lastPersistedAt >= ACTIVITY_WRITE_THROTTLE_MS) {
        persistActivity(now);
        lastPersistedAt = now;
      }
      scheduleExpiry();
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

    // Immediate check on entering authed state
    const now = Date.now();
    const persistedActivityAt = readPersistedActivity();
    if (persistedActivityAt > 0 && now - persistedActivityAt >= INACTIVITY_TIMEOUT_MS) {
      localActivityAt = persistedActivityAt;
      expireSession();
      return;
    }

    localActivityAt = now;
    persistActivity(now);
    scheduleExpiry();

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "scroll",
      "touchstart",
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, handleUserActivity, { passive: true })
    );
    window.addEventListener("focus", handleUserActivity);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleUserActivity);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleUserActivity));
      window.removeEventListener("focus", handleUserActivity);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleUserActivity);
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
    <DialogProvider>
      <App
        currentUser={user}
        currentWorkspace={workspace}
        entitlements={entitlements}
        usage={usage}
        onLogout={handleLogout}
        onRefreshAccount={checkSession}
      />
    </DialogProvider>
  );
}
