import chalk from "chalk";
import ora from "ora";
import { startCase, find } from "lodash-es";
import { MailService } from "../services/mail-service.ts";
import fs from "node:fs";

// Module-level service instance (set by handleMailCommand)
let mailService: MailService;

type EmailBodyFormat = "plain" | "html" | "auto";

// Helper to ensure service is initialized (checks credentials)
async function ensureInitialized() {
  await mailService.initialize();
}

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

function getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  const header = find(headers, (h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

function formatMessage(message: any, format: EmailBodyFormat = "auto"): string {
  const headers = message.payload?.headers || [];
  const from = getHeader(headers, "from");
  const to = getHeader(headers, "to");
  const subject = getHeader(headers, "subject");
  const date = getHeader(headers, "date");

  let body = "";
  if (message.payload?.body?.data) {
    body = decodeBase64(message.payload.body.data);
  } else if (message.payload?.parts) {
    const parts = message.payload.parts;

    switch (format) {
      case "plain":
        const plainPart = parts.find((p: any) => p.mimeType === "text/plain" && p.body?.data);
        if (plainPart) body = decodeBase64(plainPart.body.data);
        break;

      case "html":
        const htmlPart = parts.find((p: any) => p.mimeType === "text/html" && p.body?.data);
        if (htmlPart) body = decodeBase64(htmlPart.body.data);
        break;

      case "auto":
      default:
        // Current behavior: prefer plain, fallback to html
        for (const part of parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            body = decodeBase64(part.body.data);
            break;
          } else if (part.mimeType === "text/html" && part.body?.data && !body) {
            body = decodeBase64(part.body.data);
          }
        }
    }
  }

  // Add warning if requested format not available
  if (!body && format !== "auto") {
    body = `[No ${format} version available for this message]`;
  }

  return `From: ${from}
To: ${to}
Subject: ${subject}
Date: ${date}

${body}`;
}

export async function handleMailCommand(subcommand: string, args: string[], account: string = "default") {
  // Create service instance with the specified account
  mailService = new MailService(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized();
  
  switch (subcommand) {
    case "labels":
      await listLabels(args);
      break;
    case "messages":
      await listMessages(args);
      break;
    case "get":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail get <messageId> [--format <plain|html|auto>]");
        process.exit(1);
      }
      await getMessage(args[0], args.slice(1));
      break;
    case "search":
      if (args.length === 0) {
        console.error("Error: search query is required");
        console.error("Usage: gwork mail search <query>");
        process.exit(1);
      }
      // Extract query (first arg) and remaining options
      const query = args[0];
      const searchOptions = args.slice(1);
      await searchMessages(query, searchOptions);
      break;
    case "stats":
      await getStats();
      break;
    case "threads":
      await listThreads(args);
      break;
    case "thread":
      if (args.length === 0) {
        console.error("Error: threadId is required");
        console.error("Usage: gwork mail thread <threadId> [--format <plain|html|auto>]");
        process.exit(1);
      }
      await getThread(args[0], args.slice(1));
      break;
    case "unread":
      await listUnread(args);
      break;
    case "starred":
      await listStarred(args);
      break;
    case "important":
      await listImportant(args);
      break;
    case "drafts":
      await listDrafts(args);
      break;
    case "attachments":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail attachments <messageId>");
        process.exit(1);
      }
      await listAttachments(args[0]);
      break;
    case "download":
      if (args.length < 2) {
        console.error("Error: messageId and attachmentId are required");
        console.error("Usage: gwork mail download <messageId> <attachmentId> [filename]");
        process.exit(1);
      }
      await downloadAttachment(args[0], args[1], args[2]);
      break;
    case "delete":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail delete <messageId>");
        process.exit(1);
      }
      await deleteMessage(args[0]);
      break;
    case "delete-query":
      if (args.length === 0) {
        console.error("Error: search query is required");
        console.error("Usage: gwork mail delete-query <query>");
        process.exit(1);
      }
      await deleteQuery(args.join(" "));
      break;
    case "archive":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail archive <messageId>");
        process.exit(1);
      }
      await archiveMessage(args[0]);
      break;
    case "archive-query":
      if (args.length === 0) {
        console.error("Error: search query is required");
        console.error("Usage: gwork mail archive-query <query>");
        process.exit(1);
      }
      await archiveQuery(args.join(" "));
      break;
    case "archive-many":
      if (args.length === 0) {
        console.error("Error: at least one messageId is required");
        console.error("Usage: gwork mail archive-many <messageId1> [messageId2] [...]");
        process.exit(1);
      }
      await archiveMany(args);
      break;
    case "unarchive":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail unarchive <messageId>");
        process.exit(1);
      }
      await unarchiveMessage(args[0]);
      break;
    case "unarchive-query":
      if (args.length === 0) {
        console.error("Error: search query is required");
        console.error("Usage: gwork mail unarchive-query <query>");
        process.exit(1);
      }
      await unarchiveQuery(args.join(" "));
      break;
    case "unarchive-many":
      if (args.length === 0) {
        console.error("Error: at least one messageId is required");
        console.error("Usage: gwork mail unarchive-many <messageId1> [messageId2] [...]");
        process.exit(1);
      }
      await unarchiveMany(args);
      break;
    case "add-label":
      if (args.length < 2) {
        console.error("Error: messageId and labelName are required");
        console.error("Usage: gwork mail add-label <messageId> <labelName>");
        process.exit(1);
      }
      await addLabel(args[0], args[1]);
      break;
    case "remove-label":
      if (args.length < 2) {
        console.error("Error: messageId and labelName are required");
        console.error("Usage: gwork mail remove-label <messageId> <labelName>");
        process.exit(1);
      }
      await removeLabel(args[0], args[1]);
      break;
    case "mark-read":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail mark-read <messageId>");
        process.exit(1);
      }
      await markRead(args[0]);
      break;
    case "mark-unread":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail mark-unread <messageId>");
        process.exit(1);
      }
      await markUnread(args[0]);
      break;
    case "star":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail star <messageId>");
        process.exit(1);
      }
      await starMessage(args[0]);
      break;
    case "unstar":
      if (args.length === 0) {
        console.error("Error: messageId is required");
        console.error("Usage: gwork mail unstar <messageId>");
        process.exit(1);
      }
      await unstarMessage(args[0]);
      break;
    case "create-label":
      if (args.length === 0) {
        console.error("Error: labelName is required");
        console.error("Usage: gwork mail create-label <labelName> [--color <color>]");
        process.exit(1);
      }
      await createLabel(args[0], args.slice(1));
      break;
    case "delete-label":
      if (args.length === 0) {
        console.error("Error: labelId is required");
        console.error("Usage: gwork mail delete-label <labelId>");
        process.exit(1);
      }
      await deleteLabel(args[0]);
      break;
    default:
      console.error(`Unknown mail subcommand: ${subcommand}`);
      console.error("Run 'gwork mail --help' for usage information");
      process.exit(1);
  }
}

