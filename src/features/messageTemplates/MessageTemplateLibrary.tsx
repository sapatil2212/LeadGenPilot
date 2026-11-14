/**
 * WhatsApp message template library.
 *
 * Lists the workspace's templates as cards with search and filters, plus a
 * Create flow offering: start blank, use a pre-built starter, or generate with
 * AI. Row actions: edit, duplicate, preview, delete. Selecting a template or a
 * create option hands control to the builder (via onOpen).
 */

import React, { useMemo, useState } from "react";
import {
  Plus, Search, MessageSquare, Copy, Trash2, Pencil, Eye, FileText, Sparkles,
  LayoutTemplate, X, Globe, ChevronRight, RefreshCw,
} from "lucide-react";
import {
  Button, Card, Select, TextInput, Badge, EmptyState, Spinner, ErrorNotice, Notice,
  ConfirmButton, ModalPortal, useAsync, useAction, tokens, formatAgo, type Themed,
} from "../../ui/primitives";
import WhatsAppPreview from "./WhatsAppPreview";
import {
  type MessageTemplateView, type PrebuiltTemplate, type TemplateCategory, type MessageTemplatePayload,
  type StarterSuggestion,
  CATEGORY_OPTIONS, LANGUAGE_OPTIONS, listTemplates, getPrebuilt, getStarterSuggestions, deleteTemplate, duplicateTemplate,
  sampleValues, emptyPayload,
} from "./api";

interface Props extends Themed {
  businessName?: string;
  /** Open the builder: editing an existing template, or seeding a new one. */
  onOpen: (args: { template: MessageTemplateView | null; seed?: { name: string; category: TemplateCategory; payload: MessageTemplatePayload } | null }) => void;
}

const CATEGORY_TONE: Record<TemplateCategory, "info" | "emerald" | "amber" | "rose" | "neutral"> = {
  marketing: "info", sales: "emerald", utility: "amber", support: "rose", custom: "neutral",
};

