/**
 * Unit tests for handleDocsCommand — covers create and write subcommands.
 *
 * Tests verify:
 * - "create" calls createDocument and prints ID/link
 * - "write" calls insertText and prints success
 * - Missing arguments throw ArgumentError (caught by handleCommandWithRetry)
 * - Re-auth retry on ScopeInsufficientError
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ScopeInsufficientError } from "../../../src/services/errors.ts";
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
    expect(deleteTokenCalls).toEqual([["docs", "default"]]);
  });

  it("retries write on ScopeInsufficientError with a fresh service", async () => {
    const { factory, getCallCount, insertCalls } = makeDocsFactory({ throwOnFirst: true });
    await handleDocsCommand("write", ["doc-abc", "retry text"], "default", factory);

    expect(getCallCount()).toBe(2);
    expect(insertCalls).toEqual([{ documentId: "doc-abc", text: "retry text" }]);
    expect(deleteTokenCalls).toEqual([["docs", "default"]]);
  });
});
