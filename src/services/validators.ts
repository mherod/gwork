/**
 * Input validation utilities for service layer.
 * Validates inputs before sending to Google APIs.
 */

import { ValidationError } from "./errors.ts";

/**
 * Validates email address format.
 *
 * @param email - Email address to validate
 * @throws {ValidationError} If email format is invalid
 */
export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError("email", "Invalid email format");
  }
}

/**
 * Validates page size is within acceptable bounds.
 *
 * @param pageSize - Number of items per page
 * @param max - Maximum allowed page size (default: 2500)
 * @throws {ValidationError} If pageSize is out of bounds
 */
export function validatePageSize(pageSize: number, max: number = 2500): void {
  if (pageSize < 1 || pageSize > max) {
    throw new ValidationError("pageSize", `Must be between 1 and ${max}`);
  }
}

/**
 * Validates resource ID is not empty.
 *
 * @param id - Resource identifier
 * @param resourceType - Type of resource (for error message)
 * @throws {ValidationError} If ID is empty
 */
export function validateResourceId(id: string, resourceType: string): void {
  if (!id || id.trim() === "") {
    throw new ValidationError(resourceType, "ID cannot be empty");
  }
}

/**
 * Validates ISO 8601 date string format.
 *
 * @param date - Date string to validate
 * @param fieldName - Field name (for error message)
 * @throws {ValidationError} If date format is invalid
 */
export function validateDateString(date: string, fieldName: string): void {
  if (isNaN(Date.parse(date))) {
    throw new ValidationError(fieldName, "Invalid date format (expected ISO 8601)");
  }
}

/**
 * Validates max results is within acceptable bounds.
 *
 * @param maxResults - Maximum results to return
 * @param max - Maximum allowed value (varies by API)
 * @param min - Minimum allowed value (default: 1)
 * @throws {ValidationError} If out of bounds
 */
export function validateMaxResults(maxResults: number, max: number, min: number = 1): void {
  if (maxResults < min || maxResults > max) {
    throw new ValidationError(
      "maxResults",
      `Must be between ${min} and ${max}`
    );
  }
}

/**
 * Validates confidence score is between 0-100.
 *
 * @param confidence - Confidence percentage
 * @throws {ValidationError} If not between 0-100
 */
export function validateConfidenceScore(confidence: number): void {
  if (confidence < 0 || confidence > 100) {
    throw new ValidationError("confidence", "Must be between 0 and 100");
  }
}
