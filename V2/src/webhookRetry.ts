/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lead } from "./types";
import { logger } from "./logger";
import axios from "axios";

interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

/**
 * Exponential backoff retry wrapper for webhook delivery.
 * Handles transient network failures and rate limiting with automatic retry.
 */
export async function sendWithRetry(
  url: string,
  payload: any,
  config: Partial<RetryConfig> = {}
): Promise<boolean> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: any;

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
        validateStatus: (status) => status < 500, // Only retry on 5xx
      });

      // Success
      if (response.status >= 200 && response.status < 300) {
        if (attempt > 0) {
          logger.success(`Webhook delivery succeeded after ${attempt + 1} attempts.`);
        }
        return true;
      }

      // Rate limited - respect Retry-After header if present
      if (response.status === 429) {
        const retryAfter = response.headers["retry-after"];
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : calculateDelay(attempt, cfg);
        logger.warn(`Rate limited (429). Retrying after ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // 4xx errors (except 429) are not retryable
      if (response.status >= 400 && response.status < 500) {
        logger.error(`Webhook delivery failed with ${response.status}. Not retrying client error.`);
        return false;
      }
    } catch (error: any) {
      lastError = error;
      
      // Network errors are retryable
      if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
        const delay = calculateDelay(attempt, cfg);
        logger.warn(`Network error (${error.code}). Retry ${attempt + 1}/${cfg.maxRetries} in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // Unknown errors - log and retry
      logger.error(`Webhook delivery error: ${error.message}`);
      const delay = calculateDelay(attempt, cfg);
      await sleep(delay);
    }
  }

  logger.error(`Webhook delivery failed after ${cfg.maxRetries} attempts: ${lastError?.message || "Unknown error"}`);
  return false;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff with jitter
  const exponential = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
  const jitter = Math.random() * 0.3 * exponential; // ±30% jitter
  return Math.floor(exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Circuit breaker pattern for webhook endpoints.
 * Temporarily stops sending requests if too many failures occur.
 */
export class WebhookCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

  constructor(
    private failureThreshold = 10,
    private resetTimeout = 60000 // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = "HALF_OPEN";
        logger.info("Circuit breaker moving to HALF_OPEN state.");
      } else {
        throw new Error("Circuit breaker is OPEN. Too many recent failures.");
      }
    }

    try {
      const result = await fn();
      if (this.state === "HALF_OPEN") {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "OPEN";
      logger.error(`Circuit breaker opened after ${this.failures} failures.`);
    }
  }

  private reset() {
    this.failures = 0;
    this.state = "CLOSED";
    logger.success("Circuit breaker reset to CLOSED state.");
  }

  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
