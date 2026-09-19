/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenRouter adapter (OpenAI-compatible chat completions).
 */

import axios from "axios";
import {
  AiProviderError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
} from "../types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Reads the API key.
 *
 * OPENROUTER_API_KEY is the name the code has always read. OPEN_ROUTER_API is
 * accepted too because that is the name actually present in this project's .env
 * files — the mismatch meant the configured key was never used and every lead
 * insight silently fell through to Gemini. Accepting both fixes existing
 * deployments without requiring anyone to edit their environment first.
 */
function readApiKey(): string {
  const candidates = [process.env.OPENROUTER_API_KEY, process.env.OPEN_ROUTER_API];
  for (const value of candidates) {
    const key = (value || "").trim();
    if (key && key !== "YOUR_OPENROUTER_API_KEY") return key;
  }
  return "";
}

/** 429 and 5xx are worth another attempt; a bad key or bad request is not. */
function isRetryableStatus(status?: number): boolean {
  if (!status) return true; // no response at all: DNS, socket, timeout
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export const openRouterProvider: AiProvider = {
  id: "openrouter",
  defaultModel: "google/gemini-2.5-flash",

  isConfigured() {
    return readApiKey() !== "";
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("openrouter", "No OpenRouter API key configured.");

    const model = request.model || openRouterProvider.defaultModel;
    const started = Date.now();

    try {
      const response = await axios.post(
        ENDPOINT,
        {
          model,
          messages: request.messages,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // OpenRouter asks callers to identify themselves for attribution.
            "HTTP-Referer": process.env.APP_URL || "https://nexaleadai.com",
            "X-Title": process.env.APP_NAME || "NexaLeadAi",
          },
          timeout: request.timeoutMs ?? 30_000,
        }
      );

      const text = String(response.data?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        throw new AiProviderError("openrouter", "OpenRouter returned an empty completion.", {
          retryable: true,
        });
      }

      const usage = response.data?.usage;
      return {
        text,
        provider: "openrouter",
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
      const detail =
        err?.response?.data?.error?.message || err?.message || "OpenRouter request failed.";
      throw new AiProviderError("openrouter", detail, {
        status,
        retryable: isRetryableStatus(status),
        cause: err,
      });
    }
  },
};
