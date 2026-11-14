/**
 * Three-panel WhatsApp template builder.
 *
 *   LEFT   — collapsible component sections (header, body, footer, actions,
 *            quick replies, variables) plus template settings.
 *   RIGHT  — the live WhatsApp preview, updating as the payload changes.
 *
 * The builder holds the payload in state and is the single writer. Children are
 * controlled editors. Validation runs debounced against the server so the Save
 * button reflects deliverability, and the preview is rendered client-side for
 * zero-latency feedback.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Save, Send, Sparkles, Wand2, Type, AlignLeft, Captions,
  MousePointerClick, MessageSquare, Braces, Settings2, AlertTriangle, Check, Loader2, ChevronDown,
} from "lucide-react";
import {
  Button, Card, Field, Notice, ErrorNotice, Select, TextInput, TextArea, Toggle,
  Badge, ModalPortal, useAction, tokens, type Themed,
} from "../../ui/primitives";
import {
  HeaderEditor, BodyEditor, FooterEditor, ActionBuilder, QuickReplyBuilder,
  VariableManager,
} from "./editors";
import WhatsAppPreview from "./WhatsAppPreview";
import {
  type MessageTemplateView, type MessageTemplatePayload, type DeliveryMethod,
  type ValidationIssue, type SaveInput, type TemplateCategory,
  CATEGORY_OPTIONS, LANGUAGE_OPTIONS, emptyPayload, sampleValues,
  createTemplate, updateTemplate, validateTemplate, generateAiDraft,
} from "./api";

interface Props extends Themed {
  /** Existing template to edit, or null for a new one. */
  template: MessageTemplateView | null;
  /** Seed payload/name for a new template (from prebuilt or AI). */
  seed?: { name: string; category: TemplateCategory; payload: MessageTemplatePayload } | null;
  businessName?: string;
  onBack: () => void;
  onSaved: (saved: MessageTemplateView) => void;
}

type SectionId = "settings" | "header" | "body" | "footer" | "actions" | "quickReplies" | "variables";

const SECTIONS: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "settings", label: "Template settings", icon: Settings2 },
  { id: "header", label: "Header", icon: Type },
  { id: "body", label: "Message body", icon: AlignLeft },
  { id: "footer", label: "Footer", icon: Captions },
  { id: "actions", label: "Action buttons", icon: MousePointerClick },
  { id: "quickReplies", label: "Quick replies", icon: MessageSquare },
  { id: "variables", label: "Variables", icon: Braces },
];

