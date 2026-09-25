/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
import os from "os";

/**
 * Atomic JSON file utilities.
 *
 * Writes go to a temp file in the same directory and are then renamed over the
 * target. Rename is atomic on the same filesystem, so readers never observe a
 * partially-written (corrupt) JSON file even if the process crashes mid-write.
 */

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) return fallback;
      return JSON.parse(content) as T;
    }
  } catch {
    // corrupt or unreadable — return fallback and let caller recover
  }
  return fallback;
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // best-effort cleanup of the temp file
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch {
      /* noop */
    }
    throw err;
  }
}

/**
 * Serializes async operations against a given key so concurrent handlers
 * (e.g. two outreach status updates) do not interleave read-modify-write
 * cycles and clobber each other.
 */
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  // Keep the chain alive but swallow errors so one failure doesn't poison the lock.
  chains.set(
    key,
    next.catch(() => undefined)
  );
  return next as Promise<T>;
}

export function tmpDir(): string {
  return os.tmpdir();
}
