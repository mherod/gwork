import chalk from "chalk";
import ora from "ora";
import type { Person, ContactGroup } from "../types/google-apis.ts";
import { ContactsService } from "../services/contacts-service.ts";
import { ensureInitialized } from "../utils/command-service.ts";
import { ArgumentError } from "../services/errors.ts";

export async function handleContactsCommand(
  subcommand: string,
  args: string[],
  account = "default"
) {
  // Create service instance with the specified account
  const contactsService = new ContactsService(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized(contactsService);

  switch (subcommand) {
    case "list":
      await listContacts(contactsService, args);
      break;
    case "get":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: resourceName is required", "gwork contacts get <resourceName>");
      }
      await getContact(contactsService, args[0], args.slice(1));
      break;
    case "search":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: search query is required", "gwork contacts search <query>");
      }
      await searchContacts(contactsService, args[0], args.slice(1));
      break;
    case "find-email":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: email is required", "gwork contacts find-email <email>");
      }
      await findContactByEmail(contactsService, args[0]);
      break;
    case "find-name":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: name is required", "gwork contacts find-name <name>");
      }
      await findContactByName(contactsService, args[0]);
      break;
    case "create":
      await createContact(contactsService, args);
      break;
    case "update":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: resourceName is required", "gwork contacts update <resourceName> [options]");
      }
      await updateContact(contactsService, args[0], args.slice(1));
      break;
    case "delete":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: resourceName is required", "gwork contacts delete <resourceName> --confirm");
      }
      await deleteContact(contactsService, args[0], args.slice(1));
      break;
    case "groups":
      await listGroups(contactsService, args);
      break;
    case "group-contacts":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: groupResourceName is required", "gwork contacts group-contacts <groupResourceName>");
      }
      await getContactsInGroup(contactsService, args[0], args.slice(1));
      break;
    case "create-group":
      if (args.length === 0) {
        throw new ArgumentError("Error: group name is required", "gwork contacts create-group <name> --confirm");
      }
      await createGroup(contactsService, args[0]!, args.slice(1));
      break;
    case "delete-group":
      if (args.length === 0 || !args[0]) {
        throw new ArgumentError("Error: groupResourceName is required", "gwork contacts delete-group <groupResourceName> --confirm");
      }
      await deleteGroup(contactsService, args[0], args.slice(1));
      break;
    case "add-to-group":
      if (args.length < 2) {
        throw new ArgumentError("Error: groupResourceName and at least one contactResourceName are required", "gwork contacts add-to-group <groupResourceName> <contactResourceName...> --confirm");
      }
      await addToGroup(contactsService, args[0]!, args.slice(1, -1), args.slice(-1));
      break;
    case "remove-from-group":
      if (args.length < 2) {
        throw new ArgumentError("Error: groupResourceName and at least one contactResourceName are required", "gwork contacts remove-from-group <groupResourceName> <contactResourceName...> --confirm");
      }
      await removeFromGroup(contactsService, args[0]!, args.slice(1, -1), args.slice(-1));
      break;
    case "batch-create":
      if (args.length === 0) {
        throw new ArgumentError("Error: JSON file path is required", "gwork contacts batch-create <jsonFile> --confirm");
      }
      await batchCreateContacts(contactsService, args[0]!, args.slice(1));
      break;
    case "batch-delete":
      if (args.length === 0) {
        throw new ArgumentError("Error: at least one resourceName is required", "gwork contacts batch-delete <resourceName...> --confirm");
      }
      await batchDeleteContacts(contactsService, args);
      break;
    case "profile":
      await getProfile(contactsService, args);
      break;
    case "stats":
      await getStats(contactsService, args);
      break;
    case "duplicates":
      await findDuplicates(contactsService, args);
      break;
    case "merge":
      if (args.length < 2) {
        throw new ArgumentError("Error: At least two resource names are required", "gwork contacts merge <targetResourceName> <sourceResourceName...> --confirm");
      }
      await mergeContacts(contactsService, args[0]!, args.slice(1, -1), args.slice(-1));
      break;
    case "auto-merge":
      await autoMergeContacts(contactsService, args);
      break;
    case "find-missing-names":
      await findMissingNames(contactsService, args);
      break;
    case "analyze-generic-names":
      await analyzeGenericNames(contactsService, args);
      break;
    case "analyze-imported":
      await analyzeImportedContacts(contactsService, args);
      break;
    case "detect-marketing":
      await detectMarketing(contactsService, args);
      break;
    default:
      throw new ArgumentError(`Unknown contacts subcommand: ${subcommand}`, "gwork contacts --help");
  }
}

