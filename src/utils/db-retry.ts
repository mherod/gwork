/**
 * Database retry utility for handling transient database errors.
 * 
 * **CRITICAL FOR FUTURE DEVELOPERS:**
 * 
 * This module provides automatic retry logic for database operations that encounter
 * "database is locked" errors. These errors are **transient** and typically occur when:
 * 
 * 1. Multiple processes access the same SQLite database simultaneously
 * 2. A long-running transaction holds a lock
 * 3. WAL checkpoint operations are in progress
 * 4. Database maintenance operations are running
 * 
 * **IMPORTANT: DO NOT BYPASS THIS RETRY LOGIC**
 * 
 * - All database operations in TokenStore MUST use these retry wrappers
 * - Never call Database methods directly without retry logic
 * - Adding new database operations? Wrap them with withDbRetrySync()
 * - Removing retry logic will cause production failures under concurrent load
 * 
 * **HOW IT WORKS:**
 * 
 * When a database lock error is detected:
 * 1. Operation is automatically retried with exponential backoff
 * 2. Initial delay: 1 second (configurable)
 * 3. Each retry doubles the delay: 1s → 2s → 4s → 8s → 10s (max)
 * 4. Up to 5 retries by default (configurable)
 * 5. Non-lock errors are thrown immediately (no retry)
 * 
 * **PERFORMANCE IMPLICATIONS:**
 * 
 * - Retries add latency: worst case ~25 seconds (1+2+4+8+10)
 * - This is acceptable for token operations (rare, infrequent)
 * - DO NOT use for high-frequency operations without careful consideration
 * - Consider async operations (withDbRetry) for better concurrency
 * 
 * **USE CASES:**
 * 
 * ✅ **DO use retry logic for:**
 * - Token storage/retrieval (TokenStore operations)
 * - Schema initialization
 * - Infrequent database writes
 * - Operations that can tolerate retry delays
 * 
 * ❌ **DO NOT use retry logic for:**
 * - High-frequency operations (consider connection pooling instead)
 * - Real-time operations requiring immediate response
 * - Operations where retry would cause data inconsistency
 * 
 * **CONFIGURATION:**
 * 
 * Default settings are tuned for token operations:
 * - maxRetries: 5 (sufficient for most transient locks)
 * - initialDelay: 1000ms (1 second - balances responsiveness vs. lock resolution)
 * - maxDelay: 10000ms (10 seconds - prevents excessive waits)
 * - backoffMultiplier: 2 (standard exponential backoff)
 * 
 * Adjust these only if you understand the implications:
 * - Lower retries = faster failure, more user-facing errors
 * - Higher retries = more resilient, but longer worst-case latency
 * - Lower delays = faster retries, but may retry before lock clears
 * 
 * **ERROR DETECTION:**
 * 
 * The retry logic detects these error patterns:
 * - Error name: "SQLiteError"
 * - Error message contains: "database is locked"
 * - Error message contains: "database or disk is full"
 * - Error message contains: "busy"
 * - Error message contains: "locked"
 * 
 * All other errors are thrown immediately without retry.
 * 
 * **SYNCHRONOUS VS ASYNCHRONOUS:**
 * 
 * - `withDbRetrySync()`: For synchronous operations (current TokenStore)
 *   - Uses blocking wait (Atomics.wait if available, otherwise busy wait)
 *   - Blocks the event loop during retry delays
 *   - Use only when operation must be synchronous
 * 
 * - `withDbRetry()`: For async/await operations (preferred)
 *   - Non-blocking, uses Promise-based delays
 *   - Better for concurrent operations
 *   - Consider migrating TokenStore to async in future
 * 
 * **FUTURE CONSIDERATIONS:**
 * 
 * If database lock errors become frequent:
 * 1. Review WAL mode settings (already enabled)
 * 2. Check busy_timeout pragma (currently 5 seconds)
 * 3. Consider connection pooling for high concurrency
 * 4. Evaluate migrating to async operations
 * 5. Monitor retry frequency in production logs
 * 
 * **TESTING:**
 * 
 * - Unit tests verify retry behavior (tests/unit/utils/db-retry.test.ts)
 * - Test both success and failure scenarios
 * - Test exponential backoff timing
 * - Test error detection logic
 * 
 * @module db-retry
 * @see {@link TokenStore} for usage examples
 */

