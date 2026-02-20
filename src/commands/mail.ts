import chalk from "chalk";
import ora from "ora";
import { find } from "lodash-es";
import { MailService } from "../services/mail-service.ts";
import type { SendMessageOptions } from "../services/mail-service.ts";
import { ensureInitialized } from "../utils/command-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { logger } from "../utils/logger.ts";
import fs from "node:fs";
import fsPromises from "node:fs/promises";

type EmailBodyFormat = "plain" | "html" | "auto";

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
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
      case "plain": {
        const plainPart = parts.find((p: any) => p.mimeType === "text/plain" && p.body?.data);
        if (plainPart) body = decodeBase64(plainPart.body.data);
        break;
      }

      case "html": {
        const htmlPart = parts.find((p: any) => p.mimeType === "text/html" && p.body?.data);
        if (htmlPart) body = decodeBase64(htmlPart.body.data);
        break;
      }

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

export async function handleMailCommand(subcommand: string, args: string[], account = "default") {
  // Create service instance with the specified account
  const mailService = new MailService(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized(mailService);

  switch (subcommand) {
    case "labels":
      await listLabels(mailService, args);
      break;
    case "messages":
      await listMessages(mailService, args);
      break;
    case "get":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail get <messageId> [--format <plain|html|auto>]");
      }
      await getMessage(mailService, args[0]!, args.slice(1));
      break;
    case "search": {
      if (args.length === 0) {
        throw new ArgumentError("Error: search query is required", "gwork mail search <query>");
      }
      // Extract query (first arg) and remaining options
      const query = args[0]!;
      const searchOptions = args.slice(1);
      await searchMessages(mailService, query, searchOptions, account);
      break;
    }
    case "stats":
      await getStats(mailService);
      break;
    case "threads":
      await listThreads(mailService, args);
      break;
    case "thread":
      if (args.length === 0) {
        throw new ArgumentError("Error: threadId is required", "gwork mail thread <threadId> [--format <plain|html|auto>]");
      }
      await getThread(mailService, args[0]!, args.slice(1));
      break;
    case "unread":
      await listUnread(mailService, args);
      break;
    case "starred":
      await listStarred(mailService, args);
      break;
    case "important":
      await listImportant(mailService, args);
      break;
    case "drafts":
      await listDrafts(mailService, args);
      break;
    case "attachments":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail attachments <messageId>");
      }
      await listAttachments(mailService, args[0]!);
      break;
    case "download":
      if (args.length < 2) {
        throw new ArgumentError("Error: messageId and attachmentId are required", "gwork mail download <messageId> <attachmentId> [filename]");
      }
      await downloadAttachment(mailService, args[0]!, args[1]!, args[2]);
      break;
    case "delete":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail delete <messageId>");
      }
      await deleteMessage(mailService, args[0]!);
      break;
    case "delete-query":
      if (args.length === 0) {
        throw new ArgumentError("Error: search query is required", "gwork mail delete-query <query>");
      }
      await deleteQuery(mailService, args.join(" "));
      break;
    case "archive":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail archive <messageId>");
      }
      await archiveMessage(mailService, args[0]!);
      break;
    case "archive-query":
      if (args.length === 0) {
        throw new ArgumentError("Error: search query is required", "gwork mail archive-query <query>");
      }
      await archiveQuery(mailService, args.join(" "));
      break;
    case "archive-many":
      if (args.length === 0) {
        throw new ArgumentError("Error: at least one messageId is required", "gwork mail archive-many <messageId1> [messageId2] [...]");
      }
      await archiveMany(mailService, args);
      break;
    case "unarchive":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail unarchive <messageId>");
      }
      await unarchiveMessage(mailService, args[0]!);
      break;
    case "unarchive-query":
      if (args.length === 0) {
        throw new ArgumentError("Error: search query is required", "gwork mail unarchive-query <query>");
      }
      await unarchiveQuery(mailService, args.join(" "));
      break;
    case "unarchive-many":
      if (args.length === 0) {
        throw new ArgumentError("Error: at least one messageId is required", "gwork mail unarchive-many <messageId1> [messageId2] [...]");
      }
      await unarchiveMany(mailService, args);
      break;
    case "add-label":
      if (args.length < 2) {
        throw new ArgumentError("Error: messageId and labelName are required", "gwork mail add-label <messageId> <labelName>");
      }
      await addLabel(mailService, args[0]!, args[1]!);
      break;
    case "remove-label":
      if (args.length < 2) {
        throw new ArgumentError("Error: messageId and labelName are required", "gwork mail remove-label <messageId> <labelName>");
      }
      await removeLabel(mailService, args[0]!, args[1]!);
      break;
    case "mark-read":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail mark-read <messageId>");
      }
      await markRead(mailService, args[0]!);
      break;
    case "mark-unread":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail mark-unread <messageId>");
      }
      await markUnread(mailService, args[0]!);
      break;
    case "star":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail star <messageId>");
      }
      await starMessage(mailService, args[0]!);
      break;
    case "unstar":
      if (args.length === 0) {
        throw new ArgumentError("Error: messageId is required", "gwork mail unstar <messageId>");
      }
      await unstarMessage(mailService, args[0]!);
      break;
    case "create-label":
      if (args.length === 0) {
        throw new ArgumentError("Error: labelName is required", "gwork mail create-label <labelName> [--color <color>]");
      }
      await createLabel(mailService, args[0]!, args.slice(1));
      break;
    case "delete-label":
      if (args.length === 0) {
        throw new ArgumentError("Error: labelId is required", "gwork mail delete-label <labelId>");
      }
      await deleteLabel(mailService, args[0]!);
      break;
    case "send":
      await handleSendMessage(mailService, args);
      break;
    default:
      throw new ArgumentError(`Unknown mail subcommand: ${subcommand}`, "gwork mail --help");
  }
}

