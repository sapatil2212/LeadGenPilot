/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small resilience utilities shared by the growth-intelligence analyzers:
 * retries with backoff, throttling, timeouts, and safe step isolation.
 */

import { logger } from "../logger";

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  backoff?: number;
  label?: string;
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async operation with retries and exponential backoff.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 400;
  const backoff = opts.backoff ?? 2;
  const label = opts.label ?? "operation";

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const wait = delayMs * Math.pow(backoff, attempt);
        logger.warn(`${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${wait}ms...`);
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

/** Reject if a promise does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Run an analysis step in isolation: never throws. On failure it records the
 * step name in `failedSteps`, logs a warning, and returns `fallback`.
 * This is the core of the "never stop because one module fails" guarantee.
 */
export async function safeStep<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
  failedSteps: string[]
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    failedSteps.push(name);
    logger.warn(`Growth intelligence step "${name}" failed (non-fatal): ${err?.message || err}`);
    return fallback;
  }
}

/** Simple concurrency limiter to cap simultaneous browser tabs / requests. */
export class Throttle {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
