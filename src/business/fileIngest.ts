/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turning an uploaded file of almost any kind into text the extraction prompt
 * can read.
 *
 * The Business panel lets a user drop in whatever they already have — a company
 * brochure (PDF), a price list (Excel/CSV), an about-us document (Word), a
 * scribbled note (TXT), or a photo of a flyer or business card (image). Rather
 * than asking them to copy-paste, we pull the words out here and hand them to
 * the same review-then-apply extraction the free-text path uses.
 *
 * Two extraction strategies:
 *   - Local parsers for anything with a text layer (PDF, DOCX, PPTX, TXT, MD,
 *     CSV, XLSX). Fast, free, and offline.
 *   - Gemini vision for images and for PDFs that turn out to be scans (no text
 *     layer). This is the only path that needs the AI key, and it degrades to a
 *     clear message when the key is absent rather than failing opaquely.
 *
 * Parsers are imported lazily so a deployment missing an optional dependency
 * degrades one file type instead of refusing to boot, and so the server pays no
 * startup cost when nobody uploads anything.
 */

import { logger } from "../logger";
import { extractText, resolveFileType, UnsupportedFileError } from "../knowledge/extraction";

/** Re-exported so callers get the full ingest surface from one module. */
export { UnsupportedFileError };

/** 20 MB — matches the knowledge base cap and stays inside Gemini's inline limit. */
export const BUSINESS_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** How the file was read, purely so the UI can explain what happened. */
export type IngestKind = "document" | "spreadsheet" | "image";

export interface FileInput {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}

export interface FileTextResult {
  text: string;
  kind: IngestKind;
  charCount: number;
  /** Set when the file was read but yielded nothing useful. */
  warning?: string;
}

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "csv", "tsv"]);
const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "text/tab-separated-values",
]);

function extensionOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

function isImage(file: FileInput): boolean {
  if ((file.mimeType || "").toLowerCase().startsWith("image/")) return true;
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"].includes(
    extensionOf(file.originalName)
  );
}

function isSpreadsheet(file: FileInput): boolean {
  const mime = (file.mimeType || "").toLowerCase().split(";")[0].trim();
  return SPREADSHEET_MIMES.has(mime) || SPREADSHEET_EXTENSIONS.has(extensionOf(file.originalName));
}

function readGeminiKey(): string {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key || key === "MY_GEMINI_API_KEY") return "";
  // Google AI Studio keys always start with "AIza". Anything else (e.g.
  // Firebase ephemeral tokens starting with "AQ.") will be rejected by the
  // API with ACCESS_TOKEN_TYPE_UNSUPPORTED. Treat as unconfigured.
  if (!key.startsWith("AIza")) return "";
  return key;
}

/**
 * Reads a spreadsheet into a compact text rendering.
 *
 * Each sheet becomes a titled block of CSV, so a price list or product matrix
 * keeps its row/column structure — which is exactly the structure the model
 * needs to tell a product name from its price. Blank sheets are skipped so an
 * empty tab does not pad the prompt.
 */
