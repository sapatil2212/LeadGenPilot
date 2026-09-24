/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The workspace AI assistant.
 *
 * Every answer shows the excerpts it was grounded in and the model that produced
 * it. That is the point of the feature rather than decoration: an assistant whose
 * answers cannot be traced back to a source is one the user has to take on trust,
 * and these answers inform decisions about who to contact and what to claim.
 *
 * Threads archive rather than delete by default. A conversation is the record of
 * what the business told the AI and what it answered, so hiding it is usually what
 * is wanted; destroying the provenance of a decision is not.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  Bot,
  ChevronRight,
  FileText,
  MessageSquarePlus,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import {
  api,
  type AskResult,
  type AssistantMessageView,
  type ConversationView,
} from "../ui/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  Spinner,
  TextArea,
  formatAgo,
  tokens,
  useAction,
  useAsync,
  type Themed,
} from "../ui/primitives";

interface ConversationDetail extends ConversationView {
  messages: AssistantMessageView[];
}

const STARTERS = [
  "What do we actually sell, based on what I've told you?",
  "Who should we be targeting, and why?",
  "What's missing from my business profile?",
  "Summarise the documents I've uploaded.",
];

export default function AssistantPanel({ isLight }: Themed) {
  const t = tokens(isLight);
  const status = useAsync<{ available: boolean; reason?: string }>(() =>
    api.get("/api/assistant/status")
  );
  const threads = useAsync<ConversationView[]>(() => api.get("/api/assistant/conversations"));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  const [lastResult, setLastResult] = useState<AskResult | null>(null);
  const [question, setQuestion] = useState("");

  const ask = useAction();
  const loadThread = useAction();
  const archive = useAction();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, ask.busy]);

  const openThread = async (id: string) => {
    setActiveId(id);
    setLastResult(null);
    const detail = await loadThread.run<ConversationDetail>(() =>
      api.get(`/api/assistant/conversations/${id}`)
    );
    setMessages(detail?.messages ?? []);
  };

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setLastResult(null);
    setQuestion("");
  };

  const send = async (text?: string) => {
    const body = (text ?? question).trim();
    if (!body) return;

    // The question is shown immediately with a provisional id. The server persists
    // the user's turn before calling the model, so an outage loses nothing — but
    // waiting for the round trip to echo it back makes the UI feel broken.
    const provisional: AssistantMessageView = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: body,
      provider: null,
      model: null,
      promptName: null,
      promptVersion: null,
      totalTokens: null,
      latencyMs: null,
      citedChunkIds: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, provisional]);
    setQuestion("");

    const result = await ask.run<AskResult>(() =>
      api.post("/api/assistant/ask", { question: body, conversationId: activeId })
    );

    if (!result) {
      // Roll back the optimistic bubble; the error notice explains why.
      setMessages((current) => current.filter((m) => m.id !== provisional.id));
      setQuestion(body);
      return;
    }

    setActiveId(result.conversationId);
    setLastResult(result);
    setMessages((current) => [
      ...current.filter((m) => m.id !== provisional.id),
      ...result.messages,
    ]);
    threads.reload();
  };

  const archiveThread = async (id: string) => {
    const ok = await archive.run(() => api.post(`/api/assistant/conversations/${id}/archive`));
    if (ok) {
      threads.reload();
      if (activeId === id) startNew();
    }
  };

  const unavailable = Boolean(status.data && !status.data.available);

  return (
    <div className="space-y-4">
      {unavailable && (
        <Notice isLight={isLight} tone="warn" title="The assistant cannot answer yet">
          {status.data?.reason}
        </Notice>
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Threads */}
        <div className={`border rounded-xl overflow-hidden ${t.card}`}>
          <div className={`px-3.5 py-2.5 border-b ${t.border} flex items-center justify-between gap-2`}>
            <span className={`text-xs font-bold ${t.heading}`}>Conversations</span>
            <Button isLight={isLight} variant="ghost" icon={MessageSquarePlus} onClick={startNew}>
              New
            </Button>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-1.5 space-y-1">
            {threads.loading ? (
              <Spinner isLight={isLight} />
            ) : (threads.data ?? []).length === 0 ? (
              <p className={`text-[11px] px-2 py-4 text-center ${t.faint}`}>
                No conversations yet.
              </p>
            ) : (
              (threads.data ?? []).map((thread) => (
                <div
                  key={thread.id}
                  className={`group rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                    activeId === thread.id
                      ? "bg-indigo-600/10"
                      : isLight
                        ? "hover:bg-slate-100"
                        : "hover:bg-slate-800/40"
                  }`}
                  onClick={() => openThread(thread.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-medium truncate ${
                          activeId === thread.id ? "text-indigo-600" : t.body
                        }`}
                      >
                        {thread.title || "Untitled"}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${t.faint}`}>
                        {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"} ·{" "}
                        {formatAgo(thread.updatedAt)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        archiveThread(thread.id);
                      }}
                      title="Archive"
                      className={`opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer ${t.faint} hover:text-indigo-500`}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={`border rounded-xl flex flex-col ${t.card}`} style={{ minHeight: 460 }}>
          <div className={`px-4 py-2.5 border-b ${t.border} flex items-center gap-2`}>
            <Bot className="h-4 w-4 text-indigo-500" />
            <div className="min-w-0">
              <div className={`text-xs font-bold ${t.heading}`}>Business assistant</div>
              <div className={`text-[10.5px] ${t.muted}`}>
                Answers from your business profile and your own documents — nothing else.
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: 420 }}>
            {loadThread.busy ? (
              <Spinner isLight={isLight} />
            ) : messages.length === 0 ? (
              <EmptyState isLight={isLight} icon={Sparkles} title="Ask about your own business">
                <div className="space-y-2.5">
                  <p>
                    The assistant is given your business profile and the document excerpts relevant to
                    each question. When something is not covered it says so and asks, rather than
                    filling the gap with a plausible guess.
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter}
                        disabled={unavailable || ask.busy}
                        onClick={() => send(starter)}
                        className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${t.inset} hover:border-indigo-500`}
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              </EmptyState>
            ) : (
              messages.map((message) => (
                <div key={message.id}>
                  <MessageBubble isLight={isLight} message={message} />
                </div>
              ))
            )}

            {ask.busy && (
              <div className="flex items-center gap-2 pl-9">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </span>
                <span className={`text-[11px] ${t.faint}`}>Reading your business data…</span>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {lastResult && <Provenance isLight={isLight} result={lastResult} />}

          <div className={`border-t ${t.border} p-3.5 space-y-2.5`}>
            <ErrorNotice isLight={isLight} error={ask.error} onDismiss={ask.clearError} />
            <div className="flex items-end gap-2">
              <TextArea
                isLight={isLight}
                rows={2}
                value={question}
                disabled={unavailable}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  unavailable ? "Configure an AI provider to use the assistant" : "Ask a question…"
                }
                className="flex-1"
              />
              <Button
                isLight={isLight}
                variant="primary"
                icon={Send}
                busy={ask.busy}
                disabled={unavailable || !question.trim()}
                onClick={() => send()}
                className="h-9"
              >
                Ask
              </Button>
            </div>
            <p className={`text-[10px] ${t.faint}`}>
              Enter to send, Shift+Enter for a new line.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ isLight, message }: Themed & { message: AssistantMessageView }) {
  const t = tokens(isLight);
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
          isUser
            ? isLight
              ? "bg-slate-200 text-slate-600"
              : "bg-slate-700 text-slate-300"
            : "bg-gradient-to-br from-indigo-500 to-violet-600 text-white"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={`max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block text-left border rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
            isUser ? t.inset : t.card
          } ${t.body}`}
        >
          {message.content}
        </div>
        {!isUser && message.model && (
          <div className={`text-[10px] mt-1 flex items-center gap-2 flex-wrap ${t.faint}`}>
            <span className="font-mono">
              {message.provider}/{message.model}
            </span>
            {message.promptName && (
              <span className="font-mono">
                {message.promptName} v{message.promptVersion}
              </span>
            )}
            {message.totalTokens !== null && <span>{message.totalTokens} tokens</span>}
            {message.latencyMs !== null && <span>{message.latencyMs} ms</span>}
            {message.citedChunkIds.length > 0 && (
              <span>
                {message.citedChunkIds.length} excerpt
                {message.citedChunkIds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the last answer was grounded in. */
function Provenance({ isLight, result }: Themed & { result: AskResult }) {
  const t = tokens(isLight);
  const [open, setOpen] = useState(false);

  return (
    <div className={`border-t ${t.border} px-3.5 py-2.5`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer ${t.muted} hover:text-indigo-500`}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <FileText className="h-3 w-3" />
        {result.citations.length === 0
          ? "Answered from the business profile only — no document excerpt was relevant"
          : `Grounded in ${result.citations.length} excerpt${result.citations.length === 1 ? "" : "s"}`}
      </button>

      {open && result.citations.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {result.citations.map((citation) => (
            <div
              key={citation.chunkId}
              className={`border rounded-lg px-3 py-2 flex items-center justify-between gap-3 ${t.inset}`}
            >
              <span className={`text-[11px] font-medium truncate ${t.body}`}>
                {citation.documentTitle}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <Badge isLight={isLight} tone={citation.method === "embedding" ? "info" : "neutral"}>
                  {citation.method}
                </Badge>
                <span className={`text-[10px] font-mono tabular-nums ${t.faint}`}>
                  {citation.score.toFixed(3)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