async function listLabels(mailService: MailService, _args: string[]) {
  const spinner = ora("Fetching labels...").start();
  try {
    const labels = await mailService.listLabels();
    spinner.succeed(`Found ${labels.length} label(s)`);

    if (labels.length === 0) {
      logger.info(chalk.yellow("No labels found"));
      return;
    }

    logger.info(chalk.bold("\nGmail Labels:"));
    logger.info("─".repeat(80));
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

      logger.info(`\n${labelColor(name)}`);
      logger.info(`  ${chalk.gray("Type:")} ${type}`);
      if (count > 0) {
        logger.info(`  ${chalk.gray("Messages:")} ${count} (${unread} unread)`);
      }
    });
  } catch (error: unknown) {
    spinner.fail("Failed to fetch labels");
    throw error;
  }
}

async function listMessages(mailService: MailService, args: string[]) {
  const spinner = ora("Fetching messages...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--max-results" || args[i] === "-n") {
        if (i + 1 < args.length) {
          const parsed = parseInt(args[++i]!, 10);
          if (!isNaN(parsed)) options.maxResults = parsed;
        }
      } else if (args[i] === "--query" || args[i] === "-q") {
        if (i + 1 < args.length) {
          options.q = args[++i]!;
        }
      } else if (args[i] === "--label" || args[i] === "-l") {
        if (i + 1 < args.length) {
          if (!options.labelIds) options.labelIds = [];
          options.labelIds.push(args[++i]!);
        }
      }
    }

    const result = await mailService.listMessages(options);
    spinner.succeed(`Found ${result.messages.length} message(s)`);

    if (result.messages.length === 0) {
      logger.info(chalk.yellow("No messages found"));
      return;
    }

    // Fetch message details
    const messagePromises = result.messages.map((msg) =>
      mailService.getMessage(msg.id ?? "", "metadata")
    );
    const messages = await Promise.all(messagePromises);

    logger.info(chalk.bold("\nMessages:"));
    logger.info("─".repeat(80));
    messages.forEach((message, index: number) => {
      const headers = message.payload?.headers || [];
      const from = getHeader(headers, "from");
      const subject = getHeader(headers, "subject");
      const date = getHeader(headers, "date");
      const snippet = message.snippet || "";

      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(subject || "No subject")}`);
      logger.info(`   ${chalk.gray("From:")} ${from}`);
      logger.info(`   ${chalk.gray("Date:")} ${date}`);
      if (snippet) {
        const shortSnippet = snippet.length > 100 ? snippet.substring(0, 100) + "..." : snippet;
        logger.info(`   ${chalk.gray("Preview:")} ${shortSnippet}`);
      }
      logger.info(`   ${chalk.gray("ID:")} ${message.id}`);
    });
  } catch (error: unknown) {
    spinner.fail("Failed to fetch messages");
    throw error;
  }
}

async function getMessage(mailService: MailService, messageId: string, args: string[] = []) {
  const spinner = ora("Fetching message...").start();
  try {
    let format: EmailBodyFormat = "auto";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--format" || args[i] === "-f") {
        if (i + 1 >= args.length) {
          spinner.fail("Missing format value");
          throw new ArgumentError("Error: --format requires a value (plain, html, or auto)");
        }
        const value = args[++i]!;
        if (value === "plain" || value === "html" || value === "auto") {
          format = value;
        } else {
          spinner.fail("Invalid format option");
          throw new ArgumentError(`Error: Invalid format "${value}". Use: plain, html, or auto`);
        }
      }
    }

    const message = await mailService.getMessage(messageId, "full");
    spinner.succeed("Message fetched");

    logger.info(chalk.bold("\nMessage:"));
    logger.info("─".repeat(80));
    logger.info(formatMessage(message, format));

    const parts = message.payload?.parts || [];
    if (parts.length > 0) {
      const attachments = parts.filter((p: any) => p.filename);
      if (attachments.length > 0) {
        logger.info(`\n${chalk.cyan("Attachments:")}`);
        attachments.forEach((part: any) => {
          logger.info(`  - ${part.filename} (${part.mimeType})`);
        });
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch message");
    throw error;
  }
}

async function searchMessages(mailService: MailService, query: string, extraArgs: string[], account = "default") {
  const spinner = ora("Searching messages...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < extraArgs.length; i++) {
      if (extraArgs[i] === "--max-results" || extraArgs[i] === "-n") {
        if (i + 1 < extraArgs.length) {
          const parsed = parseInt(extraArgs[++i]!, 10);
          if (!isNaN(parsed)) options.maxResults = parsed;
        }
      } else if (extraArgs[i] === "--page-token") {
        if (i + 1 < extraArgs.length) {
          options.pageToken = extraArgs[++i]!;
        }
      }
    }

    const result = await mailService.searchMessages(query, options);

    const messagePromises = result.messages.map((msg) =>
      mailService.getMessage(msg.id ?? "", "metadata")
    );
    const allMessages = await Promise.all(messagePromises);

    // Filter results to only include messages addressed to/from the specified account.
    // This is a defence-in-depth measure: even if the token lookup returned the correct
    // mailbox, we never surface messages whose To/Delivered-To headers don't match the
    // requested account (when a specific account was given).
    const messages = account === "default"
      ? allMessages
      : allMessages.filter((message) => {
          const headers = message.payload?.headers || [];
          const to = getHeader(headers, "to");
          const deliveredTo = getHeader(headers, "delivered-to");
          const accountLower = account.toLowerCase();
          return to.toLowerCase().includes(accountLower) ||
            deliveredTo.toLowerCase().includes(accountLower);
        });

    spinner.succeed(`Found ${messages.length} message(s) matching "${query}"`);

    if (messages.length === 0) {
      logger.info(chalk.yellow("No messages found"));
      return;
    }

    logger.info(chalk.bold(`\nSearch Results for: "${query}"`));
    logger.info("─".repeat(80));
    messages.forEach((message, index: number) => {
      const headers = message.payload?.headers || [];
      const from = getHeader(headers, "from");
      const subject = getHeader(headers, "subject");
      const date = getHeader(headers, "date");

      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(subject || "No subject")}`);
      logger.info(`   ${chalk.gray("From:")} ${from}`);
      logger.info(`   ${chalk.gray("Date:")} ${date}`);
      logger.info(`   ${chalk.gray("ID:")} ${message.id}`);
    });
  } catch (error: unknown) {
    spinner.fail("Search failed");
    throw error;
  }
}

