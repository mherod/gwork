/**
 * Unit tests for handleContactsCommand re-auth retry logic.
 *
 * When a Contacts API call fails with ScopeInsufficientError, handleContactsCommand
 * must: (1) delete the stale token, (2) create a fresh service via the factory,
 * and (3) retry the command. All other errors must route through fatalExit (logServiceError
 * + process.exit(1)) rather than propagating as thrown exceptions.
 *
 * Note: contacts "stats" calls process.exit(0) on success. The exit spy is
 * installed in beforeEach to prevent the test process from terminating.
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ScopeInsufficientError, ServiceError } from "../../../src/services/errors.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { ContactsService } from "../../../src/services/contacts-service.ts";

// Hoist module mocks so they take effect before handleContactsCommand is imported.
void mock.module("../../../src/utils/command-service.ts", () => ({
  ensureInitialized: async () => {},
}));

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

import { handleContactsCommand } from "../../../src/commands/contacts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a serviceFactory that tracks how many times it has been called.
 * The first service created throws ScopeInsufficientError when throwOnFirst=true;
 * subsequent services return empty contacts and groups lists.
 */
function makeStatsFactory(throwOnFirst: boolean) {
  let callCount = 0;
  const factory = (_acc: string): ContactsService => {
    callCount++;
    const thisCall = callCount;
    return {
      listContacts: async () => {
        if (throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("list contacts");
        }
        return [];
      },
      getContactGroups: async () => [],
    } as unknown as ContactsService;
  };
  return { factory, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleContactsCommand re-auth retry", () => {
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
    // Prevent contacts/getStats from terminating the test process.
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("creates a fresh service (factory called twice) when ScopeInsufficientError is thrown", async () => {
    const { factory, getCallCount } = makeStatsFactory(true);
    await handleContactsCommand("stats", [], "default", factory);
    expect(getCallCount()).toBe(2);
  });

  it("calls deleteToken('contacts', account) before retrying", async () => {
    const { factory } = makeStatsFactory(true);
    await handleContactsCommand("stats", [], "work", factory);
    expect(deleteTokenCalls).toEqual([["contacts", "work"]]);
  });

  it("uses the account from the call when deleting the token", async () => {
    const { factory } = makeStatsFactory(true);
    await handleContactsCommand("stats", [], "personal", factory);
    expect(deleteTokenCalls[0]?.[1]).toBe("personal");
  });

  it("succeeds after the retry when the second service call works", async () => {
    const { factory } = makeStatsFactory(true);
    const result = await handleContactsCommand("stats", [], "default", factory);
    expect(result).toBeUndefined();
  });

  it("calls logServiceError and exits for non-scope non-auth errors", async () => {
    let callCount = 0;
    const factory = (_acc: string): ContactsService => {
      callCount++;
      return {
        listContacts: async () => {
          throw new ServiceError("quota exceeded", "RATE_LIMIT", 429);
        },
        getContactGroups: async () => [],
      } as unknown as ContactsService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleContactsCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(logServiceErrorCalls[0]).toBeInstanceOf(ServiceError);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
    exitSpy.mockRestore();
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeStatsFactory(false);
    await handleContactsCommand("stats", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("calls fatalExit when the re-auth retry also fails (max-attempt guard)", async () => {
    let callCount = 0;
    const factory = (_acc: string): ContactsService => {
      callCount++;
      return {
        listContacts: async () => { throw new ScopeInsufficientError("contacts stats"); },
        getContactGroups: async () => { throw new ScopeInsufficientError("contacts stats"); },
      } as unknown as ContactsService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleContactsCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(2); // first attempt + one re-auth retry, no more
    exitSpy.mockRestore();
  });
});
