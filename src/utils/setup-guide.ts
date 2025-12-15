import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");

export function checkCredentialsExist(): boolean {
  return fs.existsSync(CREDENTIALS_PATH);
}

export function showSetupGuide(): void {
  console.log("\n" + chalk.bold.cyan("=".repeat(80)));
  console.log(chalk.bold.cyan("  Welcome to gwork! Let's get you set up."));
  console.log(chalk.bold.cyan("=".repeat(80)) + "\n");

  console.log(chalk.yellow("📋 You need to create Google OAuth credentials to use this tool.\n"));

  console.log(chalk.bold("Step 1: Create a Google Cloud Project"));
  console.log("  1. Go to: " + chalk.blue.underline("https://console.cloud.google.com/"));
  console.log("  2. Click " + chalk.green("'Select a project'") + " → " + chalk.green("'New Project'"));
  console.log("  3. Name it " + chalk.green("'gwork-cli'") + " (or anything you like)");
  console.log("  4. Click " + chalk.green("'Create'") + "\n");

  console.log(chalk.bold("Step 2: Enable Required APIs"));
  console.log("  1. Go to: " + chalk.blue.underline("https://console.cloud.google.com/apis/library"));
  console.log("  2. Search for and enable:");
  console.log("     • " + chalk.green("Google Calendar API"));
  console.log("     • " + chalk.green("Gmail API"));
  console.log("  3. Click " + chalk.green("'Enable'") + " for each\n");

  console.log(chalk.bold("Step 3: Create OAuth Credentials"));
  console.log("  1. Go to: " + chalk.blue.underline("https://console.cloud.google.com/apis/credentials"));
  console.log("  2. Click " + chalk.green("'Create Credentials'") + " → " + chalk.green("'OAuth client ID'"));
  console.log("  3. If prompted, configure OAuth consent screen:");
  console.log("     • User Type: " + chalk.green("External"));
  console.log("     • App name: " + chalk.green("gwork-cli"));
  console.log("     • User support email: " + chalk.green("your-email@gmail.com"));
  console.log("     • Developer contact: " + chalk.green("your-email@gmail.com"));
  console.log("     • Click " + chalk.green("'Save and Continue'"));
  console.log("     • Scopes: " + chalk.yellow("Skip this step (click 'Save and Continue')"));
  console.log("     • Test users: Add " + chalk.green("your-email@gmail.com"));
  console.log("     • Click " + chalk.green("'Save and Continue'"));
  console.log("  4. Back to Create OAuth client ID:");
  console.log("     • Application type: " + chalk.green("Desktop app"));
  console.log("     • Name: " + chalk.green("gwork-cli"));
  console.log("     • Click " + chalk.green("'Create'"));
  console.log("  5. Click " + chalk.green("'Download JSON'") + " (not just copying the IDs)\n");

  console.log(chalk.bold("Step 4: Save Credentials"));
  console.log("  1. Save the downloaded JSON file as:");
  console.log("     " + chalk.green(CREDENTIALS_PATH));
  console.log("  2. Make sure the file looks like this:");
  console.log(chalk.gray(`     {
       "installed": {
         "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
         "client_secret": "YOUR_CLIENT_SECRET",
         "redirect_uris": ["http://localhost"],
         ...
       }
     }`));
  console.log("");

  console.log(chalk.bold.yellow("⚠️  Important Notes:"));
  console.log("  • The app will be in " + chalk.yellow('"testing" mode') + " - this is normal!");
  console.log("  • You can add up to 100 test users while in testing mode");
  console.log("  • You'll see a " + chalk.yellow('"Google hasn\'t verified this app"') + " warning - click " + chalk.green('"Continue"'));
  console.log("  • This is your personal app, so it's safe to continue\n");

  console.log(chalk.bold.green("✨ Once you've saved the credentials file, run your command again!\n"));

  console.log(chalk.gray("Need more help? Check the README or visit:"));
  console.log(chalk.gray("https://developers.google.com/calendar/api/quickstart/nodejs"));
  console.log(chalk.gray("https://developers.google.com/gmail/api/quickstart/nodejs\n"));

  console.log(chalk.bold.cyan("=".repeat(80)) + "\n");
}

export function validateCredentialsFile(): { valid: boolean; error?: string } {
  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, "utf8");
    const credentials = JSON.parse(content);

    // Check for the correct structure
    if (!credentials.installed && !credentials.web) {
      return {
        valid: false,
        error: "Credentials file must contain 'installed' or 'web' configuration",
      };
    }

    const config = credentials.installed || credentials.web;

    if (!config.client_id) {
      return { valid: false, error: "Missing 'client_id' in credentials file" };
    }

    if (!config.client_secret) {
      return { valid: false, error: "Missing 'client_secret' in credentials file" };
    }

    return { valid: true };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return { valid: false, error: "Credentials file not found" };
    }
    return { valid: false, error: `Invalid JSON: ${error.message}` };
  }
}

export function ensureCredentialsExist(): boolean {
  if (checkCredentialsExist()) {
    const validation = validateCredentialsFile();
    if (validation.valid) {
      return true;
    } else {
      console.error(chalk.red(`\n❌ Error: ${validation.error}\n`));
      console.log(chalk.yellow("Your credentials file exists but is invalid.\n"));
      showSetupGuide();
      return false;
    }
  } else {
    showSetupGuide();
    return false;
  }
}
