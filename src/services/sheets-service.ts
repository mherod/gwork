/**
 * Google Sheets service wrapper for Google Sheets API v4.
 * Provides methods for reading spreadsheet data, listing sheets,
 * and appending rows.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import type { sheets_v4 } from "googleapis";

export interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  locale: string;
  timeZone: string;
  sheets: SheetInfo[];
  url: string;
}

export interface SheetData {
  range: string;
  values: string[][];
}

export class SheetsService extends BaseService {
  private sheets: sheets_v4.Sheets | null = null;

  constructor(account = "default") {
    super(
      "Sheets",
      [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
      account
    );
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    this.sheets = google.sheets({ version: "v4", auth: this.getAuth() });
  }

  /**
   * Get spreadsheet metadata including all sheet/tab names.
   */
  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetMeta> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.sheets!.spreadsheets.get({
        spreadsheetId,
        fields: "spreadsheetId,properties(title,locale,timeZone),spreadsheetUrl,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount),hidden))",
      });

      const props = result.data.properties || {};
      const sheetsData = result.data.sheets || [];

      return {
        spreadsheetId: result.data.spreadsheetId || spreadsheetId,
        title: props.title || "",
        locale: props.locale || "",
        timeZone: props.timeZone || "",
        url: result.data.spreadsheetUrl || "",
        sheets: sheetsData.map((s) => {
          const sp = s.properties || {};
          const gp = sp.gridProperties || {};
          return {
            sheetId: sp.sheetId || 0,
            title: sp.title || "",
            index: sp.index || 0,
            rowCount: gp.rowCount || 0,
            columnCount: gp.columnCount || 0,
            hidden: sp.hidden || false,
          };
        }),
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get spreadsheet");
    }
  }

  /**
   * Read cell values from a range (e.g. "Sheet1!A1:D10" or "A1:D10").
   * If no range is given, reads the first sheet entirely.
   */
  async readRange(spreadsheetId: string, range?: string): Promise<SheetData> {
    await this.initialize();
    this.ensureInitialized();

    // If no range specified, read the first sheet
    const effectiveRange = range || (await this.getFirstSheetName(spreadsheetId));

    try {
      const result = await this.sheets!.spreadsheets.values.get({
        spreadsheetId,
        range: effectiveRange,
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });

      return {
        range: result.data.range || effectiveRange,
        values: (result.data.values || []) as string[][],
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "read range");
    }
  }

  /**
   * Read multiple ranges in a single API call.
   */
  async readRanges(spreadsheetId: string, ranges: string[]): Promise<SheetData[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.sheets!.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });

      return (result.data.valueRanges || []).map((vr) => ({
        range: vr.range || "",
        values: (vr.values || []) as string[][],
      }));
    } catch (error: unknown) {
      handleGoogleApiError(error, "read ranges");
    }
  }

  /**
   * Append rows to a sheet range.
   */
  async appendRows(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<{ updatedRange: string; updatedRows: number }> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.sheets!.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      });

      const updates = result.data.updates || {};
      return {
        updatedRange: updates.updatedRange || range,
        updatedRows: updates.updatedRows || values.length,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "append rows");
    }
  }

  /**
   * Get the name of the first (visible) sheet in the spreadsheet.
   */
  private async getFirstSheetName(spreadsheetId: string): Promise<string> {
    const meta = await this.getSpreadsheet(spreadsheetId);
    const firstVisible = meta.sheets.find((s) => !s.hidden);
    return firstVisible?.title || meta.sheets[0]?.title || "Sheet1";
  }
}
