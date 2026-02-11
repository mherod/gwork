
import chalk from "chalk";
import ora from "ora";
import { TokenStore } from "../services/token-store.ts";
import { groupBy } from "lodash-es";

export async function handleAccountsCommand(args: string[]) {
  const spinner = ora("Fetching configured accounts...").start();

  try {
    const tokenStore = TokenStore.getInstance();
    const tokens = tokenStore.listTokens();

    if (tokens.length === 0) {
      spinner.stop();
      console.log(chalk.yellow("No configured accounts found."));
      console.log(`Run ${chalk.cyan("gwork <service> <command>")} to authenticate.`);
      return;
    }

    spinner.succeed(`Found ${tokens.length} token(s)`);

    // Group tokens by account email
    const accounts = groupBy(tokens, "account");

    console.log(chalk.bold("\nConfigured Accounts:"));
    console.log("─".repeat(80));

    Object.entries(accounts).forEach(([email, accountTokens], index) => {
      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(email)}`);

      accountTokens.forEach(token => {
        const expiryDate = new Date(token.expiry_date);
        const isExpired = expiryDate.getTime() < Date.now();
        const statusColor = isExpired ? chalk.red : chalk.green;
        const statusText = isExpired ? "Expired" : "Active";

        console.log(`   ${chalk.gray("Service:")} ${token.service}`);
        console.log(`   ${chalk.gray("Status:")}  ${statusColor(statusText)} (${expiryDate.toLocaleString()})`);

        // Show scopes in a condensed way if verbose flag is present
        if (args.includes("-v") || args.includes("--verbose")) {
            console.log(`   ${chalk.gray("Scopes:")}`);
            token.scopes.forEach(scope => {
                console.log(`     - ${scope}`);
            });
        }
      });
    });

    // Clean up
    tokenStore.close();
  } catch (error: any) {
    spinner.fail("Failed to list accounts");
    throw error;
  }
}
