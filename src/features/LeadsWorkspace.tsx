import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive, Bot, BriefcaseBusiness, Building2, CalendarClock, Check, ChevronLeft,
  ChevronRight, CircleUserRound, Database, Download, ExternalLink, FileUp, Filter,
  Flame, FolderOpen, Globe2, Import, ListPlus, Loader2, Mail, MapPin, Menu, MessageSquare,
  MoreHorizontal, Phone, Plus, RefreshCw, Search, Send, ShieldOff, Snowflake, Sparkles,
  Tag, Trash2, UserRound, UsersRound, X, Zap,
  type LucideIcon,
} from "lucide-react";
import type { Lead, LeadList } from "../types";

type Permission = "VIEW_LEADS" | "EDIT_LEADS" | "DELETE_LEADS" | "EXPORT_LEADS" | "MANAGE_CRM" | "CREATE_CAMPAIGN";
type Query = {
  search: string; fit: string; source: string; status: string; outreach: string; contact: string;
  industry: string; location: string; dateFrom: string; dateTo: string; mine: boolean;
  sortBy: string; sortDir: "asc" | "desc"; page: number; pageSize: number; listId: string;
};
type Counts = {
  all: number; new: number; mine: number; highFit: number; mediumFit: number; lowFit: number;
  unscored: number; recent: number; sources: Record<string, number>; statuses: Record<string, number>;
  outreach: Record<string, number>;
};
type Summary = {
  counts: Counts; permissions: Permission[];
  assignees: Array<{ id: string; name: string; email?: string; role: string }>;
};
type PageResponse = { leads: Lead[]; total: number; page: number; pageSize: number; totalPages: number };
type Detail = {
  lead: Lead; list?: { id: string; name: string; businessType?: string; location?: string };
  ai: { fitScore?: number; fitReason?: string; scoreBreakdown: Array<{ signal: string; label: string; points: number }>; productFit: any[]; serviceFit: any[]; recommendation?: string };
  outreach: { messages: any[]; dispatches: any[]; conversations: any[] };
};

type Props = {
  isLight: boolean;
  onOpenOutreach: (lead: Lead) => void;
  onAddToCampaign: (leadIds: string[]) => void;
  onFindLeads: () => void;
};

const DEFAULT_QUERY: Query = {
  search: "", fit: "ALL", source: "ALL", status: "ALL", outreach: "ALL", contact: "ALL",
  industry: "", location: "", dateFrom: "", dateTo: "", mine: false,
  sortBy: "aiFit", sortDir: "desc", page: 1, pageSize: 25, listId: "ALL",
};
const STATUS_LABELS: Record<string, string> = {
  NEW: "New", CONTACTED: "Contacted", REPLIED: "Replied", QUALIFIED: "Qualified",
  MEETING: "Meeting", NOT_INTERESTED: "Not Interested", SUPPRESSED: "Suppressed",
};
const SOURCE_LABELS: Record<string, string> = {
  GOOGLE_MAPS: "Google Maps", WEB_DISCOVERY: "Web Discovery", IMPORTED: "Imported",
  GOOGLE_SHEETS: "Google Sheets", AI_DISCOVERED: "AI Discovered", API: "API", MANUAL: "Manual",
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}

function fitOf(lead: Lead) {
  const score = typeof lead.icpFitScore === "number" ? lead.icpFitScore : null;
  if (score === null) return { score, label: "Not scored", tone: "slate", Icon: Sparkles };
  if (score >= 75) return { score, label: "High Fit", tone: "rose", Icon: Flame };
  if (score >= 40) return { score, label: "Medium Fit", tone: "amber", Icon: Zap };
  return { score, label: "Low Fit", tone: "sky", Icon: Snowflake };
}

function outreachOf(lead: Lead) {
  if (lead.conversationStatus === "REPLIED" || lead.status === "REPLIED") return "Replied";
  if (lead.emailStatus === "SENT" && lead.whatsappStatus === "SENT") return "Email + WhatsApp Sent";
  if (lead.emailStatus === "SENT") return "Email Sent";
  if (lead.whatsappStatus === "SENT") return "WhatsApp Sent";
  if (lead.emailStatus === "FAILED" || lead.whatsappStatus === "FAILED") return "Failed";
  return "Not Contacted";
}

function sourceLabel(value?: string) { return SOURCE_LABELS[value || ""] || "Unknown"; }
function statusLabel(value?: string) { return STATUS_LABELS[value || "NEW"] || "New"; }

