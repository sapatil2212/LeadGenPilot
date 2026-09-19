/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TESTS — src/ai/aiService.ts
 *
 * The service owns the policy that used to be duplicated and inconsistent
 * across the two files that called vendor SDKs directly: which provider to try,
 * how long to wait, when a retry is worthwhile, and what happens when everything
 * fails. Those decisions are asserted here rather than left to integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AiProvider, GenerateResult } from "../src/ai/types";

// The logger writes to a file; keep tests off the filesystem.
vi.mock("../src/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    success: vi.fn(), log: vi.fn(), clear: vi.fn(),
    readLogs: vi.fn().mockReturnValue(""),
  },
}));

/** Controllable stand-ins for the four real adapters. */
const stubs = vi.hoisted(() => {
  const make = (id: string, defaultModel: string) => ({
    id,
    defaultModel,
    defaultEmbeddingModel: `${id}-embed`,
    isConfigured: () => true,
    generate: async () => ({
      text: `hello from ${id}`,
      provider: id,
      model: defaultModel,
      latencyMs: 1,
    }),
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => [0.1, 0.2, 0.3]),
      provider: id,
      model: `${id}-embed`,
      dimensions: 3,
      latencyMs: 1,
    }),
  });
  return {
    openrouter: make("openrouter", "or-model"),
    gemini: make("gemini", "gem-model"),
    openai: make("openai", "oai-model"),
    anthropic: make("anthropic", "ant-model"),
  };
});

vi.mock("../src/ai/providers/openrouter", () => ({ openRouterProvider: stubs.openrouter }));
vi.mock("../src/ai/providers/gemini", () => ({ geminiProvider: stubs.gemini }));
vi.mock("../src/ai/providers/openai", () => ({ openAiProvider: stubs.openai }));
vi.mock("../src/ai/providers/anthropic", () => ({ anthropicProvider: stubs.anthropic }));

const {
  generateText,
  generateStructuredOutput,
  embedTexts,
  resolveProviderChain,
  configuredProviderIds,
  isAnyProviderConfigured,
  extractJson,
  setUsageSink,
} = await import("../src/ai/aiService");
const { AiProviderError, AiUnavailableError } = await import("../src/ai/types");

type Stub = AiProvider & { isConfigured: () => boolean; generate: any; embed: any };
const all = stubs as unknown as Record<string, Stub>;

const originalOrder = process.env.AI_PROVIDER_ORDER;

beforeEach(() => {
  delete process.env.AI_PROVIDER_ORDER;
  for (const key of Object.keys(all)) {
    const id = all[key].id;
    all[key].isConfigured = () => true;
    all[key].generate = vi.fn(async () => ({
      text: `hello from ${id}`,
      provider: id,
      model: all[key].defaultModel,
      latencyMs: 1,
    })) as any;
  }
  setUsageSink(() => {});
});

afterEach(() => {
  if (originalOrder === undefined) delete process.env.AI_PROVIDER_ORDER;
  else process.env.AI_PROVIDER_ORDER = originalOrder;
  vi.useRealTimers();
});

const REQ = { messages: [{ role: "user" as const, content: "hi" }] };
const OPTS = { operation: "test.op" };

describe("provider chain", () => {
  it("uses the documented default order", () => {
    expect(configuredProviderIds()).toEqual(["openrouter", "gemini", "openai", "anthropic"]);
  });

  it("honours AI_PROVIDER_ORDER", () => {
    process.env.AI_PROVIDER_ORDER = "gemini,openai";
    // Providers not named are appended, never dropped, so a typo in this
    // variable cannot silently disable fallback altogether.
    expect(configuredProviderIds()).toEqual(["gemini", "openai", "openrouter", "anthropic"]);
  });

  it("ignores unknown names in AI_PROVIDER_ORDER", () => {
    process.env.AI_PROVIDER_ORDER = "nonsense,gemini";
    expect(configuredProviderIds()[0]).toBe("gemini");
  });

  it("excludes providers with no credentials", () => {
    all.openrouter.isConfigured = () => false;
    all.openai.isConfigured = () => false;
    expect(configuredProviderIds()).toEqual(["gemini", "anthropic"]);
  });

  it("moves a tenant's preferred provider to the front without dropping the rest", () => {
    const chain = resolveProviderChain("anthropic").map((p) => p.id);
    expect(chain[0]).toBe("anthropic");
    // Still a fallback list: a tenant preference must not leave them with no
    // working provider when their pick is down.
    expect(chain).toHaveLength(4);
  });

  it("reports when nothing is configured", () => {
    for (const key of Object.keys(all)) all[key].isConfigured = () => false;
    expect(isAnyProviderConfigured()).toBe(false);
  });
});

