/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive searchable dropdown for picking an outreach template.
 * Lightweight, dependency-free combobox: click to open, type to filter,
 * keyboard navigable (Up/Down/Enter/Escape), closes on outside click.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check, Sparkles } from "lucide-react";

export interface TemplateDropdownOption {
  id: string;
  label: string;
  subtitle?: string;
  badge?: string;
}

interface TemplateDropdownProps {
  options: TemplateDropdownOption[];
  value: string;
  onChange: (id: string) => void;
  isLight: boolean;
  placeholder?: string;
  /** Label for the empty-value ("no template selected") option. */
  defaultLabel?: string;
  emptyMessage?: string;
}

export default function TemplateDropdown({
  options,
  value,
  onChange,
  isLight,
  placeholder = "Search templates...",
  defaultLabel = "AI-generated pitch (default)",
  emptyMessage = "No templates found.",
}: TemplateDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allOptions: TemplateDropdownOption[] = useMemo(
    () => [{ id: "", label: defaultLabel }, ...options],
    [options, defaultLabel]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.subtitle || "").toLowerCase().includes(q)
    );
  }, [allOptions, query]);

  const selected = allOptions.find((o) => o.id === value) || allOptions[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 text-xs border rounded-lg px-2.5 py-2 cursor-pointer transition-all focus:outline-none focus:border-indigo-500 ${
          isLight ? "bg-white text-slate-800 border-slate-200 hover:border-slate-300" : "bg-[#030712] text-white border-[#1e293b] hover:border-slate-700"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {!value && <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />}
          <span className="truncate">{selected?.label}</span>
          {selected?.badge && (
            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
              {selected.badge}
            </span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-1 w-full rounded-lg border shadow-lg overflow-hidden ${
            isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"
          }`}
        >
          <div className={`flex items-center gap-2 px-2.5 py-2 border-b ${isLight ? "border-slate-100" : "border-[#1e293b]/60"}`}>
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={`w-full text-xs bg-transparent focus:outline-none ${isLight ? "text-slate-800 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
            />
          </div>

          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-slate-500">{emptyMessage}</div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.id === value;
                const isHighlighted = idx === highlight;
                return (
                  <button
                    key={opt.id || "__default__"}
                    type="button"
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => commit(opt.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer transition-colors ${
                      isHighlighted
                        ? isLight ? "bg-indigo-50" : "bg-indigo-600/10"
                        : "bg-transparent"
                    } ${isLight ? "hover:bg-indigo-50" : "hover:bg-indigo-600/10"}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className={`flex items-center gap-1.5 truncate font-medium ${isLight ? "text-slate-800" : "text-slate-200"}`}>
                        {!opt.id && <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />}
                        <span className="truncate">{opt.label}</span>
                      </span>
                      {opt.subtitle && (
                        <span className="block text-[9px] text-slate-500 truncate mt-0.5">{opt.subtitle}</span>
                      )}
                    </span>
                    {opt.badge && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
