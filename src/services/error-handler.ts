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
  ScopeInsufficientError,
  AuthenticationRequiredError,
} from "./errors.ts";

type ErrorFactory = (context: string, code: number, originalError: unknown) => ServiceError;

/** Extract the `reason` string from the first entry of a `errors` array field. */
function firstReason(errorsField: unknown): string | null {
  if (!Array.isArray(errorsField) || errorsField.length === 0) return null;
  const first = errorsField[0];
  if (!first || typeof first !== "object" || !("reason" in first)) return null;
  const r = (first as { reason: unknown }).reason;
  return typeof r === "string" ? r : null;
}

/**
 * Extracts the Google API error reason from a GaxiosError.
 * googleapis places structured errors at `error.response.data.error.errors[0].reason`.
 */
function get403Reason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  // GaxiosError: traverse error.response.data.error.{errors,details}
  if ("response" in error) {
    const response = (error as { response: unknown }).response;
    if (response && typeof response === "object" && "data" in response) {
      const data = (response as { data: unknown }).data;
      if (data && typeof data === "object" && "error" in data) {
        const apiError = (data as { error: unknown }).error;
        if (apiError && typeof apiError === "object") {
          if ("errors" in apiError) {
            const reason = firstReason((apiError as { errors: unknown }).errors);
            if (reason) return reason;
          }
          if ("details" in apiError) {
            const details = (apiError as { details: unknown }).details;
            if (Array.isArray(details)) {
              for (const d of details) {
                if (d && typeof d === "object" && "reason" in d) {
                  const r = (d as { reason: unknown }).reason;
                  if (typeof r === "string") return r;
                }
              }
            }
          }
        }
      }
    }
  }

  // Fallback: message-based detection for scope issues
  const msg =
    "message" in error
      ? (error as { message: unknown }).message
      : undefined;
  if (typeof msg === "string") {
    const lower = msg.toLowerCase();
    if (
      lower.includes("insufficient authentication scopes") ||
      lower.includes("access_token_scope_insufficient")
    ) {
      return "ACCESS_TOKEN_SCOPE_INSUFFICIENT";
    }
  }

  return null;
}

const API_NOT_ENABLED_REASONS = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);

const HTTP_ERROR_MAP: Record<number, ErrorFactory> = {
  401: (ctx, _code, _originalError) =>
    new AuthenticationRequiredError(ctx),
  403: (ctx, _code, originalError) => {
    const reason = get403Reason(originalError);
    if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || reason === "insufficientPermissions") {
      return new ScopeInsufficientError(ctx);
    }
    if (reason && API_NOT_ENABLED_REASONS.has(reason)) {
      const msg =
        originalError instanceof Error
          ? originalError.message
          : `The API required for "${ctx}" is not enabled in your Google Cloud project.`;
      return new ServiceError(msg, "API_NOT_ENABLED", 403, false, "Enable the API in Google Cloud Console, then retry.");
    }
    return new PermissionDeniedError(ctx, "resource");
  },
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
