/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Anthropic (Claude) adapter.
 *
 * Two shape differences from the OpenAI-style APIs are handled here:
 *   - the system prompt is a top-level field, not a message;
 *   - max_tokens is mandatory, so a default is supplied.
 * Anthropic has no JSON response mode, so `json: true` becomes a prompt
 * instruction and the service's parser does the rest.
 */

import axios from "axios";
import {
  AiProviderError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
} from "../types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
/** Anthropic requires max_tokens; this is a sane ceiling for our prompts. */
const DEFAULT_MAX_TOKENS = 4096;

function readApiKey(): string {
  return (process.env.ANTHROPIC_API_KEY || "").trim();
}

function isRetryableStatus(status?: number): boolean {
  if (!status) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  defaultModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",

  isConfigured() {
    return readApiKey() !== "";
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("anthropic", "No Anthropic API key configured.");

    const model = request.model || anthropicProvider.defaultModel;
    const started = Date.now();

    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();

    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    // No native JSON mode; ask for it explicitly.
    const systemWithFormat = request.json
      ? `${system}\n\nRespond with raw JSON only. No prose, no markdown fences.`.trim()
      : system;

    try {
      const response = await axios.post(
        ENDPOINT,
        {
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages,
          ...(systemWithFormat ? { system: systemWithFormat } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
            "Content-Type": "application/json",
          },
          timeout: request.timeoutMs ?? 30_000,
        }
      );

      // Content is a list of blocks; concatenate the text ones.
      const blocks = (response.data?.content || []) as { type: string; text?: string }[];
      const text = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("")
        .trim();

      if (!text) {
        throw new AiProviderError("anthropic", "Anthropic returned an empty completion.", {
          retryable: true,
        });
      }

      const usage = response.data?.usage;
      return {
        text,
        provider: "anthropic",
        model,
        usage: usage
          ? {
              promptTokens: usage.input_tokens,
              completionTokens: usage.output_tokens,
              totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            }
          : undefined,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.error?.message || err?.message || "Anthropic request failed.";
      throw new AiProviderError("anthropic", detail, {
        status,
        retryable: isRetryableStatus(status),
        cause: err,
      });
    }
  },
};
