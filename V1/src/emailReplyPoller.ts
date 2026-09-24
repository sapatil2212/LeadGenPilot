/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email reply poller — the email counterpart to the WhatsApp inbound handler.
 * Periodically checks each configured sending mailbox over IMAP for new
 * messages, and forwards any reply to the registered handler so it can be
 * matched to a lead and recorded as a conversation.
 *
 * Non-intrusive: it does NOT mark messages as read/seen. Instead it tracks the
 * last processed IMAP UID per mailbox in a small JSON state file, and only
 * ingests messages that arrived after the poller first saw the mailbox.
 */

import path from "path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readJson, writeJsonAtomic } from "./storage";
import { logger } from "./logger";

export interface ImapMailbox {
  id: string; // stable key, namespaced by tenant
  tenantId?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface InboundEmail {
  mailboxId: string;
  /** Stable mailbox-local UID, used to make polling retries idempotent. */
  messageId: string;
  tenantId?: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
}

export type EmailReplyHandler = (email: InboundEmail) => Promise<void> | void;

const STATE_PATH = path.join(process.cwd(), "email-poll-state.json");

function loadState(): Record<string, number> {
  return readJson<Record<string, number>>(STATE_PATH, {});
}
function saveState(state: Record<string, number>): void {
  writeJsonAtomic(STATE_PATH, state);
}

/** Best-effort IMAP host derivation from an SMTP host for common providers. */
export function deriveImapHost(smtpHost: string): string {
  const h = (smtpHost || "").toLowerCase().trim();
  if (!h) return "";
  if (h.includes("gmail")) return "imap.gmail.com";
  if (h.includes("outlook") || h.includes("office365") || h.includes("hotmail") || h.includes("live.com")) return "outlook.office365.com";
  if (h.includes("yahoo")) return "imap.mail.yahoo.com";
  if (h.includes("zoho")) return "imap.zoho.com";
  if (h.startsWith("smtp.")) return "imap." + h.slice(5);
  return h;
}

let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;

async function pollMailbox(mb: ImapMailbox, onReply: EmailReplyHandler): Promise<void> {
  const client = new ImapFlow({
    host: mb.host,
    port: mb.port,
    secure: mb.secure,
    auth: { user: mb.user, pass: mb.pass },
    logger: false,
    // Fail fast rather than hanging the poll loop.
    socketTimeout: 20000,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox: any = client.mailbox;
      const uidNext: number = (mailbox && mailbox.uidNext) || 1;

      const state = loadState();
      const lastUid = state[mb.id];

      // First time we see this mailbox: baseline at the current top so we don't
      // ingest the entire existing inbox history.
      if (lastUid === undefined) {
        state[mb.id] = Math.max(0, uidNext - 1);
        saveState(state);
        return;
      }

      const rangeStart = lastUid + 1;
      if (rangeStart >= uidNext) return; // nothing new

      let maxUid = lastUid;
      for await (const msg of client.fetch(`${rangeStart}:*`, { uid: true, source: true, envelope: true }, { uid: true })) {
        if (msg.uid > maxUid) maxUid = msg.uid;
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const fromAddr = parsed.from?.value?.[0];
          const from = (fromAddr?.address || "").toLowerCase().trim();
          const fromName = fromAddr?.name || undefined;
          const subject = parsed.subject || "";
          const text = (parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, " ") : "") || "").trim();

          // Skip our own sent copies / empty senders.
          if (from && from !== mb.user.toLowerCase()) {
            await onReply({
              mailboxId: mb.id,
              messageId: `${mb.id}:${msg.uid}`,
              tenantId: mb.tenantId,
              from,
              fromName,
              subject,
              text,
            });
          }
        } catch (parseErr: any) {
          logger.warn(`Email poller: failed to parse a message in ${mb.user}: ${parseErr?.message || parseErr}`);
        }
      }

      state[mb.id] = maxUid;
      saveState(state);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Begin polling the given mailboxes for replies. `getMailboxes` is re-invoked
 * every cycle so newly-configured SMTP integrations are picked up automatically.
 */
export function startEmailReplyPolling(
  getMailboxes: () => Promise<ImapMailbox[]>,
  onReply: EmailReplyHandler,
  intervalMs = 60000
): void {
  if (pollTimer) return;

  const runCycle = async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const mailboxes = await getMailboxes();
      // De-duplicate mailboxes by address (env + user integrations can overlap).
      const seen = new Set<string>();
      for (const mb of mailboxes) {
        if (!mb.host || !mb.user || !mb.pass) continue;
        const key = mb.user.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await pollMailbox(mb, onReply);
        } catch (err: any) {
          logger.warn(`Email reply poll failed for ${mb.user}: ${err?.message || err}`);
        }
      }
    } finally {
      isPolling = false;
    }
  };

  pollTimer = setInterval(runCycle, intervalMs);
  // Kick off shortly after startup so it doesn't block boot.
  setTimeout(runCycle, 8000);
  logger.info(`Email reply poller started (every ${Math.round(intervalMs / 1000)}s).`);
}

export function stopEmailReplyPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