export default function MessageTemplateLibrary({ isLight, businessName, onOpen }: Props) {
  const t = tokens(isLight);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [preview, setPreview] = useState<MessageTemplateView | null>(null);

  const state = useAsync<{ ok: boolean; templates: MessageTemplateView[] }>(() => listTemplates(), []);
  const action = useAction();

  const templates = state.data?.templates ?? [];
  const filtered = useMemo(() => {
    return templates.filter((tpl) => {
      if (category && tpl.category !== category) return false;
      if (language && tpl.language !== language) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!tpl.name.toLowerCase().includes(q) && !(tpl.description || "").toLowerCase().includes(q) && !tpl.tags.some((tag) => tag.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [templates, category, language, search]);

  const onDuplicate = async (tpl: MessageTemplateView) => {
    const r = await action.run(() => duplicateTemplate(tpl.id), "Template duplicated.");
    if (r?.ok) state.reload();
  };
  const onDelete = async (tpl: MessageTemplateView) => {
    const r = await action.run(() => deleteTemplate(tpl.id));
    if (r?.ok) state.reload();
  };

  return (
    <div className="space-y-4">
      <Card
        isLight={isLight}
        title="WhatsApp Templates"
        subtitle="Reusable message templates for outreach campaigns. Fully customizable."
        icon={MessageSquare}
        actions={<Button isLight={isLight} variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>Create Template</Button>}
      >
        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className={`absolute left-2.5 top-2.5 h-3.5 w-3.5 ${t.faint}`} />
            <TextInput isLight={isLight} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" className="pl-8" />
          </div>
          <Select isLight={isLight} value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Select isLight={isLight} value={language} onChange={(e) => setLanguage(e.target.value)} className="w-auto">
            <option value="">All languages</option>
            {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </Select>
        </div>

        <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
        {action.done && <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>{action.done}</Notice>}

        {state.loading ? (
          <Spinner isLight={isLight} label="Loading templates…" />
        ) : state.error ? (
          <ErrorNotice isLight={isLight} error={state.error} />
        ) : templates.length === 0 ? (
          <EmptyState
            isLight={isLight}
            icon={MessageSquare}
            title="No templates yet"
            action={<Button isLight={isLight} variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>Create your first template</Button>}
          >
            Build reusable WhatsApp messages with variables, buttons and quick replies that campaigns can send.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState isLight={isLight} icon={Search} title="No matches">Try a different search or clear the filters.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                isLight={isLight}
                template={tpl}
                busy={action.busy}
                onEdit={() => onOpen({ template: tpl })}
                onPreview={() => setPreview(tpl)}
                onDuplicate={() => onDuplicate(tpl)}
                onDelete={() => onDelete(tpl)}
              />
            ))}
          </div>
        )}
      </Card>

      {showCreate && (
        <CreateFlowModal
          isLight={isLight}
          onClose={() => setShowCreate(false)}
          onBlank={() => { setShowCreate(false); onOpen({ template: null }); }}
          onPrebuilt={(p) => { setShowCreate(false); onOpen({ template: null, seed: { name: p.name, category: p.category, payload: p.payload } }); }}
          onAi={() => { setShowCreate(false); onOpen({ template: null, seed: null }); }}
        />
      )}

      {preview && (
        <PreviewModal isLight={isLight} template={preview} businessName={businessName} onClose={() => setPreview(null)} onEdit={() => { const tpl = preview; setPreview(null); onOpen({ template: tpl }); }} />
      )}
    </div>
  );
}

function TemplateCard({ isLight, template, busy, onEdit, onPreview, onDuplicate, onDelete }: Themed & { key?: React.Key; template: MessageTemplateView; busy: boolean; onEdit: () => void; onPreview: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const t = tokens(isLight);
  return (
    <div className={`flex flex-col rounded-xl border p-3.5 transition-all hover:border-indigo-500/40 ${t.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className={`text-xs font-bold truncate ${t.heading}`}>{template.name}</h4>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
            <span className={t.faint}>{formatAgo(template.updatedAt)}</span>
            {template.usageCount > 0 && <span className={t.faint}>· used {template.usageCount}×</span>}
          </div>
        </div>
        <Badge isLight={isLight} tone={CATEGORY_TONE[template.category]}>{template.category}</Badge>
      </div>

      <p className={`mt-1.5 line-clamp-2 text-[11px] leading-snug ${t.muted}`}>
        {template.description || template.payload.body.text || "No description."}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${t.chip}`}>
          <Globe className="h-2.5 w-2.5" />
          WhatsApp Web
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${t.chip}`}>{template.language}</span>
        {template.tags.slice(0, 2).map((tag) => (
          <span key={tag} className={`rounded-full px-1.5 py-0.5 text-[9.5px] ${t.chip}`}>{tag}</span>
        ))}
      </div>

      <div className={`mt-3 flex items-center gap-1 border-t pt-2.5 ${t.border}`}>
        <Button isLight={isLight} variant="ghost" icon={Pencil} onClick={onEdit}>Edit</Button>
        <Button isLight={isLight} variant="ghost" icon={Eye} onClick={onPreview}>Preview</Button>
        <Button isLight={isLight} variant="ghost" icon={Copy} busy={busy} onClick={onDuplicate}>Duplicate</Button>
        <div className="ml-auto">
          <ConfirmButton isLight={isLight} icon={Trash2} label="Delete" onConfirm={onDelete} busy={busy} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create flow
// ─────────────────────────────────────────────────────────────────────────────

interface StarterChoice {
  name: string;
  category: TemplateCategory;
  description: string;
  payload: MessageTemplatePayload;
}

function CreateFlowModal({ isLight, onClose, onBlank, onPrebuilt, onAi }: Themed & { onClose: () => void; onBlank: () => void; onPrebuilt: (choice: StarterChoice) => void; onAi: () => void }) {
  const t = tokens(isLight);
  const [tab, setTab] = useState<"choose" | "prebuilt">("choose");

  // Business-specific suggestions, generated from this workspace's profile.
  const [suggestions, setSuggestions] = useState<StarterSuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestError, setSuggestError] = useState(false);

  // The universal fallback starters.
  const prebuilt = useAsync<{ ok: boolean; templates: PrebuiltTemplate[] }>(() => getPrebuilt(), []);

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    setSuggestError(false);
    try {
      const res = await getStarterSuggestions();
      setSuggestions(res.suggestions || []);
    } catch {
      // Never block the picker: an error just means we show general starters.
      setSuggestions([]);
      setSuggestError(true);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Generate tailored suggestions the first time the user opens the starter tab.
  const openStarterTab = () => {
    setTab("prebuilt");
    if (suggestions === null && !loadingSuggestions) void loadSuggestions();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn" onMouseDown={onClose}>
        <div onMouseDown={(e) => e.stopPropagation()} className={`w-full max-w-2xl rounded-2xl border p-6 shadow-2xl animate-scaleUp my-auto ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className={`text-base font-bold ${t.heading}`}>{tab === "choose" ? "Create a template" : "Choose a starter"}</h3>
            <button onClick={onClose} className={`cursor-pointer ${t.faint} hover:${t.body}`}><X className="h-4 w-4" /></button>
          </div>

          {tab === "choose" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ChoiceCard isLight={isLight} icon={FileText} title="Start Blank" desc="Build from an empty template." onClick={onBlank} />
              <ChoiceCard isLight={isLight} icon={LayoutTemplate} title="Use a Starter" desc="Templates tailored to your business, plus general ones." onClick={openStarterTab} />
              <ChoiceCard isLight={isLight} icon={Sparkles} title="Generate with AI" desc="Describe it and let AI draft it." onClick={onAi} />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-4">
              {/* Business-specific suggestions */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                    <span className={`text-xs font-bold ${t.heading}`}>Tailored to your business</span>
                  </div>
                  {!loadingSuggestions && suggestions !== null && (
                    <button onClick={() => void loadSuggestions()} className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:text-indigo-400 cursor-pointer">
                      <RefreshCw className="h-3 w-3" /> Regenerate
                    </button>
                  )}
                </div>

                {loadingSuggestions ? (
                  <div className={`rounded-lg border p-4 ${t.inset}`}>
                    <Spinner isLight={isLight} label="Generating starters from your business profile…" />
                  </div>
                ) : suggestions && suggestions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {suggestions.map((s, i) => (
                      <button key={`sug-${i}`} onClick={() => onPrebuilt(s)} className={`flex items-start justify-between gap-2 rounded-lg border p-3 text-left transition-all cursor-pointer hover:border-emerald-500/50 ${
                        isLight ? "bg-emerald-50/40 border-emerald-200" : "bg-emerald-500/5 border-emerald-500/20"
                      }`}>
                        <div className="min-w-0">
                          <div className={`text-xs font-bold ${t.heading}`}>{s.name}</div>
                          <div className={`mt-0.5 line-clamp-2 text-[11px] ${t.muted}`}>{s.description}</div>
                          <div className="mt-1.5 flex gap-1">
                            <Badge isLight={isLight} tone={CATEGORY_TONE[s.category] ?? "neutral"}>{s.category}</Badge>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 shrink-0 ${t.faint}`} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-lg border p-3 text-[11px] ${t.inset} ${t.muted}`}>
                    {suggestError
                      ? "Couldn't generate tailored starters right now. Pick a general starter below, or try Regenerate."
                      : "Add your business details under Business & AI to get starters written for your specific business. Meanwhile, use a general starter below."}
                  </div>
                )}
              </div>

              {/* Universal starters */}
              <div>
                <div className={`mb-2 text-xs font-bold ${t.heading}`}>General starters</div>
                {prebuilt.loading ? (
                  <Spinner isLight={isLight} label="Loading starters…" />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(prebuilt.data?.templates ?? []).map((p) => (
                      <button key={p.slug} onClick={() => onPrebuilt(p)} className={`flex items-start justify-between gap-2 rounded-lg border p-3 text-left transition-all cursor-pointer hover:border-indigo-500/40 ${t.inset}`}>
                        <div className="min-w-0">
                          <div className={`text-xs font-bold ${t.heading}`}>{p.name}</div>
                          <div className={`mt-0.5 line-clamp-2 text-[11px] ${t.muted}`}>{p.description}</div>
                          <div className="mt-1.5 flex gap-1">
                            <Badge isLight={isLight} tone={CATEGORY_TONE[p.category]}>{p.category}</Badge>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 shrink-0 ${t.faint}`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Button isLight={isLight} variant="ghost" onClick={() => setTab("choose")}>← Back</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function ChoiceCard({ isLight, icon: Icon, title, desc, onClick }: Themed & { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; onClick: () => void }) {
  const t = tokens(isLight);
  return (
    <button onClick={onClick} className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all cursor-pointer hover:border-indigo-500/40 hover:scale-[1.01] ${t.inset}`}>
      <div className={`rounded-lg p-2 ${isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-400"}`}><Icon className="h-4.5 w-4.5" /></div>
      <div className={`text-xs font-bold ${t.heading}`}>{title}</div>
      <div className={`text-[11px] leading-snug ${t.muted}`}>{desc}</div>
    </button>
  );
}

function PreviewModal({ isLight, template, businessName, onClose, onEdit }: Themed & { template: MessageTemplateView; businessName?: string; onClose: () => void; onEdit: () => void }) {
  const t = tokens(isLight);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn" onMouseDown={onClose}>
        <div onMouseDown={(e) => e.stopPropagation()} className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl animate-scaleUp my-auto ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className={`truncate text-base font-bold ${t.heading}`}>{template.name}</h3>
            <button onClick={onClose} className={`cursor-pointer ${t.faint} hover:${t.body}`}><X className="h-4 w-4" /></button>
          </div>
          <WhatsAppPreview payload={template.payload} values={sampleValues(template.payload)} deliveryMethod={template.deliveryMethod} businessName={businessName} />
          <div className="mt-4 flex justify-end gap-2">
            <Button isLight={isLight} variant="ghost" onClick={onClose}>Close</Button>
            <Button isLight={isLight} variant="primary" icon={Pencil} onClick={onEdit}>Edit</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
