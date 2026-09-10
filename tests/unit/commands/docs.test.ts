/**
 * Unit tests for every handleDocsCommand subcommand.
 *
 * Tests verify:
 * - "create" calls createDocument and prints ID/link
 * - "write" calls insertText and prints success
 * - Missing arguments throw ArgumentError (caught by handleCommandWithRetry)
 * - Re-auth retry on ScopeInsufficientError
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ArgumentError, ScopeInsufficientError } from "../../../src/services/errors.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { DocsService } from "../../../src/services/docs-service.ts";

// Hoist module mocks before handleDocsCommand is imported.
void mock.module("ora", () => ({
  default: () => ({ start: () => ({ stop: () => {}, succeed: () => {}, fail: () => {} }) }),
}));

const logServiceErrorCalls: unknown[] = [];
void mock.module("../../../src/utils/command-error-handler.ts", () => ({
  logServiceError: (err: unknown) => { logServiceErrorCalls.push(err); },
  handleServiceError: (err: unknown): never => {
    logServiceErrorCalls.push(err);
    process.exit(1);
    return undefined as never;
  },
}));

import { handleDocsCommand } from "../../../src/commands/docs.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocsFactory(opts?: { throwOnFirst?: boolean }) {
  let callCount = 0;
  const createCalls: string[] = [];
  const insertCalls: { documentId: string; text: string }[] = [];

  const factory = (_acc: string): DocsService => {
    callCount++;
    const thisCall = callCount;
    return {
      initialize: async () => {},
      getDocument: async (docId: string) => {
        if (opts?.throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("get document");
        }
        return { documentId: docId, title: "Test Doc", revisionId: "rev1", suggestionsViewMode: "PREVIEW" };
      },
      readContent: async (docId: string) => ({
        documentId: docId, title: "Test Doc", bodyText: "Hello", wordCount: 1, headers: [],
      }),
      createDocument: async (title: string) => {
        if (opts?.throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("create document");
        }
        createCalls.push(title);
        return { documentId: "doc-123", title };
      },
      insertText: async (documentId: string, text: string) => {
        if (opts?.throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("insert text");
        }
        insertCalls.push({ documentId, text });
      },
    } as unknown as DocsService;
  };

  return { factory, getCallCount: () => callCount, createCalls, insertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleDocsCommand — create", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: [string, string][];
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    deleteTokenCalls = [];
    logServiceErrorCalls.length = 0;
    originalGetInstance = TokenStore.getInstance;
    TokenStore.getInstance = () =>
      ({
        deleteToken: (svc: string, acc: string) => {
          deleteTokenCalls.push([svc, acc]);
          return true;
        },
      }) as unknown as TokenStore;
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("calls createDocument with the title and prints ID/link", async () => {
    const { factory, createCalls } = makeDocsFactory();
    await handleDocsCommand("create", ["My Document"], "default", factory);

    expect(createCalls).toEqual(["My Document"]);
    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("doc-123");
    expect(output).toContain("https://docs.google.com/document/d/doc-123/edit");
  });

  it("joins multiple args into a single title", async () => {
    const { factory, createCalls } = makeDocsFactory();
    await handleDocsCommand("create", ["My", "New", "Document"], "default", factory);

    expect(createCalls).toEqual(["My New Document"]);
  });

  it("exits with error when no title is provided", async () => {
    const { factory } = makeDocsFactory();
    await handleDocsCommand("create", [], "default", factory);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

describe("handleDocsCommand — get and read", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  const getDocument = mock(async () => ({ documentId: "doc-1", title: "Notes", revisionId: "rev-2", suggestionsViewMode: "PREVIEW" }));
  const readContent = mock(async () => ({ documentId: "doc-1", title: "Notes", bodyText: "Heading\nBody text", wordCount: 3, headers: ["Heading"] }));
  const factory = mock((_account: string) => ({
    initialize: async () => {}, getDocument, readContent,
  }) as unknown as DocsService);
  const output = () => consoleLogSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");

  beforeEach(() => {
    logServiceErrorCalls.length = 0;
    getDocument.mockReset().mockResolvedValue({ documentId: "doc-1", title: "Notes", revisionId: "rev-2", suggestionsViewMode: "PREVIEW" });
    readContent.mockReset().mockResolvedValue({ documentId: "doc-1", title: "Notes", bodyText: "Heading\nBody text", wordCount: 3, headers: ["Heading"] });
    factory.mockClear();
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("gets document metadata using the selected account and prints its link", async () => {
    await handleDocsCommand("get", ["doc-1"], "work@example.com", factory);
    expect(factory).toHaveBeenCalledWith("work@example.com");
    expect(getDocument).toHaveBeenCalledWith("doc-1");
    expect(output()).toContain("Notes");
    expect(output()).toContain("rev-2");
    expect(output()).toContain("https://docs.google.com/document/d/doc-1/edit");
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("reads body text and reports the word count", async () => {
    await handleDocsCommand("read", ["doc-1"], "default", factory);
    expect(readContent).toHaveBeenCalledWith("doc-1");
    expect(output()).toContain("3 words");
    expect(output()).toContain("Heading\nBody text");
  });

  it("prints only headings when --headers is requested", async () => {
    await handleDocsCommand("read", ["doc-1", "--headers"], "default", factory);
    expect(output()).toContain("Heading");
    expect(output()).not.toContain("Body text");
  });

  it("explains when the document contains no headings", async () => {
    readContent.mockResolvedValue({ documentId: "doc-1", title: "Notes", bodyText: "Body", wordCount: 1, headers: [] });
    await handleDocsCommand("read", ["doc-1", "--headers"], "default", factory);
    expect(output()).toContain("No headings found.");
  });

  it("emits structured content for --format json", async () => {
    await handleDocsCommand("read", ["doc-1", "--format", "json"], "default", factory);
    expect(JSON.parse(output())).toEqual({ documentId: "doc-1", title: "Notes", wordCount: 3, headers: ["Heading"], body: "Heading\nBody text" });
  });

  it("omits body content from headers-only JSON", async () => {
    await handleDocsCommand("read", ["doc-1", "--headers", "--format", "json"], "default", factory);
    expect(JSON.parse(output())).toEqual({ documentId: "doc-1", title: "Notes", wordCount: 3, headers: ["Heading"] });
  });

  for (const command of ["get", "read"]) {
    it(`rejects ${command} without a document ID`, async () => {
      await handleDocsCommand(command, [], "default", factory);
      expect(logServiceErrorCalls[0]).toBeInstanceOf(ArgumentError);
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(getDocument).not.toHaveBeenCalled();
      expect(readContent).not.toHaveBeenCalled();
    });

    it(`reports ${command} service errors and exits without retrying`, async () => {
      const error = new Error("Document unavailable");
      (command === "get" ? getDocument : readContent).mockRejectedValue(error);
      await handleDocsCommand(command, ["doc-1"], "default", factory);
      expect(logServiceErrorCalls).toEqual([error]);
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  }
});

describe("handleDocsCommand — write", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: [string, string][];
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    deleteTokenCalls = [];
    logServiceErrorCalls.length = 0;
    originalGetInstance = TokenStore.getInstance;
    TokenStore.getInstance = () =>
      ({
        deleteToken: (svc: string, acc: string) => {
          deleteTokenCalls.push([svc, acc]);
          return true;
        },
      }) as unknown as TokenStore;
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("calls insertText with documentId and joined text", async () => {
    const { factory, insertCalls } = makeDocsFactory();
    await handleDocsCommand("write", ["doc-abc", "Hello", "world"], "default", factory);

    expect(insertCalls).toEqual([{ documentId: "doc-abc", text: "Hello world" }]);
    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("successfully");
  });

  it("exits with error when fewer than 2 args", async () => {
    const { factory } = makeDocsFactory();
    await handleDocsCommand("write", ["doc-abc"], "default", factory);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error when no args provided", async () => {
    const { factory } = makeDocsFactory();
    await handleDocsCommand("write", [], "default", factory);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

describe("handleDocsCommand — re-auth retry", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: [string, string][];
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    deleteTokenCalls = [];
    logServiceErrorCalls.length = 0;
    originalGetInstance = TokenStore.getInstance;
    TokenStore.getInstance = () =>
      ({
        deleteToken: (svc: string, acc: string) => {
          deleteTokenCalls.push([svc, acc]);
          return true;
        },
      }) as unknown as TokenStore;
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("retries create on ScopeInsufficientError with a fresh service", async () => {
    const { factory, getCallCount, createCalls } = makeDocsFactory({ throwOnFirst: true });
    await handleDocsCommand("create", ["Retry Doc"], "default", factory);

    expect(getCallCount()).toBe(2);
    expect(createCalls).toEqual(["Retry Doc"]);
    expect(deleteTokenCalls).toEqual([]);
  });

  it("retries write on ScopeInsufficientError with a fresh service", async () => {
    const { factory, getCallCount, insertCalls } = makeDocsFactory({ throwOnFirst: true });
    await handleDocsCommand("write", ["doc-abc", "retry text"], "default", factory);

    expect(getCallCount()).toBe(2);
    expect(insertCalls).toEqual([{ documentId: "doc-abc", text: "retry text" }]);
    expect(deleteTokenCalls).toEqual([]);
  });
});
