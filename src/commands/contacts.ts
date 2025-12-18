import chalk from "chalk";
import ora from "ora";
import type { Person, ContactGroup } from "../types/google-apis.ts";
import { ContactsService } from "../services/contacts-service.ts";

// Module-level service instance (set by handleContactsCommand)
let contactsService: ContactsService;

// Helper to ensure service is initialized (checks credentials)
async function ensureInitialized() {
  await contactsService.initialize();
}

export async function handleContactsCommand(
  subcommand: string,
  args: string[],
  account: string = "default"
) {
  // Create service instance with the specified account
  contactsService = new ContactsService(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized();

  switch (subcommand) {
    case "list":
      await listContacts(args);
      break;
    case "get":
      if (args.length === 0 || !args[0]) {
        console.error("Error: resourceName is required");
        console.error("Usage: gwork contacts get <resourceName>");
        process.exit(1);
      }
      await getContact(args[0], args.slice(1));
      break;
    case "search":
      if (args.length === 0 || !args[0]) {
        console.error("Error: search query is required");
        console.error("Usage: gwork contacts search <query>");
        process.exit(1);
      }
      await searchContacts(args[0], args.slice(1));
      break;
    case "find-email":
      if (args.length === 0 || !args[0]) {
        console.error("Error: email is required");
        console.error("Usage: gwork contacts find-email <email>");
        process.exit(1);
      }
      await findContactByEmail(args[0]);
      break;
    case "find-name":
      if (args.length === 0 || !args[0]) {
        console.error("Error: name is required");
        console.error("Usage: gwork contacts find-name <name>");
        process.exit(1);
      }
      await findContactByName(args[0]);
      break;
    case "create":
      await createContact(args);
      break;
    case "update":
      if (args.length === 0 || !args[0]) {
        console.error("Error: resourceName is required");
        console.error("Usage: gwork contacts update <resourceName> [options]");
        process.exit(1);
      }
      await updateContact(args[0], args.slice(1));
      break;
    case "delete":
      if (args.length === 0 || !args[0]) {
        console.error("Error: resourceName is required");
        console.error("Usage: gwork contacts delete <resourceName> --confirm");
        process.exit(1);
      }
      await deleteContact(args[0], args.slice(1));
      break;
    case "groups":
      await listGroups(args);
      break;
    case "group-contacts":
      if (args.length === 0 || !args[0]) {
        console.error("Error: groupResourceName is required");
        console.error("Usage: gwork contacts group-contacts <groupResourceName>");
        process.exit(1);
      }
      await getContactsInGroup(args[0], args.slice(1));
      break;
    case "create-group":
      if (args.length === 0) {
        console.error("Error: group name is required");
        console.error("Usage: gwork contacts create-group <name> --confirm");
        process.exit(1);
      }
      await createGroup(args[0], args.slice(1));
      break;
    case "delete-group":
      if (args.length === 0 || !args[0]) {
        console.error("Error: groupResourceName is required");
        console.error("Usage: gwork contacts delete-group <groupResourceName> --confirm");
        process.exit(1);
      }
      await deleteGroup(args[0], args.slice(1));
      break;
    case "add-to-group":
      if (args.length < 2) {
        console.error("Error: groupResourceName and at least one contactResourceName are required");
        console.error("Usage: gwork contacts add-to-group <groupResourceName> <contactResourceName...> --confirm");
        process.exit(1);
      }
      await addToGroup(args[0], args.slice(1, -1), args.slice(-1));
      break;
    case "remove-from-group":
      if (args.length < 2) {
        console.error("Error: groupResourceName and at least one contactResourceName are required");
        console.error("Usage: gwork contacts remove-from-group <groupResourceName> <contactResourceName...> --confirm");
        process.exit(1);
      }
      await removeFromGroup(args[0], args.slice(1, -1), args.slice(-1));
      break;
    case "batch-create":
      if (args.length === 0) {
        console.error("Error: JSON file path is required");
        console.error("Usage: gwork contacts batch-create <jsonFile> --confirm");
        process.exit(1);
      }
      await batchCreateContacts(args[0], args.slice(1));
      break;
    case "batch-delete":
      if (args.length === 0) {
        console.error("Error: at least one resourceName is required");
        console.error("Usage: gwork contacts batch-delete <resourceName...> --confirm");
        process.exit(1);
      }
      await batchDeleteContacts(args);
      break;
    case "profile":
      await getProfile(args);
      break;
    case "stats":
      await getStats(args);
      break;
    case "duplicates":
      await findDuplicates(args);
      break;
    case "find-missing-names":
      await findMissingNames(args);
      break;
    case "analyze-generic-names":
      await analyzeGenericNames(args);
      break;
    case "analyze-imported":
      await analyzeImportedContacts(args);
      break;
    case "detect-marketing":
      await detectMarketing(args);
      break;
    default:
      console.error(`Unknown contacts subcommand: ${subcommand}`);
      console.error("Run 'gwork contacts --help' for usage information");
      process.exit(1);
  }
}

async function listContacts(args: string[]) {
  const spinner = ora("Fetching contacts...").start();
  try {
    const options: {
      max: number;
      format: string;
    } = {
      max: 50,
      format: "table",
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max") {
        const value = args[++i];
        if (value) options.max = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const contacts = await contactsService.listContacts({ pageSize: options.max });

    spinner.succeed(`Found ${contacts.length} contact(s)`);

    if (contacts.length === 0) {
      console.log(chalk.yellow("No contacts found"));
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(contacts, null, 2));
    } else {
      console.log(chalk.bold("\nContacts:"));
      console.log("─".repeat(80));
      contacts.forEach((contact: Person, index: number) => {
        const name = contact.names?.[0]?.displayName || "No name";
        const email = contact.emailAddresses?.[0]?.value || "";
        const phone = contact.phoneNumbers?.[0]?.value || "";

        console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(name)}`);
        if (email) console.log(`   ${chalk.gray("Email:")} ${email}`);
        if (phone) console.log(`   ${chalk.gray("Phone:")} ${phone}`);
        if (contact.organizations?.[0]?.name) {
          console.log(`   ${chalk.gray("Organization:")} ${contact.organizations[0].name}`);
        }
      });
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch contacts");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getContact(resourceName: string, args: string[]) {
  const spinner = ora("Fetching contact...").start();
  try {
    const options: { format: string } = { format: "full" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const contact = await contactsService.getContact(resourceName);

    spinner.succeed("Contact fetched successfully");

    if (options.format === "json") {
      console.log(JSON.stringify(contact, null, 2));
    } else {
      console.log(chalk.bold("\nContact Details:"));
      console.log("─".repeat(80));

      const name = contact.names?.[0]?.displayName || "No name";
      console.log(`${chalk.cyan("Name:")} ${name}`);

      if (contact.emailAddresses && contact.emailAddresses.length > 0) {
        console.log(`\n${chalk.cyan("Email Addresses:")}`);
        contact.emailAddresses.forEach((email, index) => {
          const primary = email.metadata?.primary ? " (Primary)" : "";
          console.log(`  ${index + 1}. ${email.value}${primary}`);
        });
      }

      if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
        console.log(`\n${chalk.cyan("Phone Numbers:")}`);
        contact.phoneNumbers.forEach((phone, index) => {
          const primary = phone.metadata?.primary ? " (Primary)" : "";
          console.log(`  ${index + 1}. ${phone.value}${primary}`);
        });
      }

      if (contact.organizations && contact.organizations.length > 0) {
        console.log(`\n${chalk.cyan("Organizations:")}`);
        contact.organizations.forEach((org, index) => {
          console.log(`  ${index + 1}. ${org.name}`);
          if (org.title) console.log(`     Title: ${org.title}`);
        });
      }

      if (contact.addresses && contact.addresses.length > 0) {
        console.log(`\n${chalk.cyan("Addresses:")}`);
        contact.addresses.forEach((addr, index) => {
          const primary = addr.metadata?.primary ? " (Primary)" : "";
          console.log(`  ${index + 1}. ${addr.formattedValue}${primary}`);
        });
      }

      if (contact.biographies && contact.biographies.length > 0) {
        console.log(`\n${chalk.cyan("Biography:")}`);
        console.log(contact.biographies[0].value);
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function searchContacts(query: string, args: string[]) {
  const spinner = ora("Searching contacts...").start();
  try {
    const options: { max: number; format: string } = { max: 50, format: "table" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max") {
        const value = args[++i];
        if (value) options.max = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const contacts = await contactsService.searchContacts(query, {
      pageSize: options.max,
    });

    spinner.succeed(`Found ${contacts.length} contact(s) matching "${query}"`);

    if (contacts.length === 0) {
      console.log(chalk.yellow("No contacts found"));
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(contacts, null, 2));
    } else {
      console.log(chalk.bold(`\nSearch Results for "${query}":`));
      console.log("─".repeat(80));
      contacts.forEach((contact: Person, index: number) => {
        const name = contact.names?.[0]?.displayName || "No name";
        const email = contact.emailAddresses?.[0]?.value || "";

        console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(name)}`);
        if (email) console.log(`   ${chalk.gray("Email:")} ${email}`);
      });
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Search failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function findContactByEmail(email: string) {
  const spinner = ora("Finding contact by email...").start();
  try {
    const contact = await contactsService.findContactByEmail(email);

    if (!contact) {
      spinner.fail(`No contact found with email: ${email}`);
      process.exit(0);
    }

    spinner.succeed("Contact found");

    console.log(chalk.bold("\nContact Found:"));
    console.log("─".repeat(80));

    const name = contact.names?.[0]?.displayName || "No name";
    console.log(`${chalk.cyan("Name:")} ${name}`);
    console.log(`${chalk.cyan("Email:")} ${email}`);

    if (contact.phoneNumbers?.[0]) {
      console.log(`${chalk.cyan("Phone:")} ${contact.phoneNumbers[0].value}`);
    }

    if (contact.organizations?.[0]) {
      console.log(`${chalk.cyan("Organization:")} ${contact.organizations[0].name}`);
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to find contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function findContactByName(name: string) {
  const spinner = ora("Finding contact by name...").start();
  try {
    const contact = await contactsService.findContactByName(name);

    if (!contact) {
      spinner.fail(`No contact found with name: ${name}`);
      process.exit(0);
    }

    spinner.succeed("Contact found");

    console.log(chalk.bold("\nContact Found:"));
    console.log("─".repeat(80));

    const displayName = contact.names?.[0]?.displayName || "No name";
    console.log(`${chalk.cyan("Name:")} ${displayName}`);

    if (contact.emailAddresses?.[0]) {
      console.log(`${chalk.cyan("Email:")} ${contact.emailAddresses[0].value}`);
    }

    if (contact.phoneNumbers?.[0]) {
      console.log(`${chalk.cyan("Phone:")} ${contact.phoneNumbers[0].value}`);
    }

    if (contact.organizations?.[0]) {
      console.log(`${chalk.cyan("Organization:")} ${contact.organizations[0].name}`);
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to find contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function createContact(args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Creating contact...").start();
  try {
    const options: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      organization?: string;
      jobTitle?: string;
    } = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "--first-name") {
        const value = args[++i];
        if (value) options.firstName = value;
      } else if (arg === "--last-name") {
        const value = args[++i];
        if (value) options.lastName = value;
      } else if (arg === "--email") {
        const value = args[++i];
        if (value) options.email = value;
      } else if (arg === "--phone") {
        const value = args[++i];
        if (value) options.phone = value;
      } else if (arg === "--organization") {
        const value = args[++i];
        if (value) options.organization = value;
      } else if (arg === "--job-title") {
        const value = args[++i];
        if (value) options.jobTitle = value;
      }
    }

    if (!options.firstName && !options.lastName && !options.email) {
      spinner.fail("Missing required options");
      console.error(chalk.red("At least one of --first-name, --last-name, or --email is required"));
      process.exit(1);
    }

    const contact = await contactsService.createContact(options);

    spinner.succeed("Contact created successfully");

    console.log(chalk.green("\nCreated Contact:"));
    console.log("─".repeat(80));
    const name = contact.names?.[0]?.displayName || "No name";
    console.log(`${chalk.cyan("Name:")} ${name}`);
    console.log(`${chalk.cyan("Resource Name:")} ${contact.resourceName}`);

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function updateContact(resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Updating contact...").start();
  try {
    const options: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      organization?: string;
      jobTitle?: string;
    } = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "--first-name") {
        const value = args[++i];
        if (value) options.firstName = value;
      } else if (arg === "--last-name") {
        const value = args[++i];
        if (value) options.lastName = value;
      } else if (arg === "--email") {
        const value = args[++i];
        if (value) options.email = value;
      } else if (arg === "--phone") {
        const value = args[++i];
        if (value) options.phone = value;
      } else if (arg === "--organization") {
        const value = args[++i];
        if (value) options.organization = value;
      } else if (arg === "--job-title") {
        const value = args[++i];
        if (value) options.jobTitle = value;
      }
    }

    const contact = await contactsService.updateContact(resourceName, options);

    spinner.succeed("Contact updated successfully");

    console.log(chalk.green("\nUpdated Contact:"));
    console.log("─".repeat(80));
    const name = contact.names?.[0]?.displayName || "No name";
    console.log(`${chalk.cyan("Name:")} ${name}`);
    console.log(`${chalk.cyan("Resource Name:")} ${contact.resourceName}`);

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to update contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function deleteContact(resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Deleting contact...").start();
  try {
    await contactsService.deleteContact(resourceName);

    spinner.succeed("Contact deleted successfully");
    console.log(chalk.green("Contact has been deleted"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete contact");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function listGroups(args: string[]) {
  const spinner = ora("Fetching contact groups...").start();
  try {
    const options: { format: string } = { format: "table" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const groups = await contactsService.getContactGroups();

    spinner.succeed(`Found ${groups.length} contact group(s)`);

    if (groups.length === 0) {
      console.log(chalk.yellow("No contact groups found"));
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(groups, null, 2));
    } else {
      console.log(chalk.bold("\nContact Groups:"));
      console.log("─".repeat(80));
      groups.forEach((group: ContactGroup, index: number) => {
        const name = group.name || "No name";
        const memberCount = (group.memberCount || 0).toString();

        console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(name)}`);
        console.log(`   ${chalk.gray("Members:")} ${memberCount}`);
        console.log(`   ${chalk.gray("Resource:")} ${group.resourceName}`);
      });
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch contact groups");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function createGroup(name: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Creating contact group...").start();
  try {
    const group = await contactsService.createContactGroup(name);

    spinner.succeed("Contact group created successfully");

    console.log(chalk.bold("\nCreated Group:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Name:")} ${group.name}`);
    console.log(`${chalk.cyan("Resource Name:")} ${group.resourceName}`);

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create contact group");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function deleteGroup(resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Deleting contact group...").start();
  try {
    await contactsService.deleteContactGroup(resourceName);

    spinner.succeed("Contact group deleted successfully");
    console.log(chalk.green("Contact group has been deleted"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete contact group");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getContactsInGroup(groupResourceName: string, args: string[]) {
  const spinner = ora("Fetching contacts in group...").start();
  try {
    const result = await contactsService.getContactsInGroup(groupResourceName);

    spinner.succeed(`Found ${result.contacts.length} contact(s) in group`);

    if (result.contacts.length === 0) {
      console.log(chalk.yellow("No contacts in this group"));
      process.exit(0);
    }

    console.log(chalk.bold("\nContacts in Group:"));
    console.log("─".repeat(80));
    result.contacts.forEach((contact: Person, index: number) => {
      const name = contact.names?.[0]?.displayName || "No name";
      const email = contact.emailAddresses?.[0]?.value || "";

      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(name)}`);
      if (email) console.log(`   ${chalk.gray("Email:")} ${email}`);
    });

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch contacts in group");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function addToGroup(groupResourceName: string, contactResourceNames: string[], confirmArgs: string[]) {
  const confirm = confirmArgs.includes("--confirm") || confirmArgs[0] === "--confirm";

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Adding contacts to group...").start();
  try {
    const result = await contactsService.addContactsToGroup(groupResourceName, contactResourceNames);

    spinner.succeed(`Added ${result.addedContacts} contact(s) to group`);
    console.log(chalk.green("Contacts have been added to group"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to add contacts to group");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function removeFromGroup(groupResourceName: string, contactResourceNames: string[], confirmArgs: string[]) {
  const confirm = confirmArgs.includes("--confirm") || confirmArgs[0] === "--confirm";

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Removing contacts from group...").start();
  try {
    const result = await contactsService.removeContactsFromGroup(groupResourceName, contactResourceNames);

    spinner.succeed(`Removed ${result.removedContacts} contact(s) from group`);
    console.log(chalk.green("Contacts have been removed from group"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to remove contacts from group");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function batchCreateContacts(jsonFile: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const spinner = ora("Creating contacts...").start();
  try {
    const fs = await import("node:fs");
    const contactsData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    if (!Array.isArray(contactsData)) {
      throw new Error("JSON file must contain an array of contact objects");
    }

    const results = await contactsService.batchCreateContacts(contactsData);

    spinner.succeed(`Created ${results.length} contact(s) successfully`);

    console.log(chalk.bold("\nCreated Contacts:"));
    console.log("─".repeat(80));
    results.forEach((contact) => {
      const name = contact.names?.[0]?.displayName || "No name";
      console.log(`${chalk.cyan(name)}`);
    });

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to batch create contacts");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function batchDeleteContacts(args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    console.log(chalk.yellow("Please use --confirm flag to confirm this operation"));
    process.exit(1);
  }

  const resourceNames = args.filter((arg) => arg !== "--confirm");

  const spinner = ora("Deleting contacts...").start();
  try {
    const result = await contactsService.batchDeleteContacts(resourceNames);

    spinner.succeed(`Deleted ${result.deletedContacts} contact(s) successfully`);
    console.log(chalk.green("Contacts have been deleted"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to batch delete contacts");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getProfile(args: string[]) {
  const spinner = ora("Fetching your profile...").start();
  try {
    const options: { format: string } = { format: "full" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const profile = await contactsService.getMyProfile();

    spinner.succeed("Profile fetched successfully");

    if (options.format === "json") {
      console.log(JSON.stringify(profile, null, 2));
    } else {
      console.log(chalk.bold("\nYour Profile:"));
      console.log("─".repeat(80));

      const name = profile.names?.[0]?.displayName || "No name";
      console.log(`${chalk.cyan("Name:")} ${name}`);

      if (profile.emailAddresses?.[0]) {
        console.log(`${chalk.cyan("Email:")} ${profile.emailAddresses[0].value}`);
      }

      if (profile.phoneNumbers?.[0]) {
        console.log(`${chalk.cyan("Phone:")} ${profile.phoneNumbers[0].value}`);
      }

      if (profile.organizations?.[0]) {
        console.log(`${chalk.cyan("Organization:")} ${profile.organizations[0].name}`);
        if (profile.organizations[0].title) {
          console.log(`${chalk.cyan("Job Title:")} ${profile.organizations[0].title}`);
        }
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch profile");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getStats(args: string[]) {
  const spinner = ora("Fetching contact statistics...").start();
  try {
    const contacts = await contactsService.listContacts({ pageSize: 10000 });
    const groups = await contactsService.getContactGroups();

    spinner.succeed("Statistics fetched successfully");

    const stats = {
      totalContacts: contacts.length,
      totalGroups: groups.length,
      contactsWithEmails: contacts.filter((c) => c.emailAddresses && c.emailAddresses.length > 0)
        .length,
      contactsWithPhones: contacts.filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0)
        .length,
      contactsWithPhotos: contacts.filter((c) => c.photos && c.photos.length > 0).length,
    };

    console.log(chalk.bold("\nContact Statistics:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Total Contacts:")} ${stats.totalContacts}`);
    console.log(`${chalk.cyan("Total Groups:")} ${stats.totalGroups}`);
    console.log(`${chalk.cyan("Contacts with Email:")} ${stats.contactsWithEmails}`);
    console.log(`${chalk.cyan("Contacts with Phone:")} ${stats.contactsWithPhones}`);
    console.log(`${chalk.cyan("Contacts with Photo:")} ${stats.contactsWithPhotos}`);

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch statistics");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function findDuplicates(args: string[]) {
  const spinner = ora("Searching for duplicate contacts...").start();
  try {
    spinner.succeed("Duplicate search feature coming soon");
    console.log(chalk.yellow("This feature will be implemented in the next phase"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to search for duplicates");
    process.exit(1);
  }
}

async function findMissingNames(args: string[]) {
  const spinner = ora("Finding contacts with missing names...").start();
  try {
    spinner.succeed("Missing names feature coming soon");
    console.log(chalk.yellow("This feature will be implemented in the next phase"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to find missing names");
    process.exit(1);
  }
}

async function analyzeGenericNames(args: string[]) {
  const spinner = ora("Analyzing contacts with generic names...").start();
  try {
    spinner.succeed("Generic names analysis coming soon");
    console.log(chalk.yellow("This feature will be implemented in the next phase"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to analyze generic names");
    process.exit(1);
  }
}

async function analyzeImportedContacts(args: string[]) {
  const spinner = ora("Analyzing imported contacts...").start();
  try {
    spinner.succeed("Imported contacts analysis coming soon");
    console.log(chalk.yellow("This feature will be implemented in the next phase"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to analyze imported contacts");
    process.exit(1);
  }
}

async function detectMarketing(args: string[]) {
  const spinner = ora("Detecting marketing contacts...").start();
  try {
    spinner.succeed("Marketing detection coming soon");
    console.log(chalk.yellow("This feature will be implemented in the next phase"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to detect marketing contacts");
    process.exit(1);
  }
}
