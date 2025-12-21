/**
 * Structured error classes for service layer.
 * Enables programmatic error handling and recovery strategies.
 */

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
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
      false
    );
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
  }
}

export class RateLimitError extends ServiceError {
  constructor(message: string = "Rate limit exceeded") {
    super(message, "RATE_LIMIT", 429, true);
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ServiceUnavailableError extends ServiceError {
  constructor(message: string = "Service temporarily unavailable") {
    super(message, "SERVICE_UNAVAILABLE", 503, true);
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

export class InitializationError extends ServiceError {
  constructor(serviceName: string) {
    super(
      `${serviceName} service not initialized`,
      "NOT_INITIALIZED",
      500,
      false
    );
    Object.setPrototypeOf(this, InitializationError.prototype);
  }
}

export class ValidationError extends ServiceError {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`, "VALIDATION_ERROR", 400, false);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