async function listContacts(contactsService: ContactsService, args: string[]) {
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
        const value = args[++i]!;
        if (value) options.max = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
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
    throw error;
  }
}

async function getContact(contactsService: ContactsService, resourceName: string, args: string[]) {
  const spinner = ora("Fetching contact...").start();
  try {
    const options: { format: string } = { format: "full" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
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

      if (contact.biographies && contact.biographies.length > 0 && contact.biographies[0]?.value) {
        console.log(`\n${chalk.cyan("Biography:")}`);
        console.log(contact.biographies[0].value);
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch contact");
    throw error;
  }
}

async function searchContacts(contactsService: ContactsService, query: string, args: string[]) {
  const spinner = ora("Searching contacts...").start();
  try {
    const options: { max: number; format: string } = { max: 50, format: "table" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max") {
        const value = args[++i]!;
        if (value) options.max = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
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
    throw error;
  }
}

async function findContactByEmail(contactsService: ContactsService, email: string) {
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
    throw error;
  }
}

async function findContactByName(contactsService: ContactsService, name: string) {
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
    throw error;
  }
}

async function createContact(contactsService: ContactsService, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts create [options] --confirm");
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
        const value = args[++i]!;
        if (value) options.firstName = value;
      } else if (arg === "--last-name") {
        const value = args[++i]!;
        if (value) options.lastName = value;
      } else if (arg === "--email") {
        const value = args[++i]!;
        if (value) options.email = value;
      } else if (arg === "--phone") {
        const value = args[++i]!;
        if (value) options.phone = value;
      } else if (arg === "--organization") {
        const value = args[++i]!;
        if (value) options.organization = value;
      } else if (arg === "--job-title") {
        const value = args[++i]!;
        if (value) options.jobTitle = value;
      }
    }

    if (!options.firstName && !options.lastName && !options.email) {
      spinner.fail("Missing required options");
      throw new ArgumentError("At least one of --first-name, --last-name, or --email is required", "gwork contacts create [--first-name NAME] [--last-name NAME] [--email EMAIL] --confirm");
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
    throw error;
  }
}

async function updateContact(contactsService: ContactsService, resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts update <resourceName> [options] --confirm");
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
        const value = args[++i]!;
        if (value) options.firstName = value;
      } else if (arg === "--last-name") {
        const value = args[++i]!;
        if (value) options.lastName = value;
      } else if (arg === "--email") {
        const value = args[++i]!;
        if (value) options.email = value;
      } else if (arg === "--phone") {
        const value = args[++i]!;
        if (value) options.phone = value;
      } else if (arg === "--organization") {
        const value = args[++i]!;
        if (value) options.organization = value;
      } else if (arg === "--job-title") {
        const value = args[++i]!;
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
    throw error;
  }
}

