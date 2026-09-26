/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reviewed campaign workspace.
 *
 * One deliberate path replaces the old, competing "Review" and "Generate"
 * experiences:
 *   1. Create — choose leads by name, channels and reviewed templates.
 *   2. Review — edit, approve or reject every materialized message.
 *   3. Start — explicitly confirm a fully approved campaign.
 *   4. Track — keep every queued, sent, failed and suppressed message visible.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { OutreachTemplate } from "../outreachTemplates";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Edit3,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
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
    pending_review: "Needs review",
    partially_approved: "Review in progress",
    approved: "Ready to start",
    sending: "Sending",
    retry_wait: "Retry waiting",
    sent: "Completed",
    failed: "Failed",
    rejected: "Rejected",
    suppressed: "Suppressed",
    cancelled: "Cancelled",
    all: "All",
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
    <div className="space-y-4">
      <div
        className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
          isLight
            ? "border-slate-200 bg-white shadow-sm"
            : "border-slate-800 bg-slate-950/55 shadow-lg"
        }`}
      >
        <div>
          <div className={`flex items-center gap-2 text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
            <Send className="h-4 w-4 text-indigo-500" />
            Campaign workspace
          </div>
          <p className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-slate-400"}`}>
            Create a campaign, review every message, then start paced multichannel outreach.
          </p>
        </div>
        <Button
          isLight={isLight}
          variant="primary"
          icon={Plus}
          onClick={() => setCreateModalOpen(true)}
          className="shrink-0 px-4 py-2"
        >
          Create Campaign
        </Button>
      </div>

      <IntegrationReadiness
        isLight={isLight}
        loading={integrations.loading}
        error={integrations.error}
        googleSheet={googleSheet}
        smtp={smtp}
        onRetry={integrations.reload}
      />

      <CampaignWorkspace
        isLight={isLight}
        onOpenCreate={() => setCreateModalOpen(true)}
        externalActiveId={createdCampaignId}
        onClearExternalActiveId={() => setCreatedCampaignId(null)}
        googleSheetReady={Boolean(googleSheet)}
        smtpReady={Boolean(smtp)}
      />

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

function IntegrationReadiness({
  isLight,
  loading,
  error,
  googleSheet,
  smtp,
  onRetry,
}: Themed & {
  loading: boolean;
  error: unknown;
  googleSheet?: IntegrationSummary;
  smtp?: IntegrationSummary;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
        isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-800 bg-slate-950/40 text-slate-400"
      }`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking campaign integrations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <ErrorNotice isLight={isLight} error={error} />
        <Button isLight={isLight} variant="secondary" onClick={onRetry}>Retry integration check</Button>
      </div>
    );
  }

  if (googleSheet && smtp) {
    return (
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-3.5 py-2.5 text-xs ${
        isLight
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      }`}>
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Google Sheets connected
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> SMTP connected
        </span>
        <span className={isLight ? "text-emerald-700" : "text-emerald-300/80"}>
          Campaign delivery is ready.
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {!googleSheet && (
        <ReadinessAlert
          isLight={isLight}
          title="Google Sheet not connected"
          description="Outreach status sync uses only your connected workspace Google Sheet. No default server sheet is used."
          action="Connect Google Sheet in Integrations"
        />
      )}
      {!smtp && (
        <ReadinessAlert
          isLight={isLight}
          title="SMTP email is not configured"
          description="Email campaigns cannot start until this workspace has an enabled SMTP connection."
          action="Configure SMTP in Integrations"
        />
      )}
    </div>
  );
}

