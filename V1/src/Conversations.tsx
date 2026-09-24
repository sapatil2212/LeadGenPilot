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

  const cardBg = isLight 
    ? "bg-white/95 border-slate-200/90 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)]" 
    : "bg-[#090d16]/95 border-[#1e293b] shadow-[0_8px_30px_rgb(0,0,0,0.3)]";

  return (
    <div className={`border rounded-xl overflow-hidden flex transition-all ${cardBg}`} style={{ minHeight: "560px", height: "calc(100vh - 200px)", maxHeight: "820px" }}>
      {/* Thread list column */}
      <div className={`w-72 shrink-0 border-r flex flex-col ${isLight ? "border-slate-200/80 bg-slate-50/40" : "border-[#1e293b] bg-black/20"}`}>
        <div className={`p-3 border-b ${isLight ? "border-slate-200/80" : "border-[#1e293b]/70"}`}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${isLight ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"}`}>
                <MessageSquare className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className={`text-xs font-bold tracking-tight block ${isLight ? "text-slate-900" : "text-white"}`}>Lead Inbox</span>
                <span className="text-[9.5px] text-slate-500">{filtered.length} active threads</span>
              </div>
            </div>
            <button
              onClick={() => fetchConversations()}
              className={`p-1.5 rounded-lg border btn-interactive cursor-pointer transition-all ${
                isLight ? "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 bg-white" : "border-[#1e293b] text-slate-400 hover:bg-slate-800 hover:text-white bg-slate-900/60"
              }`}
              title="Refresh conversations"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
            </button>
          </div>
          
          {/* Search input with icons */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads, phone, email..."
              className={`w-full text-xs border rounded-lg pl-8 pr-7 py-1.5 transition-all outline-none focus:ring-1 focus:ring-indigo-500/30 ${
                isLight 
                  ? "bg-white text-slate-800 border-slate-200 focus:border-indigo-500 placeholder-slate-400" 
                  : "bg-[#030712] text-white border-[#1e293b] focus:border-indigo-500/60 placeholder-slate-600"
              }`}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable threads list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/40">
          {filtered.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                <MessageSquare className="h-5 w-5 opacity-60" />
              </div>
              <p className={`text-xs font-semibold ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                {isLoading ? "Syncing messages…" : "No conversations yet"}
              </p>
              <p className="text-[10px] text-slate-500 mt-1 max-w-[180px] mx-auto leading-relaxed">
                Replies from email or WhatsApp prospects will appear here in real time.
              </p>
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c)}
                  className={`w-full text-left p-2.5 transition-all cursor-pointer relative group ${
                    isActive 
                      ? isLight ? "bg-indigo-50/80 shadow-xs" : "bg-indigo-600/15" 
                      : isLight ? "hover:bg-slate-50/90" : "hover:bg-slate-900/40"
                  }`}
                >
                  {/* Left active glow bar */}
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-r shadow-sm shadow-indigo-500/50"></span>
                  )}
                  
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`p-1.5 rounded-lg shrink-0 ${
                        c.channel === "whatsapp" 
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
                          : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                      }`}>
                        {c.channel === "whatsapp" ? (
                          <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" />
                        ) : (
                          <Mail className="h-3.5 w-3.5 text-indigo-400" />
                        )}
                      </div>
                      <span className={`text-xs font-bold truncate ${isActive ? "text-indigo-600 dark:text-indigo-400" : isLight ? "text-slate-900" : "text-white"}`}>
                        {c.businessName}
                      </span>
                    </div>
                    {c.unread > 0 && (
                      <span className="text-[9px] font-black bg-indigo-600 text-white rounded-full px-1.5 py-0.5 shrink-0 shadow-xs shadow-indigo-500/30 animate-pulse">
                        {c.unread}
                      </span>
                    )}
                  </div>
                  
                  <div className="text-[11px] text-slate-500 truncate pl-7">
                    {c.lastMessagePreview || "No messages yet"}
                  </div>
                  
                  <div className="flex items-center justify-between mt-2 pl-7">
                    <span className={`text-[8.5px] font-bold px-2 py-0.5 rounded-md ${STATUS_STYLE[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    <span className="text-[9.5px] text-slate-400 tabular-nums">
                      {new Date(c.lastMessageAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread reading & reply panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 p-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 mb-1">
              <MessageSquare className="h-6 w-6 opacity-70" />
            </div>
            <p className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>Select a lead thread to view replies</p>
            <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
              When a prospect replies to your automated email or WhatsApp outreach, their full conversation thread and replies sync here automatically.
            </p>
          </div>
        ) : (
          <>
            {/* Conversation Header */}
            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 ${isLight ? "border-slate-200/80 bg-slate-50/50" : "border-[#1e293b]/70 bg-black/20"}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg shrink-0 ${
                    active.channel === "whatsapp" 
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
                      : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                  }`}>
                    {active.channel === "whatsapp" ? (
                      <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" />
                    ) : (
                      <Mail className="h-3.5 w-3.5 text-indigo-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                        {active.businessName}
                      </span>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded-md ${STATUS_STYLE[active.status]}`}>
                        {STATUS_LABEL[active.status]}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.2 flex items-center gap-1.5">
                      <span>{active.phone || active.email}</span>
                      <span className="opacity-40">·</span>
                      <span className="capitalize">{active.channel} channel</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={active.status}
                  onChange={(e) => changeStatus(e.target.value as Conversation["status"])}
                  className={`text-[11px] border rounded-lg px-2 py-1 cursor-pointer outline-none transition-all ${
                    isLight ? "bg-white text-slate-700 border-slate-200 shadow-xs focus:border-indigo-500" : "bg-[#030712] text-slate-300 border-[#1e293b] focus:border-indigo-500"
                  }`}
                >
                  <option value="AWAITING_REPLY">Awaiting reply</option>
                  <option value="REPLIED">Conversation started</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <button
                  onClick={deleteConversation}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
                  title="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-2.5 ${isLight ? "bg-slate-50/30" : "bg-[#030712]/30"}`}>
              {active.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[72%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap transition-all shadow-xs ${
                    m.direction === "out"
                      ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-br-xs shadow-indigo-500/10"
                      : isLight 
                        ? "bg-white border border-slate-200/90 text-slate-800 rounded-bl-xs shadow-xs" 
                        : "bg-[#0d1322] border border-[#1e293b] text-slate-200 rounded-bl-xs"
                  }`}>
                    <div>{m.text}</div>
                    <div className={`text-[9px] mt-1 flex items-center gap-1.5 tabular-nums ${m.direction === "out" ? "text-indigo-200" : "text-slate-400"}`}>
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(m.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {m.direction === "out" && <CheckCheck className="h-3 w-3 text-indigo-200 ml-0.5" />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Interactive Reply Bar */}
            <div className={`p-2.5 border-t ${isLight ? "border-slate-200/80 bg-white" : "border-[#1e293b]/70 bg-[#090d16]"}`}>
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder={active.channel === "whatsapp" ? "Type your WhatsApp message… (Enter to send)" : "Type your email response… (Enter to send)"}
                  rows={2}
                  className={`flex-1 text-xs border rounded-xl p-2.5 resize-none outline-none transition-all max-h-28 focus:ring-1 focus:ring-indigo-500/30 ${
                    isLight 
                      ? "bg-slate-50 text-slate-900 border-slate-200 focus:border-indigo-500 focus:bg-white placeholder-slate-400" 
                      : "bg-[#030712] text-white border-[#1e293b] focus:border-indigo-500/60 placeholder-slate-600"
                  }`}
                />
                <button
                  onClick={sendReply}
                  disabled={isSending || !reply.trim()}
                  className="btn-interactive p-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl cursor-pointer shadow-sm shadow-indigo-500/25 shrink-0 transition-all"
                  title="Send message"
                >
                  {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="flex items-center justify-between text-[9.5px] text-slate-400 mt-1.5 px-0.5">
                <span>Press <b>Enter</b> to send, <b>Shift + Enter</b> for new line</span>
                {active.channel === "email" && (
                  <span className="text-indigo-400 font-medium">Sends via connected SMTP</span>
                )}
                {active.channel === "whatsapp" && (
                  <span className="text-emerald-400 font-medium">Dispatches via WhatsApp Gateway</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