describe("generateText", () => {
  it("returns the first configured provider's answer", async () => {
    const result = await generateText(REQ, OPTS);
    expect(result.provider).toBe("openrouter");
    expect(result.text).toBe("hello from openrouter");
    expect(all.gemini.generate).not.toHaveBeenCalled();
  });

  it("falls back to the next provider on a non-retryable failure", async () => {
    all.openrouter.generate = vi.fn(async () => {
      throw new AiProviderError("openrouter", "bad api key", { status: 401, retryable: false });
    }) as any;

    const result = await generateText(REQ, OPTS);
    expect(result.provider).toBe("gemini");
    // Not worth a second attempt with the same bad credentials.
    expect(all.openrouter.generate).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure once before moving on", async () => {
    all.openrouter.generate = vi.fn(async () => {
      throw new AiProviderError("openrouter", "rate limited", { status: 429, retryable: true });
    }) as any;

    const result = await generateText(REQ, OPTS);
    expect(all.openrouter.generate).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("gemini");
  });

  it("recovers when the retry succeeds", async () => {
    let calls = 0;
    all.openrouter.generate = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new AiProviderError("openrouter", "blip", { retryable: true });
      return { text: "second time", provider: "openrouter", model: "or-model", latencyMs: 1 };
    }) as any;

    const result = await generateText(REQ, OPTS);
    expect(result.text).toBe("second time");
    expect(all.gemini.generate).not.toHaveBeenCalled();
  });

  it("throws AiUnavailableError listing every provider when all fail", async () => {
    for (const key of Object.keys(all)) {
      const id = all[key].id;
      all[key].generate = vi.fn(async () => {
        throw new AiProviderError(id as any, `${id} down`, { retryable: false });
      }) as any;
    }

    const error = await generateText(REQ, OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.attempts.map((a: any) => a.provider)).toEqual([
      "openrouter", "gemini", "openai", "anthropic",
    ]);
  });

  it("explains how to fix things when nothing is configured at all", async () => {
    for (const key of Object.keys(all)) all[key].isConfigured = () => false;

    const error = await generateText(REQ, OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.message).toMatch(/GEMINI_API_KEY/);
  });

  /**
   * The previous Gemini path had no timeout, so a hung request stalled the
   * caller indefinitely — once per lead, inside a sequential scrape.
   */
  it("abandons a provider that never responds", async () => {
    all.openrouter.generate = vi.fn(
      () => new Promise(() => { /* never settles */ })
    ) as any;

    const result = await generateText({ ...REQ, timeoutMs: 50 }, OPTS);
    expect(result.provider).toBe("gemini");
  }, 10_000);

  it("emits a usage event per attempt, successful or not", async () => {
    const events: any[] = [];
    setUsageSink((e) => events.push(e));

    all.openrouter.generate = vi.fn(async () => {
      throw new AiProviderError("openrouter", "nope", { retryable: false });
    }) as any;

    await generateText(REQ, { operation: "test.usage", tenantId: "ws_1" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ provider: "openrouter", ok: false, tenantId: "ws_1" });
    expect(events[1]).toMatchObject({ provider: "gemini", ok: true, operation: "test.usage" });
  });

  it("never lets a broken usage sink break the call", async () => {
    setUsageSink(() => {
      throw new Error("accounting exploded");
    });
    await expect(generateText(REQ, OPTS)).resolves.toMatchObject({ provider: "openrouter" });
  });
});

describe("extractJson", () => {
  it.each([
    ['{"a":1}', '{"a":1}'],
    ['```json\n{"a":1}\n```', '{"a":1}'],
    ['```\n{"a":1}\n```', '{"a":1}'],
    ['Here you go:\n{"a":1}', '{"a":1}'],
    ['[{"a":1}]', '[{"a":1}]'],
    ['Sure! [1,2,3] hope that helps', '[1,2,3]'],
  ])("recovers JSON from %j", (input, expected) => {
    expect(extractJson(input)).toBe(expected);
  });
});

