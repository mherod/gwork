/**
 * Unit tests for retry helper utilities.
 * Tests exponential backoff retry logic for Google API operations.
 */

import { describe, it, expect } from "bun:test";
import { retryWithBackoff, isRetryableError } from "../../../src/utils/retry-helper.ts";
import { RateLimitError, ServiceUnavailableError, ServiceError } from "../../../src/services/errors.ts";

describe("isRetryableError", () => {
  it("returns true for RateLimitError", () => {
    const error = new RateLimitError();
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for ServiceUnavailableError", () => {
    const error = new ServiceUnavailableError();
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns false for other ServiceError types", () => {
    const error = new ServiceError("Some error", "OTHER_ERROR", 400, false);
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns false for non-retryable Error", () => {
    const error = new Error("Regular error");
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("retryWithBackoff", () => {

  it("returns result on first successful attempt", async () => {
    const operation = async () => "success";
    const result = await retryWithBackoff(operation, "test operation");
    expect(result).toBe("success");
  });

  it("retries on retryable errors up to maxRetries", async () => {
    let attempts = 0;
    const operation = async () => {
      attempts++;
      if (attempts < 3) {
        throw new RateLimitError();
      }
      return "success on attempt " + attempts;
    };

    const result = await retryWithBackoff(operation, "test rate limit", 3, 1); // Fast retries for testing
    expect(result).toBe("success on attempt 3");
    expect(attempts).toBe(3); // Should have made 3 attempts total
  });

  it("throws error immediately on non-retryable errors", async () => {
    const operation = async () => {
      throw new ServiceError("Non-retryable", "NOT_FOUND", 404, false);
    };

    await expect(retryWithBackoff(operation, "test")).rejects.toThrow(ServiceError);
  });

  it("throws error after exhausting retries", async () => {
    const operation = async () => {
      throw new ServiceUnavailableError();
    };

    await expect(retryWithBackoff(operation, "test", 2, 1)).rejects.toThrow(ServiceUnavailableError);
  });

  it("can configure base delay and max retries", async () => {
    let attempts = 0;
    const operation = async () => {
      attempts++;
      if (attempts < 2) {
        throw new ServiceUnavailableError();
      }
      return "success on attempt " + attempts;
    };

    const result = await retryWithBackoff(operation, "test", 3, 50); // 3 retries, 50ms base delay

    expect(result).toBe("success on attempt 2"); // succeeded on retry 2 (attempt 2)
    expect(attempts).toBe(2);
  });
});