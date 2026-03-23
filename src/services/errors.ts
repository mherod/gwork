/**
 * Structured error classes for service layer.
 * Enables programmatic error handling and recovery strategies.
 */

export class ServiceError extends Error {
  /** Optional user-facing hint printed below the error message. */
  readonly hint?: string;
  /** Label prefix for the error line (default: "Error:"). */
  readonly errorLabel: string;

  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly retryable = false,
    hint?: string,
    errorLabel = "Error:"
  ) {
    super(message);
    this.name = this.constructor.name;
    this.hint = hint;
    this.errorLabel = errorLabel;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

export class NotFoundError extends ServiceError {
  constructor(resource: string, identifier?: string, hint?: string) {
    const msg = identifier ? `${resource} not found: ${identifier}` : `${resource} not found`;
    super(msg, "NOT_FOUND", 404, false, hint);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class PermissionDeniedError extends ServiceError {
  constructor(resource: string, identifier: string, hint?: string) {
    super(
      `Permission denied: You don't have access to ${resource} ${identifier}`.trimEnd(),
      "PERMISSION_DENIED",
      403,
      false,
      hint ?? "Please check your authentication and permissions."
    );
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
  }
}

export class RateLimitError extends ServiceError {
  constructor(message = "Rate limit exceeded") {
    super(message, "RATE_LIMIT", 429, true, "Rate limit exceeded. Automatically retrying with backoff...");
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ServiceUnavailableError extends ServiceError {
  constructor(message = "Service temporarily unavailable") {
    super(message, "SERVICE_UNAVAILABLE", 503, true, "Google service temporarily unavailable. Automatically retrying...");
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

export class InitializationError extends ServiceError {
  constructor(serviceName: string) {
    super(
      `${serviceName} service not initialized`,
      "NOT_INITIALIZED",
      500,
      false,
      "Please run the setup guide to configure your credentials."
    );
    Object.setPrototypeOf(this, InitializationError.prototype);
  }
}

export class ValidationError extends ServiceError {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`, "VALIDATION_ERROR", 400, false, undefined, "Validation Error:");
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class ArgumentError extends ServiceError {
  constructor(message: string, usage?: string) {
    const fullMessage = usage ? `${message}\nUsage: ${usage}` : message;
    super(fullMessage, "INVALID_ARGUMENTS", 400, false);
    Object.setPrototypeOf(this, ArgumentError.prototype);
  }
}

export class ScopeInsufficientError extends ServiceError {
  constructor(context: string) {
    super(
      `Insufficient authentication scopes for: ${context}`,
      "SCOPE_INSUFFICIENT",
      403,
      false,
      "Your saved token does not grant access to this API. Re-authenticating with the required scopes..."
    );
    Object.setPrototypeOf(this, ScopeInsufficientError.prototype);
  }
}

export class AuthenticationRequiredError extends ServiceError {
  constructor(context: string) {
    super(
      `Authentication required for: ${context}`,
      "AUTHENTICATION_REQUIRED",
      401,
      false,
      "Your session has expired. Re-authenticating..."
    );
    Object.setPrototypeOf(this, AuthenticationRequiredError.prototype);
  }
}
