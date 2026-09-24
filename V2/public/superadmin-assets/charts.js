/*
 * Interactive SVG charts for the superadmin console.
 *
 * Why hand-rolled rather than a library: this page is a plain HTML file served
 * straight off disk, outside the Vite bundle, so recharts (already a dependency
 * of the React app) is not reachable from it, and the CSP only admits scripts
 * from 'self' and unpkg. Pulling a chart library off a CDN would make the
 * operator console fail to render when the CDN is blocked — which, on an admin
 * page you open precisely when something is broken, is the wrong trade.
 *
 * What it provides: area/line with a shared crosshair tooltip, vertical bars
 * (plain, grouped or stacked), a donut with a toggleable legend and click-through
 * filtering, horizontal bar lists, and sparklines. Everything reads its colours
 * from the CSS custom properties in theme.css, so both themes work with no
 * JavaScript branch.
 *
 * Every chart re-renders on container resize and on theme change; charts are
 * registered per element so a re-render replaces rather than stacks.
 */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const registry = new WeakMap();

  // ── Formatting ─────────────────────────────────────────────────────────────

  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const plain = new Intl.NumberFormat("en-US");

  function fmtNum(n) {
    const v = Number(n) || 0;
    return Math.abs(v) >= 10000 ? compact.format(v) : plain.format(v);
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || "").trim() || fallback;
  }

  /** The categorical series palette, read from the theme. */
  function palette() {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => cssVar(`--c${i}`, "#4f46e5"));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ── SVG helpers ────────────────────────────────────────────────────────────

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      for (const key in attrs) {
        if (attrs[key] === null || attrs[key] === undefined) continue;
        node.setAttribute(key, String(attrs[key]));
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /**
   * Prepares a host element for a chart: clears it, creates the sized SVG and a
   * tooltip, and wires the resize/theme observers exactly once.
   */
  function frame(host, opts) {
    const height = opts.height || 220;
    const width = Math.max(240, Math.floor(host.clientWidth || host.getBoundingClientRect().width || 600));

    host.classList.add("chart-wrap");
    host.innerHTML = "";

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height,
      role: "img",
      "aria-label": opts.ariaLabel || "chart",
      preserveAspectRatio: "none",
    }, host);

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    host.appendChild(tip);

    observe(host);
    return { svg, tip, width, height };
  }

  /**
   * Re-renders on size change so a chart drawn while its card was narrow (or in
   * a hidden tab) is not stuck at the wrong width — the single most common way a
   * hand-built SVG chart looks broken.
   */
  function observe(host) {
    if (host.__chartObserved) return;
    host.__chartObserved = true;
    if (typeof ResizeObserver === "undefined") return;
    let last = host.clientWidth;
    let timer = null;
    const ro = new ResizeObserver(() => {
      const next = host.clientWidth;
      if (!next || Math.abs(next - last) < 8) return;
      last = next;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const spec = registry.get(host);
        if (spec) spec.draw();
      }, 90);
    });
    ro.observe(host);
  }

  function remember(host, draw) {
    registry.set(host, { draw });
  }

  /** Redraws every live chart. Called by the theme toggle. */
  function redrawAll() {
    document.querySelectorAll(".chart-wrap").forEach((host) => {
      const spec = registry.get(host);
      if (spec) spec.draw();
    });
  }

  function placeTip(host, tip, x, y) {
    const hostBox = host.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    let left = x + 12;
    if (left + tipBox.width > hostBox.width) left = x - tipBox.width - 12;
    if (left < 0) left = 4;
    let top = y - tipBox.height - 10;
    if (top < 0) top = y + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  /** Round numbers for an axis: 1, 2, 5 × 10^n. */
  function niceMax(value) {
    if (value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const scaled = value / base;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * base;
  }

  function ticks(max, count) {
    const out = [];
    for (let i = 0; i <= count; i++) out.push(Math.round((max / count) * i));
    return [...new Set(out)];
  }

  function shortDate(iso) {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function longDate(iso) {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  // ── Area / line chart ──────────────────────────────────────────────────────

  /**
   * options:
   *   series    [{ key, label, color?, data: [{ date|label, value }] }]
   *   height    px (default 240)
   *   fill      draw the gradient under the line (default true for 1-2 series)
   *   format    value formatter
   *   xLabel    label formatter for the axis
   *   xTitle    label formatter for the tooltip heading
   *   onPoint   (index, point) => void, called on click
   */
  function area(host, options) {
    if (!host) return;
    const draw = () => {
      const series = (options.series || []).filter((s) => s && Array.isArray(s.data) && s.data.length);
      if (!series.length) {
        host.innerHTML = '<div class="empty small">No data for this period.</div>';
        return;
      }

      const { svg, tip, width, height } = frame(host, { height: options.height || 240, ariaLabel: options.ariaLabel });
      const colors = palette();
      const fmt = options.format || fmtNum;
      const xLabel = options.xLabel || shortDate;
      const xTitle = options.xTitle || longDate;
      const doFill = options.fill !== undefined ? options.fill : series.length <= 2;

      const points = series[0].data.length;
      const padLeft = 44;
      const padRight = 12;
      const padTop = 12;
      const padBottom = 26;
      const plotW = width - padLeft - padRight;
      const plotH = height - padTop - padBottom;

      const rawMax = Math.max(...series.flatMap((s) => s.data.map((d) => Number(d.value) || 0)), 0);
      const max = niceMax(rawMax || 1);
      const xAt = (i) => padLeft + (points === 1 ? plotW / 2 : (plotW * i) / (points - 1));
      const yAt = (v) => padTop + plotH - (plotH * (Number(v) || 0)) / max;

      // Grid + y axis
      const gGrid = el("g", { class: "chart-grid" }, svg);
      const gAxis = el("g", { class: "chart-axis" }, svg);
      for (const t of ticks(max, 4)) {
        const y = yAt(t);
        el("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y }, gGrid);
        el("text", { x: padLeft - 7, y: y + 3, "text-anchor": "end" }, gAxis).textContent = fmt(t);
      }

      // X labels: thinned to roughly six so they never overlap.
      const every = Math.max(1, Math.ceil(points / 6));
      series[0].data.forEach((d, i) => {
        if (i % every !== 0 && i !== points - 1) return;
        const t = el("text", { x: xAt(i), y: height - 8, "text-anchor": i === 0 ? "start" : i === points - 1 ? "end" : "middle" }, gAxis);
        t.textContent = xLabel(d.date ?? d.label ?? i);
      });

      // Series
      const hoverLine = el("line", {
        class: "chart-hover-line",
        y1: padTop,
        y2: padTop + plotH,
        x1: 0,
        x2: 0,
      }, svg);

      const drawn = series.map((s, si) => {
        const color = s.color || colors[si % colors.length];
        const coords = s.data.map((d, i) => [xAt(i), yAt(d.value)]);
        const linePath = coords.map((c, i) => `${i ? "L" : "M"}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(" ");

        if (doFill) {
          const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
          const defs = el("defs", null, svg);
          const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
          el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.26 }, grad);
          el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0.01 }, grad);
          el("path", {
            class: "chart-area",
            d: `${linePath} L${coords[coords.length - 1][0].toFixed(1)} ${padTop + plotH} L${coords[0][0].toFixed(1)} ${padTop + plotH} Z`,
            fill: `url(#${gradId})`,
          }, svg);
        }

        el("path", { class: "chart-line", d: linePath, stroke: color }, svg);
        const dot = el("circle", { class: "chart-point", r: 4, fill: color, cx: 0, cy: 0 }, svg);
        return { series: s, color, coords, dot };
      });

      // Hover surface
      const hit = el("rect", { x: padLeft, y: padTop, width: plotW, height: plotH, fill: "transparent", style: "cursor:crosshair" }, svg);

      function atIndex(clientX) {
        const box = svg.getBoundingClientRect();
        const scale = width / box.width;
        const x = (clientX - box.left) * scale;
        const ratio = points === 1 ? 0 : (x - padLeft) / plotW;
        return Math.max(0, Math.min(points - 1, Math.round(ratio * (points - 1))));
      }

      function show(index, clientX) {
        const box = svg.getBoundingClientRect();
        const scale = box.width / width;
        const px = xAt(index) * scale;

        hoverLine.setAttribute("x1", xAt(index));
        hoverLine.setAttribute("x2", xAt(index));
        hoverLine.classList.add("on");

        let py = 0;
        drawn.forEach((d) => {
          const c = d.coords[index];
          if (!c) return;
          d.dot.setAttribute("cx", c[0]);
          d.dot.setAttribute("cy", c[1]);
          d.dot.classList.add("on");
          py = Math.max(py, c[1] * scale);
        });

        const label = series[0].data[index];
        tip.innerHTML =
          `<div class="chart-tip-title">${esc(xTitle(label.date ?? label.label ?? index))}</div>` +
          drawn
            .map(
              (d) =>
                `<div class="chart-tip-row"><span class="sw" style="background:${d.color}"></span>` +
                `<span>${esc(d.series.label || d.series.key)}</span>` +
                `<span class="v">${esc(fmt(d.series.data[index] ? d.series.data[index].value : 0))}</span></div>`
            )
            .join("");
        tip.classList.add("on");
        placeTip(host, tip, px, Math.min(py, box.height - 8));
      }

      function hide() {
        hoverLine.classList.remove("on");
        drawn.forEach((d) => d.dot.classList.remove("on"));
        tip.classList.remove("on");
      }

      hit.addEventListener("mousemove", (e) => show(atIndex(e.clientX), e.clientX));
      hit.addEventListener("mouseleave", hide);
      hit.addEventListener("touchmove", (e) => {
        if (e.touches[0]) show(atIndex(e.touches[0].clientX), e.touches[0].clientX);
      }, { passive: true });
      hit.addEventListener("touchend", hide);
      if (options.onPoint) {
        hit.addEventListener("click", (e) => {
          const index = atIndex(e.clientX);
          options.onPoint(index, series[0].data[index]);
        });
      }

      if (options.legend !== false && series.length > 1) {
        renderLegend(host, series.map((s, i) => ({
          label: s.label || s.key,
          color: s.color || colors[i % colors.length],
          value: fmt(s.data.reduce((sum, d) => sum + (Number(d.value) || 0), 0)),
        })));
      }
    };

    remember(host, draw);
    draw();
  }

  // ── Vertical bars (plain, grouped, stacked) ────────────────────────────────

  /**
   * options:
   *   categories  [string]           x-axis groups
   *   series      [{ key, label, color?, values: [n] }]
   *   stacked     boolean
   *   height, format, onBar(categoryIndex, category)
   */
  function bars(host, options) {
    if (!host) return;
    const draw = () => {
      const categories = options.categories || [];
      const series = (options.series || []).filter((s) => s && Array.isArray(s.values));
      if (!categories.length || !series.length) {
        host.innerHTML = '<div class="empty small">No data for this period.</div>';
        return;
      }

      const { svg, tip, width, height } = frame(host, { height: options.height || 240, ariaLabel: options.ariaLabel });
      const colors = palette();
      const fmt = options.format || fmtNum;
      const stacked = !!options.stacked;

      const padLeft = 44;
      const padRight = 12;
      const padTop = 12;
      const padBottom = 28;
      const plotW = width - padLeft - padRight;
      const plotH = height - padTop - padBottom;

      const totals = categories.map((_, ci) =>
        stacked
          ? series.reduce((sum, s) => sum + (Number(s.values[ci]) || 0), 0)
          : Math.max(...series.map((s) => Number(s.values[ci]) || 0))
      );
      const max = niceMax(Math.max(...totals, 1));
      const yAt = (v) => padTop + plotH - (plotH * (Number(v) || 0)) / max;

      const gGrid = el("g", { class: "chart-grid" }, svg);
      const gAxis = el("g", { class: "chart-axis" }, svg);
      for (const t of ticks(max, 4)) {
        const y = yAt(t);
        el("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y }, gGrid);
        el("text", { x: padLeft - 7, y: y + 3, "text-anchor": "end" }, gAxis).textContent = fmt(t);
      }

      const slot = plotW / categories.length;
      const groupW = Math.min(46, slot * 0.68);
      const barW = stacked ? groupW : Math.max(3, groupW / series.length - 2);
      const every = Math.max(1, Math.ceil(categories.length / 8));

      categories.forEach((category, ci) => {
        const centre = padLeft + slot * ci + slot / 2;

        if (ci % every === 0 || ci === categories.length - 1) {
          el("text", { x: centre, y: height - 9, "text-anchor": "middle" }, gAxis).textContent = category;
        }

        let stackTop = padTop + plotH;
        series.forEach((s, si) => {
          const value = Number(s.values[ci]) || 0;
          const color = s.color || colors[si % colors.length];
          const barH = Math.max(value > 0 ? 1.5 : 0, ((Number(value) || 0) / max) * plotH);
          const x = stacked ? centre - groupW / 2 : centre - groupW / 2 + si * (barW + 2);
          const y = stacked ? stackTop - barH : padTop + plotH - barH;
          if (stacked) stackTop -= barH;

          if (barH <= 0) return;
          const rect = el("rect", {
            class: "chart-bar",
            x: x.toFixed(1),
            y: y.toFixed(1),
            width: barW.toFixed(1),
            height: barH.toFixed(1),
            rx: Math.min(3, barW / 2),
            fill: color,
          }, svg);

          rect.addEventListener("mouseenter", () => {
            tip.innerHTML =
              `<div class="chart-tip-title">${esc(options.xTitle ? options.xTitle(category, ci) : category)}</div>` +
              series
                .map(
                  (ss, ssi) =>
                    `<div class="chart-tip-row"><span class="sw" style="background:${ss.color || colors[ssi % colors.length]}"></span>` +
                    `<span>${esc(ss.label || ss.key)}</span><span class="v">${esc(fmt(ss.values[ci] || 0))}</span></div>`
                )
                .join("");
            tip.classList.add("on");
          });
          rect.addEventListener("mousemove", (e) => {
            const box = host.getBoundingClientRect();
            placeTip(host, tip, e.clientX - box.left, e.clientY - box.top);
          });
          rect.addEventListener("mouseleave", () => tip.classList.remove("on"));
          if (options.onBar) rect.addEventListener("click", () => options.onBar(ci, category));
        });
      });

      if (options.legend !== false && series.length > 1) {
        renderLegend(host, series.map((s, i) => ({
          label: s.label || s.key,
          color: s.color || colors[i % colors.length],
          value: fmt(s.values.reduce((sum, v) => sum + (Number(v) || 0), 0)),
        })));
      }
    };

    remember(host, draw);
    draw();
  }

  // ── Donut / pie ────────────────────────────────────────────────────────────

  /**
   * options:
   *   data        [{ label, value, color? }]
   *   pie         boolean — solid pie instead of a donut
   *   centerLabel string shown under the total
   *   format      value formatter
   *   onSelect    (datum|null) => void, fired on slice click (click again clears)
   */
  function donut(host, options) {
    if (!host) return;
    const state = { hidden: new Set(), selected: null };

    const draw = () => {
      const all = (options.data || []).filter((d) => d && Number(d.value) > 0);
      if (!all.length) {
        host.innerHTML = '<div class="empty small">Nothing to break down yet.</div>';
        return;
      }
      const visible = all.filter((d) => !state.hidden.has(d.label));
      const { svg, tip, width, height } = frame(host, { height: options.height || 220, ariaLabel: options.ariaLabel });
      const colors = palette();
      const fmt = options.format || fmtNum;

      const total = visible.reduce((sum, d) => sum + Number(d.value), 0) || 1;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) / 2 - 8;
      const inner = options.pie ? 0 : radius * 0.62;

      let angle = -Math.PI / 2;
      const slices = [];

      visible.forEach((d, i) => {
        const fraction = Number(d.value) / total;
        // A single 100% slice cannot be drawn as an arc (start and end coincide),
        // so it is a ring/circle instead.
        const sweep = fraction * Math.PI * 2;
        const color = d.color || colors[all.indexOf(d) % colors.length];
        let node;

        if (visible.length === 1) {
          node = el("circle", {
            class: "chart-slice",
            cx,
            cy,
            r: (radius + inner) / 2,
            fill: "none",
            stroke: color,
            "stroke-width": radius - inner || radius,
          }, svg);
        } else {
          const end = angle + sweep;
          const large = sweep > Math.PI ? 1 : 0;
          const x1 = cx + radius * Math.cos(angle);
          const y1 = cy + radius * Math.sin(angle);
          const x2 = cx + radius * Math.cos(end);
          const y2 = cy + radius * Math.sin(end);
          const ix2 = cx + inner * Math.cos(end);
          const iy2 = cy + inner * Math.sin(end);
          const ix1 = cx + inner * Math.cos(angle);
          const iy1 = cy + inner * Math.sin(angle);
          const d2 = options.pie
            ? `M${cx} ${cy} L${x1} ${y1} A${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`
            : `M${x1} ${y1} A${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L${ix2} ${iy2} A${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`;
          node = el("path", { class: "chart-slice", d: d2, fill: color }, svg);
          angle = end;
        }

        node.setAttribute("tabindex", "0");
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", `${d.label}: ${fmt(d.value)}`);

        const enter = () => {
          slices.forEach((s) => s.node.classList.add("dim"));
          node.classList.remove("dim");
          node.classList.add("pop");
          tip.innerHTML =
            `<div class="chart-tip-row"><span class="sw" style="background:${color}"></span>` +
            `<span>${esc(d.label)}</span><span class="v">${esc(fmt(d.value))}</span></div>` +
            `<div class="chart-tip-title" style="margin:3px 0 0">${((Number(d.value) / total) * 100).toFixed(1)}% of total</div>`;
          tip.classList.add("on");
        };
        const leave = () => {
          slices.forEach((s) => s.node.classList.remove("dim", "pop"));
          tip.classList.remove("on");
        };

        node.addEventListener("mouseenter", enter);
        node.addEventListener("focus", enter);
        node.addEventListener("mousemove", (e) => {
          const box = host.getBoundingClientRect();
          placeTip(host, tip, e.clientX - box.left, e.clientY - box.top);
        });
        node.addEventListener("mouseleave", leave);
        node.addEventListener("blur", leave);

        if (options.onSelect) {
          const fire = () => {
            state.selected = state.selected === d.label ? null : d.label;
            options.onSelect(state.selected ? d : null);
          };
          node.addEventListener("click", fire);
          node.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fire();
            }
          });
        }

        slices.push({ node, datum: d, color });
      });

      if (!options.pie) {
        const g = el("g", { class: "chart-center-label" }, svg);
        el("text", { x: cx, y: cy + 2, class: "chart-center-value" }, g).textContent = fmt(total);
        if (options.centerLabel) {
          el("text", { x: cx, y: cy + 17, class: "chart-center-sub" }, g).textContent = options.centerLabel;
        }
      }

      if (options.legend !== false) {
        renderLegend(
          host,
          all.map((d) => ({
            label: d.label,
            color: d.color || colors[all.indexOf(d) % colors.length],
            value: fmt(d.value),
            off: state.hidden.has(d.label),
          })),
          (item) => {
            // Toggling the last visible series off would divide by zero, so the
            // final one is sticky.
            if (state.hidden.has(item.label)) state.hidden.delete(item.label);
            else if (all.length - state.hidden.size > 1) state.hidden.add(item.label);
            draw();
          }
        );
      }
    };

    remember(host, draw);
    draw();
  }

  // ── Horizontal bar list ────────────────────────────────────────────────────

  /**
   * A ranked list with proportional bars. Better than a pie for more than about
   * six categories, and it can carry a long label.
   */
  function hbars(host, options) {
    if (!host) return;
    const draw = () => {
      const data = (options.data || []).slice(0, options.limit || 12);
      if (!data.length) {
        host.innerHTML = '<div class="empty small">No data yet.</div>';
        return;
      }
      const fmt = options.format || fmtNum;
      const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
      const colors = palette();

      host.classList.remove("chart-wrap");
      host.innerHTML = `<div class="bar-list">${data
        .map((d, i) => {
          const pct = ((Number(d.value) || 0) / max) * 100;
          const color = d.color || (options.monochrome ? cssVar("--brand", "#4f46e5") : colors[i % colors.length]);
          return (
            `<div${options.onPick ? ' class="clickable" data-i="' + i + '"' : ""}>` +
            `<div class="bar-row-label"><span class="k" title="${esc(d.label)}">${esc(d.label)}</span>` +
            `<span class="v">${esc(fmt(d.value))}${d.suffix ? `<span class="muted small"> ${esc(d.suffix)}</span>` : ""}</span></div>` +
            `<div class="meter"><div class="meter-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>` +
            `</div>`
          );
        })
        .join("")}</div>`;

      if (options.onPick) {
        host.querySelectorAll("[data-i]").forEach((node) => {
          node.addEventListener("click", () => options.onPick(data[Number(node.dataset.i)]));
        });
      }
    };
    remember(host, draw);
    draw();
  }

  // ── Sparkline ──────────────────────────────────────────────────────────────

  function sparkline(host, options) {
    if (!host) return;
    const draw = () => {
      const data = (options.data || []).map((d) => Number(d.value ?? d) || 0);
      if (data.length < 2) {
        host.innerHTML = "";
        return;
      }
      const height = options.height || 34;
      const width = Math.max(60, host.clientWidth || 120);
      const max = Math.max(...data, 1);
      const min = Math.min(...data, 0);
      const span = max - min || 1;
      const color = options.color || cssVar("--brand", "#4f46e5");

      host.classList.add("chart-wrap");
      host.innerHTML = "";
      const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height, preserveAspectRatio: "none" }, host);
      const path = data
        .map((v, i) => {
          const x = (width * i) / (data.length - 1);
          const y = height - 2 - ((v - min) / span) * (height - 4);
          return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
      el("path", { d: `${path} L${width} ${height} L0 ${height} Z`, fill: color, "fill-opacity": 0.12 }, svg);
      el("path", { class: "chart-line", d: path, stroke: color, "stroke-width": 1.6 }, svg);
      observe(host);
    };
    remember(host, draw);
    draw();
  }

  // ── Legend ─────────────────────────────────────────────────────────────────

  function renderLegend(host, items, onToggle) {
    const existing = host.parentElement && host.parentElement.querySelector(":scope > .legend");
    if (existing) existing.remove();

    const legend = document.createElement("div");
    legend.className = "legend";
    items.forEach((item) => {
      const button = document.createElement(onToggle ? "button" : "span");
      button.className = `legend-item${item.off ? " off" : ""}`;
      if (onToggle) {
        button.type = "button";
        button.setAttribute("aria-pressed", item.off ? "false" : "true");
      }
      button.innerHTML =
        `<span class="legend-sw" style="background:${item.color}"></span>` +
        `<span>${esc(item.label)}</span>` +
        (item.value !== undefined ? `<span class="legend-val">${esc(item.value)}</span>` : "");
      if (onToggle) button.addEventListener("click", () => onToggle(item));
      legend.appendChild(button);
    });
    (host.parentElement || host).appendChild(legend);
  }

  global.Charts = { area, line: area, bars, donut, hbars, sparkline, redrawAll, fmtNum, palette, shortDate, longDate };
})(window);
