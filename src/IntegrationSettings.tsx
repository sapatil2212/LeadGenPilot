/**
 * Integration Settings Component
 * Allows users to configure their own SMTP, Google Sheets, and WhatsApp integrations
 */

import React, { useState, useEffect } from "react";
import WhatsAppLogo from "./WhatsAppLogo";
import { ModalPortal } from "./ui/primitives";
import { 
  Mail, 
  FileSpreadsheet, 
  MessageCircle, 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Check, 
  X, 
  Loader2, 
  Key, 
  Power, 
  Edit2, 
  AlertTriangle, 
  ExternalLink, 
  Sparkles, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  FileCode,
  Smartphone
} from "lucide-react";

interface Integration {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface SMTPFormData {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
  label: string;
}

interface GoogleSheetFormData {
  webhookUrl: string;
  sheetName: string;
  label: string;
}


/** Per-slot WhatsApp session status for the multi-account gateway. */
export interface WhatsAppSessionStatus {
  slot: number;
  status: string;
  qr: string;
  qrDataUrl?: string;
  error?: string;
  /** Linked account's phone number (digits only), once connected. */
  phoneNumber?: string;
  /** Linked account's WhatsApp profile name, once connected. */
  pushName?: string;
  /** WhatsApp offline-sync progress while authenticating (0-100). */
  loadingPercent?: number;
  /** Credentials exist on disk, so this slot auto-restores after a restart. */
  hasSavedSession?: boolean;
}

/**
 * Normalise a user-entered phone number the same way the server does, so the
 * modal can reject bad input before a request is made. Mirrors
 * formatWhatsAppJid in outreachService.ts.
 */
function normalizeWhatsAppNumber(input: string): { ok: boolean; digits?: string; error?: string } {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, error: "Enter the WhatsApp number to send the test to." };
  if (/[a-zA-Z]/.test(raw)) {
    return { ok: false, error: "Numbers only. Include the country code, for example 919876543210." };
  }

  let cleaned = raw.replace(/[^0-9]/g, "");
  if (!cleaned) return { ok: false, error: "Enter digits only, including the country code." };
  if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);
  if (cleaned.startsWith("910") && cleaned.length === 13) cleaned = "91" + cleaned.substring(3);
  if (cleaned.length === 10) cleaned = "91" + cleaned;

  if (cleaned.length < 10 || cleaned.length > 15) {
    return { ok: false, error: "That does not look like a valid number. Use the country code, e.g. 919876543210." };
  }
  return { ok: true, digits: cleaned };
}

const DEFAULT_TEST_MESSAGE =
  "Hello from LeadGenPilot! This is a test outreach message verifying your gateway connection. 🚀";

/** Max characters WhatsApp accepts in a single text message. */
const WHATSAPP_MAX_CHARS = 4096;

/**
 * Dialog for sending a test WhatsApp message from a specific linked account.
 * Replaces the old window.prompt, which accepted any string (including "test")
 * and only failed server-side.
 */
