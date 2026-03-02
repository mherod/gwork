import { RateLimitError, ServiceUnavailableError, ServiceError } from "../services/errors.ts";
import { logger } from "./logger.ts";

/**
 * Determines if an error should trigger a retry with backoff.
 * Includes rate limit errors, service unavailable errors, and other transient failures.
 */
export function isRetryableError(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof ServiceUnavailableError ||
    (error instanceof ServiceError && error.retryable && error.code === "AUTHENTICATION_REQUIRED")
  );
}

/**
 * Implements exponential backoff retry logic for Google API calls.
 * Attempts up to maxRetries, doubling the delay each time.
 *
 * @param operation - Async function to retry on transient errors
 * @param operationName - Human description for logging (e.g., "list files")
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry on non-retryable errors
      if (!isRetryableError(error)) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        logger.error(`Failed ${operationName} after ${maxRetries} retries`);
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError;
}