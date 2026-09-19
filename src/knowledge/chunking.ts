/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Splits extracted document text into retrievable chunks.
 *
 * Pure functions, no I/O, so the behaviour that decides retrieval quality is
 * directly testable.
 */

/**
 * Rough token estimate.
 *
 * ~4 characters per token holds well enough for English prose to budget a
 * prompt. It is deliberately an estimate: calling a tokeniser per chunk would
 * add a dependency and real cost for a number only used to decide how many
 * chunks fit, where being 15% out changes nothing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ChunkOptions {
  /** Target characters per chunk. */
  targetChars?: number;
  /** Characters repeated from the previous chunk. */
  overlapChars?: number;
  /** Chunks shorter than this are dropped as noise. */
  minChars?: number;
}

export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
}

const DEFAULTS = {
  /** ~250 tokens: a paragraph or two, small enough that a hit is specific. */
  targetChars: 1000,
  /**
   * Overlap so a fact split across a boundary still appears whole in one chunk.
   * Without it, "the PX-100 weighs" and "12kg" can land in different chunks and
   * neither answers the question.
   */
  overlapChars: 150,
  minChars: 40,
} as const;

/** Normalises whitespace without destroying paragraph structure. */
export function normalizeText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    // Collapse runs of blank lines to exactly one, preserving paragraph breaks.
    .replace(/\n{3,}/g, "\n\n")
    // Tabs and repeated spaces add nothing and cost tokens.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Splits text on paragraph boundaries first, falling back to sentences and then
 * to a hard cut.
 *
 * Boundary choice matters more than chunk size: a chunk cut mid-sentence
 * retrieves poorly because neither half carries the whole statement. Paragraphs
 * are the best available proxy for a complete thought in extracted document
 * text.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const targetChars = options.targetChars ?? DEFAULTS.targetChars;
  const overlapChars = options.overlapChars ?? DEFAULTS.overlapChars;
  const minChars = options.minChars ?? DEFAULTS.minChars;

  const normalized = normalizeText(text);
  if (!normalized) return [];

  // Paragraphs, then oversized paragraphs broken into sentences.
  const units: string[] = [];
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length <= targetChars) {
      units.push(trimmed);
      continue;
    }

    let buffer = "";
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
      if (buffer && buffer.length + sentence.length + 1 > targetChars) {
        units.push(buffer.trim());
        buffer = sentence;
      } else {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
    }
    if (buffer.trim()) units.push(buffer.trim());
  }

  // A single unbroken run with no paragraph or sentence breaks (common in
  // badly-extracted PDFs) still has to be split somewhere.
  const bounded: string[] = [];
  for (const unit of units) {
    if (unit.length <= targetChars * 2) {
      bounded.push(unit);
      continue;
    }
    for (let i = 0; i < unit.length; i += targetChars) {
      bounded.push(unit.slice(i, i + targetChars));
    }
  }

  // Pack units up to the target, then apply overlap.
  const packed: string[] = [];
  let current = "";
  for (const unit of bounded) {
    if (current && current.length + unit.length + 2 > targetChars) {
      packed.push(current);
      current = overlapChars > 0 ? `${current.slice(-overlapChars)}\n\n${unit}` : unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current.trim()) packed.push(current);

  return packed
    .map((content) => content.trim())
    .filter((content) => content.length >= minChars)
    .map((content, index) => ({ index, content, tokenCount: estimateTokens(content) }));
}

/**
 * Cosine similarity between two vectors.
 *
 * Returns 0 for mismatched lengths rather than throwing: that means the two
 * embeddings came from different models, which is a data problem to surface as
 * "no match" rather than a crash inside a search request.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Keyword overlap score in 0..1, used when embeddings are unavailable.
 *
 * Not a replacement for semantic search, but it keeps the assistant useful when
 * no embedding provider is configured — far better than returning nothing.
 */
export function keywordScore(query: string, content: string): number {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2)
    )
  );
  if (terms.length === 0) return 0;

  const haystack = content.toLowerCase();
  const hits = terms.filter((t) => haystack.includes(t)).length;
  return hits / terms.length;
}
