#!/usr/bin/env node

import { handleMailCommand } from "./commands/mail.ts";
import { handleCalCommand } from "./commands/cal.ts";
import { handleContactsCommand } from "./commands/contacts.ts";
import { parseAccount } from "./utils/args.ts";

function printHelp() {
  console.log(`
gwork - Swiss Army knife for Google Workspace

Usage:
  gwork <command> [options]

Commands:
  mail           Gmail operations
  cal            Google Calendar operations
  contacts       Google Contacts operations

Options:
  -h, --help              Show this help message
  -v, --version           Show version
  --account <email>       Use a specific Google account (default: "default")

Examples:
  gwork mail --help
  gwork cal --help
  gwork contacts --help
  gwork cal list --account matt@example.com
  gwork --help
`);
}

function printMailHelp() {
  console.log(`
gwork mail - Gmail operations

Usage:
  gwork mail <command> [options]

Commands:
  labels                                  List all Gmail labels
  messages [options]                      List messages with various filters
  get <messageId>                         Get a specific message by ID
  search <query>                          Search messages with Gmail search syntax
  stats                                   Show Gmail account statistics
  threads [options]                       List email threads/conversations
  thread <threadId>                       Get a specific thread/conversation
  unread [options]                        List unread messages
  starred [options]                       List starred messages
  important [options]                     List important messages
  drafts [options]                        List draft messages
  attachments <messageId>                 List attachments in a message
  download <messageId> <attachmentId>     Download an attachment from a message
  delete <messageId>                      Delete a specific message by ID
  delete-query <query>                    Delete messages matching a search query
  archive <messageId>                     Archive a specific message by ID
  archive-query <query>                   Archive messages matching a search query
  archive-many <messageIds...>            Archive multiple messages by their IDs
  unarchive <messageId>                   Unarchive a specific message by ID
  unarchive-query <query>                 Unarchive messages matching a search query
  unarchive-many <messageIds...>          Unarchive multiple messages by their IDs
  add-label <messageId> <labelName>       Add a label to a specific message
  remove-label <messageId> <labelName>    Remove a label from a specific message
  mark-read <messageId>                   Mark a specific message as read
  mark-unread <messageId>                 Mark a specific message as unread
  star <messageId>                        Star a specific message
  unstar <messageId>                      Remove star from a specific message
  create-label <labelName>                Create a new Gmail label
  delete-label <labelId>                  Delete a Gmail label

Options:
  -h, --help                              Show this help message
  --max-results <number>                  Maximum number of results to return (default: 10)

Examples:
  gwork mail messages
  gwork mail search "from:example@gmail.com"
  gwork mail unread
  gwork mail stats
`);
}

function printCalHelp() {
  console.log(`
gwork cal - Google Calendar operations

Usage:
  gwork cal <command> [options]

Commands:
  list [options]                          List events from a calendar
  get <calendarId> <eventId>              Get details of a specific event
  create <calendarId>                     Create a new event
  update <calendarId> <eventId>           Update an existing event
  delete <calendarId> <eventId>           Delete an event
  calendars [options]                     List available calendars
  search <query>                          Search for events
  freebusy <start> <end>                  Get free/busy information for a time range
  create-calendar <title>                 Create a new calendar
  bulk-update <calendarId>                Bulk update events matching criteria
  duplicate <calendarId> <eventId>        Duplicate an existing event
  stats [options]                         Get calendar statistics
  update-recurring <calendarId> <eventId> Update all instances of a recurring event
  export <calendarId>                     Export events to file (iCal, CSV, or JSON)
  batch-create <calendarId>               Create multiple events from a JSON file or stdin
  reminders <calendarId> <eventId>        Manage event reminders
  check-conflict <calendarId>             Check for scheduling conflicts
  quick [options]                         Quick actions for common operations
  compare <calendarId1> <calendarId2>     Compare events between two calendars
  color [calendarId] [eventId]            Set event color or list available colors
  recurrence [options]                    Work with recurrence rules
  create-recurring <calendarId>           Create a recurring event using rrule.js
  recurrence-info <calendarId> <eventId>  Show recurrence information for an event
  date [options]                          Date utilities and formatting

Options:
  -h, --help                              Show this help message

Examples:
  gwork cal list
  gwork cal calendars
  gwork cal search "meeting"
  gwork cal stats
`);
}

