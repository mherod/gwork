import chalk from "chalk";
import { logger } from "./logger.ts";
import { SEPARATOR } from "./format.ts";

/**
 * Print a bold section header followed by a horizontal separator.
 * Used consistently across all CLI command output sections.
 *
 * @example
 * printSectionHeader("\nMessages:");
 * // outputs: bold "\nMessages:" then "────────────────────..."
 */
export function printSectionHeader(title: string): void {
  logger.info(chalk.bold(title));
  logger.info(SEPARATOR);
}
