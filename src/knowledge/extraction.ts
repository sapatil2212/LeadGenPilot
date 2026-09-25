/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Text extraction from uploaded documents.
 *
 * Parsers are imported lazily and individually so a missing optional dependency
 * degrades one file type rather than breaking uploads entirely — and so the
 * server does not pay their startup cost when nobody uploads anything.
 */

import { logger } from "../logger";

export type SupportedFileType = "pdf" | "docx" | "pptx" | "txt" | "md";

/** Accepted types, with the limits enforced before a byte is parsed. */
export const UPLOAD_RULES = {
  /** 20 MB. Large enough for a product catalogue, small enough to parse inline. */
  maxBytes: 20 * 1024 * 1024,
  allowed: {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.ms-powerpoint": "pptx",
    "text/plain": "txt",
    "text/markdown": "md",
  } as Record<string, SupportedFileType>,
  extensions: {
    pdf: "pdf",
    docx: "docx",
    doc: "docx",
    pptx: "pptx",
    ppt: "pptx",
    txt: "txt",
    md: "md",
    markdown: "md",
  } as Record<string, SupportedFileType>,
} as const;

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

/**
 * Resolves the file type from the declared MIME type, falling back to the
 * extension.
 *
 * The extension fallback is necessary rather than sloppy: browsers report
 * inconsistent MIME types for Office formats, and some send
 * application/octet-stream for everything. The type is only used to pick a
 * parser, and a wrong guess fails at parse time, so this is not a trust
 * boundary.
 */
export function resolveFileType(mimeType: string, fileName: string): SupportedFileType {
  const byMime = UPLOAD_RULES.allowed[(mimeType || "").toLowerCase().split(";")[0].trim()];
  if (byMime) return byMime;

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const byExt = UPLOAD_RULES.extensions[ext];
  if (byExt) return byExt;

  throw new UnsupportedFileError(
    `Unsupported file type "${mimeType || ext || "unknown"}". Upload a PDF, DOCX, PPTX, TXT or MD file.`
  );
}

export interface ExtractionOutcome {
  text: string;
  charCount: number;
  /** Set when the file parsed but yielded nothing usable. */
  warning?: string;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // pdf-parse's index re-exports a debug harness that reads a test fixture off
  // disk at import time; the lib entry point avoids it.
  const mod: any = await import("pdf-parse/lib/pdf-parse.js");
  const parse = mod.default || mod;
  const result = await parse(buffer);
  return String(result?.text || "");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mod: any = await import("mammoth");
  const mammoth = mod.default || mod;
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value || "");
}

/**
 * PPTX text extraction.
 *
 * A .pptx is a ZIP of per-slide XML. Rather than adding a PowerPoint library for
 * one format, the slide XML is unzipped with the dependency already present for
 * backups and the text runs are pulled out. Slides are emitted in numeric order
 * so the extracted text follows the deck.
 */
async function extractPptx(buffer: Buffer): Promise<string> {
  const unzipper: any = await import("unzipper");
  const directory = await unzipper.Open.buffer(buffer);

  const slides = directory.files
    .filter((f: any) => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
    .sort((a: any, b: any) => {
      const num = (p: string) => parseInt(p.replace(/\D+/g, ""), 10) || 0;
      return num(a.path) - num(b.path);
    });

  const parts: string[] = [];
  for (const slide of slides) {
    const xml = (await slide.buffer()).toString("utf8");
    // <a:t> holds the visible text of each run.
    const runs = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
      String(m[1])
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );
    const slideText = runs.join(" ").replace(/\s{2,}/g, " ").trim();
    if (slideText) parts.push(slideText);
  }

  return parts.join("\n\n");
}

/** Extracts plain text from a document buffer. */
export async function extractText(
  buffer: Buffer,
  fileType: SupportedFileType
): Promise<ExtractionOutcome> {
  let text = "";

  try {
    switch (fileType) {
      case "pdf":
        text = await extractPdf(buffer);
        break;
      case "docx":
        text = await extractDocx(buffer);
        break;
      case "pptx":
        text = await extractPptx(buffer);
        break;
      case "txt":
      case "md":
        text = buffer.toString("utf8");
        break;
      default:
        throw new UnsupportedFileError(`No extractor for file type "${fileType}".`);
    }
  } catch (err: any) {
    if (err instanceof UnsupportedFileError) throw err;
    logger.warn(`Text extraction failed for a ${fileType} upload: ${err?.message || err}`);
    throw new Error(
      `Could not read this ${fileType.toUpperCase()} file. It may be corrupt, encrypted or password protected.`
    );
  }

  const cleaned = text.replace(/\u0000/g, "").trim();

  if (cleaned.length === 0) {
    // A scanned PDF is images with no text layer. Saying so is far more useful
    // than reporting a generic failure, because the fix is different: OCR, or
    // uploading a text-based version.
    return {
      text: "",
      charCount: 0,
      warning:
        fileType === "pdf"
          ? "No text found. This PDF is probably a scan, so it has no text layer to read."
          : "No text content found in this file.",
    };
  }

  return { text: cleaned, charCount: cleaned.length };
}
