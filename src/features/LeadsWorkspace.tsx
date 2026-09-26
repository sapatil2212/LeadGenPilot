import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive, Bot, BriefcaseBusiness, Building2, CalendarClock, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleUserRound, Database, Download, Edit3, ExternalLink, FileText, FileUp, Filter,
  Flame, FolderOpen, Globe2, Import, ListPlus, Loader2, Mail, MapPin, Menu, MessageSquare,
  MoreHorizontal, Phone, Plus, RefreshCw, Search, Send, ShieldOff, Snowflake, Sparkles,
  Tag, Trash2, UploadCloud, UserRound, UsersRound, X, Zap,
  type LucideIcon,
} from "lucide-react";
import type { Lead, LeadList } from "../types";
import { ModalPortal } from "../ui/primitives";

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
  const [viewMode, setViewMode] = useState<"folders" | "table">("folders");
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

  const can = useCallback((permission: Permission) => summary?.permissions?.includes(permission) ?? false, [summary]);
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
      setLists(Array.isArray(listData) ? listData : []); 
      setSummary(summaryData || null);
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
      const response = await requestJson<any>(`${base}?${queryParams}`, { signal: controller.signal });
      if (Array.isArray(response)) {
        setPage({ leads: response, total: response.length, page: 1, pageSize: query.pageSize || 25, totalPages: Math.max(1, Math.ceil(response.length / (query.pageSize || 25))) });
      } else if (response && Array.isArray(response.leads)) {
        setPage(response);
        if (query.page > response.totalPages) setQuery((current) => ({ ...current, page: response.totalPages }));
      } else {
        setPage({ leads: [], total: 0, page: 1, pageSize: query.pageSize || 25, totalPages: 1 });
      }
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
  const allPageSelected = (page?.leads?.length ?? 0) > 0 && page.leads.every((lead) => lead.id && selected.has(lead.id));

  const SideNav = (props: any) => <SideItem isLight={isLight} {...props} />;

  const openFolder = (listId: string) => { updateQuery({ listId }); setViewMode("table"); };
  const backToFolders = () => { updateQuery({ listId: "ALL" }); setViewMode("folders"); };
  const chooseViewAndTable = (patch: Partial<Query>) => { chooseView(patch); setViewMode("table"); };

  return (
    <div className="relative flex h-[calc(100vh-105px)] min-h-[580px] gap-3 overflow-hidden">
      {sidebarOpen && <button aria-label="Close lead navigation" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${colors.panel} fixed bottom-0 left-0 top-0 z-40 w-64 overflow-y-auto border-r p-2.5 transition-transform md:static md:z-auto md:w-52 md:translate-x-0 md:rounded-xl md:border shadow-sm`}>
        <div className="mb-2.5 flex items-center justify-between px-2 py-1 md:hidden"><strong className={`text-xs ${colors.text}`}>Lead views</strong><button onClick={() => setSidebarOpen(false)}><X className="h-3.5 w-3.5" /></button></div>
        <SidebarSection title="Leads">
          <SideNav icon={FolderOpen} label="All Folders" active={viewMode === "folders" && !hasFilters} onClick={backToFolders} />
          <SideNav icon={Database} label="All Leads" count={summary?.counts?.all} active={viewMode === "table" && !hasFilters && query.listId === "ALL"} onClick={() => chooseViewAndTable({})} />
          <SideNav icon={Plus} label="New Leads" count={summary?.counts?.new} active={query.status === "NEW"} onClick={() => chooseViewAndTable({ status: "NEW" })} />
          <SideNav icon={CircleUserRound} label="My Leads" count={summary?.counts?.mine} active={query.mine} onClick={() => chooseViewAndTable({ mine: true })} />
          <SideNav icon={Flame} label="High Fit" count={summary?.counts?.highFit} active={query.fit === "HIGH"} onClick={() => chooseViewAndTable({ fit: "HIGH" })} tone="text-rose-400" />
          <SideNav icon={Zap} label="Medium Fit" count={summary?.counts?.mediumFit} active={query.fit === "MEDIUM"} onClick={() => chooseViewAndTable({ fit: "MEDIUM" })} tone="text-amber-400" />
          <SideNav icon={Snowflake} label="Low Fit" count={summary?.counts?.lowFit} active={query.fit === "LOW"} onClick={() => chooseViewAndTable({ fit: "LOW" })} tone="text-sky-400" />
          <SideNav icon={CalendarClock} label="Recently Added" count={summary?.counts?.recent} active={query.sortBy === "recentlyAdded" && !hasFilters} onClick={() => chooseViewAndTable({ sortBy: "recentlyAdded" })} />
        </SidebarSection>
        <SidebarSection title="Source">
          <SideNav icon={MapPin} label="Google Maps" count={summary?.counts?.sources?.GOOGLE_MAPS} active={query.source === "GOOGLE_MAPS"} onClick={() => chooseViewAndTable({ source: "GOOGLE_MAPS" })} />
          <SideNav icon={Import} label="Imported" count={summary?.counts?.sources?.IMPORTED} active={query.source === "IMPORTED"} onClick={() => chooseViewAndTable({ source: "IMPORTED" })} />
          {!!summary?.counts?.sources?.WEB_DISCOVERY && <SideNav icon={Globe2} label="Web Discovery" count={summary.counts.sources.WEB_DISCOVERY} active={query.source === "WEB_DISCOVERY"} onClick={() => chooseViewAndTable({ source: "WEB_DISCOVERY" })} />}
          {!!summary?.counts?.sources?.GOOGLE_SHEETS && <SideNav icon={Database} label="Google Sheets" count={summary.counts.sources.GOOGLE_SHEETS} active={query.source === "GOOGLE_SHEETS"} onClick={() => chooseViewAndTable({ source: "GOOGLE_SHEETS" })} />}
          {!!summary?.counts?.sources?.AI_DISCOVERED && <SideNav icon={Bot} label="AI Discovered" count={summary.counts.sources.AI_DISCOVERED} active={query.source === "AI_DISCOVERED"} onClick={() => chooseViewAndTable({ source: "AI_DISCOVERED" })} />}
        </SidebarSection>
        <SidebarSection title="Status">
          {Object.entries(STATUS_LABELS).map(([value, label]) => <div key={value}><SideNav icon={value === "SUPPRESSED" ? ShieldOff : Check} label={label} count={summary?.counts?.statuses?.[value]} active={query.status === value} onClick={() => chooseViewAndTable({ status: value })} /></div>)}
        </SidebarSection>
        <SidebarSection title="Outreach">
          <SideNav icon={Archive} label="Not Contacted" count={summary?.counts?.outreach?.NOT_CONTACTED} active={query.outreach === "NOT_CONTACTED"} onClick={() => chooseViewAndTable({ outreach: "NOT_CONTACTED" })} />
          <SideNav icon={Mail} label="Email Available" count={summary?.counts?.outreach?.EMAIL_AVAILABLE} active={query.contact === "EMAIL"} onClick={() => chooseViewAndTable({ contact: "EMAIL" })} />
          <SideNav icon={MessageSquare} label="WhatsApp Available" count={summary?.counts?.outreach?.WHATSAPP_AVAILABLE} active={query.contact === "WHATSAPP"} onClick={() => chooseViewAndTable({ contact: "WHATSAPP" })} />
          <SideNav icon={Phone} label="Phone Available" count={summary?.counts?.outreach?.PHONE_AVAILABLE} active={query.contact === "PHONE"} onClick={() => chooseViewAndTable({ contact: "PHONE" })} />
          <SideNav icon={MessageSquare} label="Replied" count={summary?.counts?.outreach?.REPLIED} active={query.outreach === "REPLIED"} onClick={() => chooseViewAndTable({ outreach: "REPLIED" })} />
        </SidebarSection>
        <SidebarSection title="Actions">
          <SideNav icon={Filter} label="More Filters" onClick={() => { setViewMode("table"); setFiltersOpen(true); }} />
          {can("EXPORT_LEADS") && <SideNav icon={Download} label="Export Leads" onClick={() => exportLeads()} />}
          {can("EDIT_LEADS") && <SideNav icon={FileUp} label="Import Leads" onClick={() => setImportOpen(true)} />}
          {can("EDIT_LEADS") && <SideNav icon={Plus} label="Add Lead" onClick={() => setAddOpen(true)} />}
        </SidebarSection>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className={`${colors.panel} rounded-xl border p-2.5 shadow-xs`}>
          <div className="flex flex-wrap items-center gap-2">
            <button className={`btn-interactive rounded-lg border p-1.5 md:hidden ${colors.input}`} onClick={() => setSidebarOpen(true)} aria-label="Open lead navigation"><Menu className="h-3.5 w-3.5" /></button>
            {viewMode === "table" && (
              <button className={`btn-interactive inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${colors.input}`} onClick={backToFolders} title="Back to folders">
                <ChevronLeft className="h-3 w-3" /> Folders
              </button>
            )}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input className={`w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-indigo-500 ${colors.input}`} value={query.search} onChange={(event) => { updateQuery({ search: event.target.value }); if (viewMode === "folders" && event.target.value) setViewMode("table"); }} placeholder={viewMode === "folders" ? "Search leads across all folders…" : "Search name, contact, email, phone, location…"} />
            </div>
            {viewMode === "table" && (
              <>
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
              </>
            )}
            <button className={`btn-interactive rounded-lg border p-1.5 cursor-pointer ${colors.input}`} onClick={() => refresh()} title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
            {viewMode === "folders" && can("EDIT_LEADS") && (
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer transition-colors shadow-sm" onClick={() => setImportOpen(true)}>
                <FileUp className="h-3.5 w-3.5" /> Import Leads
              </button>
            )}
          </div>
          {viewMode === "table" && hasFilters && <div className="mt-2 flex flex-wrap items-center gap-1 text-[9.5px]"><span className={colors.muted}>Active:</span>{filterChips(query).map((chip) => <span key={chip} className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.2 text-indigo-400 font-semibold">{chip}</span>)}<button className="ml-1 text-rose-400 font-bold hover:underline cursor-pointer" onClick={() => chooseView({})}>Clear</button></div>}
        </div>

        {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{notice}</div>}
        {error && <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-400"><span>{error}</span><button onClick={() => setError("")}><X className="h-3.5 w-3.5" /></button></div>}

        {viewMode === "folders" ? (
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1">
            <ListFolderGrid lists={lists} summary={summary} isLight={isLight} canEdit={can("EDIT_LEADS")} canDelete={can("DELETE_LEADS")} onOpenFolder={openFolder} onOpenAll={() => chooseViewAndTable({})} onImport={() => setImportOpen(true)} onRefresh={refresh} colors={colors} />
          </div>
        ) : (
          <>
            {selected.size > 0 && <BulkBar count={selected.size} isLight={isLight} canDelete={can("DELETE_LEADS")} canExport={can("EXPORT_LEADS")} assignees={summary?.assignees || []} lists={lists} onClear={() => setSelected(new Set())} onCampaign={() => onAddToCampaign(Array.from(selected))} onExport={() => exportLeads(Array.from(selected))} onAction={runBulk} />}

            <div className={`${colors.panel} min-h-0 flex-1 overflow-hidden rounded-xl border shadow-sm`}>
              <div className="h-full overflow-auto scrollbar-thin">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className={`sticky top-0 z-10 border-b text-[9.5px] font-bold uppercase tracking-wider ${isLight ? "bg-slate-50/95 text-slate-500 border-slate-200" : "bg-[#090d16]/95 text-slate-400 border-[#1e293b]"} backdrop-blur-xs`}>
                    <tr><th className="w-9 px-2.5 py-2"><input type="checkbox" checked={allPageSelected} onChange={(event) => setSelected(event.target.checked ? new Set((page?.leads || []).flatMap((lead) => lead.id ? [lead.id] : [])) : new Set())} aria-label="Select all leads on this page" className="rounded border-slate-700 text-indigo-600 h-3 w-3" /></th><th className="px-2.5 py-2">Lead</th><th className="px-2.5 py-2">AI Fit</th><th className="hidden px-2.5 py-2 lg:table-cell">Contact</th><th className="hidden px-2.5 py-2 xl:table-cell">Source</th><th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">Outreach</th><th className="px-2.5 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody className={`divide-y text-xs ${isLight ? "divide-slate-100" : "divide-[#1e293b]/50"}`}>
                    {loading ? <tr><td colSpan={8} className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-indigo-400" /><p className={`mt-2 text-xs ${colors.muted}`}>Loading tenant leads…</p></td></tr> : (!page?.leads || page.leads.length === 0) ? <tr><td colSpan={8}><EmptyState hasFilters={hasFilters} fit={query.fit} contact={query.contact} onClear={() => chooseView({})} onFind={onFindLeads} /></td></tr> : page.leads.map((lead) => <LeadRow key={lead.id} lead={lead} selected={!!lead.id && selected.has(lead.id)} isLight={isLight} canEdit={can("EDIT_LEADS")} canDelete={can("DELETE_LEADS")} onSelect={(checked: boolean) => { if (!lead.id) return; setSelected((current) => { const next = new Set(current); checked ? next.add(lead.id!) : next.delete(lead.id!); return next; }); }} onView={() => openDetail(lead)} onOutreach={() => onOpenOutreach(lead)} onCampaign={() => lead.id && onAddToCampaign([lead.id])} onDelete={() => { if (!lead.id) return; runBulk("DELETE", {}, `Delete "${lead.businessName}"? This cannot be undone.`, [lead.id]); }} onRename={(id: string, newName: string) => { setPage((p) => ({ ...p, leads: p.leads.map((l) => (l.id === id ? { ...l, businessName: newName } : l)) })); setNotice(`Renamed to "${newName}".`); window.setTimeout(() => setNotice(""), 3000); }} />)}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${colors.panel} flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-[10.5px] ${colors.muted} shadow-xs`}>
              <span>{(page?.total ?? 0) === 0 ? "0 leads" : `${((page?.page ?? 1) - 1) * (page?.pageSize ?? 25) + 1}–${Math.min((page?.page ?? 1) * (page?.pageSize ?? 25), page?.total ?? 0)} of ${(page?.total ?? 0).toLocaleString()} leads`}</span>
              <div className="flex items-center gap-1.5"><select className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${colors.input}`} value={query.pageSize} onChange={(event) => updateQuery({ pageSize: Number(event.target.value) })}><option value={10}>10 / page</option><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button disabled={(page?.page ?? 1) <= 1} className="rounded-md border p-1 disabled:opacity-30 cursor-pointer hover:bg-slate-500/10" onClick={() => updateQuery({ page: (page?.page ?? 1) - 1 })}><ChevronLeft className="h-3 w-3" /></button><span className="px-1">Page {page?.page ?? 1} of {page?.totalPages ?? 1}</span><button disabled={(page?.page ?? 1) >= (page?.totalPages ?? 1)} className="rounded-md border p-1 disabled:opacity-30 cursor-pointer hover:bg-slate-500/10" onClick={() => updateQuery({ page: (page?.page ?? 1) + 1 })}><ChevronRight className="h-3 w-3" /></button></div>
            </div>
          </>
        )}
      </main>

      {filtersOpen && <FilterDrawer isLight={isLight} query={query} lists={lists} assignees={summary?.assignees || []} onChange={updateQuery} onClear={() => setQuery(DEFAULT_QUERY)} onClose={() => setFiltersOpen(false)} />}
      {detailId && <DetailDrawer isLight={isLight} detail={detail} loading={detailLoading} tab={detailTab} canEdit={can("EDIT_LEADS")} canDelete={can("DELETE_LEADS")} onTab={setDetailTab} onClose={() => { setDetailId(null); setDetail(null); }} onOutreach={() => detail && onOpenOutreach(detail.lead)} onCampaign={() => onAddToCampaign([detailId])} onSaved={async () => { if (detail?.lead.id) setDetail(await requestJson<Detail>(`/api/crm/leads/${detail.lead.id}`)); await refresh("Lead updated."); }} onDelete={() => { runBulk("DELETE", {}, `Delete this lead? This cannot be undone.`, [detailId]); }} />}
      {importOpen && <ImportModal isLight={isLight} lists={lists} onClose={() => setImportOpen(false)} onComplete={() => { setImportOpen(false); refresh("Leads imported."); }} />}
      {addOpen && <AddLeadModal isLight={isLight} lists={lists} onClose={() => setAddOpen(false)} onComplete={() => { setAddOpen(false); refresh("Lead added."); }} />}
    </div>
  );
}

/* ─────────── ListFolderGrid ─────────── */
function ListFolderGrid({ lists, summary, isLight, canEdit, canDelete, onOpenFolder, onOpenAll, onImport, onRefresh, colors }: any) {
  const totalLeads = summary?.counts?.all ?? lists.reduce((sum: number, l: LeadList) => sum + (l.leadCount ?? 0), 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {/* All Leads card */}
      <button
        onClick={onOpenAll}
        className={`group relative rounded-2xl border-2 border-dashed p-5 text-left transition-all cursor-pointer ${
          isLight
            ? "border-indigo-300/60 bg-indigo-50/40 hover:bg-indigo-50 hover:border-indigo-400"
            : "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500/50"
        }`}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className={`rounded-xl p-2.5 ${isLight ? "bg-indigo-100" : "bg-indigo-500/20"}`}>
            <Database className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <h3 className={`text-sm font-black ${isLight ? "text-slate-900" : "text-white"}`}>All Leads</h3>
            <p className="text-[10.5px] text-slate-500">View every lead across all folders</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-lg font-black tabular-nums ${isLight ? "text-indigo-600" : "text-indigo-400"}`}>{totalLeads.toLocaleString()}</span>
          <span className="text-[10px] text-slate-500 group-hover:text-indigo-400 transition-colors">View all →</span>
        </div>
      </button>

      {/* Each Lead List as a folder card */}
      {lists.map((list: LeadList) => (
        <FolderCard
          key={list.id}
          list={list}
          isLight={isLight}
          canEdit={canEdit}
          canDelete={canDelete}
          onOpen={() => onOpenFolder(list.id)}
          onRefresh={onRefresh}
          colors={colors}
        />
      ))}

      {/* Create / Import card */}
      {canEdit && (
        <button
          onClick={onImport}
          className={`group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 transition-all cursor-pointer min-h-[140px] ${
            isLight
              ? "border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50 text-slate-400 hover:text-indigo-600"
              : "border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5 text-slate-600 hover:text-indigo-400"
          }`}
        >
          <Plus className="h-7 w-7 mb-1.5 transition-transform group-hover:scale-110" />
          <span className="text-xs font-bold">New Lead List</span>
          <span className="text-[10px] mt-0.5">Import or add leads</span>
        </button>
      )}
    </div>
  );
}