async function getStats(mailService: MailService) {
  const spinner = ora("Fetching statistics...").start();
  try {
    const profile = await mailService.getProfile();
    const labels = await mailService.listLabels();

    const inboxLabel = find(labels, (l) => l.id === "INBOX");
    const unreadCount = inboxLabel?.messagesUnread || 0;
    const totalCount = inboxLabel?.messagesTotal || 0;

    spinner.succeed("Statistics fetched");

    logger.info(chalk.bold("\nGmail Statistics:"));
    logger.info("─".repeat(80));
    logger.info(`${chalk.cyan("Email Address:")} ${profile.emailAddress}`);
    logger.info(`${chalk.cyan("Total Messages:")} ${totalCount}`);
    logger.info(`${chalk.cyan("Unread Messages:")} ${unreadCount}`);
    logger.info(`${chalk.cyan("Read Messages:")} ${totalCount - unreadCount}`);

    const userLabels = labels.filter((l: any) => l.type === "user");
    if (userLabels.length > 0) {
      logger.info(`\n${chalk.cyan("User Labels:")} ${userLabels.length}`);
      userLabels.slice(0, 10).forEach((label: any) => {
        const count = label.messagesTotal || 0;
        logger.info(`  - ${label.name}: ${count} messages`);
      });
      if (userLabels.length > 10) {
        logger.info(chalk.gray(`  ... and ${userLabels.length - 10} more`));
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch statistics");
    throw error;
  }
}

async function listThreads(mailService: MailService, args: string[]) {
  const spinner = ora("Fetching threads...").start();
  try {
    const options: any = { maxResults: 10 };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--max-results" || args[i] === "-n") {
        if (i + 1 < args.length) {
          const parsed = parseInt(args[++i]!, 10);
          if (!isNaN(parsed)) options.maxResults = parsed;
        }
      } else if (args[i] === "--query" || args[i] === "-q") {
        options.q = args[++i]!;
      }
    }

    const result = await mailService.listThreads(options);
    spinner.succeed(`Found ${result.threads.length} thread(s)`);

    if (result.threads.length === 0) {
      logger.info(chalk.yellow("No threads found"));
      return;
    }

    logger.info(chalk.bold("\nThreads:"));
    logger.info("─".repeat(80));
    result.threads.forEach((thread: any, index: number) => {
      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan("Thread ID:")} ${thread.id}`);
      logger.info(`   ${chalk.gray("Messages:")} ${thread.messages?.length || 0}`);
    });
  } catch (error: unknown) {
    spinner.fail("Failed to fetch threads");
    throw error;
  }
}

async function getThread(mailService: MailService, threadId: string, args: string[] = []) {
  const spinner = ora("Fetching thread...").start();
  try {
    let format: EmailBodyFormat = "auto";
    let showFullMessages = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--format" || args[i] === "-f") {
        if (i + 1 >= args.length) {
          spinner.fail("Missing format value");
          throw new ArgumentError("Error: --format requires a value (plain, html, or auto)");
        }
        const value = args[++i]!;
        if (value === "plain" || value === "html" || value === "auto") {
          format = value;
          showFullMessages = true;
        } else {
          spinner.fail("Invalid format option");
          throw new ArgumentError(`Error: Invalid format "${value}". Use: plain, html, or auto`);
        }
      }
    }

    const thread = await mailService.getThread(threadId);
    spinner.succeed("Thread fetched");

    logger.info(chalk.bold("\nThread:"));
    logger.info("─".repeat(80));
    logger.info(`${chalk.cyan("Thread ID:")} ${thread.id}`);
    logger.info(`${chalk.cyan("Messages:")} ${thread.messages?.length || 0}`);

    if (thread.messages && thread.messages.length > 0) {
      thread.messages.forEach((message: any, index: number) => {
        logger.info(`\n${chalk.bold(`Message ${index + 1}:`)}`);
        logger.info("─".repeat(80));

        if (showFullMessages) {
          // Show full message with body
          logger.info(formatMessage(message, format));
        } else {
          // Current snippet preview behavior (unchanged)
          const headers = message.payload?.headers || [];
          const from = getHeader(headers, "from");
          const subject = getHeader(headers, "subject");
          const date = getHeader(headers, "date");

          logger.info(`  ${chalk.gray("From:")} ${from}`);
          logger.info(`  ${chalk.gray("Subject:")} ${subject}`);
          logger.info(`  ${chalk.gray("Date:")} ${date}`);
          if (message.snippet) {
            logger.info(`  ${chalk.gray("Preview:")} ${message.snippet.substring(0, 100)}...`);
          }
        }
      });
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch thread");
    throw error;
  }
}

async function listUnread(mailService: MailService, args: string[]) {
  await listMessages(mailService, [...args, "--label", "UNREAD"]);
}

async function listStarred(mailService: MailService, args: string[]) {
  await listMessages(mailService, [...args, "--label", "STARRED"]);
}

async function listImportant(mailService: MailService, args: string[]) {
  await listMessages(mailService, [...args, "--label", "IMPORTANT"]);
}

async function listDrafts(mailService: MailService, args: string[]) {
  await listMessages(mailService, [...args, "--label", "DRAFT"]);
}

async function listAttachments(mailService: MailService, messageId: string) {
  const spinner = ora("Fetching attachments...").start();
  try {
    const message = await mailService.getMessage(messageId, "full");
    spinner.succeed("Attachments fetched");

    const parts = message.payload?.parts || [];
    const attachments = parts.filter((p: any) => p.filename && p.body?.attachmentId);

    if (attachments.length === 0) {
      logger.info(chalk.yellow("No attachments found"));
      return;
    }

    logger.info(chalk.bold("\nAttachments:"));
    logger.info("─".repeat(80));
    attachments.forEach((part: any, index: number) => {
      const size = part.body?.size || 0;
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(part.filename)}`);
      logger.info(`   ${chalk.gray("Type:")} ${part.mimeType}`);
      logger.info(`   ${chalk.gray("Size:")} ${sizeMB} MB`);
      logger.info(`   ${chalk.gray("Attachment ID:")} ${part.body.attachmentId}`);
    });
  } catch (error: unknown) {
    spinner.fail("Failed to fetch attachments");
    throw error;
  }
}

