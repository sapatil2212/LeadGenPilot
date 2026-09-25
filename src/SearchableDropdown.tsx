/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive searchable dropdown component for dropdowns and filters.
 * Lightweight, dependency-free combobox: click to open, type to filter,
 * keyboard navigable (Up/Down/Enter/Escape), closes on outside click.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check } from "lucide-react";

export interface SearchableDropdownOption {
  id: string;
  label: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
}

interface SearchableDropdownProps {
  options: SearchableDropdownOption[];
  value: string;
  onChange: (id: string) => void;
  isLight: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}

export default function SearchableDropdown({
  options,
  value,
  onChange,
  isLight,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyMessage = "No options found.",
  className = "",
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.subtitle || "").toLowerCase().includes(q)
    );
  }, [options, query]);

  const selected = options.find((o) => o.id === value);

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
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 text-xs border rounded-lg px-2.5 py-2 cursor-pointer transition-all focus:outline-none focus:border-indigo-500 ${
          isLight
            ? "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
            : "bg-[#030712] text-white border-[#1e293b] hover:border-[#334155]"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
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
          style={{ minWidth: "160px" }}
        >
          <div className={`flex items-center gap-2 px-2.5 py-2 border-b ${isLight ? "border-slate-100" : "border-[#1e293b]/60"}`}>
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
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
                  <div
                    key={opt.id}
                    onClick={() => commit(opt.id)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                      isSelected
                        ? isLight ? "bg-indigo-50 text-indigo-600 font-medium" : "bg-indigo-600/10 text-indigo-400 font-medium"
                        : isHighlighted
                          ? isLight ? "bg-slate-50 text-slate-900" : "bg-slate-800/60 text-white"
                          : isLight ? "text-slate-600" : "text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                      <div className="truncate">
                        <span className="block truncate">{opt.label}</span>
                        {opt.subtitle && (
                          <span className={`block text-[10px] truncate ${isLight ? "text-slate-400" : "text-slate-500"}`}>
                            {opt.subtitle}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