async function deleteContact(contactsService: ContactsService, resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts delete <resourceName> --confirm");
  }

  const spinner = ora("Deleting contact...").start();
  try {
    await contactsService.deleteContact(resourceName);

    spinner.succeed("Contact deleted successfully");
    console.log(chalk.green("Contact has been deleted"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete contact");
    throw error;
  }
}

async function listGroups(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Fetching contact groups...").start();
  try {
    const options: { format: string } = { format: "table" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
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
    throw error;
  }
}

async function createGroup(contactsService: ContactsService, name: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts create-group <name> --confirm");
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
    throw error;
  }
}

async function deleteGroup(contactsService: ContactsService, resourceName: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts delete-group <groupResourceName> --confirm");
  }

  const spinner = ora("Deleting contact group...").start();
  try {
    await contactsService.deleteContactGroup(resourceName);

    spinner.succeed("Contact group deleted successfully");
    console.log(chalk.green("Contact group has been deleted"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete contact group");
    throw error;
  }
}

async function getContactsInGroup(contactsService: ContactsService, groupResourceName: string, _args: string[]) {
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
    throw error;
  }
}

async function addToGroup(contactsService: ContactsService, groupResourceName: string, contactResourceNames: string[], confirmArgs: string[]) {
  const confirm = confirmArgs.includes("--confirm") || confirmArgs[0] === "--confirm";

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts add-to-group <groupResourceName> <contactResourceName...> --confirm");
  }

  const spinner = ora("Adding contacts to group...").start();
  try {
    const result = await contactsService.addContactsToGroup(groupResourceName, contactResourceNames);

    spinner.succeed(`Added ${result.addedContacts} contact(s) to group`);
    console.log(chalk.green("Contacts have been added to group"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to add contacts to group");
    throw error;
  }
}

async function removeFromGroup(contactsService: ContactsService, groupResourceName: string, contactResourceNames: string[], confirmArgs: string[]) {
  const confirm = confirmArgs.includes("--confirm") || confirmArgs[0] === "--confirm";

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts remove-from-group <groupResourceName> <contactResourceName...> --confirm");
  }

  const spinner = ora("Removing contacts from group...").start();
  try {
    const result = await contactsService.removeContactsFromGroup(groupResourceName, contactResourceNames);

    spinner.succeed(`Removed ${result.removedContacts} contact(s) from group`);
    console.log(chalk.green("Contacts have been removed from group"));

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to remove contacts from group");
    throw error;
  }
}

async function batchCreateContacts(contactsService: ContactsService, jsonFile: string, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts batch-create <jsonFile> --confirm");
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
      console.log(chalk.cyan(name));
    });

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to batch create contacts");
    throw error;
  }
}

async function batchDeleteContacts(contactsService: ContactsService, args: string[]) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts batch-delete <resourceName...> --confirm");
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
    throw error;
  }
}

async function getProfile(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Fetching your profile...").start();
  try {
    const options: { format: string } = { format: "full" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
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
    throw error;
  }
}

async function getStats(contactsService: ContactsService, _args: string[]) {
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
    throw error;
  }
}

async function mergeContacts(contactsService: ContactsService, targetResourceName: string, sourceResourceNames: string[], confirmArgs: string[]) {
  const confirm = confirmArgs.includes("--confirm") || confirmArgs[0] === "--confirm";

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts merge <targetResourceName> <sourceResourceName...> --confirm");
  }

  const spinner = ora("Merging contacts...").start();
  try {
    const result = await contactsService.mergeContacts(
      sourceResourceNames,
      targetResourceName,
      { deleteAfterMerge: true }
    );

    spinner.succeed("Contacts merged successfully");

    console.log(chalk.bold("\nMerge Results:"));
    console.log("─".repeat(80));
    const mergedName = result.mergedContact.names?.[0]?.displayName || "No name";
    console.log(`${chalk.cyan("Target Contact:")} ${mergedName}`);
    console.log(`${chalk.cyan("Resource Name:")} ${result.mergedContact.resourceName}`);
    console.log(`${chalk.cyan("Source Contacts:")} ${result.sourceContacts.length}`);

    if (result.deletedContacts.length > 0) {
      console.log(`${chalk.cyan("Deleted Contacts:")} ${result.deletedContacts.length}`);
    }

    console.log(chalk.bold("\nMerged Contact Details:"));
    console.log(`${chalk.cyan("Emails:")} ${result.mergedContact.emailAddresses?.length || 0}`);
    console.log(`${chalk.cyan("Phones:")} ${result.mergedContact.phoneNumbers?.length || 0}`);
    console.log(`${chalk.cyan("Addresses:")} ${result.mergedContact.addresses?.length || 0}`);

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to merge contacts");
    throw error;
  }
}

