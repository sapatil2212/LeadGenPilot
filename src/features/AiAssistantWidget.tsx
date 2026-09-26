/**
 * Floating AI Assistant Widget
 * 
 * Freely draggable widget positioned at the bottom-right corner by default.
 * Powered by Gemini AI via /api/assistant/ask using the workspace's business context.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot,
  Sparkles,
  Send,
  X,
  Minus,
  RotateCcw,
  GripVertical,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ArrowUp
} from "lucide-react";
import { api } from "../ui/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  createdAt: string;
}

interface AiAssistantWidgetProps {
  isLight: boolean;
}

const STARTER_PROMPTS = [
  "🎯 How can I improve my outreach response rates?",
  "📝 Help me draft a high-converting cold email",
  "🔍 What makes a high-fit lead for my business?",
  "💡 Summarize our company profile & offerings"
];

export default function AiAssistantWidget({ isLight }: AiAssistantWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Position & Dragging State
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    elemX: number;
    elemY: number;
    hasMoved: boolean;
  }>({ startX: 0, startY: 0, elemX: 0, elemY: 0, hasMoved: false });

  const widgetRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load saved position or set default (bottom-right: 24px from bottom, 24px from right)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("leadgen_ai_widget_pos");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          // Clamp to current viewport
          const clampedX = Math.max(12, Math.min(window.innerWidth - 90, parsed.x));
          const clampedY = Math.max(12, Math.min(window.innerHeight - 90, parsed.y));
          setPosition({ x: clampedX, y: clampedY });
          return;
        }
      }
    } catch {
      // ignore
    }

    // Default position: bottom-right
    const defaultX = Math.max(12, window.innerWidth - (isOpen ? 410 : 80));
    const defaultY = Math.max(12, window.innerHeight - (isOpen ? 540 : 80));
    setPosition({ x: defaultX, y: defaultY });
  }, []);

  // Update position when window is resized to keep in bounds
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev) return null;
        const width = isOpen ? 390 : 64;
        const height = isOpen ? 520 : 64;
        return {
          x: Math.max(12, Math.min(window.innerWidth - width - 12, prev.x)),
          y: Math.max(12, Math.min(window.innerHeight - height - 12, prev.y))
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Dragging handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag with primary mouse button or touch
    if (e.button !== 0 && e.pointerType === "mouse") return;
    
    // Don't drag if clicking buttons, textarea, or links
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("textarea") || target.closest("a") || target.closest("input")) {
      return;
    }

    e.preventDefault();
    const currentX = position ? position.x : window.innerWidth - (isOpen ? 410 : 80);
    const currentY = position ? position.y : window.innerHeight - (isOpen ? 540 : 80);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      elemX: currentX,
      elemY: currentY,
      hasMoved: false
    };

    setIsDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - dragRef.current.startX;
      const deltaY = moveEvent.clientY - dragRef.current.startY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        dragRef.current.hasMoved = true;
      }

      const width = isOpen ? 390 : 64;
      const height = isOpen ? 520 : 64;

      const newX = Math.max(12, Math.min(window.innerWidth - width - 12, dragRef.current.elemX + deltaX));
      const newY = Math.max(12, Math.min(window.innerHeight - height - 12, dragRef.current.elemY + deltaY));

      setPosition({ x: newX, y: newY });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      // Save position
      setPosition((latest) => {
        if (latest) {
          try {
            localStorage.setItem("leadgen_ai_widget_pos", JSON.stringify(latest));
          } catch {
            // ignore
          }
        }
        return latest;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [position, isOpen]);

  // Handle clicking the minimized trigger
  const handleTriggerClick = (e: React.MouseEvent) => {
    // If user dragged more than 4px, don't toggle open/close
    if (dragRef.current.hasMoved) {
      dragRef.current.hasMoved = false;
      return;
    }
    setIsOpen(true);
    // Adjust position so window fits on screen if it opened near right or bottom edge
    setPosition((prev) => {
      if (!prev) return null;
      const width = 390;
      const height = 520;
      return {
        x: Math.max(12, Math.min(window.innerWidth - width - 12, prev.x)),
        y: Math.max(12, Math.min(window.innerHeight - height - 12, prev.y))
      };
    });
  };

  // Send message to Gemini assistant
  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || loading) return;

    setError(null);
    setInput("");

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: textToSend,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await api.post<{
        conversationId: string;
        answer: string;
        citations?: any[];
        messages?: any[];
      }>("/api/assistant/ask", {
        question: textToSend,
        conversationId: conversationId || undefined
      });

      if (res && res.answer) {
        setConversationId(res.conversationId);
        const assistantMessage: Message = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: res.answer,
          citations: Array.isArray(res.citations) ? res.citations.map((c) => c.documentTitle || c.chunkId) : undefined,
          createdAt: new Date().toISOString()
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error("No response received from AI.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to get AI answer. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to format assistant markdown output cleanly
  const renderFormattedContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, idx) => {
      // Bold text formatting
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const formattedLine = parts.map((part, pIdx) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={pIdx} className={isLight ? "text-slate-900 font-bold" : "text-white font-bold"}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        return part;
      });

      if (line.startsWith("• ") || line.startsWith("- ")) {
        return (
          <li key={idx} className="ml-4 list-disc my-0.5">
            {formattedLine}
          </li>
        );
      }
      if (/^\d+\.\s/.test(line)) {
        return (
          <div key={idx} className="ml-1 my-1 font-medium">
            {formattedLine}
          </div>
        );
      }
      if (!line.trim()) {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p key={idx} className="my-0.5 leading-relaxed">
          {formattedLine}
        </p>
      );
    });
  };

  const currentX = position ? position.x : 24;
  const currentY = position ? position.y : 24;
  const stylePos = position
    ? { left: `${currentX}px`, top: `${currentY}px` }
    : { right: "24px", bottom: "24px" };

  return (
    <div
      ref={widgetRef}
      style={stylePos}
      className={`fixed z-[99999] select-none ${isDragging ? "cursor-grabbing" : ""}`}
    >
      {/* ── EXPANDED CHAT WIDGET ── */}
      {isOpen ? (
        <div
          className={`flex flex-col w-[390px] max-w-[calc(100vw-24px)] h-[530px] max-h-[calc(100vh-28px)] rounded-2xl border shadow-2xl overflow-hidden transition-all duration-150 animate-scaleUp ${
            isLight
              ? "bg-white/95 backdrop-blur-xl border-slate-200 text-slate-900 shadow-slate-300/60"
              : "bg-[#090d16]/95 backdrop-blur-xl border-[#1e293b] text-white shadow-black/80"
          }`}
        >
          {/* Header & Drag Handle */}
          <div
            onPointerDown={handlePointerDown}
            className={`px-3.5 py-3 border-b flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors ${
              isLight
                ? "bg-slate-50/90 border-slate-200/80 hover:bg-slate-100/70"
                : "bg-[#0a0f1c]/90 border-slate-800/80 hover:bg-[#0d1527]/70"
            }`}
            title="Click and drag to move widget anywhere on screen"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1 text-slate-400 hover:text-slate-200 cursor-grab" title="Drag to reposition">
                <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
              </div>
              <div className="relative">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-xs">
                  <Bot className="h-4 w-4" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#090d16]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold truncate">AI Assistant</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Gemini
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Workspace Grounded
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleReset}
                title="New conversation"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isLight ? "text-slate-500 hover:bg-slate-200/80" : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Minimize assistant"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isLight ? "text-slate-500 hover:bg-slate-200/80" : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close assistant"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isLight ? "text-slate-500 hover:bg-slate-200/80 hover:text-slate-900" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs select-text">
            {messages.length === 0 ? (
              <div className="py-4 px-2 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600/20 via-violet-600/20 to-purple-600/20 border border-indigo-500/25 flex items-center justify-center mx-auto text-indigo-400 shadow-inner">
                  <Sparkles className="h-6 w-6 text-indigo-400 animate-pulse" />
                </div>
                <div>
                  <h4 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                    How can I help you today?
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-[280px] mx-auto leading-relaxed">
                    Ask questions grounded in your workspace's business profile, knowledge docs, and outreach strategies.
                  </p>
                </div>

                <div className="space-y-1.5 text-left pt-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                    Suggested Questions
                  </div>
                  {STARTER_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSendMessage(prompt)}
                      className={`w-full text-left p-2 rounded-xl border text-[11px] font-medium transition-all cursor-pointer ${
                        isLight
                          ? "bg-slate-50 hover:bg-indigo-50/70 border-slate-200 hover:border-indigo-300 text-slate-700 hover:text-indigo-800"
                          : "bg-slate-900/60 hover:bg-indigo-950/40 border-slate-800 hover:border-indigo-500/40 text-slate-300 hover:text-indigo-200"
                      }`}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
                  >
                    <div
                      className={`relative max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                        isUser
                          ? "bg-indigo-600 text-white rounded-tr-xs shadow-sm"
                          : isLight
                            ? "bg-slate-100/90 text-slate-800 border border-slate-200/80 rounded-tl-xs shadow-xs"
                            : "bg-[#101726] text-slate-200 border border-slate-800/80 rounded-tl-xs shadow-xs"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <div className="space-y-1">
                          {renderFormattedContent(m.content)}

                          {/* Citations if any */}
                          {m.citations && m.citations.length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-slate-500/20 flex flex-wrap gap-1">
                              <span className="text-[9px] text-slate-400 uppercase font-semibold">Sources:</span>
                              {m.citations.map((c, idx) => (
                                <span
                                  key={idx}
                                  className="text-[9.5px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!isUser && (
                      <div className="flex items-center gap-1.5 px-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content, m.id)}
                          className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex items-start gap-2 max-w-[85%]">
                <div
                  className={`rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs flex items-center gap-2 ${
                    isLight ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-[#101726] text-slate-300 border border-slate-800"
                  }`}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                  <span className="text-[11px] font-medium">Gemini is thinking…</span>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-2.5 text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="flex-1 text-[11px]">
                  <span>{error}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div
            className={`p-2.5 border-t ${
              isLight ? "bg-slate-50/70 border-slate-200/80" : "bg-[#0a0f1c]/80 border-slate-800/80"
            }`}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-1.5"
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask anything about your business or leads…"
                rows={1}
                disabled={loading}
                className={`flex-1 resize-none px-3 py-2 text-xs rounded-xl border outline-none max-h-24 ${
                  isLight
                    ? "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
                    : "bg-[#030712] border-slate-800 text-white placeholder:text-slate-500 focus:border-indigo-500"
                }`}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="w-8 h-8 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white shrink-0 shadow-xs cursor-pointer transition-all hover:scale-105 active:scale-95"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
            <div className="flex items-center justify-between mt-1 px-1 text-[9.5px] text-slate-400">
              <span>Press Enter to send</span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5 text-indigo-400" />
                Gemini 2.5 Flash
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ── COLLAPSED FLOATING BUTTON ── */
        <div
          onPointerDown={handlePointerDown}
          onClick={handleTriggerClick}
          className="group relative flex items-center cursor-grab active:cursor-grabbing"
          title="AI Business Assistant (Drag to reposition, click to open)"
        >
          {/* Tooltip on hover */}
          <div
            className={`absolute right-full mr-2.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold whitespace-nowrap shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity ${
              isLight
                ? "bg-white/95 text-slate-800 border-slate-200"
                : "bg-slate-900/95 text-white border-slate-800"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <span>Ask AI Assistant</span>
              <span className="text-[9px] text-slate-400 font-normal">· Drag to move</span>
            </div>
          </div>

          {/* Floating Pill / Button */}
          <div className="relative flex items-center gap-2 p-1.5 pr-3.5 rounded-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:scale-105 active:scale-95 transition-all duration-150">
            <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-xs flex items-center justify-center relative">
              <Bot className="h-5 w-5" />
              <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-indigo-600" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold leading-none">AI Assistant</span>
              <span className="text-[9.5px] text-indigo-100/80 leading-tight mt-0.5">Gemini 2.5</span>
            </div>
            <GripVertical className="h-3.5 w-3.5 opacity-60 text-indigo-200 shrink-0 ml-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}
