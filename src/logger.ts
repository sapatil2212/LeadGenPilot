/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Ensure environment variables are available before reading log configuration.
// dotenv.config() is idempotent, so calling it here (the earliest-loaded util)
// is safe even though other modules also load it.
dotenv.config();

const logFilePath = path.join(process.cwd(), "scraper-log.txt");

// Log level thresholds. Messages below the configured level are dropped
// from console output (they are still written to file for audit purposes).
const LEVELS: Record<string, number> = { debug: 10, info: 20, success: 20, warn: 30, error: 40 };
const configuredLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? 20;
const maxBytes = parseInt(process.env.LOG_MAX_BYTES || "", 10) || 5 * 1024 * 1024; // 5MB

// Redact common secret patterns before anything is written or printed.
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/(api[_-]?key["'\s:=]+)([A-Za-z0-9\-_.]{6,})/gi, "$1***REDACTED***"],
  [/(bearer\s+)([A-Za-z0-9\-_.]{6,})/gi, "$1***REDACTED***"],
  [/(password["'\s:=]+)(\S+)/gi, "$1***REDACTED***"],
  [/(smtp_pass["'\s:=]+)(\S+)/gi, "$1***REDACTED***"],
];

function redact(message: string): string {
  let out = message;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Rotate the log file when it exceeds the size cap. Keeps a single ".1" backup.
function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const { size } = fs.statSync(logFilePath);
    if (size < maxBytes) return;
    const backup = `${logFilePath}.1`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
    fs.renameSync(logFilePath, backup);
  } catch {
    // rotation is best-effort
  }
}

// Initialize the log file on startup (append a boot marker rather than wiping
// history, so restarts do not destroy prior diagnostics).
try {
  fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] Logger initialized\n`);
} catch {
  // safe fallback if fs is unavailable
}

function write(level: string, formatted: string): void {
  const line = redact(formatted);
  const threshold = LEVELS[level] ?? 20;

  if (threshold >= configuredLevel) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  try {
    rotateIfNeeded();
    fs.appendFileSync(logFilePath, line + "\n");
  } catch {
    // safe fallback
  }
}

export const logger = {
  log: (message: string) => {
    write("info", `[${new Date().toLocaleTimeString()}] ${message}`);
  },

  debug: (message: string) => {
    write("debug", `[${new Date().toLocaleTimeString()}] DEBUG: ${message}`);
  },

  info: (message: string) => {
    write("info", `[${new Date().toLocaleTimeString()}] INFO: ${message}`);
  },

  success: (message: string) => {
    write("success", `[${new Date().toLocaleTimeString()}] SUCCESS: ${message}`);
  },

  warn: (message: string) => {
    write("warn", `[${new Date().toLocaleTimeString()}] WARN: ${message}`);
  },

  error: (message: string, error?: any) => {
    const errMessage = error ? ` - ${error.message || String(error)}` : "";
    write("error", `[${new Date().toLocaleTimeString()}] ERROR: ${message}${errMessage}`);
  },

  clear: () => {
    try {
      fs.writeFileSync(logFilePath, "");
    } catch {
      /* noop */
    }
  },

  getLogFilePath: () => logFilePath,

  readLogs: (): string => {
    try {
      if (fs.existsSync(logFilePath)) {
        return fs.readFileSync(logFilePath, "utf8");
      }
    } catch {
      /* noop */
    }
    return "No logs generated yet.";
  },
};