describe("generateStructuredOutput", () => {
  const validate = (v: unknown) => {
    const o = v as any;
    return o && typeof o.name === "string" ? { name: o.name as string } : null;
  };

  it("parses and validates a good response", async () => {
    all.openrouter.generate = vi.fn(async () => ({
      text: '{"name":"Acme"}', provider: "openrouter", model: "or-model", latencyMs: 1,
    })) as any;

    const { value } = await generateStructuredOutput(REQ, { ...OPTS, validate });
    expect(value).toEqual({ name: "Acme" });
  });

  it("requests JSON mode from the provider", async () => {
    const spy = vi.fn(async (_req: unknown) => ({
      text: '{"name":"Acme"}', provider: "openrouter", model: "or-model", latencyMs: 1,
    }));
    all.openrouter.generate = spy as any;

    await generateStructuredOutput(REQ, { ...OPTS, validate });
    expect(spy.mock.calls[0][0]).toMatchObject({ json: true });
  });

  it("asks the model to correct unparseable output, then succeeds", async () => {
    let calls = 0;
    all.openrouter.generate = vi.fn(async () => {
      calls++;
      return {
        text: calls === 1 ? "I think the name is Acme." : '{"name":"Acme"}',
        provider: "openrouter", model: "or-model", latencyMs: 1,
      };
    }) as any;

    const { value } = await generateStructuredOutput(REQ, { ...OPTS, validate });
    expect(value).toEqual({ name: "Acme" });
    expect(calls).toBe(2);

    // The repair turn must describe the failure, or the model repeats it.
    const secondCall = (all.openrouter.generate as any).mock.calls[1][0];
    const lastMessage = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMessage.content).toMatch(/previous reply could not be used/i);
  });

  it("repairs a response that parses but fails the schema", async () => {
    let calls = 0;
    all.openrouter.generate = vi.fn(async () => {
      calls++;
      return {
        text: calls === 1 ? '{"wrongField":true}' : '{"name":"Acme"}',
        provider: "openrouter", model: "or-model", latencyMs: 1,
      };
    }) as any;

    const { value } = await generateStructuredOutput(REQ, { ...OPTS, validate });
    expect(value).toEqual({ name: "Acme" });
  });

  it("gives up after one repair attempt rather than looping", async () => {
    const spy = vi.fn(async () => ({
      text: "still not json", provider: "openrouter", model: "or-model", latencyMs: 1,
    }));
    for (const key of Object.keys(all)) all[key].generate = spy as any;

    await expect(generateStructuredOutput(REQ, { ...OPTS, validate })).rejects.toThrow();
    // Two rounds across four providers, no unbounded retry loop.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("does not attempt a repair when no provider is reachable", async () => {
    for (const key of Object.keys(all)) all[key].isConfigured = () => false;
    await expect(
      generateStructuredOutput(REQ, { ...OPTS, validate })
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("embedTexts", () => {
  it("uses the first provider that supports embeddings", async () => {
    // Anthropic has no embed in the real adapter either.
    delete (all.openrouter as any).embed;
    const result = await embedTexts(["a", "b"], { operation: "knowledge.embed" });
    expect(result.provider).toBe("gemini");
    expect(result.vectors).toHaveLength(2);
    // Restore for later tests in this file.
    (all.openrouter as any).embed = async (texts: string[]) => ({
      vectors: texts.map(() => [0.1, 0.2, 0.3]),
      provider: "openrouter", model: "openrouter-embed", dimensions: 3, latencyMs: 1,
    });
  });

  it("rejects an empty batch instead of calling a provider", async () => {
    await expect(embedTexts([], { operation: "knowledge.embed" })).rejects.toThrow();
  });

  it("explains what to configure when no provider embeds", async () => {
    const saved: Record<string, any> = {};
    for (const key of Object.keys(all)) {
      saved[key] = (all[key] as any).embed;
      delete (all[key] as any).embed;
    }

    const error = await embedTexts(["a"], { operation: "knowledge.embed" }).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.message).toMatch(/GEMINI_API_KEY|OPENAI_API_KEY/);

    for (const key of Object.keys(all)) (all[key] as any).embed = saved[key];
  });
});