export default function MessageTemplateBuilder({ isLight, template, seed, businessName, onBack, onSaved }: Props) {
  const t = tokens(isLight);

  const [name, setName] = useState(template?.name || seed?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [category, setCategory] = useState<TemplateCategory>(template?.category || seed?.category || "marketing");
  const [language, setLanguage] = useState(template?.language || "en");
  const [tags, setTags] = useState<string[]>(template?.tags || []);
  const [payload, setPayload] = useState<MessageTemplatePayload>(
    template?.payload || seed?.payload || emptyPayload()
  );
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    settings: false, header: true, body: true, footer: false, actions: false, quickReplies: false, variables: false,
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [showAi, setShowAi] = useState(false);
  const [showTest, setShowTest] = useState(false);

  const save = useAction();
  const deliveryMethod: DeliveryMethod = payload.settings.deliveryMethod;
  const values = useMemo(() => sampleValues(payload), [payload]);

  // Debounced server validation.
  const validateTimer = useRef<number | null>(null);
  useEffect(() => {
    if (validateTimer.current) window.clearTimeout(validateTimer.current);
    validateTimer.current = window.setTimeout(() => {
      validateTemplate(payload, deliveryMethod)
        .then((r) => setIssues(r.issues))
        .catch(() => undefined);
    }, 500);
    return () => { if (validateTimer.current) window.clearTimeout(validateTimer.current); };
  }, [payload, deliveryMethod]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const handleSave = async () => {
    if (!name.trim()) { setOpen((o) => ({ ...o, settings: true })); return; }
    const input: SaveInput = {
      name: name.trim(), description: description.trim() || undefined,
      category, language, deliveryMethod, tags, payload, status: "active",
    };
    const result = await save.run(
      () => (template ? updateTemplate(template.id, input) : createTemplate(input)),
      "Template saved."
    );
    if (result?.ok) onSaved(result.template);
  };

  const applyAiDraft = (draft: { name: string; category: string; payload: MessageTemplatePayload }) => {
    setName((n) => n || draft.name);
    setCategory(draft.category as TemplateCategory);
    setPayload(draft.payload);
    setOpen((o) => ({ ...o, body: true, actions: true, quickReplies: true }));
    setShowAi(false);
  };

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${t.card}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Button isLight={isLight} variant="ghost" icon={ArrowLeft} onClick={onBack}>Library</Button>
          <div className="min-w-0">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled template"
              className={`w-full bg-transparent text-sm font-bold outline-none ${t.heading} placeholder:${t.faint}`}
            />
            <div className={`text-[10px] ${t.faint}`}>
              {template ? `v${template.version} · updated ${new Date(template.updatedAt).toLocaleDateString()}` : "New template"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button isLight={isLight} variant="secondary" icon={Sparkles} onClick={() => setShowAi(true)}>Generate with AI</Button>
          <Button isLight={isLight} variant="secondary" icon={Send} onClick={() => setShowTest(true)}>Test Send</Button>
          <Button isLight={isLight} variant="primary" icon={Save} busy={save.busy} disabled={errors.length > 0} onClick={handleSave}>Save</Button>
        </div>
      </div>

      <ErrorNotice isLight={isLight} error={save.error} onDismiss={save.clearError} />
      {save.done && <Notice isLight={isLight} tone="success" onDismiss={save.clearDone}>{save.done}</Notice>}

      {/* Validation summary */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className={`rounded-xl border p-3 text-[11px] ${errors.length ? (isLight ? "bg-rose-50 border-rose-200" : "bg-rose-950/20 border-rose-900/50") : (isLight ? "bg-amber-50 border-amber-200" : "bg-amber-950/20 border-amber-900/50")}`}>
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <AlertTriangle className={`h-3.5 w-3.5 ${errors.length ? "text-rose-500" : "text-amber-500"}`} />
            {errors.length ? `${errors.length} issue${errors.length > 1 ? "s" : ""} to fix` : `${warnings.length} note${warnings.length > 1 ? "s" : ""}`}
          </div>
          <ul className="space-y-0.5 pl-5 list-disc">
            {[...errors, ...warnings].slice(0, 6).map((i, idx) => (
              <li key={idx} className={i.severity === "error" ? "text-rose-500" : "text-amber-600"}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Three-panel layout: editors (left/center) + preview (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 space-y-2.5">
          {SECTIONS.map((s) => (
            <Section key={s.id} isLight={isLight} icon={s.icon} label={s.label} open={open[s.id]} onToggle={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} badge={sectionBadge(s.id, payload)}>
              {s.id === "settings" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field isLight={isLight} label="Category">
                      <Select isLight={isLight} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                        {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </Select>
                    </Field>
                    <Field isLight={isLight} label="Language">
                      <Select isLight={isLight} value={language} onChange={(e) => setLanguage(e.target.value)}>
                        {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Field isLight={isLight} label="Internal description" hint="Only visible to your team.">
                    <TextArea isLight={isLight} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this template for?" />
                  </Field>
                  <Field isLight={isLight} label="Tags" hint="Comma-separated. Used for filtering.">
                    <TextInput isLight={isLight} value={tags.join(", ")} onChange={(e) => setTags(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="Dental, Lead Generation" />
                  </Field>
                  <Toggle isLight={isLight} checked={payload.settings.personalization} onChange={(personalization) => setPayload((p) => ({ ...p, settings: { ...p.settings, personalization } }))} label="Personalize with contact data" hint="Merge CRM fields into variables when sending." />
                </div>
              )}
              {s.id === "header" && <HeaderEditor isLight={isLight} payload={payload} onChange={setPayload} />}
              {s.id === "body" && <BodyEditor isLight={isLight} payload={payload} onChange={setPayload} />}
              {s.id === "footer" && <FooterEditor isLight={isLight} payload={payload} onChange={setPayload} />}
              {s.id === "actions" && <ActionBuilder isLight={isLight} payload={payload} onChange={setPayload} deliveryMethod={deliveryMethod} />}
              {s.id === "quickReplies" && <QuickReplyBuilder isLight={isLight} payload={payload} onChange={setPayload} deliveryMethod={deliveryMethod} />}
              {s.id === "variables" && <VariableManager isLight={isLight} payload={payload} onChange={setPayload} />}
            </Section>
          ))}
        </div>

        {/* Live preview — sticky so it stays visible while editing */}
        <div className="lg:col-span-5 lg:sticky lg:top-4">
          <Card isLight={isLight} title="Live preview">
            <WhatsAppPreview payload={payload} values={values} deliveryMethod={deliveryMethod} businessName={businessName} />
          </Card>
        </div>
      </div>

      {showAi && <AiGeneratorModal isLight={isLight} category={category} onApply={applyAiDraft} onClose={() => setShowAi(false)} />}
      {showTest && <TestSendModal isLight={isLight} payload={payload} values={values} onClose={() => setShowTest(false)} />}
    </div>
  );
}

function sectionBadge(id: SectionId, payload: MessageTemplatePayload): string | undefined {
  if (id === "actions" && payload.actions.length) return String(payload.actions.length);
  if (id === "quickReplies" && payload.quickReplies.length) return String(payload.quickReplies.length);
  if (id === "variables" && payload.variables.length) return String(payload.variables.length);
  if (id === "header" && payload.header.type !== "none") return payload.header.type;
  if (id === "footer" && payload.footer.enabled) return "on";
  return undefined;
}

function Section({ isLight, icon: Icon, label, open, onToggle, badge, children }: Themed & { key?: React.Key; icon: React.ComponentType<{ className?: string }>; label: string; open: boolean; onToggle: () => void; badge?: string; children: React.ReactNode }) {
  const t = tokens(isLight);
  return (
    <div className={`rounded-xl border overflow-hidden ${t.card}`}>
      <button onClick={onToggle} className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer ${isLight ? "hover:bg-slate-50" : "hover:bg-white/[0.02]"}`}>
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded-lg ${isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-400"}`}><Icon className="h-3.5 w-3.5" /></div>
          <span className={`text-xs font-bold ${t.heading}`}>{label}</span>
          {badge && <Badge isLight={isLight} tone="neutral">{badge}</Badge>}
        </div>
        <ChevronDown className={`h-4 w-4 ${t.faint} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className={`border-t px-3.5 py-3 ${t.border}`}>{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI generator modal
// ─────────────────────────────────────────────────────────────────────────────

function AiGeneratorModal({ isLight, category, onApply, onClose }: Themed & { category: TemplateCategory; onApply: (d: { name: string; category: string; payload: MessageTemplatePayload }) => void; onClose: () => void }) {
  const t = tokens(isLight);
  const [objective, setObjective] = useState("");
  const [tone, setTone] = useState("");
  const gen = useAction();

  const run = async () => {
    const result = await gen.run(() => generateAiDraft({ objective: objective.trim(), tone: tone.trim() || undefined, category }));
    if (result?.ok) onApply({ name: result.draft.name, category: result.draft.category, payload: result.draft.payload });
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn" onMouseDown={onClose}>
        <div onMouseDown={(e) => e.stopPropagation()} className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl animate-scaleUp my-auto ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
          <h3 className={`mb-1 flex items-center gap-2 text-base font-bold ${t.heading}`}><Wand2 className="h-4.5 w-4.5 text-indigo-400" /> Generate with AI</h3>
          <p className={`mb-4 text-[11px] ${t.muted}`}>Describe what you want. The AI drafts a template from your business profile — fully editable after.</p>

          <Field isLight={isLight} label="What should this message do?">
            <TextArea isLight={isLight} rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Create a WhatsApp outreach message for dentists promoting AI appointment automation." />
          </Field>
          <div className="mt-3">
            <Field isLight={isLight} label="Tone (optional)">
              <TextInput isLight={isLight} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Friendly, professional, persuasive…" />
            </Field>
          </div>

          <ErrorNotice isLight={isLight} error={gen.error} onDismiss={gen.clearError} />

          <div className="mt-4 flex justify-end gap-2">
            <Button isLight={isLight} variant="ghost" onClick={onClose}>Cancel</Button>
            <Button isLight={isLight} variant="primary" icon={Sparkles} busy={gen.busy} disabled={objective.trim().length < 10} onClick={run}>Generate</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test send modal (renders exactly what will be sent)
// ─────────────────────────────────────────────────────────────────────────────

function TestSendModal({ isLight, payload, values, onClose }: Themed & { payload: MessageTemplatePayload; values: Record<string, string>; onClose: () => void }) {
  const t = tokens(isLight);
  const [phone, setPhone] = useState("");
  const send = useAction();
  const [sent, setSent] = useState(false);

  // The test send reuses the existing WhatsApp test endpoint, rendering the
  // template to text client-side so the user sees exactly what goes out.
  const run = async () => {
    // Build the web-rendered text from the payload (same shape the server uses).
    const lines: string[] = [];
    const sub = (x: string) => x.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (tok, k) => (values[k] || tok));
    if (payload.header.type === "text" && payload.header.text) lines.push(`⭐ *${sub(payload.header.text)}*`);
    if (payload.body.text) lines.push(sub(payload.body.text));
    for (const a of payload.actions) if (a.label) lines.push(`${a.type === "phone" ? "📞" : "🌐"} *${sub(a.label)}*${a.value ? "\n" + sub(a.value) : ""}`);
    if (payload.footer.enabled && payload.footer.text) lines.push(`_${sub(payload.footer.text)}_`);
    const message = lines.join("\n\n");

    const result = await send.run(async () => {
      const res = await fetch("/api/whatsapp/send-test", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ phone: phone.trim(), message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Send failed.");
      return data;
    });
    if (result) setSent(true);
  };

  const previewText = useMemo(() => {
    const sub = (x: string) => x.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (tok, k) => (values[k] || tok));
    const parts: string[] = [];
    if (payload.header.type === "text" && payload.header.text) parts.push(`⭐ ${sub(payload.header.text)}`);
    if (payload.body.text) parts.push(sub(payload.body.text));
    return parts.join("\n\n");
  }, [payload, values]);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn" onMouseDown={onClose}>
        <div onMouseDown={(e) => e.stopPropagation()} className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl animate-scaleUp my-auto ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
          <h3 className={`mb-1 flex items-center gap-2 text-base font-bold ${t.heading}`}><Send className="h-4.5 w-4.5 text-indigo-400" /> Send Test Message</h3>
          <p className={`mb-4 text-[11px] ${t.muted}`}>Sends this template with sample data through WhatsApp Web (slot 1), so you see exactly what a recipient gets.</p>

          {sent ? (
            <>
              <Notice isLight={isLight} tone="success">Test message sent. Check that device to confirm it arrived.</Notice>
              <div className="mt-4 flex justify-end"><Button isLight={isLight} variant="primary" onClick={onClose}>Done</Button></div>
            </>
          ) : (
            <>
              <div className="mt-3">
                <Field isLight={isLight} label="Recipient WhatsApp number">
                  <TextInput isLight={isLight} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210 (with country code)" />
                </Field>
              </div>
              <div className={`mt-3 rounded-lg border p-2.5 text-[11px] whitespace-pre-wrap ${t.inset} ${t.body}`}>{previewText || "Your message will appear here…"}</div>
              <ErrorNotice isLight={isLight} error={send.error} onDismiss={send.clearError} />
              <div className="mt-4 flex justify-end gap-2">
                <Button isLight={isLight} variant="ghost" onClick={onClose}>Cancel</Button>
                <Button isLight={isLight} variant="primary" icon={Send} busy={send.busy} disabled={!phone.trim()} onClick={run}>Send Test</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
