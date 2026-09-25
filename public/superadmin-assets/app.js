/*
 * Superadmin console shell: session, navigation, and the page router.
 *
 * The server serves this same HTML for every /superadmin/dashboard/* URL and
 * excludes those paths from the SPA catch-all, so routing is entirely client
 * side here. Each nav entry maps a path segment to a page module on
 * window.Pages; navigating swaps the page, updates history, and gives the new
 * page a `ctx` with the platform currency, a navigate() and the query it was
 * opened with (used for deep links from KPI cards).
 *
 * Identity comes from /api/admin/me, which resolves the synthetic env-based
 * superadmin (no users row) as well as a real admin account. If that fails the
 * data endpoints would 401 anyway, so the Api layer sends the operator to the
 * login page; here we only need enough to render the header.
 */
(function (global) {
  "use strict";

  const { esc, icon, Api, Toast, Theme, qs, qsa, RedirectingError } = global.UI;
  const Pages = global.Pages;

  // Route table. `group` drives the sidebar sections; `key` is the URL segment.
  const NAV = [
    { group: "Overview", items: [{ key: "overview", label: "Dashboard", icon: "grid", path: "" }] },
    {
      group: "Customers",
      items: [
        { key: "users", label: "Users", icon: "users", path: "users" },
        { key: "tenants", label: "Workspaces", icon: "building", path: "tenants" },
        { key: "leads", label: "Leads", icon: "briefcase", path: "leads" },
      ],
    },
    {
      group: "Billing",
      items: [
        { key: "billing", label: "Revenue", icon: "trending", path: "billing" },
        { key: "subscriptions", label: "Subscriptions", icon: "repeat", path: "subscriptions" },
        { key: "invoices", label: "Invoices", icon: "receipt", path: "invoices" },
        { key: "payments", label: "Payments", icon: "card", path: "payments" },
        { key: "plans", label: "Plans", icon: "tag", path: "plans" },
      ],
    },
    {
      group: "Growth",
      items: [{ key: "visitors", label: "Traffic", icon: "eye", path: "visitors" }],
    },
    {
      group: "Platform",
      items: [
        { key: "flags", label: "Feature flags", icon: "flag", path: "flags" },
        { key: "announcements", label: "Announcements", icon: "megaphone", path: "announcements" },
        { key: "audit", label: "Audit log", icon: "file", path: "audit" },
        { key: "settings", label: "Settings", icon: "settings", path: "settings" },
        { key: "health", label: "System health", icon: "cpu", path: "health" },
      ],
    },
  ];

  const BASE = "/superadmin/dashboard";
  const flatNav = NAV.flatMap((section) => section.items);
  const byKey = Object.fromEntries(flatNav.map((item) => [item.key, item]));

  const state = { me: null, currency: "INR", active: null, current: null };
  const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
  const ACTIVITY_WRITE_THROTTLE_MS = 5 * 1000;
  const USER_ACTIVITY_STORAGE_KEY = "leadgenpilot_last_activity";
  const SUPERADMIN_ACTIVITY_STORAGE_KEY = "leadgenpilot_admin_last_activity";

  let activityStorageKey = SUPERADMIN_ACTIVITY_STORAGE_KEY;
  let inactivityTimer = null;
  let localActivityAt = 0;
  let lastPersistedAt = 0;
  let activityHandledAt = 0;
  let logoutInProgress = false;

  function pathFor(key) {
    const item = byKey[key];
    return item && item.path ? `${BASE}/${item.path}` : BASE;
  }

  function keyForPath(pathname) {
    const trimmed = pathname.replace(/\/+$/, "");
    const rest = trimmed.startsWith(BASE) ? trimmed.slice(BASE.length).replace(/^\//, "") : "";
    const match = flatNav.find((item) => item.path === rest);
    return match ? match.key : "overview";
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    Theme.init();

    try {
      state.me = await Api.get("/me");
    } catch (err) {
      // The Api layer has already sent the browser to /superadmin and thrown a
      // RedirectingError precisely so this catch does not paper over it — the
      // navigation is already in flight, so nothing below should render into a
      // page that is about to be torn down.
      if (err instanceof RedirectingError) return;
      // Any other failure (network blip, 500, migration_required): the console
      // can still render with a placeholder identity rather than being stuck on
      // the auth-gate spinner forever.
      state.me = { email: "Administrator", kind: "superadmin_console", environment: "" };
    }

    activityStorageKey =
      state.me.kind === "superadmin_console"
        ? SUPERADMIN_ACTIVITY_STORAGE_KEY
        : USER_ACTIVITY_STORAGE_KEY;

    // Best-effort platform currency for money formatting; falls back to INR.
    try {
      const settings = await Api.get("/platform/settings");
      const row = settings.rows.find((r) => r.key === "billing.currency");
      if (row && row.value) state.currency = String(row.value);
    } catch (err) {
      if (err instanceof RedirectingError) return;
      /* keep default currency */
    }

    if (!startInactivityTimer()) return;
    renderShell();
    window.addEventListener("popstate", () => activate(keyForPath(location.pathname), false));
    activate(keyForPath(location.pathname), false);
    const gate = qs("#authGate");
    if (gate) gate.style.display = "none";
  }

  // ── Shell ───────────────────────────────────────────────────────────────

  function renderShell() {
    const app = qs("#app");
    const initial = (state.me.email || "A").charAt(0).toUpperCase();

    app.innerHTML =
      `<aside class="sidebar" id="sidebar">` +
      `<div class="sidebar-brand">` +
      `<img class="brand-logo brand-logo--light" src="/logo.png" alt="LeadGenPilot" onerror="this.style.display='none'" />` +
      `<img class="brand-logo brand-logo--dark" src="/logo-dark.png" alt="LeadGenPilot" onerror="this.style.display='none'" />` +
      `<span class="brand-badge">Admin</span>` +
      `</div>` +
      `<nav class="sidebar-nav">` +
      NAV.map(
        (section) =>
          `<div class="nav-group-label">${esc(section.group)}</div>` +
          section.items
            .map(
              (item) =>
                `<a class="nav-item" href="${pathFor(item.key)}" data-nav="${item.key}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`
            )
            .join("")
      ).join("") +
      `</nav>` +
      `<div class="sidebar-footer">` +
      `<div class="admin-card"><div class="avatar">${esc(initial)}</div><div class="admin-meta"><div class="admin-email" title="${esc(state.me.email)}">${esc(state.me.email)}</div><div class="admin-role">${esc(state.me.kind === "superadmin_console" ? "Superadmin" : "Admin")}</div></div></div>` +
      `<button class="btn btn-sm" style="width:100%" data-logout>${icon("logout")} Sign out</button>` +
      `</div></aside>` +
      `<div class="scrim hidden" id="scrim"></div>` +
      `<div class="main">` +
      `<header class="topbar">` +
      `<button class="btn btn-ghost btn-icon sidebar-toggle" data-menu aria-label="Menu">${icon("menu")}</button>` +
      `<div><div class="topbar-title" id="pageTitle">Dashboard</div><div class="topbar-sub" id="pageSub"></div></div>` +
      `<div class="topbar-spacer"></div>` +
      `<span class="live-pill"><span class="live-dot"></span>Live</span>` +
      `<button class="btn btn-sm btn-icon" data-theme-toggle title="Toggle theme">${icon("sun")}</button>` +
      `<button class="btn btn-sm btn-icon" data-refresh title="Refresh">${icon("refresh")}</button>` +
      `</header>` +
      `<div class="page" id="page"></div>` +
      `</div>`;

    qsa("[data-nav]", app).forEach((link) => {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        activate(link.dataset.nav, true);
        closeSidebar();
      });
    });

    qs("[data-logout]", app).addEventListener("click", () => logout(false));
    qs("[data-refresh]", app).addEventListener("click", refreshCurrent);
    qs("[data-theme-toggle]", app).addEventListener("click", toggleTheme);
    qs("[data-menu]", app).addEventListener("click", () => qs("#sidebar").classList.toggle("open"));
    qs("#scrim", app).addEventListener("click", closeSidebar);
    syncThemeIcon();
  }

  function closeSidebar() {
    qs("#sidebar").classList.remove("open");
    qs("#scrim").classList.add("hidden");
  }

  function syncThemeIcon() {
    const button = qs("[data-theme-toggle]");
    if (button) button.innerHTML = icon(Theme.current() === "dark" ? "moon" : "sun");
  }

  function toggleTheme() {
    Theme.toggle();
    syncThemeIcon();
  }

  function refreshCurrent() {
    const button = qs("[data-refresh]");
    button.classList.add("spinning");
    setTimeout(() => button.classList.remove("spinning"), 700);
    if (state.current && typeof state.current.refresh === "function") state.current.refresh();
  }

  function readPersistedActivity() {
    try {
      const value = Number(localStorage.getItem(activityStorageKey));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) {
      return 0;
    }
  }

  function latestActivityAt() {
    return Math.max(localActivityAt, readPersistedActivity());
  }

  function scheduleInactivityExpiry() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - latestActivityAt());
    if (remaining <= 0) {
      void logout(true);
      return;
    }
    inactivityTimer = setTimeout(scheduleInactivityExpiry, remaining);
  }

  function persistActivity(timestamp, force) {
    if (!force && timestamp - lastPersistedAt < ACTIVITY_WRITE_THROTTLE_MS) return;
    try {
      localStorage.setItem(activityStorageKey, String(timestamp));
      lastPersistedAt = timestamp;
    } catch (_) {
      /* The in-memory timer still protects this tab. */
    }
  }

  function recordActivity() {
    const now = Date.now();
    if (now - activityHandledAt < 1000) return;
    activityHandledAt = now;
    localActivityAt = now;
    persistActivity(now, false);
    scheduleInactivityExpiry();
  }

  function checkElapsedBeforeRecordingActivity() {
    if (Date.now() - latestActivityAt() >= INACTIVITY_TIMEOUT_MS) {
      void logout(true);
      return;
    }
    recordActivity();
  }

  function startInactivityTimer() {
    const now = Date.now();
    const persistedActivityAt = readPersistedActivity();
    if (persistedActivityAt > 0 && now - persistedActivityAt >= INACTIVITY_TIMEOUT_MS) {
      localActivityAt = persistedActivityAt;
      void logout(true);
      return false;
    }

    localActivityAt = now;
    persistActivity(now, true);
    scheduleInactivityExpiry();

    ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    window.addEventListener("focus", checkElapsedBeforeRecordingActivity);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkElapsedBeforeRecordingActivity();
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== activityStorageKey) return;
      if (event.newValue === null) {
        void logout(true);
        return;
      }
      const timestamp = Number(event.newValue);
      if (Number.isFinite(timestamp) && timestamp > localActivityAt) {
        localActivityAt = timestamp;
        scheduleInactivityExpiry();
      }
    });
    return true;
  }

  async function logout(inactive) {
    if (logoutInProgress) return;
    logoutInProgress = true;
    if (inactivityTimer) clearTimeout(inactivityTimer);

    const isDedicatedSuperadmin = state.me && state.me.kind === "superadmin_console";
    const endpoint = isDedicatedSuperadmin ? "/api/superadmin/logout" : "/api/auth/logout";
    try {
      localStorage.removeItem(activityStorageKey);
    } catch (_) {
      /* ignore unavailable storage */
    }
    try {
      await fetch(endpoint, { method: "POST", credentials: "include" });
    } catch (_) {
      /* The browser still leaves the protected dashboard. */
    }
    sessionStorage.removeItem("superadmin_user");

    if (isDedicatedSuperadmin) {
      location.href = `/superadmin?signedout=1${inactive ? "&reason=inactive" : ""}`;
    } else {
      location.href = `/app?mode=signin${inactive ? "&reason=inactive" : ""}`;
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  async function activate(key, push, query) {
    if (!byKey[key]) key = "overview";
    const page = Pages[key];
    state.active = key;

    qsa("[data-nav]").forEach((link) => {
      const on = link.dataset.nav === key;
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    qs("#pageTitle").textContent = page.title;
    qs("#pageSub").textContent = page.subtitle || "";
    document.title = `${page.title} · LeadGenPilot Admin`;

    if (push && location.pathname.replace(/\/+$/, "") !== pathFor(key)) {
      history.pushState({ key }, "", pathFor(key));
    }

    const container = qs("#page");
    container.innerHTML = `<div class="col" style="gap:12px">${skeletonRow()}${skeletonRow()}</div>`;
    // Charts registered by the previous page must not fire their resize handlers
    // into a detached DOM; replacing #page's contents drops those references.
    state.current = null;

    const ctx = {
      currency: state.currency,
      me: state.me,
      navigate: (targetKey, targetQuery) => activate(targetKey, true, targetQuery),
      query: query || {},
    };

    try {
      state.current = (await page.render(container, ctx)) || null;
    } catch (err) {
      // A page's data call may have triggered the same sign-in redirect; let it
      // proceed silently instead of flashing an error into a page that is about
      // to be replaced by the browser navigating to /superadmin.
      if (err instanceof RedirectingError) return;
      container.innerHTML = `<div class="notice notice-error">${icon("alert")}<div><strong>Could not open this page.</strong><br>${esc(err.message || String(err))}</div></div>`;
      Toast.fromError(err);
    }
  }

  function skeletonRow() {
    return `<div class="card card-pad"><div class="skeleton" style="width:30%;height:16px;margin-bottom:14px"></div><div class="skeleton" style="width:100%;height:60px"></div></div>`;
  }

  // Expose a minimal API for the inline bootstrap and debugging.
  global.SuperAdmin = { boot, activate, state };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
