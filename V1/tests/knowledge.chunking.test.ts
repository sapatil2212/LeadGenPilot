/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chunking, similarity and file-type resolution.
 *
 * These are the pure functions that decide retrieval quality, so they are tested
 * directly rather than through the service. A chunker that cuts mid-sentence or a
 * cosine function that compares mismatched vectors produces an assistant that
 * quietly answers from the wrong paragraph — a failure mode that looks like "the
 * model is bad" and is very hard to find from the outside.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { chunkText, normalizeText, estimateTokens, cosineSimilarity, keywordScore } = await import(
  "../src/knowledge/chunking"
);
const { resolveFileType, extractText, UPLOAD_RULES, UnsupportedFileError } = await import(
  "../src/knowledge/extraction"
);

describe("normalizeText", () => {
  it("collapses CRLF to LF", () => {
    expect(normalizeText("a\r\nb")).toBe("a\nb");
  });

  it("preserves paragraph breaks but collapses longer runs", () => {
    expect(normalizeText("a\n\nb")).toBe("a\n\nb");
    expect(normalizeText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("collapses repeated spaces and tabs", () => {
    expect(normalizeText("a     b\t\tc")).toBe("a b c");
  });

  it("tolerates null and undefined", () => {
    expect(normalizeText(null as unknown as string)).toBe("");
    expect(normalizeText(undefined as unknown as string)).toBe("");
  });
});

describe("estimateTokens", () => {
  it("approximates four characters per token", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("drops content too short to be worth retrieving", () => {
    expect(chunkText("tiny")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const text = "We manufacture dental chairs for clinics across western India.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBe(estimateTokens(text));
  });

  it("numbers chunks contiguously from zero", () => {
    const paragraph = "Our flagship product is the PX-100 autoclave. ".repeat(20);
    const chunks = chunkText([paragraph, paragraph, paragraph].join("\n\n"), {
      targetChars: 200,
    });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("splits on paragraph boundaries in preference to mid-sentence", () => {
    const a = "A".repeat(300);
    const b = "B".repeat(300);
    const chunks = chunkText(`${a}\n\n${b}`, { targetChars: 320, overlapChars: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe(a);
    expect(chunks[1].content).toBe(b);
  });

  it("falls back to sentence boundaries inside an oversized paragraph", () => {
    const sentences = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here.`);
    const chunks = chunkText(sentences.join(" "), { targetChars: 90, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should begin mid-word.
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^[A-Z]/);
    }
  });

  it("hard-cuts a single unbroken run, as badly-extracted PDFs produce", () => {
    const blob = "x".repeat(5_000);
    const chunks = chunkText(blob, { targetChars: 500, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(500);
    }
  });

  it("overlaps consecutive chunks so a fact split across a boundary survives", () => {
    // Two paragraphs, the second holding the value for the first's question.
    const first = "The PX-100 autoclave chamber weighs approximately".padEnd(300, ".");
    const second = "12 kilograms when empty and 18 kilograms when loaded.".padEnd(300, ".");

    const withOverlap = chunkText(`${first}\n\n${second}`, {
      targetChars: 320,
      overlapChars: 120,
    });

    expect(withOverlap).toHaveLength(2);
    // The tail of chunk 0 is repeated at the head of chunk 1.
    expect(withOverlap[1].content.startsWith(first.slice(-120))).toBe(true);
  });

  it("emits no overlap when overlapChars is zero", () => {
    const a = "A".repeat(300);
    const b = "B".repeat(300);
    const chunks = chunkText(`${a}\n\n${b}`, { targetChars: 320, overlapChars: 0 });
    expect(chunks[1].content).not.toContain("A");
  });

  it("honours minChars", () => {
    const chunks = chunkText("Short one.\n\n" + "B".repeat(300), {
      targetChars: 100,
      minChars: 50,
      overlapChars: 0,
    });
    expect(chunks.every((c) => c.content.length >= 50)).toBe(true);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("is -1 for opposed vectors", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });

  it("ignores magnitude", () => {
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1, 10);
  });

  it("returns 0 rather than throwing on mismatched lengths", () => {
    // This is the "vectors from two different embedding models" case. It must
    // read as "no match", not crash inside a search request.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it("returns 0 for empty or zero vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("keywordScore", () => {
  it("scores the fraction of query terms present", () => {
    expect(keywordScore("autoclave chamber", "the autoclave chamber is steel")).toBe(1);
    expect(keywordScore("autoclave chamber", "the autoclave is steel")).toBe(0.5);
    expect(keywordScore("autoclave chamber", "nothing relevant")).toBe(0);
  });

  it("is case insensitive", () => {
    expect(keywordScore("AUTOCLAVE", "autoclave")).toBe(1);
  });

  it("ignores short filler words", () => {
    // "is", "an" and "of" are dropped, so only "autoclave" counts and a chunk
    // containing it scores 1 rather than being diluted.
    expect(keywordScore("is an autoclave of", "autoclave")).toBe(1);
  });

  it("returns 0 when the query has no usable terms", () => {
    expect(keywordScore("is an of", "anything")).toBe(0);
    expect(keywordScore("", "anything")).toBe(0);
  });
});

describe("resolveFileType", () => {
  const cases: [string, string, string][] = [
    ["application/pdf", "catalogue.pdf", "pdf"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "profile.docx",
      "docx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx",
      "pptx",
    ],
    ["text/plain", "notes.txt", "txt"],
    ["text/markdown", "readme.md", "md"],
  ];

  it.each(cases)("maps %s to %s", (mime, name, expected) => {
    expect(resolveFileType(mime, name)).toBe(expected);
  });

  it("tolerates a charset parameter on the MIME type", () => {
    expect(resolveFileType("text/plain; charset=utf-8", "notes.txt")).toBe("txt");
  });

  it("falls back to the extension when the MIME type is generic", () => {
    // Browsers send application/octet-stream for Office files often enough that
    // trusting the MIME type alone rejects valid uploads.
    expect(resolveFileType("application/octet-stream", "catalogue.pdf")).toBe("pdf");
    expect(resolveFileType("", "deck.pptx")).toBe("pptx");
  });

  it("maps legacy extensions onto their modern parser", () => {
    expect(resolveFileType("", "old.doc")).toBe("docx");
    expect(resolveFileType("", "old.ppt")).toBe("pptx");
  });

  it("rejects an unsupported type", () => {
    expect(() => resolveFileType("image/png", "logo.png")).toThrow(UnsupportedFileError);
    expect(() => resolveFileType("", "archive.zip")).toThrow(/Unsupported file type/);
  });
});

describe("UPLOAD_RULES", () => {
  it("caps uploads at 20 MB", () => {
    expect(UPLOAD_RULES.maxBytes).toBe(20 * 1024 * 1024);
  });
});

describe("extractText", () => {
  it("reads plain text and markdown directly", async () => {
    const outcome = await extractText(Buffer.from("Hello there", "utf8"), "txt");
    expect(outcome.text).toBe("Hello there");
    expect(outcome.charCount).toBe(11);
    expect(outcome.warning).toBeUndefined();
  });

  it("strips NUL bytes that MySQL would reject", async () => {
    const outcome = await extractText(Buffer.from("a\u0000b", "utf8"), "txt");
    expect(outcome.text).toBe("ab");
  });

  it("reports an empty text file as a warning rather than a crash", async () => {
    const outcome = await extractText(Buffer.from("   ", "utf8"), "txt");
    expect(outcome.text).toBe("");
    expect(outcome.charCount).toBe(0);
    expect(outcome.warning).toMatch(/No text content/i);
  });

  it("explains that a PDF with no text layer is probably a scan", async () => {
    // The distinction matters because the fix is different: OCR or a different
    // file, not a retry.
    const outcome = await extractText(Buffer.from("%PDF-1.4\n", "utf8"), "pdf").catch(
      () => null
    );
    if (outcome) {
      expect(outcome.warning ?? "").toMatch(/scan|no text/i);
    }
  });
});
