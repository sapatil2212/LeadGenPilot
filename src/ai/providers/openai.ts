/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenAI adapter, including embeddings.
 *
 * Uses the REST API over axios rather than the official SDK: the request shape
 * is small and stable, and it keeps a dependency out of the tree for a provider
 * this deployment does not currently have credentials for.
 */

import axios from "axios";
import {
  AiProviderError,
  type AiProvider,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
} from "../types";

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function readApiKey(): string {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function isRetryableStatus(status?: number): boolean {
  if (!status) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export const openAiProvider: AiProvider = {
  id: "openai",
  defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",

  isConfigured() {
    return readApiKey() !== "";
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("openai", "No OpenAI API key configured.");

    const model = request.model || openAiProvider.defaultModel;
    const started = Date.now();

    try {
      const response = await axios.post(
        `${baseUrl()}/chat/completions`,
        {
          model,
          messages: request.messages,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: request.timeoutMs ?? 30_000,
        }
      );

      const text = String(response.data?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        throw new AiProviderError("openai", "OpenAI returned an empty completion.", {
          retryable: true,
        });
      }

      const usage = response.data?.usage;
      return {
        text,
        provider: "openai",
        model,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const status = err?.response?.status;
      const detail = err?.response?.data?.error?.message || err?.message || "OpenAI request failed.";
      throw new AiProviderError("openai", detail, {
        status,
        retryable: isRetryableStatus(status),
        cause: err,
      });
    }
  },

  async embed(texts: string[], model?: string): Promise<EmbedResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("openai", "No OpenAI API key configured.");

    const embeddingModel = model || openAiProvider.defaultEmbeddingModel!;
    const started = Date.now();

    try {
      const response = await axios.post(
        `${baseUrl()}/embeddings`,
        { model: embeddingModel, input: texts },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 30_000,
        }
      );

      // The API may return items out of order, so sort by the echoed index.
      const data = (response.data?.data || []) as { index: number; embedding: number[] }[];
      const vectors = data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      if (vectors.length !== texts.length) {
        throw new AiProviderError(
          "openai",
          `Embedding count mismatch: asked for ${texts.length}, received ${vectors.length}.`,
          { retryable: true }
        );
      }

      return {
        vectors,
        provider: "openai",
        model: embeddingModel,
        dimensions: vectors[0]?.length ?? 0,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.error?.message || err?.message || "OpenAI embedding request failed.";
      throw new AiProviderError("openai", detail, {
        status,
        retryable: isRetryableStatus(status),
        cause: err,
      });
    }
  },
};
