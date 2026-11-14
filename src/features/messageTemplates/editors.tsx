/**
 * Builder editor components.
 *
 * Each editor owns one slice of the MessageTemplatePayload and reports changes
 * through onChange. They are deliberately dumb: no fetching, no persistence —
 * the parent builder holds the payload and decides when to save. This keeps the
 * live preview a pure function of the payload the parent passes down.
 */

import React, { useRef, useState } from "react";
import {
  Bold, Italic, Strikethrough, Smile, Braces, Plus, Trash2, ArrowUp, ArrowDown,
  Image as ImageIcon, Video, FileText, Type, X, Upload, Phone, ExternalLink, MessageCircle, Link2,
} from "lucide-react";
import { Button, Field, Select, TextArea, TextInput, Toggle, Badge, tokens, type Themed } from "../../ui/primitives";
import type {
  MessageTemplatePayload, TemplateHeader, TemplateAction, TemplateQuickReply,
  TemplateVariable, ActionType, HeaderType, DeliveryMethod,
} from "./api";
import {
  SYSTEM_VARIABLES, newId, HEADER_TEXT_MAX_CHARS, FOOTER_TEXT_MAX_CHARS,
  ACTION_LABEL_MAX_CHARS, QUICK_REPLY_MAX_CHARS, WHATSAPP_BODY_MAX_CHARS,
  MAX_ACTIONS_META, MAX_QUICK_REPLIES_META,
} from "./api";

const EMOJIS = ["👋", "😊", "🙏", "🎉", "✅", "⭐", "🔥", "💡", "📈", "🚀", "💬", "📞", "🌐", "🎓", "🛍️", "💇", "💪", "🍽️", "🏥", "❤️"];

type ChangePayload = (next: MessageTemplatePayload) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_TYPES: { value: HeaderType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "none", label: "No header", icon: X },
  { value: "text", label: "Text", icon: Type },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "video", label: "Video", icon: Video },
  { value: "document", label: "Document", icon: FileText },
];

