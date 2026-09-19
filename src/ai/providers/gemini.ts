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

function isRetryableMessage(message: string): boolean {
  return /429|rate|quota|timeout|ETIMEDOUT|ECONNRESET|socket|unavailable|overloaded|50\d/i.test(
    message
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
      const message = err?.message || "Gemini request failed.";
      throw new AiProviderError("gemini", message, {
        retryable: isRetryableMessage(String(message)),
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
      const message = err?.message || "Gemini embedding request failed.";
      throw new AiProviderError("gemini", message, {
        retryable: isRetryableMessage(String(message)),
        cause: err,
      });
    }
  },
};
