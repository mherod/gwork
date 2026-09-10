
import chalk from "chalk";
import ora from "ora";
import { TokenStore } from "../services/token-store.ts";
import type { TokenData } from "../services/token-store.ts";
import { logger } from "../utils/logger.ts";
import { printSectionHeader } from "../utils/output.ts";

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
  const isVerbose =
    args.includes("-v") || args.includes("--verbose") || logger.getConfig().verbose;
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
    const accounts = tokens.reduce<Record<string, TokenData[]>>((acc, token) => {
      const key = token.account;
      if (!acc[key]) acc[key] = [];
      acc[key].push(token);
      return acc;
    }, {});

    printSectionHeader("\nConfigured Accounts:");

    Object.entries(accounts).forEach(([email, accountTokens], index) => {
      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(email)}`);

      accountTokens.forEach(token => {
        const expiryDate = new Date(token.expiry_date);
        const now = Date.now();
        const isExpired = expiryDate.getTime() < now;
        const hasRefreshToken = !!token.refresh_token?.trim();
        const hasScopes = token.scopes.some(scope => scope.trim().length > 0);

        // Color based on status
        let statusColor = chalk.green;
        let statusText = "Active";
        if (!hasScopes) {
          statusColor = chalk.red;
          statusText = "Invalid — re-auth required";
        } else if (!hasRefreshToken && (isExpired || !token.access_token?.trim() || !Number.isFinite(token.expiry_date))) {
          statusColor = chalk.red;
          statusText = "Needs re-auth";
        }

        logger.info(`   ${chalk.gray("Service:")} ${token.service}`);
        logger.info(`   ${chalk.gray("Status:")}  ${statusColor(statusText)}`);
        logger.info(`   ${chalk.gray("Access token expires:")} ${expiryDate.toLocaleString()} (${formatTimeRemaining(expiryDate)})`);
        logger.info(`   ${chalk.gray("Refresh token:")} ${hasRefreshToken ? "Stored" : "Not stored"}`);

        // Show scopes in a condensed way if verbose flag is present.
        // `--verbose` is consumed as a global flag in main() and stripped from
        // args before dispatch, so the logger config is the only place it
        // survives when invoked through the CLI. `-v` still arrives in args.
        if (isVerbose) {
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
