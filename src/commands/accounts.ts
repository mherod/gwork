
import chalk from "chalk";
import ora from "ora";
import { TokenStore } from "../services/token-store.ts";
import { groupBy } from "lodash-es";
import { logger } from "../utils/logger.ts";

/**
 * Formats time remaining until token expiry.
 */
function formatTimeRemaining(expiryDate: Date): string {
  const now = Date.now();
  const expiryTime = expiryDate.getTime();
  const diffMs = expiryTime - now;

  if (diffMs < 0) {
    return "Expired";
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} remaining`;
  }

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} remaining`;
  }

  const diffMins = Math.floor(diffMs / (1000 * 60));
  return `${diffMins} minute${diffMins === 1 ? "" : "s"} remaining`;
}

export async function handleAccountsCommand(args: string[]) {
  const spinner = ora("Fetching configured accounts...").start();

  try {
    const tokenStore = TokenStore.getInstance();
    const tokens = tokenStore.listTokens();

    if (tokens.length === 0) {
      spinner.stop();
      logger.info(chalk.yellow("No configured accounts found."));
      logger.info(`Run ${chalk.cyan("gwork <service> <command>")} to authenticate.`);
      return;
    }

    spinner.succeed(`Found ${tokens.length} token(s)`);

    // Group tokens by account email
    const accounts = groupBy(tokens, "account");

    logger.info(chalk.bold("\nConfigured Accounts:"));
    logger.info("─".repeat(80));

    Object.entries(accounts).forEach(([email, accountTokens], index) => {
      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(email)}`);

      accountTokens.forEach(token => {
        const expiryDate = new Date(token.expiry_date);
        const now = Date.now();
        const isExpired = expiryDate.getTime() < now;
        const expiringSoon = expiryDate.getTime() - now < 24 * 60 * 60 * 1000 && !isExpired;

        // Color based on status
        let statusColor = chalk.green;
        let statusText = "Active";
        if (isExpired) {
          statusColor = chalk.red;
          statusText = "Expired";
        } else if (expiringSoon) {
          statusColor = chalk.yellow;
          statusText = "Expiring soon";
        }

        logger.info(`   ${chalk.gray("Service:")} ${token.service}`);
        logger.info(`   ${chalk.gray("Status:")}  ${statusColor(statusText)}`);
        logger.info(`   ${chalk.gray("Expires:")} ${expiryDate.toLocaleString()} (${formatTimeRemaining(expiryDate)})`);

        // Show scopes in a condensed way if verbose flag is present
        if (args.includes("-v") || args.includes("--verbose")) {
            logger.info(`   ${chalk.gray("Scopes:")}`);
            token.scopes.forEach(scope => {
                logger.info(`     - ${scope}`);
            });
        }
      });
    });

    // Clean up
    tokenStore.close();
  } catch (error: unknown) {
    spinner.fail("Failed to list accounts");
    throw error;
  }
}
