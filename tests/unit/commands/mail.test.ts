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
      initialize: async () => {},
      getProfile: async () => {
        if (throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("get mail stats");
        }
        return STUB_PROFILE;
      },
      listLabels: async () => [],
      getLabel: async (id: string) => ({ id, messagesTotal: 0, messagesUnread: 0 }),
    } as unknown as MailService;
  };
  return { factory, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleMailCommand re-auth retry", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: [string, string][];
  let consoleLogSpy: ReturnType<typeof spyOn>;

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

  it("calls logServiceError and exits for non-scope non-auth errors", async () => {
    let callCount = 0;
    const factory = (_acc: string): MailService => {
      callCount++;
      return {
        initialize: async () => {},
        getProfile: async () => {
          throw new ServiceError("quota exceeded", "RATE_LIMIT", 429);
        },
        listLabels: async () => [],
      } as unknown as MailService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleMailCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(logServiceErrorCalls[0]).toBeInstanceOf(ServiceError);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
    exitSpy.mockRestore();
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeStatsFactory(false);
    await handleMailCommand("stats", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("calls fatalExit when the re-auth retry also fails (max-attempt guard)", async () => {
    // Both the first and second service throw ScopeInsufficientError —
    // the handler must not loop; it must call logServiceError and exit.
    const retryError = new ServiceError("still no scope", "SCOPE_INSUFFICIENT", 403);
    let callCount = 0;
    const factory = (_acc: string): MailService => {
      callCount++;
      return {
        initialize: async () => {},
        getProfile: async () => { throw new ScopeInsufficientError("mail stats"); },
        listLabels: async () => { throw retryError; },
      } as unknown as MailService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleMailCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(2); // first attempt + one re-auth retry, no more
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Regression: stats must read counts from sources that actually populate them
// ---------------------------------------------------------------------------

describe("handleMailCommand stats counts", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let logged: string[];

  beforeEach(() => {
    logged = [];
    logServiceErrorCalls.length = 0;
    originalGetInstance = TokenStore.getInstance;
    TokenStore.getInstance = () =>
      ({ deleteToken: () => true }) as unknown as TokenStore;
    consoleLogSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  /**
   * Mirrors the real Gmail API: users.labels.list returns labels WITHOUT
   * counters, while users.labels.get returns them. Reading counts off the
   * listed labels is what made `mail stats` report 0 for every figure.
   */
  function makeCountingFactory() {
    return (_acc: string): MailService =>
      ({
        initialize: async () => {},
        getProfile: async () => ({
          emailAddress: "test@example.com",
          messagesTotal: 2493,
          threadsTotal: 2149,
        }),
        listLabels: async () => [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Project X", type: "user" },
        ],
        getLabel: async (id: string) =>
          id === "INBOX"
            ? { id, name: "INBOX", messagesTotal: 120, messagesUnread: 7 }
            : { id, name: "Project X", messagesTotal: 42, messagesUnread: 0 },
      }) as unknown as MailService;
  }

  it("reports the mailbox total from the profile, not from listed labels", async () => {
    await handleMailCommand("stats", [], "default", makeCountingFactory());
    const output = logged.join("\n");
    expect(output).toContain("2493");
    expect(output).toContain("2149");
  });

  it("reports inbox counts from labels.get", async () => {
    await handleMailCommand("stats", [], "default", makeCountingFactory());
    const output = logged.join("\n");
    expect(output).toContain("120");
    expect(output).toContain("7");
  });

  it("reports per-user-label counts from labels.get", async () => {
    await handleMailCommand("stats", [], "default", makeCountingFactory());
    const output = logged.join("\n");
    expect(output).toContain("Project X: 42 messages");
  });
});
