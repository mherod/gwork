/**
 * Retry utility with exponential backoff for transient failures.
 * Retries operations that have retryable: true on ServiceError.
 */

import { ServiceError } from "./errors.ts";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Executes an async operation with exponential backoff retry logic.
 *
 * @param operation - Async function to execute
 * @param options - Retry configuration
 * @returns Result of successful operation
 * @throws Original error if not retryable or all retries exhausted
 *
 * @example
 * ```typescript
 * const messages = await withRetry(() => mail.listMessages());
 * const messages = await withRetry(() => mail.listMessages(), {
 *   maxRetries: 5,
 *   initialDelayMs: 500,
 *   backoffMultiplier: 1.5
 * });
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if not retryable
      if (error instanceof ServiceError && !error.retryable) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, attempt),
        maxDelayMs
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
