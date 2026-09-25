/*
 * Superadmin console UI kit.
 *
 * Contains the five things every page here needs, so no page reimplements them:
 *
 *   Api     fetch wrapper with one place that handles 401, validation errors and
 *           the "migration not applied" case
 *   Fmt     formatters — money in minor units, dates, relative time, bytes
 *   Toast   transient feedback
 *   Modal   dialogs, confirmations and schema-driven forms
 *   Table   the data table: multi-select, sortable columns, filters, paging,
 *           bulk actions, row actions and exports
 *
 * `Table` is the load-bearing piece. Fourteen pages need the same table
 * behaviour, and the only way that behaviour stays consistent — checkbox
 * semantics, indeterminate header state, sort indicators, selection surviving a
 * refetch, a disabled bulk bar while a request is in flight — is for it to exist
 * once and be configured, not copied.
 *
 * All rendering goes through `esc()`. Every value on these pages is
 * operator-supplied or customer-supplied text (business names, notes, emails),
 * and the tables are built by string concatenation, so escaping is not optional.
 */
(function (global) {
  "use strict";

  // ── Escaping + small helpers ───────────────────────────────────────────────

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  function attr(value) {
    return esc(value).replace(/\n/g, " ");
  }

  const qs = (selector, root) => (root || document).querySelector(selector);
  const qsa = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Feather-style icon set, inlined so the console needs no icon font. */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronUp: '<polyline points="18 15 12 9 6 15"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
    receipt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    tag: '<path d="M20.6 13.4L12 22l-9-9V4a1 1 0 0 1 1-1h9l8.6 8.6a1 1 0 0 1 0 1.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.61.67 1.06 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    key: '<path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 0-7 7 5 5 0 0 0 7-7zm0 0L15 8m0 0l3 3 3-3-3-3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    filter: '<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.5h13l3.5 6.5v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2 7 12 14 22 7"/>',
  };

  function icon(name, className) {
    const path = ICONS[name] || ICONS.info;
    return `<svg viewBox="0 0 24 24"${className ? ` class="${attr(className)}"` : ""} aria-hidden="true">${path}</svg>`;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  const CURRENCY_SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$", AUD: "A$", CAD: "C$" };

  const Fmt = {
    /**
     * Money from minor units.
     *
     * The API stores and returns integers (paise/cents); dividing by 100 happens
     * here and nowhere else, so no other code can accidentally treat a stored
     * amount as rupees.
     */
    money(minorUnits, currency, opts) {
      const options = opts || {};
      const value = (Number(minorUnits) || 0) / 100;
      const symbol = CURRENCY_SYMBOLS[currency || "INR"] || `${currency} `;
      if (options.compact && Math.abs(value) >= 100000) {
        return symbol + new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
      }
      return (
        symbol +
        new Intl.NumberFormat("en-IN", {
          minimumFractionDigits: options.decimals === false ? 0 : 2,
          maximumFractionDigits: options.decimals === false ? 0 : 2,
        }).format(value)
      );
    },

    /** Rupees typed into a form back to the integer minor units the API wants. */
    toMinor(displayValue) {
      const n = Number(String(displayValue ?? "").replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(n)) return 0;
      return Math.round(n * 100);
    },

    fromMinor(minorUnits) {
      return (Number(minorUnits) || 0) / 100;
    },

    num(value) {
      return new Intl.NumberFormat("en-US").format(Number(value) || 0);
    },

    compact(value) {
      const n = Number(value) || 0;
      return Math.abs(n) >= 10000
        ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
        : new Intl.NumberFormat("en-US").format(n);
    },

    percent(value, decimals) {
      const n = Number(value) || 0;
      return `${n.toFixed(decimals === undefined ? 1 : decimals)}%`;
    },

    date(value) {
      if (!value) return "—";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    },

    dateTime(value) {
      if (!value) return "—";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    },

    /** `<input type="date">` needs exactly YYYY-MM-DD. */
    dateInput(value) {
      if (!value) return "";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 10);
    },

    ago(value) {
      if (!value) return "—";
      const then = new Date(value).getTime();
      if (Number.isNaN(then)) return "—";
      const seconds = Math.floor((Date.now() - then) / 1000);
      if (seconds < 0) return Fmt.inFuture(value);
      if (seconds < 45) return "just now";
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
      if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
      return `${Math.floor(seconds / 31536000)}y ago`;
    },

    inFuture(value) {
      const seconds = Math.floor((new Date(value).getTime() - Date.now()) / 1000);
      if (seconds < 60) return "in moments";
      if (seconds < 3600) return `in ${Math.floor(seconds / 60)}m`;
      if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`;
      if (seconds < 2592000) return `in ${Math.floor(seconds / 86400)}d`;
      return `in ${Math.floor(seconds / 2592000)}mo`;
    },

    duration(seconds) {
      const s = Number(seconds) || 0;
      const days = Math.floor(s / 86400);
      const hours = Math.floor((s % 86400) / 3600);
      const minutes = Math.floor((s % 3600) / 60);
      if (days) return `${days}d ${hours}h`;
      if (hours) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    },

    /** Turns `past_due` / `admin_updated_user` into readable text. */
    title(value) {
      return String(value ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    },

    limit(value) {
      return Number(value) < 0 ? "Unlimited" : Fmt.num(value);
    },
  };

  // ── API ────────────────────────────────────────────────────────────────────

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  /**
   * Thrown after a redirect to the login page has already been kicked off.
   *
   * Setting `location.href` does not stop the current script from running —
   * navigation happens on the next tick — so without a distinct, unhandled
   * signal here, callers of Api.get() carry on with no session and hit `null`
   * DOM lookups in whatever renders next. Callers should let this propagate
   * rather than catching it and rendering a fallback.
   */
  class RedirectingError extends Error {
    constructor() {
      super("Redirecting to sign in.");
      this.redirecting = true;
    }
  }

  const Api = {
    base: "/api/admin",

    /** Serialises params, dropping empties so the server sees no blank filters. */
    url(path, params) {
      const full = path.startsWith("/api") ? path : Api.base + path;
      if (!params) return full;
      const search = new URLSearchParams();
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value === undefined || value === null || value === "" || value === false) return;
        search.set(key, String(value));
      });
      const query = search.toString();
      return query ? `${full}${full.includes("?") ? "&" : "?"}${query}` : full;
    },

    async request(method, path, { params, body } = {}) {
      let response;
      try {
        response = await fetch(Api.url(path, params), {
          method,
          credentials: "include",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        throw new ApiError(0, "network", "Could not reach the server. Check your connection and try again.");
      }

      // A lost session is not an error the caller should have to handle: the only
      // sensible response is to send the operator back to the login page.
      if (response.status === 401 || response.status === 403) {
        let payload = null;
        try {
          payload = await response.json();
        } catch (_) {
          /* not JSON */
        }
        const code = payload && payload.code;
        if (code === "no_session" || code === "invalid_session" || code === "not_admin") {
          global.location.href = "/superadmin";
          throw new RedirectingError();
        }
        throw new ApiError(response.status, code || "forbidden", (payload && payload.error) || "Not permitted.", payload && payload.details);
      }

      if (response.status === 204) return null;

      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_) {
          payload = { error: text.slice(0, 400) };
        }
      }

      if (!response.ok) {
        throw new ApiError(
          response.status,
          (payload && payload.code) || `http_${response.status}`,
          (payload && payload.error) || `Request failed (HTTP ${response.status}).`,
          payload && payload.details
        );
      }
      return payload;
    },

    get: (path, params) => Api.request("GET", path, { params }),
    post: (path, body, params) => Api.request("POST", path, { body, params }),
    patch: (path, body) => Api.request("PATCH", path, { body }),
    put: (path, body) => Api.request("PUT", path, { body }),
    del: (path, params) => Api.request("DELETE", path, { params }),

    /**
     * Triggers a server-side CSV download.
     *
     * Fetched as a blob rather than navigated to, so the cookie is sent with
     * `credentials: include` and a 503 (migration missing) surfaces as a toast
     * instead of replacing the console with an error page.
     */
    async download(path, params, filename) {
      const response = await fetch(Api.url(path, params), { credentials: "include" });
      if (!response.ok) {
        let message = `Export failed (HTTP ${response.status}).`;
        try {
          const payload = await response.json();
          if (payload && payload.error) message = payload.error;
        } catch (_) {
          /* not JSON */
        }
        throw new ApiError(response.status, "export_failed", message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = /filename="?([^"]+)"?/.exec(disposition);
      saveBlob(blob, filename || (match && match[1]) || "export.csv");
    },
  };

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── Toasts ─────────────────────────────────────────────────────────────────

  const Toast = {
    show(message, kind, title) {
      let host = qs("#toasts");
      if (!host) {
        host = document.createElement("div");
        host.id = "toasts";
        document.body.appendChild(host);
      }
      const node = document.createElement("div");
      const tone = kind || "info";
      node.className = `toast toast-${tone}`;
      node.setAttribute("role", tone === "error" ? "alert" : "status");
      const iconName = tone === "success" ? "check" : tone === "error" ? "alert" : tone === "warn" ? "alert" : "info";
      node.innerHTML =
        `<span class="toast-icon">${icon(iconName)}</span>` +
        `<div class="toast-body">${title ? `<div class="toast-title">${esc(title)}</div>` : ""}${esc(message)}</div>`;
      host.appendChild(node);

      // Errors linger: they usually carry a sentence the operator needs to read.
      const life = tone === "error" ? 8000 : 3800;
      setTimeout(() => {
        node.classList.add("leaving");
        setTimeout(() => node.remove(), 200);
      }, life);
    },
    success: (m, t) => Toast.show(m, "success", t),
    error: (m, t) => Toast.show(m, "error", t),
    warn: (m, t) => Toast.show(m, "warn", t),
    info: (m, t) => Toast.show(m, "info", t),

    /** Renders an ApiError with the wording the server chose. */
    fromError(err, fallback) {
      // The browser is already navigating to the login page; a toast that
      // outlives the page it was meant for is just noise.
      if (err && err.redirecting) return;
      const message = (err && err.message) || fallback || "Something went wrong.";
      if (err && err.code === "migration_required") {
        Toast.error(message, "Database migration needed");
        return;
      }
      Toast.error(message);
    },
  };

  // ── Modal ──────────────────────────────────────────────────────────────────

  const Modal = {
    stack: [],

    open({ title, subtitle, body, footer, size, onMount, onClose, closeOnBackdrop = true }) {
      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.innerHTML =
        `<div class="modal ${size ? `modal-${size}` : ""}" role="dialog" aria-modal="true">` +
        `<div class="modal-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>` +
        `<button class="btn btn-ghost btn-icon modal-close" type="button" aria-label="Close">${icon("x")}</button></div>` +
        `<div class="modal-body">${body || ""}</div>` +
        (footer === null ? "" : `<div class="modal-foot">${footer || ""}</div>`) +
        `</div>`;

      document.body.appendChild(overlay);
      document.body.style.overflow = "hidden";

      const handle = {
        overlay,
        root: qs(".modal", overlay),
        body: qs(".modal-body", overlay),
        foot: qs(".modal-foot", overlay),
        close() {
          const index = Modal.stack.indexOf(handle);
          if (index >= 0) Modal.stack.splice(index, 1);
          overlay.remove();
          if (!Modal.stack.length) document.body.style.overflow = "";
          document.removeEventListener("keydown", onKey);
          if (onClose) onClose();
        },
      };

      function onKey(event) {
        // Only the topmost dialog reacts, so Escape inside a confirm opened from a
        // form does not close both.
        if (event.key === "Escape" && Modal.stack[Modal.stack.length - 1] === handle) {
          event.stopPropagation();
          handle.close();
        }
      }

      qs(".modal-close", overlay).addEventListener("click", handle.close);
      if (closeOnBackdrop) {
        overlay.addEventListener("mousedown", (event) => {
          if (event.target === overlay) handle.close();
        });
      }
      document.addEventListener("keydown", onKey);
      Modal.stack.push(handle);

      if (onMount) onMount(handle);
      // Focus the first control so the dialog is immediately usable by keyboard.
      const focusable = qs("input:not([type=hidden]), select, textarea, button.btn-primary", overlay);
      if (focusable) setTimeout(() => focusable.focus(), 40);

      return handle;
    },

    /**
     * Confirmation dialog.
     *
     * `requireText` makes the operator type a value (a slug, "DELETE") before the
     * button enables — used for the deletes that cascade.
     */
    confirm({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, requireText = null, onConfirm }) {
      return new Promise((resolve) => {
        const handle = Modal.open({
          title,
          size: null,
          body:
            `<div style="font-size:0.84rem;line-height:1.6;color:var(--text-secondary)">${message}</div>` +
            (requireText
              ? `<div class="field mt-2"><label class="field-label" for="confirmText">Type <code class="mono strong">${esc(requireText)}</code> to confirm</label>` +
                `<input class="input" id="confirmText" autocomplete="off" spellcheck="false" /></div>`
              : ""),
          footer:
            `<button class="btn" data-act="cancel" type="button">${esc(cancelLabel)}</button>` +
            `<button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok" type="button"${requireText ? " disabled" : ""}>${esc(confirmLabel)}</button>`,
          onClose: () => resolve(false),
        });

        const okButton = qs('[data-act="ok"]', handle.overlay);
        if (requireText) {
          const input = qs("#confirmText", handle.overlay);
          input.addEventListener("input", () => {
            okButton.disabled = input.value.trim() !== requireText;
          });
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !okButton.disabled) okButton.click();
          });
        }

        qs('[data-act="cancel"]', handle.overlay).addEventListener("click", handle.close);
        okButton.addEventListener("click", async () => {
          okButton.disabled = true;
          okButton.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:1.8px"></span> Working…';
          try {
            if (onConfirm) await onConfirm();
            handle.overlay.remove();
            const index = Modal.stack.indexOf(handle);
            if (index >= 0) Modal.stack.splice(index, 1);
            if (!Modal.stack.length) document.body.style.overflow = "";
            resolve(true);
          } catch (err) {
            Toast.fromError(err);
            okButton.disabled = false;
            okButton.textContent = confirmLabel;
          }
        });
      });
    },

    /**
     * Schema-driven form.
     *
     * Field kinds: text, email, password, number, money, date, datetime, select,
     * textarea, checkbox, remote-select, lineitems, static.
     *
     * `onSubmit(values)` may throw; a thrown ApiError with `details.field` is
     * shown against that field, everything else becomes a toast. The dialog stays
     * open on failure so the operator does not lose what they typed — the main
     * reason this is a shared component rather than per-page markup.
     */
    form({ title, subtitle, fields, submitLabel = "Save", size, onSubmit, extraFooter }) {
      const spec = fields.filter(Boolean);

      const body = `<form id="modalForm" novalidate>${spec.map(renderField).join("")}</form>`;
      const handle = Modal.open({
        title,
        subtitle,
        size,
        body,
        footer:
          (extraFooter || "") +
          `<div class="spacer"></div><button class="btn" type="button" data-act="cancel">Cancel</button>` +
          `<button class="btn btn-primary" type="button" data-act="submit">${esc(submitLabel)}</button>`,
        onMount(h) {
          spec.forEach((field) => {
            if (field.type === "remote-select") wireRemoteSelect(h.overlay, field);
            if (field.type === "lineitems") wireLineItems(h.overlay, field);
          });
        },
      });

      const submitButton = qs('[data-act="submit"]', handle.overlay);
      qs('[data-act="cancel"]', handle.overlay).addEventListener("click", handle.close);

      async function submit() {
        qsa(".field-error", handle.overlay).forEach((n) => n.remove());

        let values;
        try {
          values = collectValues(handle.overlay, spec);
        } catch (err) {
          if (err && err.field) {
            showFieldError(handle.overlay, err.field, err.message);
            return;
          }
          Toast.error((err && err.message) || "Please check the form.");
          return;
        }

        submitButton.disabled = true;
        const original = submitButton.textContent;
        submitButton.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:1.8px"></span> Saving…';
        try {
          await onSubmit(values, handle);
          handle.close();
        } catch (err) {
          if (err && err.details && err.details.field) showFieldError(handle.overlay, err.details.field, err.message);
          else Toast.fromError(err);
          submitButton.disabled = false;
          submitButton.textContent = original;
        }
      }

      submitButton.addEventListener("click", submit);
      qs("#modalForm", handle.overlay).addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
      });
      // Enter submits from any single-line input, but not from a textarea.
      qsa("#modalForm input", handle.overlay).forEach((input) => {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        });
      });

      return handle;
    },
  };

  function showFieldError(root, name, message) {
    const wrapper = qs(`[data-field="${name}"]`, root);
    if (!wrapper) {
      Toast.error(message);
      return;
    }
    const error = document.createElement("div");
    error.className = "field-error";
    error.textContent = message;
    wrapper.appendChild(error);
    const input = qs("input,select,textarea", wrapper);
    if (input) input.focus();
  }

  function renderField(field) {
    if (field.type === "hidden") return `<input type="hidden" name="${attr(field.name)}" value="${attr(field.value ?? "")}" />`;

    const id = `f_${field.name}`;
    const label = field.label
      ? `<label class="field-label" for="${id}">${esc(field.label)}${field.required ? '<span class="req">*</span>' : ""}</label>`
      : "";
    const help = field.help ? `<div class="field-help">${field.help}</div>` : "";
    let control = "";

    switch (field.type) {
      case "static":
        control = `<div class="small" style="padding:6px 0">${field.value ?? ""}</div>`;
        break;

      case "select":
        control =
          `<select class="select" id="${id}" name="${attr(field.name)}"${field.disabled ? " disabled" : ""}>` +
          (field.placeholder ? `<option value="">${esc(field.placeholder)}</option>` : "") +
          (field.options || [])
            .map((option) => {
              const value = option.value !== undefined ? option.value : option;
              const text = option.label !== undefined ? option.label : Fmt.title(value);
              const selected = String(field.value ?? "") === String(value) ? " selected" : "";
              return `<option value="${attr(value)}"${selected}>${esc(text)}</option>`;
            })
            .join("") +
          `</select>`;
        break;

      case "textarea":
        control = `<textarea class="textarea" id="${id}" name="${attr(field.name)}" rows="${field.rows || 4}" placeholder="${attr(field.placeholder || "")}">${esc(field.value ?? "")}</textarea>`;
        break;

      case "checkbox":
        return (
          `<div class="field" data-field="${attr(field.name)}"><label class="row" style="cursor:pointer;gap:9px">` +
          `<input class="check" type="checkbox" id="${id}" name="${attr(field.name)}"${field.value ? " checked" : ""} />` +
          `<span><span class="field-label" style="margin:0">${esc(field.label)}</span>${field.help ? `<div class="field-help" style="margin-top:2px">${field.help}</div>` : ""}</span>` +
          `</label></div>`
        );

      case "money":
        control =
          `<div class="row"><span class="muted small" style="min-width:16px">${esc(CURRENCY_SYMBOLS[field.currency || "INR"] || "")}</span>` +
          `<input class="input" id="${id}" name="${attr(field.name)}" type="number" step="0.01" min="0" ` +
          `value="${attr(field.value !== undefined && field.value !== null && field.value !== "" ? Fmt.fromMinor(field.value) : "")}" ` +
          `placeholder="${attr(field.placeholder || "0.00")}" /></div>`;
        break;

      case "remote-select":
        control =
          `<div data-remote="${attr(field.name)}">` +
          `<input type="hidden" name="${attr(field.name)}" value="${attr(field.value ?? "")}" />` +
          `<input class="input" id="${id}" autocomplete="off" placeholder="${attr(field.placeholder || "Search…")}" value="${attr(field.valueLabel || "")}" />` +
          `<div class="card" data-results hidden style="position:absolute;z-index:5;max-height:200px;overflow-y:auto;width:calc(100% - 36px);margin-top:2px;box-shadow:var(--shadow-md)"></div>` +
          `</div>`;
        break;

      case "lineitems":
        control =
          `<div data-lineitems="${attr(field.name)}">` +
          `<div data-rows class="col" style="gap:6px"></div>` +
          `<button class="btn btn-sm mt-1" type="button" data-add>${icon("plus")} Add line</button>` +
          `<div class="row mt-1" style="justify-content:flex-end;font-size:0.78rem"><span class="muted">Subtotal:&nbsp;</span><strong data-subtotal class="nums">—</strong></div>` +
          `</div>`;
        break;

      default:
        control =
          `<input class="input" id="${id}" name="${attr(field.name)}" type="${attr(field.type || "text")}" ` +
          `value="${attr(field.value ?? "")}" placeholder="${attr(field.placeholder || "")}"` +
          (field.min !== undefined ? ` min="${attr(field.min)}"` : "") +
          (field.max !== undefined ? ` max="${attr(field.max)}"` : "") +
          (field.step !== undefined ? ` step="${attr(field.step)}"` : "") +
          (field.autocomplete ? ` autocomplete="${attr(field.autocomplete)}"` : "") +
          (field.disabled ? " disabled" : "") +
          ` />`;
    }

    return `<div class="field" data-field="${attr(field.name)}" style="position:relative">${label}${control}${help}</div>`;
  }

  function collectValues(root, spec) {
    const values = {};
    spec.forEach((field) => {
      if (field.type === "static") return;
      const wrapper = qs(`[data-field="${field.name}"]`, root) || root;

      if (field.type === "checkbox") {
        values[field.name] = !!qs(`[name="${field.name}"]`, root).checked;
        return;
      }

      if (field.type === "lineitems") {
        const rows = qsa("[data-row]", wrapper).map((row) => ({
          description: qs("[data-desc]", row).value.trim(),
          quantity: Number(qs("[data-qty]", row).value) || 1,
          unitAmount: Fmt.toMinor(qs("[data-unit]", row).value),
        }));
        const usable = rows.filter((r) => r.description);
        if (field.required && !usable.length) {
          const error = new Error("Add at least one line item.");
          error.field = field.name;
          throw error;
        }
        values[field.name] = usable;
        return;
      }

      const input = qs(`[name="${field.name}"]`, root);
      if (!input) return;
      let value = input.value;

      if (typeof value === "string") value = value.trim();

      if (field.required && !value) {
        const error = new Error(`${field.label || Fmt.title(field.name)} is required.`);
        error.field = field.name;
        throw error;
      }

      if (field.type === "money") {
        values[field.name] = value === "" ? undefined : Fmt.toMinor(value);
        return;
      }
      if (field.type === "number") {
        values[field.name] = value === "" ? undefined : Number(value);
        return;
      }
      values[field.name] = value === "" ? (field.emptyAsNull ? null : "") : value;
    });
    return values;
  }

  /** Type-ahead backed by an endpoint, used for the customer pickers. */
  function wireRemoteSelect(root, field) {
    const host = qs(`[data-remote="${field.name}"]`, root);
    if (!host) return;
    const hidden = qs('input[type="hidden"]', host);
    const input = qs("input.input", host);
    const results = qs("[data-results]", host);

    const search = debounce(async () => {
      const term = input.value.trim();
      try {
        const payload = await Api.get(field.endpoint, { search: term });
        const rows = (payload && (payload.rows || payload.items)) || [];
        if (!rows.length) {
          results.innerHTML = '<div class="empty small" style="padding:14px">No matches.</div>';
        } else {
          results.innerHTML = rows
            .map(
              (row) =>
                `<button class="palette-item" type="button" data-id="${attr(row.id)}" data-label="${attr(field.labelOf ? field.labelOf(row) : row.email || row.name || row.id)}">` +
                `<span>${esc(field.labelOf ? field.labelOf(row) : row.email || row.name || row.id)}</span>` +
                (row.plan ? `<span class="palette-hint">${esc(row.plan)}</span>` : "") +
                `</button>`
            )
            .join("");
        }
        results.hidden = false;
        qsa("[data-id]", results).forEach((button) => {
          button.addEventListener("click", () => {
            hidden.value = button.dataset.id;
            input.value = button.dataset.label;
            results.hidden = true;
          });
        });
      } catch (err) {
        results.innerHTML = `<div class="empty small" style="padding:14px">${esc(err.message)}</div>`;
        results.hidden = false;
      }
    }, 240);

    input.addEventListener("input", () => {
      // Typing after a pick clears the selection, so the hidden id can never
      // disagree with the text the operator is looking at.
      hidden.value = "";
      search();
    });
    input.addEventListener("focus", search);
    document.addEventListener("mousedown", (event) => {
      if (!host.contains(event.target)) results.hidden = true;
    });
  }

  /** Repeating description/qty/unit-price editor for invoice line items. */
  function wireLineItems(root, field) {
    const host = qs(`[data-lineitems="${field.name}"]`, root);
    if (!host) return;
    const rows = qs("[data-rows]", host);
    const subtotal = qs("[data-subtotal]", host);

    function recalc() {
      let total = 0;
      qsa("[data-row]", rows).forEach((row) => {
        const quantity = Number(qs("[data-qty]", row).value) || 0;
        const unit = Fmt.toMinor(qs("[data-unit]", row).value);
        const amount = quantity * unit;
        total += amount;
        qs("[data-amount]", row).textContent = Fmt.money(amount, field.currency || "INR");
      });
      subtotal.textContent = Fmt.money(total, field.currency || "INR");
    }

    function addRow(item) {
      const row = document.createElement("div");
      row.setAttribute("data-row", "");
      row.className = "row";
      row.style.gap = "6px";
      row.innerHTML =
        `<input class="input" data-desc placeholder="Description" style="flex:3" value="${attr((item && item.description) || "")}" />` +
        `<input class="input" data-qty type="number" min="1" step="1" style="width:66px" value="${attr((item && item.quantity) || 1)}" title="Quantity" />` +
        `<input class="input" data-unit type="number" min="0" step="0.01" style="width:104px" placeholder="Unit" value="${attr(item ? Fmt.fromMinor(item.unitAmount) : "")}" title="Unit price" />` +
        `<span data-amount class="small nums muted" style="min-width:82px;text-align:right">—</span>` +
        `<button class="btn btn-ghost btn-icon" type="button" data-remove aria-label="Remove line">${icon("x")}</button>`;
      rows.appendChild(row);
      qsa("input", row).forEach((input) => input.addEventListener("input", recalc));
      qs("[data-remove]", row).addEventListener("click", () => {
        row.remove();
        recalc();
      });
      recalc();
    }

    (field.value && field.value.length ? field.value : [null]).forEach(addRow);
    qs("[data-add]", host).addEventListener("click", () => addRow(null));
  }

  // ── DataTable ──────────────────────────────────────────────────────────────

  /**
   * config:
   *   mount        element or selector
   *   endpoint     list endpoint, returns { rows, total, page, pageSize, totalPages, facets?, options?, summary? }
   *   exportPath   optional server CSV endpoint; filters and sort are forwarded
   *   idKey        default "id"
   *   columns      [{ key, label, sortable, align, className, width, render(row), csv(row) }]
   *   selectable   boolean
   *   bulkActions  [{ label, action, danger?, confirm?, requiresValue?, options?, run(ids, value) }]
   *   rowActions   (row) => [{ label, icon, danger?, run(row) }]
   *   filters      [{ name, label, type: "select"|"text"|"date"|"toggle", options, value }]
   *   searchPlaceholder
   *   defaultSort  { by, dir }
   *   pageSize
   *   emptyTitle / emptyMessage
   *   onRowClick   (row) => void
   *   toolbarExtra HTML appended to the toolbar
   *   summary      (payload) => HTML shown above the table
   *   onLoad       (payload) => void
   */
  function Table(config) {
    const mount = typeof config.mount === "string" ? qs(config.mount) : config.mount;
    if (!mount) throw new Error("Table needs a mount element.");

    const idKey = config.idKey || "id";
    const state = {
      page: 1,
      pageSize: config.pageSize || 25,
      sortBy: (config.defaultSort && config.defaultSort.by) || null,
      sortDir: (config.defaultSort && config.defaultSort.dir) || "desc",
      search: "",
      filters: {},
      selected: new Set(),
      rows: [],
      payload: null,
      loading: false,
      busy: false,
    };

    (config.filters || []).forEach((filter) => {
      if (filter.value !== undefined && filter.value !== null && filter.value !== "") state.filters[filter.name] = filter.value;
    });

    const api = { state, reload, setFilter, getSelected, clearSelection, mount };

    function params() {
      return Object.assign(
        {
          page: state.page,
          pageSize: state.pageSize,
          search: state.search || undefined,
          sortBy: state.sortBy || undefined,
          sortDir: state.sortBy ? state.sortDir : undefined,
        },
        state.filters
      );
    }

    function getSelected() {
      return Array.from(state.selected);
    }

    function clearSelection() {
      state.selected.clear();
      renderSelectionState();
    }

    function setFilter(name, value) {
      if (value === undefined || value === null || value === "") delete state.filters[name];
      else state.filters[name] = value;
      state.page = 1;
      reload();
    }

    async function reload() {
      state.loading = true;
      renderBody();
      try {
        const payload = await Api.get(config.endpoint, params());
        state.payload = payload;
        state.rows = (payload && payload.rows) || [];
        // A page that no longer exists (last row on page 7 deleted) would render
        // empty forever; step back instead.
        if (!state.rows.length && state.page > 1 && payload && payload.totalPages && state.page > payload.totalPages) {
          state.page = payload.totalPages;
          return reload();
        }
        state.loading = false;
        render();
        if (config.onLoad) config.onLoad(payload, api);
      } catch (err) {
        state.loading = false;
        state.rows = [];
        renderError(err);
        if (err.code !== "migration_required") Toast.fromError(err);
      }
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    function shell() {
      const columns = config.columns;
      mount.innerHTML =
        `<div class="table-card">` +
        `<div class="toolbar" data-toolbar></div>` +
        `<div class="bulk-bar" data-bulk></div>` +
        `<div data-summary></div>` +
        `<div class="table-scroll"><table class="data">` +
        `<thead><tr>` +
        (config.selectable ? `<th class="col-check"><input class="check" type="checkbox" data-select-all aria-label="Select all rows on this page" /></th>` : "") +
        columns
          .map(
            (column) =>
              `<th class="${column.align === "right" ? "num " : ""}${column.sortable ? "sortable" : ""}${column.nowrap ? " nowrap" : ""}" ` +
              `${column.sortable ? `data-sort="${attr(column.sortable === true ? column.key : column.sortable)}" tabindex="0" role="button"` : ""}` +
              `${column.width ? ` style="width:${attr(column.width)}"` : ""}>` +
              `<span class="th-inner">${esc(column.label)}` +
              (column.sortable ? `<svg class="sort-arrow" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>` : "") +
              `</span></th>`
          )
          .join("") +
        (config.rowActions ? `<th class="col-actions"></th>` : "") +
        `</tr></thead><tbody data-body></tbody></table></div>` +
        `<div data-pager></div>` +
        `</div>`;

      renderToolbar();
      wireHeader();
    }

    function renderToolbar() {
      const toolbar = qs("[data-toolbar]", mount);
      toolbar.innerHTML =
        (config.search === false
          ? ""
          : `<div class="search-field">${icon("search")}<input class="input" type="search" data-search placeholder="${attr(config.searchPlaceholder || "Search…")}" value="${attr(state.search)}" /></div>`) +
        (config.filters || [])
          .map((filter) => {
            if (filter.type === "select") {
              return (
                `<select class="select select-sm" data-filter="${attr(filter.name)}" title="${attr(filter.label)}">` +
                `<option value="">${esc(filter.label)}</option>` +
                (filter.options || [])
                  .map((option) => {
                    const value = option.value !== undefined ? option.value : option;
                    const text = option.label !== undefined ? option.label : Fmt.title(value);
                    return `<option value="${attr(value)}"${String(state.filters[filter.name] ?? "") === String(value) ? " selected" : ""}>${esc(text)}</option>`;
                  })
                  .join("") +
                `</select>`
              );
            }
            if (filter.type === "date") {
              return `<input class="input select-sm" style="width:auto" type="date" data-filter="${attr(filter.name)}" title="${attr(filter.label)}" value="${attr(state.filters[filter.name] || "")}" />`;
            }
            if (filter.type === "toggle") {
              const on = state.filters[filter.name] === "true" || state.filters[filter.name] === true;
              return `<button class="chip${on ? " active" : ""}" type="button" data-toggle="${attr(filter.name)}">${esc(filter.label)}</button>`;
            }
            return `<input class="input select-sm" style="width:auto" data-filter="${attr(filter.name)}" placeholder="${attr(filter.label)}" value="${attr(state.filters[filter.name] || "")}" />`;
          })
          .join("") +
        `<div class="spacer"></div>` +
        (config.toolbarExtra || "") +
        (Object.keys(state.filters).length || state.search
          ? `<button class="btn btn-sm btn-ghost" type="button" data-clear>${icon("x")} Clear</button>`
          : "") +
        `<select class="select select-sm" data-page-size title="Rows per page">` +
        [10, 25, 50, 100, 200]
          .map((size) => `<option value="${size}"${state.pageSize === size ? " selected" : ""}>${size} / page</option>`)
          .join("") +
        `</select>` +
        (config.exportPath !== false
          ? `<div class="row" style="gap:4px">` +
            `<button class="btn btn-sm" type="button" data-export="csv" title="Download all matching rows as CSV">${icon("download")} Export</button>` +
            `</div>`
          : "") +
        `<button class="btn btn-sm btn-icon" type="button" data-refresh title="Refresh">${icon("refresh")}</button>`;

      const searchInput = qs("[data-search]", toolbar);
      if (searchInput) {
        searchInput.addEventListener(
          "input",
          debounce(() => {
            state.search = searchInput.value.trim();
            state.page = 1;
            reload();
          }, 320)
        );
      }

      qsa("[data-filter]", toolbar).forEach((control) => {
        control.addEventListener("change", () => setFilter(control.dataset.filter, control.value));
      });
      qsa("[data-toggle]", toolbar).forEach((button) => {
        button.addEventListener("click", () => {
          const name = button.dataset.toggle;
          setFilter(name, state.filters[name] ? "" : "true");
        });
      });

      const clear = qs("[data-clear]", toolbar);
      if (clear) {
        clear.addEventListener("click", () => {
          state.filters = {};
          state.search = "";
          state.page = 1;
          reload();
        });
      }

      qs("[data-page-size]", toolbar).addEventListener("change", (event) => {
        state.pageSize = Number(event.target.value);
        state.page = 1;
        reload();
      });

      const refresh = qs("[data-refresh]", toolbar);
      refresh.addEventListener("click", () => {
        refresh.classList.add("spinning");
        setTimeout(() => refresh.classList.remove("spinning"), 700);
        reload();
      });

      const exportButton = qs('[data-export="csv"]', toolbar);
      if (exportButton) {
        exportButton.addEventListener("click", async () => {
          exportButton.disabled = true;
          try {
            if (config.exportPath) {
              // Server-side export honours the active filters and sort, and is not
              // limited to the rows currently on screen.
              await Api.download(config.exportPath, params());
              Toast.success("Export downloaded.");
            } else {
              exportLocalCsv();
            }
          } catch (err) {
            Toast.fromError(err, "Export failed.");
          } finally {
            exportButton.disabled = false;
          }
        });
      }
    }

    /** Fallback export for tables with no server endpoint: the rows on screen. */
    function exportLocalCsv() {
      const columns = config.columns.filter((c) => c.csv !== false);
      const header = columns.map((c) => c.label);
      const lines = [header, ...state.rows.map((row) => columns.map((c) => csvValue(c, row)))];
      const csv =
        "\uFEFF" +
        lines
          .map((line) =>
            line
              .map((cell) => {
                let text = cell === null || cell === undefined ? "" : String(cell);
                if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
                return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
              })
              .join(",")
          )
          .join("\r\n");
      saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${config.exportName || "export"}.csv`);
      Toast.success(`Exported ${state.rows.length} row(s) from this page.`);
    }

    function csvValue(column, row) {
      if (column.csv) return column.csv(row);
      const raw = column.key ? valueAt(row, column.key) : "";
      return raw === null || raw === undefined ? "" : raw;
    }

    function valueAt(row, path) {
      return String(path)
        .split(".")
        .reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), row);
    }

    function wireHeader() {
      qsa("[data-sort]", mount).forEach((header) => {
        const apply = () => {
          const key = header.dataset.sort;
          if (state.sortBy === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          else {
            state.sortBy = key;
            state.sortDir = "desc";
          }
          state.page = 1;
          reload();
        };
        header.addEventListener("click", apply);
        header.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            apply();
          }
        });
      });

      const selectAll = qs("[data-select-all]", mount);
      if (selectAll) {
        selectAll.addEventListener("change", () => {
          if (selectAll.checked) state.rows.forEach((row) => state.selected.add(row[idKey]));
          else state.rows.forEach((row) => state.selected.delete(row[idKey]));
          renderSelectionState();
        });
      }
    }

    function renderHeaderSort() {
      qsa("[data-sort]", mount).forEach((header) => {
        const active = state.sortBy === header.dataset.sort;
        header.classList.toggle("sorted", active);
        header.classList.toggle("sorted-asc", active && state.sortDir === "asc");
        header.setAttribute("aria-sort", active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      });
    }

    function renderBody() {
      const body = qs("[data-body]", mount);
      if (!body) return;
      const span = config.columns.length + (config.selectable ? 1 : 0) + (config.rowActions ? 1 : 0);

      if (state.loading) {
        body.innerHTML = Array.from({ length: Math.min(6, state.pageSize) })
          .map(
            () =>
              `<tr>${Array.from({ length: span })
                .map(() => `<td><div class="skeleton" style="width:${50 + Math.random() * 40}%"></div></td>`)
                .join("")}</tr>`
          )
          .join("");
        return;
      }

      if (!state.rows.length) {
        body.innerHTML =
          `<tr><td colspan="${span}"><div class="empty">` +
          `<div class="empty-icon">${icon("inbox")}</div>` +
          `<div class="empty-title">${esc(config.emptyTitle || "Nothing here yet")}</div>` +
          `<div>${esc(config.emptyMessage || "No records match the current filters.")}</div>` +
          `</div></td></tr>`;
        return;
      }

      body.innerHTML = state.rows
        .map((row) => {
          const id = row[idKey];
          const selected = state.selected.has(id);
          return (
            `<tr data-id="${attr(id)}"${selected ? ' class="selected"' : ""}>` +
            (config.selectable
              ? `<td class="col-check"><input class="check" type="checkbox" data-row-check value="${attr(id)}"${selected ? " checked" : ""} aria-label="Select row" /></td>`
              : "") +
            config.columns
              .map((column) => {
                const content = column.render ? column.render(row) : esc(valueAt(row, column.key) ?? "—");
                return `<td class="${column.align === "right" ? "num " : ""}${column.className || ""}${column.nowrap ? " nowrap" : ""}">${content}</td>`;
              })
              .join("") +
            (config.rowActions
              ? `<td class="col-actions"><div class="cell-actions">` +
                (config.rowActions(row) || [])
                  .filter(Boolean)
                  .map(
                    (action, index) =>
                      `<button class="btn btn-sm ${action.danger ? "btn-danger-soft" : action.primary ? "btn-primary" : ""} ${action.iconOnly ? "btn-icon" : ""}" ` +
                      `type="button" data-action="${index}" title="${attr(action.title || action.label)}"${action.disabled ? " disabled" : ""}>` +
                      (action.icon ? icon(action.icon) : "") +
                      (action.iconOnly ? `<span class="sr-only">${esc(action.label)}</span>` : esc(action.label)) +
                      `</button>`
                  )
                  .join("") +
                `</div></td>`
              : "") +
            `</tr>`
          );
        })
        .join("");

      qsa("[data-row-check]", body).forEach((box) => {
        box.addEventListener("change", () => {
          if (box.checked) state.selected.add(box.value);
          else state.selected.delete(box.value);
          renderSelectionState();
        });
        // Clicking the checkbox must not also fire the row's click handler.
        box.addEventListener("click", (event) => event.stopPropagation());
      });

      if (config.rowActions) {
        qsa("tr[data-id]", body).forEach((tr) => {
          const row = state.rows.find((r) => String(r[idKey]) === tr.dataset.id);
          const actions = config.rowActions(row) || [];
          qsa("[data-action]", tr).forEach((button) => {
            button.addEventListener("click", async (event) => {
              event.stopPropagation();
              const action = actions.filter(Boolean)[Number(button.dataset.action)];
              if (!action || !action.run) return;
              button.disabled = true;
              try {
                await action.run(row, api);
              } catch (err) {
                Toast.fromError(err);
              } finally {
                button.disabled = false;
              }
            });
          });
        });
      }

      if (config.onRowClick) {
        qsa("tr[data-id]", body).forEach((tr) => {
          tr.style.cursor = "pointer";
          tr.addEventListener("click", () => {
            const row = state.rows.find((r) => String(r[idKey]) === tr.dataset.id);
            if (row) config.onRowClick(row, api);
          });
        });
      }

      renderSelectionState();
    }

    /**
     * Keeps the header checkbox, the row checkboxes and the bulk bar in agreement.
     *
     * The indeterminate state matters: with some rows on the page selected, a
     * plain unchecked header box tells the operator nothing, and a checked one
     * lies.
     */
    function renderSelectionState() {
      const pageIds = state.rows.map((row) => row[idKey]);
      const selectedOnPage = pageIds.filter((id) => state.selected.has(id));
      const selectAll = qs("[data-select-all]", mount);
      if (selectAll) {
        selectAll.checked = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
        selectAll.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < pageIds.length;
      }
      qsa("tr[data-id]", mount).forEach((tr) => {
        tr.classList.toggle("selected", state.selected.has(tr.dataset.id));
      });
      renderBulkBar();
    }

    function renderBulkBar() {
      const bar = qs("[data-bulk]", mount);
      if (!bar || !config.selectable || !config.bulkActions) return;
      const count = state.selected.size;
      bar.classList.toggle("visible", count > 0);
      if (!count) {
        bar.innerHTML = "";
        return;
      }

      bar.innerHTML =
        `<span class="bulk-count">${count} selected</span>` +
        `<button class="btn btn-sm btn-ghost" type="button" data-bulk-clear>Clear</button>` +
        `<div class="spacer"></div>` +
        config.bulkActions
          .map((action, index) => {
            if (action.options) {
              return (
                `<select class="select select-sm" data-bulk-select="${index}">` +
                `<option value="">${esc(action.label)}</option>` +
                action.options
                  .map((option) => {
                    const value = option.value !== undefined ? option.value : option;
                    const text = option.label !== undefined ? option.label : Fmt.title(value);
                    return `<option value="${attr(value)}">${esc(text)}</option>`;
                  })
                  .join("") +
                `</select>`
              );
            }
            return `<button class="btn btn-sm ${action.danger ? "btn-danger-soft" : ""}" type="button" data-bulk-run="${index}">${action.icon ? icon(action.icon) : ""}${esc(action.label)}</button>`;
          })
          .join("");

      qs("[data-bulk-clear]", bar).addEventListener("click", clearSelection);

      qsa("[data-bulk-run]", bar).forEach((button) => {
        button.addEventListener("click", () => runBulk(config.bulkActions[Number(button.dataset.bulkRun)]));
      });
      qsa("[data-bulk-select]", bar).forEach((select) => {
        select.addEventListener("change", () => {
          if (!select.value) return;
          runBulk(config.bulkActions[Number(select.dataset.bulkSelect)], select.value);
          select.value = "";
        });
      });
    }

    async function runBulk(action, value) {
      if (!action) return;
      const ids = getSelected();
      if (!ids.length) return;

      const execute = async () => {
        state.busy = true;
        const result = await action.run(ids, value, api);
        state.busy = false;
        clearSelection();
        await reload();
        if (result && result.message) Toast.warn(result.message);
        else Toast.success(`${action.pastLabel || "Updated"} ${result && result.affected !== undefined ? result.affected : ids.length} record(s).`);
      };

      if (action.confirm) {
        await Modal.confirm({
          title: action.confirmTitle || action.label,
          message:
            typeof action.confirm === "function"
              ? action.confirm(ids, value)
              : `${esc(action.confirm)}<br><br><strong>${ids.length}</strong> record(s) will be affected.`,
          confirmLabel: action.label,
          danger: !!action.danger,
          requireText: action.requireText || null,
          onConfirm: execute,
        });
        return;
      }
      try {
        await execute();
      } catch (err) {
        Toast.fromError(err);
      }
    }

    function renderPager() {
      const host = qs("[data-pager]", mount);
      const payload = state.payload || {};
      const total = payload.total || 0;
      const totalPages = payload.totalPages || 1;

      if (!total) {
        host.innerHTML = "";
        return;
      }

      const from = (state.page - 1) * state.pageSize + 1;
      const to = Math.min(total, from + state.rows.length - 1);

      host.innerHTML =
        `<div class="pager">` +
        `<span class="pager-info">Showing <strong>${Fmt.num(from)}</strong>–<strong>${Fmt.num(to)}</strong> of <strong>${Fmt.num(total)}</strong></span>` +
        (state.selected.size ? `<span class="pager-info muted">· ${state.selected.size} selected</span>` : "") +
        `<div class="spacer"></div>` +
        `<div class="page-btns">` +
        `<button class="page-btn" data-goto="1"${state.page === 1 ? " disabled" : ""} aria-label="First page">«</button>` +
        `<button class="page-btn" data-goto="${state.page - 1}"${state.page === 1 ? " disabled" : ""} aria-label="Previous page">‹</button>` +
        pageNumbers(state.page, totalPages)
          .map((entry) =>
            entry === "gap"
              ? `<span class="page-gap">…</span>`
              : `<button class="page-btn${entry === state.page ? " active" : ""}" data-goto="${entry}"${entry === state.page ? ' aria-current="page"' : ""}>${entry}</button>`
          )
          .join("") +
        `<button class="page-btn" data-goto="${state.page + 1}"${state.page >= totalPages ? " disabled" : ""} aria-label="Next page">›</button>` +
        `<button class="page-btn" data-goto="${totalPages}"${state.page >= totalPages ? " disabled" : ""} aria-label="Last page">»</button>` +
        `</div></div>`;

      qsa("[data-goto]", host).forEach((button) => {
        button.addEventListener("click", () => {
          const page = Number(button.dataset.goto);
          if (page === state.page || page < 1 || page > totalPages) return;
          state.page = page;
          reload();
        });
      });
    }

    /** Windowed page numbers: 1 … 4 5 [6] 7 8 … 20. */
    function pageNumbers(current, total) {
      if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
      const pages = new Set([1, total, current, current - 1, current + 1]);
      if (current <= 3) [2, 3, 4].forEach((n) => pages.add(n));
      if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => pages.add(n));
      const sorted = Array.from(pages)
        .filter((n) => n >= 1 && n <= total)
        .sort((a, b) => a - b);
      const out = [];
      sorted.forEach((page, index) => {
        if (index && page - sorted[index - 1] > 1) out.push("gap");
        out.push(page);
      });
      return out;
    }

    function renderSummary() {
      const host = qs("[data-summary]", mount);
      if (!host) return;
      host.innerHTML = config.summary && state.payload ? config.summary(state.payload) : "";
    }

    function renderError(err) {
      const body = qs("[data-body]", mount);
      const span = config.columns.length + (config.selectable ? 1 : 0) + (config.rowActions ? 1 : 0);
      if (!body) {
        mount.innerHTML = `<div class="notice notice-error">${icon("alert")}<div>${esc(err.message)}</div></div>`;
        return;
      }
      body.innerHTML =
        `<tr><td colspan="${span}"><div class="notice notice-error" style="margin:14px">${icon("alert")}` +
        `<div><strong>${esc(err.code === "migration_required" ? "Database migration needed" : "Could not load this table")}</strong><br>${esc(err.message)}</div>` +
        `</div></td></tr>`;
    }

    function render() {
      renderToolbar();
      renderHeaderSort();
      renderSummary();
      renderBody();
      renderPager();
    }

    shell();
    reload();
    return api;
  }

  // ── Theme ──────────────────────────────────────────────────────────────────

  const THEME_KEY = "superadmin_theme";

  const Theme = {
    /** Light is the default; the stored preference wins if there is one. */
    init() {
      const stored = localStorage.getItem(THEME_KEY);
      document.documentElement.setAttribute("data-theme", stored === "dark" ? "dark" : "light");
    },
    current() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    },
    toggle() {
      const next = Theme.current() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      // Charts read their colours from CSS variables at draw time, so they have
      // to be redrawn rather than restyled.
      if (global.Charts) global.Charts.redrawAll();
      return next;
    },
  };

  // ── Misc ───────────────────────────────────────────────────────────────────

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success("Copied to clipboard.");
    } catch (_) {
      Toast.error("Could not copy to the clipboard.");
    }
  }

  /** Small helpers the pages use to render consistent cells. */
  const Cell = {
    badge(text, tone) {
      return `<span class="badge badge-${tone || "neutral"}">${esc(Fmt.title(text))}</span>`;
    },
    dotBadge(text, tone) {
      return `<span class="badge badge-dot badge-${tone || "neutral"}">${esc(Fmt.title(text))}</span>`;
    },
    user(row) {
      const name = (row && (row.name || row.email)) || "—";
      const initial = String(name).trim().charAt(0).toUpperCase() || "?";
      return (
        `<div class="cell-stack"><div class="avatar" aria-hidden="true">${esc(initial)}</div>` +
        `<div style="min-width:0"><div class="cell-strong truncate">${esc(row && row.name ? row.name : "—")}</div>` +
        `<div class="cell-sub truncate">${esc((row && row.email) || "")}</div></div></div>`
      );
    },
    meter(percent, tone) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));
      const klass = tone || (value >= 90 ? "danger" : value >= 75 ? "warn" : "");
      return `<div class="meter" title="${value}%"><div class="meter-fill ${klass}" style="width:${value}%"></div></div>`;
    },
    id(value) {
      return `<span class="cell-mono" title="${attr(value)}">${esc(String(value || "").slice(0, 8))}…</span>`;
    },
    empty() {
      return '<span class="faint">—</span>';
    },
  };

  /** Tone lookups shared by tables, so a status is the same colour everywhere. */
  const Tone = {
    userStatus: { active: "success", suspended: "danger" },
    subscription: { active: "success", trialing: "info", past_due: "warning", paused: "neutral", canceled: "danger", expired: "neutral" },
    invoice: { paid: "success", open: "info", partially_paid: "warning", draft: "neutral", void: "neutral", uncollectible: "danger", refunded: "warning" },
    payment: { succeeded: "success", pending: "warning", failed: "danger", refunded: "neutral", partially_refunded: "warning" },
    plan: { free: "neutral", pro: "brand", custom: "warning", admin: "danger" },
    role: { admin: "danger", user: "neutral" },
    job: { completed: "success", running: "info", queued: "neutral", cancelling: "warning", cancelled: "neutral", failed: "danger" },
    of(map, value, fallback) {
      return map[String(value || "").toLowerCase()] || fallback || "neutral";
    },
  };

  global.UI = { esc, attr, qs, qsa, debounce, icon, ICONS, Fmt, Api, ApiError, RedirectingError, Toast, Modal, Table, Theme, Cell, Tone, copyText, saveBlob };
})(window);
