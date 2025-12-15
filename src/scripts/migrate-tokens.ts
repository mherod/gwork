#!/usr/bin/env bun
import { TokenStore } from "../services/token-store.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tokenStore = TokenStore.getInstance();

// Migrate calendar token
const calendarTokenPath = path.join(os.homedir(), ".calendar_token.json");
if (fs.existsSync(calendarTokenPath)) {
  try {
    const calToken = JSON.parse(fs.readFileSync(calendarTokenPath, "utf8"));
    tokenStore.saveToken({
      service: "calendar",
      account: "default",
      access_token: calToken.access_token,
      refresh_token: calToken.refresh_token,
      expiry_date: calToken.expiry_date,
      scopes: calToken.scopes || [],
    });
    console.log("✓ Migrated calendar token");

    // Rename old file
    fs.renameSync(calendarTokenPath, calendarTokenPath + ".old");
    console.log("  Renamed old token file to .calendar_token.json.old");
  } catch (error: any) {
    console.error("Failed to migrate calendar token:", error.message);
  }
} else {
  console.log("- No calendar token to migrate");
}

// Migrate gmail token
const gmailTokenPath = path.join(os.homedir(), ".gmail_token.json");
if (fs.existsSync(gmailTokenPath)) {
  try {
    const gmailToken = JSON.parse(fs.readFileSync(gmailTokenPath, "utf8"));
    tokenStore.saveToken({
      service: "gmail",
      account: "default",
      access_token: gmailToken.access_token,
      refresh_token: gmailToken.refresh_token,
      expiry_date: gmailToken.expiry_date,
      scopes: gmailToken.scopes || [],
    });
    console.log("✓ Migrated gmail token");

    // Rename old file
    fs.renameSync(gmailTokenPath, gmailTokenPath + ".old");
    console.log("  Renamed old token file to .gmail_token.json.old");
  } catch (error: any) {
    console.error("Failed to migrate gmail token:", error.message);
  }
} else {
  console.log("- No gmail token to migrate");
}

console.log("\nMigration complete! Tokens are now stored in ~/.gwork_tokens.db");
console.log("\nYou can view all tokens with:");
console.log("  bun run src/scripts/list-tokens.ts");

tokenStore.close();
