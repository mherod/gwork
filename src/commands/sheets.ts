import chalk from "chalk";
import ora from "ora";
import { SheetsService } from "../services/sheets-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { handleCommandWithRetry } from "../utils/command-handler.ts";
import { CommandRegistry } from "./registry.ts";

/**
 * Render a 2D array as a formatted table with column alignment.
 */
function renderTable(values: string[][], hasHeader: boolean): void {
  if (values.length === 0) {
    console.log(chalk.gray("(empty)"));
    return;
  }

  // Calculate column widths
  const colCount = Math.max(...values.map((r) => r.length));
  const widths: number[] = Array.from({ length: colCount }, () => 0);

  for (const row of values) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? "";
      widths[i] = Math.max(widths[i]!, cell.length);
    }
  }

  // Cap column widths to keep output manageable
  const maxColWidth = 40;
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.min(widths[i]!, maxColWidth);
  }

  const formatRow = (row: string[]): string => {
    return row
      .map((cell, i) => {
        const w = widths[i] ?? 10;
        const truncated = cell.length > w ? cell.slice(0, w - 1) + "…" : cell;
        return truncated.padEnd(w);
      })
      .join("  ");
  };

  const separator = widths.map((w) => "─".repeat(w)).join("──");

  if (hasHeader && values.length > 0) {
    console.log(chalk.bold(formatRow(values[0]!)));
    console.log(chalk.gray(separator));
    for (const row of values.slice(1)) {
      console.log(formatRow(row));
    }
  } else {
    for (const row of values) {
      console.log(formatRow(row));
    }
  }
}

/**
 * Convert a 2D array to CSV format.
 */
function toCsv(values: string[][]): string {
  return values
    .map((row) =>
      row
        .map((cell) => {
          // Quote cells that contain commas, quotes, or newlines
          if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(",")
    )
    .join("\n");
}

async function listSheets(svc: SheetsService, spreadsheetId: string): Promise<void> {
  const spinner = ora("Fetching spreadsheet info…").start();
  const meta = await svc.getSpreadsheet(spreadsheetId);
  spinner.stop();

  console.log(`${chalk.bold(meta.title)}`);
  console.log(`${chalk.gray(meta.url)}\n`);

  for (const sheet of meta.sheets) {
    const hidden = sheet.hidden ? chalk.red(" (hidden)") : "";
    const dims = chalk.gray(`${sheet.rowCount}×${sheet.columnCount}`);
    console.log(`  ${chalk.cyan(sheet.title)} ${dims}${hidden}`);
  }
  console.log(chalk.gray(`\n${meta.sheets.length} sheet(s)`));
}

async function getSpreadsheet(svc: SheetsService, spreadsheetId: string): Promise<void> {
  const spinner = ora("Fetching spreadsheet metadata…").start();
  const meta = await svc.getSpreadsheet(spreadsheetId);
  spinner.stop();

  console.log(`Title:    ${chalk.bold(meta.title)}`);
  console.log(`ID:       ${meta.spreadsheetId}`);
  console.log(`Locale:   ${meta.locale}`);
  console.log(`Timezone: ${meta.timeZone}`);
  console.log(`Sheets:   ${meta.sheets.length}`);
  console.log(`Link:     ${meta.url}`);

  if (meta.sheets.length > 0) {
    console.log(`\n${chalk.bold("Sheets:")}`);
    for (const sheet of meta.sheets) {
      const hidden = sheet.hidden ? chalk.red(" (hidden)") : "";
      console.log(`  ${sheet.index + 1}. ${chalk.cyan(sheet.title)} — ${sheet.rowCount}×${sheet.columnCount}${hidden}`);
    }
  }
}

async function readSheet(svc: SheetsService, spreadsheetId: string, args: string[]): Promise<void> {
  // Range is the first non-flag argument
  const range = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const noHeader = args.includes("--no-header");
  const format = extractFlag(args, "--format") || "table";

  const spinner = ora("Reading sheet data…").start();
  const data = await svc.readRange(spreadsheetId, range);
  spinner.stop();

  console.log(chalk.gray(`Range: ${data.range}  (${data.values.length} rows)\n`));

  if (data.values.length === 0) {
    console.log(chalk.gray("No data found."));
    return;
  }

  if (format === "csv") {
    console.log(toCsv(data.values));
  } else if (format === "json") {
    if (data.values.length > 1 && !noHeader) {
      const headers = data.values[0]!;
      const rows = data.values.slice(1).map((row) => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]!] = row[i] ?? "";
        }
        return obj;
      });
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(JSON.stringify(data.values, null, 2));
    }
  } else {
    renderTable(data.values, !noHeader);
  }
}

async function exportSheet(svc: SheetsService, spreadsheetId: string, args: string[]): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const sheetName = extractFlag(args, "--sheet");
  const outputPath = extractFlag(args, "--output");

  const range = sheetName || undefined;

  const spinner = ora("Exporting sheet data…").start();
  const data = await svc.readRange(spreadsheetId, range);
  spinner.stop();

  const csv = toCsv(data.values);

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, csv, "utf-8");
    console.log(`Exported ${data.values.length} rows to ${chalk.bold(resolved)}`);
  } else {
    console.log(csv);
  }
}

async function appendRows(svc: SheetsService, spreadsheetId: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    throw new ArgumentError(
      "Error: range and values are required",
      'gwork sheets append <fileId> <range> <value1,value2,...> [<value3,value4,...>]'
    );
  }

  const range = args[0]!;
  // Each remaining arg is a comma-separated row
  const values = args.slice(1).map((row) => row.split(","));

  const spinner = ora("Appending rows…").start();
  const result = await svc.appendRows(spreadsheetId, range, values);
  spinner.stop();

  console.log(`Appended ${chalk.bold(String(result.updatedRows))} row(s) to ${chalk.cyan(result.updatedRange)}`);
}

/**
 * Extract a flag value from args (e.g., --format csv → "csv").
 */
function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function buildSheetsRegistry(): CommandRegistry<SheetsService> {
  return new CommandRegistry<SheetsService>()
    .register("list", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: spreadsheet ID is required", "gwork sheets list <fileId>");
      }
      return listSheets(svc, args[0]!);
    })
    .register("get", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: spreadsheet ID is required", "gwork sheets get <fileId>");
      }
      return getSpreadsheet(svc, args[0]!);
    })
    .register("read", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: spreadsheet ID is required",
          "gwork sheets read <fileId> [range] [--format table|csv|json] [--no-header]"
        );
      }
      return readSheet(svc, args[0]!, args.slice(1));
    })
    .register("export", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: spreadsheet ID is required",
          "gwork sheets export <fileId> [--sheet <name>] [--output <path>]"
        );
      }
      return exportSheet(svc, args[0]!, args.slice(1));
    })
    .register("append", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: spreadsheet ID is required",
          'gwork sheets append <fileId> <range> <val1,val2,...>'
        );
      }
      return appendRows(svc, args[0]!, args.slice(1));
    });
}

export async function handleSheetsCommand(
  subcommand: string,
  args: string[],
  account = "default",
  serviceFactory: (account: string) => SheetsService = (acc) => new SheetsService(acc)
) {
  await handleCommandWithRetry({
    tokenKey: "sheets",
    serviceName: "Sheets",
    account,
    subcommand,
    serviceFactory,
    execute: (svc) => buildSheetsRegistry().execute(subcommand, svc, args),
  });
}