async function autoMergeContacts(contactsService: ContactsService, args: string[]) {
  const dryRun = !args.includes("--confirm");
  const confirm = args.includes("--confirm");

  if (!confirm && !dryRun) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork contacts auto-merge [--confirm]");
  }

  const spinner = ora("Analyzing contacts for auto-merge...").start();
  try {
    const options: {
      criteria: string[];
      threshold: number;
      maxResults: number;
    } = {
      criteria: ["email"],
      threshold: 95,
      maxResults: 1000,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "--criteria" || arg === "-c") {
        const value = args[++i]!;
        if (value) options.criteria = value.split(",").map((c) => c.trim());
      } else if (arg === "--threshold" || arg === "-t") {
        const value = args[++i]!;
        if (value) options.threshold = parseInt(value);
      } else if (arg === "--max-results" || arg === "-n") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      }
    }

    const result = await contactsService.autoMergeDuplicates({
      criteria: options.criteria,
      threshold: options.threshold,
      maxResults: options.maxResults,
      dryRun: dryRun,
    });

    if (dryRun) {
      spinner.succeed(
        `Found ${result.mergeOperations} merge operations in duplicates`
      );

      console.log(chalk.bold("\nAuto-Merge Preview:"));
      console.log("─".repeat(80));
      console.log(`${chalk.cyan("Merge Operations:")} ${result.mergeOperations}`);

      if (result.mergeOperations === 0) {
        console.log(chalk.green("No duplicates to merge!"));
      } else {
        console.log(
          chalk.yellow(
            `\nRe-run with --confirm to execute these ${result.mergeOperations} merge operation(s)`
          )
        );
      }
    } else {
      spinner.succeed(`Executed ${result.mergeOperations} merge operations`);

      console.log(chalk.bold("\nAuto-Merge Results:"));
      console.log("─".repeat(80));
      console.log(`${chalk.cyan("Merge Operations:")} ${result.mergeOperations}`);

      if (result.results) {
        const successful = result.results.filter((r) => r.success).length;
        const failed = result.results.filter((r) => !r.success).length;

        console.log(`${chalk.cyan("Successful:")} ${chalk.green(successful)}`);
        if (failed > 0) {
          console.log(`${chalk.cyan("Failed:")} ${chalk.red(failed)}`);

          console.log(chalk.bold("\nFailed Operations:"));
          result.results
            .filter((r) => !r.success)
            .forEach((r, index) => {
              console.log(`${index + 1}. ${r.target}: ${r.error || "Unknown error"}`);
            });
        }
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to auto-merge contacts");
    throw error;
  }
}

