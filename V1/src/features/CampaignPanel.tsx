/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign generation and approval.
 *
 * The operator generates a batch of outreach messages, reviews each one, and
 * approves only what they're willing to claim. This is what turns "spray and
 * pray" into "reviewed outreach" — the only mode that works for a business
 * where every claim made to a prospect is the operator's responsibility.
 *
 * The workflow:
 *   1. Generate → select leads (ICP/list/manual), choose channels/templates
 *   2. Review → see each message with its AI-generated copy, edit if needed
 *   3. Approve → mark messages ready to send (individually or in bulk)
 *   4. Send → execute only approved messages (not built yet, Phase 6)
 */

import React, { useState } from "react";
import type { OutreachTemplate } from "../outreachTemplates";
import {
  Check,
  CheckCircle,
  ChevronRight,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Send,
  Trash2,
  X,
  XCircle,
  Sparkles,
  Edit3,
  Eye,
  AlertCircle,
} from "lucide-react";
import {
  api,
  type CampaignView,
  type CampaignDetailView,
  type CampaignMessageView,
} from "../ui/api";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Notice,
  Select,
  Spinner,
  SubTabs,
  TextArea,
  TextInput,
  tokens,
  useAction,
  useAsync,
  type Themed,
  Field,
} from "../ui/primitives";

type Tab = "review" | "generate";

