import chalk from "chalk";
import {
  ServiceError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
  InitializationError,
  ValidationError,
  ArgumentError,
} from "../services/errors.ts";

/**
 * Log service errors with appropriate user-friendly messages.
 * Does not exit - lets the top-level error handler manage exit codes.
 *
 * @param error - The error to handle
 */
export function logServiceError(error: unknown): void {
  if (error instanceof ArgumentError) {
    console.error(chalk.red("Error:"), error.message);
  } else if (error instanceof NotFoundError) {
    console.error(chalk.red("Error:"), error.message);
  } else if (error instanceof PermissionDeniedError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please check your authentication and permissions."));
  } else if (error instanceof RateLimitError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please wait a moment and try again."));
  } else if (error instanceof ServiceUnavailableError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("The service is temporarily unavailable. Please try again later."));
  } else if (error instanceof InitializationError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please run the setup guide to configure your credentials."));
  } else if (error instanceof ValidationError) {
    console.error(chalk.red("Validation Error:"), error.message);
  } else if (error instanceof ServiceError) {
    console.error(chalk.red("Error:"), error.message);
  } else if (error instanceof Error) {
    console.error(chalk.red("Error:"), error.message);
  } else {
    console.error(chalk.red("Error:"), "Unknown error occurred");
  }
}

/**
 * Legacy function for backwards compatibility.
 * @deprecated Use logServiceError instead and let top-level error handler manage exit
 */
export function handleServiceError(error: unknown): never {
  logServiceError(error);
  process.exit(1);
}