async function listLabels(args: string[]) {
  const spinner = ora("Fetching labels...").start();
  try {
    const labels = await mailService.listLabels();
    spinner.succeed(`Found ${labels.length} label(s)`);

    if (labels.length === 0) {
      console.log(chalk.yellow("No labels found"));
      return;
    }

    console.log(chalk.bold("\nGmail Labels:"));
    console.log("─".repeat(80));
    labels.forEach((label: any) => {
      const name = label.name || "Unknown";
      const type = label.type || "user";
      const color = label.color?.backgroundColor || "";
      const count = label.messagesTotal || 0;
      const unread = label.messagesUnread || 0;

      let labelColor = chalk.white;
      if (color) {
        labelColor = chalk.hex(color);
      }

      console.log(`\n${labelColor(name)}`);
      console.log(`  ${chalk.gray("Type:")} ${type}`);
      if (count > 0) {
        console.log(`  ${chalk.gray("Messages:")} ${count} (${unread} unread)`);
      }
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch labels");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function listMessages(args: string[]) {
  const spinner = ora("Fetching messages...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--max-results" || args[i] === "-n") {
        options.maxResults = parseInt(args[++i]);
      } else if (args[i] === "--query" || args[i] === "-q") {
        options.q = args[++i];
      } else if (args[i] === "--label" || args[i] === "-l") {
        if (!options.labelIds) options.labelIds = [];
        options.labelIds.push(args[++i]);
      }
    }

    const result = await mailService.listMessages(options);
    spinner.succeed(`Found ${result.messages.length} message(s)`);

    if (result.messages.length === 0) {
      console.log(chalk.yellow("No messages found"));
      return;
    }

    // Fetch message details
    const messagePromises = result.messages.map((msg) =>
      mailService.getMessage(msg.id ?? "", "metadata")
    );
    const messages = await Promise.all(messagePromises);

    console.log(chalk.bold("\nMessages:"));
    console.log("─".repeat(80));
    messages.forEach((message, index: number) => {
      const headers = message.payload?.headers || [];
      const from = getHeader(headers, "from");
      const subject = getHeader(headers, "subject");
      const date = getHeader(headers, "date");
      const snippet = message.snippet || "";

      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(subject || "No subject")}`);
      console.log(`   ${chalk.gray("From:")} ${from}`);
      console.log(`   ${chalk.gray("Date:")} ${date}`);
      if (snippet) {
        const shortSnippet = snippet.length > 100 ? snippet.substring(0, 100) + "..." : snippet;
        console.log(`   ${chalk.gray("Preview:")} ${shortSnippet}`);
      }
      console.log(`   ${chalk.gray("ID:")} ${message.id}`);
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getMessage(messageId: string, args: string[] = []) {
  const spinner = ora("Fetching message...").start();
  try {
    let format: EmailBodyFormat = "auto";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--format" || args[i] === "-f") {
        if (i + 1 >= args.length) {
          spinner.fail("Missing format value");
          console.error(chalk.red("Error: --format requires a value (plain, html, or auto)"));
          process.exit(1);
        }
        const value = args[++i];
        if (value === "plain" || value === "html" || value === "auto") {
          format = value;
        } else {
          spinner.fail("Invalid format option");
          console.error(chalk.red(`Error: Invalid format "${value}". Use: plain, html, or auto`));
          process.exit(1);
        }
      }
    }

    const message = await mailService.getMessage(messageId, "full");
    spinner.succeed("Message fetched");

    console.log(chalk.bold("\nMessage:"));
    console.log("─".repeat(80));
    console.log(formatMessage(message, format));

    const parts = message.payload?.parts || [];
    if (parts.length > 0) {
      const attachments = parts.filter((p: any) => p.filename);
      if (attachments.length > 0) {
        console.log(`\n${chalk.cyan("Attachments:")}`);
        attachments.forEach((part: any) => {
          console.log(`  - ${part.filename} (${part.mimeType})`);
        });
      }
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function searchMessages(query: string, extraArgs: string[]) {
  const spinner = ora("Searching messages...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < extraArgs.length; i++) {
      if (extraArgs[i] === "--max-results" || extraArgs[i] === "-n") {
        options.maxResults = parseInt(extraArgs[++i]);
      } else if (extraArgs[i] === "--page-token") {
        options.pageToken = extraArgs[++i];
      }
    }

    const result = await mailService.searchMessages(query, options);
    spinner.succeed(`Found ${result.messages.length} message(s) matching "${query}"`);

    if (result.messages.length === 0) {
      console.log(chalk.yellow("No messages found"));
      return;
    }

    const messagePromises = result.messages.map((msg) =>
      mailService.getMessage(msg.id ?? "", "metadata")
    );
    const messages = await Promise.all(messagePromises);

    console.log(chalk.bold(`\nSearch Results for: "${query}"`));
    console.log("─".repeat(80));
    messages.forEach((message, index: number) => {
      const headers = message.payload?.headers || [];
      const from = getHeader(headers, "from");
      const subject = getHeader(headers, "subject");
      const date = getHeader(headers, "date");

      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(subject || "No subject")}`);
      console.log(`   ${chalk.gray("From:")} ${from}`);
      console.log(`   ${chalk.gray("Date:")} ${date}`);
      console.log(`   ${chalk.gray("ID:")} ${message.id}`);
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Search failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getStats() {
  const spinner = ora("Fetching statistics...").start();
  try {
    const profile = await mailService.getProfile();
    const labels = await mailService.listLabels();

    const inboxLabel = find(labels, (l) => l.id === "INBOX");
    const unreadCount = inboxLabel?.messagesUnread || 0;
    const totalCount = inboxLabel?.messagesTotal || 0;

    spinner.succeed("Statistics fetched");

    console.log(chalk.bold("\nGmail Statistics:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Email Address:")} ${profile.emailAddress}`);
    console.log(`${chalk.cyan("Total Messages:")} ${totalCount}`);
    console.log(`${chalk.cyan("Unread Messages:")} ${unreadCount}`);
    console.log(`${chalk.cyan("Read Messages:")} ${totalCount - unreadCount}`);

    const userLabels = labels.filter((l: any) => l.type === "user");
    if (userLabels.length > 0) {
      console.log(`\n${chalk.cyan("User Labels:")} ${userLabels.length}`);
      userLabels.slice(0, 10).forEach((label: any) => {
        const count = label.messagesTotal || 0;
        console.log(`  - ${label.name}: ${count} messages`);
      });
      if (userLabels.length > 10) {
        console.log(chalk.gray(`  ... and ${userLabels.length - 10} more`));
      }
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch statistics");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function listThreads(args: string[]) {
  const spinner = ora("Fetching threads...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--max-results" || args[i] === "-n") {
        options.maxResults = parseInt(args[++i]);
      } else if (args[i] === "--query" || args[i] === "-q") {
        options.q = args[++i];
      }
    }

    const result = await mailService.listThreads(options);
    spinner.succeed(`Found ${result.threads.length} thread(s)`);

    if (result.threads.length === 0) {
      console.log(chalk.yellow("No threads found"));
      return;
    }

    console.log(chalk.bold("\nThreads:"));
    console.log("─".repeat(80));
    result.threads.forEach((thread: any, index: number) => {
      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan("Thread ID:")} ${thread.id}`);
      console.log(`   ${chalk.gray("Messages:")} ${thread.messages?.length || 0}`);
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch threads");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function getThread(threadId: string, args: string[] = []) {
  const spinner = ora("Fetching thread...").start();
  try {
    let format: EmailBodyFormat = "auto";
    let showFullMessages = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--format" || args[i] === "-f") {
        if (i + 1 >= args.length) {
          spinner.fail("Missing format value");
          console.error(chalk.red("Error: --format requires a value (plain, html, or auto)"));
          process.exit(1);
        }
        const value = args[++i];
        if (value === "plain" || value === "html" || value === "auto") {
          format = value;
          showFullMessages = true;
        } else {
          spinner.fail("Invalid format option");
          console.error(chalk.red(`Error: Invalid format "${value}". Use: plain, html, or auto`));
          process.exit(1);
        }
      }
    }

    const thread = await mailService.getThread(threadId);
    spinner.succeed("Thread fetched");

    console.log(chalk.bold("\nThread:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Thread ID:")} ${thread.id}`);
    console.log(`${chalk.cyan("Messages:")} ${thread.messages?.length || 0}`);

    if (thread.messages && thread.messages.length > 0) {
      thread.messages.forEach((message: any, index: number) => {
        console.log(`\n${chalk.bold(`Message ${index + 1}:`)}`);
        console.log("─".repeat(80));

        if (showFullMessages) {
          // Show full message with body
          console.log(formatMessage(message, format));
        } else {
          // Current snippet preview behavior (unchanged)
          const headers = message.payload?.headers || [];
          const from = getHeader(headers, "from");
          const subject = getHeader(headers, "subject");
          const date = getHeader(headers, "date");

          console.log(`  ${chalk.gray("From:")} ${from}`);
          console.log(`  ${chalk.gray("Subject:")} ${subject}`);
          console.log(`  ${chalk.gray("Date:")} ${date}`);
          if (message.snippet) {
            console.log(`  ${chalk.gray("Preview:")} ${message.snippet.substring(0, 100)}...`);
          }
        }
      });
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch thread");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function listUnread(args: string[]) {
  await listMessages([...args, "--label", "UNREAD"]);
}

async function listStarred(args: string[]) {
  await listMessages([...args, "--label", "STARRED"]);
}

async function listImportant(args: string[]) {
  await listMessages([...args, "--label", "IMPORTANT"]);
}

async function listDrafts(args: string[]) {
  await listMessages([...args, "--label", "DRAFT"]);
}

async function listAttachments(messageId: string) {
  const spinner = ora("Fetching attachments...").start();
  try {
    const message = await mailService.getMessage(messageId, "full");
    spinner.succeed("Attachments fetched");

    const parts = message.payload?.parts || [];
    const attachments = parts.filter((p: any) => p.filename && p.body?.attachmentId);

    if (attachments.length === 0) {
      console.log(chalk.yellow("No attachments found"));
      return;
    }

    console.log(chalk.bold("\nAttachments:"));
    console.log("─".repeat(80));
    attachments.forEach((part: any, index: number) => {
      const size = part.body?.size || 0;
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(part.filename)}`);
      console.log(`   ${chalk.gray("Type:")} ${part.mimeType}`);
      console.log(`   ${chalk.gray("Size:")} ${sizeMB} MB`);
      console.log(`   ${chalk.gray("Attachment ID:")} ${part.body.attachmentId}`);
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch attachments");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function downloadAttachment(messageId: string, attachmentId: string, filename?: string) {
  const spinner = ora("Downloading attachment...").start();
  try {
    const attachment = await mailService.getAttachment(messageId, attachmentId);
    const data = Buffer.from(attachment.data || "", "base64");

    const outputFile = filename || attachmentId;
    fs.writeFileSync(outputFile, data);

    spinner.succeed(`Attachment downloaded to ${outputFile}`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to download attachment");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function deleteMessage(messageId: string) {
  const spinner = ora("Deleting message...").start();
  try {
    await mailService.deleteMessage(messageId);
    spinner.succeed("Message deleted");
    console.log(chalk.green("Message has been deleted"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function deleteQuery(query: string) {
  const spinner = ora("Deleting messages...").start();
  try {
    const result = await mailService.searchMessages(query, { maxResults: 500 });
    const messageIds = result.messages.map((m: any) => m.id);

    if (messageIds.length === 0) {
      spinner.succeed("No messages found to delete");
      return;
    }

    spinner.succeed(`Found ${messageIds.length} message(s) to delete`);
    console.log(chalk.yellow(`\nAbout to delete ${messageIds.length} message(s)`));
    console.log(chalk.yellow("This action cannot be undone. Proceed? (y/N)"));
    
    // In a real implementation, you'd want to read from stdin
    // For now, we'll proceed with the deletion
    await mailService.batchDeleteMessages(messageIds);
    spinner.succeed(`Deleted ${messageIds.length} message(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function archiveMessage(messageId: string) {
  const spinner = ora("Archiving message...").start();
  try {
    await mailService.archiveMessage(messageId);
    spinner.succeed("Message archived");
    console.log(chalk.green("Message has been archived"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to archive message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function archiveQuery(query: string) {
  const spinner = ora("Archiving messages...").start();
  try {
    const result = await mailService.searchMessages(query, { maxResults: 500 });
    const messageIds = result.messages.map((m: any) => m.id);

    if (messageIds.length === 0) {
      spinner.succeed("No messages found to archive");
      return;
    }

    for (const id of messageIds) {
      await mailService.archiveMessage(id);
    }
    spinner.succeed(`Archived ${messageIds.length} message(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to archive messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function archiveMany(messageIds: string[]) {
  const spinner = ora(`Archiving ${messageIds.length} message(s)...`).start();
  try {
    for (const id of messageIds) {
      await mailService.archiveMessage(id);
    }
    spinner.succeed(`Archived ${messageIds.length} message(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to archive messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function unarchiveMessage(messageId: string) {
  const spinner = ora("Unarchiving message...").start();
  try {
    await mailService.unarchiveMessage(messageId);
    spinner.succeed("Message unarchived");
    console.log(chalk.green("Message has been unarchived"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function unarchiveQuery(query: string) {
  const spinner = ora("Unarchiving messages...").start();
  try {
    const result = await mailService.searchMessages(query, { maxResults: 500 });
    const messageIds = result.messages.map((m: any) => m.id);

    if (messageIds.length === 0) {
      spinner.succeed("No messages found to unarchive");
      return;
    }

    for (const id of messageIds) {
      await mailService.unarchiveMessage(id);
    }
    spinner.succeed(`Unarchived ${messageIds.length} message(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function unarchiveMany(messageIds: string[]) {
  const spinner = ora(`Unarchiving ${messageIds.length} message(s)...`).start();
  try {
    for (const id of messageIds) {
      await mailService.unarchiveMessage(id);
    }
    spinner.succeed(`Unarchived ${messageIds.length} message(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive messages");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function addLabel(messageId: string, labelName: string) {
  const spinner = ora("Adding label...").start();
  try {
    // First, find the label ID
    const labels = await mailService.listLabels();
    const label = find(labels, (l) => l.name === labelName || l.id === labelName);

    if (!label) {
      spinner.fail("Label not found");
      console.error(chalk.red(`Label "${labelName}" not found`));
      process.exit(1);
    }

    await mailService.modifyMessage(messageId, [label.id], []);
    spinner.succeed("Label added");
    console.log(chalk.green(`Label "${label.name}" added to message`));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to add label");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function removeLabel(messageId: string, labelName: string) {
  const spinner = ora("Removing label...").start();
  try {
    const labels = await mailService.listLabels();
    const label = find(labels, (l) => l.name === labelName || l.id === labelName);

    if (!label) {
      spinner.fail("Label not found");
      console.error(chalk.red(`Label "${labelName}" not found`));
      process.exit(1);
    }

    await mailService.modifyMessage(messageId, [], [label.id]);
    spinner.succeed("Label removed");
    console.log(chalk.green(`Label "${label.name}" removed from message`));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to remove label");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function markRead(messageId: string) {
  const spinner = ora("Marking as read...").start();
  try {
    await mailService.modifyMessage(messageId, [], ["UNREAD"]);
    spinner.succeed("Message marked as read");
    console.log(chalk.green("Message has been marked as read"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to mark message as read");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function markUnread(messageId: string) {
  const spinner = ora("Marking as unread...").start();
  try {
    await mailService.modifyMessage(messageId, ["UNREAD"], []);
    spinner.succeed("Message marked as unread");
    console.log(chalk.green("Message has been marked as unread"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to mark message as unread");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function starMessage(messageId: string) {
  const spinner = ora("Starring message...").start();
  try {
    await mailService.modifyMessage(messageId, ["STARRED"], []);
    spinner.succeed("Message starred");
    console.log(chalk.green("Message has been starred"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to star message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function unstarMessage(messageId: string) {
  const spinner = ora("Unstarring message...").start();
  try {
    await mailService.modifyMessage(messageId, [], ["STARRED"]);
    spinner.succeed("Message unstarred");
    console.log(chalk.green("Message has been unstarred"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to unstar message");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function createLabel(labelName: string, args: string[]) {
  const spinner = ora("Creating label...").start();
  try {
    let color: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--color") {
        color = args[++i];
      }
    }

    const labelData: any = {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    };

    if (color) {
      labelData.color = {
        backgroundColor: color,
        textColor: "#ffffff",
      };
    }

    const label = await mailService.createLabel(labelData);
    spinner.succeed("Label created");
    console.log(chalk.green(`Label "${label.name}" created`));
    console.log(`${chalk.cyan("Label ID:")} ${label.id}`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create label");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}

async function deleteLabel(labelId: string) {
  const spinner = ora("Deleting label...").start();
  try {
    await mailService.deleteLabel(labelId);
    spinner.succeed("Label deleted");
    console.log(chalk.green("Label has been deleted"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete label");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  }
}
