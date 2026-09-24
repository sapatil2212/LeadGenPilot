/*
 * Billing pages: Revenue overview, Subscriptions, Invoices, Payments, Plans.
 *
 * These share one idea the rest of the console does not have to worry about:
 * money is minor units on the wire, so every amount goes through UI.Fmt.money
 * on the way out and UI.Fmt.toMinor (via the form "money" field) on the way in,
 * and nothing here does its own division.
 *
 * The subscription and invoice/payment forms are the most involved because
 * their server routes enforce cross-record invariants — a payment cannot
 * over-pay an invoice, a plan change re-derives users.plan — so the forms only
 * have to collect input honestly; they do not attempt to duplicate those checks
 * client-side, which would only drift.
 */
(function (global) {
  "use strict";

  const { esc, icon, Fmt, Api, Toast, Modal, Table, Cell, Tone, qs, copyText } = global.UI;
  const Pages = (global.Pages = global.Pages || {});
  const { kpiCard, chartCard } = Pages._shared;

  const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];

  // ── BILLING OVERVIEW ───────────────────────────────────────────────────────

  Pages.billing = {
    title: "Revenue",
    subtitle: "Recurring revenue, collections and the health of the subscription base.",
    async render(container, ctx) {
      let months = 12;
      container.innerHTML =
        `<div class="row row-wrap mb-2"><div class="page-head-actions" style="margin:0">` +
        `<div class="segmented" data-months>` +
        [
          [6, "6m"],
          [12, "12m"],
          [24, "24m"],
        ]
          .map(([v, l]) => `<button data-m="${v}"${v === months ? ' class="active"' : ""}>${l}</button>`)
          .join("") +
        `</div>` +
        `<button class="btn" data-go="subscriptions">${icon("repeat")} Subscriptions</button>` +
        `<button class="btn" data-go="invoices">${icon("receipt")} Invoices</button>` +
        `<button class="btn" data-go="plans">${icon("tag")} Plans</button>` +
        `</div></div>` +
        `<div class="kpi-grid mb-2" data-kpis></div>` +
        `<div class="grid-chart-side mb-2">` +
        chartCard("Invoiced vs collected", "billRevenue", { extra: `<div class="segmented" data-view><button data-v="revenue" class="active">Revenue</button><button data-v="subs">New subs</button></div>` }) +
        `<div class="card"><div class="card-head"><h3>Revenue by plan</h3></div><div class="card-body"><div id="billPlan" style="min-height:200px"></div></div></div>` +
        `</div>` +
        `<div class="grid-3 mb-2">` +
        `<div class="card"><div class="card-head"><h3>Subscription status</h3></div><div class="card-body"><div id="billSubStatus" style="min-height:170px"></div></div></div>` +
        `<div class="card"><div class="card-head"><h3>Payment methods</h3></div><div class="card-body"><div id="billMethods" style="min-height:170px"></div></div></div>` +
        `<div class="card"><div class="card-head"><h3>Billing cycle</h3></div><div class="card-body"><div id="billCycle" style="min-height:170px"></div></div></div>` +
        `</div>` +
        `<div class="grid-2">` +
        `<div class="card"><div class="card-head"><h3>Renewals in the next 30 days</h3></div><div id="billRenewals" class="table-scroll"></div></div>` +
        `<div class="card"><div class="card-head"><h3>Top customers by revenue</h3></div><div class="card-body"><div id="billTop"></div></div></div>` +
        `</div>`;

      let metrics = null;

      async function load() {
        metrics = await Api.get("/billing/metrics", { months });
        draw();
      }

      function draw() {
        const k = metrics.kpis;
        const cur = metrics.currency || ctx.currency;
        const money = (v) => Fmt.money(v, cur, { compact: true, decimals: false });
        const moneyFull = (v) => Fmt.money(v, cur, { decimals: false });

        qs("[data-kpis]", container).innerHTML = [
          { label: "MRR", value: money(k.mrr), icon: "trending", tone: "success", sub: `${money(k.arr)} annualised` },
          { label: "ARPU", value: money(k.arpu), icon: "users", tone: "brand", sub: `${k.payingSubscriptions} paying` },
          { label: "Collected this month", value: money(k.collectedThisMonth), icon: "card", tone: "cyan", delta: k.collectedThisMonthDelta, sub: `${money(k.collectedAllTime)} all time` },
          { label: "Outstanding", value: money(k.outstanding), icon: "receipt", tone: k.outstanding > 0 ? "warning" : "success", sub: `${k.outstandingCount} unpaid` },
          { label: "Overdue", value: money(k.overdue), icon: "clock", tone: k.overdue > 0 ? "danger" : "success", sub: `${k.overdueCount} past due` },
          { label: "Churn (30d)", value: Fmt.percent(k.churnRate), icon: "activity", tone: k.churnRate > 5 ? "warning" : "success", delta: k.churnedDelta, sub: `${k.churnedThisMonth} canceled` },
          { label: "Est. LTV", value: money(k.lifetimeValue), icon: "heart", tone: "purple", sub: "ARPU ÷ churn" },
          { label: "Refunded", value: money(k.refundedAllTime), icon: "repeat", tone: "neutral", sub: "all time" },
        ]
          .map(kpiCard)
          .join("");

        drawRevenue("revenue");

        global.Charts.donut(qs("#billPlan", container), {
          data: metrics.distributions.planRevenue.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          centerLabel: "MRR-ish",
          format: money,
          height: 200,
          onSelect: (d) => (d ? ctx.navigate("subscriptions", { planKey: d.rawLabel || d.label.toLowerCase() }) : null),
        });
        global.Charts.donut(qs("#billSubStatus", container), {
          data: metrics.distributions.subscriptionStatus.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          centerLabel: "subs",
          height: 170,
        });
        global.Charts.donut(qs("#billMethods", container), {
          data: metrics.distributions.paymentMethod.map((d) => ({ label: Fmt.title(d.label), value: d.value })),
          pie: true,
          format: money,
          height: 170,
        });
        global.Charts.bars(qs("#billCycle", container), {
          categories: metrics.distributions.billingCycle.map((d) => Fmt.title(d.label)),
          series: [{ key: "n", label: "Subscriptions", values: metrics.distributions.billingCycle.map((d) => d.value) }],
          height: 170,
          legend: false,
        });

        qs("#billRenewals", container).innerHTML = metrics.upcomingRenewals.length
          ? `<table class="data"><thead><tr><th>Customer</th><th>Plan</th><th class="num">Amount</th><th>Renews</th></tr></thead><tbody>` +
            metrics.upcomingRenewals
              .map(
                (s) =>
                  `<tr><td>${esc(s.user ? s.user.email : "—")}</td><td>${Cell.badge(s.planKey, Tone.of(Tone.plan, s.planKey))}</td>` +
                  `<td class="num nums">${moneyFull(s.amount)}</td><td class="small">${esc(Fmt.date(s.currentPeriodEnd))} <span class="faint">(${s.daysRemaining}d)</span></td></tr>`
              )
              .join("") +
            `</tbody></table>`
          : '<div class="empty small" style="padding:22px">No renewals due in the next 30 days.</div>';

        global.Charts.hbars(qs("#billTop", container), {
          data: metrics.topCustomers.map((c) => ({ label: c.user ? c.user.email : "Unknown", value: c.total })),
          format: money,
          monochrome: true,
        });
      }

      function drawRevenue(view) {
        if (view === "subs") {
          global.Charts.bars(qs("#billRevenue", container), {
            categories: metrics.revenueSeries.map((r) => r.label),
            series: [{ key: "new", label: "New subscriptions", values: metrics.revenueSeries.map((r) => r.newSubscriptions) }],
            height: 250,
            legend: false,
          });
        } else {
          global.Charts.area(qs("#billRevenue", container), {
            series: [
              { key: "invoiced", label: "Invoiced", data: metrics.revenueSeries.map((r) => ({ label: r.label, value: r.invoiced })), color: "var(--c1)" },
              { key: "collected", label: "Collected", data: metrics.revenueSeries.map((r) => ({ label: r.label, value: r.collected })), color: "var(--c3)" },
            ],
            height: 250,
            xLabel: (l) => l,
            xTitle: (l) => l,
            format: (v) => Fmt.money(v, metrics.currency || ctx.currency, { compact: true, decimals: false }),
          });
        }
      }

      qs("[data-months]", container).addEventListener("click", (e) => {
        const b = e.target.closest("[data-m]");
        if (!b) return;
        months = Number(b.dataset.m);
        qs("[data-months]", container).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        load();
      });
      qs("[data-view]", container).addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return;
        qs("[data-view]", container).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        drawRevenue(b.dataset.v);
      });
      container.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => ctx.navigate(b.dataset.go)));

      await load();
      return { refresh: load };
    },
  };

  // ── Customer picker field, shared by billing forms ───────────────────────────

  function customerField(required, help) {
    return {
      name: "userId",
      label: "Customer",
      type: "remote-select",
      endpoint: "/billing/customers",
      required: !!required,
      placeholder: "Search by name or email…",
      labelOf: (r) => `${r.email}${r.name ? ` (${r.name})` : ""}`,
      help: help || null,
    };
  }

  // ── SUBSCRIPTIONS ──────────────────────────────────────────────────────────

  Pages.subscriptions = {
    title: "Subscriptions",
    subtitle: "Commercial agreements. Creating or changing one keeps the customer's plan in sync.",
    async render(container, ctx) {
      let options = { statuses: [], cycles: [], plans: [], currencies: CURRENCIES };

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} New subscription</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/billing/subscriptions",
        exportPath: "/billing/subscriptions/export",
        searchPlaceholder: "Search customer or reference…",
        defaultSort: { by: "createdAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No subscriptions yet",
        emptyMessage: "Create a subscription to start tracking recurring revenue.",
        filters: [
          { name: "status", label: "Status", type: "select", options: options.statuses },
          { name: "planKey", label: "Plan", type: "select", options: options.plans },
          { name: "billingCycle", label: "Cycle", type: "select", options: options.cycles },
          { name: "expiringSoon", label: "Expiring 30d", type: "toggle" },
        ],
        summary: (payload) =>
          payload.summary
            ? `<div class="notice" style="margin:12px;border-radius:8px">${icon("info")}<div>${payload.summary.count} matching · total contract value ${Fmt.money(payload.summary.amountSum, ctx.currency, { decimals: false })} per cycle</div></div>`
            : "",
        columns: [
          { key: "user", label: "Customer", render: (r) => Cell.user(r.user || {}) },
          { key: "planKey", label: "Plan", sortable: "planKey", render: (r) => Cell.badge(r.planKey, Tone.of(Tone.plan, r.planKey)) },
          { key: "status", label: "Status", sortable: "status", render: (r) => Cell.dotBadge(r.status, Tone.of(Tone.subscription, r.status)) + (r.cancelAtPeriodEnd ? ` ${Cell.badge("ending", "warning")}` : "") },
          { key: "billingCycle", label: "Cycle", sortable: "billingCycle", render: (r) => `<span class="small">${esc(Fmt.title(r.billingCycle))}</span>` },
          { key: "amount", label: "Amount", sortable: "amount", align: "right", render: (r) => `<span class="nums strong">${Fmt.money(r.amount, r.currency, { decimals: false })}</span>` },
          { key: "monthlyValue", label: "MRR", align: "right", render: (r) => `<span class="nums">${Fmt.money(r.monthlyValue, r.currency, { decimals: false })}</span>` },
          {
            key: "currentPeriodEnd",
            label: "Renews",
            sortable: "currentPeriodEnd",
            nowrap: true,
            render: (r) => `<span class="small ${r.daysRemaining < 0 ? "" : ""}" title="${esc(Fmt.dateTime(r.currentPeriodEnd))}">${Fmt.date(r.currentPeriodEnd)}<br><span class="faint">${r.daysRemaining < 0 ? "expired" : r.daysRemaining + "d left"}</span></span>`,
          },
        ],
        onLoad: (payload) => {
          if (payload.options) options = payload.options;
        },
        onRowClick: (row) => openDetail(row.id),
        rowActions: (row) => [
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          row.status !== "canceled"
            ? { label: "Cancel", icon: "ban", iconOnly: true, danger: true, run: () => cancel(row) }
            : { label: "Resume", icon: "check", iconOnly: true, run: () => resume(row) },
        ],
        bulkActions: [
          { label: "Cancel at period end", action: "cancel", danger: true, confirm: "The selected subscriptions will not renew, but keep access until their period ends.", run: (ids) => Api.post("/billing/subscriptions/bulk", { action: "cancel", ids }) },
          { label: "Activate", action: "activate", run: (ids) => Api.post("/billing/subscriptions/bulk", { action: "activate", ids }) },
          { label: "Mark past due", action: "mark-past-due", run: (ids) => Api.post("/billing/subscriptions/bulk", { action: "mark-past-due", ids }) },
          { label: "Delete", action: "delete", danger: true, confirm: "Permanently delete the selected subscription records.", run: (ids) => Api.post("/billing/subscriptions/bulk", { action: "delete", ids }) },
        ],
      });

      function subFields(sub) {
        return [
          !sub ? customerField(true, "The customer this agreement belongs to.") : { name: "userIdStatic", type: "static", label: "Customer", value: `<strong>${esc(sub.user ? sub.user.email : "—")}</strong>` },
          { name: "planKey", label: "Plan", type: "select", required: true, options: options.plans, value: sub && sub.planKey, help: "Changing the plan re-derives the customer's entitlements." },
          { name: "status", label: "Status", type: "select", options: options.statuses, value: (sub && sub.status) || "active" },
          { name: "billingCycle", label: "Billing cycle", type: "select", options: options.cycles, value: (sub && sub.billingCycle) || "monthly" },
          { name: "amount", label: "Amount per cycle", type: "money", currency: (sub && sub.currency) || ctx.currency, value: sub && sub.amount, help: "Leave blank on create to use the plan's catalogue price." },
          { name: "currency", label: "Currency", type: "select", options: options.currencies, value: (sub && sub.currency) || ctx.currency },
          { name: "seats", label: "Seats", type: "number", min: 1, value: (sub && sub.seats) || 1 },
          { name: "discountPercent", label: "Discount %", type: "number", min: 0, max: 100, value: (sub && sub.discountPercent) || 0 },
          { name: "currentPeriodStart", label: "Period start", type: "date", value: sub ? Fmt.dateInput(sub.currentPeriodStart) : "" },
          { name: "currentPeriodEnd", label: "Period end", type: "date", value: sub ? Fmt.dateInput(sub.currentPeriodEnd) : "", help: "Left blank on create, one cycle is added to the start." },
          { name: "cancelAtPeriodEnd", label: "Do not renew (cancel at period end)", type: "checkbox", value: sub && sub.cancelAtPeriodEnd },
          { name: "externalRef", label: "External reference", value: sub && sub.externalRef, placeholder: "Processor subscription id" },
          { name: "notes", label: "Notes", type: "textarea", value: sub && sub.notes },
        ].filter(Boolean);
      }

      function openCreate() {
        Modal.form({
          title: "New subscription",
          size: "lg",
          fields: subFields(null),
          submitLabel: "Create subscription",
          onSubmit: async (values) => {
            const res = await Api.post("/billing/subscriptions", values);
            Toast.success(`Subscription created. Customer plan set to ${res.userPlan}.`);
            table.reload();
          },
        });
      }

      function openEdit(sub) {
        Modal.form({
          title: "Edit subscription",
          subtitle: sub.user ? sub.user.email : "",
          size: "lg",
          fields: subFields(sub),
          submitLabel: "Save changes",
          extraFooter: sub.billingCycle !== "lifetime" ? `<button class="btn" type="button" data-renew>${icon("repeat")} Renew now</button>` : "",
          onSubmit: async (values) => {
            const res = await Api.patch(`/billing/subscriptions/${sub.id}`, values);
            Toast.success(`Subscription updated. Customer plan: ${res.userPlan}.`);
            table.reload();
          },
        });
        setTimeout(() => {
          const b = qs("[data-renew]");
          if (b) b.addEventListener("click", () => renew(sub));
        }, 60);
      }

      async function renew(sub) {
        await Modal.confirm({
          title: "Renew subscription",
          message: `Roll <strong>${esc(sub.user ? sub.user.email : "")}</strong> into the next ${esc(sub.billingCycle)} period and issue an invoice for it?`,
          confirmLabel: "Renew and invoice",
          onConfirm: async () => {
            const res = await Api.post(`/billing/subscriptions/${sub.id}/renew`, {});
            Toast.success(`Renewed. Invoice ${res.invoice.number} issued.`);
            table.reload();
          },
        });
      }

      function cancel(sub) {
        Modal.form({
          title: "Cancel subscription",
          subtitle: sub.user ? sub.user.email : "",
          fields: [
            { name: "immediate", label: "Cancel immediately (end access now)", type: "checkbox", value: false, help: "Leave unticked to let access run to the end of the paid period." },
            { name: "reason", label: "Reason (optional)", type: "textarea" },
          ],
          submitLabel: "Cancel subscription",
          onSubmit: async (values) => {
            const res = await Api.post(`/billing/subscriptions/${sub.id}/cancel`, values);
            Toast.success(`Subscription canceled. Customer plan: ${res.userPlan}.`);
            table.reload();
          },
        });
      }

      async function resume(sub) {
        const res = await Api.post(`/billing/subscriptions/${sub.id}/resume`, {});
        Toast.success(`Subscription resumed. Customer plan: ${res.userPlan}.`);
        table.reload();
      }

      async function openDetail(id) {
        let data;
        try {
          data = await Api.get(`/billing/subscriptions/${id}`);
        } catch (err) {
          Toast.fromError(err);
          return;
        }
        const s = data.subscription;
        Modal.open({
          title: `${Fmt.title(s.planKey)} subscription`,
          subtitle: s.user ? s.user.email : "",
          size: "lg",
          body:
            `<div class="stat-strip mb-2">` +
            `<div><div class="l">Status</div><div class="v">${esc(Fmt.title(s.status))}</div></div>` +
            `<div><div class="l">Amount</div><div class="v nums">${Fmt.money(s.amount, s.currency, { decimals: false })}</div></div>` +
            `<div><div class="l">MRR</div><div class="v nums">${Fmt.money(s.monthlyValue, s.currency, { decimals: false })}</div></div>` +
            `<div><div class="l">Cycle</div><div class="v">${esc(Fmt.title(s.billingCycle))}</div></div>` +
            `</div>` +
            `<dl class="dl mb-2">` +
            `<dt>ID</dt><dd class="mono">${esc(s.id)}</dd>` +
            `<dt>Started</dt><dd>${esc(Fmt.dateTime(s.startedAt))}</dd>` +
            `<dt>Current period</dt><dd>${esc(Fmt.date(s.currentPeriodStart))} → ${esc(Fmt.date(s.currentPeriodEnd))}</dd>` +
            (s.trialEndsAt ? `<dt>Trial ends</dt><dd>${esc(Fmt.date(s.trialEndsAt))}</dd>` : "") +
            (s.canceledAt ? `<dt>Canceled</dt><dd>${esc(Fmt.dateTime(s.canceledAt))}</dd>` : "") +
            (s.cancelReason ? `<dt>Reason</dt><dd>${esc(s.cancelReason)}</dd>` : "") +
            (s.externalRef ? `<dt>External ref</dt><dd class="mono">${esc(s.externalRef)}</dd>` : "") +
            (s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : "") +
            `</dl>` +
            `<h3 class="small strong mb-1">Invoices (${s.invoiceCount})</h3>` +
            (data.invoices.length
              ? `<div class="table-scroll"><table class="data"><thead><tr><th>Number</th><th>Status</th><th class="num">Total</th><th>Issued</th></tr></thead><tbody>` +
                data.invoices
                  .map(
                    (inv) =>
                      `<tr><td class="mono">${esc(inv.number)}</td><td>${Cell.badge(inv.status, Tone.of(Tone.invoice, inv.status))}</td><td class="num nums">${Fmt.money(inv.total, inv.currency, { decimals: false })}</td><td class="small">${esc(Fmt.date(inv.issuedAt))}</td></tr>`
                  )
                  .join("") +
                `</tbody></table></div>`
              : '<p class="muted small">No invoices yet.</p>'),
          footer: `<div class="spacer"></div><button class="btn" data-copy>${icon("copy")} Copy ID</button><button class="btn btn-primary" data-edit>${icon("edit")} Edit</button>`,
          onMount: (h) => {
            qs("[data-copy]", h.overlay).addEventListener("click", () => copyText(s.id));
            qs("[data-edit]", h.overlay).addEventListener("click", () => {
              h.close();
              openEdit(s);
            });
          },
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      if (ctx.query && ctx.query.focus) setTimeout(() => openDetail(ctx.query.focus), 100);
      return { refresh: () => table.reload() };
    },
  };

  // ── INVOICES ───────────────────────────────────────────────────────────────

  Pages.invoices = {
    title: "Invoices",
    subtitle: "Bills issued to customers. Statuses are derived from recorded payments.",
    async render(container, ctx) {
      let options = { statuses: [], currencies: CURRENCIES };

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} New invoice</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/billing/invoices",
        exportPath: "/billing/invoices/export",
        searchPlaceholder: "Search number, customer or billing email…",
        defaultSort: { by: "issuedAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No invoices yet",
        filters: [
          { name: "status", label: "Status", type: "select", options: options.statuses },
          { name: "overdue", label: "Overdue only", type: "toggle" },
        ],
        summary: (payload) =>
          payload.summary
            ? `<div class="stat-strip" style="margin:12px;border-radius:8px">` +
              `<div><div class="l">Invoiced</div><div class="v nums">${Fmt.money(payload.summary.invoiced, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Collected</div><div class="v nums">${Fmt.money(payload.summary.collected, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Outstanding</div><div class="v nums">${Fmt.money(payload.summary.outstanding, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Overdue</div><div class="v nums">${payload.summary.overdueCount}</div></div>` +
              `</div>`
            : "",
        columns: [
          { key: "number", label: "Invoice", sortable: "number", render: (r) => `<span class="mono strong">${esc(r.number)}</span>` },
          { key: "user", label: "Customer", render: (r) => `<span class="small">${esc((r.user && r.user.email) || r.billingEmail || "—")}</span>` },
          { key: "status", label: "Status", sortable: "status", render: (r) => Cell.dotBadge(r.status, Tone.of(Tone.invoice, r.status)) + (r.isOverdue ? ` ${Cell.badge("overdue", "danger")}` : "") },
          { key: "total", label: "Total", sortable: "total", align: "right", render: (r) => `<span class="nums strong">${Fmt.money(r.total, r.currency, { decimals: false })}</span>` },
          { key: "amountDue", label: "Due", align: "right", render: (r) => (r.amountDue > 0 ? `<span class="nums" style="color:var(--warning-text)">${Fmt.money(r.amountDue, r.currency, { decimals: false })}</span>` : Cell.badge("paid", "success")) },
          { key: "issuedAt", label: "Issued", sortable: "issuedAt", nowrap: true, render: (r) => `<span class="small muted">${Fmt.date(r.issuedAt)}</span>` },
          { key: "dueAt", label: "Due date", sortable: "dueAt", nowrap: true, render: (r) => `<span class="small ${r.isOverdue ? "" : "muted"}">${r.dueAt ? Fmt.date(r.dueAt) : "—"}</span>` },
        ],
        onLoad: (payload) => {
          if (payload.options) options = payload.options;
        },
        onRowClick: (row) => openDetail(row.id),
        rowActions: (row) => [
          { label: "View", icon: "eye", iconOnly: true, run: () => openDetail(row.id) },
          row.amountDue > 0 && row.status !== "void" ? { label: "Record payment", icon: "card", iconOnly: true, primary: true, run: () => markPaid(row) } : null,
        ],
        bulkActions: [
          { label: "Mark paid", action: "mark-paid", confirm: "Record a settling payment for the outstanding amount on each selected invoice.", run: (ids) => Api.post("/billing/invoices/bulk", { action: "mark-paid", ids }) },
          { label: "Void", action: "void", danger: true, confirm: "Void the selected invoices. Those with payments recorded are skipped.", run: (ids) => Api.post("/billing/invoices/bulk", { action: "void", ids }) },
          { label: "Mark uncollectible", action: "mark-uncollectible", run: (ids) => Api.post("/billing/invoices/bulk", { action: "mark-uncollectible", ids }) },
          { label: "Delete", action: "delete", danger: true, confirm: "Delete the selected invoices. Those with payments are skipped.", run: (ids) => Api.post("/billing/invoices/bulk", { action: "delete", ids }) },
        ],
      });

      function openCreate() {
        Modal.form({
          title: "New invoice",
          size: "lg",
          fields: [
            customerField(false, "Optional — an invoice can be raised against a name and email alone."),
            { name: "lineItems", label: "Line items", type: "lineitems", currency: ctx.currency, required: true },
            { name: "discount", label: "Discount", type: "money", currency: ctx.currency },
            { name: "taxPercent", label: "Tax %", type: "number", min: 0, max: 100, step: 0.01, value: 18, help: "Applied to the subtotal after discount." },
            { name: "currency", label: "Currency", type: "select", options: options.currencies || CURRENCIES, value: ctx.currency },
            { name: "status", label: "Status", type: "select", options: options.statuses, value: "open" },
            { name: "issuedAt", label: "Issue date", type: "date", value: Fmt.dateInput(new Date()) },
            { name: "dueAt", label: "Due date", type: "date" },
            { name: "billingName", label: "Billing name" },
            { name: "billingEmail", label: "Billing email", type: "email" },
            { name: "notes", label: "Notes", type: "textarea" },
          ],
          submitLabel: "Create invoice",
          onSubmit: async (values) => {
            // taxPercent arrives as a percentage; the API stores hundredths.
            if (values.taxPercent !== undefined) values.taxPercent = Math.round(Number(values.taxPercent) * 100);
            const res = await Api.post("/billing/invoices", values);
            Toast.success(`Invoice ${res.invoice.number} created.`);
            table.reload();
          },
        });
      }

      function markPaid(inv) {
        Modal.form({
          title: `Record payment · ${inv.number}`,
          subtitle: `${Fmt.money(inv.amountDue, inv.currency, { decimals: false })} outstanding`,
          fields: [
            { name: "amount", label: "Amount", type: "money", currency: inv.currency, value: inv.amountDue, help: "Defaults to the full outstanding balance." },
            { name: "method", label: "Method", type: "select", options: ["manual", "card", "upi", "netbanking", "bank_transfer", "paypal", "wallet", "cheque"], value: "manual" },
            { name: "reference", label: "Reference / transaction id" },
            { name: "paidAt", label: "Paid on", type: "date", value: Fmt.dateInput(new Date()) },
          ],
          submitLabel: "Record payment",
          onSubmit: async (values) => {
            await Api.post(`/billing/invoices/${inv.id}/mark-paid`, values);
            Toast.success("Payment recorded.");
            table.reload();
          },
        });
      }

      async function openDetail(id) {
        let data;
        try {
          data = await Api.get(`/billing/invoices/${id}`);
        } catch (err) {
          Toast.fromError(err);
          return;
        }
        const inv = data.invoice;
        Modal.open({
          title: `Invoice ${inv.number}`,
          subtitle: `${Fmt.title(inv.status)} · ${(inv.user && inv.user.email) || inv.billingEmail || ""}`,
          size: "lg",
          body: renderInvoiceSheet(inv),
          footer:
            `<button class="btn" data-print>${icon("print")} Print</button><div class="spacer"></div>` +
            (inv.amountDue > 0 && inv.status !== "void" ? `<button class="btn btn-primary" data-pay>${icon("card")} Record payment</button>` : "") +
            (inv.amountPaid === 0 && inv.status !== "void" ? `<button class="btn btn-danger-soft" data-void>${icon("ban")} Void</button>` : ""),
          onMount: (h) => {
            qs("[data-print]", h.overlay).addEventListener("click", () => window.print());
            const pay = qs("[data-pay]", h.overlay);
            if (pay)
              pay.addEventListener("click", () => {
                h.close();
                markPaid(inv);
              });
            const voidButton = qs("[data-void]", h.overlay);
            if (voidButton)
              voidButton.addEventListener("click", async () => {
                await Modal.confirm({
                  title: "Void invoice",
                  message: `Void <strong>${esc(inv.number)}</strong>? It stays on record but is no longer collectible.`,
                  confirmLabel: "Void invoice",
                  danger: true,
                  onConfirm: async () => {
                    await Api.post(`/billing/invoices/${inv.id}/void`, {});
                    Toast.success("Invoice voided.");
                    h.close();
                    table.reload();
                  },
                });
              });
          },
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      if (ctx.query && ctx.query.focus) setTimeout(() => openDetail(ctx.query.focus), 100);
      return { refresh: () => table.reload() };
    },
  };

  function renderInvoiceSheet(inv) {
    const money = (v) => Fmt.money(v, inv.currency, { decimals: true });
    const items = inv.lineItems || [];
    return (
      `<div class="invoice-sheet">` +
      `<div class="invoice-head"><div><h1>Invoice ${esc(inv.number)}</h1>` +
      `<div class="small muted">Issued ${esc(Fmt.date(inv.issuedAt))}${inv.dueAt ? ` · Due ${esc(Fmt.date(inv.dueAt))}` : ""}</div></div>` +
      `<div class="right"><div class="badge badge-${Tone.of(Tone.invoice, inv.status)}">${esc(Fmt.title(inv.status))}</div>` +
      `<div class="small muted mt-1">${esc(inv.billingName || (inv.user && inv.user.name) || "")}</div>` +
      `<div class="small muted">${esc(inv.billingEmail || (inv.user && inv.user.email) || "")}</div></div></div>` +
      `<table class="invoice-table"><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead><tbody>` +
      (items.length
        ? items.map((it) => `<tr><td>${esc(it.description)}</td><td class="right nums">${it.quantity}</td><td class="right nums">${money(it.unitAmount)}</td><td class="right nums">${money(it.amount)}</td></tr>`).join("")
        : `<tr><td colspan="4" class="muted">No line items.</td></tr>`) +
      `</tbody></table>` +
      `<div class="invoice-totals">` +
      `<div><span>Subtotal</span><span class="nums">${money(inv.subtotal)}</span></div>` +
      (inv.discount ? `<div><span>Discount</span><span class="nums">−${money(inv.discount)}</span></div>` : "") +
      (inv.tax ? `<div><span>Tax (${(inv.taxPercent / 100).toFixed(2)}%)</span><span class="nums">${money(inv.tax)}</span></div>` : "") +
      `<div class="grand"><span>Total</span><span class="nums">${money(inv.total)}</span></div>` +
      (inv.amountPaid ? `<div><span>Paid</span><span class="nums">−${money(inv.amountPaid)}</span></div>` : "") +
      (inv.amountDue ? `<div class="strong"><span>Balance due</span><span class="nums">${money(inv.amountDue)}</span></div>` : "") +
      `</div>` +
      (inv.notes ? `<p class="small muted mt-2">${esc(inv.notes)}</p>` : "") +
      `</div>` +
      (inv.payments && inv.payments.length
        ? `<h3 class="small strong mt-2 mb-1">Payments</h3><div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>` +
          inv.payments.map((p) => `<tr><td class="small">${esc(Fmt.date(p.paidAt))}</td><td>${esc(Fmt.title(p.method))}</td><td>${Cell.badge(p.status, Tone.of(Tone.payment, p.status))}</td><td class="num nums">${money(p.amount)}</td></tr>`).join("") +
          `</tbody></table></div>`
        : "")
    );
  }

  // ── PAYMENTS ───────────────────────────────────────────────────────────────

  Pages.payments = {
    title: "Payments",
    subtitle: "Every movement of money against an invoice, including refunds.",
    async render(container, ctx) {
      let options = { statuses: [], methods: [], currencies: CURRENCIES };

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} Record payment</button>` +
        `</div></div><div data-table></div>`;

      const table = Table({
        mount: qs("[data-table]", container),
        endpoint: "/billing/payments",
        exportPath: "/billing/payments/export",
        searchPlaceholder: "Search reference, gateway, customer or invoice…",
        defaultSort: { by: "paidAt", dir: "desc" },
        selectable: true,
        emptyTitle: "No payments recorded",
        filters: [
          { name: "status", label: "Status", type: "select", options: options.statuses },
          { name: "method", label: "Method", type: "select", options: options.methods },
        ],
        summary: (payload) =>
          payload.summary
            ? `<div class="stat-strip" style="margin:12px;border-radius:8px">` +
              `<div><div class="l">Gross</div><div class="v nums">${Fmt.money(payload.summary.gross, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Refunded</div><div class="v nums">${Fmt.money(payload.summary.refunded, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Net</div><div class="v nums">${Fmt.money(payload.summary.net, ctx.currency, { compact: true, decimals: false })}</div></div>` +
              `<div><div class="l">Count</div><div class="v nums">${payload.summary.count}</div></div>` +
              `</div>`
            : "",
        columns: [
          { key: "paidAt", label: "Date", sortable: "paidAt", nowrap: true, render: (r) => `<span class="small">${Fmt.date(r.paidAt)}</span>` },
          { key: "user", label: "Customer", render: (r) => `<span class="small">${esc((r.user && r.user.email) || "—")}</span>` },
          { key: "invoiceNumber", label: "Invoice", render: (r) => (r.invoiceNumber ? `<span class="mono small">${esc(r.invoiceNumber)}</span>` : Cell.empty()) },
          { key: "amount", label: "Amount", sortable: "amount", align: "right", render: (r) => `<span class="nums strong">${Fmt.money(r.amount, r.currency, { decimals: false })}</span>${r.refundedAmount ? `<br><span class="faint small">−${Fmt.money(r.refundedAmount, r.currency, { decimals: false })} refunded</span>` : ""}` },
          { key: "method", label: "Method", sortable: "method", render: (r) => Cell.badge(r.method, "neutral") },
          { key: "status", label: "Status", sortable: "status", render: (r) => Cell.dotBadge(r.status, Tone.of(Tone.payment, r.status)) },
        ],
        onLoad: (payload) => {
          if (payload.options) options = payload.options;
        },
        rowActions: (row) => [
          row.refundable ? { label: "Refund", icon: "repeat", iconOnly: true, run: () => refund(row) } : null,
          { label: "Edit", icon: "edit", iconOnly: true, run: () => openEdit(row) },
          { label: "Delete", icon: "trash", iconOnly: true, danger: true, run: () => remove(row) },
        ],
        bulkActions: [
          { label: "Refund", action: "refund", danger: true, confirm: "Fully refund the selected payments.", run: (ids) => Api.post("/billing/payments/bulk", { action: "refund", ids }) },
          { label: "Mark succeeded", action: "mark-succeeded", run: (ids) => Api.post("/billing/payments/bulk", { action: "mark-succeeded", ids }) },
          { label: "Mark failed", action: "mark-failed", run: (ids) => Api.post("/billing/payments/bulk", { action: "mark-failed", ids }) },
          { label: "Delete", action: "delete", danger: true, confirm: "Delete the selected payment records. Linked invoices are recalculated.", run: (ids) => Api.post("/billing/payments/bulk", { action: "delete", ids }) },
        ],
      });

      function paymentFields(p) {
        return [
          { name: "invoiceId", label: "Invoice id (optional)", value: p && p.invoiceId, placeholder: "Link to an invoice", help: "Linking recalculates that invoice's paid amount and status." },
          !p ? customerField(false) : null,
          { name: "amount", label: "Amount", type: "money", currency: (p && p.currency) || ctx.currency, required: !p, value: p && p.amount },
          { name: "currency", label: "Currency", type: "select", options: options.currencies || CURRENCIES, value: (p && p.currency) || ctx.currency },
          { name: "status", label: "Status", type: "select", options: options.statuses, value: (p && p.status) || "succeeded" },
          { name: "method", label: "Method", type: "select", options: options.methods, value: (p && p.method) || "manual" },
          { name: "gateway", label: "Gateway", value: p && p.gateway, placeholder: "e.g. Razorpay" },
          { name: "reference", label: "Reference", value: p && p.reference },
          { name: "paidAt", label: "Paid on", type: "date", value: p ? Fmt.dateInput(p.paidAt) : Fmt.dateInput(new Date()) },
          { name: "notes", label: "Notes", type: "textarea", value: p && p.notes },
        ].filter(Boolean);
      }

      function openCreate() {
        Modal.form({
          title: "Record payment",
          size: "lg",
          fields: paymentFields(null),
          submitLabel: "Record payment",
          onSubmit: async (values) => {
            await Api.post("/billing/payments", values);
            Toast.success("Payment recorded.");
            table.reload();
          },
        });
      }

      function openEdit(p) {
        Modal.form({
          title: "Edit payment",
          size: "lg",
          fields: paymentFields(p),
          submitLabel: "Save",
          onSubmit: async (values) => {
            await Api.patch(`/billing/payments/${p.id}`, values);
            Toast.success("Payment updated.");
            table.reload();
          },
        });
      }

      function refund(p) {
        const refundable = p.amount - p.refundedAmount;
        Modal.form({
          title: "Refund payment",
          subtitle: `Up to ${Fmt.money(refundable, p.currency, { decimals: false })} can be refunded.`,
          fields: [
            { name: "amount", label: "Refund amount", type: "money", currency: p.currency, value: refundable },
            { name: "reason", label: "Reason (optional)", type: "textarea" },
          ],
          submitLabel: "Issue refund",
          onSubmit: async (values) => {
            await Api.post(`/billing/payments/${p.id}/refund`, values);
            Toast.success("Refund recorded.");
            table.reload();
          },
        });
      }

      async function remove(p) {
        await Modal.confirm({
          title: "Delete payment",
          message: `Delete this ${Fmt.money(p.amount, p.currency, { decimals: false })} payment? Any linked invoice is recalculated.`,
          confirmLabel: "Delete payment",
          danger: true,
          onConfirm: async () => {
            await Api.del(`/billing/payments/${p.id}`);
            Toast.success("Payment deleted.");
            table.reload();
          },
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      return { refresh: () => table.reload() };
    },
  };

  // ── PLANS ──────────────────────────────────────────────────────────────────

  Pages.plans = {
    title: "Plans",
    subtitle: "The pricing catalogue. Editable without a deploy; seeded from the built-in defaults.",
    async render(container, ctx) {
      let featureKeys = ["whatsappOutreach", "aiInsights", "prioritySupport", "customIntegrations"];

      container.innerHTML =
        `<div class="page-head"><div></div><div class="page-head-actions">` +
        `<button class="btn btn-primary" data-new>${icon("plus")} New plan</button>` +
        `</div></div><div data-grid class="grid-3"></div>`;

      async function load() {
        let payload;
        try {
          payload = await Api.get("/billing/plans");
        } catch (err) {
          qs("[data-grid]", container).innerHTML = `<div class="notice notice-error">${icon("alert")}<div>${esc(err.message)}</div></div>`;
          return;
        }
        if (payload.options && payload.options.featureKeys) featureKeys = payload.options.featureKeys;
        const plans = payload.rows;
        qs("[data-grid]", container).innerHTML = plans.length
          ? plans.map((p) => planCard(p, ctx)).join("")
          : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icon("tag")}</div><div class="empty-title">No plans defined</div></div>`;

        qs("[data-grid]", container).querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEdit(plans.find((p) => p.id === b.dataset.edit))));
        qs("[data-grid]", container).querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remove(plans.find((p) => p.id === b.dataset.del))));
        qs("[data-grid]", container).querySelectorAll("[data-toggle]").forEach((b) =>
          b.addEventListener("click", async () => {
            const plan = plans.find((p) => p.id === b.dataset.toggle);
            await Api.patch(`/billing/plans/${plan.id}`, { isActive: !plan.isActive });
            Toast.success(plan.isActive ? "Plan deactivated." : "Plan activated.");
            load();
          })
        );
      }

      function planFields(plan) {
        return [
          !plan ? { name: "key", label: "Plan key", required: true, placeholder: "e.g. growth", help: "Lowercase, stable. Cannot be changed after creation." } : { name: "keyStatic", type: "static", label: "Plan key", value: `<span class="mono strong">${esc(plan.key)}</span>` },
          { name: "name", label: "Display name", required: true, value: plan && plan.name },
          { name: "description", label: "Description", type: "textarea", value: plan && plan.description },
          { name: "priceMonthly", label: "Monthly price", type: "money", currency: (plan && plan.currency) || ctx.currency, value: plan && plan.priceMonthly },
          { name: "priceYearly", label: "Yearly price", type: "money", currency: (plan && plan.currency) || ctx.currency, value: plan && plan.priceYearly },
          { name: "currency", label: "Currency", type: "select", options: CURRENCIES, value: (plan && plan.currency) || ctx.currency },
          { name: "monthlyLeadLimit", label: "Monthly lead limit", type: "number", min: -1, value: plan ? plan.monthlyLeadLimit : 100, help: "Use -1 for unlimited." },
          { name: "seats", label: "Seats", type: "number", min: -1, value: plan ? plan.seats : 1, help: "-1 for unlimited." },
          { name: "trialDays", label: "Trial days", type: "number", min: 0, value: plan ? plan.trialDays : 0 },
          { name: "features", label: "Included features", type: "select", options: [{ value: "", label: "(edit as comma list below)" }].concat(featureKeys), value: "", help: `Comma-separated keys. Available: ${featureKeys.join(", ")}` },
          { name: "featuresText", label: "Feature keys", value: plan ? (plan.features || []).join(", ") : "", placeholder: featureKeys.join(", ") },
          { name: "sortOrder", label: "Sort order", type: "number", min: 0, value: plan ? plan.sortOrder : 0 },
          { name: "highlight", label: "Highlight as recommended", type: "checkbox", value: plan && plan.highlight },
          { name: "isPublic", label: "Show on public pricing", type: "checkbox", value: plan ? plan.isPublic : true },
          { name: "isActive", label: "Active", type: "checkbox", value: plan ? plan.isActive : true },
        ];
      }

      function normalise(values) {
        // The two feature inputs are merged: the free-text list is authoritative,
        // the dropdown is a convenience for appending one.
        const list = String(values.featuresText || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (values.features) list.push(values.features);
        values.features = [...new Set(list)];
        delete values.featuresText;
        return values;
      }

      function openCreate() {
        Modal.form({
          title: "New plan",
          size: "lg",
          fields: planFields(null),
          submitLabel: "Create plan",
          onSubmit: async (values) => {
            await Api.post("/billing/plans", normalise(values));
            Toast.success("Plan created.");
            load();
          },
        });
      }

      function openEdit(plan) {
        Modal.form({
          title: `Edit ${plan.name}`,
          size: "lg",
          fields: planFields(plan),
          submitLabel: "Save changes",
          onSubmit: async (values) => {
            await Api.patch(`/billing/plans/${plan.id}`, normalise(values));
            Toast.success("Plan updated.");
            load();
          },
        });
      }

      async function remove(plan) {
        await Modal.confirm({
          title: "Delete plan",
          message: `Delete the <strong>${esc(plan.name)}</strong> plan? This is only possible when no accounts or live subscriptions use it.`,
          confirmLabel: "Delete plan",
          danger: true,
          onConfirm: async () => {
            await Api.del(`/billing/plans/${plan.id}`);
            Toast.success("Plan deleted.");
            load();
          },
        });
      }

      qs("[data-new]", container).addEventListener("click", openCreate);
      await load();
      return { refresh: load };
    },
  };

  function planCard(p, ctx) {
    const money = (v) => Fmt.money(v, p.currency, { decimals: false });
    return (
      `<div class="card card-pad"${p.highlight ? ' style="border-color:var(--brand);border-width:1.5px"' : ""}>` +
      `<div class="row" style="justify-content:space-between"><div><div class="row" style="gap:6px"><h3 style="font-size:1rem">${esc(p.name)}</h3>${p.highlight ? Cell.badge("popular", "brand") : ""}</div>` +
      `<div class="mono small muted">${esc(p.key)}</div></div>` +
      `<div>${p.isActive ? Cell.badge("active", "success") : Cell.badge("inactive", "neutral")}</div></div>` +
      `<div class="mt-1" style="font-size:1.5rem;font-weight:700;letter-spacing:-0.03em">${money(p.priceMonthly)}<span class="muted" style="font-size:0.8rem;font-weight:500">/mo</span></div>` +
      (p.priceYearly ? `<div class="small muted">${money(p.priceYearly)}/yr</div>` : "") +
      (p.description ? `<p class="small muted mt-1">${esc(p.description)}</p>` : "") +
      `<div class="stat-strip mt-2" style="grid-template-columns:1fr 1fr">` +
      `<div><div class="l">Leads/mo</div><div class="v nums">${Fmt.limit(p.monthlyLeadLimit)}</div></div>` +
      `<div><div class="l">Seats</div><div class="v nums">${Fmt.limit(p.seats)}</div></div>` +
      `<div><div class="l">Subscribers</div><div class="v nums">${p.activeSubscriptions}</div></div>` +
      `<div><div class="l">On plan</div><div class="v nums">${p.usersOnPlan}</div></div>` +
      `</div>` +
      (p.features && p.features.length ? `<div class="chip-row mt-2">${p.features.map((f) => `<span class="chip" style="cursor:default">${esc(Fmt.title(f))}</span>`).join("")}</div>` : "") +
      `<div class="row mt-2" style="gap:6px">` +
      `<button class="btn btn-sm" data-edit="${esc(p.id)}">${icon("edit")} Edit</button>` +
      `<button class="btn btn-sm" data-toggle="${esc(p.id)}">${p.isActive ? "Deactivate" : "Activate"}</button>` +
      `<div class="spacer" style="flex:1"></div>` +
      `<button class="btn btn-sm btn-ghost btn-icon" data-del="${esc(p.id)}" title="Delete">${icon("trash")}</button>` +
      `</div></div>`
    );
  }
})(window);
