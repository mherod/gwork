import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArgumentError } from "../../../src/services/errors.ts";
import type { SheetsService, SpreadsheetMeta } from "../../../src/services/sheets-service.ts";

void mock.module("ora", () => ({ default: () => ({ start: () => ({ stop() {} }) }) }));
const errors: unknown[] = [];
void mock.module("../../../src/utils/command-error-handler.ts", () => ({
  logServiceError: (error: unknown) => { errors.push(error); },
}));
import { handleSheetsCommand } from "../../../src/commands/sheets.ts";

const metadata: SpreadsheetMeta = {
  spreadsheetId: "book", title: "Budget", locale: "en_GB", timeZone: "Europe/London", url: "https://example.com/book",
  sheets: [
    { sheetId: 1, title: "Costs", index: 0, rowCount: 100, columnCount: 4, hidden: false },
    { sheetId: 2, title: "Archive", index: 1, rowCount: 20, columnCount: 2, hidden: true },
  ],
};

describe("handleSheetsCommand", () => {
  let log: ReturnType<typeof spyOn>;
  let exit: ReturnType<typeof spyOn>;
  let tempDir: string;
  const getSpreadsheet = mock(async () => metadata);
  const readRange = mock(async () => ({ range: "Costs!A1:B3", values: [["Item", "Price"], ["Coffee", "2"], ["Tea"]] }));
  const appendRows = mock(async () => ({ updatedRange: "Costs!A4:B5", updatedRows: 2 }));
  const initialize = mock(async () => {});
  const factory = mock((_account: string) => ({ initialize, getSpreadsheet, readRange, appendRows }) as unknown as SheetsService);
  const output = () => log.mock.calls.map((call: unknown[]) => call[0]).join("\n");
  const lastOutput = () => String(log.mock.calls.at(-1)?.[0]);

  beforeEach(() => {
    errors.length = 0;
    initialize.mockClear();
    factory.mockClear();
    getSpreadsheet.mockReset().mockResolvedValue(metadata);
    readRange.mockReset().mockResolvedValue({ range: "Costs!A1:B3", values: [["Item", "Price"], ["Coffee", "2"], ["Tea"]] });
    appendRows.mockReset().mockResolvedValue({ updatedRange: "Costs!A4:B5", updatedRows: 2 });
    log = spyOn(console, "log").mockImplementation(() => {});
    exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
    tempDir = mkdtempSync(join(tmpdir(), "gwork-sheets-command-"));
  });

  afterEach(() => {
    log.mockRestore();
    exit.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists tabs with dimensions, hidden status and the selected account", async () => {
    await handleSheetsCommand("list", ["book"], "work@example.com", factory);
    expect(factory).toHaveBeenCalledWith("work@example.com");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(getSpreadsheet).toHaveBeenCalledWith("book");
    for (const text of ["Budget", "Costs", "100×4", "Archive", "(hidden)", "2 sheet(s)"]) expect(output()).toContain(text);
    expect(exit).not.toHaveBeenCalled();
  });

  it("gets spreadsheet metadata including locale, timezone and link", async () => {
    await handleSheetsCommand("get", ["book"], "default", factory);
    expect(getSpreadsheet).toHaveBeenCalledWith("book");
    for (const text of ["Budget", "book", "en_GB", "Europe/London", "https://example.com/book", "1. Costs"]) expect(output()).toContain(text);
  });

  it("reads a specified range as an aligned table with a header separator", async () => {
    await handleSheetsCommand("read", ["book", "Costs!A1:B3"], "default", factory);
    expect(readRange).toHaveBeenCalledWith("book", "Costs!A1:B3");
    for (const text of ["3 rows", "Item", "Coffee", "Tea", "─"]) expect(output()).toContain(text);
  });

  it("allows a default range and suppresses table headers", async () => {
    await handleSheetsCommand("read", ["book", "--no-header"], "default", factory);
    expect(readRange).toHaveBeenCalledWith("book", undefined);
    expect(output()).toContain("Item");
    expect(output()).not.toContain("─");
  });

  it("reports empty ranges without rendering a table", async () => {
    readRange.mockResolvedValue({ range: "Empty!A1", values: [] });
    await handleSheetsCommand("read", ["book"], "default", factory);
    expect(output()).toContain("No data found.");
    expect(output()).not.toContain("─");
  });

  it("uses headers as JSON keys and fills missing cells", async () => {
    await handleSheetsCommand("read", ["book", "--format", "json"], "default", factory);
    expect(JSON.parse(lastOutput())).toEqual([{ Item: "Coffee", Price: "2" }, { Item: "Tea", Price: "" }]);
  });

  it("keeps all rows as arrays with --no-header JSON", async () => {
    await handleSheetsCommand("read", ["book", "--format", "json", "--no-header"], "default", factory);
    expect(JSON.parse(lastOutput())).toEqual([["Item", "Price"], ["Coffee", "2"], ["Tea"]]);
  });

  it("quotes commas, quotes and newlines in CSV output", async () => {
    readRange.mockResolvedValue({ range: "A1:C1", values: [["a,b", 'say "hi"', "two\nlines"]] });
    await handleSheetsCommand("read", ["book", "--format", "csv"], "default", factory);
    expect(lastOutput()).toBe('"a,b","say ""hi""","two\nlines"');
  });

  it("exports the requested sheet as CSV on stdout", async () => {
    await handleSheetsCommand("export", ["book", "--sheet", "Costs"], "default", factory);
    expect(readRange).toHaveBeenCalledWith("book", "Costs");
    expect(output()).toBe("Item,Price\nCoffee,2\nTea");
  });

  it("writes CSV to the requested output file", async () => {
    const destination = join(tempDir, "export.csv");
    await handleSheetsCommand("export", ["book", "--output", destination], "default", factory);
    expect(readFileSync(destination, "utf8")).toBe("Item,Price\nCoffee,2\nTea");
    expect(output()).toContain(`Exported 3 rows to ${destination}`);
  });

  it("reports output file failures without printing a success receipt", async () => {
    await handleSheetsCommand("export", ["book", "--output", join(tempDir, "missing", "export.csv")], "default", factory);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(exit).toHaveBeenCalledWith(1);
    expect(output()).not.toContain("Exported");
  });

  it("appends comma-separated and JSON rows with embedded commas", async () => {
    await handleSheetsCommand("append", ["book", "Costs!A:B", "Coffee,2", '["Tea, large",3,true]'], "default", factory);
    expect(appendRows).toHaveBeenCalledWith("book", "Costs!A:B", [["Coffee", "2"], ["Tea, large", "3", "true"]]);
    expect(output()).toContain("Appended 2 row(s) to Costs!A4:B5");
  });

  for (const args of [["book"], ["book", "Costs!A:B"]]) {
    it(`rejects append when range or values are absent (${args.length} args)`, async () => {
      await handleSheetsCommand("append", args, "default", factory);
      expect(errors[0]).toBeInstanceOf(ArgumentError);
      expect(appendRows).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  }

  for (const [command, args, endpoint] of [
    ["list", ["book"], getSpreadsheet], ["get", ["book"], getSpreadsheet],
    ["read", ["book"], readRange], ["export", ["book"], readRange],
    ["append", ["book", "A1", "one"], appendRows],
  ] as const) {
    it(`rejects ${command} without a spreadsheet ID`, async () => {
      await handleSheetsCommand(command, [], "default", factory);
      expect(errors[0]).toBeInstanceOf(ArgumentError);
      expect(exit).toHaveBeenCalledWith(1);
      expect(endpoint).not.toHaveBeenCalled();
    });

    it(`reports ${command} service failures and exits`, async () => {
      const error = new Error("Spreadsheet unavailable");
      endpoint.mockRejectedValue(error);
      await handleSheetsCommand(command, [...args], "default", factory);
      expect(errors).toEqual([error]);
      expect(exit).toHaveBeenCalledWith(1);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  }
});
