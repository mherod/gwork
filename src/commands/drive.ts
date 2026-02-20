import chalk from "chalk";
import ora from "ora";
import { DriveService } from "../services/drive-service.ts";
import { ensureInitialized } from "../utils/command-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { logger } from "../utils/logger.ts";
import { CommandRegistry } from "./registry.ts";
import type { ListFilesOptions } from "../services/drive-service.ts";

function formatBytes(bytes: string | undefined): string {
  if (!bytes) return "—";
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "application/vnd.google-apps.folder": "Folder",
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.form": "Google Form",
    "application/pdf": "PDF",
    "image/jpeg": "JPEG Image",
    "image/png": "PNG Image",
    "text/plain": "Text",
    "text/csv": "CSV",
  };
  return map[mimeType] ?? mimeType;
}

async function listFiles(svc: DriveService, args: string[]): Promise<void> {
  const maxResults = parseInt(args[args.indexOf("--max-results") + 1] ?? "10", 10) || 10;
  const folderId = args[args.indexOf("--folder") + 1];

  const spinner = ora("Fetching files…").start();
  const options: ListFilesOptions = { maxResults };
  if (folderId) options.folderId = folderId;

  const files = await svc.listFiles(options);
  spinner.stop();

  if (files.length === 0) {
    logger.info("No files found.");
    return;
  }

  for (const file of files) {
    const type = formatMimeType(file.mimeType);
    const size = formatBytes(file.size);
    const modified = formatDate(file.modifiedTime);
    console.log(`${chalk.bold(file.name)} ${chalk.gray(`[${type}]`)}`);
    console.log(`  ID: ${file.id}  Size: ${size}  Modified: ${modified}`);
  }
  console.log(chalk.gray(`\n${files.length} file(s)`));
}

async function getFile(svc: DriveService, fileId: string): Promise<void> {
  const spinner = ora("Fetching file metadata…").start();
  const file = await svc.getFile(fileId);
  spinner.stop();

  console.log(`Name:     ${chalk.bold(file.name)}`);
  console.log(`ID:       ${file.id}`);
  console.log(`Type:     ${formatMimeType(file.mimeType)}`);
  console.log(`Size:     ${formatBytes(file.size)}`);
  console.log(`Created:  ${formatDate(file.createdTime)}`);
  console.log(`Modified: ${formatDate(file.modifiedTime)}`);
  console.log(`Shared:   ${file.shared ? "Yes" : "No"}`);
  if (file.webViewLink) {
    console.log(`Link:     ${file.webViewLink}`);
  }
}

async function searchFiles(svc: DriveService, query: string, args: string[]): Promise<void> {
  const maxResults = parseInt(args[args.indexOf("--max-results") + 1] ?? "10", 10) || 10;

  const spinner = ora(`Searching for "${query}"…`).start();
  const files = await svc.searchFiles(query, maxResults);
  spinner.stop();

  if (files.length === 0) {
    logger.info(`No files found matching "${query}".`);
    return;
  }

  for (const file of files) {
    const type = formatMimeType(file.mimeType);
    const size = formatBytes(file.size);
    const modified = formatDate(file.modifiedTime);
    console.log(`${chalk.bold(file.name)} ${chalk.gray(`[${type}]`)}`);
    console.log(`  ID: ${file.id}  Size: ${size}  Modified: ${modified}`);
  }
  console.log(chalk.gray(`\n${files.length} result(s)`));
}

