/**
 * Content-shuffle safety tests.
 *
 * The shuffle must never corrupt or block a send. These lock the behaviour that
 * matters when the AI is unavailable or misbehaves: it returns the ORIGINAL
 * text unchanged, and it rejects any reword that drops a variable or URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI service. The mocked export IS a vi.fn so the test controls it
// directly; the real ../src/ai/types (AiUnavailableError) is left intact so the
// instanceof check inside contentShuffle resolves to the same class.
vi.mock("../src/ai/aiService", () => ({ generateText: vi.fn() }));

import { shuffleMessageContent } from "../src/campaign/contentShuffle";
import { generateText as mockedGenerateText } from "../src/ai/aiService";

const generateText = mockedGenerateText as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL = "Hi {{first_name}} 👋\n\nWe help {{company_name}} grow. Book a call: https://example.com/book";

describe("shuffleMessageContent", () => {
  beforeEach(() => generateText.mockReset());

  it("accepts a safe reword that preserves variables and URLs", async () => {
    const reworded = "Hey {{first_name}} 👋\n\nWe help {{company_name}} thrive. Grab a slot: https://example.com/book";
    generateText.mockResolvedValue({ text: reworded, provider: "gemini", model: "x", latencyMs: 1 });
    const out = await shuffleMessageContent(ORIGINAL);
    expect(out).toBe(reworded);
  });

  it("rejects a reword that drops a variable", async () => {
    const bad = "Hey there 👋\n\nWe help {{company_name}} thrive. Grab a slot: https://example.com/book";
    generateText.mockResolvedValue({ text: bad, provider: "gemini", model: "x", latencyMs: 1 });
    const out = await shuffleMessageContent(ORIGINAL);
    expect(out).toBe(ORIGINAL);
  });

  it("rejects a reword that drops or changes the URL", async () => {
    const bad = "Hey {{first_name}} 👋\n\nWe help {{company_name}} thrive. Grab a slot: https://evil.example.com/x";
    generateText.mockResolvedValue({ text: bad, provider: "gemini", model: "x", latencyMs: 1 });
    const out = await shuffleMessageContent(ORIGINAL);
    expect(out).toBe(ORIGINAL);
  });

  it("rejects a reword that diverges wildly in length (a rewrite, not a reword)", async () => {
    const tooLong = "Hey {{first_name}} 👋 " + "we really truly deeply ".repeat(20) + "help {{company_name}} at https://example.com/book";
    generateText.mockResolvedValue({ text: tooLong, provider: "gemini", model: "x", latencyMs: 1 });
    const out = await shuffleMessageContent(ORIGINAL);
    expect(out).toBe(ORIGINAL);
  });

  it("does not call AI for very short text", async () => {
    const out = await shuffleMessageContent("Hi");
    expect(out).toBe("Hi");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects an invented extra variable", async () => {
    const bad = "Hey {{first_name}} 👋\n\nWe help {{company_name}} grow, {{extra}}. Book a call: https://example.com/book";
    generateText.mockResolvedValue({ text: bad, provider: "gemini", model: "x", latencyMs: 1 });
    const out = await shuffleMessageContent(ORIGINAL);
    expect(out).toBe(ORIGINAL);
  });
});
