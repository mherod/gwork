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
  constructor(resource: string, identifier: string) {
    super(
      `${resource} not found: ${identifier}`,
      "NOT_FOUND",
      404,
      false
    );
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class PermissionDeniedError extends ServiceError {
  constructor(resource: string, identifier: string) {
    super(
      `Permission denied: You don't have access to ${resource} ${identifier}`,
      "PERMISSION_DENIED",
      403,
      false,
      "Please check your authentication and permissions."
    );
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
  }
}

export class RateLimitError extends ServiceError {
  constructor(message = "Rate limit exceeded") {
    super(message, "RATE_LIMIT", 429, true, "Please wait a moment and try again.");
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ServiceUnavailableError extends ServiceError {
  constructor(message = "Service temporarily unavailable") {
    super(message, "SERVICE_UNAVAILABLE", 503, true, "The service is temporarily unavailable. Please try again later.");
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