import { logger as defaultLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

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
 * 
 * **IMPORTANT:** This function determines which errors trigger retry logic.
 * Only database lock-related errors are retried; all others fail immediately.
 * 
 * Detected patterns:
 * - Error name === "SQLiteError"
 * - Message contains: "database is locked", "database busy", "database or disk is full",
 *   "sqlite_busy", "sqlite_locked"
 * 
 * @param error - The error to check
 * @returns true if error indicates a database lock condition
 * @internal
 */
function isDatabaseLockError(error: unknown): boolean {
  if (!error) return false;
  const hasMessage =
    typeof error === "object" &&
    error !== null &&
    "message" in error;
  const hasName =
    typeof error === "object" &&
    error !== null &&
    "name" in error;
  const errorMessage = error instanceof Error
    ? error.message
    : String(hasMessage ? (error as { message: unknown }).message : error);
  const errorName = error instanceof Error
    ? error.name
    : String(hasName ? (error as { name: unknown }).name : "");
  
  // Check for SQLite lock errors — use specific phrases to avoid false positives
  // from unrelated errors containing bare "busy" or "locked"
  const msg = errorMessage.toLowerCase();
  return (
    errorName === "SQLiteError" ||
    msg.includes("database is locked") ||
    msg.includes("database busy") ||
    msg.includes("database or disk is full") ||
    msg.includes("sqlite_busy") ||
    msg.includes("sqlite_locked")
  );
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async database operation with retry logic for transient lock errors.
 * 
 * **USE THIS FOR:** Async database operations that may encounter lock errors.
 * 
 * **CRITICAL NOTES FOR DEVELOPERS:**
 * 
 * 1. **Always use this wrapper** for database operations in production code
 * 2. **Never bypass** retry logic - it prevents production failures
 * 3. **Understand the delays** - operations may take up to ~25 seconds in worst case
 * 4. **Monitor retry frequency** - frequent retries indicate a design issue
 * 
 * **RETRY BEHAVIOR:**
 * 
 * - Only retries on database lock errors (see isDatabaseLockError)
 * - Other errors are thrown immediately
 * - Exponential backoff: 1s → 2s → 4s → 8s → 10s (max)
 * - Default: 5 retries (6 total attempts)
 * 
 * **PRACTICAL EXAMPLES:**
 * 
 * ```typescript
 * // ✅ CORRECT: Wrapped database operation
 * const tokens = await withDbRetry(async () => {
 *   const stmt = db.prepare("SELECT * FROM tokens WHERE service = @service");
 *   return stmt.all({ service: "gmail" });
 * });
 * 
 * // ❌ WRONG: Direct database call (no retry protection)
 * const stmt = db.prepare("SELECT * FROM tokens");
 * const tokens = stmt.all(); // May fail on lock!
 * 
 * // ✅ CORRECT: With custom retry configuration
 * const result = await withDbRetry(
 *   async () => db.prepare("SELECT * FROM tokens").all(),
 *   { maxRetries: 3, initialDelay: 500 } // Faster, fewer retries
 * );
 * ```
 * 
 * **WHEN TO ADJUST CONFIGURATION:**
 * 
 * - **Lower maxRetries (2-3):** For operations that must fail fast
 * - **Higher maxRetries (7-10):** For critical operations that must succeed
 * - **Lower initialDelay (100-500ms):** For operations needing faster response
 * - **Higher maxDelay (20-30s):** For operations that can wait longer
 * 
 * **PERFORMANCE CONSIDERATIONS:**
 * 
 * - Each retry adds latency (exponential backoff)
 * - Worst case: ~25 seconds total delay (1+2+4+8+10)
 * - Average case: Usually succeeds on first or second retry
 * - Monitor logs for retry frequency to detect issues
 * 
 * **ERROR HANDLING:**
 * 
 * - Lock errors: Automatically retried
 * - Other errors: Thrown immediately (no retry)
 * - After max retries: Original error is thrown
 * - Logs retry attempts at INFO level
 * - Logs final failure at WARN level
 * 
 * @param operation - Async function that performs the database operation
 * @param options - Optional retry configuration
 * @param options.maxRetries - Maximum number of retry attempts (default: 5)
 * @param options.initialDelay - Initial delay in milliseconds (default: 1000)
 * @param options.maxDelay - Maximum delay between retries in milliseconds (default: 10000)
 * @param options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param options.logger - Logger instance for retry attempt logging (default: defaultLogger)
 * @returns Promise that resolves with the operation result
 * @throws The last error if all retries are exhausted
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const tokens = await withDbRetry(async () => {
 *   return db.prepare("SELECT * FROM tokens").all();
 * });
 * 
 * // With custom configuration
 * const result = await withDbRetry(
 *   async () => db.prepare("SELECT * FROM tokens WHERE service = @service").get({ service }),
 *   { maxRetries: 3, initialDelay: 500 }
 * );
 * ```
 * 
 * @see {@link withDbRetrySync} for synchronous operations
 * @see {@link TokenStore} for real-world usage examples
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
 * Wraps a synchronous database operation with retry logic for transient lock errors.
 * 
 * **USE THIS FOR:** Synchronous database operations (current TokenStore implementation).
 * 
 * **CRITICAL NOTES FOR DEVELOPERS:**
 * 
 * 1. **This blocks the event loop** during retry delays - use sparingly
 * 2. **Prefer withDbRetry()** (async) when possible for better concurrency
 * 3. **All TokenStore operations** currently use this (synchronous API)
 * 4. **Future migration:** Consider making TokenStore async to use withDbRetry()
 * 
 * **IMPORTANT LIMITATIONS:**
 * 
 * - **Blocks event loop:** During retry delays, no other code can execute
 * - **Not ideal for high concurrency:** Multiple sync retries can stack up
 * - **Use for infrequent operations:** Token operations are rare, so acceptable
 * - **Consider async migration:** For better scalability in future
 * 
 * **RETRY BEHAVIOR:**
 * 
 * - Only retries on database lock errors
 * - Uses blocking wait (Atomics.wait if available, otherwise busy wait)
 * - Exponential backoff: 1s → 2s → 4s → 8s → 10s (max)
 * - Default: 5 retries (6 total attempts)
 * 
 * **PRACTICAL EXAMPLES:**
 * 
 * ```typescript
 * // ✅ CORRECT: Wrapped synchronous operation (current TokenStore pattern)
 * const token = withDbRetrySync(() => {
 *   const stmt = db.prepare("SELECT * FROM tokens WHERE service = @service");
 *   return stmt.get({ service: "gmail" });
 * });
 * 
 * // ❌ WRONG: Direct database call (no retry protection)
 * const stmt = db.prepare("SELECT * FROM tokens");
 * const token = stmt.get(); // May fail on lock!
 * 
 * // ✅ CORRECT: With custom configuration
 * const result = withDbRetrySync(
 *   () => db.prepare("SELECT * FROM tokens").all(),
 *   { maxRetries: 3, initialDelay: 500 }
 * );
 * ```
 * 
 * **WHEN TO USE vs withDbRetry():**
 * 
 * - **Use withDbRetrySync():** When operation must be synchronous (legacy code)
 * - **Use withDbRetry():** When operation can be async (preferred, better performance)
 * - **Future:** Migrate TokenStore to async and use withDbRetry()
 * 
 * **PERFORMANCE IMPLICATIONS:**
 * 
 * - **Blocks event loop:** During delays, entire process is blocked
 * - **Worst case:** ~25 seconds of blocking (1+2+4+8+10)
 * - **Acceptable for:** Infrequent operations (token storage is rare)
 * - **Problematic for:** High-frequency operations (consider async instead)
 * 
 * **BLOCKING BEHAVIOR:**
 * 
 * The function uses different blocking strategies:
 * - **Atomics.wait()** (if available): Efficient, OS-level blocking
 * - **Busy wait** (fallback): CPU-intensive, but works everywhere
 * - **Chunked busy wait:** 50ms chunks to avoid excessive CPU usage
 * 
 * **ERROR HANDLING:**
 * 
 * - Lock errors: Automatically retried with blocking delays
 * - Other errors: Thrown immediately (no retry, no delay)
 * - After max retries: Original error is thrown
 * - Logs retry attempts at INFO level
 * - Logs final failure at WARN level
 * 
 * @param operation - Synchronous function that performs the database operation
 * @param options - Optional retry configuration
 * @param options.maxRetries - Maximum number of retry attempts (default: 5)
 * @param options.initialDelay - Initial delay in milliseconds (default: 1000)
 * @param options.maxDelay - Maximum delay between retries in milliseconds (default: 10000)
 * @param options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param options.logger - Logger instance for retry attempt logging (default: defaultLogger)
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 * 
 * @example
 * ```typescript
 * // Basic usage (current TokenStore pattern)
 * const tokens = withDbRetrySync(() => {
 *   return db.prepare("SELECT * FROM tokens").all();
 * });
 * 
 * // With custom configuration
 * const token = withDbRetrySync(
 *   () => db.prepare("SELECT * FROM tokens WHERE service = @service").get({ service }),
 *   { maxRetries: 3, initialDelay: 500 }
 * );
 * ```
 * 
 * @see {@link withDbRetry} for async operations (preferred)
 * @see {@link TokenStore} for real-world usage examples
 * 
 * @warning This function blocks the event loop during retry delays. Use withDbRetry() for async operations when possible.
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
