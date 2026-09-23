/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The single entry point for every AI call in the application.
 *
 * Owns the policy that used to be duplicated (and inconsistent) across the two
 * files that talked to vendor SDKs directly:
 *   - which providers to try, and in what order;
 *   - per-attempt timeouts — the previous Gemini path had none at all, so a
 *     hung request could stall a whole scrape;
 *   - retry, but only for errors where another attempt could plausibly succeed;
 *   - fallback to the next configured provider;
 *   - JSON parsing and one repair attempt for structured output;
 *   - usage accounting, so Phase 9 can meter it without touching call sites.
 */

import { logger } from "../logger";
import { openRouterProvider } from "./providers/openrouter";
import { geminiProvider } from "./providers/gemini";
import { openAiProvider } from "./providers/openai";
import { anthropicProvider } from "./providers/anthropic";
import {
  AiProviderError,
  AiUnavailableError,
  type AiProvider,
  type AiProviderId,
  type AiUsageEvent,
  type AiUsageSink,
  type GenerateRequest,
  type GenerateResult,
  type EmbedResult,
} from "./types";

const ALL_PROVIDERS: Record<AiProviderId, AiProvider> = {
  openrouter: openRouterProvider,
  gemini: geminiProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
};

/**
 * Default preference order.
 *
 * OpenRouter first because it fronts many models behind one key, then Gemini
 * (the key this deployment actually has), then the two direct vendors. Override
 * with AI_PROVIDER_ORDER="gemini,openai".
 */
const DEFAULT_ORDER: AiProviderId[] = ["openrouter", "gemini", "openai", "anthropic"];

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS_PER_PROVIDER = 2;

/**
 * Output ceiling applied when a caller does not name one.
 *
 * Not a micro-optimisation. Leaving `max_tokens` unset makes OpenRouter reserve
 * the model's entire output window — 65,535 tokens for Gemini 2.5 Flash — and
 * check the caller's credit balance against that reservation. On a free or
 * low-balance account every single request is refused before the model runs,
 * with "This request requires more credits, or fewer max_tokens". Observed
 * against a real account during Phase 4 verification.
 *
 * 4096 comfortably covers what any prompt here asks for: an insight is a
 * sentence, outreach copy is a short email, an assistant turn is a few
 * paragraphs, structured extraction is a compact JSON object.
 */
const DEFAULT_MAX_TOKENS = 4_096;
const STRUCTURED_MAX_TOKENS = 4_096;

function parseOrder(): AiProviderId[] {
  const raw = (process.env.AI_PROVIDER_ORDER || "").trim();
  if (!raw) return DEFAULT_ORDER;

  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AiProviderId => s in ALL_PROVIDERS);

  // Append any provider not named, so a typo cannot silently disable fallback.
  return [...requested, ...DEFAULT_ORDER.filter((p) => !requested.includes(p))];
}

/**
 * Providers to try for a request, in order.
 *
 * `preferred` is the tenant's configured choice. It moves to the front rather
 * than replacing the list, so a tenant preference cannot leave them with no
 * working provider when their pick is down.
 */
export function resolveProviderChain(preferred?: AiProviderId | null): AiProvider[] {
  const order = parseOrder();
  const ordered = preferred && preferred in ALL_PROVIDERS
    ? [preferred, ...order.filter((p) => p !== preferred)]
    : order;

  return ordered.map((id) => ALL_PROVIDERS[id]).filter((p) => p.isConfigured());
}

export function isAnyProviderConfigured(): boolean {
  return resolveProviderChain().length > 0;
}

export function configuredProviderIds(): AiProviderId[] {
  return resolveProviderChain().map((p) => p.id);
}

// ── usage accounting ─────────────────────────────────────────────────────────

let usageSink: AiUsageSink = (event) => {
  const tokens = event.usage?.totalTokens;
  logger.info(
    `AI ${event.operation} via ${event.provider}/${event.model} ` +
      `${event.ok ? "ok" : "FAILED"} in ${event.latencyMs}ms` +
      (tokens ? ` (${tokens} tokens)` : "") +
      (event.error ? ` — ${event.error}` : "")
  );
};

/** Phase 9 replaces the default sink with one that writes UsageEvent rows. */
export function setUsageSink(sink: AiUsageSink): void {
  usageSink = sink;
}

function record(event: AiUsageEvent): void {
  try {
    usageSink(event);
  } catch {
    /* accounting must never break the caller */
  }
}

// ── call options ─────────────────────────────────────────────────────────────

