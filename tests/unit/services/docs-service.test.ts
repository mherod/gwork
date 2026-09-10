import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { google, type docs_v1 } from "googleapis";
import { DocsService } from "../../../src/services/docs-service.ts";
import { PermissionDeniedError } from "../../../src/services/errors.ts";
import { mockWorkspaceAuth } from "../helpers/workspace-service.ts";

describe("DocsService", () => {
  let auth: ReturnType<typeof mockWorkspaceAuth>;
  let service: DocsService;
  let clientSpy: ReturnType<typeof spyOn<typeof google, "docs">>;
  const get = mock(async () => ({ data: {} as docs_v1.Schema$Document }));
  const create = mock(async () => ({ data: {} as docs_v1.Schema$Document }));
  const batchUpdate = mock(async () => ({ data: {} }));

  beforeEach(() => {
    auth = mockWorkspaceAuth();
    get.mockReset().mockResolvedValue({ data: {} });
    create.mockReset().mockResolvedValue({ data: {} });
    batchUpdate.mockReset().mockResolvedValue({ data: {} });
    clientSpy = spyOn(google, "docs").mockReturnValue({
      documents: { get, create, batchUpdate },
    } as unknown as docs_v1.Docs);
    service = new DocsService();
  });

  afterEach(() => {
    clientSpy.mockRestore();
    auth.restore();
  });

  it("initializes the Docs client and requests document write scope", async () => {
    await service.initialize();
    await service.initialize();
    expect(auth.authenticate).toHaveBeenCalledTimes(1);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({
      service: "Docs", account: "default", forceReauth: false,
      requiredScopes: ["https://www.googleapis.com/auth/documents"],
    }));
    expect(clientSpy).toHaveBeenCalledWith({ version: "v1", auth: auth.auth });
    expect(auth.oauth).not.toHaveBeenCalled();
  });

  it("verifies named accounts case-insensitively and forwards forced authentication", async () => {
    service = new DocsService("WORK@example.com");
    await service.initialize(true);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({ forceReauth: true }));
    expect(auth.userinfo).toHaveBeenCalledTimes(1);
  });

  it("rejects account mismatch before requesting any document", async () => {
    service = new DocsService("other@example.com");
    const mismatch = await service.getDocument("doc-1").catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as Error).message).toContain(
      'Account mismatch: token is authenticated as "work@example.com" but "--account other@example.com" was requested.'
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("requests only metadata fields and maps the result", async () => {
    const data = { documentId: "doc-1", title: "Notes", revisionId: "rev-2", suggestionsViewMode: "DEFAULT_FOR_CURRENT_ACCESS" };
    get.mockResolvedValue({ data });
    expect(await service.getDocument("doc-1")).toEqual(data);
    expect(get).toHaveBeenCalledWith({ documentId: "doc-1", fields: "documentId,title,revisionId,suggestionsViewMode" });
  });

  it("supplies metadata defaults when optional response fields are absent", async () => {
    expect(await service.getDocument("doc-1")).toEqual({ documentId: "doc-1", title: "", revisionId: "", suggestionsViewMode: "" });
  });

  it("extracts headings, split text runs, images, tables and section breaks", async () => {
    get.mockResolvedValue({ data: {
      documentId: "doc-1", title: "Notes", body: { content: [
        { paragraph: { paragraphStyle: { namedStyleType: "HEADING_1" }, elements: [{ textRun: { content: "A heading\n" } }] } },
        { paragraph: { elements: [{ textRun: { content: "Hello " } }, { textRun: { content: "world " } }, { inlineObjectElement: { inlineObjectId: "img" } }, { textRun: { content: "\n" } }] } },
        { table: { tableRows: [{ tableCells: [
          { content: [{ paragraph: { elements: [{ textRun: { content: "One\n" } }] } }, { paragraph: { elements: [{ textRun: { content: "Two\n" } }] } }] },
          { content: [{ paragraph: { elements: [{ textRun: { content: "Three\n" } }] } }] },
        ] }, { tableCells: [{}, {}] }] } },
        { sectionBreak: {} },
        { paragraph: {} },
      ] },
    } });
    expect(await service.readContent("doc-1")).toEqual({
      documentId: "doc-1", title: "Notes", headers: ["A heading"],
      bodyText: "A heading\nHello world [image]\nOne Two\tThree\n\t\n\n", wordCount: 8,
    });
    expect(get).toHaveBeenCalledWith({ documentId: "doc-1" });
  });

  it("returns an empty body for a document without content", async () => {
    expect(await service.readContent("empty")).toEqual({ documentId: "empty", title: "", bodyText: "", wordCount: 0, headers: [] });
  });

  it("creates a document with the exact requested title", async () => {
    create.mockResolvedValue({ data: { documentId: "new-doc", title: "Server title" } });
    expect(await service.createDocument("Requested title")).toEqual({ documentId: "new-doc", title: "Server title" });
    expect(create).toHaveBeenCalledWith({ requestBody: { title: "Requested title" } });
  });

  it("keeps the requested title if create omits it", async () => {
    expect(await service.createDocument("Requested title")).toEqual({ documentId: "", title: "Requested title" });
  });

  it("inserts at an explicit index without fetching the document", async () => {
    await service.insertText("doc-1", "Inserted", 3);
    expect(get).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledWith({ documentId: "doc-1", requestBody: { requests: [{ insertText: { text: "Inserted", location: { index: 3 } } }] } });
  });

  it("appends immediately before the trailing body newline", async () => {
    get.mockResolvedValue({ data: { body: { content: [{ endIndex: 8 }, { endIndex: 21 }] } } });
    await service.insertText("doc-1", "Append");
    expect(get).toHaveBeenCalledWith({ documentId: "doc-1", fields: "body.content" });
    expect(batchUpdate).toHaveBeenCalledWith({ documentId: "doc-1", requestBody: { requests: [{ insertText: { text: "Append", location: { index: 20 } } }] } });
  });

  for (const body of [undefined, { content: [] }, { content: [{}] }, { content: [{ endIndex: 1 }] }]) {
    it(`uses insertion index one for an empty body ${JSON.stringify(body)}`, async () => {
      get.mockResolvedValue({ data: { body } });
      await service.insertText("empty", "First");
      expect(batchUpdate).toHaveBeenCalledWith({ documentId: "empty", requestBody: { requests: [{ insertText: { text: "First", location: { index: 1 } } }] } });
    });
  }

  for (const [operation, context, endpoint] of [
    [() => service.getDocument("doc-1"), "get document", get],
    [() => service.readContent("doc-1"), "read document", get],
    [() => service.createDocument("Notes"), "create document", create],
    [() => service.insertText("doc-1", "Text", 1), "insert text", batchUpdate],
    [() => service.insertText("doc-1", "Text"), "insert text", get],
  ] as const) {
    it(`routes ${context} failures from ${endpoint === get ? "get" : "write"} through handleGoogleApiError`, async () => {
      const error = { code: 403, message: "Access denied" };
      endpoint.mockRejectedValue(error);
      const failure = await operation().catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(PermissionDeniedError);
      expect(auth.apiError).toHaveBeenCalledWith(error, context);
    });
  }
});