async function findDuplicates(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Searching for duplicate contacts...").start();
  try {
    const options: {
      criteria: string[];
      threshold: number;
      maxResults: number;
      format: string;
      showDetails: boolean;
    } = {
      criteria: ["email", "phone", "name"],
      threshold: 80,
      maxResults: 1000,
      format: "table",
      showDetails: false,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "--criteria" || arg === "-c") {
        const value = args[++i]!;
        if (value) options.criteria = value.split(",").map((c) => c.trim());
      } else if (arg === "--threshold" || arg === "-t") {
        const value = args[++i]!;
        if (value) options.threshold = parseInt(value);
      } else if (arg === "--max-results" || arg === "-n") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
        if (value) options.format = value;
      } else if (arg === "--show-details") {
        options.showDetails = true;
      }
    }

    const result = await contactsService.findDuplicates({
      criteria: options.criteria,
      threshold: options.threshold,
      maxResults: options.maxResults,
    });

    spinner.succeed(
      `Found ${result.totalDuplicates} duplicate group(s) in ${result.totalContacts} contact(s)`
    );

    if (result.totalDuplicates === 0) {
      console.log(chalk.green("\n🎉 No duplicates found! Your contacts are clean."));
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else if (options.showDetails) {
      // Detailed format
      console.log(chalk.bold("\nDuplicate Analysis:"));
      console.log("─".repeat(80));
      console.log(`${chalk.cyan("Total Contacts Analyzed:")} ${result.totalContacts}`);
      console.log(`${chalk.cyan("Duplicate Groups Found:")} ${result.totalDuplicates}`);
      console.log("");

      result.duplicates.forEach((group, index) => {
        console.log(
          chalk.bold(
            `\n${index + 1}. ${group.type.toUpperCase()} Duplicate Group`
          )
        );
        console.log(`${chalk.cyan("Match Value:")} ${group.value}`);
        console.log(
          `${chalk.cyan("Confidence:")} ${group.confidence}%`
        );
        console.log(`${chalk.cyan("Contacts:")} ${group.contacts.length}`);
        console.log("─".repeat(60));

        group.contacts.forEach((contact, contactIndex) => {
          const name = contact.names?.[0]?.displayName || "No name";
          console.log(`  ${contactIndex + 1}. ${chalk.yellow(name)}`);
          console.log(`     ${chalk.gray("Resource:")} ${contact.resourceName}`);
          if (contact.emailAddresses?.[0]) {
            console.log(
              `     ${chalk.gray("Email:")} ${contact.emailAddresses[0].value}`
            );
          }
          if (contact.phoneNumbers?.[0]) {
            console.log(
              `     ${chalk.gray("Phone:")} ${contact.phoneNumbers[0].value}`
            );
          }
          if (contact.organizations?.[0]) {
            console.log(
              `     ${chalk.gray("Org:")} ${contact.organizations[0].name}`
            );
          }
        });
      });
    } else {
      // Table format
      console.log(chalk.bold("\nDuplicate Groups:"));
      console.log("─".repeat(100));
      console.log(
        `${chalk.cyan("Type".padEnd(8))} ${chalk.cyan("Match Value".padEnd(25))} ${chalk.cyan("Confidence".padEnd(10))} ${chalk.cyan("Count".padEnd(8))} ${chalk.cyan("Contacts")}`
      );
      console.log("─".repeat(100));

      result.duplicates.forEach((group) => {
        const type = group.type.padEnd(8);
        const value = group.value.substring(0, 24).padEnd(25);
        const confidence = `${group.confidence}%`.padEnd(10);
        const count = group.contacts.length.toString().padEnd(8);
        const names = group.contacts
          .map((c) => c.names?.[0]?.displayName || "No name")
          .join(", ")
          .substring(0, 40);

        console.log(
          `${chalk.yellow(type)} ${chalk.white(value)} ${chalk.green(confidence)} ${chalk.blue(count)} ${chalk.gray(names)}`
        );
      });

      console.log(
        `\n${chalk.yellow("💡 Use --show-details to see full contact information for each group")}`
      );
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to search for duplicates");
    throw error;
  }
}

