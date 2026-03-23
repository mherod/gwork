/**
 * Google Docs service wrapper for Google Docs API v1.
 * Provides methods for reading document content and metadata.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import type { docs_v1 } from "googleapis";

export interface DocMeta {
  documentId: string;
  title: string;
  revisionId: string;
  suggestionsViewMode: string;
}

export interface DocContent {
  documentId: string;
  title: string;
  bodyText: string;
  wordCount: number;
  headers: string[];
}

export class DocsService extends BaseService {
  private docs: docs_v1.Docs | null = null;

  constructor(account = "default") {
    super(
      "Docs",
      [
        "https://www.googleapis.com/auth/documents.readonly",
      ],
      account
    );
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    this.docs = google.docs({ version: "v1", auth: this.getAuth() });
    await this.verifyAccount();
  }

  /**
   * Get document metadata without full content.
   */
  async getDocument(documentId: string): Promise<DocMeta> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.docs!.documents.get({
        documentId,
        fields: "documentId,title,revisionId,suggestionsViewMode",
      });

      return {
        documentId: result.data.documentId || documentId,
        title: result.data.title || "",
        revisionId: result.data.revisionId || "",
        suggestionsViewMode: result.data.suggestionsViewMode || "",
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get document");
    }
  }

  /**
   * Read document content as plain text, extracting text from structural elements.
   */
  async readContent(documentId: string): Promise<DocContent> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.docs!.documents.get({
        documentId,
      });

      const doc = result.data;
      const textParts: string[] = [];
      const headers: string[] = [];

      // Extract text from body content
      if (doc.body?.content) {
        for (const element of doc.body.content) {
          if (element.paragraph) {
            const paragraphText = this.extractParagraphText(element.paragraph);

            // Detect headings
            const style = element.paragraph.paragraphStyle?.namedStyleType;
            if (style?.startsWith("HEADING_")) {
              headers.push(paragraphText.trim());
            }

            textParts.push(paragraphText);
          } else if (element.table) {
            textParts.push(this.extractTableText(element.table));
          } else if (element.sectionBreak) {
            textParts.push("\n");
          }
        }
      }

      const bodyText = textParts.join("");
      const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

      return {
        documentId: doc.documentId || documentId,
        title: doc.title || "",
        bodyText,
        wordCount,
        headers,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "read document");
    }
  }

  /**
   * Extract plain text from a paragraph element.
   */
  private extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
    const parts: string[] = [];
    if (paragraph.elements) {
      for (const element of paragraph.elements) {
        if (element.textRun?.content) {
          parts.push(element.textRun.content);
        } else if (element.inlineObjectElement) {
          parts.push("[image]");
        }
      }
    }
    return parts.join("");
  }

  /**
   * Extract plain text from a table element.
   */
  private extractTableText(table: docs_v1.Schema$Table): string {
    const rows: string[] = [];
    if (table.tableRows) {
      for (const row of table.tableRows) {
        const cells: string[] = [];
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            const cellText: string[] = [];
            if (cell.content) {
              for (const element of cell.content) {
                if (element.paragraph) {
                  cellText.push(this.extractParagraphText(element.paragraph).trim());
                }
              }
            }
            cells.push(cellText.join(" "));
          }
        }
        rows.push(cells.join("\t"));
      }
    }
    return rows.join("\n") + "\n";
  }
}
