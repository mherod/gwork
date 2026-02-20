import chalk from "chalk";
import { ServiceError } from "../services/errors.ts";

/**
 * Log service errors with appropriate user-friendly messages.
 * Does not exit - lets the top-level error handler manage exit codes.
 *
 * @param error - The error to handle
 */
export function logServiceError(error: unknown): void {
  if (error instanceof ServiceError) {
    console.error(chalk.red(error.errorLabel), error.message);
    if (error.hint) {
      console.error(chalk.yellow(error.hint));
    }
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