async function findMissingNames(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Finding contacts with missing names...").start();
  try {
    const options: { maxResults: number; format: string } = {
      maxResults: 100,
      format: "table",
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max-results") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
        if (value) options.format = value;
      }
    }

    const result = await contactsService.findContactsWithMissingNames({
      pageSize: options.maxResults,
    });

    spinner.succeed(
      `Found ${result.contactsWithIssues} contact(s) with missing names`
    );

    if (result.contactsWithIssues === 0) {
      console.log(
        chalk.green("\n🎉 All contacts have proper names!")
      );
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold("\nContacts with Missing Names:"));
      console.log("─".repeat(100));

      result.contacts.forEach((contact, index) => {
        console.log(`\n${index + 1}. ${chalk.cyan(contact.displayName)}`);
        console.log(`   ${chalk.gray("Resource:")} ${contact.resourceName}`);
        console.log(`   ${chalk.gray("Email:")} ${contact.email || "N/A"}`);
        console.log(`   ${chalk.gray("Phone:")} ${contact.phone || "N/A"}`);
        console.log(`   ${chalk.red("Issue:")} ${contact.issueType}`);

        if (contact.surnameHints.length > 0) {
          console.log(`   ${chalk.yellow("Surname Hints:")}`);
          contact.surnameHints.forEach((hint) => {
            console.log(`     • ${hint}`);
          });
        }
      });

      console.log(
        chalk.yellow(
          "\n💡 Use the update command to fix these names with proper first/last names"
        )
      );
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to find missing names");
    throw error;
  }
}

async function analyzeGenericNames(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Analyzing contacts with generic names...").start();
  try {
    const options: { maxResults: number; format: string } = {
      maxResults: 100,
      format: "table",
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max-results") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
        if (value) options.format = value;
      }
    }

    const result = await contactsService.findContactsWithGenericNames({
      pageSize: options.maxResults,
    });

    spinner.succeed(
      `Found ${result.contactsWithGenericNames} contact(s) with generic names`
    );

    if (result.contactsWithGenericNames === 0) {
      console.log(
        chalk.green("\n🎉 No contacts with generic names found!")
      );
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold("\nContacts with Generic Surnames:"));
      console.log("─".repeat(100));

      result.contacts.forEach((contact, index) => {
        console.log(`\n${index + 1}. ${chalk.cyan(contact.displayName)}`);
        console.log(`   ${chalk.gray("Resource:")} ${contact.resourceName}`);
        console.log(`   ${chalk.gray("Email:")} ${contact.email || "N/A"}`);
        console.log(`   ${chalk.gray("Phone:")} ${contact.phone || "N/A"}`);
        console.log(`   ${chalk.gray("Organization:")} ${contact.organization || "N/A"}`);

        if (contact.surnameHints.length > 0) {
          console.log(`   ${chalk.yellow("Surname Suggestions:")}`);
          contact.surnameHints.forEach((hint) => {
            console.log(`     • ${hint}`);
          });
        }
      });

      console.log(
        chalk.yellow(
          "\n💡 Use the update command to fix these names with better surnames"
        )
      );
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to analyze generic names");
    throw error;
  }
}

async function analyzeImportedContacts(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Analyzing imported contacts...").start();
  try {
    const options: { maxResults: number; format: string } = {
      maxResults: 100,
      format: "table",
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max-results") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
        if (value) options.format = value;
      }
    }

    const result = await contactsService.analyzeImportedContacts({
      pageSize: options.maxResults,
    });

    spinner.succeed(
      `Found ${result.importedContacts} potential imported contact(s)`
    );

    if (result.importedContacts === 0) {
      console.log(
        chalk.green("\n🎉 No problematic imported contacts found!")
      );
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold("\nImported Contacts Analysis:"));
      console.log("─".repeat(100));

      // Group by issue type
      const groupedContacts: Record<string, typeof result.contacts> = {};
      result.contacts.forEach((contact) => {
        if (!groupedContacts[contact.issueType]) {
          groupedContacts[contact.issueType] = [];
        }
        groupedContacts[contact.issueType]!.push(contact);
      });

      Object.keys(groupedContacts).forEach((issueType) => {
        console.log(
          chalk.yellow(
            `\n${issueType} (${groupedContacts[issueType]!.length} contacts):`
          )
        );
        groupedContacts[issueType]!.forEach((contact, index) => {
          const confidence = `${contact.confidence}%`;
          console.log(
            `  ${(index + 1).toString().padEnd(3)} ${chalk.cyan(contact.displayName.padEnd(30))} ${chalk.gray(`[${confidence}]`)}`
          );
          console.log(`      ${chalk.gray("Email:")} ${contact.email || "N/A"}`);
          console.log(`      ${chalk.gray("Resource:")} ${contact.resourceName}`);
        });
      });

      console.log(
        chalk.yellow(
          "\n💡 Consider cleaning up these contacts or organizing them into appropriate groups"
        )
      );
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to analyze imported contacts");
    throw error;
  }
}