export interface AiCallOptions {
  /** Label for logs and usage records, e.g. "lead.insight". */
  operation: string;
  tenantId?: string;
  userId?: string;
  /** Tenant's preferred provider, when they have configured one. */
  preferredProvider?: AiProviderId | null;
  /** Require one provider and disable fallback for vendor-specific operations. */
  requiredProvider?: AiProviderId;
  promptName?: string;
  promptVersion?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wraps a promise in a hard timeout, so a hung provider cannot stall a caller. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Generates text, trying each configured provider in turn.
 *
 * Within a provider, a retryable failure gets one more attempt after a short
 * backoff; anything else moves straight to the next provider. Throws
 * AiUnavailableError only when every provider has been exhausted, with the
 * per-provider reasons attached — callers with a deterministic fallback (the
 * rule-based copy generators) catch that and degrade instead of failing.
 */
export async function generateText(
  request: GenerateRequest,
  options: AiCallOptions
): Promise<GenerateResult> {
  const chain = options.requiredProvider
    ? [ALL_PROVIDERS[options.requiredProvider]].filter((provider) => provider.isConfigured())
    : resolveProviderChain(options.preferredProvider);

  if (chain.length === 0) {
    const message = options.requiredProvider
      ? `${options.requiredProvider} is required for this operation but is not configured.`
      : "No AI provider is configured. Set GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY.";
    throw new AiUnavailableError(message, []);
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const attempts: { provider: AiProviderId; message: string }[] = [];

  for (const provider of chain) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      const started = Date.now();
      try {
        const result = await withTimeout(
          provider.generate({ ...request, timeoutMs, maxTokens }),
          timeoutMs + 2_000,
          `${provider.id} generate`
        );

        record({
          tenantId: options.tenantId,
          userId: options.userId,
          operation: options.operation,
          promptName: options.promptName,
          promptVersion: options.promptVersion,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
          ok: true,
        });

        return result;
      } catch (err: any) {
        const message = err?.message || String(err);
        const retryable = err instanceof AiProviderError ? err.retryable : true;

        record({
          tenantId: options.tenantId,
          userId: options.userId,
          operation: options.operation,
          promptName: options.promptName,
          promptVersion: options.promptVersion,
          provider: provider.id,
          model: request.model || provider.defaultModel,
          latencyMs: Date.now() - started,
          ok: false,
          error: message,
        });

        const lastAttemptForProvider = attempt === MAX_ATTEMPTS_PER_PROVIDER;
        if (!retryable || lastAttemptForProvider) {
          attempts.push({ provider: provider.id, message });
          break;
        }

        await sleep(500 * attempt);
      }
    }
  }

  throw new AiUnavailableError(
    `Every configured AI provider failed for ${options.operation}.`,
    attempts
  );
}

/**
 * Strips markdown fences and any prose around a JSON payload.
 *
 * Models asked for JSON still wrap it in ```json fences or add a sentence of
 * explanation often enough that this is worth doing before parsing.
 */
export function extractJson(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Fall back to the outermost brace/bracket pair.
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstObj = cleaned.indexOf("{");
    const firstArr = cleaned.indexOf("[");
    const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
    if (start >= 0) {
      const closing = cleaned[start] === "{" ? "}" : "]";
      const end = cleaned.lastIndexOf(closing);
      if (end > start) cleaned = cleaned.slice(start, end + 1);
    }
  }

  return cleaned;
}

export interface StructuredOptions<T> extends AiCallOptions {
  /**
   * Validates and narrows the parsed payload. Returning null or throwing marks
   * the response invalid and triggers one repair attempt.
   */
  validate: (value: unknown) => T | null;
}

/**
 * Generates JSON and validates it.
 *
 * On a parse or validation failure the model is asked once more, with the
 * failure described, before giving up. Callers therefore never see a
 * half-parsed object: they get a valid T or an exception.
 */
export async function generateStructuredOutput<T>(
  request: GenerateRequest,
  options: StructuredOptions<T>
): Promise<{ value: T; result: GenerateResult }> {
  const jsonRequest: GenerateRequest = {
    ...request,
    json: true,
    maxTokens: request.maxTokens ?? STRUCTURED_MAX_TOKENS,
  };

  const attemptOnce = async (req: GenerateRequest) => {
    const result = await generateText(req, options);
    const raw = extractJson(result.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      throw new Error(`Model did not return valid JSON: ${err?.message || err}`);
    }
    const value = options.validate(parsed);
    if (value === null || value === undefined) {
      throw new Error("Model returned JSON that did not match the expected shape.");
    }
    return { value, result };
  };

  try {
    return await attemptOnce(jsonRequest);
  } catch (firstError: any) {
    if (firstError instanceof AiUnavailableError) throw firstError;

    logger.warn(
      `AI ${options.operation}: ${firstError?.message || firstError}. Asking the model to correct it.`
    );

    const repairRequest: GenerateRequest = {
      ...jsonRequest,
      messages: [
        ...jsonRequest.messages,
        {
          role: "user",
          content:
            `Your previous reply could not be used: ${firstError?.message || "invalid JSON"}. ` +
            "Reply again with ONLY the raw JSON object, matching the requested schema exactly. " +
            "No markdown fences, no commentary.",
        },
      ],
    };

    return await attemptOnce(repairRequest);
  }
}

/**
 * Embeds text for knowledge retrieval.
 *
 * Only some providers offer embeddings, so the chain is filtered to those that
 * do. Consistency matters more here than for chat: vectors from different models
 * are not comparable, so a stored chunk records which model produced it and
 * retrieval must embed the query with the same one.
 */
export async function embedTexts(
  texts: string[],
  options: AiCallOptions & { model?: string }
): Promise<EmbedResult> {
  if (texts.length === 0) {
    throw new Error("embedTexts called with no input.");
  }

  const chain = resolveProviderChain(options.preferredProvider).filter((p) => typeof p.embed === "function");

  if (chain.length === 0) {
    throw new AiUnavailableError(
      "No configured AI provider supports embeddings. Set GEMINI_API_KEY or OPENAI_API_KEY.",
      []
    );
  }

  const attempts: { provider: AiProviderId; message: string }[] = [];

  for (const provider of chain) {
    const started = Date.now();
    try {
      const result = await withTimeout(
        provider.embed!(texts, options.model),
        60_000,
        `${provider.id} embed`
      );

      record({
        tenantId: options.tenantId,
        userId: options.userId,
        operation: options.operation,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        ok: true,
      });

      return result;
    } catch (err: any) {
      const message = err?.message || String(err);
      record({
        tenantId: options.tenantId,
        userId: options.userId,
        operation: options.operation,
        provider: provider.id,
        model: options.model || provider.defaultEmbeddingModel || "unknown",
        latencyMs: Date.now() - started,
        ok: false,
        error: message,
      });
      attempts.push({ provider: provider.id, message });
    }
  }

  throw new AiUnavailableError("Every embedding provider failed.", attempts);
}
