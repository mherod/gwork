import chalk from "chalk";
import {
  ServiceError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
  InitializationError,
  ValidationError,
} from "../services/errors.ts";

/**
 * Handle service errors with appropriate user-friendly messages.
 * This function never returns normally - it always throws or exits.
 *
 * @param error - The error to handle
 * @throws Never returns; always exits with process.exit(1)
 */
export function handleServiceError(error: unknown): never {
  if (error instanceof NotFoundError) {
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  } else if (error instanceof PermissionDeniedError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please check your authentication and permissions."));
    process.exit(1);
  } else if (error instanceof RateLimitError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please wait a moment and try again."));
    process.exit(1);
  } else if (error instanceof ServiceUnavailableError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("The service is temporarily unavailable. Please try again later."));
    process.exit(1);
  } else if (error instanceof InitializationError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please run the setup guide to configure your credentials."));
    process.exit(1);
  } else if (error instanceof ValidationError) {
    console.error(chalk.red("Validation Error:"), error.message);
    process.exit(1);
  } else if (error instanceof ServiceError) {
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  } else if (error instanceof Error) {
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  } else {
    console.error(chalk.red("Error:"), "Unknown error occurred");
    process.exit(1);
  }
}