function FolderCard({ list, isLight, canEdit, canDelete, onOpen, onRefresh, colors }: any) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(list.name);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const saveRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === list.name) { setRenaming(false); return; }
    setSaving(true);
    try {
      await requestJson(`/api/crm/lists/${list.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      setRenaming(false);
      onRefresh(`Renamed to "${trimmed}".`);
    } catch (err: any) {
      alert(err?.message || "Failed to rename.");
    } finally { setSaving(false); }
  };

  const deleteList = async () => {
    if (!window.confirm(`Delete "${list.name}" and all its ${list.leadCount} leads? This cannot be undone.`)) return;
    try {
      await requestJson(`/api/crm/lists/${list.id}`, { method: "DELETE" });
      onRefresh(`"${list.name}" deleted.`);
    } catch (err: any) {
      alert(err?.message || "Failed to delete.");
    }
  };

  const createdDate = list.createdAt ? new Date(list.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const FOLDER_COLORS = [
    { bg: isLight ? "bg-amber-50" : "bg-amber-500/10", icon: "text-amber-500", ring: isLight ? "border-amber-200" : "border-amber-500/20" },
    { bg: isLight ? "bg-emerald-50" : "bg-emerald-500/10", icon: "text-emerald-500", ring: isLight ? "border-emerald-200" : "border-emerald-500/20" },
    { bg: isLight ? "bg-sky-50" : "bg-sky-500/10", icon: "text-sky-500", ring: isLight ? "border-sky-200" : "border-sky-500/20" },
    { bg: isLight ? "bg-violet-50" : "bg-violet-500/10", icon: "text-violet-500", ring: isLight ? "border-violet-200" : "border-violet-500/20" },
    { bg: isLight ? "bg-rose-50" : "bg-rose-500/10", icon: "text-rose-500", ring: isLight ? "border-rose-200" : "border-rose-500/20" },
    { bg: isLight ? "bg-teal-50" : "bg-teal-500/10", icon: "text-teal-500", ring: isLight ? "border-teal-200" : "border-teal-500/20" },
  ];
  const colorIdx = Math.abs([...list.id].reduce((acc, c) => acc + c.charCodeAt(0), 0)) % FOLDER_COLORS.length;
  const fc = FOLDER_COLORS[colorIdx];

  return (
    <div
      className={`group relative rounded-2xl border p-4 transition-all cursor-pointer ${
        isLight
          ? "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md"
          : "bg-[#0c111d] border-[#1e293b] hover:border-[#334155] hover:shadow-lg hover:shadow-slate-950/20"
      }`}
      onClick={() => { if (!renaming) onOpen(); }}
    >
      {/* Top row: icon + actions */}
      <div className="flex items-start justify-between mb-3">
        <div className={`rounded-xl p-2.5 ${fc.bg} border ${fc.ring}`}>
          <FolderOpen className={`h-5 w-5 ${fc.icon}`} />
        </div>
        {(canEdit || canDelete) && (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                isLight ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700" : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              }`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className={`absolute right-0 z-20 mt-1 w-36 rounded-xl border p-1 shadow-xl ${isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"}`}>
                {canEdit && <MenuAction isLight={isLight} icon={Edit3} label="Rename Folder" onClick={() => { setRenaming(true); setMenuOpen(false); }} />}
                {canDelete && <MenuAction isLight={isLight} icon={Trash2} label="Delete Folder" danger onClick={() => { deleteList(); setMenuOpen(false); }} />}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Name */}
      {renaming ? (
        <div className="flex items-center gap-1 mb-2" onClick={(e) => e.stopPropagation()}>
          <input
            className={`w-full rounded-lg border px-2.5 py-1 text-xs font-bold outline-none focus:border-indigo-500 ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-[#030712] border-slate-700 text-white"}`}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setRenaming(false); setNameDraft(list.name); } }}
            autoFocus
          />
          <button onClick={saveRename} disabled={saving || !nameDraft.trim()} className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-40" title="Save"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={() => { setRenaming(false); setNameDraft(list.name); }} className="p-1 rounded text-slate-400 hover:bg-slate-500/10 cursor-pointer" title="Cancel"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <h3 className={`text-sm font-bold truncate mb-0.5 group-hover:text-indigo-500 transition-colors ${isLight ? "text-slate-900" : "text-white"}`}>
          {list.name}
        </h3>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-3">
        {list.businessType && <span className="truncate max-w-[100px]">{list.businessType}</span>}
        {list.location && <><span>·</span><span className="truncate max-w-[100px]">{list.location}</span></>}
        {createdDate && <><span>·</span><span>{createdDate}</span></>}
      </div>

      {/* Lead count footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <UsersRound className={`h-3.5 w-3.5 ${isLight ? "text-slate-400" : "text-slate-500"}`} />
          <span className={`text-sm font-black tabular-nums ${isLight ? "text-slate-700" : "text-slate-300"}`}>{(list.leadCount ?? 0).toLocaleString()}</span>
          <span className="text-[10px] text-slate-500">leads</span>
        </div>
        <span className={`text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity ${isLight ? "text-indigo-600" : "text-indigo-400"}`}>Open →</span>
      </div>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) { return <section className="mb-3"><h3 className="mb-1 px-2 text-[8.5px] font-black uppercase tracking-[0.16em] text-slate-500">{title}</h3><div className="space-y-0.5">{children}</div></section>; }
function SideItem({ icon: Icon, label, count, active, onClick, tone = "text-slate-500", isLight = false }: { icon: LucideIcon; label: string; count?: number; active?: boolean; onClick: () => void; tone?: string; isLight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`btn-interactive flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[10.5px] transition-all cursor-pointer ${
        active
          ? isLight
            ? "bg-indigo-50 font-bold text-indigo-700 border border-indigo-200/80 shadow-xs"
            : "bg-indigo-500/12 font-bold text-indigo-400 shadow-xs"
          : isLight
            ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
      }`}
    >
      <Icon className={`h-3 w-3 shrink-0 ${active ? (isLight ? "text-indigo-600" : "text-indigo-400") : tone}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className={`rounded-full px-1.5 text-[8.5px] font-bold tabular-nums ${
            active
              ? isLight
                ? "bg-indigo-100 text-indigo-700"
                : "bg-indigo-500/30 text-indigo-200"
              : isLight
                ? "bg-slate-100 text-slate-600 border border-slate-200"
                : "bg-slate-500/10 text-slate-400"
          }`}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function LeadRow({ lead, selected, isLight, canEdit, canDelete, onSelect, onView, onOutreach, onCampaign, onDelete, onRename }: any) {
  const fit = fitOf(lead); const emails = lead.emails || []; const FitIcon = fit.Icon;
  const fitTone = fit.tone === "rose" ? "text-rose-400 bg-rose-500/10 border-rose-500/20" : fit.tone === "amber" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : fit.tone === "sky" ? "text-sky-400 bg-sky-500/10 border-sky-500/20" : "text-slate-400 bg-slate-500/10 border-slate-500/20";
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(lead.businessName);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setNameDraft(lead.businessName);
  }, [lead.businessName]);

  const saveRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === lead.businessName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await requestJson(`/api/crm/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: trimmed }),
      });
      lead.businessName = trimmed;
      setEditingName(false);
      if (onRename) onRename(lead.id, trimmed);
    } catch (err: any) {
      alert(err?.message || "Failed to rename lead.");
    } finally {
      setSavingName(false);
    }
  };

  return <tr className={`transition-colors ${isLight ? "hover:bg-slate-50/80" : "hover:bg-slate-800/30"} ${selected ? "bg-indigo-500/5" : ""}`}>
    <td className="px-2.5 py-1.5"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${lead.businessName}`} className="rounded border-slate-700 text-indigo-600 h-3 w-3" /></td>
    <td className="max-w-[280px] px-2.5 py-1.5">
      {editingName ? (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            className={`w-full rounded border px-2 py-0.5 text-xs font-bold outline-none focus:border-indigo-500 ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-[#030712] border-slate-700 text-white"}`}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") { setEditingName(false); setNameDraft(lead.businessName); }
            }}
            autoFocus
          />
          <button
            onClick={saveRename}
            disabled={savingName || !nameDraft.trim()}
            className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-40"
            title="Save Name"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setEditingName(false); setNameDraft(lead.businessName); }}
            className="p-1 rounded text-slate-400 hover:bg-slate-500/10 cursor-pointer"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="group/leadname flex items-center gap-1.5 max-w-full">
          <button className="block min-w-0 max-w-full text-left cursor-pointer group" onClick={onView}>
            <span className={`block truncate text-xs font-bold transition-colors ${isLight ? "text-slate-900 group-hover:text-indigo-600" : "text-white group-hover:text-indigo-400"}`}>
              {lead.businessName}
            </span>
            {lead.contactName && <span className={`block truncate text-[9.5px] font-medium ${isLight ? "text-indigo-600" : "text-indigo-400"}`}>{lead.contactName}</span>}
            <span className="block truncate text-[9.5px] text-slate-500">{lead.category || "Industry not set"}{lead.address ? ` · ${lead.address}` : ""}</span>
          </button>
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
              className="opacity-0 group-hover/leadname:opacity-100 p-1 text-slate-400 hover:text-indigo-500 rounded transition-opacity cursor-pointer shrink-0"
              title="Rename Lead"
              aria-label="Rename Lead"
            >
              <Edit3 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </td>
    <td className="px-2.5 py-1.5"><button onClick={onView} className={`btn-interactive inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold cursor-pointer ${fitTone}`} title={lead.icpFitReason || "AI Fit has not been calculated against an ICP."}><FitIcon className="h-2.5 w-2.5" />{fit.score === null ? "Not scored" : `${fit.score}% ${fit.label}`}</button></td>
    <td className="hidden px-2.5 py-1.5 lg:table-cell"><div className="flex items-center gap-1.5">{emails.length > 0 && <Mail className="h-3 w-3 text-indigo-400" />}{lead.phone && <Phone className="h-3 w-3 text-emerald-400" />}{lead.whatsappPresent && <MessageSquare className="h-3 w-3 text-emerald-500" />}{!emails.length && !lead.phone && <span className="text-[10px] text-slate-600">No channel</span>}</div></td>
    <td className="hidden px-2.5 py-1.5 xl:table-cell"><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${isLight ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-slate-500/10 text-slate-400"}`}>{sourceLabel(lead.source)}</span></td>
    <td className="px-2.5 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${lead.status === "REPLIED" || lead.status === "QUALIFIED" ? "bg-emerald-500/10 text-emerald-400" : lead.status === "SUPPRESSED" || lead.status === "NOT_INTERESTED" ? "bg-rose-500/10 text-rose-400" : "bg-indigo-500/10 text-indigo-400"}`}>{statusLabel(lead.status)}</span></td>
    <td className={`px-2.5 py-1.5 text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"}`}>{outreachOf(lead)}</td>
    <td className="px-2.5 py-1.5 text-right"><details className="relative inline-block"><summary className={`list-none cursor-pointer rounded-md p-1 transition-colors ${isLight ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800" : "text-slate-500 hover:bg-slate-500/10 hover:text-slate-300"}`}><MoreHorizontal className="h-3.5 w-3.5" /></summary><div className={`absolute right-0 z-20 mt-1 w-40 rounded-xl border p-1 shadow-xl ${isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"}`}><MenuAction isLight={isLight} icon={ExternalLink} label="View Lead" onClick={onView} /><MenuAction isLight={isLight} icon={Send} label="Open Outreach" onClick={onOutreach} /><MenuAction isLight={isLight} icon={ListPlus} label="Add to Campaign" onClick={onCampaign} />{canEdit && <MenuAction isLight={isLight} icon={Edit3} label="Rename Lead" onClick={() => setEditingName(true)} />}{canEdit && <MenuAction isLight={isLight} icon={BriefcaseBusiness} label="Edit / Add Note" onClick={onView} />}{canDelete && <MenuAction isLight={isLight} icon={Trash2} label="Delete" danger onClick={onDelete} />}</div></details></td>
  </tr>;
}
function MenuAction({ icon: Icon, label, onClick, danger, isLight = false }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean; isLight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`btn-interactive flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[10.5px] cursor-pointer transition-colors ${
        isLight ? "hover:bg-slate-100" : "hover:bg-slate-800/60"
      } ${
        danger
          ? isLight
            ? "text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            : "text-rose-400 hover:text-rose-300"
          : isLight
            ? "text-slate-700 hover:text-slate-950"
            : "text-slate-400 hover:text-slate-200"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function BulkBar({ count, isLight, canDelete, canExport, assignees, lists, onClear, onCampaign, onExport, onAction }: any) {
  const base = `btn-interactive rounded-md border px-2 py-1 text-[9.5px] cursor-pointer ${isLight ? "bg-white border-slate-200 text-slate-800 hover:bg-slate-50" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}`;
  return <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border p-2 ${isLight ? "bg-indigo-50 border-indigo-200" : "bg-indigo-950/40 border-indigo-500/30"}`}><strong className="mr-1.5 text-[11px] text-indigo-400 font-bold">{count} selected</strong><button className={base} onClick={onCampaign}><Send className="mr-1 inline h-2.5 w-2.5" />Add to Campaign</button><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("CHANGE_STATUS", { status: e.target.value }); e.target.value = ""; }}><option value="">Change status…</option>{Object.entries(STATUS_LABELS).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("ASSIGN", { assignedUserId: e.target.value }); e.target.value = ""; }}><option value="">Assign…</option>{assignees.map((a: any) => <option value={a.id} key={a.id}>{a.name}</option>)}</select><select className={base} defaultValue="" onChange={(e) => { if (e.target.value) onAction("ADD_TO_LIST", { listId: e.target.value }); e.target.value = ""; }}><option value="">Add to list…</option>{lists.map((l: LeadList) => <option value={l.id} key={l.id}>{l.name}</option>)}</select><button className={base} onClick={() => { const tag = window.prompt("Tag to add"); if (tag) onAction("ADD_TAG", { tag }); }}><Tag className="mr-1 inline h-2.5 w-2.5" />Add Tag</button>{canExport && <button className={base} onClick={onExport}><Download className="mr-1 inline h-2.5 w-2.5" />Export</button>}<button className={`${base} text-amber-500`} onClick={() => onAction("SUPPRESS", {}, "Suppress every available email and WhatsApp contact?")}><ShieldOff className="mr-1 inline h-2.5 w-2.5" />Suppress</button>{canDelete && <button className={`${base} text-rose-400`} onClick={() => onAction("DELETE", {}, "Permanently delete the selected leads? This cannot be undone.")}><Trash2 className="mr-1 inline h-2.5 w-2.5" />Delete</button>}<button className={`ml-auto text-[9.5px] cursor-pointer font-medium transition-colors ${isLight ? "text-slate-500 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"}`} onClick={onClear}>Clear</button></div>;
}

function FilterDrawer({ isLight, query, onChange, onClear, onClose }: any) {
  const input = `w-full rounded-lg border px-3 py-2 text-xs ${isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#030712] border-[#1e293b] text-white"}`;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-black/65 backdrop-blur-xs animate-fadeIn" onMouseDown={onClose}>
        <aside className={`absolute bottom-0 right-0 top-0 w-full max-w-md overflow-y-auto border-l p-5 shadow-2xl ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`} onMouseDown={(e) => e.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className={`font-bold ${isLight ? "text-slate-900" : "text-white"}`}>Universal lead filters</h2>
              <p className="text-[11px] text-slate-500">Combine business, AI, contact, CRM and outreach criteria.</p>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-500/10 cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
          <FilterGroup title="Business">
            <input className={input} placeholder="Industry or category" value={query.industry} onChange={(e) => onChange({ industry: e.target.value })} />
            <input className={input} placeholder="Location, country or city" value={query.location} onChange={(e) => onChange({ location: e.target.value })} />
          </FilterGroup>
          <FilterGroup title="AI / ICP">
            <select className={input} value={query.fit} onChange={(e) => onChange({ fit: e.target.value })}>
              <option value="ALL">Any AI Fit</option>
              <option value="HIGH">High Fit (75–100)</option>
              <option value="MEDIUM">Medium Fit (40–74)</option>
              <option value="LOW">Low Fit (0–39)</option>
              <option value="UNSCORED">Not scored</option>
            </select>
          </FilterGroup>
          <FilterGroup title="Contact">
            <select className={input} value={query.contact} onChange={(e) => onChange({ contact: e.target.value })}>
              <option value="ALL">Any contact availability</option>
              <option value="EMAIL">Has email</option>
              <option value="PHONE">Has phone</option>
              <option value="WHATSAPP">Has WhatsApp</option>
              <option value="WEBSITE">Has website</option>
              <option value="SOCIAL">Has social profile</option>
            </select>
          </FilterGroup>
          <FilterGroup title="Lead source">
            <select className={input} value={query.source} onChange={(e) => onChange({ source: e.target.value })}>
              <option value="ALL">Any source</option>
              <option value="GOOGLE_MAPS">Google Maps</option>
              <option value="IMPORTED">Imported</option>
            </select>
          </FilterGroup>
          <FilterGroup title="CRM">
            <select className={input} value={query.status} onChange={(e) => onChange({ status: e.target.value })}>
              <option value="ALL">Any status</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option value={v} key={v}>{l}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={query.mine} onChange={(e) => onChange({ mine: e.target.checked })} />
              Assigned to me
            </label>
          </FilterGroup>
          <FilterGroup title="Outreach">
            <select className={input} value={query.outreach} onChange={(e) => onChange({ outreach: e.target.value })}>
              <option value="ALL">Any outreach state</option>
              <option value="NOT_CONTACTED">Not contacted</option>
              <option value="EMAIL_SENT">Email sent</option>
              <option value="WHATSAPP_SENT">WhatsApp sent</option>
              <option value="REPLIED">Replied</option>
              <option value="FAILED">Failed</option>
            </select>
          </FilterGroup>
          <FilterGroup title="Added date">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className={input} value={query.dateFrom} onChange={(e) => onChange({ dateFrom: e.target.value })} />
              <input type="date" className={input} value={query.dateTo} onChange={(e) => onChange({ dateTo: e.target.value })} />
            </div>
          </FilterGroup>
          <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-slate-500/20 pt-4 bg-inherit">
            <button className={`flex-1 rounded-xl border px-4 py-2 text-xs cursor-pointer transition-colors ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900" : "border-slate-500/20 text-slate-400 hover:bg-slate-500/10 hover:text-slate-200"}`} onClick={onClear}>Clear all</button>
            <button className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white cursor-pointer hover:bg-indigo-500" onClick={onClose}>Show results</button>
          </div>
        </aside>
      </div>
    </ModalPortal>
  );
}
function FilterGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="mb-5 space-y-2"><h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</h3>{children}</section>; }

function DetailDrawer({ isLight, detail, loading, tab, canEdit, canDelete, onTab, onClose, onOutreach, onCampaign, onSaved, onDelete }: any) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [draft, setDraft] = useState<any>({});
  useEffect(() => { if (detail?.lead) setDraft({ businessName: detail.lead.businessName, contactName: detail.lead.contactName || "", category: detail.lead.category || "", address: detail.lead.address || "", phone: detail.lead.phone || "", website: detail.lead.website || "", status: detail.lead.status || "NEW", notes: detail.lead.notes || "" }); }, [detail]);
  const save = async () => { setSaving(true); try { await requestJson(`/api/crm/leads/${detail.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); setEditing(false); await onSaved(); } finally { setSaving(false); } };
  const panel = isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#090d16] border-[#1e293b] text-white"; const input = `w-full rounded-lg border px-3 py-2 text-xs ${isLight ? "bg-white border-slate-200" : "bg-[#030712] border-[#1e293b]"}`;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-black/65 backdrop-blur-xs animate-fadeIn" onMouseDown={onClose}>
        <aside className={`absolute bottom-0 right-0 top-0 w-full max-w-2xl overflow-y-auto border-l ${panel} shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
          {loading || !detail ? <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-400" /></div> : <><header className="sticky top-0 z-10 border-b border-slate-500/20 bg-inherit p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-indigo-400" /><h2 className="text-lg font-black">{detail.lead.businessName}</h2></div><p className="mt-1 text-xs text-slate-500">{detail.lead.contactName || "No contact person recorded"} · {detail.lead.category || "Industry not set"}</p></div><button onClick={onClose} className={`p-1 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}><X className="h-4 w-4" /></button></div><div className="mt-4 flex gap-1 overflow-x-auto">{(["overview","intelligence","ai","outreach","crm"] as const).map((value) => <button key={value} onClick={() => onTab(value)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize transition-colors ${tab === value ? "bg-indigo-600 text-white shadow-xs" : isLight ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"}`}>{value === "ai" ? "AI Analysis" : value === "intelligence" ? "Business Intelligence" : value}</button>)}</div></header><div className="space-y-4 p-5">{editing ? <div className="grid gap-3 sm:grid-cols-2"><input className={input} value={draft.businessName} onChange={(e) => setDraft({...draft,businessName:e.target.value})} placeholder="Company name" /><input className={input} value={draft.contactName} onChange={(e) => setDraft({...draft,contactName:e.target.value})} placeholder="Contact person" /><input className={input} value={draft.category} onChange={(e) => setDraft({...draft,category:e.target.value})} placeholder="Industry / category" /><input className={input} value={draft.phone} onChange={(e) => setDraft({...draft,phone:e.target.value})} placeholder="Phone" /><input className={`${input} sm:col-span-2`} value={draft.address} onChange={(e) => setDraft({...draft,address:e.target.value})} placeholder="Location" /><input className={`${input} sm:col-span-2`} value={draft.website} onChange={(e) => setDraft({...draft,website:e.target.value})} placeholder="Website" /><select className={input} value={draft.status} onChange={(e) => setDraft({...draft,status:e.target.value})}>{Object.entries(STATUS_LABELS).map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><textarea className={`${input} sm:col-span-2`} rows={4} value={draft.notes} onChange={(e) => setDraft({...draft,notes:e.target.value})} placeholder="Private CRM notes" /><div className="sm:col-span-2 flex justify-end gap-2"><button className="rounded-lg border px-3 py-2 text-xs" onClick={() => setEditing(false)}>Cancel</button><button className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save lead"}</button></div></div> : <DetailContent detail={detail} tab={tab} isLight={isLight} />}</div><footer className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-500/20 bg-inherit p-4"><button className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white" onClick={onOutreach}><Send className="mr-1 inline h-3.5 w-3.5" />Outreach</button><button className="rounded-lg border border-slate-500/20 px-3 py-2 text-xs" onClick={onCampaign}><ListPlus className="mr-1 inline h-3.5 w-3.5" />Add to Campaign</button>{canEdit && <button className="rounded-lg border border-slate-500/20 px-3 py-2 text-xs" onClick={() => setEditing(true)}>Edit / Add Note</button>}{canDelete && <button className="ml-auto rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-400" onClick={onDelete}><Trash2 className="mr-1 inline h-3.5 w-3.5" />Delete</button>}</footer></>}
        </aside>
      </div>
    </ModalPortal>
  );
}

function DetailContent({ detail, tab, isLight }: { detail: Detail; tab: string; isLight: boolean }) {
  const lead = detail.lead; const fit = fitOf(lead); const text = isLight ? "text-slate-700" : "text-slate-300";
  if (tab === "overview") return <><InfoCard title="Company & fit"><DetailLine label="Company" value={lead.businessName} /><DetailLine label="Contact" value={lead.contactName || "Not available"} /><DetailLine label="Industry" value={lead.category || "Not available"} /><DetailLine label="Location" value={lead.address || "Not available"} /><DetailLine label="AI Fit" value={fit.score === null ? "Not scored against an ICP" : `${fit.score}% ${fit.label}`} /><DetailLine label="ICP match" value={lead.icpFitReason || "No verified ICP explanation available"} /></InfoCard><InfoCard title="Contact"><DetailLine label="Email" value={lead.emails?.join(", ") || "Not available"} /><DetailLine label="Phone" value={lead.phone || "Not available"} /><DetailLine label="WhatsApp" value={lead.whatsappPresent && lead.phone ? lead.phone : "Not verified"} /><DetailLine label="Website" value={lead.website || "Not available"} /></InfoCard></>;
  if (tab === "intelligence") return <><InfoCard title="Verified business facts"><DetailLine label="Category" value={lead.category || "Not available"} /><DetailLine label="Location" value={lead.address || "Not available"} /><DetailLine label="Rating" value={lead.rating ? `${lead.rating} (${lead.reviews} reviews)` : "Not available"} /><DetailLine label="Source" value={sourceLabel(lead.source)} /></InfoCard><InfoCard title="Digital presence (supporting signals)"><DetailLine label="Website" value={lead.websiteStatus || "Not analyzed"} /><DetailLine label="Instagram" value={lead.instagramStatus || "Not analyzed"} /><DetailLine label="Facebook" value={lead.facebookStatus || "Not analyzed"} /><DetailLine label="LinkedIn" value={lead.linkedinStatus || "Not analyzed"} /><DetailLine label="Google Business Profile" value={lead.mapsUrl ? "Available" : "Not available"} /></InfoCard></>;
  if (tab === "ai") return <><div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4"><div className="mb-1 flex items-center gap-2 text-xs font-bold text-indigo-400"><Sparkles className="h-4 w-4" />Why this lead matches</div><p className={`text-xs leading-relaxed ${text}`}>{detail.ai?.fitReason || "No grounded ICP explanation has been generated. The system will not invent one."}</p></div><InfoCard title="Qualification signals">{(detail.ai?.scoreBreakdown || []).length ? detail.ai.scoreBreakdown.map((item) => <div key={`${item.signal}-${item.label}`}><DetailLine label={item.label} value={`+${item.points}`} /></div>) : <p className="text-xs text-slate-500">No explainable scoring signals are stored.</p>}</InfoCard><FitList title="Product Fit" values={detail.ai?.productFit || []} /><FitList title="Service Fit" values={detail.ai?.serviceFit || []} /><InfoCard title="AI recommendation"><p className={`text-xs leading-relaxed ${text}`}>{detail.ai?.recommendation || "No recommendation available."}</p><p className="mt-2 text-[10px] text-amber-500">AI recommendation — verify before using in outreach.</p></InfoCard></>;
  if (tab === "outreach") { const events = [...(detail.outreach?.messages || []).map((x: any) => ({...x, date:x.sentAt || x.createdAt, type:"Message"})), ...(detail.outreach?.dispatches || []).map((x: any) => ({...x,date:x.occurredAt,type:"Delivery"}))].sort((a,b) => +new Date(b.date)-+new Date(a.date)); return <InfoCard title="Outreach history">{events.length ? events.map((event) => <div key={`${event.type}-${event.id}`} className="border-b border-slate-500/10 py-2 text-xs"><div className="flex justify-between"><strong className="capitalize">{event.channel} · {event.type}</strong><span className="text-slate-500">{event.date ? new Date(event.date).toLocaleString() : ""}</span></div><div className="mt-1 text-slate-500">{event.status}{event.subject ? ` · ${event.subject}` : ""}</div></div>) : <p className="text-xs text-slate-500">No outreach has been recorded for this lead.</p>}</InfoCard>; }
  return <><InfoCard title="CRM"><DetailLine label="Status" value={statusLabel(lead.status)} /><DetailLine label="Owner" value={lead.assignedUserName || "Unassigned"} /><DetailLine label="List" value={lead.listName || detail.list?.name || "Not available"} /><DetailLine label="Tags" value={lead.tags?.join(", ") || "None"} /></InfoCard><InfoCard title="Notes"><p className={`whitespace-pre-wrap text-xs ${text}`}>{lead.notes || "No notes yet."}</p></InfoCard><InfoCard title="Activity"><p className="text-xs text-slate-500">Outreach and conversation events are available in the Outreach tab. A separate task timeline is not yet stored.</p></InfoCard></>;
}
function InfoCard({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-xl border border-slate-500/15 p-4"><h3 className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</h3><div className="space-y-2">{children}</div></section>; }
function DetailLine({ label, value }: { label: string; value: ReactNode }) { return <div className="flex items-start justify-between gap-4 text-xs"><span className="shrink-0 text-slate-500">{label}</span><span className="text-right">{value}</span></div>; }
function FitList({ title, values }: { title: string; values: any[] }) { return <InfoCard title={title}>{values?.length ? values.map((value, index) => <div key={value.id || value.name || index}><DetailLine label={value.name || "Configured offering"} value={value.fit || (typeof value.score === "number" ? `${value.score}%` : "Analyzed")} /></div>) : <p className="text-xs text-slate-500">Not analyzed against configured {title.toLowerCase()} yet.</p>}</InfoCard>; }

function EmptyState({ hasFilters, fit, contact, onClear, onFind }: any) { const message = fit !== "ALL" ? "No leads currently match your AI Fit criteria." : contact !== "ALL" ? "No leads have the selected contact method." : hasFilters ? "No leads match your current filters." : "No leads found yet."; return <div className="flex flex-col items-center justify-center py-20 text-center"><Database className="h-10 w-10 text-slate-600" /><h3 className="mt-3 text-sm font-bold text-slate-400">{message}</h3><p className="mt-1 max-w-sm text-xs text-slate-600">{hasFilters ? "Try removing one or more criteria." : "Discover prospects or import an existing lead list to get started."}</p><button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" onClick={hasFilters ? onClear : onFind}>{hasFilters ? "Clear Filters" : "Find Leads"}</button></div>; }

function AddLeadModal({ isLight, lists, onClose, onComplete }: any) { const [listId,setListId]=useState(lists[0]?.id || ""); const [form,setForm]=useState({businessName:"",contactName:"",category:"",address:"",phone:"",email:"",website:""}); const [error,setError]=useState(""); const submit=async(e:FormEvent)=>{e.preventDefault();try{if(!listId)throw new Error("Create or select a saved list first.");await requestJson(`/api/crm/lists/${listId}/leads`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({leads:[{...form,emails:form.email?[form.email]:[],source:"MANUAL",status:"NEW"}]})});onComplete();}catch(c){setError(c instanceof Error?c.message:"Could not add lead.");}}; return <Modal title="Add Lead" isLight={isLight} onClose={onClose}><LeadForm form={form} setForm={setForm} listId={listId} setListId={setListId} lists={lists} error={error} onSubmit={submit} submitLabel="Add Lead" /></Modal>; }
function ImportModal({ isLight, lists, onClose, onComplete }: any) {
  const [tab, setTab] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [extractedResult, setExtractedResult] = useState<{
    leads: any[];
    suggestedListName: string;
    fileName: string;
    count: number;
  } | null>(null);

  const [saveMode, setSaveMode] = useState<"new" | "merge">("new");
  const [newListName, setNewListName] = useState("");
  const [selectedListId, setSelectedListId] = useState(lists[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError("");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError("");
    }
  };

  const analyze = async () => {
    setError("");
    if (tab === "file" && !file) {
      setError("Please select a file (.xlsx, .csv, .docx, .pdf, or .txt) to upload.");
      return;
    }
    if (tab === "text" && !text.trim()) {
      setError("Please enter or paste text / CSV data.");
      return;
    }

    setAnalyzing(true);
    try {
      let res: any;
      if (tab === "file" && file) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/crm/leads/import-file", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        res = await response.json();
        if (!response.ok) throw new Error(res.error || "Failed to analyze document.");
      } else {
        const response = await fetch("/api/crm/leads/import-file", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, fileName: "Pasted Leads.txt" }),
        });
        res = await response.json();
        if (!response.ok) throw new Error(res.error || "Failed to analyze text.");
      }

      if (!res.leads || res.leads.length === 0) {
        throw new Error("No leads were found in the uploaded content.");
      }

      setExtractedResult(res);
      setNewListName(res.suggestedListName || "Imported Leads");
      if (lists.length > 0) {
        setSelectedListId(lists[0].id);
      }
    } catch (caught: any) {
      setError(caught.message || "Failed to analyze document.");
    } finally {
      setAnalyzing(false);
    }
  };

  const saveLeads = async () => {
    if (!extractedResult || extractedResult.leads.length === 0) return;
    setSaving(true);
    setError("");
    try {
      let targetListId = selectedListId;
      if (saveMode === "new") {
        if (!newListName.trim()) {
          throw new Error("Please enter a name for the new lead list.");
        }
        const createdList = await requestJson<LeadList>("/api/crm/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newListName.trim() }),
        });
        targetListId = createdList.id;
      }

      if (!targetListId) {
        throw new Error("Please select an existing list or enter a new list name.");
      }

      await requestJson(`/api/crm/lists/${targetListId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: extractedResult.leads }),
      });

      onComplete();
    } catch (caught: any) {
      setError(caught.message || "Failed to save leads.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Import Leads with AI Analysis" isLight={isLight} maxWidth="max-w-xl" onClose={onClose}>
      {!extractedResult ? (
        <div className="space-y-4">
          <div className="flex border-b border-slate-500/20">
            <button
              onClick={() => { setTab("file"); setError(""); }}
              className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === "file"
                  ? "border-indigo-500 text-indigo-500"
                  : isLight ? "border-transparent text-slate-500 hover:text-slate-800" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Upload Document (Excel, PDF, Word, CSV, TXT)
            </button>
            <button
              onClick={() => { setTab("text"); setError(""); }}
              className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === "text"
                  ? "border-indigo-500 text-indigo-500"
                  : isLight ? "border-transparent text-slate-500 hover:text-slate-800" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Paste Text / CSV
            </button>
          </div>

          {tab === "file" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv,.tsv,.docx,.doc,.pdf,.txt"
                onChange={handleFileChange}
              />
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                  file
                    ? isLight ? "border-indigo-400 bg-indigo-50/50" : "border-indigo-500 bg-indigo-500/10"
                    : isLight ? "border-slate-300 hover:border-indigo-400 bg-slate-50 hover:bg-slate-100" : "border-slate-700 hover:border-indigo-500 bg-slate-900/40 hover:bg-slate-900/80"
                }`}
              >
                <UploadCloud className="h-10 w-10 text-indigo-500 mb-2" />
                {file ? (
                  <div className="text-center">
                    <p className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>{file.name}</p>
                    <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(1)} KB · Click to change file</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${isLight ? "text-slate-800" : "text-slate-200"}`}>
                      Drag & drop your document here, or <span className="text-indigo-500 underline font-bold">browse</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Supports Excel (.xlsx, .xls), CSV, Word (.docx), PDF, & TXT files</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2.5 text-[9.5px]">
                <span className="rounded bg-slate-500/10 px-2 py-0.5 text-slate-400 font-medium">Spreadsheet / Excel</span>
                <span className="rounded bg-slate-500/10 px-2 py-0.5 text-slate-400 font-medium">PDF Documents</span>
                <span className="rounded bg-slate-500/10 px-2 py-0.5 text-slate-400 font-medium">Word .DOCX</span>
                <span className="rounded bg-slate-500/10 px-2 py-0.5 text-slate-400 font-medium">CSV & Text</span>
              </div>
            </div>
          ) : (
            <div>
              <textarea
                rows={8}
                className={`w-full rounded-xl border p-3 font-mono text-xs outline-none focus:border-indigo-500 ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-[#030712] border-slate-700 text-white"}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste CSV rows or unstructured prospect notes here:&#10;Acme Corp, John Doe, john@acme.com, +1234567890, New York&#10;Apex Dental, Dr. Smith, info@apexdental.com, Dental Clinic"
              />
            </div>
          )}

          {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs text-rose-400">{error}</div>}

          <button
            onClick={analyze}
            disabled={analyzing}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is reading document & extracting leads…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze Document & Extract Leads
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Found {extractedResult.count} leads from {extractedResult.fileName}
            </div>
            <button
              onClick={() => { setExtractedResult(null); setFile(null); }}
              className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Choose different file
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-500/20 divide-y divide-slate-500/15">
            {extractedResult.leads.slice(0, 10).map((l, i) => (
              <div key={i} className="p-2.5 text-xs flex items-center justify-between">
                <div>
                  <strong className={isLight ? "text-slate-900" : "text-white"}>{l.businessName}</strong>
                  {l.contactName && <span className="ml-1.5 text-indigo-400 font-medium">({l.contactName})</span>}
                  <div className="text-[10.5px] text-slate-500">{l.category || "General"} {l.address ? `· ${l.address}` : ""}</div>
                </div>
                <div className="text-right text-[11px] text-slate-400">
                  {l.emails?.[0] || l.phone || "No direct channel"}
                </div>
              </div>
            ))}
            {extractedResult.leads.length > 10 && (
              <div className="p-2 text-center text-[10.5px] text-slate-500 bg-slate-500/5">
                + {extractedResult.leads.length - 10} more leads extracted
              </div>
            )}
          </div>

          <div className={`p-4 rounded-xl border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/50 border-slate-800"}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">How should these leads be saved?</h3>
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="saveMode"
                  value="new"
                  checked={saveMode === "new"}
                  onChange={() => setSaveMode("new")}
                  className="mt-0.5 text-indigo-600"
                />
                <div className="flex-1">
                  <span className={`text-xs font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Create a new lead list</span>
                  {saveMode === "new" && (
                    <input
                      type="text"
                      className={`mt-1.5 w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:border-indigo-500 ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-[#030712] border-slate-700 text-white"}`}
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="e.g. Pune Dentists Q3"
                    />
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="saveMode"
                  value="merge"
                  checked={saveMode === "merge"}
                  onChange={() => setSaveMode("merge")}
                  className="mt-0.5 text-indigo-600"
                />
                <div className="flex-1">
                  <span className={`text-xs font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Merge into existing list</span>
                  <p className="text-[10px] text-slate-500">App intelligence will automatically update matching leads and add new prospects.</p>
                  {saveMode === "merge" && (
                    <select
                      className={`mt-1.5 w-full rounded-lg border px-3 py-1.5 text-xs outline-none ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-[#030712] border-slate-700 text-white"}`}
                      value={selectedListId}
                      onChange={(e) => setSelectedListId(e.target.value)}
                    >
                      {lists.map((l: LeadList) => (
                        <option value={l.id} key={l.id}>{l.name} ({l.leadCount} leads)</option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </div>

          {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs text-rose-400">{error}</div>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setExtractedResult(null)}
              className="flex-1 rounded-xl border border-slate-500/20 py-2.5 text-xs font-semibold hover:bg-slate-500/10 transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={saveLeads}
              disabled={saving}
              className="flex-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving leads…
                </>
              ) : (
                `Save ${extractedResult.count} Leads`
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LeadForm({form,setForm,listId,setListId,lists,error,onSubmit,submitLabel}:any){return <form className="space-y-3" onSubmit={onSubmit}><select className="w-full rounded-lg border border-slate-500/20 bg-transparent px-3 py-2 text-xs" value={listId} onChange={(e)=>setListId(e.target.value)}>{lists.map((l:LeadList)=><option value={l.id} key={l.id}>{l.name}</option>)}</select>{[["businessName","Company / business name *"],["contactName","Contact person"],["category","Industry / category"],["address","Location"],["email","Email"],["phone","Phone / WhatsApp"],["website","Website"]].map(([key,label])=><input key={key} required={key==="businessName"} className="w-full rounded-lg border border-slate-500/20 bg-transparent px-3 py-2 text-xs" value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})} placeholder={label} />)}{error&&<p className="text-xs text-rose-400">{error}</p>}<button className="w-full rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white">{submitLabel}</button></form>;}
function Modal({ title, isLight, onClose, maxWidth = "max-w-lg", children }: any) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn" onMouseDown={onClose}>
        <div className={`w-full ${maxWidth} rounded-2xl border p-5 shadow-2xl relative animate-scaleUp ${isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#090d16] border-[#1e293b] text-white"}`} onMouseDown={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-sm">{title}</h2>
            <button onClick={onClose} className={`p-1 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}

function filterChips(query: Query) { const chips:string[]=[]; if(query.search)chips.push(`Search: ${query.search}`); if(query.fit!=="ALL")chips.push(`${query.fit} Fit`); if(query.source!=="ALL")chips.push(sourceLabel(query.source)); if(query.status!=="ALL")chips.push(statusLabel(query.status)); if(query.outreach!=="ALL")chips.push(query.outreach.replaceAll("_"," ")); if(query.contact!=="ALL")chips.push(`Has ${query.contact.toLowerCase()}`); if(query.industry)chips.push(query.industry); if(query.location)chips.push(query.location); if(query.mine)chips.push("Assigned to me"); if(query.listId!=="ALL")chips.push("Saved list"); return chips; }
