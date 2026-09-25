/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared UI pieces for the business, knowledge, assistant and targeting panels.
 *
 * The dashboard themes itself by passing an `isLight` boolean down and writing a
 * ternary at each element. That works, but four new panels doing it inline would
 * mean several hundred duplicated ternaries and no way to keep spacing and border
 * radii consistent between them. These components take the boolean once and own
 * the decision, so a panel reads as structure rather than as styling.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { ApiError, messageOf } from "./api";

export interface Themed {
  isLight: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme tokens
// ─────────────────────────────────────────────────────────────────────────────

export function tokens(isLight: boolean) {
  return {
    card: isLight
      ? "bg-white/95 border-slate-200/90 backdrop-blur-md"
      : "bg-[#090d16]/90 border-[#1e293b] backdrop-blur-md",
    inset: isLight
      ? "bg-slate-50/80 border-slate-200/80"
      : "bg-[#050811] border-[#1e293b]",
    border: isLight ? "border-slate-200/90" : "border-[#1e293b]",
    heading: isLight ? "text-slate-900" : "text-white",
    body: isLight ? "text-slate-700" : "text-slate-300",
    muted: isLight ? "text-slate-500" : "text-slate-400",
    faint: isLight ? "text-slate-400" : "text-slate-500",
    input: isLight
      ? "bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
      : "bg-[#050811] border-[#1e293b] text-slate-100 placeholder-slate-600 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/15",
    hover: isLight ? "hover:bg-slate-100/80" : "hover:bg-slate-800/60",
    chip: isLight ? "bg-slate-100/90 text-slate-700 border border-slate-200/70" : "bg-[#1e293b]/70 text-slate-300 border border-slate-700/50",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export function Card({
  isLight,
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className = "",
}: Themed & {
  title?: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const t = tokens(isLight);
  return (
    <section className={`border rounded-xl ${t.card} relative overflow-hidden transition-all duration-200 hover:border-indigo-500/30 ${className}`}>
      {(title || actions) && (
        <header
          className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b ${t.border} ${isLight ? "bg-slate-50/50" : "bg-white/[0.02]"}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {Icon && (
              <div className={`p-1 rounded-lg shrink-0 ${isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-400"}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className={`text-xs font-bold tracking-tight ${t.heading}`}>{title}</h3>
              )}
              {subtitle && <p className={`text-[11px] ${t.muted}`}>{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({
  isLight,
  label,
  value,
  unit,
  description,
  icon: Icon,
  iconColor = "indigo",
  trend,
  trendDirection = "neutral",
  onClick,
  className = "",
}: Themed & {
  label: string;
  value: React.ReactNode;
  unit?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconColor?: "indigo" | "rose" | "amber" | "emerald" | "cyan";
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  onClick?: () => void;
  className?: string;
}) {
  const colorMap = {
    indigo: {
      wrap: isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-400",
      glow: "group-hover:bg-indigo-500/10",
      border: isLight ? "hover:border-indigo-200" : "hover:border-indigo-500/30",
    },
    rose: {
      wrap: isLight ? "bg-rose-50 text-rose-600" : "bg-rose-500/10 text-rose-400",
      glow: "group-hover:bg-rose-500/10",
      border: isLight ? "hover:border-rose-200" : "hover:border-rose-500/30",
    },
    amber: {
      wrap: isLight ? "bg-amber-50 text-amber-600" : "bg-amber-500/10 text-amber-400",
      glow: "group-hover:bg-amber-500/10",
      border: isLight ? "hover:border-amber-200" : "hover:border-amber-500/30",
    },
    emerald: {
      wrap: isLight ? "bg-emerald-50 text-emerald-600" : "bg-emerald-500/10 text-emerald-400",
      glow: "group-hover:bg-emerald-500/10",
      border: isLight ? "hover:border-emerald-200" : "hover:border-emerald-500/30",
    },
    cyan: {
      wrap: isLight ? "bg-cyan-50 text-cyan-600" : "bg-cyan-500/10 text-cyan-400",
      glow: "group-hover:bg-cyan-500/10",
      border: isLight ? "hover:border-cyan-200" : "hover:border-cyan-500/30",
    },
  }[iconColor];

  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-3.5 border relative group overflow-hidden transition-all duration-200 ${
        isLight
          ? "bg-white/95 border-slate-200/90"
          : "bg-[#090d16]/90 border-[#1e293b]"
      } ${colorMap.border} hover:-translate-y-0.5 ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      <div className={`absolute -top-8 -right-8 w-20 h-20 rounded-full blur-xl transition-all pointer-events-none opacity-30 ${colorMap.glow}`} />
      
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold tracking-wider uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>
          {label}
        </span>
        {Icon && (
          <div className={`p-1.5 rounded-lg transition-transform duration-200 group-hover:scale-105 ${colorMap.wrap}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-black tracking-tight tabular-nums ${isLight ? "text-slate-900" : "text-white"}`}>
          {value}
        </span>
        {unit && (
          <span className={`text-[11px] font-semibold ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            {unit}
          </span>
        )}
      </div>

      {(description || trend) && (
        <div className="mt-2 flex items-center justify-between text-[11px]">
          {description && (
            <span className={`truncate ${isLight ? "text-slate-500" : "text-slate-400"}`}>
              {description}
            </span>
          )}
          {trend && (
            <span
              className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded shrink-0 ml-auto ${
                trendDirection === "up"
                  ? isLight ? "bg-emerald-50 text-emerald-700" : "bg-emerald-500/15 text-emerald-400"
                  : trendDirection === "down"
                    ? isLight ? "bg-rose-50 text-rose-700" : "bg-rose-500/15 text-rose-400"
                    : isLight ? "bg-slate-100 text-slate-600" : "bg-slate-800 text-slate-300"
              }`}
            >
              {trend}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function SubTabs<T extends string>({
  isLight,
  value,
  onChange,
  tabs,
}: Themed & {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string; icon?: React.ComponentType<{ className?: string }>; count?: number }[];
}) {
  const t = tokens(isLight);
  return (
    <div className={`flex items-center gap-1 overflow-x-auto border-b ${t.border} pb-1.5 -mx-1 px-1`}>
      {tabs.map(({ id, label, icon: Icon, count }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`btn-interactive relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              isActive
                ? isLight
                  ? "bg-indigo-50 text-indigo-600 border border-indigo-200/80"
                  : "bg-indigo-600/15 text-indigo-400 border border-indigo-500/25"
                : isLight
                  ? "text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-900"
                  : "text-slate-400 border border-transparent hover:bg-slate-800/50 hover:text-white"
            }`}
          >
            {Icon && <Icon className={`h-3 w-3 shrink-0 ${isActive ? "text-indigo-500" : ""}`} />}
            <span>{label}</span>
            {count !== undefined && (
              <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                isActive
                  ? isLight ? "bg-indigo-100 text-indigo-700" : "bg-indigo-500/30 text-indigo-200"
                  : t.chip
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  isLight,
  variant = "secondary",
  icon: Icon,
  busy,
  children,
  className = "",
  ...rest
}: Themed &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    icon?: React.ComponentType<{ className?: string }>;
    busy?: boolean;
  }) {
  const t = tokens(isLight);
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white border-transparent",
    secondary: `${t.card} ${t.body} ${t.hover} border ${t.border}`,
    ghost: `border-transparent ${t.muted} ${t.hover}`,
    danger: isLight
      ? "bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
      : "bg-rose-500/10 border-rose-500/25 text-rose-400 hover:bg-rose-500/20",
  };

  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`btn-interactive inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : Icon && <Icon className="h-3 w-3" />}
      {children}
    </button>
  );
}

export function Field({
  isLight,
  label,
  hint,
  children,
  className = "",
}: Themed & { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  const t = tokens(isLight);
  return (
    <label className={`block ${className}`}>
      <span className={`block text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${t.muted}`}>
        {label}
      </span>
      {children}
      {hint && <span className={`block text-[11px] mt-1 ${t.faint}`}>{hint}</span>}
    </label>
  );
}

export function TextInput({
  isLight,
  className = "",
  ...rest
}: Themed & React.InputHTMLAttributes<HTMLInputElement>) {
  const t = tokens(isLight);
  return (
    <input
      {...rest}
      className={`w-full border rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500 transition-colors ${t.input} ${className}`}
    />
  );
}

export function TextArea({
  isLight,
  className = "",
  ...rest
}: Themed & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const t = tokens(isLight);
  return (
    <textarea
      {...rest}
      className={`w-full border rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500 transition-colors resize-y ${t.input} ${className}`}
    />
  );
}

export function Select({
  isLight,
  className = "",
  children,
  ...rest
}: Themed & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const t = tokens(isLight);
  return (
    <div className="relative">
      <select
        {...rest}
        className={`w-full border rounded-lg pl-3 pr-8 py-2 text-xs outline-none focus:border-indigo-500 appearance-none cursor-pointer transition-colors ${t.input} ${className}`}
      >
        {children}
      </select>
      <ChevronDown className={`h-3.5 w-3.5 absolute right-2.5 top-2.5 pointer-events-none ${t.faint}`} />
    </div>
  );
}

export function Toggle({
  isLight,
  checked,
  onChange,
  label,
  hint,
}: Themed & { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const t = tokens(isLight);
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-2.5 text-left cursor-pointer group"
    >
      <span
        className={`mt-0.5 h-4 w-7 rounded-full shrink-0 relative transition-colors ${
          checked ? "bg-indigo-600" : isLight ? "bg-slate-300" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            checked ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className={`block text-xs font-medium ${t.body}`}>{label}</span>
        {hint && <span className={`block text-[11px] ${t.faint}`}>{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Free-text list editor.
 *
 * Every list in this feature set — target categories, locations, exclusions,
 * selling points — is deliberately free-form, because a fixed vocabulary of what
 * a business can be is what stopped the product working outside one vertical. So
 * this takes anything the user types, and never offers a closed set of options.
 */
export function TagInput({
  isLight,
  values,
  onChange,
  placeholder,
  max = 40,
}: Themed & {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const t = tokens(isLight);
  const [draft, setDraft] = useState("");

  const commit = useCallback(
    (raw: string) => {
      // Splitting on commas here so a pasted list behaves the way it looks.
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      const merged = [...values];
      for (const part of parts) {
        if (merged.length >= max) break;
        if (!merged.some((v) => v.toLowerCase() === part.toLowerCase())) merged.push(part);
      }
      onChange(merged);
      setDraft("");
    },
    [values, onChange, max]
  );

  return (
    <div
      className={`border rounded-lg px-2 py-2 flex flex-wrap gap-1.5 items-center ${t.input} focus-within:border-indigo-500 transition-colors`}
    >
      {values.map((value) => (
        <span
          key={value}
          className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-medium ${t.chip}`}
        >
          {value}
          <button
            type="button"
            onClick={() => onChange(values.filter((v) => v !== value))}
            className="rounded hover:text-rose-500 cursor-pointer"
            aria-label={`Remove ${value}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={values.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-xs px-1 py-0.5"
      />
      {draft.trim() && (
        <button
          type="button"
          onClick={() => commit(draft)}
          className="text-indigo-500 hover:text-indigo-400 cursor-pointer"
          aria-label="Add"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────────────────────

export type NoticeTone = "info" | "warn" | "error" | "success";

export function Notice({
  isLight,
  tone = "info",
  title,
  children,
  onDismiss,
}: Themed & {
  tone?: NoticeTone;
  title?: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
}) {
  const palette: Record<NoticeTone, { wrap: string; icon: React.ComponentType<{ className?: string }> }> = {
    info: {
      wrap: isLight
        ? "bg-indigo-50 border-indigo-200 text-indigo-900"
        : "bg-indigo-950/30 border-indigo-900/60 text-indigo-200",
      icon: Info,
    },
    warn: {
      wrap: isLight
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-amber-950/30 border-amber-900/60 text-amber-200",
      icon: AlertTriangle,
    },
    error: {
      wrap: isLight
        ? "bg-rose-50 border-rose-200 text-rose-900"
        : "bg-rose-950/30 border-rose-900/60 text-rose-200",
      icon: AlertTriangle,
    },
    success: {
      wrap: isLight
        ? "bg-emerald-50 border-emerald-200 text-emerald-900"
        : "bg-emerald-950/30 border-emerald-900/60 text-emerald-200",
      icon: Check,
    },
  };
  const { wrap, icon: Icon } = palette[tone];

  return (
    <div className={`border rounded-xl px-3.5 py-3 flex items-start gap-2.5 text-xs ${wrap}`}>
      <Icon className="h-4 w-4 mt-px shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        {children}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Renders a thrown error, translating the ones with a specific cause.
 *
 * A 403 from these endpoints is almost always a role problem rather than a bug,
 * and a 503 means every AI provider failed — both are worth naming, because the
 * user's next action is different in each case.
 */
export function ErrorNotice({
  isLight,
  error,
  onDismiss,
}: Themed & { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;

  if (error instanceof ApiError && error.isPermissionDenied) {
    return (
      <Notice isLight={isLight} tone="warn" title="Your role cannot do this" onDismiss={onDismiss}>
        This action needs the <code className="font-mono">{error.permission}</code> permission. Ask a
        workspace owner or admin to make the change, or to grant it to you.
      </Notice>
    );
  }

  if (error instanceof ApiError && error.isAiUnavailable) {
    return (
      <Notice isLight={isLight} tone="warn" title="No AI provider answered" onDismiss={onDismiss}>
        {error.message}
        {error.attempts && error.attempts.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] opacity-80">
            {error.attempts.map((a, i) => (
              <li key={i}>
                {a.provider}: {a.message}
              </li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }

  return (
    <Notice isLight={isLight} tone="error" onDismiss={onDismiss}>
      {messageOf(error)}
    </Notice>
  );
}

export function Spinner({ isLight, label }: Themed & { label?: string }) {
  const t = tokens(isLight);
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-xs ${t.muted}`}>
      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
      {label || "Loading…"}
    </div>
  );
}

export function EmptyState({
  isLight,
  icon: Icon,
  title,
  children,
  action,
}: Themed & {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = tokens(isLight);
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {Icon && (
        <div
          className={`h-10 w-10 rounded-xl border flex items-center justify-center mb-3 ${t.inset}`}
        >
          <Icon className="h-4.5 w-4.5 text-indigo-500" />
        </div>
      )}
      <div className={`text-sm font-semibold ${t.heading}`}>{title}</div>
      {children && <div className={`text-xs mt-1.5 max-w-md leading-relaxed ${t.muted}`}>{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({
  isLight,
  tone = "neutral",
  dot = false,
  children,
}: Themed & {
  tone?: "neutral" | "hot" | "warm" | "cold" | "good" | "bad" | "info" | "emerald" | "amber" | "rose";
  dot?: boolean;
  children: React.ReactNode;
}) {
  const t = tokens(isLight);
  const palette: Record<string, string> = {
    neutral: t.chip,
    info: isLight ? "bg-indigo-50 text-indigo-700 border border-indigo-200/70" : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25",
    hot: isLight ? "bg-rose-50 text-rose-700 border border-rose-200/70" : "bg-rose-500/15 text-rose-300 border border-rose-500/25",
    warm: isLight ? "bg-amber-50 text-amber-700 border border-amber-200/70" : "bg-amber-500/15 text-amber-300 border border-amber-500/25",
    cold: isLight ? "bg-slate-100 text-slate-600 border border-slate-200/70" : "bg-slate-800/80 text-slate-300 border border-slate-700/50",
    good: isLight ? "bg-emerald-50 text-emerald-700 border border-emerald-200/70" : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25",
    bad: isLight ? "bg-rose-50 text-rose-700 border border-rose-200/70" : "bg-rose-500/15 text-rose-300 border border-rose-500/25",
    emerald: isLight ? "bg-emerald-50 text-emerald-700 border border-emerald-200/70" : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25",
    amber: isLight ? "bg-amber-50 text-amber-700 border border-amber-200/70" : "bg-amber-500/15 text-amber-300 border border-amber-500/25",
    rose: isLight ? "bg-rose-50 text-rose-700 border border-rose-200/70" : "bg-rose-500/15 text-rose-300 border border-rose-500/25",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${palette[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A labelled proportion bar. Used for completeness and for score out of max. */
export function Meter({
  isLight,
  value,
  max = 100,
  label,
  tone = "indigo",
}: Themed & { value: number; max?: number; label?: string; tone?: "indigo" | "emerald" | "amber" }) {
  const t = tokens(isLight);
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[tone];

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[11px] font-medium ${t.muted}`}>{label}</span>
          <span className={`text-[11px] font-semibold tabular-nums ${t.body}`}>
            {value}
            <span className={t.faint}>/{max}</span>
          </span>
        </div>
      )}
      <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-[#1e293b]"}`}>
        <div className={`h-full rounded-full transition-all duration-500 ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Small inline confirmation, so a destructive click is never a single click. */
export function ConfirmButton({
  isLight,
  onConfirm,
  label,
  confirmLabel = "Confirm",
  icon,
  busy,
}: Themed & {
  onConfirm: () => void;
  label: string;
  confirmLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = window.setTimeout(() => setArmed(false), 4000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [armed]);

  if (!armed) {
    return (
      <Button isLight={isLight} variant="danger" icon={icon} onClick={() => setArmed(true)} busy={busy}>
        {label}
      </Button>
    );
  }

  return (
    <Button
      isLight={isLight}
      variant="danger"
      busy={busy}
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
    >
      {confirmLabel}?
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  clearError: () => void;
}

/**
 * Loads once on mount and on demand.
 *
 * Tracks whether the component is still mounted, because every panel here has a
 * tab that can be switched away from mid-request, and a setState after unmount is
 * both a warning and a hidden source of stale data.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((result) => {
        if (cancelled || !alive.current) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || !alive.current) return;
        setError(err);
      })
      .finally(() => {
        if (cancelled || !alive.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return {
    data,
    error,
    loading,
    reload: useCallback(() => setNonce((n) => n + 1), []),
    setData,
    clearError: useCallback(() => setError(null), []),
  };
}

/** Runs a mutation, tracking its in-flight and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await fn();
      if (successMessage) setDone(successMessage);
      return result;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    busy,
    error,
    done,
    run,
    clearError: useCallback(() => setError(null), []),
    clearDone: useCallback(() => setDone(null), []),
  };
}

/** Formats a byte count for a document list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short relative time, for lists where the exact instant does not matter. */
export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

let activeModalCount = 0;

/**
 * Portals any modal or dialog overlay directly into document.body
 * so that it cleanly covers the entire viewport (including fixed sidebars and headers)
 * without being trapped by parent stacking contexts or overflow constraints.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    activeModalCount++;
    if (activeModalCount === 1) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, []);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