async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const mod: any = await import("xlsx");
  const XLSX = mod.default || mod;
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const parts: string[] = [];
  for (const name of workbook.SheetNames as string[]) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = String(XLSX.utils.sheet_to_csv(sheet) || "").trim();
    if (csv) parts.push(`# Sheet: ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

/**
 * Uses Gemini's multimodal model to read an image (or a scanned PDF) as text.
 *
 * The model is asked to transcribe everything and note anything business-
 * relevant, so a photographed brochure or business card comes back as prose the
 * extraction prompt can mine for a name, products, contacts and so on. Called
 * directly rather than through aiService because the shared layer only carries
 * text messages; adding an image part to every provider is a larger change than
 * this one feature warrants, and the brief is explicit about using Gemini.
 */
async function extractWithVision(file: FileInput, mimeType: string): Promise<string> {
  const apiKey = readGeminiKey();
  if (!apiKey) {
    throw new Error(
      "Reading images needs the Gemini API key. Set GEMINI_API_KEY, or upload a text-based file (PDF, Word, Excel, TXT)."
    );
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const instruction =
    "You are reading a file a business owner uploaded to describe their company. " +
    "Transcribe ALL visible text exactly, then, on separate lines, note anything useful " +
    "about the business: its name, what it sells, products or services with any prices, " +
    "locations served, customer types, certifications and contact details. " +
    "Do not invent anything that is not present. Reply with plain text only.";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: instruction },
          { inlineData: { mimeType, data: file.buffer.toString("base64") } },
        ],
      },
    ] as any,
    config: { maxOutputTokens: 4096, temperature: 0 },
  });

  return String((response as any).text || "").trim();
}

/**
 * Extracts text from an uploaded file, choosing the strategy by type.
 *
 * Never throws for an empty-but-valid file: it returns a `warning` instead, so
 * the caller can tell the user why there was nothing to read (a blank scan, an
 * empty sheet) rather than reporting a generic failure. It throws only when the
 * file genuinely cannot be handled or a parser errored.
 */
export async function extractTextFromFile(file: FileInput): Promise<FileTextResult> {
  // ── Images: vision only. ──────────────────────────────────────────────────
  if (isImage(file)) {
    const mimeType = (file.mimeType || "").toLowerCase().startsWith("image/")
      ? file.mimeType
      : `image/${extensionOf(file.originalName) || "png"}`;
    let text = "";
    try {
      text = await extractWithVision(file, mimeType);
    } catch (err: any) {
      logger.warn(`Vision extraction failed for an image upload: ${err?.message || err}`);
      throw err instanceof Error ? err : new Error(String(err));
    }
    const cleaned = text.replace(/\u0000/g, "").trim();
    return cleaned
      ? { text: cleaned, kind: "image", charCount: cleaned.length }
      : {
          text: "",
          kind: "image",
          charCount: 0,
          warning: "Could not read any text from this image. Try a sharper or higher-resolution photo.",
        };
  }

  // ── Spreadsheets: local parse, structure preserved. ────────────────────────
  if (isSpreadsheet(file)) {
    let text = "";
    try {
      text = await extractSpreadsheet(file.buffer);
    } catch (err: any) {
      logger.warn(`Spreadsheet extraction failed: ${err?.message || err}`);
      throw new Error("Could not read this spreadsheet. It may be corrupt or password protected.");
    }
    const cleaned = text.replace(/\u0000/g, "").trim();
    return cleaned
      ? { text: cleaned, kind: "spreadsheet", charCount: cleaned.length }
      : {
          text: "",
          kind: "spreadsheet",
          charCount: 0,
          warning: "This spreadsheet appears to be empty.",
        };
  }

  // ── Documents with a text layer: PDF, DOCX, PPTX, TXT, MD. ──────────────────
  let fileType;
  try {
    fileType = resolveFileType(file.mimeType, file.originalName);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      // Last resort for unknown/octet-stream types: try to read it as UTF-8 text.
      // A note exported oddly or a .text file lands here; a real binary produces
      // mostly replacement characters and is rejected below.
      const asText = file.buffer.toString("utf8").replace(/\u0000/g, "");
      const printable = asText.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
      const looksTextual = asText.length > 0 && printable.length / asText.length > 0.85;
      if (looksTextual && asText.trim().length > 0) {
        const cleaned = asText.trim();
        return { text: cleaned, kind: "document", charCount: cleaned.length };
      }
      throw new UnsupportedFileError(
        `Can't read "${file.originalName}". Upload a PDF, Word, PowerPoint, Excel, CSV, text or image file.`
      );
    }
    throw err;
  }

  const outcome = await extractText(file.buffer, fileType);

  // A PDF with no text layer is a scan. Fall back to Gemini vision on the PDF
  // itself — Gemini reads PDF bytes directly — when the key is available.
  if (outcome.charCount === 0 && fileType === "pdf" && readGeminiKey()) {
    try {
      const visionText = await extractWithVision(file, "application/pdf");
      const cleaned = visionText.replace(/\u0000/g, "").trim();
      if (cleaned) return { text: cleaned, kind: "image", charCount: cleaned.length };
    } catch (err: any) {
      logger.warn(`Vision fallback for a scanned PDF failed: ${err?.message || err}`);
    }
  }

  return {
    text: outcome.text,
    kind: "document",
    charCount: outcome.charCount,
    warning: outcome.warning,
  };
}