function ReadinessAlert({
  isLight,
  title,
  description,
  action,
}: Themed & { title: string; description: string; action: string }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${
      isLight
        ? "border-red-300 bg-red-50 text-red-950 shadow-sm"
        : "border-rose-500/35 bg-rose-500/10 text-rose-100"
    }`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${isLight ? "text-red-700" : "text-rose-400"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">{title}</p>
          <p className={`mt-1 text-[11px] leading-relaxed ${isLight ? "text-red-800" : "text-rose-200/80"}`}>
            {description}
          </p>
          <a
            href="/app/integrations"
            className={`mt-2 inline-flex items-center gap-1 text-[11px] font-bold underline-offset-2 hover:underline ${
              isLight ? "text-red-800" : "text-rose-300"
            }`}
          >
            {action} <ChevronRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
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

  return (
    <Card
      isLight={isLight}
      title="Campaigns"
      subtitle="Review status, delivery progress and results in one place."
      icon={Send}
      actions={
        <Button isLight={isLight} variant="ghost" onClick={campaigns.reload}>
          Refresh
        </Button>
      }
    >
      {campaigns.loading ? (
        <Spinner isLight={isLight} />
      ) : campaigns.error ? (
        <ErrorNotice isLight={isLight} error={campaigns.error} />
      ) : (campaigns.data ?? []).length === 0 ? (
        <EmptyState
          isLight={isLight}
          icon={Send}
          title="No campaigns yet"
          action={
            <Button isLight={isLight} variant="primary" icon={Plus} onClick={onOpenCreate}>
              Create your first campaign
            </Button>
          }
        >
          Create a campaign, review its messages, approve the final copy, then start outreach.
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className={`text-[10px] font-bold uppercase tracking-wider ${t.faint}`}>
                  <th className={`border-b px-3 py-2.5 ${t.border}`}>Campaign</th>
                  <th className={`border-b px-3 py-2.5 ${t.border}`}>Channels</th>
                  <th className={`border-b px-3 py-2.5 ${t.border}`}>Status</th>
                  <th className={`border-b px-3 py-2.5 ${t.border}`}>Messages</th>
                  <th className={`border-b px-3 py-2.5 ${t.border}`}>Created</th>
                  <th className={`border-b px-3 py-2.5 text-right ${t.border}`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {(campaigns.data ?? []).map((campaign) => (
                  <tr key={campaign.id} className={isLight ? "hover:bg-slate-50" : "hover:bg-slate-900/50"}>
                    <td className={`border-b px-3 py-3 ${t.border}`}>
                      <button
                        type="button"
                        onClick={() => setActiveId(campaign.id)}
                        className={`max-w-[230px] truncate text-left text-xs font-bold hover:text-indigo-500 ${t.heading}`}
                      >
                        {campaign.name}
                      </button>
                    </td>
                    <td className={`border-b px-3 py-3 ${t.border}`}>
                      <ChannelIcons campaign={campaign} isLight={isLight} />
                    </td>
                    <td className={`border-b px-3 py-3 ${t.border}`}>
                      <Badge isLight={isLight} tone={statusTone(campaign.status)} dot>
                        {labelForStatus(campaign.status)}
                      </Badge>
                    </td>
                    <td className={`border-b px-3 py-3 ${t.border}`}>
                      <CampaignCounts campaign={campaign} isLight={isLight} />
                    </td>
                    <td className={`border-b px-3 py-3 text-[11px] ${t.muted} ${t.border}`}>
                      {formatDate(campaign.createdAt)}
                    </td>
                    <td className={`border-b px-3 py-3 text-right ${t.border}`}>
                      <Button isLight={isLight} variant="ghost" icon={Eye} onClick={() => setActiveId(campaign.id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 md:hidden">
            {(campaigns.data ?? []).map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setActiveId(campaign.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${t.inset} ${
                  isLight ? "hover:border-indigo-300" : "hover:border-indigo-500/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-xs font-bold ${t.heading}`}>{campaign.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge isLight={isLight} tone={statusTone(campaign.status)} dot>
                        {labelForStatus(campaign.status)}
                      </Badge>
                      <ChannelIcons campaign={campaign} isLight={isLight} />
                    </div>
                  </div>
                  <ChevronRight className={`h-4 w-4 shrink-0 ${t.faint}`} />
                </div>
                <div className="mt-3">
                  <CampaignCounts campaign={campaign} isLight={isLight} />
                </div>
                <p className={`mt-2 text-[10px] ${t.faint}`}>{formatDate(campaign.createdAt)}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function ChannelIcons({ campaign, isLight }: { campaign: CampaignView; isLight: boolean }) {
  const t = tokens(isLight);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {campaign.channels.email && (
        <span className={`inline-flex items-center gap-1 ${t.muted}`}><Mail className="h-3 w-3 text-indigo-500" /> Email</span>
      )}
      {campaign.channels.whatsapp && (
        <span className={`inline-flex items-center gap-1 ${t.muted}`}><MessageSquare className="h-3 w-3 text-emerald-500" /> WhatsApp</span>
      )}
    </div>
  );
}

