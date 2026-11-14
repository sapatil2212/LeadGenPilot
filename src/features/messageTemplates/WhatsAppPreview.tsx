/**
 * Live WhatsApp-style preview.
 *
 * Renders the template payload as it would appear in a chat, using sample
 * variable values. Two modes:
 *   - web:      how whatsapp-web.js sends it — a single text bubble with
 *               CTAs and quick replies as text (honest to the transport).
 *   - cloud_api: how the Meta API renders it — media header, body, footer,
 *               and tappable button chips below the bubble.
 *
 * The preview is a visual approximation for the user, not WhatsApp's own
 * assets. It never claims a capability the chosen channel lacks.
 */

import React from "react";
import { Smartphone, Image as ImageIcon, Video, FileText, ExternalLink, Phone, MessageCircle } from "lucide-react";
import type { MessageTemplatePayload, DeliveryMethod } from "./api";
import { substitute, whatsappMarkupToHtml } from "./clientRender";

interface Props {
  payload: MessageTemplatePayload;
  values: Record<string, string>;
  deliveryMethod: DeliveryMethod;
  businessName?: string;
}

const ACTION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  url: ExternalLink,
  custom_url: ExternalLink,
  phone: Phone,
  whatsapp_link: MessageCircle,
};

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function WhatsAppPreview({ payload, values, deliveryMethod, businessName }: Props) {
  const sub = (t: string) => substitute(t || "", values);
  const isCloud = deliveryMethod === "cloud_api";

  const headerType = payload.header.type;
  const bodyHtml = whatsappMarkupToHtml(sub(payload.body.text || ""));

  return (
    <div className="flex flex-col items-center">
      {/* Mode label */}
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <Smartphone className="h-3 w-3" />
        {isCloud ? "Meta WhatsApp API Preview" : "WhatsApp Web Preview"}
      </div>

      {/* Phone frame */}
      <div className="w-full max-w-[320px] rounded-[1.75rem] border-[6px] border-slate-800 bg-slate-800 shadow-2xl">
        {/* Chat header */}
        <div className="flex items-center gap-2.5 rounded-t-[1.25rem] bg-[#075e54] px-3 py-2.5 text-white">
          <div className="h-8 w-8 shrink-0 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
            {(businessName || "B").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{businessName || "Your Business"}</div>
            <div className="text-[9px] text-white/70">online</div>
          </div>
        </div>

        {/* Chat body (WhatsApp wallpaper tint) */}
        <div className="min-h-[360px] space-y-2 bg-[#e5ddd5] px-3 py-3" style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          {/* Outgoing message bubble */}
          <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-sm bg-[#dcf8c6] px-2.5 py-2 shadow-sm">
            {/* Media header */}
            {headerType === "image" && (
              <MediaBlock url={payload.header.mediaUrl} icon={ImageIcon} label="Image" caption={sub(payload.header.mediaCaption || "")} />
            )}
            {headerType === "video" && (
              <MediaBlock url={payload.header.mediaUrl} icon={Video} label="Video" caption={sub(payload.header.mediaCaption || "")} />
            )}
            {headerType === "document" && (
              <DocumentBlock name={payload.header.mediaFileName} />
            )}

            {/* Text header */}
            {headerType === "text" && payload.header.text?.trim() && (
              <div className="mb-1 text-[12.5px] font-bold text-slate-900">
                {isCloud ? sub(payload.header.text) : `⭐ ${sub(payload.header.text)}`}
              </div>
            )}

            {/* Body */}
            {payload.body.text?.trim() ? (
              <div
                className="text-[12.5px] leading-snug text-slate-800 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <div className="text-[12.5px] italic text-slate-400">Your message will appear here…</div>
            )}

            {/* Web mode: actions + quick replies rendered inline as text */}
            {!isCloud && (
              <>
                {payload.actions.filter((a) => a.label?.trim()).map((a) => {
                  const Icon = ACTION_ICON[a.type] || ExternalLink;
                  return (
                    <div key={a.id} className="mt-2 text-[12px] text-slate-800">
                      <div className="flex items-center gap-1 font-bold">
                        <Icon className="h-3 w-3 text-[#075e54]" />
                        {sub(a.label)}
                      </div>
                      {a.value?.trim() && <div className="text-[11px] text-blue-600 break-all">{sub(a.value)}</div>}
                    </div>
                  );
                })}
                {payload.quickReplies.filter((q) => q.display?.trim()).length > 0 && (
                  <div className="mt-2 text-[12px] text-slate-800">
                    💬 Reply{" "}
                    {payload.quickReplies
                      .filter((q) => q.display?.trim())
                      .map((q, i, arr) => (
                        <span key={q.id} className="font-bold">
                          {q.display}
                          {i < arr.length - 1 ? (i === arr.length - 2 ? " or " : ", ") : ""}
                        </span>
                      ))}{" "}
                    to let us know.
                  </div>
                )}
              </>
            )}

            {/* Footer */}
            {payload.footer.enabled && payload.footer.text?.trim() && (
              <div className="mt-1.5 text-[10.5px] italic text-slate-500">{sub(payload.footer.text)}</div>
            )}

            <div className="mt-0.5 text-right text-[9px] text-slate-500">{nowTime()} ✓✓</div>
          </div>

          {/* Cloud mode: native button chips below the bubble */}
          {isCloud && (
            <div className="ml-auto max-w-[88%] space-y-1">
              {payload.actions.filter((a) => a.label?.trim()).map((a) => {
                const Icon = ACTION_ICON[a.type] || ExternalLink;
                return (
                  <div key={a.id} className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[12px] font-semibold text-[#00a5f4] shadow-sm">
                    <Icon className="h-3.5 w-3.5" />
                    {sub(a.label)}
                  </div>
                );
              })}
              {payload.quickReplies.filter((q) => q.display?.trim()).map((q) => (
                <div key={q.id} className="flex items-center justify-center rounded-lg bg-white px-2 py-1.5 text-[12px] font-semibold text-[#00a5f4] shadow-sm">
                  {q.display}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat input bar (decorative) */}
        <div className="flex items-center gap-2 rounded-b-[1.25rem] bg-[#f0f0f0] px-3 py-2">
          <div className="h-6 flex-1 rounded-full bg-white" />
          <div className="h-7 w-7 rounded-full bg-[#075e54]" />
        </div>
      </div>
    </div>
  );
}

function MediaBlock({ url, icon: Icon, label, caption }: { url?: string; icon: React.ComponentType<{ className?: string }>; label: string; caption?: string }) {
  return (
    <div className="mb-1.5">
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-200">
        {url && label === "Image" ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img src={url} className="h-full w-full object-cover" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-400">
            <Icon className="h-6 w-6" />
            <span className="text-[9px] font-semibold uppercase">{label}</span>
          </div>
        )}
      </div>
      {caption && <div className="mt-1 text-[11px] text-slate-600">{caption}</div>}
    </div>
  );
}

function DocumentBlock({ name }: { name?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5">
      <FileText className="h-5 w-5 text-slate-500" />
      <span className="text-[11px] font-medium text-slate-700 truncate">{name || "document.pdf"}</span>
    </div>
  );
}
