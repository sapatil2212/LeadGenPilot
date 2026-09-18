/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Conversations (Inbox) — real-time two-way threads with leads. Polls the
 * backend for new inbound replies (detected from the WhatsApp gateway) and lets
 * the user reply inline. A lead that replies is shown as an active conversation.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare, Send, Loader2, RefreshCw, Search, Trash2, CheckCheck, Clock, X, Mail,
} from "lucide-react";
import WhatsAppLogo from "./WhatsAppLogo";

interface ConversationMessage {
  id: string;
  direction: "in" | "out";
  channel: "whatsapp" | "email";
  text: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  leadId?: string;
  businessName: string;
  phone?: string;
  email?: string;
  channel: "whatsapp" | "email";
  status: "AWAITING_REPLY" | "REPLIED" | "CLOSED";
  messages: ConversationMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
  createdAt: string;
}

interface ConversationsProps {
  isLight: boolean;
  /** Notifies the parent of the total unread count (for the sidebar badge). */
  onUnreadChange?: (count: number) => void;
}

const STATUS_LABEL: Record<Conversation["status"], string> = {
  AWAITING_REPLY: "Awaiting reply",
  REPLIED: "Conversation started",
  CLOSED: "Closed",
};
const STATUS_STYLE: Record<Conversation["status"], string> = {
  AWAITING_REPLY: "bg-amber-500/10 text-amber-400",
  REPLIED: "bg-emerald-500/10 text-emerald-400",
  CLOSED: "bg-slate-500/10 text-slate-400",
};

export default function Conversations({ isLight, onUnreadChange }: ConversationsProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) || null;

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
        onUnreadChange?.(data.totalUnread || 0);
      }
    } catch (e) {
      console.error("Failed to load conversations", e);
    }
  }, [onUnreadChange]);

  // Initial load + real-time polling every 4s.
  useEffect(() => {
    setIsLoading(true);
    fetchConversations().finally(() => setIsLoading(false));
    const interval = setInterval(fetchConversations, 8000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Auto-scroll to the newest message when the active thread updates.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, activeId]);

  const openConversation = async (c: Conversation) => {
    setActiveId(c.id);
    setReply("");
    if (c.unread > 0) {
      await fetch(`/api/conversations/${c.id}/read`, { method: "POST" }).catch(() => {});
      fetchConversations();
    }
  };

  const sendReply = async () => {
    if (!active || !reply.trim()) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/conversations/${active.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) => prev.map((c) => (c.id === active.id ? data.conversation : c)));
        setReply("");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to send reply.");
      }
    } catch (e) {
      alert("Error sending reply.");
    } finally {
      setIsSending(false);
    }
  };

  const changeStatus = async (status: Conversation["status"]) => {
    if (!active) return;
    const res = await fetch(`/api/conversations/${active.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const data = await res.json();
      setConversations((prev) => prev.map((c) => (c.id === active.id ? data.conversation : c)));
    }
  };

  const deleteConversation = async () => {
    if (!active || !window.confirm(`Delete conversation with "${active.businessName}"?`)) return;
    const res = await fetch(`/api/conversations/${active.id}`, { method: "DELETE" });
    if (res.ok) {
      setConversations((prev) => prev.filter((c) => c.id !== active.id));
      setActiveId(null);
    }
  };

  const filtered = conversations.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.businessName.toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
  });

  const cardBg = isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]";

  return (
    <div className={`border rounded-2xl overflow-hidden flex ${cardBg}`} style={{ height: "calc(100vh - 180px)" }}>
      {/* Thread list */}
      <div className={`w-72 shrink-0 border-r flex flex-col ${isLight ? "border-slate-200" : "border-[#1e293b]"}`}>
        <div className={`p-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-indigo-400" />
              <span className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white"}`}>Conversations</span>
            </div>
            <button
              onClick={() => fetchConversations()}
              className={`p-1 rounded-lg cursor-pointer transition-all ${isLight ? "text-slate-500 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-800"}`}
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className={`w-full text-xs border rounded-lg pl-8 pr-2 py-1.5 focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-slate-500">
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto text-indigo-400" /> : "No conversations yet. Replies from leads will appear here in real time."}
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c)}
                  className={`w-full text-left px-3 py-2.5 border-b transition-all cursor-pointer ${isLight ? "border-slate-100" : "border-[#1e293b]/40"} ${
                    isActive ? (isLight ? "bg-indigo-50" : "bg-indigo-600/10") : isLight ? "hover:bg-slate-50" : "hover:bg-slate-900/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.channel === "whatsapp" ? <WhatsAppLogo className="h-3 w-3 fill-emerald-500 text-emerald-500 shrink-0" /> : <Mail className="h-3 w-3 text-indigo-400 shrink-0" />}
                      <span className={`text-xs font-semibold truncate ${isLight ? "text-slate-900" : "text-white"}`}>{c.businessName}</span>
                    </div>
                    {c.unread > 0 && <span className="text-[9px] font-bold bg-indigo-500 text-white rounded-full px-1.5 py-0.5 shrink-0">{c.unread}</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">{c.lastMessagePreview || "—"}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    <span className="text-[9px] text-slate-500">{new Date(c.lastMessageAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-8">
            <MessageSquare className="h-10 w-10 text-slate-600 opacity-40" />
            <p className="text-sm text-slate-500">Select a conversation to view the thread.</p>
            <p className="text-xs text-slate-600">When a lead replies to your outreach, it starts a conversation and appears here automatically.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {active.channel === "whatsapp" ? <WhatsAppLogo className="h-4 w-4 fill-emerald-500 text-emerald-500 shrink-0" /> : <Mail className="h-4 w-4 text-indigo-400 shrink-0" />}
                  <span className={`text-sm font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>{active.businessName}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[active.status]}`}>{STATUS_LABEL[active.status]}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{active.phone || active.email}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={active.status}
                  onChange={(e) => changeStatus(e.target.value as Conversation["status"])}
                  className={`text-[10px] border rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none ${isLight ? "bg-white text-slate-700 border-slate-200" : "bg-[#030712] text-slate-300 border-[#1e293b]"}`}
                >
                  <option value="AWAITING_REPLY">Awaiting reply</option>
                  <option value="REPLIED">Conversation started</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <button
                  onClick={deleteConversation}
                  className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-2 ${isLight ? "bg-slate-50" : "bg-[#030712]/40"}`}>
              {active.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.direction === "out"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : isLight ? "bg-white border border-slate-200 text-slate-800 rounded-bl-sm" : "bg-[#0c111d] border border-[#1e293b] text-slate-200 rounded-bl-sm"
                  }`}>
                    <div>{m.text}</div>
                    <div className={`text-[9px] mt-1 flex items-center gap-1 ${m.direction === "out" ? "text-indigo-200" : "text-slate-500"}`}>
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(m.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {m.direction === "out" && <CheckCheck className="h-2.5 w-2.5" />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply box — works for both WhatsApp and Email threads */}
            <div className={`p-3 border-t ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder={active.channel === "whatsapp" ? "Type a WhatsApp reply… (Enter to send)" : "Type an email reply… (Enter to send)"}
                  rows={1}
                  className={`flex-1 text-xs border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-indigo-500 max-h-28 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                />
                <button
                  onClick={sendReply}
                  disabled={isSending || !reply.trim()}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl cursor-pointer transition-all shrink-0"
                  title="Send reply"
                >
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              {active.channel === "email" && (
                <p className="text-[10px] text-slate-500 mt-1.5">Sends a new email to {active.email} via your configured SMTP.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