async function detectMarketing(contactsService: ContactsService, args: string[]) {
  const spinner = ora("Detecting marketing contacts...").start();
  try {
    const options: {
      maxResults: number;
      format: string;
      cleanup: boolean;
      confirm: boolean;
    } = {
      maxResults: 200,
      format: "table",
      cleanup: false,
      confirm: false,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg === "-n" || arg === "--max-results") {
        const value = args[++i]!;
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i]!;
        if (value) options.format = value;
      } else if (arg === "--cleanup") {
        options.cleanup = true;
      } else if (arg === "--confirm") {
        options.confirm = true;
      }
    }

    const result = await contactsService.detectMarketingContacts({
      pageSize: options.maxResults,
    });

    spinner.succeed(
      `Found ${result.marketingContacts} marketing contact(s)`
    );

    if (result.marketingContacts === 0) {
      console.log(
        chalk.green("\n🎉 No marketing contacts found!")
      );
      process.exit(0);
    }

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold("\nDetected Marketing Contacts:"));
      console.log("─".repeat(120));
      console.log(
        `${chalk.cyan("Name".padEnd(25))} ${chalk.cyan("Email".padEnd(35))} ${chalk.cyan("Confidence".padEnd(12))} ${chalk.cyan("Reasons")}`
      );
      console.log("─".repeat(120));

      result.contacts.forEach((contact) => {
        const name = contact.displayName.substring(0, 24).padEnd(25);
        const email = (contact.email || "No email").substring(0, 34).padEnd(35);
        const confidence = `${contact.confidence}%`.padEnd(12);
        const reasons = contact.detectionReasons.join("; ");

        console.log(
          `${chalk.yellow(name)} ${chalk.white(email)} ${chalk.red(confidence)} ${chalk.gray(reasons)}`
        );
      });

      if (options.cleanup) {
        if (!options.confirm) {
          throw new ArgumentError("--confirm flag required for cleanup (this is destructive!)", "gwork contacts detect-marketing --cleanup --confirm");
        }

        // Perform cleanup
        const cleanupSpinner = ora(
          `Deleting ${result.marketingContacts} contact(s)...`
        ).start();
        try {
          const cleanupResult = await contactsService.cleanupMarketingContacts(
            result.contacts.map((c) => ({ resourceName: c.resourceName }))
          );

          cleanupSpinner.succeed("Cleanup completed");

          console.log(chalk.bold("\nCleanup Results:"));
          console.log("─".repeat(80));
          console.log(
            `${chalk.green("Deleted:")} ${cleanupResult.deleted}/${result.marketingContacts}`
          );

          if (cleanupResult.failed > 0) {
            console.log(`${chalk.red("Failed:")} ${cleanupResult.failed}`);

            if (cleanupResult.failedContacts.length > 0) {
              console.log(chalk.bold("\nFailed Deletions:"));
              cleanupResult.failedContacts.forEach((contact, index) => {
                console.log(
                  `${index + 1}. ${contact.resourceName}: ${contact.error}`
                );
              });
            }
          }
        } catch (cleanupError: unknown) {
          cleanupSpinner.fail("Cleanup failed");
          throw cleanupError;
        }
      } else {
        console.log(
          chalk.yellow(
            "\n💡 Use --cleanup --confirm to delete these marketing contacts"
          )
        );
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to detect marketing contacts");
    throw error;
  }
}
