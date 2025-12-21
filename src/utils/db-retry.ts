/**
 * Database retry utility for handling transient database errors.
 * Specifically handles "database is locked" errors with exponential backoff.
 */

import { Logger, defaultLogger } from "../services/logger.ts";

export interface DbRetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  logger?: Logger;
}

const DEFAULT_OPTIONS: Required<Omit<DbRetryOptions, "logger">> = {
  maxRetries: 5,
  initialDelay: 1000, // 1 second as suggested
  maxDelay: 10000, // 10 seconds max
  backoffMultiplier: 2,
};

/**
 * Checks if an error is a database lock error that should be retried.
 */
function isDatabaseLockError(error: unknown): boolean {
  if (!error) return false;
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "";
  
  // Check for SQLite lock errors
  return (
    errorName === "SQLiteError" ||
    errorMessage.toLowerCase().includes("database is locked") ||
    errorMessage.toLowerCase().includes("database or disk is full") ||
    errorMessage.toLowerCase().includes("busy") ||
    errorMessage.toLowerCase().includes("locked")
  );
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a database operation with retry logic for transient errors.
 * Specifically handles "database is locked" errors with exponential backoff.
 *
 * @param operation - The database operation to retry
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withDbRetry(() => {
 *   return db.prepare("SELECT * FROM tokens").all();
 * });
 * ```
 */
export async function withDbRetry<T>(
  operation: () => T | Promise<T>,
  options: DbRetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const logger = options.logger || defaultLogger;
  
  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (error: unknown) {
      lastError = error;

      // Only retry on database lock errors
      if (!isDatabaseLockError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === config.maxRetries) {
        logger.warn(
          `Database operation failed after ${config.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }

      // Log retry attempt
      logger.info(
        `Database locked, retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})...`
      );

      // Wait before retrying
      await sleep(delay);

      // Exponential backoff
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Synchronous version for database operations that don't return promises.
 * Uses Atomics.wait for efficient blocking (if available) or falls back to busy wait.
 *
 * @param operation - The synchronous database operation to retry
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = withDbRetrySync(() => {
 *   return db.prepare("SELECT * FROM tokens").all();
 * });
 * ```
 */
export function withDbRetrySync<T>(
  operation: () => T,
  options: DbRetryOptions = {}
): T {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const logger = options.logger || defaultLogger;
  
  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return operation();
    } catch (error: unknown) {
      lastError = error;

      // Only retry on database lock errors
      if (!isDatabaseLockError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === config.maxRetries) {
        logger.warn(
          `Database operation failed after ${config.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }

      // Log retry attempt (only log if logger is verbose or on first retry)
      if (attempt === 0 || logger.info) {
        logger.info(
          `Database locked, retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})...`
        );
      }

      // Block for the delay duration using Atomics.wait if available (more efficient)
      // Otherwise fall back to a simple busy wait
      const start = Date.now();
      const endTime = start + delay;
      
      // Try to use Atomics.wait for efficient blocking (Node.js 12+)
      if (typeof Atomics !== "undefined" && typeof SharedArrayBuffer !== "undefined") {
        try {
          const sab = new SharedArrayBuffer(4);
          const view = new Int32Array(sab);
          const remaining = Math.max(0, endTime - Date.now());
          if (remaining > 0) {
            Atomics.wait(view, 0, 0, remaining);
          }
        } catch {
          // Atomics.wait not available or failed, fall back to busy wait
          while (Date.now() < endTime) {
            // Minimal busy wait
          }
        }
      } else {
        // Fallback: simple busy wait with small chunks to avoid blocking too long
        while (Date.now() < endTime) {
          const now = Date.now();
          if (now < endTime) {
            const chunk = Math.min(endTime - now, 50); // 50ms chunks
            const chunkEnd = now + chunk;
            while (Date.now() < chunkEnd) {
              // Minimal busy wait
            }
          }
        }
      }

      // Exponential backoff
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
