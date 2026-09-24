/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suppression list — the people this workspace must not contact again.
 *
 * Opt-outs were already recorded and enforced server-side, but with no screen an
 * operator could not answer the two questions that matter when a complaint
 * arrives: "is this person suppressed?" and "when and how did that happen?".
 * Nor could they honour a request made by phone, or undo a mistake. This panel
 * covers those four actions and nothing else.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldOff, Search, Plus, Trash2, RefreshCw, Loader2, Mail, AlertTriangle } from "lucide-react";
import WhatsAppLogo from "../WhatsAppLogo";

type SuppressionChannel = "email" | "whatsapp";

interface SuppressionRecord {
  id: string;
  channel: SuppressionChannel;
  contactKey: string;
  reason: string;
  source?: string;
  notes?: string;
  createdAt: string;
}

interface SuppressionPanelProps {
  isLight?: boolean;
}

const PAGE_SIZE = 25;

/** Reasons the API accepts, with wording an operator would actually use. */
const REASONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Asked us directly" },
  { value: "opt_out_reply", label: "Replied STOP / unsubscribe" },
  { value: "complaint", label: "Complaint" },
  { value: "bounce", label: "Address bounced" },
];

function reasonLabel(reason: string): string {
  return REASONS.find((entry) => entry.value === reason)?.label || reason;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function SuppressionPanel({ isLight = false }: SuppressionPanelProps) {
  const [records, setRecords] = useState<SuppressionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState<"all" | SuppressionChannel>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newChannel, setNewChannel] = useState<SuppressionChannel>("email");
  const [newContact, setNewContact] = useState("");
  const [newReason, setNewReason] = useState("manual");
  const [newNotes, setNewNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const surface = isLight ? "bg-white border-slate-200" : "bg-[#0b1120] border-[#1e293b]";
  const heading = isLight ? "text-slate-900" : "text-white";
  const muted = isLight ? "text-slate-500" : "text-slate-400";
  const input = isLight
    ? "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
    : "bg-[#030712] border-[#1e293b] text-white placeholder:text-slate-500";

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/suppressions?${params}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not load the suppression list.");
      }
      const data = await res.json();
      setRecords(data.records || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err?.message || "Could not load the suppression list.");
      setRecords([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, channelFilter, search]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  // Filter changes must not leave the view on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [channelFilter, search]);

  const addSuppression = async () => {
    const contact = newContact.trim();
    if (!contact) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/suppressions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: newChannel, contact, reason: newReason, notes: newNotes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not add this contact.");
      setNotice(`${contact} will no longer be contacted on ${newChannel === "email" ? "email" : "WhatsApp"}.`);
      setNewContact("");
      setNewNotes("");
      await fetchRecords();
    } catch (err: any) {
      setError(err?.message || "Could not add this contact.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeSuppression = async (record: SuppressionRecord) => {
    if (!window.confirm(`Allow outreach to ${record.contactKey} again on ${record.channel}?`)) return;
    setRemoving(record.id);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ channel: record.channel, contact: record.contactKey });
      const res = await fetch(`/api/suppressions?${params}`, { method: "DELETE", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not remove this entry.");
      setNotice(`${record.contactKey} can be contacted again on ${record.channel}.`);
      await fetchRecords();
    } catch (err: any) {
      setError(err?.message || "Could not remove this entry.");
    } finally {
      setRemoving(null);
    }
  };

  const counts = useMemo(
    () => ({
      email: records.filter((row) => row.channel === "email").length,
      whatsapp: records.filter((row) => row.channel === "whatsapp").length,
    }),
    [records]
  );

  return (
    <div className="space-y-5">
      <section className={`p-4 sm:p-5 border rounded-xl ${surface}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldOff className="h-4 w-4 text-rose-500 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className={`text-xs font-bold tracking-tight ${heading}`}>Do not contact</h2>
              <p className={`text-[11px] mt-0.5 max-w-2xl leading-relaxed ${muted}`}>
                Anyone listed here is excluded when a campaign is generated and checked again before every send.
                Replies containing STOP or unsubscribe are added automatically. Entries are per channel: an email
                opt-out does not silence WhatsApp.
              </p>
            </div>
          </div>
          <button
            onClick={() => void fetchRecords()}
            disabled={isLoading}
            className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 border rounded-lg cursor-pointer transition-all disabled:opacity-50 ${
              isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-300 hover:bg-slate-800/40"
            }`}
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Refresh
          </button>
        </div>
      </section>

      {/* Add an entry for a request that arrived by phone or in person. */}
      <section className={`p-4 sm:p-5 border rounded-xl ${surface}`}>
        <h3 className={`text-xs font-bold mb-3 ${heading}`}>Add a contact</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
          <div className="md:col-span-3">
            <label htmlFor="suppression-channel" className={`block text-[10px] font-bold tracking-wider uppercase mb-1 ${muted}`}>
              Channel
            </label>
            <select
              id="suppression-channel"
              value={newChannel}
              onChange={(event) => setNewChannel(event.target.value as SuppressionChannel)}
              className={`w-full border rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-indigo-500 ${input}`}
            >
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <div className="md:col-span-4">
            <label htmlFor="suppression-contact" className={`block text-[10px] font-bold tracking-wider uppercase mb-1 ${muted}`}>
              {newChannel === "email" ? "Email address" : "Phone number"}
            </label>
            <input
              id="suppression-contact"
              type={newChannel === "email" ? "email" : "tel"}
              value={newContact}
              onChange={(event) => setNewContact(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addSuppression();
              }}
              placeholder={newChannel === "email" ? "owner@business.example" : "+1 555 010 2030"}
              className={`w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500 ${input}`}
            />
          </div>
          <div className="md:col-span-3">
            <label htmlFor="suppression-reason" className={`block text-[10px] font-bold tracking-wider uppercase mb-1 ${muted}`}>
              Reason
            </label>
            <select
              id="suppression-reason"
              value={newReason}
              onChange={(event) => setNewReason(event.target.value)}
              className={`w-full border rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-indigo-500 ${input}`}
            >
              {REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              onClick={() => void addSuppression()}
              disabled={isSaving || !newContact.trim()}
              className="w-full flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-all disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Add
            </button>
          </div>
          <div className="md:col-span-12">
            <label htmlFor="suppression-notes" className={`block text-[10px] font-bold tracking-wider uppercase mb-1 ${muted}`}>
              Note (optional)
            </label>
            <input
              id="suppression-notes"
              type="text"
              value={newNotes}
              onChange={(event) => setNewNotes(event.target.value)}
              placeholder="Where the request came from, so the record is defensible later"
              className={`w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500 ${input}`}
            />
          </div>
        </div>

        {error && (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-rose-500" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-2.5 text-xs text-emerald-500" role="status">
            {notice}
          </p>
        )}
      </section>

      {/* The list itself. */}
      <section className={`border rounded-xl overflow-hidden ${surface}`}>
        <div className={`p-4 flex flex-col md:flex-row md:items-center gap-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]"}`}>
          <div className="relative flex-grow">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${muted}`} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email or phone"
              aria-label="Search suppressed contacts"
              className={`w-full border rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${input}`}
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "email", "whatsapp"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setChannelFilter(value)}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                  channelFilter === value
                    ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-500 font-semibold"
                    : isLight
                      ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                      : "border-[#1e293b] text-slate-400 hover:bg-slate-800/40"
                }`}
              >
                {value === "all" ? "All" : value === "email" ? "Email" : "WhatsApp"}
              </button>
            ))}
          </div>
          <span className={`text-[11px] whitespace-nowrap ${muted}`}>
            {total} total
            {records.length > 0 && ` · ${counts.email} email · ${counts.whatsapp} WhatsApp on this page`}
          </span>
        </div>

        {isLoading && records.length === 0 ? (
          <div className={`flex items-center justify-center gap-2 py-12 text-xs ${muted}`} role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : records.length === 0 ? (
          <div className={`py-12 text-center text-xs ${muted}`}>
            <ShieldOff className="h-5 w-5 mx-auto mb-2 opacity-40" aria-hidden="true" />
            No one is suppressed{search.trim() || channelFilter !== "all" ? " for this filter" : ""}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Contacts excluded from outreach</caption>
              <thead>
                <tr className={isLight ? "bg-slate-50 text-slate-500" : "bg-[#030712] text-slate-400"}>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Channel</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Contact</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Reason</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Added</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Note</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className={`border-t ${isLight ? "border-slate-100" : "border-[#1e293b]"}`}>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {record.channel === "email" ? (
                          <Mail className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                        ) : (
                          <WhatsAppLogo className="h-3.5 w-3.5" />
                        )}
                        <span className={heading}>{record.channel === "email" ? "Email" : "WhatsApp"}</span>
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 font-medium ${heading}`}>{record.contactKey}</td>
                    <td className={`px-4 py-2.5 ${muted}`}>
                      {reasonLabel(record.reason)}
                      {record.source ? <span className="opacity-60"> · {record.source}</span> : null}
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${muted}`}>{formatWhen(record.createdAt)}</td>
                    <td className={`px-4 py-2.5 max-w-[22rem] truncate ${muted}`} title={record.notes || ""}>
                      {record.notes || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => void removeSuppression(record)}
                        disabled={removing === record.id}
                        aria-label={`Allow outreach to ${record.contactKey} again`}
                        className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-400 cursor-pointer disabled:opacity-50"
                      >
                        {removing === record.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className={`flex items-center justify-between gap-2 p-3 border-t ${isLight ? "border-slate-200" : "border-[#1e293b]"}`}>
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className={`text-[11px] px-3 py-1.5 border rounded-lg cursor-pointer disabled:opacity-40 ${
                isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-300 hover:bg-slate-800/40"
              }`}
            >
              Previous
            </button>
            <span className={`text-[11px] ${muted}`}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className={`text-[11px] px-3 py-1.5 border rounded-lg cursor-pointer disabled:opacity-40 ${
                isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-300 hover:bg-slate-800/40"
              }`}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