function WhatsAppTestModal({
  isLight,
  slot,
  fromNumber,
  isSending,
  onCancel,
  onSend,
}: {
  isLight: boolean;
  slot: number;
  fromNumber?: string;
  isSending: boolean;
  onCancel: () => void;
  onSend: (slot: number, phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(DEFAULT_TEST_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const parsed = normalizeWhatsAppNumber(phone);
    if (!parsed.ok) {
      setError(parsed.error || "Enter a valid WhatsApp number.");
      return;
    }
    if (!message.trim()) {
      setError("Enter the message you want to send.");
      return;
    }
    const result = await onSend(slot, parsed.digits!, message.trim());
    if (result.ok) {
      setSent(parsed.digits!);
    } else {
      setError(result.error || "Could not send the test message.");
    }
  };

  const inputClass = `w-full text-xs border rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500 ${
    isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#030712] border-[#1e293b] text-white"
  }`;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
        onMouseDown={onCancel}
        role="dialog"
        aria-modal="true"
        aria-label={`Send a test WhatsApp message from account ${slot}`}
      >
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className={`border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-scaleUp ${
            isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
          }`}
        >
          <h3 className={`text-base font-bold mb-1 flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
            <Smartphone className="h-5 w-5 text-indigo-400" /> Send Test Message
          </h3>
          <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
            Sends from <strong className={isLight ? "text-slate-700" : "text-slate-200"}>
              WhatsApp Account {slot}{fromNumber ? ` (+${fromNumber})` : ""}
            </strong>. Use it to confirm the gateway can deliver before launching a campaign.
          </p>

          {sent ? (
            <>
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed mb-4 ${
                isLight ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
              }`}>
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Message sent to +{sent}.</span>{" "}
                  Check that device to confirm it arrived.
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <label className={`block text-[11px] font-bold mb-1.5 ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                Recipient WhatsApp number
              </label>
              <input
                autoFocus
                type="tel"
                inputMode="numeric"
                placeholder="919876543210 (with country code)"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
                className={inputClass}
                disabled={isSending}
              />
              <p className="text-[10px] text-slate-500 mt-1 mb-3">
                Digits only, including country code. A 10-digit number assumes +91.
              </p>

              <label className={`block text-[11px] font-bold mb-1.5 ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                Message
              </label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => { setMessage(e.target.value.slice(0, WHATSAPP_MAX_CHARS)); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
                placeholder="Type the message to send..."
                className={`${inputClass} resize-y leading-relaxed`}
                disabled={isSending}
              />
              <div className="flex items-center justify-between mt-1 mb-3">
                <button
                  type="button"
                  onClick={() => setMessage(DEFAULT_TEST_MESSAGE)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                >
                  Reset to default
                </button>
                <span className={`text-[10px] ${message.length >= WHATSAPP_MAX_CHARS ? "text-rose-400" : "text-slate-500"}`}>
                  {message.length}/{WHATSAPP_MAX_CHARS}
                </span>
              </div>

              {error && (
                <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed mb-3 ${
                  isLight ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-rose-500/5 border-rose-500/20 text-rose-300"
                }`}>
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={onCancel}
                  disabled={isSending}
                  className={`px-4 py-2 border rounded-lg text-xs cursor-pointer transition-all disabled:opacity-50 ${
                    isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={isSending || !phone.trim() || !message.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isSending ? "Sending..." : "Send Test Message"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

/** Maximum SMTP sender accounts that can be configured at once. */
const MAX_SMTP_SLOTS = 5;

/** One configured SMTP sender slot, as listed by /api/integrations/senders/email. */
export interface SmtpSender {
  id: string;
  type: string;
  label: string | null;
  slot: number;
  enabled: boolean;
}

/**
 * Card for a single SMTP sender slot (1-5). Renders either a configured
 * account with manage actions, or an empty slot inviting the user to add one.
 */
interface SmtpSenderCardProps {
  key?: React.Key;
  isLight: boolean;
  slot: number;
  sender?: SmtpSender;
  busy: boolean;
  onAdd: (slot: number) => void;
  onEdit: (sender: SmtpSender) => void;
  onTest: (sender: SmtpSender) => void;
  onSendTestEmail: (sender: SmtpSender) => void;
  onToggle: (sender: SmtpSender) => void;
  onDelete: (sender: SmtpSender) => void;
}

function SmtpSenderCard({
  isLight,
  slot,
  sender,
  busy,
  onAdd,
  onEdit,
  onTest,
  onSendTestEmail,
  onToggle,
  onDelete,
}: SmtpSenderCardProps) {
  if (!sender) {
    return (
      <div className={`border border-dashed rounded-xl p-4 flex items-center justify-between gap-3 ${
        isLight ? "bg-slate-50/60 border-slate-300" : "bg-[#070b12] border-[#1e293b]"
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            isLight ? "bg-slate-200/70" : "bg-slate-800/60"
          }`}>
            <Mail className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h4 className={`text-xs font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>
              SMTP Account {slot}
              {slot === 1 && <span className="ml-1.5 text-[9px] font-semibold text-indigo-400">(Primary)</span>}
            </h4>
            <p className="text-[9.5px] text-slate-500 mt-0.5">Not configured</p>
          </div>
        </div>
        <button
          onClick={() => onAdd(slot)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3 h-3" />
          Add Account
        </button>
      </div>
    );
  }

  return (
    <div className={`border rounded-xl p-4 ${
      isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
    }`}>
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <h4 className={`text-xs font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
              {sender.label || `SMTP Account ${slot}`}
              {slot === 1 && <span className="ml-1.5 text-[9px] font-semibold text-indigo-400">(Primary)</span>}
            </h4>
            <p className="text-[9.5px] text-slate-500 mt-0.5">
              Slot {slot} · {sender.enabled ? "In rotation" : "Excluded from rotation"}
            </p>
          </div>
        </div>

        <button
          onClick={() => onToggle(sender)}
          disabled={busy}
          className={`px-2.5 py-1 rounded-lg text-[9.5px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50 ${
            sender.enabled
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-slate-500/10 border-slate-500/20 text-slate-400"
          }`}
        >
          <Power className="w-3 h-3" />
          {sender.enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap mt-3.5 pt-3 border-t border-slate-200/20">
        <button
          onClick={() => onEdit(sender)}
          disabled={busy}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
            isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-800 text-slate-300 hover:bg-slate-800/60"
          }`}
        >
          <Edit2 className="w-3 h-3 text-indigo-400" />
          Edit
        </button>
        <button
          onClick={() => onTest(sender)}
          disabled={busy}
          title="Check the credentials authenticate, without sending anything"
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
            isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-800 text-slate-300 hover:bg-slate-800/60"
          }`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-emerald-500" />}
          Verify
        </button>
        <button
          onClick={() => onSendTestEmail(sender)}
          disabled={busy}
          title="Deliver a real test email from this account"
          className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/25 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
        >
          <Mail className="w-3 h-3" />
          Send Test Email
        </button>
        <button
          onClick={() => onDelete(sender)}
          disabled={busy}
          className="ml-auto px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      </div>
    </div>
  );
};

const DEFAULT_TEST_EMAIL_SUBJECT = "LeadGenPilot test email";
const DEFAULT_TEST_EMAIL_BODY =
  "This is a test email from LeadGenPilot confirming this SMTP account can deliver outreach messages.";

/**
 * Dialog for sending a real test email from one SMTP slot.
 *
 * Separate from the connection check: verify() only proves the credentials
 * authenticate, while this proves a message actually leaves and arrives.
 */
function SmtpTestEmailModal({
  isLight,
  slot,
  label,
  isSending,
  onCancel,
  onSend,
}: {
  isLight: boolean;
  slot: number;
  label?: string | null;
  isSending: boolean;
  onCancel: () => void;
  onSend: (to: string, subject: string, message: string) => Promise<{ ok: boolean; error?: string; sentFrom?: string }>;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(DEFAULT_TEST_EMAIL_SUBJECT);
  const [body, setBody] = useState(DEFAULT_TEST_EMAIL_BODY);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; from?: string } | null>(null);

  const submit = async () => {
    setError(null);
    const recipient = to.trim();
    if (!recipient) { setError("Enter the email address to send the test to."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) { setError("That is not a valid email address."); return; }
    if (!subject.trim()) { setError("Enter a subject."); return; }
    if (!body.trim()) { setError("Enter the message you want to send."); return; }

    const result = await onSend(recipient, subject.trim(), body.trim());
    if (result.ok) setSent({ to: recipient, from: result.sentFrom });
    else setError(result.error || "Could not send the test email.");
  };

  const inputClass = `w-full text-xs border rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500 ${
    isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#030712] border-[#1e293b] text-white"
  }`;
  const labelClass = `block text-[11px] font-bold mb-1.5 ${isLight ? "text-slate-700" : "text-slate-300"}`;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn"
        onMouseDown={onCancel}
        role="dialog"
        aria-modal="true"
        aria-label={`Send a test email from SMTP account ${slot}`}
      >
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className={`border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-scaleUp my-auto ${
            isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
          }`}
        >
          <h3 className={`text-base font-bold mb-1 flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
            <Mail className="h-5 w-5 text-indigo-400" /> Send Test Email
          </h3>
          <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
            Sends from <strong className={isLight ? "text-slate-700" : "text-slate-200"}>
              SMTP Account {slot}{label ? ` (${label})` : ""}
            </strong> using the same mail path campaigns use, so a success here means outreach will deliver.
          </p>

          {sent ? (
            <>
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed mb-4 ${
                isLight ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
              }`}>
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Test email sent to {sent.to}.</span>{" "}
                  {sent.from ? `It was sent from ${sent.from}. ` : ""}
                  Check the inbox, and the spam folder if it is not there.
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <label className={labelClass}>Recipient email</label>
              <input
                autoFocus
                type="email"
                placeholder="you@example.com"
                value={to}
                onChange={(e) => { setTo(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
                className={inputClass}
                disabled={isSending}
              />

              <label className={`${labelClass} mt-3`}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => { setSubject(e.target.value.slice(0, 500)); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
                className={inputClass}
                disabled={isSending}
              />

              <label className={`${labelClass} mt-3`}>Message</label>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => { setBody(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
                placeholder="Type the email body..."
                className={`${inputClass} resize-y leading-relaxed`}
                disabled={isSending}
              />
              <div className="flex items-center justify-between mt-1 mb-3">
                <button
                  type="button"
                  onClick={() => { setSubject(DEFAULT_TEST_EMAIL_SUBJECT); setBody(DEFAULT_TEST_EMAIL_BODY); }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                >
                  Reset to default
                </button>
                <span className="text-[10px] text-slate-500">{body.length} characters</span>
              </div>

              {error && (
                <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed mb-3 ${
                  isLight ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-rose-500/5 border-rose-500/20 text-rose-300"
                }`}>
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={onCancel}
                  disabled={isSending}
                  className={`px-4 py-2 border rounded-lg text-xs cursor-pointer transition-all disabled:opacity-50 ${
                    isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={isSending || !to.trim() || !subject.trim() || !body.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isSending ? "Sending..." : "Send Test Email"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Add/edit dialog for one SMTP sender slot.
 *
 * Validates the same fields the server requires (host, user, password,
 * fromEmail, and an integer port) so a bad config cannot be saved. That matters
 * because an unusable stored config does not fail loudly at send time — every
 * message routed to that slot fails with a generic "email is not configured".
 */
function SmtpSenderModal({
  isLight,
  slot,
  mode,
  initial,
  busy,
  onCancel,
  onSubmit,
  onTestDraft,
}: {
  isLight: boolean;
  slot: number;
  mode: "add" | "edit";
  initial?: SMTPFormData;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: SMTPFormData) => Promise<{ ok: boolean; error?: string }>;
  onTestDraft: (form: SMTPFormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [form, setForm] = useState<SMTPFormData>(
    initial || {
      host: "",
      port: "587",
      secure: false,
      user: "",
      password: "",
      fromEmail: "",
      fromName: "",
      label: `SMTP Account ${slot}`,
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const set = (patch: Partial<SMTPFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
    setNotice(null);
  };

  /** Mirror of the server's validation so errors appear before a round trip. */
  const validate = (): string | null => {
    if (!form.host.trim()) return "SMTP host is required.";
    if (!form.user.trim()) return "SMTP username is required.";
    if (!form.password) return "SMTP password is required.";
    if (!form.fromEmail.trim()) return "From email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromEmail.trim())) return "From email is not a valid address.";
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port must be a whole number between 1 and 65535.";
    return null;
  };

  const handleSave = async () => {
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    const result = await onSubmit(form);
    if (!result.ok) setError(result.error || "Could not save this SMTP account.");
  };

  const handleTest = async () => {
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    setNotice(null);
    const result = await onTestDraft(form);
    if (result.ok) setNotice("Connection successful. These credentials work.");
    else setError(result.error || "Connection failed.");
  };

  const inputClass = `w-full px-2.5 py-2 rounded-lg border text-xs focus:outline-none focus:border-indigo-500 ${
    isLight ? "bg-white border-slate-200 text-slate-900" : "bg-[#030712] border-slate-700 text-white"
  }`;
  const labelClass = "block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1";

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn"
        onMouseDown={onCancel}
        role="dialog"
        aria-modal="true"
        aria-label={`${mode === "add" ? "Add" : "Edit"} SMTP account ${slot}`}
      >
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className={`border rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-scaleUp my-auto ${
            isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
          }`}
        >
          <h3 className={`text-base font-bold mb-1 flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
            <Key className="h-4.5 w-4.5 text-indigo-400" />
            {mode === "add" ? `Add SMTP Account ${slot}` : `Edit SMTP Account ${slot}`}
          </h3>
          <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
            Campaigns rotate email sends across every enabled account to spread volume and protect deliverability.
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={labelClass}>SMTP Host</label>
                <input type="text" value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" className={inputClass} disabled={busy} />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input type="number" value={form.port} onChange={(e) => set({ port: e.target.value })} placeholder="587" className={inputClass} disabled={busy} />
              </div>
            </div>

            <label className="flex items-center gap-2 py-0.5 cursor-pointer">
              <input type="checkbox" checked={form.secure} onChange={(e) => set({ secure: e.target.checked })} className="rounded accent-indigo-600" disabled={busy} />
              <span className={`text-[11px] font-semibold ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                Use SSL/TLS (typically port 465)
              </span>
            </label>

            <div>
              <label className={labelClass}>Username / Email</label>
              <input type="text" value={form.user} onChange={(e) => set({ user: e.target.value })} placeholder="yourname@gmail.com" className={inputClass} disabled={busy} />
            </div>

            <div>
              <label className={labelClass}>Password / App Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  placeholder="App password"
                  className={`${inputClass} pr-9`}
                  disabled={busy}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              {mode === "edit" && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Leave the masked value untouched to keep the saved password.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>From Email</label>
                <input type="email" value={form.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder="noreply@domain.com" className={inputClass} disabled={busy} />
              </div>
              <div>
                <label className={labelClass}>From Name</label>
                <input type="text" value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="e.g. Sales Team" className={inputClass} disabled={busy} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Label</label>
              <input type="text" value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Gmail Sales Inbox" className={inputClass} disabled={busy} />
            </div>

            <p className="text-[10px] text-slate-500 leading-relaxed">
              Note: messages are always sent from the SMTP username's address. "From Name" sets the display name.
            </p>

            {error && (
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
                isLight ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-rose-500/5 border-rose-500/20 text-rose-300"
              }`}>
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
                isLight ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
              }`}>
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{notice}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-200/20">
              <button
                onClick={onCancel}
                disabled={busy}
                className={`px-4 py-2 border rounded-lg text-xs cursor-pointer transition-all disabled:opacity-50 ${
                  isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleTest()}
                disabled={busy}
                className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                Test Connection
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={busy}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {mode === "add" ? "Add Account" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/** Human-readable label for each session state. */
function sessionStateLabel(status: string): string {
  switch (status) {
    case "CONNECTED": return "WHATSAPP CONNECTED";
    case "AUTHENTICATING": return "SYNCING";
    case "QR_READY": return "WAITING FOR SCAN";
    case "CONNECTING": return "STARTING";
    default: return "NOT CONNECTED";
  }
}

interface IntegrationSettingsProps {
  isLight: boolean;
  canWhatsapp?: boolean;
  whatsappStatus: { status: string; qr: string; qrDataUrl?: string; error?: string };
  /**
   * Status of every WhatsApp account slot (1-5). When provided, the UI renders
   * one gateway card per slot so a workspace can link up to five business lines.
   * Falls back to the single `whatsappStatus` (as slot 1) when absent.
   */
  whatsappSessions?: WhatsAppSessionStatus[];
  onInitializeWhatsApp: (slot?: number) => Promise<void>;
  onDisconnectWhatsApp: (slot?: number) => Promise<void>;
  /**
   * Sends a test message and resolves with the outcome, so the dialog can show
   * the specific failure reason inline instead of raising a browser alert.
   */
  onSendWhatsAppTest: (slot: number, phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
  isSendingTestMsg: boolean;
  isDisconnectingWa: boolean;
  /** The slot currently performing a disconnect, for per-card button state. */
  disconnectingSlot?: number | null;
  webhookConfigured: boolean;
  onWebhookConfiguredChange: (val: boolean) => void;
  onIntegrationsChange?: () => void;
  onRequestPricingModal?: () => void;
}

/** Maximum WhatsApp accounts that can be linked at once. */
const MAX_WHATSAPP_SLOTS = 5;

/**
 * A single WhatsApp Web gateway session card (one linked account / slot).
 * Rendered up to five times so a workspace can authenticate multiple business
 * lines that outreach campaigns rotate across.
 */
interface WhatsAppSessionCardProps {
  isLight: boolean;
  session: WhatsAppSessionStatus;
  onInitialize: (slot: number) => void;
  onDisconnect: (slot: number) => void;
  onSendTest: (slot: number) => void;
  isSendingTestMsg: boolean;
  isDisconnecting: boolean;
}

const WhatsAppSessionCard: React.FC<WhatsAppSessionCardProps> = ({
  isLight,
  session,
  onInitialize,
  onDisconnect,
  onSendTest,
  isSendingTestMsg,
  isDisconnecting,
}) => {
  const slot = session.slot;
  return (
    <div className={`border rounded-xl p-4 sm:p-4.5 space-y-3.5 ${
      isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
    }`}>
      <div className={`flex items-center justify-between pb-2.5 border-b ${
        isLight ? "border-slate-200" : "border-[#1e293b]/60"
      }`}>
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-indigo-400" />
          <h3 className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white"}`}>
            WhatsApp Account {slot}
            {slot === 1 && <span className="ml-1.5 text-[9px] font-semibold text-indigo-400">(Primary)</span>}
          </h3>
        </div>

        {session.status === "CONNECTED" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSendTest(slot)}
              disabled={isSendingTestMsg}
              className="px-3 py-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/25 font-bold text-[9.5px] rounded-lg cursor-pointer transition-all disabled:opacity-50"
            >
              {isSendingTestMsg ? "Sending Test..." : "Send Test Message"}
            </button>
            <button
              onClick={() => onDisconnect(slot)}
              disabled={isDisconnecting}
              className="px-3 py-1 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 font-bold text-[9.5px] rounded-lg cursor-pointer transition-all disabled:opacity-50"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row items-center gap-6 py-1">
        <div className="flex-1 space-y-3 font-sans">
          <p className={`text-xs leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            Authenticates a virtual headless browser with WhatsApp Web. Once authenticated, outreach campaigns can dispatch customized messages directly to business lines, rotating across every linked account.
          </p>

          {session.error && (
            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
              isLight
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-amber-500/5 border-amber-500/20 text-amber-300"
            }`}>
              <span className="shrink-0 mt-0.5">⚠️</span>
              <div>
                <span className="font-bold">Gateway Unavailable — </span>
                {session.error}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Connection state:</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[9.5px] tracking-wide ${
                session.status === "CONNECTED" ? "bg-emerald-500/10 text-emerald-400" :
                session.status === "CONNECTING" ? "bg-indigo-500/10 text-indigo-400 animate-pulse" :
                session.status === "AUTHENTICATING" ? "bg-sky-500/10 text-sky-400 animate-pulse" :
                session.status === "QR_READY" ? "bg-amber-500/10 text-amber-400" :
                "bg-slate-500/10 text-slate-400"
              }`}>
                {sessionStateLabel(session.status)}
              </span>
            </div>

            {/* Once linked, say exactly WHICH number is connected. */}
            {session.status === "CONNECTED" && (
              <div className={`flex items-center gap-2 p-2 rounded-lg border text-[11px] ${
                isLight ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
              }`}>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span className="font-bold">
                  WhatsApp connected
                  {session.phoneNumber ? ` — +${session.phoneNumber}` : ""}
                  {session.pushName ? ` (${session.pushName})` : ""}
                </span>
              </div>
            )}

            {session.status === "AUTHENTICATING" && (
              <div className="text-[10.5px] text-sky-400 font-sans">
                Scan accepted. WhatsApp is syncing this account
                {session.loadingPercent ? ` (${session.loadingPercent}%)` : ""}. This can take up to a minute.
              </div>
            )}

            {session.status === "DISCONNECTED" && session.hasSavedSession && (
              <div className="text-[10.5px] text-slate-400 font-sans">
                A saved login exists for this account; it reconnects automatically on server start.
              </div>
            )}
          </div>

          <div className="pt-1 flex gap-2">
            {session.status === "DISCONNECTED" && (
              <button
                onClick={() => onInitialize(slot)}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs shadow-indigo-600/20"
              >
                {slot === 1 ? "Initialize Gateway" : `Link Account ${slot}`}
              </button>
            )}

            {(session.status === "QR_READY" || session.status === "AUTHENTICATING") && (
              <button
                onClick={() => onInitialize(slot)}
                className="px-3.5 py-1.5 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg cursor-pointer transition-all"
              >
                Regenerate QR Code
              </button>
            )}

            {/* A stuck session can always be torn down and retried. */}
            {session.status !== "DISCONNECTED" && session.status !== "CONNECTED" && (
              <button
                onClick={() => onDisconnect(slot)}
                disabled={isDisconnecting}
                className="px-3.5 py-1.5 bg-slate-600/10 hover:bg-slate-600/20 text-slate-400 border border-slate-500/20 text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
              >
                {isDisconnecting ? "Resetting..." : "Reset"}
              </button>
            )}
          </div>
        </div>

        {/* QR view. Hidden once the scan is accepted — showing a dead QR while
            WhatsApp syncs is what made the old UI look permanently stuck. */}
        {session.status !== "CONNECTED" && (
          <div className="shrink-0 flex items-center justify-center p-3 bg-white rounded-xl border border-slate-200 w-44 h-44 shadow-md relative">
            {session.status === "AUTHENTICATING" ? (
              <div className="space-y-2 flex flex-col items-center text-center">
                <Loader2 className="h-6 w-6 text-sky-600 animate-spin" />
                <span className="text-[10px] text-slate-600 font-sans font-bold leading-normal">
                  Scan accepted
                </span>
                <span className="text-[9.5px] text-slate-400 font-sans leading-normal">
                  Syncing{session.loadingPercent ? ` ${session.loadingPercent}%` : ""}...
                </span>
              </div>
            ) : (session.qrDataUrl || session.qr) ? (
              <img
                src={session.qrDataUrl || `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(session.qr)}`}
                alt="WhatsApp Scan QR"
                className="w-36 h-36"
              />
            ) : (
              <div className="text-slate-400 text-center text-[10px] font-sans">
                {session.status === "CONNECTING" ? (
                  <div className="space-y-2 flex flex-col items-center">
                    <Loader2 className="h-5 w-5 text-indigo-600 animate-spin" />
                    <span className="leading-normal">{isDisconnecting ? "Disconnecting Gateway..." : "Launching headless client..."}</span>
                  </div>
                ) : (
                  "Gateway connection is inactive. Press button to initialize."
                )}
              </div>
            )}
          </div>
        )}

        {session.status === "CONNECTED" && (
          <div className={`shrink-0 flex flex-col items-center justify-center p-4 border border-emerald-500/20 rounded-xl w-44 h-44 text-emerald-400 text-xs ${
            isLight ? "bg-emerald-50" : "bg-slate-900/50"
          }`}>
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mb-2" />
            <span className="font-bold text-center">WhatsApp Connected</span>
            {session.phoneNumber ? (
              <span className="text-[10px] text-slate-400 mt-1 text-center font-bold">+{session.phoneNumber}</span>
            ) : null}
            {session.pushName ? (
              <span className="text-[9.5px] text-slate-500 mt-0.5 text-center truncate max-w-full px-1">{session.pushName}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default function IntegrationSettings({ 
  isLight, 
  canWhatsapp = true,
  whatsappStatus,
  whatsappSessions,
  onInitializeWhatsApp,
  onDisconnectWhatsApp,
  onSendWhatsAppTest,
  isSendingTestMsg,
  isDisconnectingWa,
  disconnectingSlot,
  webhookConfigured,
  onWebhookConfiguredChange,
  onIntegrationsChange,
  onRequestPricingModal
}: IntegrationSettingsProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"smtp" | "google_sheet" | "whatsapp">("smtp");
  /** Which account slot the test-message dialog is open for, if any. */
  const [testModalSlot, setTestModalSlot] = useState<number | null>(null);

  // ── Multi-SMTP sender state ───────────────────────────────────────────────
  const [emailSenders, setEmailSenders] = useState<SmtpSender[]>([]);
  const [smtpModal, setSmtpModal] = useState<
    { mode: "add"; slot: number } | { mode: "edit"; slot: number; sender: SmtpSender; initial: SMTPFormData } | null
  >(null);
  /** Slot currently running a save/test/toggle/delete, to disable its buttons. */
  const [smtpBusySlot, setSmtpBusySlot] = useState<number | null>(null);
  /** The sender whose "send test email" dialog is open, if any. */
  const [testEmailSender, setTestEmailSender] = useState<SmtpSender | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Accordion state for Apps Script
  const [showAppsScript, setShowAppsScript] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Edit states
  const [isEditingSmtp, setIsEditingSmtp] = useState(false);
  const [isEditingGoogleSheet, setIsEditingGoogleSheet] = useState(false);

  const [smtpForm, setSmtpForm] = useState<SMTPFormData>({
    host: "",
    port: "587",
    secure: false,
    user: "",
    password: "",
    fromEmail: "",
    fromName: "",
    label: "My SMTP",
  });

  const [googleSheetForm, setGoogleSheetForm] = useState<GoogleSheetFormData>({
    webhookUrl: "",
    sheetName: "",
    label: "My Google Sheet",
  });

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations", {
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setIntegrations(data.integrations);
      }
    } catch (error) {
      console.error("Failed to fetch integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // ── Multi-SMTP senders (up to 5 rotating accounts) ────────────────────────

  const fetchEmailSenders = async () => {
    try {
      const res = await fetch("/api/integrations/senders/email", { credentials: "include" });
      const data = await res.json();
      if (data.ok && Array.isArray(data.senders)) setEmailSenders(data.senders);
    } catch (error) {
      console.error("Failed to fetch SMTP senders:", error);
    }
  };

  useEffect(() => {
    void fetchEmailSenders();
  }, []);

  /** Shape the form into the body both POST and PUT expect. */
  const senderBody = (form: SMTPFormData) => ({
    host: form.host.trim(),
    // Sent as a number: the server rejects a non-integer port, and a stringy
    // port that slips through would break the campaign executor's config check.
    port: Number(form.port),
    secure: Boolean(form.secure),
    user: form.user.trim(),
    password: form.password,
    fromEmail: form.fromEmail.trim(),
    fromName: form.fromName.trim(),
    label: form.label.trim(),
  });

  const openAddSmtp = (slot: number) => setSmtpModal({ mode: "add", slot });

  const openEditSmtp = async (sender: SmtpSender) => {
    setSmtpBusySlot(sender.slot);
    try {
      const res = await fetch(`/api/integrations/senders/email/${sender.id}`, { credentials: "include" });
      const data = await res.json();
      if (!data.ok) {
        showMessage("error", data.error || "Could not load this SMTP account.");
        return;
      }
      const cfg = data.config || {};
      setSmtpModal({
        mode: "edit",
        slot: sender.slot,
        sender,
        initial: {
          host: cfg.host || "",
          port: String(cfg.port ?? "587"),
          secure: Boolean(cfg.secure),
          user: cfg.user || "",
          password: cfg.password || "",
          fromEmail: cfg.fromEmail || "",
          fromName: cfg.fromName || "",
          label: data.label || `SMTP Account ${sender.slot}`,
        },
      });
    } catch {
      showMessage("error", "Could not load this SMTP account.");
    } finally {
      setSmtpBusySlot(null);
    }
  };

  const submitSmtpSender = async (form: SMTPFormData): Promise<{ ok: boolean; error?: string }> => {
    if (!smtpModal) return { ok: false, error: "No account selected." };
    const isEdit = smtpModal.mode === "edit";
    setSmtpBusySlot(smtpModal.slot);
    try {
      const url = isEdit
        ? `/api/integrations/senders/email/${smtpModal.sender.id}`
        : "/api/integrations/senders/email";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(senderBody(form)),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || `Save failed (HTTP ${res.status}).` };
      }
      showMessage("success", isEdit ? "SMTP account updated." : "SMTP account added.");
      setSmtpModal(null);
      await fetchEmailSenders();
      await fetchIntegrations();
      if (onIntegrationsChange) onIntegrationsChange();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Network error while saving." };
    } finally {
      setSmtpBusySlot(null);
    }
  };

  /** Test the credentials currently typed in the dialog, before saving. */
  const testSmtpDraft = async (form: SMTPFormData): Promise<{ ok: boolean; error?: string }> => {
    const slot = smtpModal?.slot ?? null;
    setSmtpBusySlot(slot);
    try {
      // An existing sender tests through its own slot so a masked password can
      // be resolved server-side; a brand-new one uses the stateless endpoint.
      const isEdit = smtpModal?.mode === "edit";
      const url = isEdit
        ? `/api/integrations/senders/email/${smtpModal!.sender.id}/test`
        : "/api/integrations/smtp/test";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(senderBody(form)),
      });
      const data = await res.json().catch(() => ({} as any));
      if (data.ok) return { ok: true };
      return { ok: false, error: data.error || `Test failed (HTTP ${res.status}).` };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Network error while testing." };
    } finally {
      setSmtpBusySlot(null);
    }
  };

  /** Test an already-saved sender exactly as stored, without opening the form. */
  const testSavedSender = async (sender: SmtpSender) => {
    setSmtpBusySlot(sender.slot);
    try {
      const res = await fetch(`/api/integrations/senders/email/${sender.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({} as any));
      if (data.ok) showMessage("success", `SMTP account ${sender.slot} connected successfully.`);
      else showMessage("error", data.error || `SMTP account ${sender.slot} failed to connect.`);
    } catch {
      showMessage("error", "Failed to test this SMTP account.");
    } finally {
      setSmtpBusySlot(null);
    }
  };

  /**
   * Deliver a real test email from a saved sender. Returns the outcome so the
   * dialog can render it inline rather than raising a browser alert.
   */
  const sendTestEmail = async (
    to: string,
    subject: string,
    message: string
  ): Promise<{ ok: boolean; error?: string; sentFrom?: string }> => {
    if (!testEmailSender) return { ok: false, error: "No account selected." };
    setSmtpBusySlot(testEmailSender.slot);
    try {
      const res = await fetch(`/api/integrations/senders/email/${testEmailSender.id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to, subject, message }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.ok) return { ok: true, sentFrom: data.sentFrom };
      return { ok: false, error: data.error || `Send failed (HTTP ${res.status}).` };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Network error while sending the test email." };
    } finally {
      setSmtpBusySlot(null);
    }
  };

  const toggleSender = async (sender: SmtpSender) => {
    setSmtpBusySlot(sender.slot);
    try {
      const res = await fetch(`/api/integrations/senders/email/${sender.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: !sender.enabled }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!data.ok) showMessage("error", data.error || "Could not change this account.");
      await fetchEmailSenders();
      await fetchIntegrations();
      if (onIntegrationsChange) onIntegrationsChange();
    } catch {
      showMessage("error", "Could not change this account.");
    } finally {
      setSmtpBusySlot(null);
    }
  };

  const deleteSender = async (sender: SmtpSender) => {
    if (!confirm(`Delete SMTP account ${sender.slot}${sender.label ? ` (${sender.label})` : ""}? Campaigns will stop sending from it.`)) return;
    setSmtpBusySlot(sender.slot);
    try {
      // The senders endpoint deliberately refuses to delete the primary row, so
      // slot 1 goes through the generic integration delete instead.
      const url = sender.type === "smtp"
        ? `/api/integrations/${sender.id}`
        : `/api/integrations/senders/email/${sender.id}`;
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({} as any));
      if (!data.ok) showMessage("error", data.error || "Could not delete this account.");
      else showMessage("success", "SMTP account deleted.");
      await fetchEmailSenders();
      await fetchIntegrations();
      if (onIntegrationsChange) onIntegrationsChange();
    } catch {
      showMessage("error", "Could not delete this account.");
    } finally {
      setSmtpBusySlot(null);
    }
  };

  const loadSMTPForEditing = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/integrations/smtp", { credentials: "include" });
      const data = await res.json();
      if (data.ok && data.configured) {
        setSmtpForm({
          host: data.config.host || "",
          port: String(data.config.port || "587"),
          secure: Boolean(data.config.secure),
          user: data.config.user || "",
          password: data.config.password || "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢",
          fromEmail: data.config.fromEmail || "",
          fromName: data.config.fromName || "",
          label: integrations.find(i => i.type === "smtp")?.label || "My SMTP",
        });
        setIsEditingSmtp(true);
      }
    } catch (err) {
      showMessage("error", "Failed to fetch SMTP details for editing.");
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleSheetForEditing = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/integrations/google-sheet", { credentials: "include" });
      const data = await res.json();
      if (data.ok && data.configured) {
        setGoogleSheetForm({
          webhookUrl: data.config.webhookUrl || "",
          sheetName: data.config.sheetName || "",
          label: integrations.find(i => i.type === "google_sheet")?.label || "My Google Sheet",
        });
        setIsEditingGoogleSheet(true);
      }
    } catch (err) {
      showMessage("error", "Failed to fetch Google Sheet details for editing.");
    } finally {
      setLoading(false);
    }
  };

  const testSMTP = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(smtpForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "âœ“ SMTP connection successful!");
      } else {
        showMessage("error", data.error || "SMTP test failed");
      }
    } catch (error) {
      showMessage("error", "Failed to test SMTP connection");
    } finally {
      setTesting(false);
    }
  };

  const saveSMTP = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(smtpForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "SMTP configuration saved successfully!");
        setIsEditingSmtp(false);
        fetchIntegrations();
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        showMessage("error", data.error || "Failed to save SMTP");
      }
    } catch (error) {
      showMessage("error", "Failed to save SMTP configuration");
    } finally {
      setSaving(false);
    }
  };

  const testGoogleSheet = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/google-sheet/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(googleSheetForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "âœ“ Google Sheet webhook is working!");
      } else {
        showMessage("error", data.error || "Webhook test failed");
      }
    } catch (error) {
      showMessage("error", "Failed to test webhook");
    } finally {
      setTesting(false);
    }
  };

  const saveGoogleSheet = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(googleSheetForm),
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "Google Sheet configuration saved successfully!");
        setIsEditingGoogleSheet(false);
        fetchIntegrations();
        onWebhookConfiguredChange(true);
        if (onIntegrationsChange) onIntegrationsChange();
      } else {
        showMessage("error", data.error || "Failed to save Google Sheet");
      }
    } catch (error) {
      showMessage("error", "Failed to save Google Sheet configuration");
    } finally {
      setSaving(false);
    }
  };

  const deleteIntegration = async (id: string, type: string) => {
    if (!confirm(`Are you sure you want to delete this ${type} integration?`)) return;

    try {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        showMessage("success", "Integration deleted successfully");
        if (type === "google_sheet") {
          onWebhookConfiguredChange(false);
        }
        fetchIntegrations();
        if (onIntegrationsChange) onIntegrationsChange();
      }
    } catch (error) {
      showMessage("error", "Failed to delete integration");
    }
  };

  const toggleIntegration = async (id: string, type: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/integrations/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchIntegrations();
        if (type === "google_sheet") {
          onWebhookConfiguredChange(enabled);
        }
        if (onIntegrationsChange) onIntegrationsChange();
      }
    } catch (error) {
      showMessage("error", "Failed to toggle integration status");
    }
  };

  const copyAppsScriptCode = () => {
    const code = `// ============================================
// Google Apps Script for LeadGenPilot Web App
// PASTE THIS ENTIRE CODE IN YOUR APPS SCRIPT
// Then: Deploy > New deployment > Web app
// ============================================

// Column header mapping (JSON key -> Sheet column name)
var HEADER_MAP = {
  "businessName": "Business Name",
  "phone": "Phone Number",
  "address": "Address",
  "rating": "Rating",
  "reviews": "Reviews",
  "website": "Website",
  "websiteStatus": "Website Status",
  "instagramUrl": "Instagram URL",
  "instagramStatus": "Instagram Status",
  "instagramLastPost": "Instagram Last Post",
  "facebookUrl": "Facebook URL",
  "facebookStatus": "Facebook Status",
  "facebookLastPost": "Facebook Last Post",
  "linkedinUrl": "LinkedIn URL",
  "linkedinStatus": "LinkedIn Status",
  "emails": "Emails",
  "googleAnalyticsPresent": "Google Analytics",
  "metaPixelPresent": "Meta Pixel",
  "whatsappPresent": "WhatsApp Present",
  "appointmentSystem": "Appointment System",
  "mapsUrl": "Google Maps URL",
  "leadScore": "Lead Score",
  "leadPriority": "Lead Priority",
  "dateAdded": "Date Added",
  "aiInsight": "AI Insight",
  "category": "Category",
  "websiteMissing": "Website Missing",
  "emailStatus": "Email Status",
  "emailSentDate": "Email Sent Date",
  "whatsappStatus": "WhatsApp Status",
  "whatsappSentDate": "WhatsApp Sent Date"
};

// Reverse map: Sheet column name > JSON key (used by doGet)
var REVERSE_HEADER_MAP = {};
for (var key in HEADER_MAP) {
  REVERSE_HEADER_MAP[HEADER_MAP[key]] = key;
}

// Helper to prevent Google Sheets from interpreting "+" or "=" as formulas
function sanitizeForSheet(val) {
  if (val === null || val === undefined) return "";
  var str = String(val);
  if (str.indexOf('+') === 0 || str.indexOf('=') === 0) {
    return "\\u200B" + str;
  }
  return val;
}

// Helper to sanitize sheet name (limit to 31 chars and remove invalid characters: \\ / ? * : [ ])
function sanitizeSheetName(name) {
  if (!name) return "Leads";
  var clean = name.replace(/[\\\\/\\?\\*:\\[\\]]/g, "");
  // Remove single quotes from beginning or end
  clean = clean.replace(/^'+|'+$/g, "");
  return clean.substring(0, 31).trim();
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // -- Handle outreach status updates (searches all sheets) --
    if (data.action === "updateOutreach") {
      var sheets = activeSpreadsheet.getSheets();
      var targetRow = -1;
      var targetSheet = null;
      var headers = null;
      
      for (var s = 0; s < sheets.length; s++) {
        var currentSheet = sheets[s];
        if (currentSheet.getLastRow() <= 1) continue;
        
        var currentHeaders = currentSheet.getRange(1, 1, 1, currentSheet.getLastColumn()).getValues()[0];
        var mapsUrlCol = currentHeaders.indexOf("Google Maps URL");
        if (mapsUrlCol === -1) mapsUrlCol = currentHeaders.indexOf("Maps URL");
        var nameCol = currentHeaders.indexOf("Business Name");
        
        if (mapsUrlCol !== -1 || nameCol !== -1) {
          var rows = currentSheet.getDataRange().getValues();
          for (var i = 1; i < rows.length; i++) {
            if (mapsUrlCol !== -1 && data.mapsUrl && rows[i][mapsUrlCol] === data.mapsUrl) {
              targetRow = i + 1;
              targetSheet = currentSheet;
              headers = currentHeaders;
              break;
            }
            if (nameCol !== -1 && rows[i][nameCol] === data.businessName) {
              targetRow = i + 1;
              targetSheet = currentSheet;
              headers = currentHeaders;
              break;
            }
          }
        }
        if (targetRow !== -1) break;
      }
      
      if (targetRow !== -1 && targetSheet !== null) {
        var updates = {
          "Email Status": data.emailStatus,
          "Email Sent Date": data.emailSentDate,
          "WhatsApp Status": data.whatsappStatus,
          "WhatsApp Sent Date": data.whatsappSentDate
        };
        
        for (var hName in updates) {
          var colIdx = headers.indexOf(hName);
          if (colIdx !== -1 && updates[hName] !== undefined) {
            targetSheet.getRange(targetRow, colIdx + 1).setValue(updates[hName]);
          }
        }
        return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Outreach status updated." }))
                             .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": "Lead not found in sheet." }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // -- Append new lead data --
    var sheet;
    if (data.sheetName) {
      var sheetName = sanitizeSheetName(data.sheetName);
      sheet = activeSpreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        sheet = activeSpreadsheet.insertSheet(sheetName);
      }
    } else {
      sheet = activeSpreadsheet.getActiveSheet();
    }
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Business Name", "Phone Number", "Address", "Rating", "Reviews", "Website", "Website Status",
        "Instagram URL", "Instagram Status", "Instagram Last Post", "Facebook URL", "Facebook Status",
        "Facebook Last Post", "LinkedIn URL", "LinkedIn Status", "Emails", "Google Analytics",
        "Meta Pixel", "WhatsApp Present", "Appointment System", "Google Maps URL", "Lead Score", 
        "Lead Priority", "Date Added", "AI Insight", "Category", "Website Missing", "Email Status",
        "Email Sent Date", "WhatsApp Status", "WhatsApp Sent Date"
      ]);
    }
    
    try {
      sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat("@");
    } catch (e) {}
    
    sheet.appendRow([
      sanitizeForSheet(data.businessName),
      sanitizeForSheet(data.phone),
      sanitizeForSheet(data.address),
      data.rating,
      data.reviews,
      data.website || "",
      data.websiteStatus || "MISSING",
      data.instagramUrl || "",
      data.instagramStatus || "NOT_FOUND",
      data.instagramLastPost || "",
      data.facebookUrl || "",
      data.facebookStatus || "NOT_FOUND",
      data.facebookLastPost || "",
      data.linkedinUrl || "",
      data.linkedinStatus || "NOT_FOUND",
      data.emails ? data.emails.join(", ") : "",
      data.googleAnalyticsPresent ? "Yes" : "No",
      data.metaPixelPresent ? "Yes" : "No",
      data.whatsappPresent ? "Yes" : "No",
      data.appointmentSystem ? "Yes" : "No",
      data.mapsUrl,
      data.leadScore,
      data.leadPriority || "COLD",
      data.dateAdded,
      data.aiInsight || "",
      data.category || "",
      data.websiteMissing ? "Yes" : "No",
      "", "", "", ""
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ "status": "success" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Check if we want to get sheet names
    if (e && e.parameter && e.parameter.action === "getSheets") {
      var sheets = activeSpreadsheet.getSheets();
      var sheetNames = [];
      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        if (sheet.getLastRow() > 1) {
          var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          if (headers.indexOf("Business Name") !== -1) {
            sheetNames.push(sheet.getName());
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify(sheetNames))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Otherwise fetch leads
    var targetSheetName = e && e.parameter && e.parameter.sheet;
    var sheets = [];
    if (targetSheetName) {
      var singleSheet = activeSpreadsheet.getSheetByName(targetSheetName);
      if (singleSheet) sheets.push(singleSheet);
    } else {
      sheets = activeSpreadsheet.getSheets();
    }
    
    var leads = [];
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.getLastRow() <= 1) continue;
      
      var rows = sheet.getDataRange().getValues();
      var headers = rows[0];
      
      var nameColIdx = headers.indexOf("Business Name");
      if (nameColIdx === -1) continue;
      
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        var lead = {};
        
        for (var j = 0; j < headers.length; j++) {
          var headerName = String(headers[j]).trim();
          var key = REVERSE_HEADER_MAP[headerName] || headerName;
          var val = row[j];
          
          if (key === "rating" || key === "reviews" || key === "leadScore") {
            val = parseFloat(val) || 0;
          } else if (key === "googleAnalyticsPresent" || key === "metaPixelPresent" || key === "whatsappPresent" || key === "appointmentSystem" || key === "websiteMissing") {
            val = (val === "Yes" || val === true || val === "true");
          } else if (key === "emails") {
            val = val ? String(val).split(",").map(function(s) { return s.trim(); }).filter(Boolean) : [];
          } else if (key === "phone") {
            val = String(val);
          } else if (typeof val === "string" && val.indexOf("\\u200B") === 0) {
            val = val.substring(1);
          }
          
          lead[key] = val;
        }
        
        if (lead.businessName) {
          leads.push(lead);
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify(leads))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}`;
    navigator.clipboard.writeText(code);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const smtpInt = integrations.find((i) => i.type === "smtp");
  const sheetInt = integrations.find((i) => i.type === "google_sheet");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-transparent">
        <Loader2 className={`w-8 h-8 animate-spin ${isLight ? "text-indigo-600" : "text-indigo-500"}`} />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full animate-fadeIn">

      {/* Tab Switcher Segmented Control */}
      <div className={`p-1 gap-1 rounded-xl border inline-flex items-center w-fit max-w-full overflow-x-auto transition-all ${
        isLight ? "bg-slate-100/90 border-slate-200" : "bg-[#0b101d] border-[#1e293b]"
      }`}>
        <button
          onClick={() => {
            setActiveTab("smtp");
            if (!smtpInt) {
              showMessage("error", "SMTP is not connected. Please enter and save your SMTP server credentials below.");
            }
          }}
          className={`flex items-center justify-center gap-2 py-1.5 px-3.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === "smtp"
              ? isLight
                ? "bg-slate-200/90 text-slate-800 border border-slate-300/80 shadow-xs"
                : "bg-slate-800/90 text-slate-100 border border-slate-700/80 shadow-xs"
              : isLight
                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <Mail className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span className="whitespace-nowrap">Configure SMTP</span>
          {!smtpInt && (
            <span className={`text-[9.5px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap shrink-0 ${
              isLight
                ? "bg-slate-200/90 border border-slate-300 text-slate-600"
                : "bg-slate-800 border border-slate-700 text-slate-400"
            }`}>
              Not Connected
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("google_sheet")}
          className={`flex items-center justify-center gap-2 py-1.5 px-3.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === "google_sheet"
              ? isLight
                ? "bg-slate-200/90 text-slate-800 border border-slate-300/80 shadow-xs"
                : "bg-slate-800/90 text-slate-100 border border-slate-700/80 shadow-xs"
              : isLight
                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
          <span className="whitespace-nowrap">Google Sheets</span>
        </button>
        <button
          onClick={() => setActiveTab("whatsapp")}
          className={`flex items-center justify-center gap-2 py-1.5 px-3.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
            activeTab === "whatsapp"
              ? isLight
                ? "bg-slate-200/90 text-slate-800 border border-slate-300/80 shadow-xs"
                : "bg-slate-800/90 text-slate-100 border border-slate-700/80 shadow-xs"
              : isLight
                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-200/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <WhatsAppLogo className="w-3.5 h-3.5 shrink-0" />
          <span className="whitespace-nowrap">WhatsApp</span>
        </button>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className={`p-3 rounded-xl border flex items-center gap-2 transition-all text-xs font-medium ${
            message.type === "success"
              ? isLight
                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                : "bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
              : isLight
                ? "bg-rose-50 border-rose-300 text-rose-800 font-semibold"
                : "bg-rose-500/15 border-rose-500/30 text-rose-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className={`w-4 h-4 ${isLight ? "text-emerald-700" : "text-emerald-500"}`} />
          ) : (
            <AlertTriangle className={`w-4 h-4 ${isLight ? "text-rose-700" : "text-rose-400"}`} />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* TAB 1: SMTP Settings */}
      {activeTab === "smtp" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-8 space-y-4">
            {(() => {
              // Build all 5 slots, filling configured ones from the senders feed.
              const slots = Array.from({ length: MAX_SMTP_SLOTS }, (_, i) => {
                const slot = i + 1;
                return { slot, sender: emailSenders.find((s) => s.slot === slot) };
              });
              const configured = emailSenders.length;
              const active = emailSenders.filter((s) => s.enabled).length;
              return (
                <>
                  <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
                    <p className={`text-[11px] font-sans leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                      Add up to <strong className={isLight ? "text-slate-800" : "text-white"}>{MAX_SMTP_SLOTS} SMTP accounts</strong>. Campaigns rotate email sends across every enabled account to spread volume and protect deliverability.
                    </p>
                    <span className={`shrink-0 font-bold px-2 py-0.5 rounded text-[9.5px] tracking-wide ${
                      active > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-400"
                    }`}>
                      {active}/{MAX_SMTP_SLOTS} IN ROTATION
                    </span>
                  </div>

                  {configured === 0 && (
                    <div
                      className={`p-4 rounded-xl border flex items-start gap-3 ${
                        isLight
                          ? "bg-rose-50 border-rose-300 text-rose-900 shadow-xs"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isLight
                          ? "bg-rose-200/80 border border-rose-300 text-rose-700"
                          : "bg-rose-500/15 border border-rose-500/25 text-rose-400"
                      }`}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className={`font-bold text-xs ${isLight ? "text-rose-900" : "text-rose-300"}`}>
                            No SMTP Account Connected
                          </h4>
                          <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                            isLight
                              ? "bg-rose-200/90 border border-rose-300 text-rose-800"
                              : "bg-rose-500/20 border border-rose-500/30 text-rose-300"
                          }`}>
                            Action Required
                          </span>
                        </div>
                        <p className={`text-[11.5px] leading-relaxed ${isLight ? "text-rose-800" : "text-rose-300/90"}`}>
                          Email outreach campaigns cannot dispatch until at least one SMTP account is added below.
                        </p>
                      </div>
                    </div>
                  )}

                  {slots.map(({ slot, sender }) => (
                    <SmtpSenderCard
                      key={slot}
                      isLight={isLight}
                      slot={slot}
                      sender={sender}
                      busy={smtpBusySlot === slot}
                      onAdd={openAddSmtp}
                      onEdit={(s) => void openEditSmtp(s)}
                      onTest={(s) => void testSavedSender(s)}
                      onSendTestEmail={(s) => setTestEmailSender(s)}
                      onToggle={(s) => void toggleSender(s)}
                      onDelete={(s) => void deleteSender(s)}
                    />
                  ))}

                  {testEmailSender && (
                    <SmtpTestEmailModal
                      isLight={isLight}
                      slot={testEmailSender.slot}
                      label={testEmailSender.label}
                      isSending={smtpBusySlot === testEmailSender.slot}
                      onCancel={() => setTestEmailSender(null)}
                      onSend={sendTestEmail}
                    />
                  )}

                  {smtpModal && (
                    <SmtpSenderModal
                      isLight={isLight}
                      slot={smtpModal.slot}
                      mode={smtpModal.mode}
                      initial={smtpModal.mode === "edit" ? smtpModal.initial : undefined}
                      busy={smtpBusySlot === smtpModal.slot}
                      onCancel={() => setSmtpModal(null)}
                      onSubmit={submitSmtpSender}
                      onTestDraft={testSmtpDraft}
                    />
                  )}
                </>
              );
            })()}
          </div>

          <div className="lg:col-span-4 space-y-4">
            {/* Gmail SMTP Guide Banner */}
            <div className={`p-4 rounded-xl border font-sans space-y-2.5 ${
              isLight 
                ? "bg-amber-50/50 border-amber-200 text-amber-950" 
                : "bg-amber-500/5 border-amber-500/15 text-amber-400"
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h4 className="font-bold text-xs">Gmail SMTP Advisory</h4>
              </div>
              <p className="text-[11px] leading-relaxed">
                To prevent Google authorization blocks, do NOT use your standard account password.
              </p>
              <ol className="text-[10px] space-y-1 list-decimal pl-4 leading-relaxed text-slate-400">
                <li>Enable <strong className={isLight ? "text-slate-800" : "text-white"}>2-Step Verification</strong> on your Google Account.</li>
                <li>Search Google Account settings for <strong className={isLight ? "text-slate-800" : "text-white"}>App Passwords</strong>.</li>
                <li>Select App type "Other" and label it "LeadGenPilot".</li>
                <li>Copy the 16-character passcode generated and paste it as your SMTP password here.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Google Sheets Settings */}
      {activeTab === "google_sheet" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-8 space-y-5">
            {sheetInt && !isEditingGoogleSheet ? (
              /* Active sheets connection card */
              <div className={`border rounded-xl p-4 sm:p-4.5 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="flex justify-between items-start border-b border-slate-200/20 pb-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <h4 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {sheetInt.label || "Google Sheet Sync Node"}
                      </h4>
                      <p className="text-[9.5px] text-slate-500 mt-0.5">
                        Connected on {new Date(sheetInt.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleIntegration(sheetInt.id, "google_sheet", !sheetInt.enabled)}
                      className={`px-2.5 py-1 rounded-lg text-[9.5px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        sheetInt.enabled
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-slate-500/10 border-slate-500/20 text-slate-400"
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      {sheetInt.enabled ? "Active Sync" : "Sync Paused"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-xs mb-6 font-sans">
                  <div className="col-span-2">
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Google Web App Deployment URL</span>
                    <strong className="text-indigo-400 font-mono text-[10px] break-all block py-1 bg-slate-950/20 px-2 rounded border border-slate-800">
                      Configured
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Target Sheet (Optional)</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>
                      {(JSON.parse(window.atob(window.btoa(JSON.stringify(sheetInt)))) as any).sheetName || "Default Active Sheet"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5 text-[10px]">Last Sync Dispatch</span>
                    <strong className={isLight ? "text-slate-800" : "text-white"}>
                      {sheetInt.lastUsedAt ? new Date(sheetInt.lastUsedAt).toLocaleString() : "No leads synced yet"}
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2.5 border-t border-slate-200/20 pt-4">
                  <button
                    onClick={loadGoogleSheetForEditing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    <Edit2 className="w-3.5 h-3.5 text-indigo-400" />
                    Edit Settings
                  </button>
                  <button
                    onClick={() => {
                      setGoogleSheetForm({
                        webhookUrl: "temp",
                        sheetName: "",
                        label: ""
                      });
                      testGoogleSheet();
                    }}
                    disabled={testing}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isLight 
                        ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                        : "border-slate-800 text-slate-300 hover:bg-slate-850"
                    }`}
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    Verify Webhook
                  </button>
                  <button
                    onClick={() => deleteIntegration(sheetInt.id, "google_sheet")}
                    className="ml-auto px-3.5 py-2 text-xs font-semibold rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/25 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Sync
                  </button>
                </div>
              </div>
            ) : (
              /* Add/Edit Sheets form */
              <div className={`border rounded-xl p-4 sm:p-4.5 space-y-3.5 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="pb-2.5 border-b border-slate-200/20">
                  <h3 className={`text-xs font-bold flex items-center gap-2 ${isLight ? "text-slate-800" : "text-white"}`}>
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    {isEditingGoogleSheet ? "Modify Google Sheets Sync Settings" : "Configure Google Sheets Sync"}
                  </h3>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">Google Apps Script Webhook URL</label>
                    <input
                      type="url"
                      value={googleSheetForm.webhookUrl}
                      onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, webhookUrl: e.target.value })}
                      placeholder="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
                      className={`w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-indigo-500 ${
                        isLight
                          ? "bg-white border-slate-200 text-slate-900"
                          : "bg-[#030712] border-slate-700 text-white"
                      }`}
                    />
                    <span className="text-[9.5px] text-slate-500 mt-1 block leading-normal">
                      Copy the Web App link deployed from the Google Apps Script in your sheet.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">Target Tab/Sheet Name</label>
                      <input
                        type="text"
                        value={googleSheetForm.sheetName}
                        onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, sheetName: e.target.value })}
                        placeholder="Leads (optional)"
                        className={`w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">Sync Label</label>
                      <input
                        type="text"
                        value={googleSheetForm.label}
                        onChange={(e) => setGoogleSheetForm({ ...googleSheetForm, label: e.target.value })}
                        placeholder="Leads Spreadsheet"
                        className={`w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white border-slate-200 text-slate-900"
                            : "bg-[#030712] border-slate-700 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-slate-200/20">
                    <button
                      type="button"
                      onClick={testGoogleSheet}
                      disabled={testing || !googleSheetForm.webhookUrl}
                      className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Test Webhook Link
                    </button>
                    <button
                      type="button"
                      onClick={saveGoogleSheet}
                      disabled={saving || !googleSheetForm.webhookUrl}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Save Sync Gateway
                    </button>
                    {isEditingGoogleSheet && (
                      <button
                        type="button"
                        onClick={() => setIsEditingGoogleSheet(false)}
                        className={`ml-auto px-3 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                          isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-800 text-slate-400 hover:bg-slate-850"
                        }`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Accordion Guide: How to deploy Apps Script */}
            <div className={`border rounded-xl overflow-hidden ${
              isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/40 border-slate-800"
            }`}>
              <button
                onClick={() => setShowAppsScript(!showAppsScript)}
                className="w-full py-3 px-4 flex items-center justify-between text-xs font-bold tracking-tight cursor-pointer hover:bg-slate-800/10"
              >
                <span className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-400" />
                  Google Sheets Apps Script Setup Instructions & Code
                </span>
                {showAppsScript ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </button>

              {showAppsScript && (
                <div className="p-4 border-t border-slate-200/20 space-y-3 font-sans text-xs">
                  <div className={`p-3 rounded-lg border leading-relaxed space-y-1 ${
                    isLight ? "bg-white border-slate-200 text-slate-700" : "bg-[#030712] border-slate-800 text-slate-400"
                  }`}>
                    <p className="font-semibold text-indigo-400 mb-1">Follow these steps carefully:</p>
                    <ol className="list-decimal pl-4 space-y-0.5 text-[10.5px]">
                      <li>Create a new Google Sheet.</li>
                      <li>Go to <strong className={isLight ? "text-slate-900" : "text-white"}>Extensions &gt; Apps Script</strong>.</li>
                      <li>Delete all text in the script editor and click <strong className={isLight ? "text-slate-900" : "text-white"}>Copy Apps Script Code</strong> button below to copy the required code.</li>
                      <li>Paste the copied script code into the script editor. Click save (floppy disk icon).</li>
                      <li>Click the blue <strong className={isLight ? "text-slate-900" : "text-white"}>Deploy</strong> button &gt; <strong className={isLight ? "text-slate-900" : "text-white"}>New deployment</strong>.</li>
                      <li>Select configuration type: <strong className={isLight ? "text-slate-900" : "text-white"}>Web app</strong>.</li>
                      <li>Change settings to:
                        <ul className="list-disc pl-4 mt-0.5 space-y-0.5 font-mono text-[9.5px]">
                          <li>"Execute as": "Me" (your email)</li>
                          <li>"Who has access": "Anyone"</li>
                        </ul>
                      </li>
                      <li>Click Deploy, approve permissions, and copy the Web App URL generated. Paste it into the form above.</li>
                    </ol>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={copyAppsScriptCode}
                      className="px-3 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
                    >
                      <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                      {copiedScript ? "Script Code Copied!" : "Copy Apps Script Code"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className={`p-4 rounded-xl border font-sans space-y-2.5 ${
              isLight 
                ? "bg-emerald-50/50 border-emerald-200 text-emerald-950" 
                : "bg-emerald-500/5 border-emerald-500/15 text-emerald-400"
            }`}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                <h4 className="font-bold text-xs">Spreadsheet Benefits</h4>
              </div>
              <p className="text-[11px] leading-relaxed">
                Synchronizing dispatches logs harvest data directly to your spreadsheets.
              </p>
              <ul className="text-[10px] space-y-1 list-disc pl-4 leading-relaxed text-slate-400">
                <li>Instant sync of lead information as they are scraped.</li>
                <li>Sync outreach campaign statuses (SENT, FAILED) dynamically in real-time.</li>
                <li>Enable teamwork dispatches inside Google Sheets.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WhatsApp Settings */}
      {activeTab === "whatsapp" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start animate-fadeIn">
          <div className="lg:col-span-8 space-y-5">
            {!canWhatsapp ? (
              <div className={`border rounded-xl p-6 flex flex-col items-center text-center gap-3 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center animate-pulse">
                  <Sparkles className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <h4 className={`text-xs font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                    WhatsApp Outreach is a Pro Feature
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1.5 max-w-sm leading-relaxed">
                    Your current free plan doesn't include WhatsApp outreach gateways. Upgrade to a premium plan to launch headless gateways, link browser sessions, and dispatch outreach campaigns directly.
                  </p>
                </div>
                <button 
                  onClick={onRequestPricingModal}
                  className="mt-1 px-4 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-md shadow-indigo-600/20 cursor-pointer transition-all hover:scale-[1.02]"
                >
                  Upgrade to Pro
                </button>
              </div>
            ) : (
            <>
              {(() => {
                // Build the list of 5 slots. Prefer the per-slot `whatsappSessions`
                // feed; fall back to the single `whatsappStatus` as slot 1 (plus
                // empty slots 2-5) so the UI still works before the backend
                // multi-session feed is wired in.
                const sessions: WhatsAppSessionStatus[] = Array.from({ length: MAX_WHATSAPP_SLOTS }, (_, i) => {
                  const slot = i + 1;
                  const fromFeed = whatsappSessions?.find((s) => s.slot === slot);
                  if (fromFeed) return fromFeed;
                  if (slot === 1) return { slot: 1, status: whatsappStatus.status, qr: whatsappStatus.qr, qrDataUrl: whatsappStatus.qrDataUrl, error: whatsappStatus.error };
                  return { slot, status: "DISCONNECTED", qr: "" };
                });
                const connectedCount = sessions.filter((s) => s.status === "CONNECTED").length;
                return (
                  <>
                    <div className="flex items-center justify-between px-1">
                      <p className={`text-[11px] font-sans leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                        Link up to <strong className={isLight ? "text-slate-800" : "text-white"}>{MAX_WHATSAPP_SLOTS} WhatsApp accounts</strong>. Campaigns rotate messages across every connected account with anti-block delays.
                      </p>
                      <span className={`shrink-0 ml-3 font-bold px-2 py-0.5 rounded text-[9.5px] tracking-wide ${
                        connectedCount > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-400"
                      }`}>
                        {connectedCount}/{MAX_WHATSAPP_SLOTS} LINKED
                      </span>
                    </div>
                    {sessions.map((session) => (
                      <WhatsAppSessionCard
                        key={session.slot}
                        isLight={isLight}
                        session={session}
                        onInitialize={(slot) => onInitializeWhatsApp(slot)}
                        onDisconnect={(slot) => onDisconnectWhatsApp(slot)}
                        onSendTest={(slot) => setTestModalSlot(slot)}
                        isSendingTestMsg={isSendingTestMsg}
                        isDisconnecting={isDisconnectingWa && (disconnectingSlot == null || disconnectingSlot === session.slot)}
                      />
                    ))}

                    {testModalSlot !== null && (
                      <WhatsAppTestModal
                        isLight={isLight}
                        slot={testModalSlot}
                        fromNumber={sessions.find((s) => s.slot === testModalSlot)?.phoneNumber}
                        isSending={isSendingTestMsg}
                        onCancel={() => setTestModalSlot(null)}
                        onSend={onSendWhatsAppTest}
                      />
                    )}
                  </>
                );
              })()}
            </>
            )}
          </div>


          <div className="lg:col-span-4 space-y-4">
            <div className={`p-4 rounded-xl border font-sans space-y-2.5 ${
              isLight 
                ? "bg-indigo-50/50 border-indigo-200 text-indigo-950" 
                : "bg-indigo-500/5 border-indigo-500/15 text-indigo-400"
            }`}>
                <>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4.5 h-4.5 text-indigo-500" />
                    <h4 className="font-bold text-xs">WhatsApp Scanning Guide</h4>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Scan the QR code to authenticate the headless browser session.
                  </p>
                  <ol className="text-[10px] space-y-1.5 list-decimal pl-4 leading-relaxed text-slate-400">
                    <li>Open <strong className={isLight ? "text-slate-800" : "text-white"}>WhatsApp</strong> on your phone.</li>
                    <li>Tap <strong className={isLight ? "text-slate-800" : "text-white"}>Menu</strong> or Settings and select <strong className={isLight ? "text-slate-800" : "text-white"}>Linked Devices</strong>.</li>
                    <li>Tap <strong className={isLight ? "text-slate-800" : "text-white"}>Link a Device</strong>.</li>
                    <li>Point your camera at the QR code on the left to scan.</li>
                  </ol>
                </>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
