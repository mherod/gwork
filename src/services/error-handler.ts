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

type ErrorFactory = (context: string, code: number, originalError: unknown) => ServiceError;

const HTTP_ERROR_MAP: Record<number, ErrorFactory> = {
  401: (_ctx, _code, originalError) =>
    new ServiceError(
      `Authentication required: ${originalError instanceof Error ? originalError.message : "Login Required"}. Please re-authenticate.`,
      "AUTHENTICATION_REQUIRED",
      401,
      true
    ),
  403: (ctx) => new PermissionDeniedError(ctx, "resource"),
  404: (ctx) => new NotFoundError(ctx, "resource"),
  429: () => new RateLimitError(),
  500: (ctx, code) => new ServiceUnavailableError(`Google ${ctx} service temporarily unavailable (HTTP ${code})`),
  502: (ctx, code) => new ServiceUnavailableError(`Google ${ctx} service temporarily unavailable (HTTP ${code})`),
  503: (ctx, code) => new ServiceUnavailableError(`Google ${ctx} service temporarily unavailable (HTTP ${code})`),
};

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
    const httpCode = (error as any).code as number;
    const factory = HTTP_ERROR_MAP[httpCode];
    if (factory) {
      throw factory(context, httpCode, error);
    }

    // Unmapped HTTP code — generic fallback
    if (error instanceof Error) {
      throw new ServiceError(
        `Failed to ${context}: ${error.message}`,
        "API_ERROR",
        httpCode
      );
    }
    const rawMsg = (error as any).message;
    const msg = typeof rawMsg === "string" ? rawMsg : "unknown error";
    throw new ServiceError(
      `Failed to ${context}: ${msg}`,
      "API_ERROR",
      httpCode
    );
  }

  if (error instanceof Error) {
    throw new ServiceError(`Failed to ${context}: ${error.message}`, "UNKNOWN_ERROR");
  }

  throw error;
}
