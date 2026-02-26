/**
 * Unit tests for handleContactsCommand re-auth retry logic.
 *
 * When a Contacts API call fails with ScopeInsufficientError, handleContactsCommand
 * must: (1) delete the stale token, (2) create a fresh service via the factory,
 * and (3) retry the command. All other errors must propagate unchanged.
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
  let deleteTokenCalls: Array<[string, string]>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    deleteTokenCalls = [];
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

  it("rethrows non-ScopeInsufficientError without retrying", async () => {
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

    let caught: unknown;
    try {
      await handleContactsCommand("stats", [], "default", factory);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeStatsFactory(false);
    await handleContactsCommand("stats", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });
});
