import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { flattenParts, handleMailCommand } from "../../../src/commands/mail.ts";
import fs from "node:fs";

// Silence ora spinner output during tests
void mock.module("ora", () => ({
  default: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

// ─── flattenParts ────────────────────────────────────────────────────────────

describe("flattenParts", () => {
  test("returns empty array for empty input", () => {
    expect(flattenParts([])).toEqual([]);
  });

  test("returns flat list unchanged when no nested parts", () => {
    const parts = [
      { mimeType: "text/plain", body: { data: "aGVsbG8=" } },
      { mimeType: "application/pdf", body: { attachmentId: "att1" } },
    ];
    expect(flattenParts(parts)).toEqual(parts);
  });

  test("flattens one level of nesting", () => {
    const leaf1 = { mimeType: "text/plain", body: { data: "aA==" } };
    const leaf2 = { mimeType: "text/html", body: { data: "PGI+PC9i" } };
    const parent = { mimeType: "multipart/alternative", parts: [leaf1, leaf2] };

    const result = flattenParts([parent]);
    expect(result).toHaveLength(3);
    expect(result).toContain(parent);
    expect(result).toContain(leaf1);
    expect(result).toContain(leaf2);
  });

  test("flattens deeply nested multipart tree", () => {
    const pdf = { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att-deep", size: 1024 } };
    const inner = { mimeType: "multipart/related", parts: [pdf] };
    const outer = { mimeType: "multipart/mixed", parts: [inner] };

    const result = flattenParts([outer]);
    expect(result).toHaveLength(3);
    // The deeply nested pdf part must be present
    expect(result.some((p) => p.filename === "invoice.pdf")).toBe(true);
  });

  test("preserves sibling parts at multiple levels", () => {
    const a = { mimeType: "text/plain", body: {} };
    const b = { mimeType: "text/html", body: {} };
    const c = { mimeType: "application/pdf", filename: "file.pdf", body: { attachmentId: "x" } };
    const mixed = { mimeType: "multipart/mixed", parts: [b, c] };
    const root = [a, mixed];

    const result = flattenParts(root);
    expect(result).toHaveLength(4); // a, mixed, b, c
    expect(result).toContain(a);
    expect(result).toContain(b);
    expect(result).toContain(c);
  });
});

// ─── downloadAttachment inline-data fallback ─────────────────────────────────

describe("downloadAttachment inline-data fallback", () => {
  const MSG_ID = "msg-001";
  const ATT_ID = "att-001";
  const PDF_DATA = Buffer.from("PDF-BYTES");
  const PDF_B64 = PDF_DATA.toString("base64");

  // The part as it appears in a GCP billing email:
  // body.data is populated AND body.attachmentId is set.
  const inlinePdfPart = {
    mimeType: "application/pdf",
    filename: "invoice.pdf",
    body: { attachmentId: ATT_ID, size: PDF_DATA.length, data: PDF_B64 },
  };

  // A standard large attachment: no inline data, only attachmentId.
  const externalPdfPart = {
    mimeType: "application/pdf",
    filename: "report.pdf",
    body: { attachmentId: ATT_ID, size: 2_000_000 },
  };

  let writeFileSyncSpy: ReturnType<typeof spyOn>;
  let getAttachmentMock: ReturnType<typeof mock>;
  let getMessageMock: ReturnType<typeof mock>;

  function makeServiceFactory(messagePart: any) {
    getMessageMock = mock(async () => ({
      payload: { parts: [messagePart] },
    }));
    getAttachmentMock = mock(async () => ({
      data: PDF_B64,
    }));

    return () => ({
      initialize: mock(async () => {}),
      getMessage: getMessageMock,
      getAttachment: getAttachmentMock,
    });
  }

  beforeEach(() => {
    writeFileSyncSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {});
  });

  afterEach(() => {
    writeFileSyncSpy.mockRestore();
  });

  test("uses inline body.data when present — does NOT call getAttachment", async () => {
    const factory = makeServiceFactory(inlinePdfPart);

    await handleMailCommand("download", [MSG_ID, ATT_ID], "default", factory as any);

    // getMessage should be called to load the message
    expect(getMessageMock).toHaveBeenCalledWith(MSG_ID, "full");
    // getAttachment must NOT be called — the data was already inline
    expect(getAttachmentMock).not.toHaveBeenCalled();
    // The file must be written with the correct bytes
    expect(writeFileSyncSpy).toHaveBeenCalledWith("invoice.pdf", PDF_DATA);
  });

  test("falls back to getAttachment when body.data is absent", async () => {
    const factory = makeServiceFactory(externalPdfPart);

    await handleMailCommand("download", [MSG_ID, ATT_ID], "default", factory as any);

    expect(getMessageMock).toHaveBeenCalledWith(MSG_ID, "full");
    // No inline data → must call the attachments API
    expect(getAttachmentMock).toHaveBeenCalledWith(MSG_ID, ATT_ID);
    expect(writeFileSyncSpy).toHaveBeenCalledWith("report.pdf", PDF_DATA);
  });

  test("uses inline body.data from a deeply nested part", async () => {
    // GCP billing emails can nest under multipart/related
    const innerMixed = {
      mimeType: "multipart/related",
      parts: [inlinePdfPart],
    };
    getMessageMock = mock(async () => ({
      payload: { parts: [innerMixed] },
    }));
    getAttachmentMock = mock(async () => ({ data: PDF_B64 }));

    const factory = () => ({
      initialize: mock(async () => {}),
      getMessage: getMessageMock,
      getAttachment: getAttachmentMock,
    });

    await handleMailCommand("download", [MSG_ID, ATT_ID], "default", factory as any);

    expect(getAttachmentMock).not.toHaveBeenCalled();
    expect(writeFileSyncSpy).toHaveBeenCalledWith("invoice.pdf", PDF_DATA);
  });

  test("uses caller-supplied filename instead of part filename", async () => {
    const factory = makeServiceFactory(inlinePdfPart);

    await handleMailCommand("download", [MSG_ID, ATT_ID, "/tmp/my-invoice.pdf"], "default", factory as any);

    expect(writeFileSyncSpy).toHaveBeenCalledWith("/tmp/my-invoice.pdf", PDF_DATA);
  });

  test("falls back to hash-based filename when part has no filename", async () => {
    const partNoFilename = {
      mimeType: "application/pdf",
      body: { attachmentId: ATT_ID, size: 100, data: PDF_B64 },
    };
    const factory = makeServiceFactory(partNoFilename);

    await handleMailCommand("download", [MSG_ID, ATT_ID], "default", factory as any);

    // Should write to a hash-based name derived from the attachment ID
    const writtenPath = (writeFileSyncSpy.mock.calls[0] as [string, Buffer])[0];
    expect(writtenPath).toMatch(/^attachment-[a-zA-Z0-9_-]+$/);
  });
});
