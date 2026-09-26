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
 * OpenRouter's zero-cost router.
 *
 * It picks among the models OpenRouter currently hosts for free, filtering for
 * the capabilities the request needs — structured output included, which is what
 * most calls here rely on. Naming the router rather than a specific `:free`
 * model matters because individual free models are retired without notice:
 * "google/gemini-2.0-flash-exp:free" was this project's obvious candidate and
 * now answers 404 "No endpoints found".
 */
const FREE_ROUTER_MODEL = "openrouter/free";

/**
 * Default chat model.
 *
 * The free router, because OpenRouter's role in the chain is to be the fallback
 * that still answers when the primary provider is down or unconfigured — and a
 * fallback that needs a funded balance is not a fallback. Point OPENROUTER_MODEL
 * at a paid model (e.g. "google/gemini-2.5-flash") on a funded account.
 */
function readModel(): string {
  return (process.env.OPENROUTER_MODEL || "").trim() || FREE_ROUTER_MODEL;
}

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

/**
 * A 402, or the message OpenRouter returns for one.
 *
 * The request shape is fine; the account balance cannot cover the reserved
 * output window. Worth separating from other 4xx because the cure is a
 * different model rather than a different request or another attempt.
 */
function isCreditsProblem(status: number | undefined, detail: string): boolean {
  return status === 402 || /requires more credits|fewer max_tokens/i.test(detail);
}

/** One chat completion against a named model. */
async function post(
  apiKey: string,
  model: string,
  request: GenerateRequest
): Promise<GenerateResult> {
  const started = Date.now();

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
        "HTTP-Referer": process.env.APP_URL || "https://leadgenpilot.com",
        "X-Title": process.env.APP_NAME || "LeadGenPilot",
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
    // The router substitutes a concrete model, so report what actually answered
    // rather than what was asked for.
    model: String(response.data?.model || model),
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined,
    latencyMs: Date.now() - started,
  };
}

export const openRouterProvider: AiProvider = {
  id: "openrouter",

  get defaultModel(): string {
    return readModel();
  },

  isConfigured() {
    return readApiKey() !== "";
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = readApiKey();
    if (!apiKey) throw new AiProviderError("openrouter", "No OpenRouter API key configured.");

    const model = request.model || readModel();

    try {
      return await post(apiKey, model, request);
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.error?.message || err?.message || "OpenRouter request failed.";

      // A paid model on an underfunded account: drop to the free router once
      // rather than failing the chain. This is the case that produced "You
      // requested up to 4096 tokens, but can only afford 4001" — the balance was
      // a few tokens short of the reservation, so nothing ran at all.
      if (isCreditsProblem(status, detail) && model !== FREE_ROUTER_MODEL) {
        try {
          return await post(apiKey, FREE_ROUTER_MODEL, request);
        } catch (freeErr: any) {
          if (freeErr instanceof AiProviderError) throw freeErr;
          const freeStatus = freeErr?.response?.status;
          const freeDetail =
            freeErr?.response?.data?.error?.message ||
            freeErr?.message ||
            "OpenRouter free-model request failed.";
          throw new AiProviderError(
            "openrouter",
            `${detail} Falling back to ${FREE_ROUTER_MODEL} also failed: ${freeDetail}`,
            { status: freeStatus, retryable: isRetryableStatus(freeStatus), cause: freeErr }
          );
        }
      }

      // Still non-retryable on the free router: another attempt with the same
      // budget cannot succeed, and treating billing as a network blip both
      // delays the next provider and misreports the cause.
      throw new AiProviderError("openrouter", detail, {
        status,
        retryable: isCreditsProblem(status, detail) ? false : isRetryableStatus(status),
        cause: err,
      });
    }
  },
};