function printContactsHelp() {
  console.log(`
gwork contacts - Google Contacts operations

Usage:
  gwork contacts <command> [options]

Basic Commands:
  list [options]                              List contacts
  get <resourceName>                          Get a specific contact
  search <query>                              Search contacts
  find-email <email>                          Find contact by email
  find-name <name>                            Find contact by name
  create [options]                            Create a new contact
  update <resourceName> [options]             Update a contact
  delete <resourceName> --confirm             Delete a contact

Group Management:
  groups                                      List contact groups
  group-contacts <groupResourceName>          List contacts in a group
  create-group <name> --confirm               Create a contact group
  delete-group <resourceName> --confirm       Delete a contact group
  add-to-group <group> <contacts...> --confirm
  remove-from-group <group> <contacts...> --confirm

Batch Operations:
  batch-create <jsonFile> --confirm           Create multiple contacts
  batch-delete <resourceName...> --confirm    Delete multiple contacts

Advanced:
  profile                                     Get your profile information
  stats                                       Show contact statistics
  duplicates [options]                        Find duplicate contacts
  find-missing-names                          Find contacts with missing names
  analyze-generic-names                       Find contacts with generic names
  analyze-imported                            Analyze imported contacts
  detect-marketing [options]                  Find/remove marketing contacts

Options:
  -h, --help                                  Show this help message
  --account <email>                           Use a specific Google account

Examples:
  gwork contacts list -n 100
  gwork contacts search "john"
  gwork contacts find-email "john@example.com"
  gwork contacts create --first-name John --last-name Doe --email john@example.com --confirm
  gwork contacts profile
  gwork contacts stats
`);
}

function printVersion() {
  console.log("gwork version 0.1.0");
}

async function handleMail(args: string[]) {
  // Check for help flag or no subcommand
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printMailHelp();
    process.exit(0);
  }

  const subcommand = args[0];
  if (!subcommand) {
    printMailHelp();
    process.exit(0);
  }
  const subcommandArgs = args.slice(1);

  // Extract account from subcommand args
  const { account, args: filteredArgs } = parseAccount(subcommandArgs);

  await handleMailCommand(subcommand, filteredArgs, account);
}

async function handleCal(args: string[]) {
  // Check for help flag or no subcommand
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printCalHelp();
    process.exit(0);
  }

  const subcommand = args[0];
  if (!subcommand) {
    printCalHelp();
    process.exit(0);
  }
  const subcommandArgs = args.slice(1);

  // Extract account from subcommand args
  const { account, args: filteredArgs } = parseAccount(subcommandArgs);

  await handleCalCommand(subcommand, filteredArgs, account);
}

async function handleContacts(args: string[]) {
  // Check for help flag or no subcommand
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printContactsHelp();
    process.exit(0);
  }

  const subcommand = args[0];
  if (!subcommand) {
    printContactsHelp();
    process.exit(0);
  }
  const subcommandArgs = args.slice(1);

  // Extract account from subcommand args
  const { account, args: filteredArgs } = parseAccount(subcommandArgs);

  await handleContactsCommand(subcommand, filteredArgs, account);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle version flag at top level
  if (args[0] === "--version" || args[0] === "-v") {
    printVersion();
    process.exit(0);
  }

  // Handle help flag at top level (only if no command or just --help)
  if (!command || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  // Pass remaining args to subcommands
  const commandArgs = args.slice(1);

  switch (command) {
    case "mail":
      await handleMail(commandArgs);
      break;
    case "cal":
      await handleCal(commandArgs);
      break;
    case "contacts":
      await handleContacts(commandArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'gwork --help' for usage information");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
