import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { google, type sheets_v4 } from "googleapis";
import { SheetsService } from "../../../src/services/sheets-service.ts";
import { PermissionDeniedError } from "../../../src/services/errors.ts";
import { mockWorkspaceAuth } from "../helpers/workspace-service.ts";

describe("SheetsService", () => {
  let auth: ReturnType<typeof mockWorkspaceAuth>;
  let service: SheetsService;
  let clientSpy: ReturnType<typeof spyOn<typeof google, "sheets">>;
  const get = mock(async () => ({ data: {} as sheets_v4.Schema$Spreadsheet }));
  const valuesGet = mock(async () => ({ data: {} as sheets_v4.Schema$ValueRange }));
  const batchGet = mock(async () => ({ data: {} as sheets_v4.Schema$BatchGetValuesResponse }));
  const append = mock(async () => ({ data: {} as sheets_v4.Schema$AppendValuesResponse }));

  beforeEach(() => {
    auth = mockWorkspaceAuth();
    get.mockReset().mockResolvedValue({ data: {} });
    valuesGet.mockReset().mockResolvedValue({ data: {} });
    batchGet.mockReset().mockResolvedValue({ data: {} });
    append.mockReset().mockResolvedValue({ data: {} });
    clientSpy = spyOn(google, "sheets").mockReturnValue({
      spreadsheets: { get, values: { get: valuesGet, batchGet, append } },
    } as unknown as sheets_v4.Sheets);
    service = new SheetsService();
  });

  afterEach(() => {
    clientSpy.mockRestore();
    auth.restore();
  });

  it("initializes a v4 client with read and write scopes without checking the default account", async () => {
    await service.initialize();
    await service.initialize();
    expect(auth.authenticate).toHaveBeenCalledTimes(1);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({
      service: "Sheets", account: "default", forceReauth: false,
      requiredScopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/spreadsheets"],
    }));
    expect(clientSpy).toHaveBeenCalledWith({ version: "v4", auth: auth.auth });
    expect(auth.oauth).not.toHaveBeenCalled();
  });

  it("accepts the requested account regardless of email case and forwards forced authentication", async () => {
    service = new SheetsService("WORK@example.com");
    await service.initialize(true);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({ forceReauth: true }));
    expect(auth.userinfo).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched accounts before reading spreadsheet data", async () => {
    service = new SheetsService("other@example.com");
    const mismatch = await service.getSpreadsheet("book").catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as Error).message).toContain('Run "gwork sheets --account other@example.com" to re-authenticate the correct account.');
    expect(get).not.toHaveBeenCalled();
  });

  it("maps spreadsheet properties and sheet visibility/dimensions", async () => {
    get.mockResolvedValue({ data: {
      spreadsheetId: "book", spreadsheetUrl: "https://example.com/book", properties: { title: "Budget", locale: "en_GB", timeZone: "Europe/London" },
      sheets: [{ properties: { sheetId: 7, title: "Costs", index: 2, hidden: true, gridProperties: { rowCount: 100, columnCount: 8 } } }, {}],
    } });
    expect(await service.getSpreadsheet("book")).toEqual({
      spreadsheetId: "book", title: "Budget", locale: "en_GB", timeZone: "Europe/London", url: "https://example.com/book",
      sheets: [{ sheetId: 7, title: "Costs", index: 2, hidden: true, rowCount: 100, columnCount: 8 }, { sheetId: 0, title: "", index: 0, hidden: false, rowCount: 0, columnCount: 0 }],
    });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "book", fields: "spreadsheetId,properties(title,locale,timeZone),spreadsheetUrl,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount),hidden))" });
  });

  it("supplies defaults for missing spreadsheet properties", async () => {
    expect(await service.getSpreadsheet("book")).toEqual({ spreadsheetId: "book", title: "", locale: "", timeZone: "", url: "", sheets: [] });
  });

  it("reads an explicit range as formatted strings without fetching metadata", async () => {
    valuesGet.mockResolvedValue({ data: { range: "Costs!A1:B2", values: [["Date", "Price"], ["1/1/2026", "£2.00"]] } });
    expect(await service.readRange("book", "Costs!A1:B2")).toEqual({ range: "Costs!A1:B2", values: [["Date", "Price"], ["1/1/2026", "£2.00"]] });
    expect(valuesGet).toHaveBeenCalledWith({ spreadsheetId: "book", range: "Costs!A1:B2", valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
    expect(get).not.toHaveBeenCalled();
  });

  for (const [sheets, expected] of [
    [[{ properties: { title: "Hidden", hidden: true } }, { properties: { title: "Visible", hidden: false } }], "Visible"],
    [[{ properties: { title: "Hidden", hidden: true } }], "Hidden"],
    [[], "Sheet1"],
  ] as const) {
    it(`chooses ${expected} when no range is given`, async () => {
      get.mockResolvedValue({ data: { sheets: [...sheets] } });
      expect(await service.readRange("book")).toEqual({ range: expected, values: [] });
      expect(valuesGet).toHaveBeenCalledWith(expect.objectContaining({ range: expected }));
    });
  }

  it("reads multiple ranges in one batch and preserves empty ranges", async () => {
    batchGet.mockResolvedValue({ data: { valueRanges: [{ range: "A1", values: [["one"]] }, { range: "B1" }, {}] } });
    expect(await service.readRanges("book", ["A1", "B1", "C1"])).toEqual([{ range: "A1", values: [["one"]] }, { range: "B1", values: [] }, { range: "", values: [] }]);
    expect(batchGet).toHaveBeenCalledWith({ spreadsheetId: "book", ranges: ["A1", "B1", "C1"], valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
  });

  it("returns no ranges when the batch response is empty", async () => {
    expect(await service.readRanges("book", [])).toEqual([]);
  });

  it("appends user-entered rows and returns the API update receipt", async () => {
    append.mockResolvedValue({ data: { updates: { updatedRange: "Costs!A10:B11", updatedRows: 2 } } });
    const values = [["Item", "2"], ["=SUM(B1:B9)", "3"]];
    expect(await service.appendRows("book", "Costs!A:B", values)).toEqual({ updatedRange: "Costs!A10:B11", updatedRows: 2 });
    expect(append).toHaveBeenCalledWith({ spreadsheetId: "book", range: "Costs!A:B", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values } });
  });

  it("uses requested range and row count if append omits its update receipt", async () => {
    expect(await service.appendRows("book", "A:B", [["one"], ["two"]])).toEqual({ updatedRange: "A:B", updatedRows: 2 });
  });

  for (const [operation, context, endpoint] of [
    [() => service.getSpreadsheet("book"), "get spreadsheet", get],
    [() => service.readRange("book", "A1"), "read range", valuesGet],
    [() => service.readRange("book"), "get spreadsheet", get],
    [() => service.readRanges("book", ["A1"]), "read ranges", batchGet],
    [() => service.appendRows("book", "A1", [["one"]]), "append rows", append],
  ] as const) {
    it(`routes ${context} failures through handleGoogleApiError`, async () => {
      const error = { code: 403, message: "Access denied" };
      endpoint.mockRejectedValue(error);
      const failure = await operation().catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(PermissionDeniedError);
      expect(auth.apiError).toHaveBeenCalledWith(error, context);
    });
  }
});
