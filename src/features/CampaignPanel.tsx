/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Professional UI/UX Reviewed Campaign Workspace.
 *
 * Deliberate workflow:
 *   1. Create — select target leads, enable channels, and assign reviewed outreach templates.
 *   2. Review & Inspect — preview, edit, approve, or reject every personalized message.
 *   3. Launch & Pace — confirm and launch with safe, sequential anti-block intervals.
 *   4. Track & Monitor — live real-time status tracking across queued, sent, and failed dispatches.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { OutreachTemplate } from "../outreachTemplates";
import type { LeadList } from "../types";
import WhatsAppLogo from "../WhatsAppLogo";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Edit3,
  Eye,
  Filter,
  Folder,
  FolderCheck,
  FolderOpen,
  HelpCircle,
  Laptop,
  Loader2,
  Mail,
  MessageSquare,
  MinusSquare,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  User,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  type CampaignDetailView,
  type CampaignMessageView,
  type CampaignView,
} from "../ui/api";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Field,
  ModalPortal,
  Notice,
  Spinner,
  TextArea,
  TextInput,
  tokens,
  useAction,
  useAsync,
  type Themed,
} from "../ui/primitives";

interface IntegrationSummary {
  id: string;
  type: string;
  label: string | null;
  enabled: boolean;
}

interface IntegrationsResponse {
  ok: boolean;
  integrations: IntegrationSummary[];
}

type MessageFilter =
  | "all"
  | "pending_review"
  | "approved"
  | "sending"
  | "retry_wait"
  | "sent"
  | "failed"
  | "rejected"
  | "suppressed";

const MESSAGE_FILTERS: MessageFilter[] = [
  "all",
  "pending_review",
  "approved",
  "sending",
  "retry_wait",
  "sent",
  "failed",
  "rejected",
  "suppressed",
];

function labelForStatus(status: string): string {
  const labels: Record<string, string> = {
    pending_review: "Needs Review",
    partially_approved: "Review In Progress",
    approved: "Ready to Launch",
    sending: "Sending Now",
    retry_wait: "Retry Waiting",
    sent: "Completed",
    failed: "Delivery Failed",
    rejected: "Rejected",
    suppressed: "Suppressed",
    cancelled: "Cancelled",
    all: "All Messages",
  };
  return labels[status] || status.replace(/_/g, " ");
}

function statusTone(status: string): "good" | "warm" | "info" | "neutral" | "bad" {
  if (status === "sent") return "good";
  if (status === "pending_review" || status === "retry_wait") return "warm";
  if (status === "approved" || status === "partially_approved" || status === "sending") {
    return "info";
  }
  if (status === "failed" || status === "rejected" || status === "cancelled") return "bad";
  return "neutral";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(value);
}

function normalizeIntegrations(data: IntegrationsResponse | IntegrationSummary[] | null): IntegrationSummary[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.integrations) ? data.integrations : [];
}

function leadHasEmail(lead: any): boolean {
  if (Array.isArray(lead?.emails)) return lead.emails.some((email: unknown) => typeof email === "string" && email.includes("@"));
  if (typeof lead?.emails !== "string") return false;
  try {
    const parsed = JSON.parse(lead.emails);
    return Array.isArray(parsed) && parsed.some((email) => typeof email === "string" && email.includes("@"));
  } catch {
    return lead.emails.includes("@");
  }
}

