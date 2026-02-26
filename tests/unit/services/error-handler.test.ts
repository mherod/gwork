/**
 * Unit tests for handleGoogleApiError.
 *
 * Verifies that every code path throws a ServiceError (never re-throws a raw
 * non-ServiceError object), including the previously-missing case where the
 * error has a numeric `.code` but is not an instanceof Error.
 */

import { describe, it, expect } from "bun:test";
import { handleGoogleApiError } from "../../../src/services/error-handler.ts";
import {
  ServiceError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
  ScopeInsufficientError,
} from "../../../src/services/errors.ts";

// ---------------------------------------------------------------------------
// Helper: build a GaxiosError-shaped Error for 403 sub-classification tests.
// Real GaxiosErrors are instanceof Error with extra properties added by gaxios.
// ---------------------------------------------------------------------------
function gaxiosError403(reason: string, message = "API error"): Error {
  return Object.assign(new Error(message), {
    code: 403,
    response: {
      data: {
        error: { code: 403, message, errors: [{ reason, message, domain: "googleapis.com" }] },
      },
    },
  });
}

function gaxiosError403ViaDetails(detailReason: string, message = "API error"): Error {
  return Object.assign(new Error(message), {
    code: 403,
    response: {
      data: {
        error: { code: 403, message, details: [{ "@type": "type.googleapis.com/...", reason: detailReason }] },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// ScopeInsufficientError — class shape
// ---------------------------------------------------------------------------
describe("ScopeInsufficientError", () => {
  it("is an instanceof ServiceError", () => {
    expect(new ScopeInsufficientError("list files")).toBeInstanceOf(ServiceError);
  });

  it("has code SCOPE_INSUFFICIENT", () => {
    expect(new ScopeInsufficientError("list files").code).toBe("SCOPE_INSUFFICIENT");
  });

  it("has httpStatus 403", () => {
    expect(new ScopeInsufficientError("list files").httpStatus).toBe(403);
  });

  it("includes the operation context in the message", () => {
    expect(new ScopeInsufficientError("get storage quota").message).toContain("get storage quota");
  });

  it("carries a non-empty hint about re-authenticating", () => {
    const err = new ScopeInsufficientError("list files");
    expect(err.hint).toBeTruthy();
    expect(err.hint).toContain("Re-authenticating");
  });
});

describe("handleGoogleApiError", () => {
  describe("known HTTP status codes", () => {
    it("throws ServiceError with AUTHENTICATION_REQUIRED for 401", () => {
      expect(() =>
        handleGoogleApiError({ code: 401, message: "Unauthorized" }, "list events")
      ).toThrow(ServiceError);
    });

    it("throws NotFoundError for 404", () => {
      expect(() =>
        handleGoogleApiError({ code: 404, message: "Not Found" }, "get event")
      ).toThrow(NotFoundError);
    });

    it("throws PermissionDeniedError for 403", () => {
      expect(() =>
        handleGoogleApiError({ code: 403, message: "Forbidden" }, "list contacts")
      ).toThrow(PermissionDeniedError);
    });

    it("throws RateLimitError for 429", () => {
      expect(() =>
        handleGoogleApiError({ code: 429, message: "Too Many Requests" }, "search")
      ).toThrow(RateLimitError);
    });

    it("throws ServiceUnavailableError for 500", () => {
      expect(() =>
        handleGoogleApiError({ code: 500, message: "Internal Server Error" }, "send")
      ).toThrow(ServiceUnavailableError);
    });

    it("throws ServiceUnavailableError for 503", () => {
      expect(() =>
        handleGoogleApiError({ code: 503, message: "Service Unavailable" }, "send")
      ).toThrow(ServiceUnavailableError);
    });
  });

  describe("default branch — non-Error objects with .code (regression for issue #29)", () => {
    it("throws ServiceError (not the raw POJO) for a plain {code, message} object", () => {
      const pojo = { code: 400, message: "Bad Request" };
      expect(() => handleGoogleApiError(pojo, "create contact")).toThrow(ServiceError);
    });

    it("ServiceError carries the correct httpStatus from the POJO code", () => {
      const pojo = { code: 400, message: "Bad Request" };
      let thrown: unknown;
      try {
        handleGoogleApiError(pojo, "create contact");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ServiceError);
      expect((thrown as ServiceError).httpStatus).toBe(400);
    });

    it("ServiceError message includes the context and POJO message", () => {
      const pojo = { code: 422, message: "Unprocessable Entity" };
      let thrown: unknown;
      try {
        handleGoogleApiError(pojo, "update contact");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ServiceError);
      const msg = (thrown as ServiceError).message;
      expect(msg).toContain("update contact");
      expect(msg).toContain("Unprocessable Entity");
    });

    it("handles POJO with no message property gracefully", () => {
      const pojo = { code: 418 };
      expect(() => handleGoogleApiError(pojo, "brew tea")).toThrow(ServiceError);
    });

    it("Error instanceof Error with unknown code still throws ServiceError", () => {
      const err = new Error("Something went wrong");
      (err as unknown as { code: number }).code = 418;
      expect(() => handleGoogleApiError(err, "brew tea")).toThrow(ServiceError);
    });
  });

  describe("errors without .code", () => {
    it("wraps a plain Error in ServiceError with UNKNOWN_ERROR code", () => {
      const err = new Error("Network failure");
      let thrown: unknown;
      try {
        handleGoogleApiError(err, "list messages");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ServiceError);
      expect((thrown as ServiceError).code).toBe("UNKNOWN_ERROR");
    });

    it("re-throws non-Error primitives as-is when no .code present", () => {
      expect(() => handleGoogleApiError("raw string error", "list")).toThrow("raw string error");
    });
  });

  // -------------------------------------------------------------------------
  // 403 sub-classification: scope vs API-disabled vs generic permission error
  // -------------------------------------------------------------------------
  describe("403 sub-classification via GaxiosError response body", () => {
    it("throws ScopeInsufficientError for ACCESS_TOKEN_SCOPE_INSUFFICIENT in errors[0].reason", () => {
      expect(() =>
        handleGoogleApiError(gaxiosError403("ACCESS_TOKEN_SCOPE_INSUFFICIENT"), "list files")
      ).toThrow(ScopeInsufficientError);
    });

    it("ScopeInsufficientError carries the operation context in its message", () => {
      let thrown: unknown;
      try {
        handleGoogleApiError(gaxiosError403("ACCESS_TOKEN_SCOPE_INSUFFICIENT"), "list files");
      } catch (e) {
        thrown = e;
      }
      expect((thrown as ScopeInsufficientError).message).toContain("list files");
    });

    it("throws ServiceError(API_NOT_ENABLED) for accessNotConfigured in errors[0].reason", () => {
      let thrown: unknown;
      try {
        handleGoogleApiError(gaxiosError403("accessNotConfigured", "Drive API not enabled"), "list files");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ServiceError);
      expect((thrown as ServiceError).code).toBe("API_NOT_ENABLED");
    });

    it("API_NOT_ENABLED error surfaces the original Google error message", () => {
      const googleMsg =
        "Google Drive API has not been used in project 12345 before or it is disabled.";
      let thrown: unknown;
      try {
        handleGoogleApiError(gaxiosError403("accessNotConfigured", googleMsg), "list files");
      } catch (e) {
        thrown = e;
      }
      expect((thrown as ServiceError).message).toBe(googleMsg);
    });

    it("API_NOT_ENABLED error includes a hint about enabling the API", () => {
      let thrown: unknown;
      try {
        handleGoogleApiError(gaxiosError403("accessNotConfigured"), "list files");
      } catch (e) {
        thrown = e;
      }
      expect((thrown as ServiceError).hint).toContain("Google Cloud Console");
    });

    it("throws ServiceError(API_NOT_ENABLED) for SERVICE_DISABLED in details[0].reason", () => {
      let thrown: unknown;
      try {
        handleGoogleApiError(gaxiosError403ViaDetails("SERVICE_DISABLED", "Drive API is disabled"), "stats");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ServiceError);
      expect((thrown as ServiceError).code).toBe("API_NOT_ENABLED");
    });

    it("falls back to PermissionDeniedError for generic 403 without structured reason", () => {
      expect(() =>
        handleGoogleApiError({ code: 403, message: "Forbidden" }, "delete file")
      ).toThrow(PermissionDeniedError);
    });

    it("detects scope insufficiency from the error message when no structured errors present", () => {
      const msgOnlyError = Object.assign(new Error("Request had insufficient authentication scopes."), {
        code: 403,
      });
      let thrown: unknown;
      try {
        handleGoogleApiError(msgOnlyError, "list files");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ScopeInsufficientError);
    });
  });
});
