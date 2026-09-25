/*
 * Core pages: Overview, Users, Workspaces.
 *
 * Each page is registered on `window.Pages` under its route key and exposes a
 * `render(container, ctx)` function. `ctx` carries the shared helpers (currency,
 * a navigate() that switches route, and the refresh registrar) so a page never
 * reaches for globals it does not own.
 *
 * The pattern throughout: fetch once, draw KPIs and charts from that payload,
 * and let the DataTable own its own data lifecycle. A page's render() returns an
 * optional `refresh()` the topbar button calls, so "Refresh" reloads the live
 * page rather than every page at once.
 */
(function (global) {
  "use strict";

  const { esc, icon, Fmt, Api, Toast, Modal, Table, Cell, Tone, qs, copyText } = global.UI;
  const Pages = (global.Pages = global.Pages || {});

  // ── Shared building blocks ─────────────────────────────────────────────────

  function kpiCard(kpi) {
    const trend =
      kpi.delta === null || kpi.delta === undefined
        ? ""
        : `<span class="trend ${kpi.delta > 0 ? "up" : kpi.delta < 0 ? "down" : "flat"}">` +
          `${kpi.delta > 0 ? "▲" : kpi.delta < 0 ? "▼" : "→"} ${Math.abs(kpi.delta)}%</span>`;
    return (
      `<div class="kpi${kpi.onClick ? " clickable" : ""}"${kpi.onClick ? ` data-kpi="${esc(kpi.id)}"` : ""}>` +
      `<div class="kpi-top"><span class="kpi-icon tone-${kpi.tone || "brand"}">${icon(kpi.icon || "activity")}</span>` +
      `<span class="kpi-label">${esc(kpi.label)}</span></div>` +
      `<div class="kpi-value">${kpi.value}${kpi.unit ? `<span class="kpi-unit">${esc(kpi.unit)}</span>` : ""}</div>` +
      `<div class="kpi-foot">${trend}<span>${esc(kpi.sub || "")}</span></div>` +
      `</div>`
    );
  }

  function chartCard(title, id, opts) {
    const extra = opts && opts.extra ? opts.extra : "";
    return (
      `<div class="card"><div class="card-head"><h3>${esc(title)}</h3><div class="spacer"></div>${extra}</div>` +
      `<div class="card-body"><div id="${id}" style="min-height:${(opts && opts.height) || 240}px"></div></div></div>`
    );
  }

  function feedDotClass(action) {
    const a = String(action || "");
    if (a.includes("success") || a.includes("created") || a.includes("verified")) return "success";
    if (a.includes("failed") || a.includes("deleted") || a.includes("refused") || a.includes("error")) return "danger";
    if (a.startsWith("admin_") || a.includes("superadmin")) return "brand";
    if (a.includes("suspend") || a.includes("locked") || a.includes("cancel")) return "warning";
    return "";
  }

  function activityFeed(logs) {
    if (!logs || !logs.length) return '<div class="empty small" style="padding:24px">No recent activity.</div>';
    return logs
      .map(
        (log) =>
          `<div class="feed-item"><div class="feed-dot ${feedDotClass(log.action)}"></div>` +
          `<div class="feed-main"><div class="feed-action">${esc(Fmt.title(log.action))}</div>` +
          `<div class="feed-meta">${log.user ? `<strong>${esc(log.user.email)}</strong>` : "System"}${log.ip ? ` · ${esc(log.ip)}` : ""}</div></div>` +
          `<div class="feed-time" title="${esc(Fmt.dateTime(log.createdAt))}">${esc(Fmt.ago(log.createdAt))}</div></div>`
      )
      .join("");
  }

  // ── OVERVIEW ───────────────────────────────────────────────────────────────

  Pages.overview = {
    title: "Dashboard",
    subtitle: "Platform health, growth and revenue at a glance.",
    async render(container, ctx) {
      let days = 30;

      container.innerHTML =
        `<div class="section" data-alerts></div>` +
        `<div class="row row-wrap mb-2"><div class="segmented" data-range>` +
        [
          [7, "7d"],
          [30, "30d"],
          [90, "90d"],
          [365, "1y"],
        ]
          .map(([value, label]) => `<button data-days="${value}"${value === days ? ' class="active"' : ""}>${label}</button>`)
          .join("") +
        `</div></div>` +
        `<div class="kpi-grid mb-2" data-kpis></div>` +
        `<div class="grid-chart-side mb-2">` +
        chartCard("Signups & Revenue", "ovChartMain", { extra: `<div class="segmented" data-metric><button data-m="signups" class="active">Signups</button><button data-m="revenue">Revenue</button><button data-m="leads">Leads</button><button data-m="pageViews">Traffic</button></div>` }) +
        `<div class="card"><div class="card-head"><h3>Plan mix</h3></div><div class="card-body"><div id="ovPlan" style="min-height:200px"></div></div></div>` +
        `</div>` +
        `<div class="grid-2 mb-2">` +
        `<div class="card"><div class="card-head"><h3>Account status</h3></div><div class="card-body"><div id="ovStatus" style="min-height:180px"></div></div></div>` +
        `<div class="card"><div class="card-head"><h3>Lead pipeline</h3></div><div class="card-body"><div id="ovLeads" style="min-height:180px"></div></div></div>` +
        `</div>` +
        `<div class="grid-chart-side">` +
        `<div class="card"><div class="card-head"><h3>Top workspaces by leads</h3><div class="spacer"></div><button class="link small" data-goto-tenants>View all</button></div><div class="card-body"><div id="ovTenants"></div></div></div>` +
        `<div class="card"><div class="card-head"><h3>Recent activity</h3><div class="spacer"></div><button class="link small" data-goto-audit>Audit log</button></div><div id="ovFeed"></div></div>` +
        `</div>`;

      let overview = null;

      async function loadOverview() {
        overview = await Api.get("/analytics/overview", { days });
        drawOverview();
      }

      function drawOverview() {
        const k = overview.kpis;
        const money = (v) => Fmt.money(v, ctx.currency, { compact: true, decimals: false });

        qs("[data-kpis]", container).innerHTML = [
          { id: "users", label: "Total users", value: Fmt.compact(k.users.total), icon: "users", tone: "brand", delta: k.users.delta, sub: `+${k.users.new} this period` },
          { id: "revenue", label: "MRR", value: money(k.revenue.mrr), icon: "trending", tone: "success", delta: k.revenue.delta, sub: `${money(k.revenue.arr)} ARR` },
          { id: "subs", label: "Active subscriptions", value: Fmt.compact(k.revenue.activeSubscriptions), icon: "repeat", tone: "purple", sub: `${money(k.revenue.collectedWindow)} collected` },
          { id: "outstanding", label: "Outstanding", value: money(k.revenue.outstanding), icon: "receipt", tone: k.revenue.outstanding > 0 ? "warning" : "success", sub: `${k.revenue.outstandingCount} unpaid invoice(s)` },
          { id: "tenants", label: "Workspaces", value: Fmt.compact(k.tenants.total), icon: "building", tone: "cyan", delta: k.tenants.delta, sub: `${k.tenants.suspended} suspended` },
          { id: "leads", label: "Total leads", value: Fmt.compact(k.leads.total), icon: "briefcase", tone: "info", delta: k.leads.delta, sub: `${Fmt.compact(k.leads.new)} new` },
          { id: "traffic", label: "Page views", value: Fmt.compact(k.traffic.total), icon: "eye", tone: "pink", delta: k.traffic.delta, sub: `${Fmt.compact(k.traffic.window)} this period` },
          { id: "verified", label: "Verified users", value: Fmt.compact(k.users.verified), icon: "shield", tone: "success", sub: `${k.users.unverified} unverified` },
        ]
          .map(kpiCard)
          .join("");

        // KPI cards deep-link to the page that acts on them.
        qs("[data-kpis]", container).querySelectorAll("[data-kpi]").forEach((card) => {
          const target = { users: "users", verified: "users", revenue: "billing", subs: "subscriptions", outstanding: "invoices", tenants: "tenants", leads: "leads", traffic: "visitors" }[card.dataset.kpi];
          if (target) card.addEventListener("click", () => ctx.navigate(target));
        });

        // Alerts
        const alerts = overview.alerts || [];
        qs("[data-alerts]", container).innerHTML = alerts.length
          ? `<div class="notice ${alerts.some((a) => a.level === "critical") ? "notice-error" : alerts.some((a) => a.level === "warn") ? "notice-warn" : ""}">` +
            icon("alert") +
            `<div><strong>${alerts.length} thing(s) need attention.</strong><ul style="margin:6px 0 0 16px;padding:0">` +
            alerts.map((a) => `<li>${esc(a.message)}${a.page ? ` <button class="link" data-alert-go="${esc(a.page)}">Review →</button>` : ""}</li>`).join("") +
            `</ul></div></div>`
          : "";
        qs("[data-alerts]", container).querySelectorAll("[data-alert-go]").forEach((btn) => {
          btn.addEventListener("click", () => ctx.navigate(btn.dataset.alertGo));
        });

        drawMainChart("signups");
        global.Charts.donut(qs("#ovPlan", container), {
          data: overview.distributions.plan.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          centerLabel: "users",
          height: 200,
        });
        global.Charts.donut(qs("#ovStatus", container), {
          data: overview.distributions.accountStatus.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          centerLabel: "accounts",
          height: 180,
        });
        global.Charts.hbars(qs("#ovLeads", container), {
          data: overview.distributions.leadStatus.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          limit: 8,
        });
        global.Charts.hbars(qs("#ovTenants", container), {
          data: overview.topTenants.map((t) => ({ label: t.name, value: t.leads, suffix: "leads" })),
          onPick: (row) => {
            const tenant = overview.topTenants.find((t) => t.name === row.label);
            if (tenant) ctx.navigate("tenants", { focus: tenant.id });
          },
        });
        qs("#ovFeed", container).innerHTML = activityFeed(overview.recentActivity);
      }

      function drawMainChart(metric) {
        const isRevenue = metric === "revenue";
        const series = overview.series[metric] || [];
        global.Charts.area(qs("#ovChartMain", container), {
          series: [{ key: metric, label: Fmt.title(metric), data: series, color: isRevenue ? "var(--c3)" : "var(--c1)" }],
          height: 250,
          format: isRevenue ? (v) => Fmt.money(v, ctx.currency, { compact: true, decimals: false }) : Fmt.compact,
        });
      }

      qs("[data-range]", container).addEventListener("click", (e) => {
        const button = e.target.closest("[data-days]");
        if (!button) return;
        days = Number(button.dataset.days);
        qs("[data-range]", container).querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
        loadOverview();
      });

      qs("[data-metric]", container).addEventListener("click", (e) => {
        const button = e.target.closest("[data-m]");
        if (!button) return;
        qs("[data-metric]", container).querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
        drawMainChart(button.dataset.m);
      });

      qs("[data-goto-tenants]", container).addEventListener("click", () => ctx.navigate("tenants"));
      qs("[data-goto-audit]", container).addEventListener("click", () => ctx.navigate("audit"));

      await loadOverview();
      return { refresh: loadOverview };
    },
  };

  // ── USERS ──────────────────────────────────────────────────────────────────

  Pages.users = {
    title: "Users",
    subtitle: "Every account on the platform. Create, edit, suspend, and manage plans.",
    async render(container, ctx) {
      let options = { plans: ["free", "pro", "custom"], roles: ["user", "admin"], statuses: ["active", "suspended"] };

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} New user</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/users",
        exportPath: "/users/export",
        searchPlaceholder: "Search name, email, phone or id…",
        defaultSort: { by: "createdAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No users found",
        filters: [
          { name: "plan", label: "Plan", type: "select", options: options.plans },
          { name: "role", label: "Role", type: "select", options: options.roles },
          { name: "status", label: "Status", type: "select", options: options.statuses },
          { name: "verified", label: "Verified", type: "select", options: [{ value: "true", label: "Verified" }, { value: "false", label: "Unverified" }] },
          { name: "locked", label: "Locked only", type: "toggle" },
        ],
        columns: [
          { key: "email", label: "User", sortable: "email", render: (r) => Cell.user(r) },
          { key: "plan", label: "Plan", sortable: "plan", render: (r) => Cell.badge(r.plan, Tone.of(Tone.plan, r.plan)) },
          { key: "role", label: "Role", sortable: "role", render: (r) => Cell.badge(r.role, Tone.of(Tone.role, r.role)) },
          {
            key: "status",
            label: "Status",
            sortable: "status",
            render: (r) =>
              Cell.dotBadge(r.status, Tone.of(Tone.userStatus, r.status)) +
              (r.locked ? ` ${Cell.badge("locked", "warning")}` : ""),
          },
          {
            key: "emailVerified",
            label: "Verified",
            sortable: "emailVerified",
            align: "right",
            render: (r) => (r.emailVerified ? Cell.badge("yes", "success") : Cell.badge("no", "neutral")),
          },
          {
            key: "leadsUsed",
            label: "Usage",
            sortable: "leadsUsed",
            render: (r) =>
              `<div class="row" style="gap:8px"><span class="nums small">${Fmt.num(r.leadsUsed)}${r.leadLimit >= 0 ? `<span class="faint">/${Fmt.num(r.leadLimit)}</span>` : ""}</span>` +
              (r.leadLimit >= 0 ? Cell.meter(r.usagePercent) : `<span class="faint small">∞</span>`) +
              `</div>`,
          },
          { key: "revenue", label: "Revenue", sortable: false, align: "right", render: (r) => (r.revenue ? `<span class="nums strong">${Fmt.money(r.revenue, ctx.currency, { decimals: false })}</span>` : Cell.empty()) },
          { key: "lastLoginAt", label: "Last login", sortable: "lastLoginAt", nowrap: true, render: (r) => `<span class="small muted" title="${esc(Fmt.dateTime(r.lastLoginAt))}">${r.lastLoginAt ? Fmt.ago(r.lastLoginAt) : "never"}</span>` },
          { key: "createdAt", label: "Joined", sortable: "createdAt", nowrap: true, render: (r) => `<span class="small muted">${Fmt.date(r.createdAt)}</span>` },
        ],
        onLoad: (payload) => {
          if (payload.options) options = payload.options;
        },
        onRowClick: (row) => openDetail(row.id),
        rowActions: (row) => [
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          { label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) },
        ],
        bulkActions: [
          { label: "Verify", action: "verify", run: (ids) => bulk("verify", ids) },
          { label: "Suspend", action: "suspend", danger: true, confirm: "Suspended users cannot sign in until reactivated.", run: (ids) => bulk("suspend", ids) },
          { label: "Activate", action: "activate", run: (ids) => bulk("activate", ids) },
          { label: "Unlock", action: "unlock", run: (ids) => bulk("unlock", ids) },
          { label: "Reset usage", action: "reset-usage", run: (ids) => bulk("reset-usage", ids) },
          {
            label: "Set plan…",
            options: options.plans.map((p) => ({ value: p, label: `Plan → ${Fmt.title(p)}` })),
            run: (ids, value) => bulk("set-plan", ids, { plan: value }),
          },
          { label: "Delete", action: "delete", danger: true, confirm: "This permanently deletes the selected accounts. Invoices and payments are retained.", run: (ids) => bulk("delete", ids) },
        ],
      });

      function bulk(action, ids, extra) {
        return Api.post("/users/bulk", Object.assign({ action, ids }, extra || {}));
      }

      function userFields(user) {
        return [
          { name: "name", label: "Name", value: user && user.name, placeholder: "Full name" },
          { name: "email", label: "Email", type: "email", required: true, value: user && user.email, autocomplete: "off" },
          !user ? { name: "password", label: "Temporary password", type: "password", required: true, help: "At least 8 characters. The user can change it after signing in.", autocomplete: "new-password" } : null,
          {
            name: "plan",
            label: "Plan",
            type: "select",
            options: options.plans,
            value: (user && user.plan) || "free",
          },
          { name: "role", label: "Role", type: "select", options: options.roles, value: (user && user.role) || "user" },
          { name: "status", label: "Status", type: "select", options: options.statuses, value: (user && user.status) || "active" },
          { name: "phone", label: "Phone", value: user && user.phone, placeholder: "+91…" },
          { name: "emailVerified", label: "Email verified", type: "checkbox", value: user ? user.emailVerified : true },
        ].filter(Boolean);
      }

      function openCreate() {
        Modal.form({
          title: "Create user",
          subtitle: "The account is created verified so the person can sign in immediately.",
          fields: userFields(null),
          submitLabel: "Create user",
          onSubmit: async (values) => {
            await Api.post("/users", values);
            Toast.success("User created.");
            table.reload();
          },
        });
      }

      function openEdit(user) {
        Modal.form({
          title: "Edit user",
          subtitle: user.email,
          fields: userFields(user),
          submitLabel: "Save changes",
          extraFooter: `<button class="btn" type="button" data-reset-pw>${icon("key")} Reset password</button>`,
          onSubmit: async (values) => {
            await Api.patch(`/users/${user.id}`, values);
            Toast.success("User updated.");
            table.reload();
          },
        });
        // The extra footer button is wired after the modal mounts.
        setTimeout(() => {
          const button = qs("[data-reset-pw]");
          if (button) button.addEventListener("click", () => resetPassword(user));
        }, 60);
      }

      function resetPassword(user) {
        Modal.form({
          title: "Reset password",
          subtitle: `Set a new password for ${user.email}. This also clears any lockout.`,
          fields: [{ name: "password", label: "New password", type: "password", required: true, help: "At least 8 characters.", autocomplete: "new-password" }],
          submitLabel: "Reset password",
          onSubmit: async (values) => {
            await Api.post(`/users/${user.id}/password`, values);
            Toast.success("Password reset.");
          },
        });
      }

      async function remove(user) {
        await Modal.confirm({
          title: "Delete user",
          message: `Permanently delete <strong>${esc(user.email)}</strong>? Their leads, lists and campaigns are removed. Invoices and payments are kept for the financial record.`,
          confirmLabel: "Delete user",
          danger: true,
          requireText: user.email,
          onConfirm: async () => {
            await Api.del(`/users/${user.id}`);
            Toast.success("User deleted.");
            table.reload();
          },
        });
      }

      async function openDetail(id) {
        let data;
        try {
          data = await Api.get(`/users/${id}`);
        } catch (err) {
          Toast.fromError(err);
          return;
        }
        const u = data.user;
        Modal.open({
          title: u.name || u.email,
          subtitle: u.email,
          size: "lg",
          body: renderUserDetail(data, ctx),
          footer: `<div class="spacer"></div><button class="btn" data-copy-id>${icon("copy")} Copy ID</button><button class="btn btn-primary" data-edit>${icon("edit")} Edit</button>`,
          onMount: (h) => {
            qs("[data-copy-id]", h.overlay).addEventListener("click", () => copyText(u.id));
            qs("[data-edit]", h.overlay).addEventListener("click", () => {
              h.close();
              openEdit(u);
            });
          },
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);

      // Deep link support: overview KPI → users?focus=<id>
      if (ctx.query && ctx.query.focus) setTimeout(() => openDetail(ctx.query.focus), 100);

      return { refresh: () => table.reload() };
    },
  };

  function renderUserDetail(data, ctx) {
    const u = data.user;
    const money = (v) => Fmt.money(v, ctx.currency, { decimals: false });
    return (
      `<div class="stat-strip mb-2">` +
      `<div><div class="l">Plan</div><div class="v">${esc(Fmt.title(u.plan))}</div></div>` +
      `<div><div class="l">Status</div><div class="v">${esc(Fmt.title(u.status))}</div></div>` +
      `<div><div class="l">Leads used</div><div class="v nums">${Fmt.num(u.leadsUsed)}</div></div>` +
      `<div><div class="l">Lifetime revenue</div><div class="v nums">${money(u.revenue)}</div></div>` +
      `<div><div class="l">Workspaces</div><div class="v nums">${u.counts.tenants}</div></div>` +
      `</div>` +
      `<dl class="dl mb-2">` +
      `<dt>User ID</dt><dd class="mono">${esc(u.id)}</dd>` +
      `<dt>Role</dt><dd>${esc(Fmt.title(u.role))}</dd>` +
      `<dt>Email verified</dt><dd>${u.emailVerified ? "Yes" : "No"}</dd>` +
      `<dt>Phone</dt><dd>${esc(u.phone || "—")}${u.phone ? (u.phoneVerified ? " (verified)" : " (unverified)") : ""}</dd>` +
      `<dt>Locked</dt><dd>${u.locked ? `Yes, until ${esc(Fmt.dateTime(u.lockedUntil))}` : "No"}</dd>` +
      `<dt>Failed logins</dt><dd class="nums">${u.failedLoginAttempts}</dd>` +
      `<dt>Last login</dt><dd>${esc(Fmt.dateTime(u.lastLoginAt))}</dd>` +
      `<dt>Joined</dt><dd>${esc(Fmt.dateTime(u.createdAt))}</dd>` +
      `<dt>Lead lists</dt><dd class="nums">${data.activity.leadLists} lists · ${Fmt.num(data.activity.leads)} leads</dd>` +
      `</dl>` +
      (data.subscriptions.length
        ? `<h3 class="small strong mb-1">Subscriptions</h3><div class="table-scroll mb-2"><table class="data"><thead><tr><th>Plan</th><th>Status</th><th class="num">Amount</th><th>Renews</th></tr></thead><tbody>` +
          data.subscriptions
            .map(
              (s) =>
                `<tr><td>${esc(Fmt.title(s.planKey))}</td><td>${UI.Cell.badge(s.status, UI.Tone.of(UI.Tone.subscription, s.status))}</td>` +
                `<td class="num nums">${money(s.amount)}<span class="faint small">/${esc(s.billingCycle === "yearly" ? "yr" : s.billingCycle === "lifetime" ? "once" : "mo")}</span></td>` +
                `<td class="small">${esc(Fmt.date(s.currentPeriodEnd))}</td></tr>`
            )
            .join("") +
          `</tbody></table></div>`
        : "") +
      (data.invoices.length
        ? `<h3 class="small strong mb-1">Recent invoices</h3><div class="table-scroll mb-2"><table class="data"><thead><tr><th>Number</th><th>Status</th><th class="num">Total</th><th>Issued</th></tr></thead><tbody>` +
          data.invoices
            .slice(0, 8)
            .map(
              (inv) =>
                `<tr><td class="mono">${esc(inv.number)}</td><td>${UI.Cell.badge(inv.status, UI.Tone.of(UI.Tone.invoice, inv.status))}</td>` +
                `<td class="num nums">${money(inv.total)}</td><td class="small">${esc(Fmt.date(inv.issuedAt))}</td></tr>`
            )
            .join("") +
          `</tbody></table></div>`
        : "") +
      (data.memberships.length
        ? `<h3 class="small strong mb-1">Workspace memberships</h3><div class="chip-row mb-2">` +
          data.memberships.map((m) => `<span class="chip" style="cursor:default">${esc(m.tenant ? m.tenant.name : "—")} · ${esc(m.role)}</span>`).join("") +
          `</div>`
        : "") +
      `<h3 class="small strong mb-1">Recent activity</h3>` +
      `<div class="card">${activityFeed(data.auditLogs.slice(0, 10))}</div>`
    );
  }

  // ── WORKSPACES (TENANTS) ─────────────────────────────────────────────────────

  Pages.tenants = {
    title: "Workspaces",
    subtitle: "Tenant workspaces — the unit of data ownership and billing.",
    async render(container, ctx) {
      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} New workspace</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/platform/tenants",
        exportPath: "/platform/tenants/export",
        searchPlaceholder: "Search workspace name or slug…",
        defaultSort: { by: "createdAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No workspaces yet",
        filters: [{ name: "status", label: "Status", type: "select", options: ["active", "suspended"] }],
        columns: [
          {
            key: "name",
            label: "Workspace",
            sortable: "name",
            render: (r) =>
              `<div><div class="cell-strong">${esc(r.name)}</div><div class="cell-sub mono">${esc(r.slug)}</div></div>`,
          },
          { key: "status", label: "Status", sortable: "status", render: (r) => Cell.dotBadge(r.status, Tone.of(Tone.userStatus, r.status)) },
          { key: "owner", label: "Owner", render: (r) => (r.owner ? `<span class="small">${esc(r.owner.email)}</span>` : Cell.empty()) },
          { key: "members", label: "Members", sortable: "members", align: "right", render: (r) => `<span class="nums">${r.counts.members}</span>` },
          { key: "leads", label: "Leads", sortable: "leads", align: "right", render: (r) => `<span class="nums">${Fmt.compact(r.counts.leads)}</span>` },
          { key: "campaigns", label: "Campaigns", sortable: "campaigns", align: "right", render: (r) => `<span class="nums">${r.counts.campaigns}</span>` },
          { key: "createdAt", label: "Created", sortable: "createdAt", nowrap: true, render: (r) => `<span class="small muted">${Fmt.date(r.createdAt)}</span>` },
        ],
        onRowClick: (row) => openDetail(row.id),
        rowActions: (row) => [
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          {
            label: row.status === "active" ? "Suspend" : "Activate",
            icon: row.status === "active" ? "ban" : "check",
            iconOnly: true,
            run: async () => {
              await Api.patch(`/platform/tenants/${row.id}`, { status: row.status === "active" ? "suspended" : "active" });
              Toast.success(row.status === "active" ? "Workspace suspended." : "Workspace activated.");
              table.reload();
            },
          },
          { label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) },
        ],
        bulkActions: [
          { label: "Suspend", action: "suspend", danger: true, confirm: "Suspended workspaces are refused at the access guard.", run: (ids) => Api.post("/platform/tenants/bulk", { action: "suspend", ids }) },
          { label: "Activate", action: "activate", run: (ids) => Api.post("/platform/tenants/bulk", { action: "activate", ids }) },
        ],
      });

      function openCreate() {
        Modal.form({
          title: "Create workspace",
          fields: [
            { name: "name", label: "Workspace name", required: true },
            { name: "slug", label: "Handle (optional)", help: "Left blank, a URL-safe handle is derived from the name." },
            {
              name: "ownerUserId",
              label: "Owner (optional)",
              type: "remote-select",
              endpoint: "/billing/customers",
              placeholder: "Search a user to make owner…",
              help: "The owner can administer the workspace. Leave blank to create it unowned.",
            },
          ],
          submitLabel: "Create workspace",
          onSubmit: async (values) => {
            await Api.post("/platform/tenants", values);
            Toast.success("Workspace created.");
            table.reload();
          },
        });
      }

      function openEdit(tenant) {
        Modal.form({
          title: "Edit workspace",
          subtitle: tenant.slug,
          fields: [
            { name: "name", label: "Name", required: true, value: tenant.name },
            { name: "slug", label: "Handle", value: tenant.slug },
            { name: "status", label: "Status", type: "select", options: ["active", "suspended"], value: tenant.status },
          ],
          submitLabel: "Save",
          onSubmit: async (values) => {
            await Api.patch(`/platform/tenants/${tenant.id}`, values);
            Toast.success("Workspace updated.");
            table.reload();
          },
        });
      }

      async function remove(tenant) {
        await Modal.confirm({
          title: "Delete workspace",
          message: `Deleting <strong>${esc(tenant.name)}</strong> removes <strong>${Fmt.num(tenant.counts.leads)}</strong> leads, ${tenant.counts.leadLists} lists and ${tenant.counts.campaigns} campaigns, and cannot be undone.`,
          confirmLabel: "Delete workspace",
          danger: true,
          requireText: tenant.slug,
          onConfirm: async () => {
            await Api.del(`/platform/tenants/${tenant.id}`, { confirm: tenant.slug });
            Toast.success("Workspace deleted.");
            table.reload();
          },
        });
      }

      async function openDetail(id) {
        let data;
        try {
          data = await Api.get(`/platform/tenants/${id}`);
        } catch (err) {
          Toast.fromError(err);
          return;
        }
        const t = data.tenant;
        Modal.open({
          title: t.name,
          subtitle: `${t.slug} · ${Fmt.title(t.status)}`,
          size: "lg",
          body:
            `<div class="stat-strip mb-2">` +
            `<div><div class="l">Members</div><div class="v nums">${t._count.members}</div></div>` +
            `<div><div class="l">Leads</div><div class="v nums">${Fmt.num(t._count.leads)}</div></div>` +
            `<div><div class="l">Lists</div><div class="v nums">${t._count.leadLists}</div></div>` +
            `<div><div class="l">Campaigns</div><div class="v nums">${t._count.campaigns}</div></div>` +
            `<div><div class="l">Integrations</div><div class="v nums">${t._count.integrations}</div></div>` +
            `</div>` +
            `<h3 class="small strong mb-1">Members</h3><div class="table-scroll mb-2"><table class="data"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>` +
            (data.tenant.members.length
              ? data.tenant.members
                  .map(
                    (m) =>
                      `<tr><td>${esc(m.user ? m.user.email : "—")}</td><td>${esc(Fmt.title(m.role))}</td><td>${UI.Cell.badge(m.status, m.status === "active" ? "success" : "neutral")}</td></tr>`
                  )
                  .join("")
              : `<tr><td colspan="3" class="muted">No members.</td></tr>`) +
            `</tbody></table></div>` +
            `<h3 class="small strong mb-1">Recent jobs</h3>` +
            (data.recentJobs.length
              ? `<div class="chip-row mb-2">${data.recentJobs.map((j) => `<span class="chip" style="cursor:default">${esc(j.kind)} · ${esc(j.status)}</span>`).join("")}</div>`
              : `<p class="muted small mb-2">No jobs run yet.</p>`) +
            `<h3 class="small strong mb-1">Recent activity</h3><div class="card">${activityFeed(data.recentAudit)}</div>`,
          footer: `<div class="spacer"></div><button class="btn" data-copy>${icon("copy")} Copy ID</button>`,
          onMount: (h) => qs("[data-copy]", h.overlay).addEventListener("click", () => copyText(t.id)),
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      if (ctx.query && ctx.query.focus) setTimeout(() => openDetail(ctx.query.focus), 100);
      return { refresh: () => table.reload() };
    },
  };

  // Expose the shared feed renderer for other page files.
  Pages._shared = { kpiCard, chartCard, activityFeed, feedDotClass };
})(window);
