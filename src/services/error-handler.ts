/**
 * Centralized error handler for Google API errors.
 * Converts HTTP status codes to structured ServiceError subclasses.
 */

import {
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
  ServiceError,
} from "./errors.ts";

/**
 * Handles Google API errors and throws appropriate ServiceError subclass.
 *
 * @param error - The error from Google API
 * @param context - Human-readable context (e.g., "list contacts", "get event")
 * @throws {NotFoundError} On HTTP 404
 * @throws {PermissionDeniedError} On HTTP 403
 * @throws {RateLimitError} On HTTP 429
 * @throws {ServiceUnavailableError} On HTTP 500, 502, 503
 * @throws {ServiceError} For other errors
 */
export function handleGoogleApiError(error: unknown, context: string): never {
  // Type-safe error handling for Google API errors
  if (error && typeof error === "object" && "code" in error) {
    const httpCode = (error as any).code;

    switch (httpCode) {
      case 401:
        // 401 Unauthorized / Login Required
        // This usually means the token is invalid or expired
        // Suggest re-authentication
        throw new ServiceError(
          `Authentication required: ${error instanceof Error ? error.message : "Login Required"}. Please re-authenticate.`,
          "AUTHENTICATION_REQUIRED",
          401,
          true // Retryable - user can re-authenticate
        );
      case 404:
        throw new NotFoundError(context, "resource");
      case 403:
        throw new PermissionDeniedError(context, "resource");
      case 429:
        throw new RateLimitError();
      case 500:
      case 502:
      case 503:
        throw new ServiceUnavailableError(
          `Google ${context} service temporarily unavailable (HTTP ${httpCode})`
        );
      default:
        if (error instanceof Error) {
          throw new ServiceError(
            `Failed to ${context}: ${error.message}`,
            "API_ERROR",
            httpCode
          );
        }
    }
  }

  if (error instanceof Error) {
    throw new ServiceError(`Failed to ${context}: ${error.message}`, "UNKNOWN_ERROR");
  }

  throw error;
}
