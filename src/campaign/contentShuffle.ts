/**
 * Per-message AI content shuffle (anti-block "spin").
 *
 * At send time, lightly reword each outgoing message so a bulk run is not a
 * stream of byte-identical texts — the pattern spam filters key on. This is a
 * SURFACE reword: same structure, same offer, same call to action, same links
 * and variables. It is NOT a rewrite and must never change what the message
 * actually says or asks.
 *
 * The single hard rule: this must never block or fail a send. Any AI error,
 * timeout, or output that fails the safety checks returns the ORIGINAL text
 * unchanged. A sent-but-unshuffled message is always better than a blocked one.
 */

import { generateText } from "../ai/aiService";
import { AiUnavailableError } from "../ai/types";
import { logger } from "../logger";

/** Short timeout: this sits on the critical send path, on top of pacing delay. */
const SHUFFLE_TIMEOUT_MS = Math.max(3_000, Number(process.env.CAMPAIGN_SHUFFLE_TIMEOUT_MS) || 12_000);

/** Extract the set of {{variable}} tokens and bare URLs that must survive intact. */
function invariants(text: string): { variables: string[]; urls: string[] } {
  const variables = (text.match(/\{\{[^}]+\}\}/g) || []).map((v) => v.trim());
  const urls = (text.match(/https?:\/\/\S+/gi) || []).map((u) => u.replace(/[.,)]+$/, ""));
  return { variables, urls };
}

/**
 * Decide whether a candidate reword is safe to use. Rejects (→ keep original)
 * when the model dropped a variable, dropped/altered a URL, returned something
 * empty, or diverged wildly in length (a sign it rewrote rather than reworded).
 */
function isSafeReword(original: string, candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed === original.trim()) return false; // no change — not worth it, but harmless; treat as skip

  const o = invariants(original);
  const c = invariants(candidate);

  // Every original variable must appear, exactly, in the candidate.
  for (const v of o.variables) {
    if (!candidate.includes(v)) return false;
  }
  // No invented variables.
  if (c.variables.length !== o.variables.length) return false;

  // Every original URL must appear intact.
  for (const u of o.urls) {
    if (!candidate.includes(u)) return false;
  }
  // No invented URLs.
  if (c.urls.length !== o.urls.length) return false;

  // Length guard: a reword should stay within a reasonable band of the original.
  const ratio = trimmed.length / Math.max(1, original.trim().length);
  if (ratio < 0.55 || ratio > 1.8) return false;

  return true;
}

/**
 * Reword one message's text for anti-block variation.
 *
 * @param text     The final, variable-resolved message body to spin.
 * @param options  Tenant/user context for AI usage attribution.
 * @returns        A reworded version, or the original text on any failure.
 */
export async function shuffleMessageContent(
  text: string,
  options: { tenantId?: string; userId?: string } = {}
): Promise<string> {
  const original = text || "";
  if (original.trim().length < 15) return original; // too short to meaningfully vary

  try {
    const result = await generateText(
      {
        timeoutMs: SHUFFLE_TIMEOUT_MS,
        temperature: 0.8, // some variety, but not a rewrite
        messages: [
          {
            role: "system",
            content:
              "You lightly reword outreach messages to avoid duplicate-content spam filters. " +
              "Rules you must never break:\n" +
              "- Keep the SAME meaning, offer, tone and call to action. Do not add or remove any claim.\n" +
              "- Keep every {{variable}} token EXACTLY as written, in a natural place.\n" +
              "- Keep every URL and phone number EXACTLY as written. Never change, shorten or drop a link.\n" +
              "- Keep roughly the same length and the same line/paragraph structure, including emojis.\n" +
              "- Only vary wording and phrasing at the surface. This is a reword, not a rewrite.\n" +
              "- Output ONLY the reworded message text. No preamble, no quotes, no explanation.",
          },
          {
            role: "user",
            content: `Reword this message:\n\n${original}`,
          },
        ],
      },
      {
        operation: "campaign.contentShuffle",
        tenantId: options.tenantId,
        userId: options.userId,
      }
    );

    const candidate = result.text || "";
    if (isSafeReword(original, candidate)) {
      return candidate.trim();
    }
    // The reword failed a safety check (dropped a variable/URL, too divergent).
    // Fall back silently — the original is always correct.
    return original;
  } catch (err) {
    // AiUnavailableError (no provider / all failed) or any other error: never
    // let anti-block variation block an actual send.
    if (!(err instanceof AiUnavailableError)) {
      logger.warn(`Content shuffle failed; sending original text: ${(err as Error)?.message || err}`);
    }
    return original;
  }
}
