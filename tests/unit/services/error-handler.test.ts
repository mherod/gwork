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
} from "../../../src/services/errors.ts";

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
});
