/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Conversation store — tracks two-way threads with leads. When a lead replies
 * (currently via WhatsApp; email-reply ingestion can plug in later) the reply
 * is recorded here and the thread is marked as an active conversation. Outbound
 * messages (manual sends + campaign dispatches) are also recorded so each
 * thread reads as a real chat history.
 *
 * Persisted as an atomically-written JSON file, consistent with the rest of the
 * app's lightweight local storage (see src/storage.ts). No DB migration needed.
 */

import path from "path";
import { readJson, writeJsonAtomic, withLock } from "./storage";

export type ConversationChannel = "whatsapp" | "email";
export type ConversationStatus = "AWAITING_REPLY" | "REPLIED" | "CLOSED";

export interface ConversationMessage {
  id: string;
  direction: "in" | "out";
  channel: ConversationChannel;
  text: string;
  timestamp: string; // ISO
}

export interface Conversation {
  id: string; // stable key, e.g. "wa:919812345678" or "em:owner@biz.com"
  leadId?: string;
  businessName: string;
  phone?: string;
  email?: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  messages: ConversationMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), "conversations.json");
const MAX_MESSAGES_PER_THREAD = 500;

/** Last 10 digits of a phone number — used to match a WhatsApp sender to a lead. */
export function normalizePhoneKey(phone: string): string {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  return digits.slice(-10);
}

export function whatsappConversationId(phone: string): string {
  return `wa:${normalizePhoneKey(phone)}`;
}

export function emailConversationId(email: string): string {
  return `em:${String(email || "").trim().toLowerCase()}`;
}

function loadAll(): Conversation[] {
  return readJson<Conversation[]>(STORE_PATH, []);
}

function saveAll(list: Conversation[]): void {
  writeJsonAtomic(STORE_PATH, list);
}

function newMessage(direction: "in" | "out", channel: ConversationChannel, text: string): ConversationMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction,
    channel,
    text: text || "",
    timestamp: new Date().toISOString(),
  };
}

function preview(text: string): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? t.slice(0, 90) + "…" : t;
}

export interface InboundParams {
  channel: ConversationChannel;
  phone?: string;
  email?: string;
  text: string;
  leadId?: string;
  businessName?: string;
}

/** Record an inbound reply from a lead → marks the thread REPLIED and unread. */
export async function recordInbound(params: InboundParams): Promise<Conversation> {
  return withLock("conversations", () => {
    const list = loadAll();
    const id = params.channel === "whatsapp"
      ? whatsappConversationId(params.phone || "")
      : emailConversationId(params.email || "");

    let convo = list.find((c) => c.id === id);
    const msg = newMessage("in", params.channel, params.text);

    if (!convo) {
      convo = {
        id,
        leadId: params.leadId,
        businessName: params.businessName || params.phone || params.email || "Unknown",
        phone: params.phone,
        email: params.email,
        channel: params.channel,
        status: "REPLIED",
        messages: [msg],
        lastMessageAt: msg.timestamp,
        lastMessagePreview: preview(params.text),
        unread: 1,
        createdAt: msg.timestamp,
      };
      list.push(convo);
    } else {
      convo.messages.push(msg);
      convo.messages = convo.messages.slice(-MAX_MESSAGES_PER_THREAD);
      convo.status = "REPLIED";
      convo.unread += 1;
      convo.lastMessageAt = msg.timestamp;
      convo.lastMessagePreview = preview(params.text);
      if (params.leadId && !convo.leadId) convo.leadId = params.leadId;
      if (params.businessName) convo.businessName = params.businessName;
    }

    saveAll(list);
    return convo;
  });
}

export interface OutboundParams {
  channel: ConversationChannel;
  phone?: string;
  email?: string;
  text: string;
  leadId?: string;
  businessName?: string;
}

/**
 * Record an outbound message we sent to a lead. Creates the thread if needed
 * and marks it AWAITING_REPLY (unless the lead has already replied, in which
 * case the active REPLIED status is preserved).
 */
export async function recordOutbound(params: OutboundParams): Promise<Conversation> {
  return withLock("conversations", () => {
    const list = loadAll();
    const id = params.channel === "whatsapp"
      ? whatsappConversationId(params.phone || "")
      : emailConversationId(params.email || "");

    let convo = list.find((c) => c.id === id);
    const msg = newMessage("out", params.channel, params.text);

    if (!convo) {
      convo = {
        id,
        leadId: params.leadId,
        businessName: params.businessName || params.phone || params.email || "Unknown",
        phone: params.phone,
        email: params.email,
        channel: params.channel,
        status: "AWAITING_REPLY",
        messages: [msg],
        lastMessageAt: msg.timestamp,
        lastMessagePreview: preview(params.text),
        unread: 0,
        createdAt: msg.timestamp,
      };
      list.push(convo);
    } else {
      convo.messages.push(msg);
      convo.messages = convo.messages.slice(-MAX_MESSAGES_PER_THREAD);
      if (convo.status !== "REPLIED") convo.status = "AWAITING_REPLY";
      convo.lastMessageAt = msg.timestamp;
      convo.lastMessagePreview = preview(params.text);
      if (params.leadId && !convo.leadId) convo.leadId = params.leadId;
      if (params.businessName && (!convo.businessName || convo.businessName === convo.phone)) convo.businessName = params.businessName;
    }

    saveAll(list);
    return convo;
  });
}

export function listConversations(): { conversations: Conversation[]; totalUnread: number } {
  const list = loadAll().sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );
  const totalUnread = list.reduce((sum, c) => sum + (c.unread || 0), 0);
  return { conversations: list, totalUnread };
}

export function getConversation(id: string): Conversation | null {
  return loadAll().find((c) => c.id === id) || null;
}

export async function markConversationRead(id: string): Promise<Conversation | null> {
  return withLock("conversations", () => {
    const list = loadAll();
    const convo = list.find((c) => c.id === id);
    if (!convo) return null;
    convo.unread = 0;
    saveAll(list);
    return convo;
  });
}

export async function setConversationStatus(id: string, status: ConversationStatus): Promise<Conversation | null> {
  return withLock("conversations", () => {
    const list = loadAll();
    const convo = list.find((c) => c.id === id);
    if (!convo) return null;
    convo.status = status;
    saveAll(list);
    return convo;
  });
}

export async function deleteConversation(id: string): Promise<boolean> {
  return withLock("conversations", () => {
    const list = loadAll();
    const next = list.filter((c) => c.id !== id);
    const removed = next.length !== list.length;
    if (removed) saveAll(next);
    return removed;
  });
}
