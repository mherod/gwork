
import chalk from "chalk";
import ora from "ora";
import { TokenStore } from "../services/token-store.ts";
import type { TokenData } from "../services/token-store.ts";
import { logger } from "../utils/logger.ts";
import { printSectionHeader } from "../utils/output.ts";
import { ArgumentError } from "../services/errors.ts";
import { CommandRegistry } from "./registry.ts";

const REMOVE_USAGE = "gwork accounts remove <account> [--service <name>] [--confirm]";
const PRUNE_USAGE = "gwork accounts prune [--include-test-fixtures] [--confirm]";

const accountsRegistry = new CommandRegistry<TokenStore>()
  .register("list", listAccounts)
  .register("remove", removeAccount)
  .register("prune", pruneAccounts);

export async function handleAccountsCommand(args: string[]) {
  const hasSubcommand = args[0] !== undefined && !args[0].startsWith("-");
  const subcommand = hasSubcommand ? args[0]! : "list";
  const commandArgs = hasSubcommand ? args.slice(1) : args;

  // Reject unknown commands before opening (and potentially creating) the store.
  if (!accountsRegistry.commands().includes(subcommand)) {
    throw new ArgumentError(`Unknown subcommand: ${subcommand}`, "gwork accounts [list|remove|prune]");
  }

  const tokenStore = TokenStore.getInstance();
  try {
    await accountsRegistry.execute(subcommand, tokenStore, commandArgs);
  } finally {
    tokenStore.close();
  }
}

interface RemovalCandidate {
  token: TokenData;
  reason: string;
}

function applyRemovalPlan(tokenStore: TokenStore, candidates: RemovalCandidate[], confirm: boolean): void {
  if (candidates.length === 0) {
    logger.info("No matching tokens found. Nothing to remove.");
    return;
  }

  logger.info(`Tokens selected for removal (${candidates.length}):`);
  for (const { token, reason } of candidates) {
    // Quote identifiers so an empty account and any whitespace remain visible.
    logger.info(`  ${JSON.stringify(token.account)} / ${JSON.stringify(token.service)} — ${reason}`);
  }

  if (!confirm) {
    logger.info("Preview only. Re-run with --confirm to remove these tokens.");
    return;
  }

  for (const { token } of candidates) {
    const deleted = tokenStore.deleteToken(token.service, token.account);
    const result = deleted ? "Removed" : "Already absent";
    logger.info(`${result}: ${JSON.stringify(token.account)} / ${JSON.stringify(token.service)}`);
  }
}

async function removeAccount(tokenStore: TokenStore, args: string[]): Promise<void> {
  let account: string | undefined;
  let service: string | undefined;
  let confirm = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--service") {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("-") || service !== undefined) {
        throw new ArgumentError("--service requires one service name", REMOVE_USAGE);
      }
      service = value;
    } else if (arg.startsWith("-") || account !== undefined) {
      throw new ArgumentError(`Unexpected argument: ${arg}`, REMOVE_USAGE);
    } else {
      account = arg;
    }
  }

  if (account === undefined) {
    throw new ArgumentError("An account is required", REMOVE_USAGE);
  }

  const candidates = tokenStore.listTokens()
    .filter(token => token.account === account && (service === undefined || token.service === service))
    .map(token => ({ token, reason: "selected account" }));
  applyRemovalPlan(tokenStore, candidates, confirm);
}

async function pruneAccounts(tokenStore: TokenStore, args: string[]): Promise<void> {
  for (const arg of args) {
    if (arg !== "--confirm" && arg !== "--include-test-fixtures") {
      throw new ArgumentError(`Unexpected argument: ${arg}`, PRUNE_USAGE);
    }
  }

  const includeTestFixtures = args.includes("--include-test-fixtures");
  const candidates: RemovalCandidate[] = [];
  for (const token of tokenStore.listTokens()) {
    const reasons: string[] = [];
    if (!token.account.trim()) reasons.push("empty account name");
    if (!token.scopes.some(scope => scope.trim())) reasons.push("empty scopes");
    if (includeTestFixtures && /^test-\d+$/.test(token.service)) reasons.push("test fixture service");
    // Access expiry alone does not make a stored grant unusable: it may refresh.
    if (reasons.length > 0) candidates.push({ token, reason: reasons.join(", ") });
  }
  applyRemovalPlan(tokenStore, candidates, args.includes("--confirm"));
}

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

async function listAccounts(tokenStore: TokenStore, args: string[]) {
  for (const arg of args) {
    if (arg !== "-v" && arg !== "--verbose") {
      throw new ArgumentError(`Unexpected argument: ${arg}`, "gwork accounts list [--verbose]");
    }
  }
  const isVerbose =
    args.includes("-v") || args.includes("--verbose") || logger.getConfig().verbose;
  const spinner = ora("Fetching configured accounts...").start();

  try {
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

  } catch (error: unknown) {
    spinner.fail("Failed to list accounts");
    throw error;
  }
}