export default function CampaignPanel({ isLight }: Themed) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const integrations = useAsync<IntegrationsResponse>(() => api.get("/api/integrations"));
  const integrationList = useMemo(() => normalizeIntegrations(integrations.data), [integrations.data]);
  const googleSheet = integrationList.find((item) => item.type === "google_sheet" && item.enabled !== false);
  const smtp = integrationList.find((item) => item.type === "smtp" && item.enabled !== false);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── HEADER HERO SECTION ── */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-5 md:p-6 transition-all shadow-sm ${
          isLight
            ? "bg-gradient-to-br from-white via-indigo-50/20 to-white border-slate-200/90 shadow-slate-100"
            : "bg-gradient-to-br from-[#0b101d] via-[#090d16] to-[#070b12] border-slate-800/80 shadow-black/40"
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <Send className="h-3 w-3" /> Outreach Command Center
              </span>
              <span className={`text-[11px] ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                Multi-Channel Campaigns
              </span>
            </div>
            <h1 className={`text-xl md:text-2xl font-extrabold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
              Campaigns & Automated Dispatch
            </h1>
            <p className={`text-xs md:text-sm leading-relaxed ${isLight ? "text-slate-600" : "text-slate-400"}`}>
              Launch high-converting outbound sequences with full manual review. Every personalized email and WhatsApp is verified before dispatch with protected anti-block intervals.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setCreateModalOpen(true)}
              className="btn-interactive inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-500 hover:to-violet-500 cursor-pointer transition-all hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4" />
              <span>Create Campaign</span>
            </button>
          </div>
        </div>

        {/* Integration Status Badges */}
        <div className={`mt-5 pt-4 border-t flex flex-wrap items-center gap-3 text-xs ${
          isLight ? "border-slate-200/70" : "border-slate-800/70"
        }`}>
          <span className={`text-[11px] font-semibold ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            Integrations Readiness:
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <IntegrationChip
              isLight={isLight}
              icon={googleSheet ? CheckCircle2 : AlertTriangle}
              label={googleSheet ? "Google Sheets Connected" : "Google Sheets Not Connected"}
              ready={Boolean(googleSheet)}
              href="/app/integrations"
            />
            <IntegrationChip
              isLight={isLight}
              icon={smtp ? CheckCircle2 : AlertTriangle}
              label={smtp ? "SMTP Email Gateway Ready" : "SMTP Gateway Setup Needed"}
              ready={Boolean(smtp)}
              href="/app/integrations"
            />
            <IntegrationChip
              isLight={isLight}
              icon={WhatsAppLogo}
              isCustomIcon
              label="WhatsApp Web Gateway Available"
              ready={true}
              href="/app/integrations"
            />
          </div>
        </div>
      </div>

      {/* ── WORKSPACE VIEW: CAMPAIGN LIST OR DETAIL ── */}
      <CampaignWorkspace
        isLight={isLight}
        onOpenCreate={() => setCreateModalOpen(true)}
        externalActiveId={createdCampaignId}
        onClearExternalActiveId={() => setCreatedCampaignId(null)}
        googleSheetReady={Boolean(googleSheet)}
        smtpReady={Boolean(smtp)}
      />

      {/* ── CREATE CAMPAIGN MODAL ── */}
      {createModalOpen && (
        <CreateCampaignModal
          isLight={isLight}
          googleSheetReady={Boolean(googleSheet)}
          smtpReady={Boolean(smtp)}
          readinessLoading={integrations.loading}
          readinessError={integrations.error}
          onClose={() => setCreateModalOpen(false)}
          onCreated={(campaignId) => {
            setCreateModalOpen(false);
            setCreatedCampaignId(campaignId);
          }}
        />
      )}
    </div>
  );
}

function IntegrationChip({
  isLight,
  icon: Icon,
  isCustomIcon,
  label,
  ready,
  href,
}: Themed & {
  icon: any;
  isCustomIcon?: boolean;
  label: string;
  ready: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium border transition-all hover:scale-105 ${
        ready
          ? isLight
            ? "bg-emerald-50 text-emerald-800 border-emerald-200/80 hover:bg-emerald-100"
            : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20"
          : isLight
            ? "bg-amber-50 text-amber-900 border-amber-200/80 hover:bg-amber-100"
            : "bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/20"
      }`}
    >
      {isCustomIcon ? (
        <Icon className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>{label}</span>
      {!ready && <ArrowUpRight className="h-3 w-3 opacity-60 ml-0.5" />}
    </a>
  );
}

function CampaignWorkspace({
  isLight,
  onOpenCreate,
  externalActiveId,
  onClearExternalActiveId,
  googleSheetReady,
  smtpReady,
}: Themed & {
  onOpenCreate: () => void;
  externalActiveId: string | null;
  onClearExternalActiveId: () => void;
  googleSheetReady: boolean;
  smtpReady: boolean;
}) {
  const t = tokens(isLight);
  const campaigns = useAsync<CampaignView[]>(() => api.get("/api/campaigns"));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (!externalActiveId) return;
    setActiveId(externalActiveId);
    campaigns.reload();
    onClearExternalActiveId();
  }, [externalActiveId, campaigns.reload, onClearExternalActiveId]);

  if (activeId) {
    return (
      <CampaignReview
        isLight={isLight}
        campaignId={activeId}
        googleSheetReady={googleSheetReady}
        smtpReady={smtpReady}
        onBack={() => {
          setActiveId(null);
          campaigns.reload();
        }}
      />
    );
  }

  const campaignList = campaigns.data ?? [];

  // Metrics calculation
  const totalCampaigns = campaignList.length;
  const activeCampaigns = campaignList.filter(
    (c) => c.status === "sending" || c.status === "pending_review" || c.status === "partially_approved"
  ).length;
  const totalMessages = campaignList.reduce((acc, c) => acc + (c.totalMessages || 0), 0);
  const totalSent = campaignList.reduce((acc, c) => acc + (c.sentCount || 0), 0);
  const totalPending = campaignList.reduce((acc, c) => acc + (c.pendingCount || 0), 0);

  const filteredCampaigns = campaignList.filter((c) => {
    const matchesSearch =
      !searchQuery.trim() || c.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && (c.status === "sending" || c.status === "approved")) ||
      (statusFilter === "review" && (c.status === "pending_review" || c.status === "partially_approved")) ||
      (statusFilter === "completed" && c.status === "sent");
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* ── KPI METRICS CARDS (shown when campaigns exist) ── */}
      {totalCampaigns > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <MetricCard
            isLight={isLight}
            label="Total Campaigns"
            value={totalCampaigns}
            sub={`${activeCampaigns} currently active`}
            icon={Send}
            tone="indigo"
          />
          <MetricCard
            isLight={isLight}
            label="Messages Queued"
            value={totalMessages}
            sub="Across all channels"
            icon={BarChart3}
            tone="blue"
          />
          <MetricCard
            isLight={isLight}
            label="Dispatched & Sent"
            value={totalSent}
            sub={totalMessages > 0 ? `${Math.round((totalSent / totalMessages) * 100)}% delivery progress` : "0% sent"}
            icon={CheckCircle2}
            tone="emerald"
          />
          <MetricCard
            isLight={isLight}
            label="Needs Review"
            value={totalPending}
            sub={totalPending > 0 ? "Awaiting manual approval" : "All reviewed"}
            icon={Clock3}
            tone={totalPending > 0 ? "amber" : "neutral"}
          />
        </div>
      )}

      {/* ── CAMPAIGNS MAIN CARD ── */}
      <div
        className={`rounded-2xl border transition-all ${
          isLight ? "bg-white border-slate-200/90 shadow-sm" : "bg-[#090d16] border-[#1e293b]"
        }`}
      >
        {/* Table / List Toolbar */}
        <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isLight ? "border-slate-200/80 bg-slate-50/40" : "border-slate-800/80 bg-slate-950/30"
        }`}>
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns by name..."
                className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none font-medium transition-colors ${
                  isLight
                    ? "bg-white border-slate-200 text-slate-900 focus:border-indigo-500"
                    : "bg-slate-950 border-slate-800 text-white focus:border-indigo-400"
                }`}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status Filter Tabs */}
            <div className={`p-0.5 rounded-xl border flex items-center text-[11px] font-semibold ${
              isLight ? "bg-slate-100 border-slate-200" : "bg-black/30 border-slate-800"
            }`}>
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === "all"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter("review")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === "review"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                Needs Review
              </button>
              <button
                onClick={() => setStatusFilter("active")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === "active"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setStatusFilter("completed")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === "completed"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                Completed
              </button>
            </div>

            <button
              onClick={() => campaigns.reload()}
              className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isLight ? "border-slate-200 hover:bg-slate-50 text-slate-600" : "border-slate-800 hover:bg-slate-850 text-slate-300"
              }`}
              title="Refresh Campaigns"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4">
          {campaigns.loading ? (
            <div className="py-16 text-center">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-indigo-500" />
              <p className="text-xs text-slate-400">Loading campaign records...</p>
            </div>
          ) : campaigns.error ? (
            <div className="py-6">
              <ErrorNotice isLight={isLight} error={campaigns.error} />
            </div>
          ) : campaignList.length === 0 ? (
            <div className={`p-12 text-center rounded-2xl border border-dashed ${
              isLight ? "border-slate-200 bg-slate-50/50" : "border-slate-800 bg-slate-950/20"
            }`}>
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mx-auto mb-3">
                <Rocket className="h-6 w-6" />
              </div>
              <h3 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                No campaigns created yet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Create a targeted campaign to select leads, assign email & WhatsApp templates, and review personalized copies before paced dispatch.
              </p>
              <div className="mt-4">
                <button
                  onClick={onOpenCreate}
                  className="btn-interactive inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-sm cursor-pointer transition-all"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Your First Campaign</span>
                </button>
              </div>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No campaigns match your search or filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCampaigns.map((campaign) => {
                const deliveryStarted = campaign.status === "sending" || campaign.status === "sent";
                const total = campaign.totalMessages || 1;
                const percent = Math.min(100, Math.round(((campaign.sentCount || 0) / total) * 100));

                return (
                  <div
                    key={campaign.id}
                    onClick={() => setActiveId(campaign.id)}
                    className={`p-4 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      isLight
                        ? "bg-white border-slate-200/90 hover:border-indigo-300"
                        : "bg-[#0c111d] border-slate-800 hover:border-indigo-500/40"
                    }`}
                  >
                    {/* Left details */}
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                          <Send className="h-4 w-4" />
                        </div>
                        <h4 className={`text-sm font-bold truncate max-w-sm ${isLight ? "text-slate-900" : "text-white"}`}>
                          {campaign.name}
                        </h4>

                        <StatusBadge status={campaign.status} isLight={isLight} />

                        <span className="text-[11px] text-slate-400">
                          • {formatRelativeTime(campaign.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
                        {/* Channel icons */}
                        <div className="flex items-center gap-2">
                          {campaign.channels.email && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-md">
                              <Mail className="h-3 w-3" /> Email
                            </span>
                          )}
                          {campaign.channels.whatsapp && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                              <WhatsAppLogo className="h-3 w-3 fill-emerald-500" /> WhatsApp
                            </span>
                          )}
                        </div>

                        {/* Counts breakdown */}
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="font-semibold text-slate-400">
                            {campaign.totalMessages} prospects
                          </span>
                          {campaign.pendingCount > 0 && (
                            <span className="text-amber-500 font-bold">
                              {campaign.pendingCount} needs review
                            </span>
                          )}
                          {campaign.approvedCount > 0 && (
                            <span className="text-indigo-500 font-bold">
                              {campaign.approvedCount} approved
                            </span>
                          )}
                          {campaign.sentCount > 0 && (
                            <span className="text-emerald-500 font-bold">
                              {campaign.sentCount} sent
                            </span>
                          )}
                          {campaign.failedCount > 0 && (
                            <span className="text-rose-500 font-bold">
                              {campaign.failedCount} failed
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Delivery Progress Bar (if dispatch has started) */}
                      {deliveryStarted && (
                        <div className="max-w-md pt-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>Delivery Progress: {campaign.sentCount} / {campaign.totalMessages} sent</span>
                            <span className="font-bold text-emerald-500">{percent}%</span>
                          </div>
                          <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? "bg-slate-100" : "bg-slate-800"}`}>
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Action */}
                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveId(campaign.id);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Open & Review</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  isLight,
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: Themed & {
  label: string;
  value: number;
  sub: string;
  icon: any;
  tone: "indigo" | "blue" | "emerald" | "amber" | "neutral";
}) {
  const tones = {
    indigo: isLight ? "border-indigo-100 bg-indigo-50/40 text-indigo-600" : "border-indigo-900/30 bg-indigo-950/20 text-indigo-400",
    blue: isLight ? "border-blue-100 bg-blue-50/40 text-blue-600" : "border-blue-900/30 bg-blue-950/20 text-blue-400",
    emerald: isLight ? "border-emerald-100 bg-emerald-50/40 text-emerald-600" : "border-emerald-900/30 bg-emerald-950/20 text-emerald-400",
    amber: isLight ? "border-amber-100 bg-amber-50/40 text-amber-600" : "border-amber-900/30 bg-amber-950/20 text-amber-400",
    neutral: isLight ? "border-slate-200 bg-white text-slate-600" : "border-slate-800 bg-[#0c111d] text-slate-400",
  };

  return (
    <div
      className={`p-4 rounded-2xl border transition-all ${
        isLight ? "bg-white border-slate-200/90 shadow-sm" : "bg-[#090d16] border-[#1e293b]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">
          {label}
        </span>
        <div className={`p-1.5 rounded-lg shrink-0 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className={`text-2xl font-black ${isLight ? "text-slate-900" : "text-white"}`}>
        {value}
      </div>
      <div className="text-[10px] text-slate-400 mt-1 truncate">
        {sub}
      </div>
    </div>
  );
}

function StatusBadge({ status, isLight }: { status: string; isLight: boolean }) {
  const isRunning = status === "sending";
  const tone = statusTone(status);

  const colors = {
    good: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    warm: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    info: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    bad: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    neutral: isLight ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-slate-900 text-slate-400 border-slate-800",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
        colors[tone]
      }`}
    >
      {isRunning ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      )}
      <span>{labelForStatus(status)}</span>
    </span>
  );
}

function CampaignReview({
  isLight,
  campaignId,
  onBack,
  googleSheetReady,
  smtpReady,
}: Themed & {
  campaignId: string;
  onBack: () => void;
  googleSheetReady: boolean;
  smtpReady: boolean;
}) {
  const t = tokens(isLight);
  const campaign = useAsync<CampaignDetailView>(() => api.get(`/api/campaigns/${campaignId}`), [campaignId]);
  const action = useAction();
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectMessage, setInspectMessage] = useState<CampaignMessageView | null>(null);
  const [isEditingCopy, setIsEditingCopy] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    if (campaign.data?.status !== "sending") return;
    const timer = window.setInterval(campaign.reload, 3_000);
    return () => window.clearInterval(timer);
  }, [campaign.data?.status, campaign.reload]);

  const approveOne = async (messageId: string) => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/messages/${messageId}/approve`),
      "Message approved."
    );
    if (ok) {
      campaign.reload();
      if (inspectMessage?.id === messageId) {
        setInspectMessage((prev) => prev ? { ...prev, status: "approved" } : null);
      }
    }
  };

  const rejectOne = async (messageId: string) => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/messages/${messageId}/reject`),
      "Message rejected."
    );
    if (ok) {
      campaign.reload();
      if (inspectMessage?.id === messageId) {
        setInspectMessage((prev) => prev ? { ...prev, status: "rejected" } : null);
      }
    }
  };

  const approveAll = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/approve-all`),
      "All messages approved. The campaign is ready to start."
    );
    if (ok) campaign.reload();
  };

  const startCampaign = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/execute`),
      "Campaign launched. Messages are dispatching sequentially with 5–7s anti-block pacing."
    );
    if (ok) campaign.reload();
  };

  const cancelCampaign = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/cancel`),
      "Campaign paused. Unsent messages remain queued."
    );
    if (ok) campaign.reload();
  };

  const deleteCampaign = async () => {
    const ok = await action.run(() => api.del(`/api/campaigns/${campaignId}`), "Campaign deleted.");
    if (ok) onBack();
  };

  const handleSaveMessageEdit = async () => {
    if (!inspectMessage) return;
    const updates: { subject?: string; body?: string } = { body: editBody };
    if (inspectMessage.channel === "email") updates.subject = editSubject;

    const ok = await action.run(
      () => api.patch(`/api/campaigns/messages/${inspectMessage.id}`, updates),
      "Message copy updated."
    );
    if (ok) {
      setIsEditingCopy(false);
      setInspectMessage((prev) => prev ? { ...prev, ...updates } : null);
      campaign.reload();
    }
  };

  if (campaign.loading && !campaign.data) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin text-indigo-500" />
        <p className="text-xs text-slate-400">Loading campaign details & messages...</p>
      </div>
    );
  }

  if (campaign.error && !campaign.data) return <ErrorNotice isLight={isLight} error={campaign.error} />;
  if (!campaign.data) return <EmptyState isLight={isLight} icon={AlertCircle} title="Campaign not found" />;

  const data = campaign.data;
  const liveSent = useMemo(() => Math.max(data.sentCount || 0, data.messages.filter((m) => m.status === "sent").length), [data]);
  const liveFailed = useMemo(() => Math.max(data.failedCount || 0, data.messages.filter((m) => m.status === "failed").length), [data]);
  const liveApproved = useMemo(() => data.messages.filter((m) => m.status === "approved" || m.status === "ready" || m.status === "retry_wait" || m.status === "sending").length, [data]);
  const livePending = useMemo(() => data.messages.filter((m) => m.status === "pending_review").length, [data]);
  const totalCount = data.totalMessages || data.messages.length || 0;

  const pending = data.messages.filter((m) => m.status === "pending_review");
  const readyToStart = data.status === "approved" && livePending === 0 && liveApproved > 0;
  const startBlocked = data.channels.email && !smtpReady;

  const filteredMessages = data.messages.filter((m) => {
    const matchesFilter = filter === "all" || m.status === filter;
    const matchesQuery =
      !searchQuery.trim() ||
      m.businessName.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      m.recipient.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      (m.subject && m.subject.toLowerCase().includes(searchQuery.toLowerCase().trim()));
    return matchesFilter && matchesQuery;
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── TOP BREADCRUMB & HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              isLight ? "border-slate-200 hover:bg-slate-50 text-slate-600" : "border-slate-800 hover:bg-slate-850 text-slate-300"
            }`}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Campaigns</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className={`text-lg font-extrabold ${isLight ? "text-slate-900" : "text-white"}`}>
                {data.name}
              </h2>
              <StatusBadge status={data.status} isLight={isLight} />
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Created {formatDate(data.createdAt)} • {data.totalMessages} prospect messages
            </p>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {pending.length > 0 && (
            <button
              onClick={approveAll}
              disabled={action.busy}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Approve All ({pending.length})</span>
            </button>
          )}

          {data.status === "sending" ? (
            <button
              onClick={cancelCampaign}
              disabled={action.busy}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>Stop Campaign</span>
            </button>
          ) : readyToStart && !startBlocked ? (
            <button
              onClick={startCampaign}
              disabled={action.busy}
              className="btn-interactive px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-1.5"
            >
              <Rocket className="h-4 w-4" />
              <span>Launch Campaign</span>
            </button>
          ) : null}

          {data.status !== "sending" && (
            <ConfirmButton
              isLight={isLight}
              icon={Trash2}
              label="Delete"
              itemName={data.name}
              modalTitle="Delete Campaign?"
              busy={action.busy}
              onConfirm={deleteCampaign}
            />
          )}
        </div>
      </div>

      <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
      {action.done && <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>{action.done}</Notice>}

      {/* ── METRIC STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          isLight={isLight}
          label="Total Prospects"
          value={totalCount}
          sub="Materialized copies"
          icon={User}
          tone="indigo"
        />
        <MetricCard
          isLight={isLight}
          label="Needs Review"
          value={livePending}
          sub={livePending > 0 ? "Approval required" : "All approved"}
          icon={Clock3}
          tone={livePending > 0 ? "amber" : "neutral"}
        />
        <MetricCard
          isLight={isLight}
          label="Approved / Ready"
          value={liveApproved}
          sub="Ready for dispatch"
          icon={CheckCircle2}
          tone="emerald"
        />
        <MetricCard
          isLight={isLight}
          label="Dispatched"
          value={liveSent}
          sub={liveFailed > 0 ? `${liveFailed} failed` : "Delivered"}
          icon={Send}
          tone={liveSent > 0 ? "emerald" : "neutral"}
        />
      </div>

      {/* ── CAMPAIGN CONTROLLER HERO BANNER ── */}
      {readyToStart && (
        <div
          className={`p-5 rounded-2xl border transition-all ${
            startBlocked
              ? isLight ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-amber-500/10 border-amber-500/20 text-amber-200"
              : isLight ? "bg-gradient-to-r from-indigo-50/90 to-purple-50/70 border-indigo-200" : "bg-gradient-to-r from-indigo-950/30 to-purple-950/20 border-indigo-800/50"
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/15 text-indigo-500 flex items-center justify-center shrink-0">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <h3 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {startBlocked ? "Integrations Setup Needed Before Launch" : "Campaign Ready for Automated Dispatch"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed max-w-xl">
                  {startBlocked
                    ? "Connect your Google Sheet or SMTP gateway in Integrations to enable automated sending."
                    : `All ${liveApproved} messages are approved. Dispatches will run sequentially with a randomized 5–7s anti-block time gap to protect your email and WhatsApp sender reputation.`}
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {startBlocked ? (
                <a
                  href="/app/integrations"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-all shadow-xs"
                >
                  <span>Open Integrations</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </a>
              ) : (
                <button
                  onClick={startCampaign}
                  disabled={action.busy}
                  className="btn-interactive px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-2 hover:scale-105"
                >
                  <Rocket className="h-4 w-4" />
                  <span>Start Outreach Now</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {data.status === "sending" && (
        <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
          isLight ? "bg-emerald-50/80 border-emerald-200 text-emerald-900" : "bg-emerald-950/20 border-emerald-900/40 text-emerald-300"
        }`}>
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <div>
              <div className="text-xs font-bold">Campaign In Flight (Sending Sequentially)</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Sent {liveSent} of {totalCount} • Auto-refreshes every 3 seconds.
              </div>
            </div>
          </div>

          <button
            onClick={cancelCampaign}
            disabled={action.busy}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all cursor-pointer"
          >
            Pause Campaign
          </button>
        </div>
      )}

      {/* ── MESSAGES REVIEW TABLE & FILTER ── */}
      <div className={`rounded-2xl border transition-all ${
        isLight ? "bg-white border-slate-200/90 shadow-sm" : "bg-[#090d16] border-[#1e293b]"
      }`}>
        {/* Table Toolbar */}
        <div className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 ${
          isLight ? "border-slate-200/80 bg-slate-50/40" : "border-slate-800/80 bg-slate-950/30"
        }`}>
          <div className="flex items-center gap-3 flex-1 max-w-sm">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by company, contact or recipient..."
                className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none font-medium transition-colors ${
                  isLight
                    ? "bg-white border-slate-200 text-slate-900 focus:border-indigo-500"
                    : "bg-slate-950 border-slate-800 text-white focus:border-indigo-400"
                }`}
              />
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1 items-center">
            {MESSAGE_FILTERS.map((item) => {
              const count = item === "all" ? data.messages.length : data.messages.filter((m) => m.status === item).length;
              if (item !== "all" && count === 0) return null;
              return (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                    filter === item
                      ? "bg-indigo-600 text-white shadow-xs"
                      : isLight
                        ? "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        : "bg-slate-900 hover:bg-slate-800 text-slate-400"
                  }`}
                >
                  {labelForStatus(item)} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Messages Table */}
        <div className="overflow-x-auto">
          {filteredMessages.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400">
              No messages found matching your filter criteria.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className={`border-b text-[10px] font-bold uppercase tracking-wider ${
                  isLight ? "bg-slate-50/60 text-slate-500 border-slate-200" : "bg-slate-950/60 text-slate-400 border-slate-800"
                }`}>
                  <th className="px-4 py-3">Lead / Prospect</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Message Preview</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isLight ? "divide-slate-100" : "divide-slate-900"}`}>
                {filteredMessages.map((message) => {
                  const isPending = message.status === "pending_review";
                  return (
                    <tr
                      key={message.id}
                      className={`transition-colors ${
                        isLight ? "hover:bg-slate-50/80" : "hover:bg-slate-900/40"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className={`font-bold text-xs truncate max-w-[200px] ${isLight ? "text-slate-900" : "text-white"}`}>
                          {message.businessName}
                        </div>
                        <div className="text-[10.5px] text-slate-400 truncate max-w-[200px]">
                          {message.recipient}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                          {message.channel === "email" ? (
                            <>
                              <Mail className="h-3.5 w-3.5 text-indigo-500" />
                              <span className={isLight ? "text-slate-700" : "text-slate-300"}>Email</span>
                            </>
                          ) : (
                            <>
                              <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500" />
                              <span className={isLight ? "text-slate-700" : "text-slate-300"}>WhatsApp</span>
                            </>
                          )}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {message.subject && (
                          <div className={`font-semibold text-[11px] truncate max-w-[280px] ${isLight ? "text-slate-800" : "text-slate-200"}`}>
                            {message.subject}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 truncate max-w-[320px] mt-0.5">
                          {message.body}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={message.status} isLight={isLight} />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setInspectMessage(message);
                              setEditSubject(message.subject || "");
                              setEditBody(message.body || "");
                              setIsEditingCopy(false);
                            }}
                            className={`p-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                              isLight ? "border-slate-200 hover:bg-slate-50 text-slate-600" : "border-slate-800 hover:bg-slate-800 text-slate-300"
                            }`}
                            title="Inspect & Preview"
                          >
                            <Eye className="h-3 w-3" />
                            <span>Preview</span>
                          </button>

                          {isPending && (
                            <>
                              <button
                                onClick={() => approveOne(message.id)}
                                disabled={action.busy}
                                className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all cursor-pointer"
                                title="Approve this message"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => rejectOne(message.id)}
                                disabled={action.busy}
                                className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer"
                                title="Reject this message"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── INTERACTIVE MESSAGE PREVIEW & EDIT MODAL / DRAWER ── */}
      {inspectMessage && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fadeIn"
            onMouseDown={() => setInspectMessage(null)}
          >
            <div
              className={`relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
                isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-800 bg-[#090d16] text-white"
              }`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/70 dark:border-slate-800/70">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                    {inspectMessage.channel === "email" ? <Mail className="h-4 w-4" /> : <WhatsAppLogo className="h-4 w-4 fill-emerald-500" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold truncate max-w-md">
                      {inspectMessage.businessName}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Recipient: {inspectMessage.recipient}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <StatusBadge status={inspectMessage.status} isLight={isLight} />
                  <button
                    onClick={() => setInspectMessage(null)}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded-lg"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="py-4 space-y-4">
                {isEditingCopy ? (
                  <div className="space-y-3">
                    {inspectMessage.channel === "email" && (
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          Email Subject
                        </label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium ${
                            isLight ? "bg-slate-50 border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-white"
                          }`}
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Message Content
                      </label>
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={8}
                        className={`w-full p-3 text-xs rounded-xl border outline-none leading-relaxed font-sans ${
                          isLight ? "bg-slate-50 border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-white"
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        onClick={() => setIsEditingCopy(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveMessageEdit}
                        disabled={action.busy}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
                      >
                        Save Copy Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Channel simulated preview card */}
                    {inspectMessage.channel === "email" ? (
                      <div className={`rounded-xl border overflow-hidden ${
                        isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950 border-slate-800"
                      }`}>
                        <div className={`p-3 border-b text-[11px] space-y-1 ${
                          isLight ? "bg-white border-slate-200 text-slate-700" : "bg-[#0c111d] border-slate-800 text-slate-300"
                        }`}>
                          <div>
                            <span className="text-slate-400 font-semibold">To:</span> {inspectMessage.recipient}
                          </div>
                          <div>
                            <span className="text-slate-400 font-semibold">Subject:</span> {inspectMessage.subject || "(No subject)"}
                          </div>
                        </div>
                        <div className="p-4 text-xs leading-relaxed whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300 bg-white dark:bg-[#070b12]">
                          {inspectMessage.body}
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-center p-4 bg-[#efeae2] dark:bg-[#0f172a] rounded-xl border border-slate-200/50">
                        <div className="bg-[#dcf8c6] text-slate-800 text-xs p-3.5 rounded-2xl rounded-tr-none shadow-sm max-w-[85%] whitespace-pre-wrap border border-[#c1e8a4]">
                          {inspectMessage.body}
                          <div className="text-[8px] text-slate-500 text-right mt-1.5">
                            Ready to dispatch ✓✓
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200/70 dark:border-slate-800/70">
                <div>
                  {!isEditingCopy && inspectMessage.status === "pending_review" && (
                    <button
                      onClick={() => setIsEditingCopy(true)}
                      className="px-3 py-1.5 border rounded-xl text-xs font-bold flex items-center gap-1.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Edit Copy</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {inspectMessage.status === "pending_review" && (
                    <>
                      <button
                        onClick={() => rejectOne(inspectMessage.id)}
                        disabled={action.busy}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 border border-rose-500/20 text-xs font-bold transition-all cursor-pointer"
                      >
                        Reject Message
                      </button>
                      <button
                        onClick={() => approveOne(inspectMessage.id)}
                        disabled={action.busy}
                        className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve Copy</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

function CreateCampaignModal({
  isLight,
  googleSheetReady,
  smtpReady,
  readinessLoading,
  readinessError,
  onClose,
  onCreated,
}: Themed & {
  googleSheetReady: boolean;
  smtpReady: boolean;
  readinessLoading: boolean;
  readinessError: unknown;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | "email" | "phone">("all");
  const [emailOn, setEmailOn] = useState(smtpReady);
  const [whatsappOn, setWhatsappOn] = useState(false);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [whatsappTemplateId, setWhatsappTemplateId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ── Anti-block controls ───────────────────────────────────────────────────
  const [shuffleContent, setShuffleContent] = useState(true);
  const [delayMode, setDelayMode] = useState<"auto" | "custom">("auto");
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(60);
  const [pauseEveryMinutes, setPauseEveryMinutes] = useState(5);

  const [targetMode, setTargetMode] = useState<"folders" | "leads">("folders");
  const [folderSearch, setFolderSearch] = useState("");

  const templates = useAsync<OutreachTemplate[]>(() => api.get("/api/templates"));
  const messageTemplates = useAsync<{ ok: boolean; templates: { id: string; name: string; category: string }[] }>(
    () => api.get("/api/message-templates")
  );
  const leads = useAsync<any>(() => api.get("/api/crm/leads"));
  const lists = useAsync<LeadList[]>(() => api.get("/api/crm/lists"));
  const allLeads: any[] = useMemo(() => {
    if (Array.isArray(leads.data)) return leads.data;
    return Array.isArray(leads.data?.leads) ? leads.data.leads : [];
  }, [leads.data]);

  const allFolders: LeadList[] = useMemo(() => {
    if (Array.isArray(lists.data)) return lists.data;
    return [];
  }, [lists.data]);

  // Group leads by folder (listId)
  const folderLeadMap = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const lead of allLeads) {
      const listId = lead.listId || "unassigned";
      const existing = map.get(listId) || [];
      existing.push(lead);
      map.set(listId, existing);
    }
    return map;
  }, [allLeads]);

  const unassignedLeads = useMemo(() => {
    return folderLeadMap.get("unassigned") || [];
  }, [folderLeadMap]);

  const toggleFolder = (folderId: string) => {
    const folderLeads = folderLeadMap.get(folderId) || [];
    const leadIdsInFolder = folderLeads.map((l: any) => l.id).filter(Boolean);
    if (leadIdsInFolder.length === 0) return;

    const allInFolderSelected = leadIdsInFolder.every((id: string) => selectedLeadIds.includes(id));
    if (allInFolderSelected) {
      setSelectedLeadIds((current) => current.filter((id) => !leadIdsInFolder.includes(id)));
    } else {
      setSelectedLeadIds((current) => Array.from(new Set([...current, ...leadIdsInFolder])));
    }
  };

  const handleSelectAllFolders = () => {
    const allIds: string[] = [];
    for (const folder of allFolders) {
      const folderLeads = folderLeadMap.get(folder.id) || [];
      for (const lead of folderLeads) {
        if (lead.id) allIds.push(lead.id);
      }
    }
    for (const lead of unassignedLeads) {
      if (lead.id) allIds.push(lead.id);
    }
    setSelectedLeadIds((current) => Array.from(new Set([...current, ...allIds])));
  };

  const filteredFolders = useMemo(() => {
    const query = folderSearch.toLowerCase().trim();
    if (!query) return allFolders;
    return allFolders.filter((f) =>
      [f.name, f.businessType, f.location].some((val) =>
        String(val || "").toLowerCase().includes(query)
      )
    );
  }, [allFolders, folderSearch]);

  const filteredLeads = useMemo(() => {
    let list = allLeads;
    if (channelFilter === "email") {
      list = list.filter((lead) => leadHasEmail(lead));
    } else if (channelFilter === "phone") {
      list = list.filter((lead) => Boolean(lead.phone));
    }

    const query = leadSearch.toLowerCase().trim();
    if (!query) return list;
    return list.filter((lead) =>
      [lead.businessName, lead.contactName, lead.category, lead.address]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [allLeads, leadSearch, channelFilter]);

  const emailTemplates = (templates.data ?? []).filter((template) => template.templateType === "email");
  const legacyWhatsappTemplates = (templates.data ?? []).filter((template) => template.templateType === "whatsapp");
  const whatsappTemplates: { id: string; name: string; group: "component" | "legacy" }[] = [
    ...((messageTemplates.data?.templates ?? []).map((t) => ({ id: t.id, name: t.name, group: "component" as const }))),
    ...legacyWhatsappTemplates.map((t) => ({ id: t.id, name: t.name, group: "legacy" as const })),
  ];

  // Auto-select first template if available
  useEffect(() => {
    if (!emailTemplateId && emailTemplates.length > 0) {
      setEmailTemplateId(emailTemplates[0].id);
    }
    if (!whatsappTemplateId && whatsappTemplates.length > 0) {
      setWhatsappTemplateId(whatsappTemplates[0].id);
    }
  }, [emailTemplates, whatsappTemplates, emailTemplateId, whatsappTemplateId]);

  const validationIssue = useMemo(() => {
    if (selectedLeadIds.length === 0) {
      return "Select at least one target prospect in Step 2.";
    }
    if (!emailOn && !whatsappOn) {
      return "Enable at least one outreach channel: Email or WhatsApp in Step 3.";
    }
    if (emailOn && !smtpReady) {
      return "SMTP is not configured for Email. Please connect SMTP in Integrations or uncheck Email Channel.";
    }
    if (emailOn && !emailTemplateId) {
      return "Please select an Email template in Step 3.";
    }
    if (whatsappOn && !whatsappTemplateId) {
      return "Please select a WhatsApp template in Step 3.";
    }
    return null;
  }, [selectedLeadIds.length, emailOn, whatsappOn, smtpReady, emailTemplateId, whatsappTemplateId]);

  const toggleLead = (id: string) => {
    setSelectedLeadIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const handleSelectAllVisible = () => {
    const visibleIds = filteredLeads.map((l) => l.id).filter(Boolean);
    setSelectedLeadIds((current) => Array.from(new Set([...current, ...visibleIds])));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (validationIssue) {
      setError(validationIssue);
      return;
    }

    setSubmitting(true);
    try {
      // Delay range: auto uses the server's 10-60s default; custom sends the
      // user's bounds (clamped and ordered).
      const customMin = Math.max(0, Math.min(3600, Math.floor(delayMin)));
      const customMax = Math.max(customMin, Math.min(3600, Math.floor(delayMax)));

      const result = await api.post<{ campaignId: string }>("/api/campaigns", {
        name: name.trim() || undefined,
        sourceType: "manual",
        leadIds: selectedLeadIds,
        channels: { email: emailOn, whatsapp: whatsappOn },
        templateIds: {
          ...(emailOn ? { email: emailTemplateId } : {}),
          ...(whatsappOn ? { whatsapp: whatsappTemplateId } : {}),
        },
        useAi: false,
        // Anti-block settings.
        shuffleContent,
        pauseEveryMinutes: Math.max(0, Math.min(720, Math.floor(pauseEveryMinutes) || 0)),
        ...(delayMode === "custom"
          ? { messageDelayMin: customMin, messageDelayMax: customMax }
          : { messageDelayMin: 10, messageDelayMax: 60 }),
      });
      onCreated(result.campaignId);
    } catch (caught: any) {
      setError(caught?.message || "Failed to create campaign.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fadeIn"
        onMouseDown={onClose}
      >
        <div
          className={`relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border p-6 shadow-2xl ${
            isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-800 bg-[#090d16] text-white"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200/70 dark:border-slate-800/70">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <h2 className="text-base font-bold">Create Outreach Campaign</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Target prospects, assign outreach templates, and materialize personalized copies for review.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="py-4 space-y-5">
            {error && (
              <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs">
                {error}
              </div>
            )}

            {/* Step 1: Campaign Identity */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold flex items-center justify-between text-slate-700 dark:text-slate-200">
                <span>1. Campaign Name</span>
                <span className="text-[10px] text-slate-400 font-normal">Optional (auto-generated if empty)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q4 Local High-Intent Prospects"
                className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium transition-colors ${
                  isLight ? "bg-slate-50 border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-white"
                }`}
              />
            </div>

            {/* Step 2: Select Leads / Folders */}
            <div className={`p-4 rounded-xl border space-y-3 ${
              isLight ? "bg-slate-50/60 border-slate-200" : "bg-slate-950/40 border-slate-800"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <span>2. Select Target Prospects</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                      {selectedLeadIds.length} selected
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">Pick folders directly or fine-tune individual leads from your CRM.</p>
                </div>

                <div className="flex items-center gap-2">
                  {targetMode === "folders" ? (
                    <button
                      type="button"
                      onClick={handleSelectAllFolders}
                      className="text-[10.5px] font-bold text-indigo-500 hover:underline cursor-pointer"
                    >
                      Select All Folders ({allFolders.length})
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSelectAllVisible}
                      className="text-[10.5px] font-bold text-indigo-500 hover:underline cursor-pointer"
                    >
                      Select Visible ({filteredLeads.length})
                    </button>
                  )}
                  {selectedLeadIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedLeadIds([])}
                      className="text-[10.5px] font-bold text-rose-500 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {/* Selection Mode Switcher: Folders vs Individual Leads */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-800 border border-slate-300/40 dark:border-slate-700/60 w-fit">
                <button
                  type="button"
                  onClick={() => setTargetMode("folders")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    targetMode === "folders"
                      ? isLight
                        ? "bg-white text-indigo-600 shadow-xs"
                        : "bg-indigo-600 text-white shadow-xs"
                      : isLight
                        ? "text-slate-600 hover:text-slate-900"
                        : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Folder className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20" />
                  <span>Select by Folder ({allFolders.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode("leads")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    targetMode === "leads"
                      ? isLight
                        ? "bg-white text-indigo-600 shadow-xs"
                        : "bg-indigo-600 text-white shadow-xs"
                      : isLight
                        ? "text-slate-600 hover:text-slate-900"
                        : "text-slate-400 hover:text-white"
                  }`}
                >
                  <User className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Individual Leads ({allLeads.length})</span>
                </button>
              </div>

              {targetMode === "folders" ? (
                <>
                  {/* Folder Search when more than 3 folders */}
                  {allFolders.length > 3 && (
                    <div className="relative w-full">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="search"
                        value={folderSearch}
                        onChange={(e) => setFolderSearch(e.target.value)}
                        placeholder="Search folders by name, category, or location..."
                        className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${
                          isLight ? "bg-white border-slate-200 text-slate-900" : "bg-slate-900 border-slate-800 text-white"
                        }`}
                      />
                    </div>
                  )}

                  {/* Folders List Box */}
                  <div className={`max-h-56 overflow-y-auto rounded-xl border p-2 space-y-2 ${
                    isLight ? "bg-white border-slate-200" : "bg-slate-900 border-slate-800"
                  }`}>
                    {lists.loading || leads.loading ? (
                      <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading lead folders...
                      </div>
                    ) : filteredFolders.length === 0 && unassignedLeads.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                        <p>No lead folders found in your workspace.</p>
                        <button
                          type="button"
                          onClick={() => setTargetMode("leads")}
                          className="text-xs font-semibold text-indigo-500 hover:underline cursor-pointer"
                        >
                          Switch to Individual Leads tab to select leads ({allLeads.length})
                        </button>
                      </div>
                    ) : (
                      <>
                        {filteredFolders.map((folder) => {
                          const folderLeads = folderLeadMap.get(folder.id) || [];
                          const leadCount = folderLeads.length || folder.leadCount || 0;
                          const leadIdsInFolder = folderLeads.map((l: any) => l.id).filter(Boolean);
                          const selectedCount = leadIdsInFolder.filter((id: string) => selectedLeadIds.includes(id)).length;
                          const isAllSelected = leadCount > 0 && selectedCount === leadCount;
                          const isPartiallySelected = selectedCount > 0 && selectedCount < leadCount;

                          return (
                            <div
                              key={folder.id}
                              onClick={() => toggleFolder(folder.id)}
                              className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                                isAllSelected
                                  ? isLight
                                    ? "border-indigo-300 bg-indigo-50/70 shadow-xs"
                                    : "border-indigo-500/50 bg-indigo-500/10 shadow-xs"
                                  : isPartiallySelected
                                    ? isLight
                                      ? "border-amber-300 bg-amber-50/40"
                                      : "border-amber-500/40 bg-amber-500/10"
                                    : isLight
                                      ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                                      : "border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-850"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="shrink-0">
                                  {isAllSelected ? (
                                    <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center">
                                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                                    </div>
                                  ) : isPartiallySelected ? (
                                    <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center">
                                      <span className="w-2.5 h-0.5 bg-white rounded-full" />
                                    </div>
                                  ) : (
                                    <div className={`w-5 h-5 rounded-md border ${
                                      isLight ? "border-slate-300 bg-white" : "border-slate-700 bg-slate-800"
                                    }`} />
                                  )}
                                </div>

                                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                                  <FolderOpen className="h-4 w-4" />
                                </div>

                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">
                                    <span>{folder.name}</span>
                                  </div>
                                  <div className="text-[10.5px] text-slate-400 truncate mt-0.5">
                                    {folder.businessType || "General"} {folder.location ? `• ${folder.location}` : ""}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold border transition-colors ${
                                  isAllSelected
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : isPartiallySelected
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                      : isLight
                                        ? "bg-slate-100 text-slate-500 border-slate-200"
                                        : "bg-slate-800 text-slate-400 border-slate-700"
                                }`}>
                                  {isAllSelected
                                    ? `All ${leadCount} selected`
                                    : isPartiallySelected
                                      ? `${selectedCount} / ${leadCount} selected`
                                      : `${leadCount} leads`}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {unassignedLeads.length > 0 && (
                          <div
                            onClick={() => toggleFolder("unassigned")}
                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                              unassignedLeads.every((l: any) => selectedLeadIds.includes(l.id))
                                ? isLight
                                  ? "border-indigo-300 bg-indigo-50/70 shadow-xs"
                                  : "border-indigo-500/50 bg-indigo-500/10 shadow-xs"
                                : isLight
                                  ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                                  : "border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-850"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="shrink-0">
                                {unassignedLeads.every((l: any) => selectedLeadIds.includes(l.id)) ? (
                                  <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center">
                                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                                  </div>
                                ) : (
                                  <div className={`w-5 h-5 rounded-md border ${
                                    isLight ? "border-slate-300 bg-white" : "border-slate-700 bg-slate-800"
                                  }`} />
                                )}
                              </div>
                              <div className="p-2 rounded-lg bg-slate-500/10 text-slate-400 shrink-0">
                                <Folder className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Other / Uncategorized Leads</div>
                                <div className="text-[10.5px] text-slate-400">Leads not assigned to a folder</div>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold border bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700">
                              {unassignedLeads.length} leads
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Search & Channel Filters for Individual Leads */}
                  <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="relative flex-1 w-full">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="search"
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        placeholder="Search by company, category, contact, or city..."
                        className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${
                          isLight ? "bg-white border-slate-200 text-slate-900" : "bg-slate-900 border-slate-800 text-white"
                        }`}
                      />
                    </div>

                    <div className="flex items-center gap-1 shrink-0 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setChannelFilter("all")}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                          channelFilter === "all" ? "bg-indigo-600 text-white border-indigo-600" : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                        }`}
                      >
                        All ({allLeads.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setChannelFilter("email")}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                          channelFilter === "email" ? "bg-indigo-600 text-white border-indigo-600" : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                        }`}
                      >
                        Has Email
                      </button>
                      <button
                        type="button"
                        onClick={() => setChannelFilter("phone")}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                          channelFilter === "phone" ? "bg-indigo-600 text-white border-indigo-600" : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                        }`}
                      >
                        Has Phone
                      </button>
                    </div>
                  </div>

                  {/* Leads List Box */}
                  <div className={`max-h-52 overflow-y-auto rounded-xl border ${
                    isLight ? "bg-white border-slate-200" : "bg-slate-900 border-slate-800"
                  }`}>
                    {leads.loading ? (
                      <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading leads...
                      </div>
                    ) : filteredLeads.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        No leads found matching your criteria.
                      </div>
                    ) : (
                      filteredLeads.map((lead) => {
                        const isSelected = selectedLeadIds.includes(lead.id);
                        return (
                          <label
                            key={lead.id}
                            className={`p-2.5 border-b last:border-b-0 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                              isSelected
                                ? isLight ? "bg-indigo-50/80" : "bg-indigo-500/10"
                                : isLight ? "hover:bg-slate-50" : "hover:bg-slate-850"
                            } ${isLight ? "border-slate-100" : "border-slate-800/60"}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleLead(lead.id)}
                                className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                  {lead.businessName}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">
                                  {lead.contactName || "Owner"} • {lead.category || "General"} {lead.address ? `• ${lead.address}` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {leadHasEmail(lead) && (
                                <span className="p-1 rounded bg-indigo-500/10 text-indigo-500" title="Has Email">
                                  <Mail className="h-3 w-3" />
                                </span>
                              )}
                              {lead.phone && (
                                <span className="p-1 rounded bg-emerald-500/10 text-emerald-500" title="Has Phone">
                                  <WhatsAppLogo className="h-3 w-3 fill-emerald-500" />
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Step 3: Channels & Templates */}
            <div className={`p-4 rounded-xl border space-y-3 ${
              isLight ? "bg-slate-50/60 border-slate-200" : "bg-slate-950/40 border-slate-800"
            }`}>
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  3. Outreach Channels & Templates
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Select which channels to materialize messages for, and assign reviewed outreach templates.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {/* Email Channel Card */}
                <div className={`p-3.5 rounded-xl border transition-all ${
                  emailOn
                    ? isLight ? "bg-white border-indigo-300 shadow-xs" : "bg-slate-900 border-indigo-500/40"
                    : isLight ? "bg-white/60 border-slate-200 opacity-70" : "bg-slate-900/60 border-slate-800 opacity-70"
                }`}>
                  <label className="flex items-center justify-between cursor-pointer mb-2">
                    <span className="flex items-center gap-2 text-xs font-bold">
                      <Mail className="h-4 w-4 text-indigo-500" />
                      <span>Email Channel</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={emailOn}
                      onChange={(e) => setEmailOn(e.target.checked)}
                      disabled={!smtpReady}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                  </label>

                  {emailOn && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        Assign Email Template:
                      </label>
                      <select
                        value={emailTemplateId}
                        onChange={(e) => setEmailTemplateId(e.target.value)}
                        className={`w-full p-2 text-xs rounded-lg border outline-none font-medium ${
                          isLight ? "bg-white border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-white"
                        }`}
                      >
                        <option value="">Select an email template...</option>
                        {emailTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      {emailTemplates.length === 0 && (
                        <p className="text-[10px] text-rose-500">
                          No email templates found. Create one in Templates first.
                        </p>
                      )}
                    </div>
                  )}

                  {!smtpReady && (
                    <p className="text-[10px] font-semibold text-amber-500 mt-1">
                      SMTP gateway required. Connect in Integrations.
                    </p>
                  )}
                </div>

                {/* WhatsApp Channel Card */}
                <div className={`p-3.5 rounded-xl border transition-all ${
                  whatsappOn
                    ? isLight ? "bg-white border-emerald-300 shadow-xs" : "bg-slate-900 border-emerald-500/40"
                    : isLight ? "bg-white/60 border-slate-200 opacity-70" : "bg-slate-900/60 border-slate-800 opacity-70"
                }`}>
                  <label className="flex items-center justify-between cursor-pointer mb-2">
                    <span className="flex items-center gap-2 text-xs font-bold">
                      <WhatsAppLogo className="h-4 w-4 fill-emerald-500" />
                      <span>WhatsApp Channel</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={whatsappOn}
                      onChange={(e) => setWhatsappOn(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                    />
                  </label>

                  {whatsappOn && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        Assign WhatsApp Template:
                      </label>
                      <select
                        value={whatsappTemplateId}
                        onChange={(e) => setWhatsappTemplateId(e.target.value)}
                        className={`w-full p-2 text-xs rounded-lg border outline-none font-medium ${
                          isLight ? "bg-white border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-white"
                        }`}
                      >
                        <option value="">Select a WhatsApp template...</option>
                        {whatsappTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      {whatsappTemplates.length === 0 && (
                        <p className="text-[10px] text-rose-500">
                          No WhatsApp templates found. Create one in Templates first.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 4: Anti-Block Settings */}
            <div className={`p-4 rounded-xl border space-y-3.5 ${
              isLight ? "bg-slate-50/60 border-slate-200" : "bg-slate-950/40 border-slate-800"
            }`}>
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> 4. Anti-Block Protection
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Spread sends out and vary wording so bulk outreach isn't flagged as spam.
                </p>
              </div>

              {/* AI content shuffle */}
              <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                shuffleContent
                  ? isLight ? "bg-white border-emerald-300" : "bg-slate-900 border-emerald-500/40"
                  : isLight ? "bg-white/60 border-slate-200" : "bg-slate-900/60 border-slate-800"
              }`}>
                <input type="checkbox" checked={shuffleContent} onChange={(e) => setShuffleContent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" /> AI content shuffle
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                    Each message is lightly reworded by AI at send time — same offer and links, different wording — so no two are identical. Falls back to the original text if AI is unavailable.
                  </span>
                </span>
              </label>

              {/* Delay between messages */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Delay between messages</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => setDelayMode("auto")} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                    delayMode === "auto"
                      ? isLight ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                      : isLight ? "bg-white border-slate-200 text-slate-600" : "bg-slate-900 border-slate-800 text-slate-400"
                  }`}>Auto (10–60s)</button>
                  <button type="button" onClick={() => setDelayMode("custom")} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                    delayMode === "custom"
                      ? isLight ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                      : isLight ? "bg-white border-slate-200 text-slate-600" : "bg-slate-900 border-slate-800 text-slate-400"
                  }`}>Custom</button>
                  {delayMode === "custom" && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <input type="number" min={0} max={3600} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} className={`w-16 p-1.5 rounded-lg border text-center ${isLight ? "bg-white border-slate-200" : "bg-slate-950 border-slate-800 text-white"}`} />
                      <span className="text-slate-400">to</span>
                      <input type="number" min={0} max={3600} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} className={`w-16 p-1.5 rounded-lg border text-center ${isLight ? "bg-white border-slate-200" : "bg-slate-950 border-slate-800 text-white"}`} />
                      <span className="text-slate-400">seconds</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Pause every N minutes */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Pause to cool down</div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-500">Pause 1 minute after every</span>
                  <input type="number" min={0} max={720} value={pauseEveryMinutes} onChange={(e) => setPauseEveryMinutes(Number(e.target.value))} className={`w-16 p-1.5 rounded-lg border text-center ${isLight ? "bg-white border-slate-200" : "bg-slate-950 border-slate-800 text-white"}`} />
                  <span className="text-slate-500">minutes of sending</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Set to 0 to disable the cool-down pause.</p>
              </div>

              <div className={`flex items-center justify-between gap-3 pt-2 border-t text-xs ${isLight ? "border-slate-200" : "border-slate-800"}`}>
                <div className="flex items-center gap-2 text-slate-500">
                  <Clock3 className="h-3.5 w-3.5 shrink-0" />
                  <span>Messages dispatched one at a time, rotating across every connected sender.</span>
                </div>
                <div className="font-bold text-right shrink-0 text-indigo-500">
                  {selectedLeadIds.length * ((emailOn ? 1 : 0) + (whatsappOn ? 1 : 0))} Messages
                </div>
              </div>
            </div>

            {/* Live requirement warning if anything is missing */}
            {validationIssue && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <span>{validationIssue}</span>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/70 dark:border-slate-800/70">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-interactive px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span>{submitting ? "Creating Campaign..." : "Create Campaign for Review"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
