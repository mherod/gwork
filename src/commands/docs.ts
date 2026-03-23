import chalk from "chalk";
import ora from "ora";
import { DocsService } from "../services/docs-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { handleCommandWithRetry } from "../utils/command-handler.ts";
import { CommandRegistry } from "./registry.ts";

async function getDoc(svc: DocsService, documentId: string): Promise<void> {
  const spinner = ora("Fetching document metadata…").start();
  const meta = await svc.getDocument(documentId);
  spinner.stop();

  console.log(`Title:       ${chalk.bold(meta.title)}`);
  console.log(`ID:          ${meta.documentId}`);
  console.log(`Revision:    ${meta.revisionId}`);
  console.log(`Link:        https://docs.google.com/document/d/${meta.documentId}/edit`);
}

async function readDoc(svc: DocsService, documentId: string, args: string[]): Promise<void> {
  const headersOnly = args.includes("--headers");
  const format = extractFlag(args, "--format") || "text";

  const spinner = ora("Reading document…").start();
  const content = await svc.readContent(documentId);
  spinner.stop();

  if (format === "json") {
    const output = {
      documentId: content.documentId,
      title: content.title,
      wordCount: content.wordCount,
      headers: content.headers,
      body: headersOnly ? undefined : content.bodyText,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(chalk.bold(content.title));
  console.log(chalk.gray(`${content.wordCount} words\n`));

  if (headersOnly) {
    if (content.headers.length === 0) {
      console.log(chalk.gray("No headings found."));
    } else {
      for (const header of content.headers) {
        console.log(`  ${chalk.cyan(header)}`);
      }
    }
  } else {
    console.log(content.bodyText);
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function buildDocsRegistry(): CommandRegistry<DocsService> {
  return new CommandRegistry<DocsService>()
    .register("get", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: document ID is required", "gwork docs get <fileId>");
      }
      return getDoc(svc, args[0]!);
    })
    .register("read", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: document ID is required",
          "gwork docs read <fileId> [--headers] [--format text|json]"
        );
      }
      return readDoc(svc, args[0]!, args.slice(1));
    });
}

export async function handleDocsCommand(
  subcommand: string,
  args: string[],
  account = "default",
  serviceFactory: (account: string) => DocsService = (acc) => new DocsService(acc)
) {
  await handleCommandWithRetry({
    tokenKey: "docs",
    serviceName: "Docs",
    account,
    subcommand,
    serviceFactory,
    execute: (svc) => buildDocsRegistry().execute(subcommand, svc, args),
  });
}