export default function CampaignPanel({ isLight }: Themed) {
  const [tab, setTab] = useState<Tab>("review");

  return (
    <div className="space-y-5">
      <SubTabs<Tab>
        isLight={isLight}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "review", label: "Review & Approve", icon: CheckCircle },
          { id: "generate", label: "Generate Campaign", icon: Plus },
        ]}
      />
      {tab === "review" && <ReviewTab isLight={isLight} />}
      {tab === "generate" && <GenerateTab isLight={isLight} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review & Approve
// ─────────────────────────────────────────────────────────────────────────────

function ReviewTab({ isLight }: Themed) {
  const t = tokens(isLight);
  const campaigns = useAsync<CampaignView[]>(() => api.get("/api/campaigns"));
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {!activeId && (
        <Card
          isLight={isLight}
          title="Campaigns awaiting review"
          subtitle="Select a campaign to review and approve its messages."
          icon={CheckCircle}
        >
          {campaigns.loading ? (
            <Spinner isLight={isLight} />
          ) : campaigns.error ? (
            <ErrorNotice isLight={isLight} error={campaigns.error} />
          ) : (campaigns.data ?? []).length === 0 ? (
            <EmptyState
              isLight={isLight}
              icon={Sparkles}
              title="No campaigns yet"
              action={
                <Button isLight={isLight} variant="primary" icon={Plus} onClick={() => {}}>
                  Generate your first campaign
                </Button>
              }
            >
              Generate a batch of outreach messages, review each one, and approve only what
              you're willing to send.
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {(campaigns.data ?? []).map((campaign) => (
                <div
                  key={campaign.id}
                  className={`border rounded-xl px-4 py-3.5 cursor-pointer transition-colors ${t.inset} hover:border-indigo-500`}
                  onClick={() => setActiveId(campaign.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${t.heading}`}>{campaign.name}</span>
                        <Badge isLight={isLight} tone={statusTone(campaign.status)}>
                          {campaign.status.replace(/_/g, " ")}
                        </Badge>
                        {campaign.channels.email && <Mail className="h-3.5 w-3.5 text-indigo-500" />}
                        {campaign.channels.whatsapp && (
                          <MessageSquare className="h-3.5 w-3.5 text-green-500" />
                        )}
                      </div>
                      <div className={`text-[11px] mt-2 flex flex-wrap gap-x-4 ${t.faint}`}>
                        <span>{campaign.totalMessages} messages</span>
                        {campaign.pendingCount > 0 && (
                          <span className="text-amber-500">{campaign.pendingCount} pending</span>
                        )}
                        {campaign.approvedCount > 0 && (
                          <span className="text-emerald-500">{campaign.approvedCount} approved</span>
                        )}
                        {campaign.rejectedCount > 0 && (
                          <span className="text-rose-500">{campaign.rejectedCount} rejected</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeId && <CampaignReview isLight={isLight} campaignId={activeId} onBack={() => setActiveId(null)} />}
    </div>
  );
}

function statusTone(status: string): "good" | "warm" | "info" | "neutral" {
  if (status === "sent") return "good";
  if (status === "pending_review") return "warm";
  if (status === "approved" || status === "partially_approved") return "info";
  return "neutral";
}

function CampaignReview({
  isLight,
  campaignId,
  onBack,
}: Themed & { campaignId: string; onBack: () => void }) {
  const t = tokens(isLight);
  const campaign = useAsync<CampaignDetailView>(() => api.get(`/api/campaigns/${campaignId}`));
  const action = useAction();
  const [editingId, setEditingId] = useState<string | null>(null);

  const approveOne = async (messageId: string) => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/messages/${messageId}/approve`),
      "Approved."
    );
    if (ok) campaign.reload();
  };

  const rejectOne = async (messageId: string, reason?: string) => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/messages/${messageId}/reject`, { reason }),
      "Rejected."
    );
    if (ok) campaign.reload();
  };

  const approveAll = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/approve-all`),
      "All pending messages approved."
    );
    if (ok) campaign.reload();
  };

  const sendCampaign = async () => {
    const ok = await action.run(
      () => api.post(`/api/campaigns/${campaignId}/execute`),
      "Campaign is being sent. This may take a few minutes."
    );
    if (ok) campaign.reload();
  };

  const deleteCampaign = async () => {
    const ok = await action.run(() => api.del(`/api/campaigns/${campaignId}`), "Campaign deleted.");
    if (ok) onBack();
  };

  if (campaign.loading) return <Spinner isLight={isLight} />;
  if (campaign.error) return <ErrorNotice isLight={isLight} error={campaign.error} />;
  if (!campaign.data) return <EmptyState isLight={isLight} icon={AlertCircle} title="Campaign not found" />;

  const pending = campaign.data.messages.filter((m) => m.status === "pending_review");
  const approved = campaign.data.messages.filter((m) => m.status === "approved");
  const rejected = campaign.data.messages.filter((m) => m.status === "rejected");

  return (
    <div className="space-y-5">
      <Card
        isLight={isLight}
        title={campaign.data.name}
        subtitle={`${campaign.data.totalMessages} messages · ${campaign.data.pendingCount} pending · ${campaign.data.approvedCount} approved`}
        icon={CheckCircle}
        actions={
          <>
            <Button isLight={isLight} variant="ghost" icon={X} onClick={onBack}>
              Back
            </Button>
            {campaign.data.status !== "sent" && (
              <ConfirmButton
                isLight={isLight}
                icon={Trash2}
                label="Delete"
                busy={action.busy}
                onConfirm={deleteCampaign}
              />
            )}
            {pending.length > 0 && (
              <Button
                isLight={isLight}
                variant="primary"
                icon={CheckCircle}
                busy={action.busy}
                onClick={approveAll}
              >
                Approve all ({pending.length})
              </Button>
            )}
            {approved.length > 0 && campaign.data.status !== "sent" && campaign.data.status !== "sending" && (
              <Button
                isLight={isLight}
                variant="primary"
                icon={Send}
                busy={action.busy}
                onClick={sendCampaign}
              >
                Send campaign ({approved.length})
              </Button>
            )}
          </>
        }
      >
        <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
        {action.done && (
          <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>
            {action.done}
          </Notice>
        )}

        {pending.length === 0 && approved.length === 0 && rejected.length === 0 && (
          <EmptyState isLight={isLight} icon={CheckCircle} title="No messages">
            This campaign has no messages.
          </EmptyState>
        )}

        {pending.length > 0 && (
          <div className="mb-5">
            <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${t.muted}`}>
              Pending review ({pending.length})
            </div>
            <div className="space-y-3">
              {pending.map((message) => (
                <div key={message.id}>
                  <MessageCard
                    isLight={isLight}
                    message={message}
                    editing={editingId === message.id}
                    onEdit={() => setEditingId(message.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={async (updates) => {
                      const ok = await action.run(() =>
                        api.patch(`/api/campaigns/messages/${message.id}`, updates)
                      );
                      if (ok) {
                        campaign.reload();
                        setEditingId(null);
                      }
                    }}
                    onApprove={() => approveOne(message.id)}
                    onReject={() => rejectOne(message.id)}
                    busy={action.busy}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {approved.length > 0 && (
          <div className="mb-5">
            <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${t.muted}`}>
              Approved ({approved.length})
            </div>
            <div className="space-y-3">
              {approved.map((message) => (
                <div key={message.id}>
                  <MessageCard
                    isLight={isLight}
                    message={message}
                    editing={false}
                    onEdit={() => {}}
                    onCancelEdit={() => {}}
                    onSaveEdit={async () => {}}
                    onApprove={() => {}}
                    onReject={() => {}}
                    busy={false}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {rejected.length > 0 && (
          <div>
            <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${t.muted}`}>
              Rejected ({rejected.length})
            </div>
            <div className="space-y-3">
              {rejected.map((message) => (
                <div key={message.id}>
                  <MessageCard
                    isLight={isLight}
                    message={message}
                    editing={false}
                    onEdit={() => {}}
                    onCancelEdit={() => {}}
                    onSaveEdit={async () => {}}
                    onApprove={() => {}}
                    onReject={() => {}}
                    busy={false}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MessageCard({
  isLight,
  message,
  editing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onApprove,
  onReject,
  busy,
}: Themed & {
  message: CampaignMessageView;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updates: { subject?: string; body?: string }) => Promise<void>;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const t = tokens(isLight);
  const [editSubject, setEditSubject] = useState(message.subject || "");
  const [editBody, setEditBody] = useState(message.body);

  const saveEdit = async () => {
    await onSaveEdit({
      ...(message.channel === "email" ? { subject: editSubject } : {}),
      body: editBody,
    });
  };

  return (
    <div className={`border rounded-xl p-4 ${t.card}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${t.heading}`}>{message.businessName}</span>
            {message.channel === "email" ? (
              <Mail className="h-3.5 w-3.5 text-indigo-500" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-green-500" />
            )}
            <Badge isLight={isLight} tone={statusTone(message.status)}>
              {message.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className={`text-xs mt-1 ${t.muted}`}>{message.recipient}</div>
        </div>

        {message.status === "pending_review" && !editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button isLight={isLight} variant="ghost" icon={Edit3} onClick={onEdit}>
              Edit
            </Button>
            <Button
              isLight={isLight}
              variant="ghost"
              icon={CheckCircle}
              busy={busy}
              onClick={onApprove}
            >
              Approve
            </Button>
            <Button isLight={isLight} variant="ghost" icon={XCircle} busy={busy} onClick={onReject}>
              Reject
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          {message.channel === "email" && (
            <Field isLight={isLight} label="Subject">
              <TextInput
                isLight={isLight}
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
              />
            </Field>
          )}
          <Field isLight={isLight} label="Body">
            <TextArea
              isLight={isLight}
              rows={6}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button isLight={isLight} variant="primary" icon={Check} busy={busy} onClick={saveEdit}>
              Save
            </Button>
            <Button isLight={isLight} variant="ghost" icon={X} onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {message.channel === "email" && message.subject && (
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-wide ${t.faint}`}>
                Subject
              </div>
              <div className={`text-xs mt-0.5 ${t.body}`}>{message.subject}</div>
            </div>
          )}
          <div>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${t.faint}`}>Body</div>
            <div className={`text-xs mt-0.5 leading-relaxed whitespace-pre-wrap ${t.body}`}>
              {message.body}
            </div>
          </div>
        </div>
      )}

      {message.rejectionReason && (
        <div className="mt-3">
          <Notice isLight={isLight} tone="warn" title="Rejection reason">
            {message.rejectionReason}
          </Notice>
        </div>
      )}

      {message.errorMessage && (
        <div className="mt-3">
          <Notice isLight={isLight} tone="error" title="Send failed">
            {message.errorMessage}
          </Notice>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate Campaign
// ─────────────────────────────────────────────────────────────────────────────

function GenerateTab({ isLight }: Themed) {
  const t = tokens(isLight);
  const action = useAction();
  const templates = useAsync<OutreachTemplate[]>(() => api.get("/api/templates"));

  const initialManualLeadIds = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem("leadgenpilot_campaign_lead_ids") || sessionStorage.getItem("nexaleadai_campaign_lead_ids") || "[]");
      return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    } catch { return [] as string[]; }
  })();
  const [manualLeadIds, setManualLeadIds] = useState<string[]>(initialManualLeadIds);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"icp" | "list" | "manual">(initialManualLeadIds.length ? "manual" : "icp");
  const [sourceListId, setSourceListId] = useState("");
  const [icpProfileId, setIcpProfileId] = useState("");
  const [emailOn, setEmailOn] = useState(true);
  const [whatsappOn, setWhatsappOn] = useState(false);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [whatsappTemplateId, setWhatsappTemplateId] = useState("");
  const [useAi, setUseAi] = useState(true);

  const generate = async () => {
    if (sourceType === "list" && !sourceListId) {
      await action.run(() => Promise.reject(new Error("Select a lead list.")));
      return;
    }
    if (sourceType === "icp" && !icpProfileId) {
      await action.run(() => Promise.reject(new Error("Select an ICP profile.")));
      return;
    }
    if (sourceType === "manual" && manualLeadIds.length === 0) {
      await action.run(() => Promise.reject(new Error("Select leads from the Leads workspace first.")));
      return;
    }
    if (!emailOn && !whatsappOn) {
      await action.run(() => Promise.reject(new Error("Enable at least one channel (email or whatsapp).")));
      return;
    }

    await action.run<{ campaignId: string; messageCount: number; warning?: string }>(
      () =>
        api.post("/api/campaigns", {
          name: name || undefined,
          sourceType,
          sourceListId: sourceType === "list" ? sourceListId : undefined,
          icpProfileId: sourceType === "icp" ? icpProfileId : undefined,
          leadIds: sourceType === "manual" ? manualLeadIds : undefined,
          channels: { email: emailOn, whatsapp: whatsappOn },
          templateIds: {
            ...(emailOn && emailTemplateId ? { email: emailTemplateId } : {}),
            ...(whatsappOn && whatsappTemplateId ? { whatsapp: whatsappTemplateId } : {}),
          },
          useAi,
        }),
      "Campaign generated. Review and approve each message before sending."
    );
  };

  return (
    <Card
      isLight={isLight}
      title="Generate a campaign"
      subtitle="Select leads, choose channels, and generate outreach messages for review."
      icon={Sparkles}
    >
      <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
      {action.done && (
        <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>
          {action.done}
        </Notice>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Field isLight={isLight} label="Campaign name (optional)">
          <TextInput
            isLight={isLight}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Q1 2026 Hospitals"
          />
        </Field>

        <Field isLight={isLight} label="Lead source">
          <Select isLight={isLight} value={sourceType} onChange={(e) => setSourceType(e.target.value as any)}>
            <option value="icp">ICP Profile</option>
            <option value="list">Lead List</option>
            <option value="manual">Manual Selection</option>
          </Select>
        </Field>

        {sourceType === "list" && (
          <Field isLight={isLight} label="Lead list">
            <TextInput
              isLight={isLight}
              value={sourceListId}
              onChange={(e) => setSourceListId(e.target.value)}
              placeholder="List ID"
            />
          </Field>
        )}

        {sourceType === "icp" && (
          <Field isLight={isLight} label="ICP profile">
            <TextInput
              isLight={isLight}
              value={icpProfileId}
              onChange={(e) => setIcpProfileId(e.target.value)}
              placeholder="Profile ID"
            />
          </Field>
        )}

        {sourceType === "manual" && (
          <Field isLight={isLight} label="Selected leads">
            <div className={`rounded-lg border px-3 py-2 text-sm ${t.body} ${t.border}`}>
              {manualLeadIds.length} lead{manualLeadIds.length === 1 ? "" : "s"} selected from the Leads workspace
              {manualLeadIds.length > 0 && (
                <button type="button" className="ml-2 text-xs text-rose-400" onClick={() => { setManualLeadIds([]); sessionStorage.removeItem("leadgenpilot_campaign_lead_ids"); sessionStorage.removeItem("nexaleadai_campaign_lead_ids"); }}>Clear</button>
              )}
            </div>
          </Field>
        )}
      </div>

      <div className={`mt-5 pt-4 border-t ${t.border}`}>
        <div className={`text-[11px] font-semibold uppercase tracking-wide mb-3 ${t.muted}`}>
          Channels
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emailOn}
              onChange={(e) => setEmailOn(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <Mail className="h-4 w-4" />
            <span className={`text-sm ${t.body}`}>Email</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={whatsappOn}
              onChange={(e) => setWhatsappOn(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <MessageSquare className="h-4 w-4" />
            <span className={`text-sm ${t.body}`}>WhatsApp</span>
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {emailOn && (
            <Field isLight={isLight} label="Email template" hint="Optional. Saved AI templates are compiled for each lead.">
              <Select
                isLight={isLight}
                value={emailTemplateId}
                onChange={(event) => setEmailTemplateId(event.target.value)}
              >
                <option value="">Generate a new message for each lead</option>
                {(templates.data ?? [])
                  .filter((template) => template.templateType === "email")
                  .map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
              </Select>
            </Field>
          )}
          {whatsappOn && (
            <Field isLight={isLight} label="WhatsApp template" hint="Optional. Uses the reviewed template as the message shell.">
              <Select
                isLight={isLight}
                value={whatsappTemplateId}
                onChange={(event) => setWhatsappTemplateId(event.target.value)}
              >
                <option value="">Generate a new message for each lead</option>
                {(templates.data ?? [])
                  .filter((template) => template.templateType === "whatsapp")
                  .map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
              </Select>
            </Field>
          )}
        </div>
        {templates.loading && <div className={`mt-2 text-[10px] ${t.faint}`}>Loading workspace templates…</div>}
        {templates.error ? <div className="mt-2"><ErrorNotice isLight={isLight} error={templates.error} /></div> : null}
      </div>

      <div className={`mt-5 pt-4 border-t ${t.border}`}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useAi}
            onChange={(e) => setUseAi(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <span className={`text-sm ${t.body}`}>Generate copy with AI (falls back to rule-based if unavailable)</span>
        </label>
      </div>

      <div className="mt-5 flex justify-end">
        <Button isLight={isLight} variant="primary" icon={Play} busy={action.busy} onClick={generate}>
          Generate campaign
        </Button>
      </div>
    </Card>
  );
}
