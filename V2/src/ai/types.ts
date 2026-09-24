/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contracts for the AI layer.
 *
 * Everything the application asks of a model goes through these types, so
 * swapping or adding a provider is a new adapter rather than a change at the
 * call sites. Before this, two files each talked to a vendor SDK directly with
 * their prompts inline, which meant the choice of model, the retry policy, the
 * timeout and the wording were all duplicated and none of them were consistent.
 */

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** Providers we ship adapters for. */
export type AiProviderId = "openrouter" | "gemini" | "openai" | "anthropic";

export interface GenerateRequest {
  messages: AiMessage[];
  /** Provider-specific model id. Falls back to the adapter's default. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-attempt timeout. The service applies a default. */
  timeoutMs?: number;
  /**
   * Ask the model to return JSON only. Adapters use native structured-output
   * support where the vendor has it, and fall back to a prompt instruction.
   */
  json?: boolean;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateResult {
  text: string;
  provider: AiProviderId;
  model: string;
  usage?: AiUsage;
  latencyMs: number;
}

export interface EmbedResult {
  vectors: number[][];
  provider: AiProviderId;
  model: string;
  dimensions: number;
  latencyMs: number;
}

/**
 * A provider adapter.
 *
 * Adapters are thin on purpose: normalise the request, call the vendor, return
 * text and usage, and classify errors. Retry, fallback, timeout defaults and
 * usage accounting are the service's job, so every provider gets identical
 * treatment.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  /** True when this provider has usable credentials. */
  isConfigured(): boolean;
  /** Default chat model when the caller does not name one. */
  readonly defaultModel: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /** Only some providers offer embeddings. */
  embed?(texts: string[], model?: string): Promise<EmbedResult>;
  readonly defaultEmbeddingModel?: string;
}

/**
 * Error carrying whether another attempt is worthwhile.
 *
 * The distinction matters: retrying a 429 or a socket timeout is useful, while
 * retrying a 401 or a malformed request just burns quota and delays the caller.
 */
export class AiProviderError extends Error {
  readonly provider: AiProviderId;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    provider: AiProviderId,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    if (options.cause) (this as any).cause = options.cause;
  }
}

/** Raised when no configured provider could satisfy a request. */
export class AiUnavailableError extends Error {
  readonly attempts: { provider: AiProviderId; message: string }[];

  constructor(message: string, attempts: { provider: AiProviderId; message: string }[]) {
    super(message);
    this.name = "AiUnavailableError";
    this.attempts = attempts;
  }
}

/**
 * Emitted for every attempt, successful or not.
 *
 * Phase 9 turns these into UsageEvent rows for metered billing; for now they are
 * logged. The shape is fixed here so the call sites do not change when the
 * persistence arrives.
 */
export interface AiUsageEvent {
  tenantId?: string;
  userId?: string;
  operation: string;
  promptName?: string;
  promptVersion?: number;
  provider: AiProviderId;
  model: string;
  usage?: AiUsage;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export type AiUsageSink = (event: AiUsageEvent) => void;
