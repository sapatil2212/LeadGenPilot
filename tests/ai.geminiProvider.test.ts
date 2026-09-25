/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gemini failure classification.
 *
 * The bug these pin: the retryable test was a bare /rate/, which matches
 * "GenerateContent" — the method name carried in every Generative Language API
 * error. A hard 401 was therefore treated as transient, retried once, and only
 * then fell through to the next provider, so a wrong API key looked like a flaky
 * network and every call paid for an extra round trip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const embedContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, embedContent };
  },
}));

const { geminiProvider } = await import("../src/ai/providers/gemini");
const { AiProviderError } = await import("../src/ai/types");

const AUTH_ERROR =
  '{"error":{"code":401,"message":"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.","status":"UNAUTHENTICATED","details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED","metadata":{"method":"google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent"}}]}}';

const REQUEST = { messages: [{ role: "user" as const, content: "hi" }] };
const originalKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  generateContent.mockReset();
  embedContent.mockReset();
  process.env.GEMINI_API_KEY = "AIzaSyExampleLongLivedStudioKey0000000";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("auth failures", () => {
  it("does not retry an UNAUTHENTICATED response", async () => {
    generateContent.mockRejectedValue(new Error(AUTH_ERROR));

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error.retryable).toBe(false);
  });

  it("does not retry an embedding auth failure either", async () => {
    embedContent.mockRejectedValue(new Error(AUTH_ERROR));

    const error = await geminiProvider.embed(["text"]).catch((err) => err);

    expect(error.retryable).toBe(false);
  });

  it("names the wrong credential shape when the key is not an AI Studio key", async () => {
    // An "AQ."-prefixed ephemeral Live-API token is the value that produced this
    // in the field; Google reports it as a server-side auth fault.
    process.env.GEMINI_API_KEY = "AQ.Ab8RN6JexampleEphemeralTokenValue0000";
    generateContent.mockRejectedValue(new Error(AUTH_ERROR));

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('begin with "AIza"');
    expect(error.message).toContain("aistudio.google.com/apikey");
  });

  it("stays quiet about key shape when the key looks correct", async () => {
    generateContent.mockRejectedValue(new Error(AUTH_ERROR));

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error.message).not.toContain("aistudio.google.com/apikey");
  });
});

describe("transient failures stay retryable", () => {
  it.each([
    ["429 rate limited", '{"error":{"code":429,"message":"Resource exhausted"}}'],
    ["503 unavailable", '{"error":{"code":503,"message":"The service is currently unavailable."}}'],
    ["socket reset", "ECONNRESET: socket hang up"],
    ["quota", '{"error":{"message":"Quota exceeded for this project"}}'],
  ])("retries on %s", async (_label, message) => {
    generateContent.mockRejectedValue(new Error(message));

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error.retryable).toBe(true);
  });

  it("does not treat the GenerateContent method name as a rate-limit signal", async () => {
    generateContent.mockRejectedValue(
      new Error('{"error":{"code":400,"message":"Invalid argument for GenerateContent"}}')
    );

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error.retryable).toBe(false);
  });
});

describe("successful generation", () => {
  it("returns the completion text and usage", async () => {
    generateContent.mockResolvedValue({
      text: "  A grounded answer.  ",
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });

    const result = await geminiProvider.generate(REQUEST);

    expect(result.text).toBe("A grounded answer.");
    expect(result.usage).toMatchObject({ promptTokens: 10, totalTokens: 15 });
  });

  it("treats an empty completion as retryable", async () => {
    generateContent.mockResolvedValue({ text: "   " });

    const error = await geminiProvider.generate(REQUEST).catch((err) => err);

    expect(error.retryable).toBe(true);
  });
});