async function downloadFile(svc: DriveService, fileId: string, args: string[]): Promise<void> {
  const outputFlag = args.indexOf("--output");
  const destPath = outputFlag !== -1 ? args[outputFlag + 1] : undefined;

  if (!destPath) {
    // Get metadata to derive a default filename
    const file = await svc.getFile(fileId);
    const safeName = file.name.replace(/[/\\?%*:|"<>]/g, "_");
    const spinner = ora(`Downloading "${file.name}"…`).start();
    await svc.downloadFile(fileId, safeName);
    spinner.stop();
    console.log(`Downloaded: ${chalk.bold(safeName)}`);
  } else {
    const spinner = ora(`Downloading to "${destPath}"…`).start();
    await svc.downloadFile(fileId, destPath);
    spinner.stop();
    console.log(`Downloaded: ${chalk.bold(destPath)}`);
  }
}

async function uploadFile(svc: DriveService, filePath: string, args: string[]): Promise<void> {
  const path = await import("node:path");
  const nameFlag = args.indexOf("--name");
  const parentFlag = args.indexOf("--folder");
  const name = nameFlag !== -1 ? args[nameFlag + 1]! : path.basename(filePath);
  const parentId = parentFlag !== -1 ? args[parentFlag + 1] : undefined;

  if (!name) {
    throw new ArgumentError("Error: could not determine file name", "gwork drive upload <path> [--name <name>] [--folder <folderId>]");
  }

  const spinner = ora(`Uploading "${name}"…`).start();
  const file = await svc.uploadFile({ name, filePath, parentId });
  spinner.stop();

  console.log(`Uploaded: ${chalk.bold(file.name)}`);
  console.log(`ID: ${file.id}`);
  if (file.webViewLink) {
    console.log(`Link: ${file.webViewLink}`);
  }
}

async function deleteFile(svc: DriveService, fileId: string): Promise<void> {
  const spinner = ora("Deleting file…").start();
  await svc.deleteFile(fileId);
  spinner.stop();
  console.log(`Deleted file: ${chalk.bold(fileId)}`);
}

async function createFolder(svc: DriveService, name: string, args: string[]): Promise<void> {
  const parentFlag = args.indexOf("--folder");
  const parentId = parentFlag !== -1 ? args[parentFlag + 1] : undefined;

  const spinner = ora(`Creating folder "${name}"…`).start();
  const folder = await svc.createFolder(name, parentId);
  spinner.stop();

  console.log(`Created folder: ${chalk.bold(folder.name)}`);
  console.log(`ID: ${folder.id}`);
}

async function moveFile(svc: DriveService, fileId: string, folderId: string): Promise<void> {
  const spinner = ora("Moving file…").start();
  const file = await svc.moveFile(fileId, folderId);
  spinner.stop();

  console.log(`Moved: ${chalk.bold(file.name)}`);
  console.log(`New location: ${folderId}`);
}

async function shareFile(svc: DriveService, fileId: string): Promise<void> {
  const spinner = ora("Fetching sharing permissions…").start();
  const permissions = await svc.getFilePermissions(fileId);
  spinner.stop();

  if (permissions.length === 0) {
    logger.info("No sharing permissions found.");
    return;
  }

  console.log(chalk.bold(`Permissions for ${fileId}:`));
  for (const perm of permissions) {
    const who = perm.emailAddress ?? perm.displayName ?? perm.type ?? "unknown";
    console.log(`  ${chalk.cyan(perm.role ?? "?")} — ${who}`);
  }
}

async function driveStats(svc: DriveService): Promise<void> {
  const spinner = ora("Fetching Drive storage stats…").start();
  const quota = await svc.getStorageQuota();
  spinner.stop();

  const used = formatBytes(quota.usage);
  const limit = formatBytes(quota.limit);
  const inDrive = formatBytes(quota.usageInDrive);
  const inTrash = formatBytes(quota.usageInDriveTrash);

  console.log(chalk.bold("Google Drive Storage"));
  console.log(`  Used:        ${chalk.yellow(used)} / ${limit}`);
  console.log(`  In Drive:    ${inDrive}`);
  console.log(`  In Trash:    ${inTrash}`);
}

function buildDriveRegistry(): CommandRegistry<DriveService> {
  return new CommandRegistry<DriveService>()
    .register("list", (svc, args) => listFiles(svc, args))
    .register("get", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: fileId is required", "gwork drive get <fileId>");
      }
      return getFile(svc, args[0]!);
    })
    .register("search", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: search query is required", "gwork drive search <query>");
      }
      return searchFiles(svc, args[0]!, args.slice(1));
    })
    .register("download", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: fileId is required", "gwork drive download <fileId> [--output <path>]");
      }
      return downloadFile(svc, args[0]!, args.slice(1));
    })
    .register("upload", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: file path is required", "gwork drive upload <path> [--name <name>] [--folder <folderId>]");
      }
      return uploadFile(svc, args[0]!, args.slice(1));
    })
    .register("delete", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: fileId is required", "gwork drive delete <fileId> --confirm");
      }
      if (!args.includes("--confirm")) {
        throw new ArgumentError("Error: --confirm flag required for delete", "gwork drive delete <fileId> --confirm");
      }
      return deleteFile(svc, args[0]!);
    })
    .register("mkdir", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: folder name is required", "gwork drive mkdir <name> [--folder <parentId>]");
      }
      return createFolder(svc, args[0]!, args.slice(1));
    })
    .register("move", (svc, args) => {
      if (args.length < 2) {
        throw new ArgumentError("Error: fileId and folderId are required", "gwork drive move <fileId> <folderId>");
      }
      return moveFile(svc, args[0]!, args[1]!);
    })
    .register("share", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: fileId is required", "gwork drive share <fileId>");
      }
      return shareFile(svc, args[0]!);
    })
    .register("stats", (svc) => driveStats(svc));
}

type DriveServiceFactory = (account: string) => DriveService;

export async function handleDriveCommand(
  subcommand: string,
  args: string[],
  account = "default",
  serviceFactory: DriveServiceFactory = (acc) => new DriveService(acc)
) {
  const driveService = serviceFactory(account);
  await ensureInitialized(driveService);
  await buildDriveRegistry().execute(subcommand, driveService, args);
}
