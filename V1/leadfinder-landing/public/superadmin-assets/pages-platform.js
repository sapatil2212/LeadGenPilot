/*
 * Platform pages: Leads, Visitors, Audit log, Feature flags, Announcements,
 * Platform settings, System health.
 *
 * These are the operator-facing controls that used to be code constants,
 * environment variables or a SQL client. Where a page just lists rows it uses
 * the shared DataTable; where it configures the platform (settings, flags) it
 * uses forms whose vocabulary comes from the server so the client never invents
 * an option the API will reject.
 */
(function (global) {
  "use strict";

  const { esc, icon, Fmt, Api, Toast, Modal, Table, Cell, Tone, qs, qsa, copyText } = global.UI;
  const Pages = (global.Pages = global.Pages || {});
  const { activityFeed } = Pages._shared;

  // ── LEADS (cross-tenant) ─────────────────────────────────────────────────────

  Pages.leads = {
    title: "Leads",
    subtitle: "Every lead across all workspaces. Read-only browsing with bulk cleanup.",
    async render(container) {
      container.innerHTML = `<div class="tabs" data-tabs><button class="tab active" data-tab="leads">Leads</button><button class="tab" data-tab="lists">Lead lists</button></div><div data-panel></div>`;
      const panel = qs("[data-panel]", container);
      let current = null;

      function showLeads() {
        current = Table({
          mount: panel,
          endpoint: "/platform/leads",
          searchPlaceholder: "Search business, phone, category…",
          defaultSort: { by: "createdAt", dir: "desc" },
          selectable: true,
          exportPath: false,
          exportName: "leads",
          emptyTitle: "No leads found",
          filters: [
            { name: "status", label: "Status", type: "select", options: ["NEW", "CONTACTED", "REPLIED", "QUALIFIED", "WON", "LOST"] },
            { name: "priority", label: "Priority", type: "select", options: ["HOT", "WARM", "COLD"] },
          ],
          columns: [
            { key: "businessName", label: "Business", sortable: "businessName", render: (r) => `<div><div class="cell-strong truncate">${esc(r.businessName)}</div><div class="cell-sub truncate">${esc(r.category || r.address || "")}</div></div>` },
            { key: "tenant", label: "Workspace", render: (r) => `<span class="small">${esc((r.tenant && r.tenant.name) || "—")}</span>` },
            { key: "phone", label: "Phone", render: (r) => `<span class="small mono">${esc(r.phone || "—")}</span>` },
            { key: "leadScore", label: "Score", sortable: "leadScore", align: "right", render: (r) => `<span class="nums">${r.leadScore}</span>` },
            { key: "leadPriority", label: "Priority", sortable: "leadPriority", render: (r) => Cell.badge(r.leadPriority, r.leadPriority === "HOT" ? "danger" : r.leadPriority === "WARM" ? "warning" : "neutral") },
            { key: "status", label: "Status", sortable: "status", render: (r) => Cell.badge(r.status, "neutral") },
            { key: "createdAt", label: "Added", sortable: "createdAt", nowrap: true, render: (r) => `<span class="small muted">${Fmt.date(r.createdAt)}</span>` },
          ],
          bulkActions: [{ label: "Delete", action: "delete", danger: true, confirm: "Permanently delete the selected leads.", run: (ids) => Api.post("/platform/leads/bulk", { action: "delete", ids }) }],
        });
      }

      function showLists() {
        current = Table({
          mount: panel,
          endpoint: "/platform/lead-lists",
          searchPlaceholder: "Search list name, type or location…",
          defaultSort: { by: "createdAt", dir: "desc" },
          selectable: true,
          exportPath: false,
          exportName: "lead-lists",
          emptyTitle: "No lead lists",
          columns: [
            { key: "name", label: "List", sortable: "name", render: (r) => `<div><div class="cell-strong truncate">${esc(r.name)}</div><div class="cell-sub">${esc(r.businessType || "")} · ${esc(r.location || "")}</div></div>` },
            { key: "tenant", label: "Workspace", render: (r) => `<span class="small">${esc((r.tenant && r.tenant.name) || "—")}</span>` },
            { key: "leads", label: "Leads", sortable: "leads", align: "right", render: (r) => `<span class="nums">${Fmt.num(r._count.leads)}</span>` },
            { key: "createdAt", label: "Created", sortable: "createdAt", nowrap: true, render: (r) => `<span class="small muted">${Fmt.date(r.createdAt)}</span>` },
          ],
          rowActions: (row) => [{ label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) }],
          bulkActions: [{ label: "Delete", action: "delete", danger: true, confirm: "Delete the selected lists and every lead inside them.", run: (ids) => Api.post("/platform/lead-lists/bulk", { action: "delete", ids }) }],
        });
      }

      async function remove(list) {
        await Modal.confirm({
          title: "Delete lead list",
          message: `Delete <strong>${esc(list.name)}</strong> and its ${Fmt.num(list._count.leads)} leads?`,
          confirmLabel: "Delete",
          danger: true,
          onConfirm: async () => {
            await Api.del(`/platform/lead-lists/${list.id}`);
            Toast.success("Lead list deleted.");
            current.reload();
          },
        });
      }

      qs("[data-tabs]", container).addEventListener("click", (e) => {
        const tab = e.target.closest("[data-tab]");
        if (!tab) return;
        qsa("[data-tab]", container).forEach((t) => t.classList.toggle("active", t === tab));
        if (tab.dataset.tab === "leads") showLeads();
        else showLists();
      });

      showLeads();
      return { refresh: () => current && current.reload() };
    },
  };

  // ── VISITORS ─────────────────────────────────────────────────────────────────

  Pages.visitors = {
    title: "Website traffic",
    subtitle: "Page views, unique visitors and where they come from.",
    async render(container, ctx) {
      let days = 30;
      container.innerHTML =
        `<div class="row row-wrap mb-2"><div class="segmented" data-range>` +
        [
          [7, "7d"],
          [30, "30d"],
          [90, "90d"],
        ]
          .map(([v, l]) => `<button data-days="${v}"${v === days ? ' class="active"' : ""}>${l}</button>`)
          .join("") +
        `</div></div>` +
        `<div class="kpi-grid mb-2" data-kpis></div>` +
        `<div class="card mb-2"><div class="card-head"><h3>Traffic over time</h3><div class="spacer"></div><div class="segmented" data-metric><button data-m="views" class="active">Views</button><button data-m="uniqueVisitors">Unique</button></div></div><div class="card-body"><div id="visChart" style="min-height:250px"></div></div></div>` +
        `<div class="grid-chart-side mb-2">` +
        `<div class="card"><div class="card-head"><h3>Top pages</h3></div><div class="card-body"><div id="visPages"></div></div></div>` +
        `<div class="card"><div class="card-head"><h3>Devices</h3></div><div class="card-body"><div id="visDevices" style="min-height:180px"></div></div></div>` +
        `</div>` +
        `<div class="card"><div class="card-head"><h3>Top referrers</h3></div><div class="card-body"><div id="visReferrers"></div></div></div>`;

      let data = null;
      async function load() {
        data = await Api.get("/platform/visitors", { days });
        draw();
      }
      function draw() {
        const t = data.totals;
        qs("[data-kpis]", container).innerHTML = [
          { label: "Views (period)", value: Fmt.compact(t.window), icon: "eye", tone: "brand", delta: t.previousWindow ? Math.round(((t.window - t.previousWindow) / t.previousWindow) * 1000) / 10 : null, sub: `${Fmt.compact(t.allTime)} all time` },
          { label: "Unique visitors", value: Fmt.compact(t.uniqueWindow), icon: "users", tone: "cyan", sub: `${t.viewsPerVisitor} views each` },
          { label: "Today", value: Fmt.compact(t.today), icon: "activity", tone: "success", sub: `${t.uniqueToday} unique` },
          { label: "Views / visitor", value: t.viewsPerVisitor, icon: "trending", tone: "purple", sub: "engagement proxy" },
        ]
          .map(Pages._shared.kpiCard)
          .join("");

        drawChart("views");
        global.Charts.hbars(qs("#visPages", container), { data: data.topPages.map((p) => ({ label: p.path, value: p.views, suffix: `· ${p.visitors} uniq` })), monochrome: true, limit: 12 });
        global.Charts.donut(qs("#visDevices", container), { data: data.devices.map((d) => ({ label: d.label, value: d.value })), pie: true, height: 180 });
        global.Charts.hbars(qs("#visReferrers", container), { data: data.topReferrers.map((r) => ({ label: r.source, value: r.views })), limit: 12 });
      }
      function drawChart(metric) {
        global.Charts.area(qs("#visChart", container), {
          series: [{ key: metric, label: metric === "views" ? "Page views" : "Unique visitors", data: data.series[metric], color: metric === "views" ? "var(--c1)" : "var(--c2)" }],
          height: 250,
          format: Fmt.compact,
        });
      }

      qs("[data-range]", container).addEventListener("click", (e) => {
        const b = e.target.closest("[data-days]");
        if (!b) return;
        days = Number(b.dataset.days);
        qsa("[data-days]", container).forEach((x) => x.classList.toggle("active", x === b));
        load();
      });
      qs("[data-metric]", container).addEventListener("click", (e) => {
        const b = e.target.closest("[data-m]");
        if (!b) return;
        qsa("[data-m]", container).forEach((x) => x.classList.toggle("active", x === b));
        drawChart(b.dataset.m);
      });

      await load();
      return { refresh: load };
    },
  };

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────────

  Pages.audit = {
    title: "Audit log",
    subtitle: "Every security and administrative event, in order.",
    async render(container) {
      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-danger-soft" data-purge>${icon("trash")} Purge old events</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/platform/audit",
        exportPath: "/platform/audit/export",
        searchPlaceholder: "Search action, IP, email or metadata…",
        defaultSort: { by: "createdAt", dir: "desc" },
        pageSize: 50,
        emptyTitle: "No audit events",
        filters: [
          { name: "category", label: "Category", type: "select", options: [{ value: "auth", label: "Authentication" }, { value: "admin", label: "Admin actions" }, { value: "failure", label: "Failures" }] },
        ],
        columns: [
          { key: "createdAt", label: "Time", sortable: "createdAt", nowrap: true, render: (r) => `<span class="small" title="${esc(Fmt.dateTime(r.createdAt))}">${Fmt.ago(r.createdAt)}</span>` },
          { key: "action", label: "Action", sortable: "action", render: (r) => `<span class="row" style="gap:7px"><span class="feed-dot ${Pages._shared.feedDotClass(r.action)}"></span>${Cell.badge(r.action, "neutral")}</span>` },
          { key: "user", label: "User", render: (r) => `<span class="small">${esc((r.user && r.user.email) || "—")}</span>` },
          { key: "ip", label: "IP", sortable: "ip", render: (r) => `<span class="mono small">${esc(r.ip || "—")}</span>` },
          { key: "metadata", label: "Detail", render: (r) => renderMeta(r.metadata) },
        ],
        rowActions: (row) => [{ label: "Inspect", icon: "eye", iconOnly: true, run: () => inspect(row) }],
      });

      function renderMeta(raw) {
        if (!raw) return Cell.empty();
        try {
          const obj = JSON.parse(raw);
          const keys = Object.keys(obj).slice(0, 2);
          return `<span class="small muted truncate" style="max-width:280px;display:inline-block">${esc(keys.map((k) => `${k}: ${JSON.stringify(obj[k])}`).join(", "))}</span>`;
        } catch (_) {
          return `<span class="small muted">${esc(String(raw).slice(0, 60))}</span>`;
        }
      }

      function inspect(row) {
        let pretty = row.metadata;
        try {
          pretty = JSON.stringify(JSON.parse(row.metadata), null, 2);
        } catch (_) {
          /* leave as-is */
        }
        Modal.open({
          title: Fmt.title(row.action),
          subtitle: Fmt.dateTime(row.createdAt),
          body:
            `<dl class="dl mb-2"><dt>Action</dt><dd class="mono">${esc(row.action)}</dd>` +
            `<dt>User</dt><dd>${esc((row.user && row.user.email) || row.userId || "—")}</dd>` +
            `<dt>IP</dt><dd class="mono">${esc(row.ip || "—")}</dd>` +
            `<dt>Tenant</dt><dd class="mono">${esc(row.tenantId || "—")}</dd>` +
            `<dt>User agent</dt><dd class="small">${esc(row.userAgent || "—")}</dd></dl>` +
            (pretty ? `<h3 class="small strong mb-1">Metadata</h3><pre class="card card-pad mono small" style="overflow:auto;white-space:pre-wrap">${esc(pretty)}</pre>` : ""),
          footer: null,
        });
      }

      qs("[data-purge]", container).addEventListener("click", () => {
        Modal.form({
          title: "Purge old audit events",
          subtitle: "Deletes events older than the retention window. Minimum 30 days.",
          fields: [
            { name: "olderThanDays", label: "Delete events older than (days)", type: "number", min: 30, value: 365, required: true },
            { name: "confirm", label: "I understand this permanently deletes audit history", type: "checkbox" },
          ],
          submitLabel: "Purge events",
          onSubmit: async (values) => {
            if (!values.confirm) throw new UI.ApiError(400, "confirm", "Tick the box to confirm the purge.");
            const res = await Api.post("/platform/audit/purge", values);
            Toast.success(`Purged ${res.deleted} event(s).`);
            table.reload();
          },
        });
      });

      return { refresh: () => table.reload() };
    },
  };

  // ── FEATURE FLAGS ─────────────────────────────────────────────────────────────

  Pages.flags = {
    title: "Feature flags",
    subtitle: "Turn capabilities on or off, or roll them out to a fraction of accounts.",
    async render(container) {
      let audiences = ["all", "plan:free", "plan:pro", "plan:custom", "role:admin"];

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions"><button class="btn btn-primary" data-new>${icon("plus")} New flag</button></div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/platform/flags",
        exportPath: false,
        search: true,
        searchPlaceholder: "Search flag key or name…",
        selectable: true,
        emptyTitle: "No feature flags",
        emptyMessage: "Create a flag to gate a capability at runtime.",
        columns: [
          { key: "name", label: "Flag", render: (r) => `<div><div class="cell-strong">${esc(r.name)}</div><div class="cell-sub mono">${esc(r.key)}</div></div>` },
          { key: "enabled", label: "State", render: (r) => Cell.dotBadge(r.enabled ? "enabled" : "disabled", r.enabled ? "success" : "neutral") },
          { key: "rolloutPercent", label: "Rollout", align: "right", render: (r) => `<span class="row" style="gap:8px;justify-content:flex-end"><span class="nums small">${r.rolloutPercent}%</span>${Cell.meter(r.rolloutPercent, "success")}</span>` },
          { key: "audience", label: "Audience", render: (r) => Cell.badge(r.audience, "neutral") },
          { key: "updatedAt", label: "Updated", nowrap: true, render: (r) => `<span class="small muted">${Fmt.ago(r.updatedAt)}${r.updatedBy ? `<br><span class="faint">${esc(r.updatedBy)}</span>` : ""}</span>` },
        ],
        onLoad: (payload) => {
          if (payload.options && payload.options.audiences) audiences = payload.options.audiences;
        },
        rowActions: (row) => [
          { label: row.enabled ? "Disable" : "Enable", icon: row.enabled ? "ban" : "check", iconOnly: true, run: async () => {
            await Api.patch(`/platform/flags/${row.id}`, { enabled: !row.enabled });
            Toast.success(row.enabled ? "Flag disabled." : "Flag enabled.");
            table.reload();
          } },
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          { label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) },
        ],
        bulkActions: [
          { label: "Enable", action: "enable", run: (ids) => Api.post("/platform/flags/bulk", { action: "enable", ids }) },
          { label: "Disable", action: "disable", run: (ids) => Api.post("/platform/flags/bulk", { action: "disable", ids }) },
          { label: "Delete", action: "delete", danger: true, confirm: "Delete the selected flags.", run: (ids) => Api.post("/platform/flags/bulk", { action: "delete", ids }) },
        ],
      });

      function flagFields(flag) {
        return [
          !flag ? { name: "key", label: "Flag key", required: true, placeholder: "e.g. new_campaign_builder", help: "Lowercase identifier used in code." } : { name: "keyStatic", type: "static", label: "Key", value: `<span class="mono strong">${esc(flag.key)}</span>` },
          { name: "name", label: "Name", required: true, value: flag && flag.name },
          { name: "description", label: "Description", type: "textarea", value: flag && flag.description },
          { name: "enabled", label: "Enabled", type: "checkbox", value: flag && flag.enabled },
          { name: "rolloutPercent", label: "Rollout %", type: "number", min: 0, max: 100, value: flag ? flag.rolloutPercent : 100 },
          { name: "audience", label: "Audience", type: "select", options: audiences, value: (flag && flag.audience) || "all" },
        ];
      }

      function openCreate() {
        Modal.form({ title: "New feature flag", fields: flagFields(null), submitLabel: "Create flag", onSubmit: async (v) => { await Api.post("/platform/flags", v); Toast.success("Flag created."); table.reload(); } });
      }
      function openEdit(flag) {
        Modal.form({ title: `Edit ${flag.name}`, fields: flagFields(flag), submitLabel: "Save", onSubmit: async (v) => { await Api.patch(`/platform/flags/${flag.id}`, v); Toast.success("Flag updated."); table.reload(); } });
      }
      async function remove(flag) {
        await Modal.confirm({ title: "Delete flag", message: `Delete <strong>${esc(flag.key)}</strong>?`, confirmLabel: "Delete", danger: true, onConfirm: async () => { await Api.del(`/platform/flags/${flag.id}`); Toast.success("Flag deleted."); table.reload(); } });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      return { refresh: () => table.reload() };
    },
  };

  // ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────

  Pages.announcements = {
    title: "Announcements",
    subtitle: "Operator messages shown in the product — maintenance, incidents, releases.",
    async render(container) {
      let options = { levels: ["info", "success", "warning", "critical"], audiences: ["all"] };

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions"><button class="btn btn-primary" data-new>${icon("plus")} New announcement</button></div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/platform/announcements",
        exportPath: false,
        searchPlaceholder: "Search title or body…",
        defaultSort: { by: "createdAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No announcements",
        filters: [{ name: "level", label: "Level", type: "select", options: options.levels }, { name: "active", label: "Active only", type: "toggle" }],
        columns: [
          { key: "title", label: "Title", sortable: "title", render: (r) => `<div><div class="cell-strong truncate" style="max-width:320px">${esc(r.title)}</div><div class="cell-sub truncate" style="max-width:320px">${esc(r.body)}</div></div>` },
          { key: "level", label: "Level", sortable: "level", render: (r) => Cell.badge(r.level, r.level === "critical" ? "danger" : r.level === "warning" ? "warning" : r.level === "success" ? "success" : "info") },
          { key: "audience", label: "Audience", render: (r) => Cell.badge(r.audience, "neutral") },
          { key: "isLive", label: "State", render: (r) => (r.isLive ? Cell.dotBadge("live", "success") : r.isActive ? Cell.badge("scheduled", "info") : Cell.badge("off", "neutral")) },
          { key: "publishedAt", label: "Published", sortable: "publishedAt", nowrap: true, render: (r) => `<span class="small muted">${r.publishedAt ? Fmt.date(r.publishedAt) : "—"}</span>` },
          { key: "expiresAt", label: "Expires", sortable: "expiresAt", nowrap: true, render: (r) => `<span class="small muted">${r.expiresAt ? Fmt.date(r.expiresAt) : "—"}</span>` },
        ],
        onLoad: (payload) => {
          if (payload.options) options = payload.options;
        },
        rowActions: (row) => [
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          { label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) },
        ],
        bulkActions: [
          { label: "Publish", action: "publish", run: (ids) => Api.post("/platform/announcements/bulk", { action: "publish", ids }) },
          { label: "Unpublish", action: "unpublish", run: (ids) => Api.post("/platform/announcements/bulk", { action: "unpublish", ids }) },
          { label: "Delete", action: "delete", danger: true, confirm: "Delete the selected announcements.", run: (ids) => Api.post("/platform/announcements/bulk", { action: "delete", ids }) },
        ],
      });

      function fields(a) {
        return [
          { name: "title", label: "Title", required: true, value: a && a.title },
          { name: "body", label: "Message", type: "textarea", required: true, rows: 4, value: a && a.body },
          { name: "level", label: "Level", type: "select", options: options.levels, value: (a && a.level) || "info" },
          { name: "audience", label: "Audience", type: "select", options: options.audiences, value: (a && a.audience) || "all" },
          { name: "publishedAt", label: "Publish at", type: "date", value: a ? Fmt.dateInput(a.publishedAt) : Fmt.dateInput(new Date()) },
          { name: "expiresAt", label: "Expires at (optional)", type: "date", value: a ? Fmt.dateInput(a.expiresAt) : "" },
          { name: "isActive", label: "Active", type: "checkbox", value: a ? a.isActive : true },
        ];
      }

      function openCreate() {
        Modal.form({ title: "New announcement", size: "lg", fields: fields(null), submitLabel: "Create", onSubmit: async (v) => { await Api.post("/platform/announcements", v); Toast.success("Announcement created."); table.reload(); } });
      }
      function openEdit(a) {
        Modal.form({ title: "Edit announcement", size: "lg", fields: fields(a), submitLabel: "Save", onSubmit: async (v) => { await Api.patch(`/platform/announcements/${a.id}`, v); Toast.success("Announcement updated."); table.reload(); } });
      }
      async function remove(a) {
        await Modal.confirm({ title: "Delete announcement", message: `Delete <strong>${esc(a.title)}</strong>?`, confirmLabel: "Delete", danger: true, onConfirm: async () => { await Api.del(`/platform/announcements/${a.id}`); Toast.success("Deleted."); table.reload(); } });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      return { refresh: () => table.reload() };
    },
  };

  // ── SETTINGS ──────────────────────────────────────────────────────────────────

  Pages.settings = {
    title: "Platform settings",
    subtitle: "Operator-editable configuration. Secrets stay in the environment, not here.",
    async render(container) {
      let payload = null;

      async function load() {
        try {
          payload = await Api.get("/platform/settings");
        } catch (err) {
          container.innerHTML = `<div class="notice notice-error">${icon("alert")}<div>${esc(err.message)}</div></div>`;
          return;
        }
        draw();
      }

      function draw() {
        const byCategory = {};
        payload.rows.forEach((row) => {
          (byCategory[row.category] = byCategory[row.category] || []).push(row);
        });

        container.innerHTML =
          `<form data-settings>` +
          Object.keys(byCategory)
            .map(
              (category) =>
                `<div class="card mb-2"><div class="card-head"><h3>${esc(Fmt.title(category))}</h3></div><div class="card-body">` +
                byCategory[category].map(settingRow).join("") +
                `</div></div>`
            )
            .join("") +
          `<div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" type="button" data-reset-all>Revert changes</button><button class="btn btn-primary" type="button" data-save>${icon("check")} Save settings</button></div>` +
          `</form>`;

        qs("[data-save]", container).addEventListener("click", save);
        qs("[data-reset-all]", container).addEventListener("click", load);
        qsa("[data-revert]", container).forEach((b) => b.addEventListener("click", () => revert(b.dataset.revert)));
      }

      function settingRow(row) {
        const id = `set_${row.key.replace(/\./g, "_")}`;
        let control;
        if (row.type === "boolean") {
          control = `<label class="row" style="cursor:pointer;gap:8px"><input class="check" type="checkbox" data-key="${esc(row.key)}" data-type="boolean"${row.value ? " checked" : ""} /><span class="small">${row.value ? "Enabled" : "Disabled"}</span></label>`;
        } else if (row.type === "number") {
          control = `<input class="input" id="${id}" data-key="${esc(row.key)}" data-type="number" type="number" value="${esc(row.value)}" style="max-width:220px" />`;
        } else {
          control = `<input class="input" id="${id}" data-key="${esc(row.key)}" data-type="string" value="${esc(row.value)}" style="max-width:360px" />`;
        }
        return (
          `<div class="field" style="border-bottom:1px solid var(--border);padding-bottom:12px">` +
          `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">` +
          `<div style="flex:1"><label class="field-label" for="${id}">${esc(row.label)}${row.isDefault ? "" : ` <span class="badge badge-brand" style="font-size:0.6rem">customised</span>`}${row.orphan ? ` <span class="badge badge-warning" style="font-size:0.6rem">orphan</span>` : ""}</label>` +
          `<div class="field-help">${esc(row.description || "")}<span class="mono faint"> · ${esc(row.key)}</span></div></div>` +
          `<div style="flex-shrink:0">${control}${row.isDefault ? "" : `<button class="link small" type="button" data-revert="${esc(row.key)}" style="margin-top:4px">Reset to default</button>`}</div>` +
          `</div></div>`
        );
      }

      function collect() {
        return qsa("[data-key]", container).map((input) => ({
          key: input.dataset.key,
          value: input.dataset.type === "boolean" ? input.checked : input.dataset.type === "number" ? Number(input.value) : input.value,
        }));
      }

      async function save() {
        const button = qs("[data-save]", container);
        button.disabled = true;
        try {
          const res = await Api.put("/platform/settings", { settings: collect() });
          Toast.success(`Saved ${res.updated} setting(s).`);
          load();
        } catch (err) {
          Toast.fromError(err);
          button.disabled = false;
        }
      }

      async function revert(key) {
        try {
          await Api.del(`/platform/settings/${encodeURIComponent(key)}`);
          Toast.success("Reverted to default.");
          load();
        } catch (err) {
          Toast.fromError(err);
        }
      }

      await load();
      return { refresh: load };
    },
  };

  // ── SYSTEM HEALTH ─────────────────────────────────────────────────────────────

  Pages.health = {
    title: "System health",
    subtitle: "A live probe of the services and configuration this platform depends on.",
    async render(container) {
      async function load() {
        let data;
        try {
          data = await Api.get("/platform/health");
        } catch (err) {
          container.innerHTML = `<div class="notice notice-error">${icon("alert")}<div>${esc(err.message)}</div></div>`;
          return;
        }
        draw(data);
      }

      function draw(data) {
        const overall = data.status;
        const rt = data.runtime;
        const db = data.database;
        const memPct = rt.systemMemoryMb ? Math.round(((rt.systemMemoryMb - rt.freeMemoryMb) / rt.systemMemoryMb) * 100) : 0;

        container.innerHTML =
          `<div class="notice ${overall === "fail" ? "notice-error" : overall === "warn" ? "notice-warn" : "notice-success"} mb-2">${icon(overall === "ok" ? "check" : "alert")}` +
          `<div><strong>${overall === "ok" ? "All systems operational." : overall === "warn" ? "Operational with warnings." : "Action required."}</strong> Probed in ${data.probeMs}ms.</div></div>` +
          `<div class="grid-2 mb-2">` +
          `<div class="card"><div class="card-head"><h3>Checks</h3></div><div>${data.checks.map(checkRow).join("")}</div></div>` +
          `<div class="col" style="gap:12px">` +
          `<div class="card"><div class="card-head"><h3>Runtime</h3></div><div class="card-body"><dl class="dl">` +
          `<dt>Environment</dt><dd>${esc(rt.environment)}</dd>` +
          `<dt>Node</dt><dd class="mono">${esc(rt.nodeVersion)} · ${esc(rt.platform)}</dd>` +
          `<dt>Uptime</dt><dd>${Fmt.duration(rt.uptimeSeconds)}</dd>` +
          `<dt>Heap</dt><dd class="nums">${rt.heapUsedMb} / ${rt.heapTotalMb} MB</dd>` +
          `<dt>RSS</dt><dd class="nums">${rt.rssMb} MB</dd>` +
          `<dt>System memory</dt><dd class="nums">${memPct}% of ${Fmt.compact(rt.systemMemoryMb)} MB used</dd>` +
          `<dt>CPUs</dt><dd class="nums">${rt.cpuCount} · load ${rt.loadAverage.join(", ")}</dd>` +
          `</dl></div></div>` +
          `<div class="card"><div class="card-head"><h3>Database</h3></div><div class="card-body"><dl class="dl">` +
          `<dt>Reachable</dt><dd>${db.reachable ? "Yes" : "No"}${db.latencyMs !== null ? ` (${db.latencyMs}ms)` : ""}</dd>` +
          `<dt>Host</dt><dd class="mono small">${esc(db.host || "—")}</dd>` +
          Object.keys(db.tables || {}).map((t) => `<dt>${esc(Fmt.title(t))}</dt><dd class="nums">${Fmt.num(db.tables[t])}</dd>`).join("") +
          `</dl></div></div>` +
          `</div></div>` +
          (Object.keys(data.jobs || {}).length
            ? `<div class="card"><div class="card-head"><h3>Background jobs</h3></div><div class="card-body"><div class="chip-row">${Object.keys(data.jobs).map((s) => `<span class="chip" style="cursor:default">${esc(Fmt.title(s))}: <strong>${data.jobs[s]}</strong></span>`).join("")}</div></div></div>`
            : "");
      }

      function checkRow(c) {
        return `<div class="check-row"><div class="check-led ${c.status}"></div><div><div class="check-label">${esc(c.label)}</div><div class="check-detail">${esc(c.detail)}</div></div></div>`;
      }

      await load();
      return { refresh: load };
    },
  };
})(window);
