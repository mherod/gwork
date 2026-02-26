/**
 * Unit tests for handleCalCommand re-auth retry logic.
 *
 * When a Calendar API call fails with ScopeInsufficientError, handleCalCommand
 * must: (1) delete the stale token, (2) create a fresh service via the factory,
 * and (3) retry the command. All other errors must propagate unchanged.
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ScopeInsufficientError, ServiceError } from "../../../src/services/errors.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { CalendarService } from "../../../src/services/calendar-service.ts";

// Hoist module mocks so they take effect before handleCalCommand is imported.
void mock.module("../../../src/utils/command-service.ts", () => ({
  ensureInitialized: async () => {},
}));

void mock.module("ora", () => ({
  default: () => ({ start: () => ({ stop: () => {}, succeed: () => {}, fail: () => {} }) }),
}));

import { handleCalCommand } from "../../../src/commands/cal.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a serviceFactory that tracks how many times it has been called.
 * The first service created throws ScopeInsufficientError when throwOnFirst=true;
 * subsequent services return an empty calendar list.
 */
function makeCalendarsFactory(throwOnFirst: boolean) {
  let callCount = 0;
  const factory = (_acc: string): CalendarService => {
    callCount++;
    const thisCall = callCount;
    return {
      listCalendars: async () => {
        if (throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("list calendars");
        }
        return [];
      },
    } as unknown as CalendarService;
  };
  return { factory, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCalCommand re-auth retry", () => {
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
    const { factory, getCallCount } = makeCalendarsFactory(true);
    await handleCalCommand("calendars", [], "default", factory);
    expect(getCallCount()).toBe(2);
  });

  it("calls deleteToken('calendar', account) before retrying", async () => {
    const { factory } = makeCalendarsFactory(true);
    await handleCalCommand("calendars", [], "work", factory);
    expect(deleteTokenCalls).toEqual([["calendar", "work"]]);
  });

  it("uses the account from the call when deleting the token", async () => {
    const { factory } = makeCalendarsFactory(true);
    await handleCalCommand("calendars", [], "personal", factory);
    expect(deleteTokenCalls[0]?.[1]).toBe("personal");
  });

  it("succeeds after the retry when the second service call works", async () => {
    const { factory } = makeCalendarsFactory(true);
    const result = await handleCalCommand("calendars", [], "default", factory);
    expect(result).toBeUndefined();
  });

  it("rethrows non-ScopeInsufficientError without retrying", async () => {
    let callCount = 0;
    const factory = (_acc: string): CalendarService => {
      callCount++;
      return {
        listCalendars: async () => {
          throw new ServiceError("quota exceeded", "RATE_LIMIT", 429);
        },
      } as unknown as CalendarService;
    };

    let caught: unknown;
    try {
      await handleCalCommand("calendars", [], "default", factory);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceError);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeCalendarsFactory(false);
    await handleCalCommand("calendars", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });
});