export function HeaderEditor({ isLight, payload, onChange }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload }) {
  const t = tokens(isLight);
  const h = payload.header;
  const setHeader = (patch: Partial<TemplateHeader>) => onChange({ ...payload, header: { ...h, ...patch } });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {HEADER_TYPES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setHeader({ type: value })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
              h.type === value
                ? isLight ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                : `${t.inset} ${t.muted} hover:${t.body}`
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {h.type === "text" && (
        <Field isLight={isLight} label="Header text" hint={`${(h.text || "").length}/${HEADER_TEXT_MAX_CHARS}`}>
          <TextInput
            isLight={isLight}
            value={h.text || ""}
            maxLength={HEADER_TEXT_MAX_CHARS}
            onChange={(e) => setHeader({ text: e.target.value })}
            placeholder="e.g. Special Offer"
          />
        </Field>
      )}

      {(h.type === "image" || h.type === "video" || h.type === "document") && (
        <MediaUpload isLight={isLight} header={h} onChange={setHeader} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Media upload
// ─────────────────────────────────────────────────────────────────────────────

const MEDIA_LIMITS: Record<string, { accept: string; note: string }> = {
  image: { accept: "image/jpeg,image/png,image/webp", note: "JPG, PNG or WebP, up to 5 MB." },
  video: { accept: "video/mp4,video/3gpp", note: "MP4 or 3GP, up to 16 MB." },
  document: { accept: "application/pdf,.doc,.docx,.xls,.xlsx", note: "PDF, Word or Excel, up to 100 MB." },
};
const MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5 MB inline (data URL); larger needs a hosted URL.

export function MediaUpload({ isLight, header, onChange }: Themed & { header: TemplateHeader; onChange: (patch: Partial<TemplateHeader>) => void }) {
  const t = tokens(isLight);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const limit = MEDIA_LIMITS[header.type] || MEDIA_LIMITS.image;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setSizeError(null);
    if (file.size > MAX_INLINE_BYTES) {
      setSizeError(`"${file.name}" is too large to preview inline. Paste a hosted URL instead.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ mediaUrl: String(reader.result), mediaFileName: file.name, mediaMimeType: file.type });
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2.5">
      {header.mediaUrl ? (
        <div className={`rounded-lg border p-2.5 ${t.inset}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {header.type === "image"
                ? <ImageIcon className="h-4 w-4 text-indigo-500 shrink-0" />
                : header.type === "video"
                  ? <Video className="h-4 w-4 text-indigo-500 shrink-0" />
                  : <FileText className="h-4 w-4 text-indigo-500 shrink-0" />}
              <span className={`text-[11px] truncate ${t.body}`}>{header.mediaFileName || header.mediaUrl}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button isLight={isLight} variant="ghost" icon={Upload} onClick={() => inputRef.current?.click()}>Replace</Button>
              <Button isLight={isLight} variant="ghost" icon={Trash2} onClick={() => onChange({ mediaUrl: "", mediaFileName: "", mediaMimeType: "" })}>Remove</Button>
            </div>
          </div>
          {header.type === "image" && (
            <img src={header.mediaUrl} alt="" className="mt-2 max-h-28 rounded object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${isLight ? "border-slate-300 hover:border-indigo-400 bg-slate-50" : "border-[#1e293b] hover:border-indigo-500/40 bg-[#050811]"}`}
        >
          <Upload className="h-5 w-5 text-indigo-500" />
          <span className={`text-[11px] font-semibold ${t.body}`}>Upload a {header.type}</span>
          <span className={`text-[10px] ${t.faint}`}>{limit.note}</span>
        </button>
      )}

      <input ref={inputRef} type="file" accept={limit.accept} className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      <Field isLight={isLight} label="Or paste a hosted media URL">
        <TextInput isLight={isLight} value={header.mediaUrl?.startsWith("data:") ? "" : header.mediaUrl || ""} onChange={(e) => onChange({ mediaUrl: e.target.value })} placeholder="https://cdn.example.com/promo.jpg" />
      </Field>

      {header.type === "document" && (
        <Field isLight={isLight} label="Document file name">
          <TextInput isLight={isLight} value={header.mediaFileName || ""} onChange={(e) => onChange({ mediaFileName: e.target.value })} placeholder="brochure.pdf" />
        </Field>
      )}

      {(header.type === "image" || header.type === "video") && (
        <Field isLight={isLight} label="Caption (optional)">
          <TextInput isLight={isLight} value={header.mediaCaption || ""} onChange={(e) => onChange({ mediaCaption: e.target.value })} placeholder="Shown below the media" />
        </Field>
      )}

      {sizeError && <p className="text-[11px] text-rose-500">{sizeError}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Body (rich text with formatting + variable insert)
// ─────────────────────────────────────────────────────────────────────────────

export function BodyEditor({ isLight, payload, onChange }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload }) {
  const t = tokens(isLight);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const text = payload.body.text;

  const setText = (next: string) => onChange({ ...payload, body: { text: next.slice(0, WHATSAPP_BODY_MAX_CHARS) } });

  /** Insert a snippet at the cursor, wrapping the selection for formatting marks. */
  const insert = (before: string, after = "", placeholder = "") => {
    const el = ref.current;
    if (!el) { setText(text + before + placeholder + after); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const selected = text.slice(start, end) || placeholder;
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + before.length + selected.length + after.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toolBtn = `flex h-7 w-7 items-center justify-center rounded-md border transition-colors cursor-pointer ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-100" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={toolBtn} title="Bold" onClick={() => insert("*", "*", "bold")}><Bold className="h-3.5 w-3.5" /></button>
        <button className={toolBtn} title="Italic" onClick={() => insert("_", "_", "italic")}><Italic className="h-3.5 w-3.5" /></button>
        <button className={toolBtn} title="Strikethrough" onClick={() => insert("~", "~", "strike")}><Strikethrough className="h-3.5 w-3.5" /></button>
        <div className="relative">
          <button className={toolBtn} title="Emoji" onClick={() => { setShowEmoji((v) => !v); setShowVars(false); }}><Smile className="h-3.5 w-3.5" /></button>
          {showEmoji && (
            <div className={`absolute z-20 mt-1 grid grid-cols-5 gap-1 rounded-lg border p-2 shadow-lg ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
              {EMOJIS.map((e) => (
                <button key={e} className="h-7 w-7 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-base cursor-pointer" onClick={() => { insert(e); setShowEmoji(false); }}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button className={`${toolBtn} w-auto gap-1 px-2`} title="Insert variable" onClick={() => { setShowVars((v) => !v); setShowEmoji(false); }}>
            <Braces className="h-3.5 w-3.5" /><span className="text-[10px] font-semibold">Variable</span>
          </button>
          {showVars && (
            <div className={`absolute z-20 mt-1 max-h-56 w-52 overflow-y-auto rounded-lg border p-1 shadow-lg ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
              {(payload.variables.length ? payload.variables : SYSTEM_VARIABLES).map((v) => (
                <button key={v.key} className={`block w-full rounded px-2 py-1 text-left text-[11px] cursor-pointer ${isLight ? "hover:bg-slate-100" : "hover:bg-slate-800"}`} onClick={() => { insert(`{{${v.key}}}`); setShowVars(false); }}>
                  <span className="font-mono text-indigo-500">{`{{${v.key}}}`}</span>
                  <span className={`ml-1.5 ${t.faint}`}>{v.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <TextArea
        ref={ref as any}
        isLight={isLight}
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Hi {{first_name}} 👋\n\nWrite your message here. Use *bold*, _italic_ and variables like {{company_name}}."}
      />
      <div className="flex items-center justify-between">
        <span className={`text-[10px] ${t.faint}`}>Markdown: *bold* _italic_ ~strike~</span>
        <span className={`text-[10px] ${text.length > WHATSAPP_BODY_MAX_CHARS * 0.9 ? "text-amber-500" : t.faint}`}>{text.length}/{WHATSAPP_BODY_MAX_CHARS}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

export function FooterEditor({ isLight, payload, onChange }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload }) {
  const f = payload.footer;
  return (
    <div className="space-y-2.5">
      <Toggle isLight={isLight} checked={f.enabled} onChange={(enabled) => onChange({ ...payload, footer: { ...f, enabled } })} label="Add a footer line" hint="A short sign-off or opt-out note." />
      {f.enabled && (
        <Field isLight={isLight} label="Footer text" hint={`${f.text.length}/${FOOTER_TEXT_MAX_CHARS}`}>
          <TextInput isLight={isLight} value={f.text} maxLength={FOOTER_TEXT_MAX_CHARS} onChange={(e) => onChange({ ...payload, footer: { ...f, text: e.target.value } })} placeholder="e.g. Reply STOP to opt out." />
        </Field>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions (CTA builder)
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TYPES: { value: ActionType; label: string; icon: React.ComponentType<{ className?: string }>; placeholder: string; valueLabel: string }[] = [
  { value: "url", label: "Visit Website", icon: ExternalLink, placeholder: "https://example.com", valueLabel: "URL" },
  { value: "phone", label: "Call Phone", icon: Phone, placeholder: "+919876543210", valueLabel: "Phone number" },
  { value: "whatsapp_link", label: "WhatsApp Chat", icon: MessageCircle, placeholder: "https://wa.me/919876543210", valueLabel: "wa.me link" },
  { value: "custom_url", label: "Custom Link", icon: Link2, placeholder: "https://example.com/book", valueLabel: "URL" },
];

export function ActionBuilder({ isLight, payload, onChange, deliveryMethod }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload; deliveryMethod: DeliveryMethod }) {
  const t = tokens(isLight);
  const actions = payload.actions;
  const atCap = deliveryMethod === "cloud_api" && actions.length >= MAX_ACTIONS_META;

  const setActions = (next: TemplateAction[]) => onChange({ ...payload, actions: next });
  const add = () => setActions([...actions, { id: newId("a"), type: "url", label: "Visit Website", value: "" }]);
  const update = (id: string, patch: Partial<TemplateAction>) => setActions(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const remove = (id: string) => setActions(actions.filter((a) => a.id !== id));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    setActions(next);
  };

  return (
    <div className="space-y-2.5">
      {actions.map((a, i) => {
        const typeDef = ACTION_TYPES.find((x) => x.value === a.type) || ACTION_TYPES[0];
        return (
          <div key={a.id} className={`rounded-lg border p-2.5 space-y-2 ${t.inset}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <typeDef.icon className="h-3.5 w-3.5 text-indigo-500" />
                <span className={`text-[11px] font-bold ${t.body}`}>Action {i + 1}</span>
              </div>
              <div className="flex items-center gap-1">
                <button className={`p-1 rounded cursor-pointer ${t.muted} hover:${t.body} disabled:opacity-30`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></button>
                <button className={`p-1 rounded cursor-pointer ${t.muted} hover:${t.body} disabled:opacity-30`} disabled={i === actions.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></button>
                <button className="p-1 rounded cursor-pointer text-rose-400 hover:text-rose-500" onClick={() => remove(a.id)}><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field isLight={isLight} label="Type">
                <Select isLight={isLight} value={a.type} onChange={(e) => update(a.id, { type: e.target.value as ActionType })}>
                  {ACTION_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </Select>
              </Field>
              <Field isLight={isLight} label="Button label" hint={`${a.label.length}/${ACTION_LABEL_MAX_CHARS}`}>
                <TextInput isLight={isLight} value={a.label} maxLength={ACTION_LABEL_MAX_CHARS} onChange={(e) => update(a.id, { label: e.target.value })} placeholder={typeDef.label} />
              </Field>
            </div>
            <Field isLight={isLight} label={typeDef.valueLabel} hint="Variables are allowed in URLs, e.g. https://x.com/{{company_name}}">
              <TextInput isLight={isLight} value={a.value} onChange={(e) => update(a.id, { value: e.target.value })} placeholder={typeDef.placeholder} />
            </Field>
          </div>
        );
      })}

      <Button isLight={isLight} variant="secondary" icon={Plus} onClick={add} disabled={atCap}>
        Add Action
      </Button>
      {atCap && <p className={`text-[10px] ${t.faint}`}>Meta Cloud API allows up to {MAX_ACTIONS_META} buttons.</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick replies
// ─────────────────────────────────────────────────────────────────────────────

export function QuickReplyBuilder({ isLight, payload, onChange, deliveryMethod }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload; deliveryMethod: DeliveryMethod }) {
  const t = tokens(isLight);
  const replies = payload.quickReplies;
  const atCap = deliveryMethod === "cloud_api" && replies.length >= MAX_QUICK_REPLIES_META;

  const setReplies = (next: TemplateQuickReply[]) => onChange({ ...payload, quickReplies: next });
  const add = () => setReplies([...replies, { id: newId("qr"), display: "", payload: "" }]);
  const update = (id: string, patch: Partial<TemplateQuickReply>) => setReplies(replies.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const remove = (id: string) => setReplies(replies.filter((q) => q.id !== id));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= replies.length) return;
    const next = [...replies];
    [next[i], next[j]] = [next[j], next[i]];
    setReplies(next);
  };

  return (
    <div className="space-y-2.5">
      {deliveryMethod === "web" && replies.length > 0 && (
        <p className={`text-[10px] ${t.faint}`}>On WhatsApp Web these appear as text instructions — recipients type their reply.</p>
      )}
      {replies.map((q, i) => (
        <div key={q.id} className={`flex items-center gap-2 rounded-lg border p-2 ${t.inset}`}>
          <div className="flex flex-col gap-0.5">
            <button className={`p-0.5 rounded cursor-pointer ${t.muted} disabled:opacity-30`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></button>
            <button className={`p-0.5 rounded cursor-pointer ${t.muted} disabled:opacity-30`} disabled={i === replies.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></button>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2">
            <TextInput isLight={isLight} value={q.display} maxLength={QUICK_REPLY_MAX_CHARS} onChange={(e) => update(q.id, { display: e.target.value, payload: q.payload || e.target.value.toUpperCase().replace(/\s+/g, "_") })} placeholder="Interested" />
            <TextInput isLight={isLight} value={q.payload} onChange={(e) => update(q.id, { payload: e.target.value.toUpperCase().replace(/\s+/g, "_") })} placeholder="INTERESTED" />
          </div>
          <button className="p-1 rounded cursor-pointer text-rose-400 hover:text-rose-500" onClick={() => remove(q.id)}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button isLight={isLight} variant="secondary" icon={Plus} onClick={add} disabled={atCap}>Add Quick Reply</Button>
        <span className={`text-[10px] ${t.faint}`}>Display · internal payload value</span>
      </div>
      {atCap && <p className={`text-[10px] ${t.faint}`}>Meta Cloud API allows up to {MAX_QUICK_REPLIES_META} quick replies.</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable manager
// ─────────────────────────────────────────────────────────────────────────────

export function VariableManager({ isLight, payload, onChange }: Themed & { payload: MessageTemplatePayload; onChange: ChangePayload }) {
  const t = tokens(isLight);
  const [newKey, setNewKey] = useState("");
  const vars = payload.variables;

  const setVars = (next: TemplateVariable[]) => onChange({ ...payload, variables: next });
  const addCustom = () => {
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!key || vars.some((v) => v.key === key)) { setNewKey(""); return; }
    setVars([...vars, { key, label: key.replace(/_/g, " "), sampleValue: "", isCustom: true }]);
    setNewKey("");
  };
  const addSystem = (key: string) => {
    const sys = SYSTEM_VARIABLES.find((v) => v.key === key);
    if (!sys || vars.some((v) => v.key === key)) return;
    setVars([...vars, sys]);
  };
  const update = (key: string, patch: Partial<TemplateVariable>) => setVars(vars.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const remove = (key: string) => setVars(vars.filter((v) => v.key !== key));

  const unusedSystem = SYSTEM_VARIABLES.filter((s) => !vars.some((v) => v.key === s.key));

  return (
    <div className="space-y-3">
      <p className={`text-[11px] ${t.muted}`}>Variables personalise the message per contact. Sample values drive the live preview.</p>

      <div className="space-y-1.5">
        {vars.map((v) => (
          <div key={v.key} className={`flex items-center gap-2 rounded-lg border p-2 ${t.inset}`}>
            <code className="shrink-0 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-mono text-indigo-500">{`{{${v.key}}}`}</code>
            <TextInput isLight={isLight} value={v.sampleValue} onChange={(e) => update(v.key, { sampleValue: e.target.value })} placeholder={`Sample for ${v.label}`} className="flex-1" />
            {v.isCustom && <Badge isLight={isLight} tone="info">custom</Badge>}
            <button className="p-1 rounded cursor-pointer text-rose-400 hover:text-rose-500" onClick={() => remove(v.key)}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <TextInput isLight={isLight} value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} placeholder="Add custom variable, e.g. clinic_name" className="flex-1" />
        <Button isLight={isLight} variant="secondary" icon={Plus} onClick={addCustom}>Add</Button>
      </div>

      {unusedSystem.length > 0 && (
        <div>
          <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${t.faint}`}>Quick add</div>
          <div className="flex flex-wrap gap-1.5">
            {unusedSystem.map((s) => (
              <button key={s.key} onClick={() => addSystem(s.key)} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-100" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"}`}>
                + {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
