/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Gemini adapter, including embeddings.
 */

import {
  AiProviderError,
  type AiProvider,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
} from "../types";

function readApiKey(): string {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  return key && key !== "MY_GEMINI_API_KEY" ? key : "";
}

/**
 * Gemini takes a single system instruction plus a turn list, so system messages
 * are hoisted out and joined rather than sent inline. Assistant turns map to
 * the "model" role.
 */
function splitMessages(request: GenerateRequest) {
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();

  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  return { system, contents };
}

/**
 * Credentials and permissions. Never retryable: the second attempt is rejected
 * for the same reason as the first, and retrying makes a configuration problem
 * look like a flaky network.
 */
function isAuthMessage(message: string): boolean {
  return /\b401\b|\b403\b|UNAUTHENTICATED|PERMISSION_DENIED|ACCESS_TOKEN_TYPE_UNSUPPORTED|API_KEY_INVALID|API key not valid|invalid authentication credentials/i.test(
    message
  );
}

/**
 * Transient conditions worth a second attempt.
 *
 * Each term is anchored on word boundaries deliberately. A bare /rate/ matched
 * "GenerateContent" — the method name present in every Generative Language API
 * error — so every failure, including a hard 401, was classified as retryable
 * and cost an extra round trip before falling through to the next provider.
 */
function isRetryableMessage(message: string): boolean {
  if (isAuthMessage(message)) return false;
  return /\b429\b|\b50\d\b|rate limit|\bquota\b|\btimeout\b|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|\bsocket\b|\bunavailable\b|\boverloaded\b|deadline exceeded/i.test(
    message
  );
}

/**
 * Google AI Studio keys start with "AIza". A value in any other shape — most
 * commonly an "AQ."-prefixed ephemeral Live-API token or an OAuth access token —
 * is rejected with ACCESS_TOKEN_TYPE_UNSUPPORTED, which reads as a server-side
 * auth fault rather than the wrong kind of credential. Saying so once, on the
 * error, is what turns a 401 loop into a fixable message.
 */
function credentialShapeHint(apiKey: string): string {
  if (apiKey.startsWith("AIza")) return "";
  return (
    " GEMINI_API_KEY does not look like a Google AI Studio API key (those begin with \"AIza\"). " +
    "Ephemeral or OAuth tokens are not accepted for this endpoint — create a long-lived key at " +
    "https://aistudio.google.com/apikey."
  );
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  defaultModel: "gemini-2.5-flash",
  defaultEmbeddingModel: "text-embedding-004",

  isConfigured() {
    return readApiKey() !== "";
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("gemini", "No Gemini API key configured.");

    const model = request.model || geminiProvider.defaultModel;
    const started = Date.now();

    try {
      // Imported lazily so a deployment without the SDK still boots.
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const { system, contents } = splitMessages(request);

      const response = await ai.models.generateContent({
        model,
        contents: contents as any,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          ...(request.json ? { responseMimeType: "application/json" } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
        },
      });

      const text = (response.text || "").trim();
      if (!text) {
        throw new AiProviderError("gemini", "Gemini returned an empty completion.", {
          retryable: true,
        });
      }

      const meta = (response as any).usageMetadata;
      return {
        text,
        provider: "gemini",
        model,
        usage: meta
          ? {
              promptTokens: meta.promptTokenCount,
              completionTokens: meta.candidatesTokenCount,
              totalTokens: meta.totalTokenCount,
            }
          : undefined,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const raw = String(err?.message || "Gemini request failed.");
      const message = isAuthMessage(raw) ? `${raw}${credentialShapeHint(apiKey)}` : raw;
      throw new AiProviderError("gemini", message, {
        retryable: isRetryableMessage(raw),
        cause: err,
      });
    }
  },

  async embed(texts: string[], model?: string): Promise<EmbedResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("gemini", "No Gemini API key configured.");

    const embeddingModel = model || geminiProvider.defaultEmbeddingModel!;
    const started = Date.now();

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.embedContent({
        model: embeddingModel,
        contents: texts.map((text) => ({ parts: [{ text }] })) as any,
      });

      const vectors: number[][] = ((response as any).embeddings || []).map(
        (e: any) => e.values as number[]
      );

      if (vectors.length !== texts.length) {
        throw new AiProviderError(
          "gemini",
          `Embedding count mismatch: asked for ${texts.length}, received ${vectors.length}.`,
          { retryable: true }
        );
      }

      return {
        vectors,
        provider: "gemini",
        model: embeddingModel,
        dimensions: vectors[0]?.length ?? 0,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const raw = String(err?.message || "Gemini embedding request failed.");
      const message = isAuthMessage(raw) ? `${raw}${credentialShapeHint(apiKey)}` : raw;
      throw new AiProviderError("gemini", message, {
        retryable: isRetryableMessage(raw),
        cause: err,
      });
    }
  },
};
