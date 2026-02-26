/**
 * Unit tests for handleMailCommand re-auth retry logic.
 *
 * When a Gmail API call fails with ScopeInsufficientError, handleMailCommand
 * must: (1) delete the stale token, (2) create a fresh service via the factory,
 * and (3) retry the command. All other errors must propagate unchanged.
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ScopeInsufficientError, ServiceError } from "../../../src/services/errors.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { MailService } from "../../../src/services/mail-service.ts";

// Hoist module mocks so they take effect before handleMailCommand is imported.
void mock.module("../../../src/utils/command-service.ts", () => ({
  ensureInitialized: async () => {},
}));

void mock.module("ora", () => ({
  default: () => ({ start: () => ({ stop: () => {}, succeed: () => {}, fail: () => {} }) }),
}));

import { handleMailCommand } from "../../../src/commands/mail.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUB_PROFILE = { emailAddress: "test@example.com", messagesTotal: 0, threadsTotal: 0 };

/**
 * Builds a serviceFactory that tracks how many times it has been called.
 * The first service created throws ScopeInsufficientError when throwOnFirst=true;
 * subsequent services return a stub profile and empty label list.
 */
function makeStatsFactory(throwOnFirst: boolean) {
  let callCount = 0;
  const factory = (_acc: string): MailService => {
    callCount++;
    const thisCall = callCount;
    return {
      getProfile: async () => {
        if (throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("get mail stats");
        }
        return STUB_PROFILE;
      },
      listLabels: async () => [],
    } as unknown as MailService;
  };
  return { factory, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleMailCommand re-auth retry", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: Array<[string, string]>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

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
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
  });

  it("creates a fresh service (factory called twice) when ScopeInsufficientError is thrown", async () => {
    const { factory, getCallCount } = makeStatsFactory(true);
    await handleMailCommand("stats", [], "default", factory);
    expect(getCallCount()).toBe(2);
  });

  it("calls deleteToken('gmail', account) before retrying", async () => {
    const { factory } = makeStatsFactory(true);
    await handleMailCommand("stats", [], "work", factory);
    expect(deleteTokenCalls).toEqual([["gmail", "work"]]);
  });

  it("uses the account from the call when deleting the token", async () => {
    const { factory } = makeStatsFactory(true);
    await handleMailCommand("stats", [], "personal", factory);
    expect(deleteTokenCalls[0]?.[1]).toBe("personal");
  });

  it("succeeds after the retry when the second service call works", async () => {
    const { factory } = makeStatsFactory(true);
    const result = await handleMailCommand("stats", [], "default", factory);
    expect(result).toBeUndefined();
  });

  it("rethrows non-ScopeInsufficientError without retrying", async () => {
    let callCount = 0;
    const factory = (_acc: string): MailService => {
      callCount++;
      return {
        getProfile: async () => {
          throw new ServiceError("quota exceeded", "RATE_LIMIT", 429);
        },
        listLabels: async () => [],
      } as unknown as MailService;
    };

    let caught: unknown;
    try {
      await handleMailCommand("stats", [], "default", factory);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeStatsFactory(false);
    await handleMailCommand("stats", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });
});
