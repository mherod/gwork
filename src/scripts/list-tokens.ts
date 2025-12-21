#!/usr/bin/env bun
import { TokenStore } from "../services/token-store.ts";
import chalk from "chalk";

const tokenStore = TokenStore.getInstance();

const allTokens = tokenStore.listTokens();

if (allTokens.length === 0) {
  console.log(chalk.yellow("No tokens found in database"));
  process.exit(0);
}

console.log(chalk.bold("\nStored Authentication Tokens:"));
console.log("=".repeat(80));

let currentService = "";

allTokens.forEach((token, _index) => {
  if (token.service !== currentService) {
    currentService = token.service;
    console.log(`\n${chalk.cyan.bold(token.service.toUpperCase())}:`);
  }

  const createdDate = new Date(token.created_at).toLocaleString();
  const updatedDate = new Date(token.updated_at).toLocaleString();
  const expiryDate = new Date(token.expiry_date).toLocaleString();
  const isExpired = token.expiry_date < Date.now();

  console.log(`\n  Account: ${chalk.green(token.account)}`);
  console.log(`  Scopes: ${token.scopes.length} scope(s)`);
  token.scopes.forEach(scope => {
    console.log(`    - ${chalk.gray(scope)}`);
  });
  console.log(`  Created: ${chalk.gray(createdDate)}`);
  console.log(`  Updated: ${chalk.gray(updatedDate)}`);
  console.log(
    `  Expires: ${isExpired ? chalk.red(expiryDate + " (EXPIRED)") : chalk.gray(expiryDate)}`
  );
  console.log(`  Access Token: ${chalk.gray(token.access_token.substring(0, 20) + "...")}`);
});

console.log("\n" + "=".repeat(80));
console.log(chalk.bold(`\nTotal: ${allTokens.length} token(s)\n`));

tokenStore.close();