function CampaignCounts({ campaign, isLight }: { campaign: CampaignView; isLight: boolean }) {
  const t = tokens(isLight);
  const deliveryStarted = campaign.status === "sending" || campaign.status === "sent";
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[10px] ${t.muted}`}>
      <span>{campaign.totalMessages} total</span>
      {deliveryStarted ? (
        <>
          <span className="font-semibold text-emerald-600">{campaign.sentCount} sent</span>
          {campaign.failedCount > 0 && <span className="font-semibold text-rose-600">{campaign.failedCount} failed</span>}
        </>
      ) : (
        <>
          {campaign.pendingCount > 0 && <span className="font-semibold text-amber-600">{campaign.pendingCount} pending</span>}
          {campaign.approvedCount > 0 && <span className="font-semibold text-indigo-600">{campaign.approvedCount} approved</span>}
          {campaign.rejectedCount > 0 && <span className="font-semibold text-rose-600">{campaign.rejectedCount} rejected</span>}
        </>
      )}
    </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    if (ok) campaign.reload();
  };

  const rejectOne = async (messageId: string) => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/messages/${messageId}/reject`),
      "Message rejected."
    );
    if (ok) campaign.reload();
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
      "Campaign started. Messages will be sent sequentially with a protected time gap."
    );
    if (ok) campaign.reload();
  };

  const cancelCampaign = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/cancel`),
      "Campaign stop requested. No new message will be claimed."
    );
    if (ok) campaign.reload();
  };

  const deleteCampaign = async () => {
    const ok = await action.run(() => api.del(`/api/campaigns/${campaignId}`), "Campaign deleted.");
    if (ok) onBack();
  };

  if (campaign.loading && !campaign.data) return <Spinner isLight={isLight} />;
  if (campaign.error && !campaign.data) return <ErrorNotice isLight={isLight} error={campaign.error} />;
  if (!campaign.data) return <EmptyState isLight={isLight} icon={AlertCircle} title="Campaign not found" />;

  const data = campaign.data;
  const pending = data.messages.filter((message) => message.status === "pending_review");
  const readyToStart = data.status === "approved" && data.pendingCount === 0 && data.approvedCount > 0;
  const startBlocked = !googleSheetReady || (data.channels.email && !smtpReady);
  const filteredMessages = filter === "all"
    ? data.messages
    : data.messages.filter((message) => message.status === filter);

  return (
    <div className="space-y-4">
      <Card
        isLight={isLight}
        title={data.name}
        subtitle={`Created ${formatDate(data.createdAt)}`}
        icon={Send}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button isLight={isLight} variant="ghost" icon={X} onClick={onBack}>Back</Button>
            {data.status !== "sending" && (
              <ConfirmButton
                isLight={isLight}
                icon={Trash2}
                label="Delete"
                busy={action.busy}
                onConfirm={deleteCampaign}
              />
            )}
            {pending.length > 0 && (
              <Button isLight={isLight} variant="primary" icon={CheckCircle2} busy={action.busy} onClick={approveAll}>
                Approve all ({pending.length})
              </Button>
            )}
            {data.status === "sending" && (
              <Button isLight={isLight} variant="danger" icon={XCircle} busy={action.busy} onClick={cancelCampaign}>
                Stop campaign
              </Button>
            )}
          </div>
        }
      >
        <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
        {action.done && <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>{action.done}</Notice>}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <SummaryStat isLight={isLight} label="Total" value={data.totalMessages} />
          <SummaryStat isLight={isLight} label="Needs review" value={data.pendingCount} tone="amber" />
          <SummaryStat isLight={isLight} label={data.status === "sending" || data.status === "sent" ? "Sent" : "Approved"} value={data.status === "sending" || data.status === "sent" ? data.sentCount : data.approvedCount} tone="good" />
          <SummaryStat isLight={isLight} label="Failed / rejected" value={data.failedCount + data.rejectedCount} tone="bad" />
        </div>

        {readyToStart && (
          <div className={`mt-4 rounded-xl border p-4 ${
            startBlocked
              ? isLight ? "border-red-300 bg-red-50" : "border-rose-500/35 bg-rose-500/10"
              : isLight ? "border-emerald-300 bg-emerald-50" : "border-emerald-500/30 bg-emerald-500/10"
          }`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                {startBlocked ? (
                  <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${isLight ? "text-red-700" : "text-rose-400"}`} />
                ) : (
                  <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${isLight ? "text-emerald-700" : "text-emerald-400"}`} />
                )}
                <div>
                  <p className={`text-sm font-bold ${
                    startBlocked
                      ? isLight ? "text-red-950" : "text-rose-100"
                      : isLight ? "text-emerald-950" : "text-emerald-100"
                  }`}>
                    {startBlocked ? "Connect required integrations before starting" : "Campaign approved. Start it now?"}
                  </p>
                  <p className={`mt-1 text-[11px] leading-relaxed ${
                    startBlocked
                      ? isLight ? "text-red-800" : "text-rose-200/80"
                      : isLight ? "text-emerald-800" : "text-emerald-200/80"
                  }`}>
                    {startBlocked
                      ? "Google Sheets is required for workspace sync, and email campaigns also require SMTP."
                      : `${data.approvedCount} approved messages will be sent one at a time with a randomized 5–7 second anti-block gap.`}
                  </p>
                </div>
              </div>
              {startBlocked ? (
                <a href="/app/integrations" className={`shrink-0 text-xs font-bold hover:underline ${isLight ? "text-red-800" : "text-rose-300"}`}>
                  Open Integrations
                </a>
              ) : (
                <Button isLight={isLight} variant="primary" icon={Play} busy={action.busy} onClick={startCampaign} className="shrink-0 px-4 py-2">
                  Start Campaign
                </Button>
              )}
            </div>
          </div>
        )}

        {data.status === "partially_approved" && (
          <Notice isLight={isLight} tone="warn" title="Finish the review before starting">
            Decide the remaining {data.pendingCount} message{data.pendingCount === 1 ? "" : "s"}. Start becomes available only after every message is approved or rejected.
          </Notice>
        )}

        {data.status === "sending" && (
          <Notice isLight={isLight} tone="info" title="Campaign is running">
            Approved messages are sent sequentially. This view refreshes every three seconds; you can safely leave and return later.
          </Notice>
        )}

        {data.status === "sent" && (
          <Notice isLight={isLight} tone={data.failedCount > 0 ? "warn" : "success"} title="Campaign completed">
            {data.sentCount} sent, {data.failedCount} failed and {data.rejectedCount} rejected. Open a message row for details.
          </Notice>
        )}

        <div className={`mt-4 border-t pt-4 ${t.border}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className={`text-xs font-bold ${t.heading}`}>Messages</h3>
              <p className={`mt-0.5 text-[10px] ${t.faint}`}>Every review and delivery state remains visible.</p>
            </div>
            <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
              {MESSAGE_FILTERS.map((item) => {
                const count = item === "all" ? data.messages.length : data.messages.filter((message) => message.status === item).length;
                if (item !== "all" && count === 0) return null;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                      filter === item
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : isLight
                          ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          : "border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900"
                    }`}
                  >
                    {labelForStatus(item)} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {filteredMessages.length === 0 ? (
            <EmptyState isLight={isLight} icon={MessageSquare} title="No messages in this view" />
          ) : (
            <div className={`overflow-hidden rounded-xl border ${t.border}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left">
                  <thead className={isLight ? "bg-slate-50" : "bg-slate-950/80"}>
                    <tr className={`text-[10px] font-bold uppercase tracking-wider ${t.faint}`}>
                      <th className="px-3 py-2.5">Lead</th>
                      <th className="px-3 py-2.5">Channel</th>
                      <th className="px-3 py-2.5">Message</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMessages.map((message) => {
                      const expanded = expandedId === message.id;
                      const editing = editingId === message.id;
                      return (
                        <React.Fragment key={message.id}>
                          <tr className={`border-t ${t.border} ${isLight ? "hover:bg-slate-50/80" : "hover:bg-slate-900/40"}`}>
                            <td className="px-3 py-3">
                              <p className={`max-w-[170px] truncate text-xs font-semibold ${t.heading}`}>{message.businessName}</p>
                              <p className={`mt-0.5 max-w-[190px] truncate text-[10px] ${t.faint}`}>{message.recipient}</p>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex items-center gap-1 text-[11px] ${t.muted}`}>
                                {message.channel === "email" ? <Mail className="h-3 w-3 text-indigo-500" /> : <MessageSquare className="h-3 w-3 text-emerald-500" />}
                                {message.channel === "email" ? "Email" : "WhatsApp"}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              {message.subject && <p className={`max-w-[260px] truncate text-[11px] font-semibold ${t.body}`}>{message.subject}</p>}
                              <p className={`max-w-[300px] truncate text-[10px] ${t.faint}`}>{message.body}</p>
                            </td>
                            <td className="px-3 py-3">
                              <Badge isLight={isLight} tone={statusTone(message.status)} dot>{labelForStatus(message.status)}</Badge>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button isLight={isLight} variant="ghost" icon={expanded ? ChevronDown : Eye} onClick={() => setExpandedId(expanded ? null : message.id)}>
                                  {expanded ? "Close" : "View"}
                                </Button>
                                {message.status === "pending_review" && (
                                  <>
                                    <Button isLight={isLight} variant="ghost" icon={Edit3} onClick={() => { setEditingId(message.id); setExpandedId(message.id); }}>
                                      Edit
                                    </Button>
                                    <Button isLight={isLight} variant="ghost" icon={CheckCircle2} busy={action.busy} onClick={() => approveOne(message.id)}>
                                      Approve
                                    </Button>
                                    <Button isLight={isLight} variant="danger" icon={XCircle} busy={action.busy} onClick={() => rejectOne(message.id)}>
                                      Reject
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className={`border-t ${t.border} ${isLight ? "bg-slate-50/70" : "bg-slate-950/50"}`}>
                              <td colSpan={5} className="px-4 py-4">
                                {editing ? (
                                  <MessageEditor
                                    isLight={isLight}
                                    message={message}
                                    busy={action.busy}
                                    onCancel={() => setEditingId(null)}
                                    onSave={async (updates) => {
                                      const ok = await action.run(
                                        () => api.patch(`/api/campaigns/messages/${message.id}`, updates),
                                        "Message updated."
                                      );
                                      if (ok) {
                                        setEditingId(null);
                                        campaign.reload();
                                      }
                                    }}
                                  />
                                ) : (
                                  <div className="space-y-3">
                                    {message.subject && (
                                      <div>
                                        <p className={`text-[10px] font-bold uppercase tracking-wider ${t.faint}`}>Subject</p>
                                        <p className={`mt-1 text-xs ${t.body}`}>{message.subject}</p>
                                      </div>
                                    )}
                                    <div>
                                      <p className={`text-[10px] font-bold uppercase tracking-wider ${t.faint}`}>Message</p>
                                      <p className={`mt-1 whitespace-pre-wrap text-xs leading-relaxed ${t.body}`}>{message.body}</p>
                                    </div>
                                    {message.rejectionReason && <Notice isLight={isLight} tone="warn" title="Rejection reason">{message.rejectionReason}</Notice>}
                                    {message.errorMessage && <Notice isLight={isLight} tone="error" title="Delivery error">{message.errorMessage}</Notice>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function SummaryStat({
  isLight,
  label,
  value,
  tone = "neutral",
}: Themed & { label: string; value: number; tone?: "neutral" | "amber" | "good" | "bad" }) {
  const palette = {
    neutral: isLight ? "border-slate-200 bg-slate-50 text-slate-900" : "border-slate-800 bg-slate-950/50 text-white",
    amber: isLight ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-500/25 bg-amber-500/10 text-amber-200",
    good: isLight ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    bad: isLight ? "border-rose-200 bg-rose-50 text-rose-900" : "border-rose-500/25 bg-rose-500/10 text-rose-200",
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${palette[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

function MessageEditor({
  isLight,
  message,
  busy,
  onCancel,
  onSave,
}: Themed & {
  message: CampaignMessageView;
  busy: boolean;
  onCancel: () => void;
  onSave: (updates: { subject?: string; body?: string }) => Promise<void>;
}) {
  const [subject, setSubject] = useState(message.subject || "");
  const [body, setBody] = useState(message.body);

  return (
    <div className="space-y-3">
      {message.channel === "email" && (
        <Field isLight={isLight} label="Subject">
          <TextInput isLight={isLight} value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
      )}
      <Field isLight={isLight} label="Message">
        <TextArea isLight={isLight} rows={7} value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          isLight={isLight}
          variant="primary"
          icon={Check}
          busy={busy}
          onClick={() => onSave({ ...(message.channel === "email" ? { subject } : {}), body })}
        >
          Save changes
        </Button>
        <Button isLight={isLight} variant="ghost" icon={X} onClick={onCancel}>Cancel</Button>
      </div>
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
  const [emailOn, setEmailOn] = useState(smtpReady);
  const [whatsappOn, setWhatsappOn] = useState(false);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [whatsappTemplateId, setWhatsappTemplateId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const templates = useAsync<OutreachTemplate[]>(() => api.get("/api/templates"));
  const leads = useAsync<any>(() => api.get("/api/crm/leads"));
  const allLeads: any[] = useMemo(() => {
    if (Array.isArray(leads.data)) return leads.data;
    return Array.isArray(leads.data?.leads) ? leads.data.leads : [];
  }, [leads.data]);

  const filteredLeads = useMemo(() => {
    const query = leadSearch.toLowerCase().trim();
    if (!query) return allLeads;
    return allLeads.filter((lead) =>
      [lead.businessName, lead.contactName, lead.category, lead.address]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [allLeads, leadSearch]);

  const emailTemplates = (templates.data ?? []).filter((template) => template.templateType === "email");
  const whatsappTemplates = (templates.data ?? []).filter((template) => template.templateType === "whatsapp");
  const canSubmit =
    !submitting &&
    !readinessLoading &&
    !readinessError &&
    googleSheetReady &&
    selectedLeadIds.length > 0 &&
    (emailOn || whatsappOn) &&
    (!emailOn || (smtpReady && Boolean(emailTemplateId))) &&
    (!whatsappOn || Boolean(whatsappTemplateId));

  const toggleLead = (id: string) => {
    setSelectedLeadIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!googleSheetReady) return setError("Connect this workspace to Google Sheets before creating a campaign.");
    if (!emailOn && !whatsappOn) return setError("Enable at least one outreach channel.");
    if (emailOn && !smtpReady) return setError("Configure SMTP before adding email to a campaign.");
    if (selectedLeadIds.length === 0) return setError("Select at least one lead by name.");
    if (emailOn && !emailTemplateId) return setError("Choose an email template.");
    if (whatsappOn && !whatsappTemplateId) return setError("Choose a WhatsApp template.");

    setSubmitting(true);
    try {
      const result = await api.post<{ campaignId: string }>("/api/campaigns", {
        name: name.trim() || undefined,
        sourceType: "manual",
        leadIds: selectedLeadIds,
        channels: { email: emailOn, whatsapp: whatsappOn },
        templateIds: {
          ...(emailOn ? { email: emailTemplateId } : {}),
          ...(whatsappOn ? { whatsapp: whatsappTemplateId } : {}),
        },
        // The retired AI-generation toggle must not silently survive in the
        // new modal. Templates are materialized for review; templates that need
        // fallback body copy use deterministic rule-based copy.
        useAi: false,
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
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
        <div
          className={`relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
            isLight ? "border-slate-200 bg-white text-slate-900" : "border-slate-800 bg-[#090d16] text-white"
          }`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className={`mb-4 flex items-start justify-between gap-4 border-b pb-3 ${isLight ? "border-slate-200" : "border-slate-800"}`}>
            <div>
              <h2 className="text-sm font-bold">Create Campaign</h2>
              <p className={`mt-1 text-[11px] ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                Pick leads by name, choose reviewed templates, then approve the final messages before starting.
              </p>
            </div>
            <button type="button" onClick={onClose} className={`rounded-lg p-1.5 ${isLight ? "text-slate-500 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-800"}`} aria-label="Close create campaign">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!readinessLoading && !googleSheetReady && (
              <ReadinessAlert isLight={isLight} title="Google Sheet not connected" description="A connected workspace sheet is required before campaign creation and delivery." action="Connect Google Sheet in Integrations" />
            )}
            {!readinessLoading && !smtpReady && (
              <ReadinessAlert isLight={isLight} title="SMTP email is not configured" description="Email is unavailable until SMTP is connected. You can still create a WhatsApp-only campaign." action="Configure SMTP in Integrations" />
            )}
            {readinessError && <ErrorNotice isLight={isLight} error={readinessError} />}

            <Field isLight={isLight} label="Campaign name" hint="Optional — a dated name is created automatically when left blank.">
              <TextInput isLight={isLight} value={name} onChange={(event) => setName(event.target.value)} placeholder="Q3 commercial prospects" />
            </Field>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-slate-200"}`}>1. Select leads by name</p>
                  <p className={`mt-0.5 text-[10px] ${isLight ? "text-slate-500" : "text-slate-500"}`}>{selectedLeadIds.length} selected</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSelectedLeadIds((current) => Array.from(new Set([...current, ...filteredLeads.map((lead) => lead.id).filter(Boolean)])))} className="text-[10px] font-bold text-indigo-500 hover:underline">
                    Select visible ({filteredLeads.length})
                  </button>
                  {selectedLeadIds.length > 0 && <button type="button" onClick={() => setSelectedLeadIds([])} className="text-[10px] font-bold text-rose-500 hover:underline">Clear</button>}
                </div>
              </div>

              <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-950/40"}`}>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="search"
                    value={leadSearch}
                    onChange={(event) => setLeadSearch(event.target.value)}
                    placeholder="Search business, contact, category or location…"
                    className={`w-full rounded-lg border py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-500 ${
                      isLight ? "border-slate-300 bg-white text-slate-900" : "border-slate-700 bg-slate-950 text-white"
                    }`}
                  />
                </div>

                <div className={`max-h-56 overflow-y-auto rounded-lg border ${isLight ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-950"}`}>
                  {leads.loading ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading leads…</div>
                  ) : leads.error ? (
                    <div className="p-3"><ErrorNotice isLight={isLight} error={leads.error} /></div>
                  ) : filteredLeads.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">No matching leads found.</div>
                  ) : filteredLeads.map((lead) => {
                    const selected = selectedLeadIds.includes(lead.id);
                    return (
                      <label key={lead.id} className={`flex cursor-pointer items-center justify-between gap-3 border-b p-2.5 last:border-b-0 ${
                        isLight ? `border-slate-100 ${selected ? "bg-indigo-50" : "hover:bg-slate-50"}` : `border-slate-900 ${selected ? "bg-indigo-500/10" : "hover:bg-slate-900/60"}`
                      }`}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <input type="checkbox" checked={selected} onChange={() => toggleLead(lead.id)} className="h-3.5 w-3.5 rounded border-slate-400 text-indigo-600" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold">{lead.businessName}</span>
                            <span className="block truncate text-[10px] text-slate-500">{lead.contactName || "No contact"} · {lead.category || "General"}{lead.address ? ` · ${lead.address}` : ""}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {leadHasEmail(lead) && <Mail className="h-3 w-3 text-indigo-500" />}
                          {lead.phone && <MessageSquare className="h-3 w-3 text-emerald-500" />}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 ${isLight ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-950/40"}`}>
              <p className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-slate-200"}`}>2. Choose channels and templates</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Each enabled channel requires a reviewed template.</p>

              {templates.error && <div className="mt-3"><ErrorNotice isLight={isLight} error={templates.error} /></div>}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-950"}`}>
                  <label className={`flex items-center gap-2 text-xs font-semibold ${!smtpReady ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                    <input type="checkbox" checked={emailOn} disabled={!smtpReady} onChange={(event) => setEmailOn(event.target.checked)} className="h-3.5 w-3.5 rounded text-indigo-600" />
                    <Mail className="h-3.5 w-3.5 text-indigo-500" /> Email
                  </label>
                  {emailOn && (
                    <select value={emailTemplateId} onChange={(event) => setEmailTemplateId(event.target.value)} className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 ${isLight ? "border-slate-300 bg-white" : "border-slate-700 bg-slate-950"}`}>
                      <option value="">Choose email template…</option>
                      {emailTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  )}
                  {!smtpReady && <p className="mt-2 text-[10px] font-semibold text-rose-600">Connect SMTP to enable email.</p>}
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-950"}`}>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={whatsappOn} onChange={(event) => setWhatsappOn(event.target.checked)} className="h-3.5 w-3.5 rounded text-indigo-600" />
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-500" /> WhatsApp
                  </label>
                  {whatsappOn && (
                    <select value={whatsappTemplateId} onChange={(event) => setWhatsappTemplateId(event.target.value)} className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 ${isLight ? "border-slate-300 bg-white" : "border-slate-700 bg-slate-950"}`}>
                      <option value="">Choose WhatsApp template…</option>
                      {whatsappTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
              {templates.loading && <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading templates…</p>}
              {!templates.loading && emailOn && emailTemplates.length === 0 && <p className="mt-2 text-[10px] text-rose-600">No email template exists. Create one in Templates first.</p>}
              {!templates.loading && whatsappOn && whatsappTemplates.length === 0 && <p className="mt-2 text-[10px] text-rose-600">No WhatsApp template exists. Create one in Templates first.</p>}
            </div>

            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${
              isLight ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-indigo-500/25 bg-indigo-500/10 text-indigo-200"
            }`}>
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Creation does not send anything. You will review the final message table, approve it, and explicitly choose Start Campaign. Delivery is sequential with randomized pacing.
            </div>

            {error && <div className={`rounded-lg border p-2.5 text-xs ${isLight ? "border-red-300 bg-red-50 text-red-900" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>{error}</div>}

            <div className={`flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-end ${isLight ? "border-slate-200" : "border-slate-800"}`}>
              <Button isLight={isLight} variant="ghost" onClick={onClose} type="button">Cancel</Button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-interactive inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-sm hover:from-indigo-500 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {submitting ? "Creating campaign…" : "Create for Review"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