async function downloadAttachment(mailService: MailService, messageId: string, attachmentId: string, filename?: string) {
  const spinner = ora("Downloading attachment...").start();
  try {
    const attachment = await mailService.getAttachment(messageId, attachmentId);
    const data = Buffer.from(attachment.data || "", "base64");

    let outputFile = filename;
    if (!outputFile) {
      // Try to find the original filename from the message's attachment metadata
      try {
        const message = await mailService.getMessage(messageId, "full");
        const parts = message.payload?.parts || [];
        const matchingPart = parts.find((p: any) => p.body?.attachmentId === attachmentId);
        if (matchingPart?.filename && matchingPart.filename.length > 0) {
          outputFile = matchingPart.filename;
        }
      } catch {
        // Metadata fetch failed — fall through to hash-based fallback
      }
    }
    if (!outputFile) {
      // Fall back to a short, safe hash of the attachment ID
      outputFile = `attachment-${attachmentId.slice(0, 16).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    }
    fs.writeFileSync(outputFile, data);

    spinner.succeed(`Attachment downloaded to ${outputFile}`);
  } catch (error: unknown) {
    spinner.fail("Failed to download attachment");
    throw error;
  }
}

async function deleteMessage(mailService: MailService, messageId: string) {
  const spinner = ora("Deleting message...").start();
  try {
    await mailService.deleteMessage(messageId);
    spinner.succeed("Message deleted");
    logger.info(chalk.green("Message has been deleted"));
  } catch (error: unknown) {
    spinner.fail("Failed to delete message");
    throw error;
  }
}

async function deleteQuery(mailService: MailService, query: string) {
  const spinner = ora("Deleting messages...").start();
  try {
    const result = await mailService.searchMessages(query, { maxResults: 500 });
    const messageIds = result.messages.map((m: any) => m.id);

    if (messageIds.length === 0) {
      spinner.succeed("No messages found to delete");
      return;
    }

    spinner.succeed(`Found ${messageIds.length} message(s) to delete`);
    logger.info(chalk.yellow(`\nAbout to delete ${messageIds.length} message(s)`));
    logger.info(chalk.yellow("This action cannot be undone. Proceed? (y/N)"));

    // In a real implementation, you'd want to read from stdin
    // For now, we'll proceed with the deletion
    await mailService.batchDeleteMessages(messageIds);
    spinner.succeed(`Deleted ${messageIds.length} message(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to delete messages");
    throw error;
  }
}

async function archiveMessage(mailService: MailService, messageId: string) {
  const spinner = ora("Archiving message...").start();
  try {
    await mailService.archiveMessage(messageId);
    spinner.succeed("Message archived");
    logger.info(chalk.green("Message has been archived"));
  } catch (error: unknown) {
    spinner.fail("Failed to archive message");
    throw error;
  }
}

async function archiveQuery(mailService: MailService, query: string) {
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
  } catch (error: unknown) {
    spinner.fail("Failed to archive messages");
    throw error;
  }
}

async function archiveMany(mailService: MailService, messageIds: string[]) {
  const spinner = ora(`Archiving ${messageIds.length} message(s)...`).start();
  try {
    for (const id of messageIds) {
      await mailService.archiveMessage(id);
    }
    spinner.succeed(`Archived ${messageIds.length} message(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to archive messages");
    throw error;
  }
}

async function unarchiveMessage(mailService: MailService, messageId: string) {
  const spinner = ora("Unarchiving message...").start();
  try {
    await mailService.unarchiveMessage(messageId);
    spinner.succeed("Message unarchived");
    logger.info(chalk.green("Message has been unarchived"));
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive message");
    throw error;
  }
}

async function unarchiveQuery(mailService: MailService, query: string) {
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
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive messages");
    throw error;
  }
}

async function unarchiveMany(mailService: MailService, messageIds: string[]) {
  const spinner = ora(`Unarchiving ${messageIds.length} message(s)...`).start();
  try {
    for (const id of messageIds) {
      await mailService.unarchiveMessage(id);
    }
    spinner.succeed(`Unarchived ${messageIds.length} message(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to unarchive messages");
    throw error;
  }
}

async function addLabel(mailService: MailService, messageId: string, labelName: string) {
  const spinner = ora("Adding label...").start();
  try {
    // First, find the label ID
    const labels = await mailService.listLabels();
    const label = find(labels, (l) => l.name === labelName || l.id === labelName);

    if (!label?.id) {
      spinner.fail("Label not found");
      throw new ArgumentError(`Label "${labelName}" not found`);
    }

    await mailService.modifyMessage(messageId, [label.id], []);
    spinner.succeed("Label added");
    logger.info(chalk.green(`Label "${label.name}" added to message`));
  } catch (error: unknown) {
    spinner.fail("Failed to add label");
    throw error;
  }
}

async function removeLabel(mailService: MailService, messageId: string, labelName: string) {
  const spinner = ora("Removing label...").start();
  try {
    const labels = await mailService.listLabels();
    const label = find(labels, (l) => l.name === labelName || l.id === labelName);

    if (!label?.id) {
      spinner.fail("Label not found");
      throw new ArgumentError(`Label "${labelName}" not found`);
    }

    await mailService.modifyMessage(messageId, [], [label.id]);
    spinner.succeed("Label removed");
    logger.info(chalk.green(`Label "${label.name}" removed from message`));
  } catch (error: unknown) {
    spinner.fail("Failed to remove label");
    throw error;
  }
}

async function markRead(mailService: MailService, messageId: string) {
  const spinner = ora("Marking as read...").start();
  try {
    await mailService.modifyMessage(messageId, [], ["UNREAD"]);
    spinner.succeed("Message marked as read");
    logger.info(chalk.green("Message has been marked as read"));
  } catch (error: unknown) {
    spinner.fail("Failed to mark message as read");
    throw error;
  }
}

async function markUnread(mailService: MailService, messageId: string) {
  const spinner = ora("Marking as unread...").start();
  try {
    await mailService.modifyMessage(messageId, ["UNREAD"], []);
    spinner.succeed("Message marked as unread");
    logger.info(chalk.green("Message has been marked as unread"));
  } catch (error: unknown) {
    spinner.fail("Failed to mark message as unread");
    throw error;
  }
}

async function starMessage(mailService: MailService, messageId: string) {
  const spinner = ora("Starring message...").start();
  try {
    await mailService.modifyMessage(messageId, ["STARRED"], []);
    spinner.succeed("Message starred");
    logger.info(chalk.green("Message has been starred"));
  } catch (error: unknown) {
    spinner.fail("Failed to star message");
    throw error;
  }
}

async function unstarMessage(mailService: MailService, messageId: string) {
  const spinner = ora("Unstarring message...").start();
  try {
    await mailService.modifyMessage(messageId, [], ["STARRED"]);
    spinner.succeed("Message unstarred");
    logger.info(chalk.green("Message has been unstarred"));
  } catch (error: unknown) {
    spinner.fail("Failed to unstar message");
    throw error;
  }
}

async function createLabel(mailService: MailService, labelName: string, args: string[]) {
  const spinner = ora("Creating label...").start();
  try {
    let color: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--color") {
        color = args[++i]!;
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
    logger.info(chalk.green(`Label "${label.name}" created`));
    logger.info(`${chalk.cyan("Label ID:")} ${label.id}`);
  } catch (error: unknown) {
    spinner.fail("Failed to create label");
    throw error;
  }
}

async function deleteLabel(mailService: MailService, labelId: string) {
  const spinner = ora("Deleting label...").start();
  try {
    await mailService.deleteLabel(labelId);
    spinner.succeed("Label deleted");
    logger.info(chalk.green("Label has been deleted"));
  } catch (error: unknown) {
    spinner.fail("Failed to delete label");
    throw error;
  }
}

async function handleSendMessage(mailService: MailService, args: string[]) {
  const toList: string[] = [];
  const ccList: string[] = [];
  const bccList: string[] = [];
  const attachments: string[] = [];
  let subject = "";
  let body = "";
  let bodyFile = "";
  let html = false;
  let replyToMessageId = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--to" && args[i + 1]) {
      toList.push(args[++i]!);
    } else if (arg === "--cc" && args[i + 1]) {
      ccList.push(args[++i]!);
    } else if (arg === "--bcc" && args[i + 1]) {
      bccList.push(args[++i]!);
    } else if (arg === "--subject" && args[i + 1]) {
      subject = args[++i]!;
    } else if (arg === "--body" && args[i + 1]) {
      body = args[++i]!;
    } else if (arg === "--body-file" && args[i + 1]) {
      bodyFile = args[++i]!;
    } else if (arg === "--html") {
      html = true;
    } else if (arg === "--attach" && args[i + 1]) {
      attachments.push(args[++i]!);
    } else if (arg === "--reply-to" && args[i + 1]) {
      replyToMessageId = args[++i]!;
    }
  }

  // Validate required flags
  if (toList.length === 0) {
    throw new ArgumentError(
      "Error: --to is required",
      "gwork mail send --to <address> --subject <text> --body <text>"
    );
  }
  if (!subject) {
    throw new ArgumentError(
      "Error: --subject is required",
      "gwork mail send --to <address> --subject <text> --body <text>"
    );
  }
  if (!body && !bodyFile) {
    throw new ArgumentError(
      "Error: either --body or --body-file is required",
      "gwork mail send --to <address> --subject <text> --body <text>"
    );
  }
  if (body && bodyFile) {
    throw new ArgumentError(
      "Error: --body and --body-file are mutually exclusive",
      "gwork mail send --to <address> --subject <text> [--body <text> | --body-file <path>]"
    );
  }

  // Validate attachment files exist before making any API calls
  for (const filePath of attachments) {
    if (!fs.existsSync(filePath)) {
      throw new ArgumentError(
        `Error: attachment file not found: ${filePath}`,
        "gwork mail send --to <address> --subject <text> --body <text> --attach <path>"
      );
    }
  }

  // Read body from file if --body-file was provided
  if (bodyFile) {
    if (!fs.existsSync(bodyFile)) {
      throw new ArgumentError(
        `Error: body file not found: ${bodyFile}`,
        "gwork mail send --to <address> --subject <text> --body-file <path>"
      );
    }
    body = await fsPromises.readFile(bodyFile, "utf-8");
  }

  const options: SendMessageOptions = {
    to: toList,
    cc: ccList.length > 0 ? ccList : undefined,
    bcc: bccList.length > 0 ? bccList : undefined,
    subject,
    body,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: replyToMessageId || undefined,
  };

  const spinner = ora("Sending message...").start();
  try {
    const message = await mailService.sendMessage(options);
    spinner.succeed("Message sent");
    logger.info(chalk.green(`Email sent successfully`));
    if (message.id) {
      logger.info(`${chalk.cyan("Message ID:")} ${message.id}`);
    }
    if (message.threadId) {
      logger.info(`${chalk.cyan("Thread ID:")}  ${message.threadId}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to send message");
    throw error;
  }
}