export default function LeadsWorkspace({ isLight, onOpenOutreach, onAddToCampaign, onFindLeads }: Props) {
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState<PageResponse>({ leads: [], total: 0, page: 1, pageSize: 25, totalPages: 1 });
  const [lists, setLists] = useState<LeadList[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "intelligence" | "ai" | "outreach" | "crm">("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  const colors = {
    panel: isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]",
    panel2: isLight ? "bg-slate-50 border-slate-200" : "bg-[#050914] border-[#1e293b]",
    text: isLight ? "text-slate-900" : "text-white",
    body: isLight ? "text-slate-600" : "text-slate-300",
    muted: isLight ? "text-slate-500" : "text-slate-400",
    input: isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#030712] border-[#1e293b] text-white",
    hover: isLight ? "hover:bg-slate-50" : "hover:bg-slate-800/30",
  };

  const can = useCallback((permission: Permission) => summary?.permissions.includes(permission) ?? false, [summary]);
  const updateQuery = useCallback((patch: Partial<Query>) => {
    setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
    setSelected(new Set());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(query.search), 350);
    return () => window.clearTimeout(timer);
  }, [query.search]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [listData, summaryData] = await Promise.all([
        requestJson<LeadList[]>("/api/crm/lists"), requestJson<Summary>("/api/crm/summary"),
      ]);
      setLists(listData); setSummary(summaryData);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load lead metadata."); }
  }, []);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      paginated: "true", page: String(query.page), pageSize: String(query.pageSize),
      sortBy: query.sortBy, sortDir: query.sortDir,
    });
    const values: Record<string, string> = {
      search: debouncedSearch, fit: query.fit, source: query.source, status: query.status,
      outreach: query.outreach, contact: query.contact, industry: query.industry,
      location: query.location, dateFrom: query.dateFrom, dateTo: query.dateTo,
    };
    Object.entries(values).forEach(([key, value]) => { if (value && value !== "ALL") params.set(key, value); });
    if (query.mine) params.set("mine", "true");
    return params;
  }, [debouncedSearch, query.page, query.pageSize, query.sortBy, query.sortDir, query.fit, query.source, query.status, query.outreach, query.contact, query.industry, query.location, query.dateFrom, query.dateTo, query.mine]);

  const loadLeads = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true); setError("");
    try {
      const base = query.listId === "ALL" ? "/api/crm/leads" : `/api/crm/lists/${query.listId}/leads`;
      const response = await requestJson<PageResponse>(`${base}?${queryParams}`, { signal: controller.signal });
      setPage(response);
      if (query.page > response.totalPages) setQuery((current) => ({ ...current, page: response.totalPages }));
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Could not load leads.");
    } finally { if (activeRequest.current === controller) setLoading(false); }
  }, [query.listId, query.page, query.pageSize, query.sortBy, query.sortDir, query.fit, query.source, query.status, query.outreach, query.contact, query.industry, query.location, query.dateFrom, query.dateTo, query.mine, queryParams]);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);
  useEffect(() => { loadLeads(); return () => activeRequest.current?.abort(); }, [loadLeads]);

  const openDetail = async (lead: Lead) => {
    if (!lead.id) return;
    setDetailId(lead.id); setDetail(null); setDetailLoading(true); setDetailTab("overview");
    try { setDetail(await requestJson<Detail>(`/api/crm/leads/${lead.id}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load lead detail."); }
    finally { setDetailLoading(false); }
  };

  const refresh = async (message?: string) => {
    await Promise.all([loadLeads(), loadReferenceData()]);
    if (message) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  };

  const runBulk = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string, idsOverride?: string[]) => {
    const ids = idsOverride ?? Array.from(selected);
    if (!ids.length) return;
    if (confirmText && !window.confirm(`${confirmText}\n\nAffected leads: ${ids.length}`)) return;
    try {
      const result = await requestJson<{ affected: number }>("/api/crm/bulk/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, ...extra }),
      });
      setSelected(new Set()); setDetailId(null); setDetail(null);
      await refresh(`${result.affected} lead${result.affected === 1 ? "" : "s"} updated.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Bulk action failed."); }
  };

  const exportLeads = (ids?: string[]) => {
    if (!can("EXPORT_LEADS")) return;
    const params = new URLSearchParams(queryParams);
    params.delete("paginated"); params.delete("page"); params.delete("pageSize");
    if (ids?.length) params.set("ids", ids.join(","));
    window.location.assign(`/api/crm/lists/${query.listId}/export?${params}`);
  };

  const chooseView = (patch: Partial<Query>) => { updateQuery({ ...DEFAULT_QUERY, listId: query.listId, pageSize: query.pageSize, ...patch }); setSidebarOpen(false); };
  const hasFilters = Boolean(debouncedSearch || query.fit !== "ALL" || query.source !== "ALL" || query.status !== "ALL" || query.outreach !== "ALL" || query.contact !== "ALL" || query.industry || query.location || query.dateFrom || query.dateTo || query.mine || query.listId !== "ALL");
  const allPageSelected = page.leads.length > 0 && page.leads.every((lead) => lead.id && selected.has(lead.id));

  return (
    <div className="relative flex h-[calc(100vh-105px)] min-h-[580px] gap-3 overflow-hidden">
      {sidebarOpen && <button aria-label="Close lead navigation" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${colors.panel} fixed bottom-0 left-0 top-0 z-40 w-64 overflow-y-auto border-r p-2.5 transition-transform md:static md:z-auto md:w-52 md:translate-x-0 md:rounded-xl md:border shadow-sm`}>
        <div className="mb-2.5 flex items-center justify-between px-2 py-1 md:hidden"><strong className={`text-xs ${colors.text}`}>Lead views</strong><button onClick={() => setSidebarOpen(false)}><X className="h-3.5 w-3.5" /></button></div>
        <SidebarSection title="Leads">
          <SideItem icon={Database} label="All Leads" count={summary?.counts.all} active={!hasFilters} onClick={() => chooseView({})} />
          <SideItem icon={Plus} label="New Leads" count={summary?.counts.new} active={query.status === "NEW"} onClick={() => chooseView({ status: "NEW" })} />
          <SideItem icon={CircleUserRound} label="My Leads" count={summary?.counts.mine} active={query.mine} onClick={() => chooseView({ mine: true })} />
          <SideItem icon={Flame} label="High Fit" count={summary?.counts.highFit} active={query.fit === "HIGH"} onClick={() => chooseView({ fit: "HIGH" })} tone="text-rose-400" />
          <SideItem icon={Zap} label="Medium Fit" count={summary?.counts.mediumFit} active={query.fit === "MEDIUM"} onClick={() => chooseView({ fit: "MEDIUM" })} tone="text-amber-400" />
          <SideItem icon={Snowflake} label="Low Fit" count={summary?.counts.lowFit} active={query.fit === "LOW"} onClick={() => chooseView({ fit: "LOW" })} tone="text-sky-400" />
          <SideItem icon={CalendarClock} label="Recently Added" count={summary?.counts.recent} active={query.sortBy === "recentlyAdded" && !hasFilters} onClick={() => chooseView({ sortBy: "recentlyAdded" })} />
        </SidebarSection>
        <SidebarSection title="Source">
          <SideItem icon={MapPin} label="Google Maps" count={summary?.counts.sources.GOOGLE_MAPS} active={query.source === "GOOGLE_MAPS"} onClick={() => chooseView({ source: "GOOGLE_MAPS" })} />
          <SideItem icon={Import} label="Imported" count={summary?.counts.sources.IMPORTED} active={query.source === "IMPORTED"} onClick={() => chooseView({ source: "IMPORTED" })} />
          {!!summary?.counts.sources.WEB_DISCOVERY && <SideItem icon={Globe2} label="Web Discovery" count={summary.counts.sources.WEB_DISCOVERY} active={query.source === "WEB_DISCOVERY"} onClick={() => chooseView({ source: "WEB_DISCOVERY" })} />}
          {!!summary?.counts.sources.GOOGLE_SHEETS && <SideItem icon={Database} label="Google Sheets" count={summary.counts.sources.GOOGLE_SHEETS} active={query.source === "GOOGLE_SHEETS"} onClick={() => chooseView({ source: "GOOGLE_SHEETS" })} />}
          {!!summary?.counts.sources.AI_DISCOVERED && <SideItem icon={Bot} label="AI Discovered" count={summary.counts.sources.AI_DISCOVERED} active={query.source === "AI_DISCOVERED"} onClick={() => chooseView({ source: "AI_DISCOVERED" })} />}
        </SidebarSection>
        <SidebarSection title="Status">
          {Object.entries(STATUS_LABELS).map(([value, label]) => <div key={value}><SideItem icon={value === "SUPPRESSED" ? ShieldOff : Check} label={label} count={summary?.counts.statuses[value]} active={query.status === value} onClick={() => chooseView({ status: value })} /></div>)}
        </SidebarSection>
        <SidebarSection title="Outreach">
          <SideItem icon={Archive} label="Not Contacted" count={summary?.counts.outreach.NOT_CONTACTED} active={query.outreach === "NOT_CONTACTED"} onClick={() => chooseView({ outreach: "NOT_CONTACTED" })} />
          <SideItem icon={Mail} label="Email Available" count={summary?.counts.outreach.EMAIL_AVAILABLE} active={query.contact === "EMAIL"} onClick={() => chooseView({ contact: "EMAIL" })} />
          <SideItem icon={MessageSquare} label="WhatsApp Available" count={summary?.counts.outreach.WHATSAPP_AVAILABLE} active={query.contact === "WHATSAPP"} onClick={() => chooseView({ contact: "WHATSAPP" })} />
          <SideItem icon={Phone} label="Phone Available" count={summary?.counts.outreach.PHONE_AVAILABLE} active={query.contact === "PHONE"} onClick={() => chooseView({ contact: "PHONE" })} />
          <SideItem icon={MessageSquare} label="Replied" count={summary?.counts.outreach.REPLIED} active={query.outreach === "REPLIED"} onClick={() => chooseView({ outreach: "REPLIED" })} />
        </SidebarSection>
        <SidebarSection title="Actions">
          <SideItem icon={Filter} label="More Filters" onClick={() => setFiltersOpen(true)} />
          {can("EXPORT_LEADS") && <SideItem icon={Download} label="Export Leads" onClick={() => exportLeads()} />}
          {can("EDIT_LEADS") && <SideItem icon={FileUp} label="Import Leads" onClick={() => setImportOpen(true)} />}
          {can("EDIT_LEADS") && <SideItem icon={Plus} label="Add Lead" onClick={() => setAddOpen(true)} />}
        </SidebarSection>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className={`${colors.panel} rounded-xl border p-2.5 shadow-xs`}>
          <div className="flex flex-wrap items-center gap-2">
            <button className={`btn-interactive rounded-lg border p-1.5 md:hidden ${colors.input}`} onClick={() => setSidebarOpen(true)} aria-label="Open lead navigation"><Menu className="h-3.5 w-3.5" /></button>
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input className={`w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-indigo-500 ${colors.input}`} value={query.search} onChange={(event) => updateQuery({ search: event.target.value })} placeholder="Search name, contact, email, phone, location…" />
            </div>
            <select className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none ${colors.input}`} value={query.listId} onChange={(event) => updateQuery({ listId: event.target.value })} aria-label="Saved lead list">
              <option value="ALL">All saved lists</option>{lists.map((list) => <option value={list.id} key={list.id}>{list.name} ({list.leadCount})</option>)}
            </select>
            <select className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none ${colors.input}`} value={`${query.sortBy}:${query.sortDir}`} onChange={(event) => { const [sortBy, sortDir] = event.target.value.split(":"); updateQuery({ sortBy, sortDir: sortDir as "asc" | "desc" }); }} aria-label="Sort leads">
              <option value="aiFit:desc">AI Fit: High → Low</option><option value="aiFit:asc">AI Fit: Low → High</option>
              <option value="recentlyAdded:desc">Recently Added</option><option value="recentlyAdded:asc">Oldest</option>
              <option value="recentlyContacted:desc">Recently Contacted</option><option value="lastActivity:desc">Last Activity</option>
              <option value="businessName:asc">Business Name</option>
            </select>
            <button className={`btn-interactive inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${colors.input}`} onClick={() => setFiltersOpen(true)}><Filter className="h-3 w-3" /> Filters</button>
            <button className={`btn-interactive rounded-lg border p-1.5 cursor-pointer ${colors.input}`} onClick={() => refresh()} title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
          {hasFilters && <div className="mt-2 flex flex-wrap items-center gap-1 text-[9.5px]"><span className={colors.muted}>Active:</span>{filterChips(query).map((chip) => <span key={chip} className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.2 text-indigo-400 font-semibold">{chip}</span>)}<button className="ml-1 text-rose-400 font-bold hover:underline cursor-pointer" onClick={() => chooseView({})}>Clear</button></div>}
        </div>

        {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{notice}</div>}
        {error && <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-400"><span>{error}</span><button onClick={() => setError("")}><X className="h-3.5 w-3.5" /></button></div>}

        {selected.size > 0 && <BulkBar count={selected.size} isLight={isLight} canDelete={can("DELETE_LEADS")} canExport={can("EXPORT_LEADS")} assignees={summary?.assignees || []} lists={lists} onClear={() => setSelected(new Set())} onCampaign={() => onAddToCampaign(Array.from(selected))} onExport={() => exportLeads(Array.from(selected))} onAction={runBulk} />}

        <div className={`${colors.panel} min-h-0 flex-1 overflow-hidden rounded-xl border shadow-sm`}>
          <div className="h-full overflow-auto scrollbar-thin">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className={`sticky top-0 z-10 border-b text-[9.5px] font-bold uppercase tracking-wider ${isLight ? "bg-slate-50/95 text-slate-500 border-slate-200" : "bg-[#090d16]/95 text-slate-400 border-[#1e293b]"} backdrop-blur-xs`}>
                <tr><th className="w-9 px-2.5 py-2"><input type="checkbox" checked={allPageSelected} onChange={(event) => setSelected(event.target.checked ? new Set(page.leads.flatMap((lead) => lead.id ? [lead.id] : [])) : new Set())} aria-label="Select all leads on this page" className="rounded border-slate-700 text-indigo-600 h-3 w-3" /></th><th className="px-2.5 py-2">Lead</th><th className="px-2.5 py-2">AI Fit</th><th className="hidden px-2.5 py-2 lg:table-cell">Contact</th><th className="hidden px-2.5 py-2 xl:table-cell">Source</th><th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">Outreach</th><th className="px-2.5 py-2 text-right">Actions</th></tr>
              </thead>
              <tbody className={`divide-y text-xs ${isLight ? "divide-slate-100" : "divide-[#1e293b]/50"}`}>
                {loading ? <tr><td colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-400" /><p className={`mt-2 text-xs ${colors.muted}`}>Loading tenant leads…</p></td></tr> : page.leads.length === 0 ? <tr><td colSpan={8}><EmptyState hasFilters={hasFilters} fit={query.fit} contact={query.contact} onClear={() => chooseView({})} onFind={onFindLeads} /></td></tr> : page.leads.map((lead) => <LeadRow key={lead.id} lead={lead} selected={!!lead.id && selected.has(lead.id)} isLight={isLight} canEdit={can("EDIT_LEADS")} canDelete={can("DELETE_LEADS")} onSelect={(checked) => { if (!lead.id) return; setSelected((current) => { const next = new Set(current); checked ? next.add(lead.id!) : next.delete(lead.id!); return next; }); }} onView={() => openDetail(lead)} onOutreach={() => onOpenOutreach(lead)} onCampaign={() => lead.id && onAddToCampaign([lead.id])} onDelete={() => { if (!lead.id) return; runBulk("DELETE", {}, `Delete “${lead.businessName}”? This cannot be undone.`, [lead.id]); }} />)}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${colors.panel} flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-[10.5px] ${colors.muted} shadow-xs`}>
          <span>{page.total === 0 ? "0 leads" : `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} of ${page.total.toLocaleString()} leads`}</span>
          <div className="flex items-center gap-1.5"><select className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${colors.input}`} value={query.pageSize} onChange={(event) => updateQuery({ pageSize: Number(event.target.value) })}><option value={10}>10 / page</option><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button disabled={page.page <= 1} className="rounded-md border p-1 disabled:opacity-30 cursor-pointer hover:bg-slate-500/10" onClick={() => updateQuery({ page: page.page - 1 })}><ChevronLeft className="h-3 w-3" /></button><span className="px-1">Page {page.page} of {page.totalPages}</span><button disabled={page.page >= page.totalPages} className="rounded-md border p-1 disabled:opacity-30 cursor-pointer hover:bg-slate-500/10" onClick={() => updateQuery({ page: page.page + 1 })}><ChevronRight className="h-3 w-3" /></button></div>
        </div>
      </main>

      {filtersOpen && <FilterDrawer isLight={isLight} query={query} lists={lists} assignees={summary?.assignees || []} onChange={updateQuery} onClear={() => setQuery(DEFAULT_QUERY)} onClose={() => setFiltersOpen(false)} />}
      {detailId && <DetailDrawer isLight={isLight} detail={detail} loading={detailLoading} tab={detailTab} canEdit={can("EDIT_LEADS")} canDelete={can("DELETE_LEADS")} onTab={setDetailTab} onClose={() => { setDetailId(null); setDetail(null); }} onOutreach={() => detail && onOpenOutreach(detail.lead)} onCampaign={() => onAddToCampaign([detailId])} onSaved={async () => { if (detail?.lead.id) setDetail(await requestJson<Detail>(`/api/crm/leads/${detail.lead.id}`)); await refresh("Lead updated."); }} onDelete={() => { runBulk("DELETE", {}, `Delete this lead? This cannot be undone.`, [detailId]); }} />}
      {importOpen && <ImportModal isLight={isLight} lists={lists} onClose={() => setImportOpen(false)} onComplete={() => { setImportOpen(false); refresh("Leads imported."); }} />}
      {addOpen && <AddLeadModal isLight={isLight} lists={lists} onClose={() => setAddOpen(false)} onComplete={() => { setAddOpen(false); refresh("Lead added."); }} />}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) { return <section className="mb-3"><h3 className="mb-1 px-2 text-[8.5px] font-black uppercase tracking-[0.16em] text-slate-500">{title}</h3><div className="space-y-0.5">{children}</div></section>; }
function SideItem({ icon: Icon, label, count, active, onClick, tone = "text-slate-500" }: { icon: LucideIcon; label: string; count?: number; active?: boolean; onClick: () => void; tone?: string }) { return <button onClick={onClick} className={`btn-interactive flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[10.5px] transition-all cursor-pointer ${active ? "bg-indigo-500/12 font-bold text-indigo-400 shadow-xs" : "text-slate-400 hover:bg-slate-500/10 hover:text-slate-200"}`}><Icon className={`h-3 w-3 ${active ? "text-indigo-400" : tone}`} /><span className="min-w-0 flex-1 truncate">{label}</span>{typeof count === "number" && <span className="rounded-full bg-slate-500/10 px-1.5 text-[8.5px] font-bold tabular-nums">{count.toLocaleString()}</span>}</button>; }

function LeadRow({ lead, selected, isLight, canEdit, canDelete, onSelect, onView, onOutreach, onCampaign, onDelete }: any) {
  const fit = fitOf(lead); const emails = lead.emails || []; const FitIcon = fit.Icon;
  const fitTone = fit.tone === "rose" ? "text-rose-400 bg-rose-500/10 border-rose-500/20" : fit.tone === "amber" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : fit.tone === "sky" ? "text-sky-400 bg-sky-500/10 border-sky-500/20" : "text-slate-400 bg-slate-500/10 border-slate-500/20";
  return <tr className={`transition-colors ${isLight ? "hover:bg-slate-50/80" : "hover:bg-slate-800/30"} ${selected ? "bg-indigo-500/5" : ""}`}>
    <td className="px-2.5 py-1.5"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${lead.businessName}`} className="rounded border-slate-700 text-indigo-600 h-3 w-3" /></td>
    <td className="max-w-[260px] px-2.5 py-1.5"><button className="block max-w-full text-left cursor-pointer group" onClick={onView}><span className={`block truncate text-xs font-bold transition-colors group-hover:text-indigo-400 ${isLight ? "text-slate-900" : "text-white"}`}>{lead.businessName}</span>{lead.contactName && <span className="block truncate text-[9.5px] text-indigo-400 font-medium">{lead.contactName}</span>}<span className="block truncate text-[9.5px] text-slate-500">{lead.category || "Industry not set"}{lead.address ? ` · ${lead.address}` : ""}</span></button></td>
    <td className="px-2.5 py-1.5"><button onClick={onView} className={`btn-interactive inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold cursor-pointer ${fitTone}`} title={lead.icpFitReason || "AI Fit has not been calculated against an ICP."}><FitIcon className="h-2.5 w-2.5" />{fit.score === null ? "Not scored" : `${fit.score}% ${fit.label}`}</button></td>
    <td className="hidden px-2.5 py-1.5 lg:table-cell"><div className="flex items-center gap-1.5">{emails.length > 0 && <Mail className="h-3 w-3 text-indigo-400" />}{lead.phone && <Phone className="h-3 w-3 text-emerald-400" />}{lead.whatsappPresent && <MessageSquare className="h-3 w-3 text-emerald-500" />}{!emails.length && !lead.phone && <span className="text-[10px] text-slate-600">No channel</span>}</div></td>
    <td className="hidden px-2.5 py-1.5 xl:table-cell"><span className="rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[9px] text-slate-400 font-medium">{sourceLabel(lead.source)}</span></td>
    <td className="px-2.5 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${lead.status === "REPLIED" || lead.status === "QUALIFIED" ? "bg-emerald-500/10 text-emerald-400" : lead.status === "SUPPRESSED" || lead.status === "NOT_INTERESTED" ? "bg-rose-500/10 text-rose-400" : "bg-indigo-500/10 text-indigo-400"}`}>{statusLabel(lead.status)}</span></td>
    <td className="px-2.5 py-1.5 text-[10px] text-slate-400">{outreachOf(lead)}</td>
    <td className="px-2.5 py-1.5 text-right"><details className="relative inline-block"><summary className="list-none cursor-pointer rounded-md p-1 text-slate-500 hover:bg-slate-500/10 hover:text-slate-300"><MoreHorizontal className="h-3.5 w-3.5" /></summary><div className={`absolute right-0 z-20 mt-1 w-40 rounded-xl border p-1 shadow-xl ${isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"}`}><MenuAction icon={ExternalLink} label="View Lead" onClick={onView} /><MenuAction icon={Send} label="Open Outreach" onClick={onOutreach} /><MenuAction icon={ListPlus} label="Add to Campaign" onClick={onCampaign} />{canEdit && <MenuAction icon={BriefcaseBusiness} label="Edit / Add Note" onClick={onView} />}{canDelete && <MenuAction icon={Trash2} label="Delete" danger onClick={onDelete} />}</div></details></td>
  </tr>;
}
function MenuAction({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) { return <button onClick={onClick} className={`btn-interactive flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[10.5px] cursor-pointer hover:bg-slate-500/10 ${danger ? "text-rose-400" : "text-slate-400 hover:text-slate-200"}`}><Icon className="h-3 w-3" />{label}</button>; }

function BulkBar({ count, isLight, canDelete, canExport, assignees, lists, onClear, onCampaign, onExport, onAction }: any) {
  const base = `btn-interactive rounded-md border px-2 py-1 text-[9.5px] cursor-pointer ${isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-700 text-slate-300"}`;
  return <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border p-2 ${isLight ? "bg-indigo-50 border-indigo-200" : "bg-indigo-950/40 border-indigo-500/30"}`}><strong className="mr-1.5 text-[11px] text-indigo-400 font-bold">{count} selected</strong><button className={base} onClick={onCampaign}><Send className="mr-1 inline h-2.5 w-2.5" />Add to Campaign</button><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("CHANGE_STATUS", { status: e.target.value }); e.target.value = ""; }}><option value="">Change status…</option>{Object.entries(STATUS_LABELS).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("ASSIGN", { assignedUserId: e.target.value }); e.target.value = ""; }}><option value="">Assign…</option>{assignees.map((a: any) => <option value={a.id} key={a.id}>{a.name}</option>)}</select><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("ADD_TO_LIST", { listId: e.target.value }); e.target.value = ""; }}><option value="">Add to list…</option>{lists.map((l: LeadList) => <option value={l.id} key={l.id}>{l.name}</option>)}</select><button className={base} onClick={() => { const tag = window.prompt("Tag to add"); if (tag) onAction("ADD_TAG", { tag }); }}><Tag className="mr-1 inline h-2.5 w-2.5" />Add Tag</button>{canExport && <button className={base} onClick={onExport}><Download className="mr-1 inline h-2.5 w-2.5" />Export</button>}<button className={`${base} text-amber-500`} onClick={() => onAction("SUPPRESS", {}, "Suppress every available email and WhatsApp contact?")}><ShieldOff className="mr-1 inline h-2.5 w-2.5" />Suppress</button>{canDelete && <button className={`${base} text-rose-400`} onClick={() => onAction("DELETE", {}, "Permanently delete the selected leads? This cannot be undone.")}><Trash2 className="mr-1 inline h-2.5 w-2.5" />Delete</button>}<button className="ml-auto text-[9.5px] text-slate-500 hover:text-slate-300 cursor-pointer" onClick={onClear}>Clear</button></div>;
}

function FilterDrawer({ isLight, query, onChange, onClear, onClose }: any) {
  const input = `w-full rounded-lg border px-3 py-2 text-xs ${isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#030712] border-[#1e293b] text-white"}`;
  return <div className="fixed inset-0 z-[100] bg-black/55" onMouseDown={onClose}><aside className={`absolute bottom-0 right-0 top-0 w-full max-w-md overflow-y-auto border-l p-5 ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`} onMouseDown={(e) => e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div><h2 className={`font-bold ${isLight ? "text-slate-900" : "text-white"}`}>Universal lead filters</h2><p className="text-[11px] text-slate-500">Combine business, AI, contact, CRM and outreach criteria.</p></div><button onClick={onClose}><X className="h-4 w-4" /></button></div><FilterGroup title="Business"><input className={input} placeholder="Industry or category" value={query.industry} onChange={(e) => onChange({ industry: e.target.value })} /><input className={input} placeholder="Location, country or city" value={query.location} onChange={(e) => onChange({ location: e.target.value })} /></FilterGroup><FilterGroup title="AI / ICP"><select className={input} value={query.fit} onChange={(e) => onChange({ fit: e.target.value })}><option value="ALL">Any AI Fit</option><option value="HIGH">High Fit (75–100)</option><option value="MEDIUM">Medium Fit (40–74)</option><option value="LOW">Low Fit (0–39)</option><option value="UNSCORED">Not scored</option></select></FilterGroup><FilterGroup title="Contact"><select className={input} value={query.contact} onChange={(e) => onChange({ contact: e.target.value })}><option value="ALL">Any contact availability</option><option value="EMAIL">Has email</option><option value="PHONE">Has phone</option><option value="WHATSAPP">Has WhatsApp</option><option value="WEBSITE">Has website</option><option value="SOCIAL">Has social profile</option></select></FilterGroup><FilterGroup title="Lead source"><select className={input} value={query.source} onChange={(e) => onChange({ source: e.target.value })}><option value="ALL">Any source</option><option value="GOOGLE_MAPS">Google Maps</option><option value="IMPORTED">Imported</option></select></FilterGroup><FilterGroup title="CRM"><select className={input} value={query.status} onChange={(e) => onChange({ status: e.target.value })}><option value="ALL">Any status</option>{Object.entries(STATUS_LABELS).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={query.mine} onChange={(e) => onChange({ mine: e.target.checked })} />Assigned to me</label></FilterGroup><FilterGroup title="Outreach"><select className={input} value={query.outreach} onChange={(e) => onChange({ outreach: e.target.value })}><option value="ALL">Any outreach state</option><option value="NOT_CONTACTED">Not contacted</option><option value="EMAIL_SENT">Email sent</option><option value="WHATSAPP_SENT">WhatsApp sent</option><option value="REPLIED">Replied</option><option value="FAILED">Failed</option></select></FilterGroup><FilterGroup title="Added date"><div className="grid grid-cols-2 gap-2"><input type="date" className={input} value={query.dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value })} /><input type="date" className={input} value={query.dateTo} onChange={(e) => onChange({ dateTo: e.target.value })} /></div></FilterGroup><div className="sticky bottom-0 mt-6 flex gap-2 border-t border-slate-500/20 pt-4"><button className="flex-1 rounded-xl border border-slate-500/20 px-4 py-2 text-xs text-slate-400" onClick={onClear}>Clear all</button><button className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white" onClick={onClose}>Show results</button></div></aside></div>;
}
function FilterGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="mb-5 space-y-2"><h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</h3>{children}</section>; }

function DetailDrawer({ isLight, detail, loading, tab, canEdit, canDelete, onTab, onClose, onOutreach, onCampaign, onSaved, onDelete }: any) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [draft, setDraft] = useState<any>({});
  useEffect(() => { if (detail?.lead) setDraft({ businessName: detail.lead.businessName, contactName: detail.lead.contactName || "", category: detail.lead.category || "", address: detail.lead.address || "", phone: detail.lead.phone || "", website: detail.lead.website || "", status: detail.lead.status || "NEW", notes: detail.lead.notes || "" }); }, [detail]);
  const save = async () => { setSaving(true); try { await requestJson(`/api/crm/leads/${detail.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); setEditing(false); await onSaved(); } finally { setSaving(false); } };
  const panel = isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#090d16] border-[#1e293b] text-white"; const input = `w-full rounded-lg border px-3 py-2 text-xs ${isLight ? "bg-white border-slate-200" : "bg-[#030712] border-[#1e293b]"}`;
  return <div className="fixed inset-0 z-[90] bg-black/55" onMouseDown={onClose}><aside className={`absolute bottom-0 right-0 top-0 w-full max-w-2xl overflow-y-auto border-l ${panel}`} onMouseDown={(e) => e.stopPropagation()}>{loading || !detail ? <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-400" /></div> : <><header className="sticky top-0 z-10 border-b border-slate-500/20 bg-inherit p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-indigo-400" /><h2 className="text-lg font-black">{detail.lead.businessName}</h2></div><p className="mt-1 text-xs text-slate-500">{detail.lead.contactName || "No contact person recorded"} · {detail.lead.category || "Industry not set"}</p></div><button onClick={onClose}><X className="h-4 w-4" /></button></div><div className="mt-4 flex gap-1 overflow-x-auto">{(["overview","intelligence","ai","outreach","crm"] as const).map((value) => <button key={value} onClick={() => onTab(value)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize ${tab === value ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-500/10"}`}>{value === "ai" ? "AI Analysis" : value === "intelligence" ? "Business Intelligence" : value}</button>)}</div></header><div className="space-y-4 p-5">{editing ? <div className="grid gap-3 sm:grid-cols-2"><input className={input} value={draft.businessName} onChange={(e) => setDraft({...draft,businessName:e.target.value})} placeholder="Company name" /><input className={input} value={draft.contactName} onChange={(e) => setDraft({...draft,contactName:e.target.value})} placeholder="Contact person" /><input className={input} value={draft.category} onChange={(e) => setDraft({...draft,category:e.target.value})} placeholder="Industry / category" /><input className={input} value={draft.phone} onChange={(e) => setDraft({...draft,phone:e.target.value})} placeholder="Phone" /><input className={`${input} sm:col-span-2`} value={draft.address} onChange={(e) => setDraft({...draft,address:e.target.value})} placeholder="Location" /><input className={`${input} sm:col-span-2`} value={draft.website} onChange={(e) => setDraft({...draft,website:e.target.value})} placeholder="Website" /><select className={input} value={draft.status} onChange={(e) => setDraft({...draft,status:e.target.value})}>{Object.entries(STATUS_LABELS).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><textarea className={`${input} sm:col-span-2`} rows={4} value={draft.notes} onChange={(e) => setDraft({...draft,notes:e.target.value})} placeholder="Private CRM notes" /><div className="sm:col-span-2 flex justify-end gap-2"><button className="rounded-lg border px-3 py-2 text-xs" onClick={() => setEditing(false)}>Cancel</button><button className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save lead"}</button></div></div> : <DetailContent detail={detail} tab={tab} isLight={isLight} />}</div><footer className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-500/20 bg-inherit p-4"><button className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white" onClick={onOutreach}><Send className="mr-1 inline h-3.5 w-3.5" />Outreach</button><button className="rounded-lg border border-slate-500/20 px-3 py-2 text-xs" onClick={onCampaign}><ListPlus className="mr-1 inline h-3.5 w-3.5" />Add to Campaign</button>{canEdit && <button className="rounded-lg border border-slate-500/20 px-3 py-2 text-xs" onClick={() => setEditing(true)}>Edit / Add Note</button>}{canDelete && <button className="ml-auto rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-400" onClick={onDelete}><Trash2 className="mr-1 inline h-3.5 w-3.5" />Delete</button>}</footer></>}</aside></div>;
}

function DetailContent({ detail, tab, isLight }: { detail: Detail; tab: string; isLight: boolean }) {
  const lead = detail.lead; const fit = fitOf(lead); const text = isLight ? "text-slate-700" : "text-slate-300";
  if (tab === "overview") return <><InfoCard title="Company & fit"><DetailLine label="Company" value={lead.businessName} /><DetailLine label="Contact" value={lead.contactName || "Not available"} /><DetailLine label="Industry" value={lead.category || "Not available"} /><DetailLine label="Location" value={lead.address || "Not available"} /><DetailLine label="AI Fit" value={fit.score === null ? "Not scored against an ICP" : `${fit.score}% ${fit.label}`} /><DetailLine label="ICP match" value={lead.icpFitReason || "No verified ICP explanation available"} /></InfoCard><InfoCard title="Contact"><DetailLine label="Email" value={lead.emails?.join(", ") || "Not available"} /><DetailLine label="Phone" value={lead.phone || "Not available"} /><DetailLine label="WhatsApp" value={lead.whatsappPresent && lead.phone ? lead.phone : "Not verified"} /><DetailLine label="Website" value={lead.website || "Not available"} /></InfoCard></>;
  if (tab === "intelligence") return <><InfoCard title="Verified business facts"><DetailLine label="Category" value={lead.category || "Not available"} /><DetailLine label="Location" value={lead.address || "Not available"} /><DetailLine label="Rating" value={lead.rating ? `${lead.rating} (${lead.reviews} reviews)` : "Not available"} /><DetailLine label="Source" value={sourceLabel(lead.source)} /></InfoCard><InfoCard title="Digital presence (supporting signals)"><DetailLine label="Website" value={lead.websiteStatus || "Not analyzed"} /><DetailLine label="Instagram" value={lead.instagramStatus || "Not analyzed"} /><DetailLine label="Facebook" value={lead.facebookStatus || "Not analyzed"} /><DetailLine label="LinkedIn" value={lead.linkedinStatus || "Not analyzed"} /><DetailLine label="Google Business Profile" value={lead.mapsUrl ? "Available" : "Not available"} /></InfoCard></>;
  if (tab === "ai") return <><div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4"><div className="mb-1 flex items-center gap-2 text-xs font-bold text-indigo-400"><Sparkles className="h-4 w-4" />Why this lead matches</div><p className={`text-xs leading-relaxed ${text}`}>{detail.ai.fitReason || "No grounded ICP explanation has been generated. The system will not invent one."}</p></div><InfoCard title="Qualification signals">{detail.ai.scoreBreakdown.length ? detail.ai.scoreBreakdown.map((item) => <div key={`${item.signal}-${item.label}`}><DetailLine label={item.label} value={`+${item.points}`} /></div>) : <p className="text-xs text-slate-500">No explainable scoring signals are stored.</p>}</InfoCard><FitList title="Product Fit" values={detail.ai.productFit} /><FitList title="Service Fit" values={detail.ai.serviceFit} /><InfoCard title="AI recommendation"><p className={`text-xs leading-relaxed ${text}`}>{detail.ai.recommendation || "No recommendation available."}</p><p className="mt-2 text-[10px] text-amber-500">AI recommendation — verify before using in outreach.</p></InfoCard></>;
  if (tab === "outreach") { const events = [...detail.outreach.messages.map((x) => ({...x, date:x.sentAt || x.createdAt, type:"Message"})), ...detail.outreach.dispatches.map((x) => ({...x,date:x.occurredAt,type:"Delivery"}))].sort((a,b) => +new Date(b.date)-+new Date(a.date)); return <InfoCard title="Outreach history">{events.length ? events.map((event) => <div key={`${event.type}-${event.id}`} className="border-b border-slate-500/10 py-2 text-xs"><div className="flex justify-between"><strong className="capitalize">{event.channel} · {event.type}</strong><span className="text-slate-500">{event.date ? new Date(event.date).toLocaleString() : ""}</span></div><div className="mt-1 text-slate-500">{event.status}{event.subject ? ` · ${event.subject}` : ""}</div></div>) : <p className="text-xs text-slate-500">No outreach has been recorded for this lead.</p>}</InfoCard>; }
  return <><InfoCard title="CRM"><DetailLine label="Status" value={statusLabel(lead.status)} /><DetailLine label="Owner" value={lead.assignedUserName || "Unassigned"} /><DetailLine label="List" value={lead.listName || detail.list?.name || "Not available"} /><DetailLine label="Tags" value={lead.tags?.join(", ") || "None"} /></InfoCard><InfoCard title="Notes"><p className={`whitespace-pre-wrap text-xs ${text}`}>{lead.notes || "No notes yet."}</p></InfoCard><InfoCard title="Activity"><p className="text-xs text-slate-500">Outreach and conversation events are available in the Outreach tab. A separate task timeline is not yet stored.</p></InfoCard></>;
}
function InfoCard({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-xl border border-slate-500/15 p-4"><h3 className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</h3><div className="space-y-2">{children}</div></section>; }
function DetailLine({ label, value }: { label: string; value: ReactNode }) { return <div className="flex items-start justify-between gap-4 text-xs"><span className="shrink-0 text-slate-500">{label}</span><span className="text-right">{value}</span></div>; }
function FitList({ title, values }: { title: string; values: any[] }) { return <InfoCard title={title}>{values?.length ? values.map((value, index) => <div key={value.id || value.name || index}><DetailLine label={value.name || "Configured offering"} value={value.fit || (typeof value.score === "number" ? `${value.score}%` : "Analyzed")} /></div>) : <p className="text-xs text-slate-500">Not analyzed against configured {title.toLowerCase()} yet.</p>}</InfoCard>; }

function EmptyState({ hasFilters, fit, contact, onClear, onFind }: any) { const message = fit !== "ALL" ? "No leads currently match your AI Fit criteria." : contact !== "ALL" ? "No leads have the selected contact method." : hasFilters ? "No leads match your current filters." : "No leads found yet."; return <div className="flex flex-col items-center justify-center py-20 text-center"><Database className="h-10 w-10 text-slate-600" /><h3 className="mt-3 text-sm font-bold text-slate-400">{message}</h3><p className="mt-1 max-w-sm text-xs text-slate-600">{hasFilters ? "Try removing one or more criteria." : "Discover prospects or import an existing lead list to get started."}</p><button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" onClick={hasFilters ? onClear : onFind}>{hasFilters ? "Clear Filters" : "Find Leads"}</button></div>; }

function AddLeadModal({ isLight, lists, onClose, onComplete }: any) { const [listId,setListId]=useState(lists[0]?.id || ""); const [form,setForm]=useState({businessName:"",contactName:"",category:"",address:"",phone:"",email:"",website:""}); const [error,setError]=useState(""); const submit=async(e:FormEvent)=>{e.preventDefault();try{if(!listId)throw new Error("Create or select a saved list first.");await requestJson(`/api/crm/lists/${listId}/leads`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({leads:[{...form,emails:form.email?[form.email]:[],source:"MANUAL",status:"NEW"}]})});onComplete();}catch(c){setError(c instanceof Error?c.message:"Could not add lead.");}}; return <Modal title="Add Lead" isLight={isLight} onClose={onClose}><LeadForm form={form} setForm={setForm} listId={listId} setListId={setListId} lists={lists} error={error} onSubmit={submit} submitLabel="Add Lead" /></Modal>; }
function ImportModal({ isLight, lists, onClose, onComplete }: any) { const [listId,setListId]=useState(lists[0]?.id||""); const [text,setText]=useState(""); const [error,setError]=useState(""); const submit=async()=>{try{if(!listId)throw new Error("Select a destination list.");const lines=text.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)throw new Error("Paste CSV data first.");const rows=lines.map((line)=>line.split(",").map((v)=>v.trim().replace(/^"|"$/g,"")));const header=rows[0].map((x)=>x.toLowerCase());const data=(header.some((x)=>x.includes("name"))?rows.slice(1):rows).map((row)=>{const get=(names:string[],fallback:number)=>{const i=header.findIndex((h)=>names.some((n)=>h.includes(n)));return row[i>=0?i:fallback]||"";};return {businessName:get(["business","company","name"],0),contactName:get(["contact"],1),emails:get(["email"],2)?[get(["email"],2)]:[],phone:get(["phone","mobile"],3),address:get(["location","address","city"],4),category:get(["industry","category"],5),website:get(["website"],6),source:"IMPORTED",status:"NEW"};}).filter((x)=>x.businessName);if(!data.length)throw new Error("No rows with a business/company name were found.");await requestJson(`/api/crm/lists/${listId}/leads`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({leads:data})});onComplete();}catch(c){setError(c instanceof Error?c.message:"Import failed.");}}; return <Modal title="Import Leads" isLight={isLight} onClose={onClose}><label className="text-xs text-slate-500">Destination list<select className="mt-1 w-full rounded-lg border border-slate-500/20 bg-transparent px-3 py-2" value={listId} onChange={(e)=>setListId(e.target.value)}>{lists.map((l:LeadList)=><option value={l.id} key={l.id}>{l.name}</option>)}</select></label><label className="mt-3 block text-xs text-slate-500">CSV data<textarea rows={10} className="mt-1 w-full rounded-lg border border-slate-500/20 bg-transparent p-3 font-mono text-xs" value={text} onChange={(e)=>setText(e.target.value)} placeholder="Business Name,Contact Name,Email,Phone,Location,Industry,Website" /></label>{error&&<p className="mt-2 text-xs text-rose-400">{error}</p>}<button onClick={submit} className="mt-4 w-full rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white">Import Leads</button></Modal>; }
function LeadForm({form,setForm,listId,setListId,lists,error,onSubmit,submitLabel}:any){return <form className="space-y-3" onSubmit={onSubmit}><select className="w-full rounded-lg border border-slate-500/20 bg-transparent px-3 py-2 text-xs" value={listId} onChange={(e)=>setListId(e.target.value)}>{lists.map((l:LeadList)=><option value={l.id} key={l.id}>{l.name}</option>)}</select>{[["businessName","Company / business name *"],["contactName","Contact person"],["category","Industry / category"],["address","Location"],["email","Email"],["phone","Phone / WhatsApp"],["website","Website"]].map(([key,label])=><input key={key} required={key==="businessName"} className="w-full rounded-lg border border-slate-500/20 bg-transparent px-3 py-2 text-xs" value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})} placeholder={label} />)}{error&&<p className="text-xs text-rose-400">{error}</p>}<button className="w-full rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white">{submitLabel}</button></form>;}
function Modal({title,isLight,onClose,children}:any){return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}><div className={`w-full max-w-lg rounded-2xl border p-5 ${isLight?"bg-white border-slate-200 text-slate-900":"bg-[#090d16] border-[#1e293b] text-white"}`} onMouseDown={(e)=>e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{title}</h2><button onClick={onClose}><X className="h-4 w-4" /></button></div>{children}</div></div>;}

function filterChips(query: Query) { const chips:string[]=[]; if(query.search)chips.push(`Search: ${query.search}`); if(query.fit!=="ALL")chips.push(`${query.fit} Fit`); if(query.source!=="ALL")chips.push(sourceLabel(query.source)); if(query.status!=="ALL")chips.push(statusLabel(query.status)); if(query.outreach!=="ALL")chips.push(query.outreach.replaceAll("_"," ")); if(query.contact!=="ALL")chips.push(`Has ${query.contact.toLowerCase()}`); if(query.industry)chips.push(query.industry); if(query.location)chips.push(query.location); if(query.mine)chips.push("Assigned to me"); if(query.listId!=="ALL")chips.push("Saved list"); return chips; }
