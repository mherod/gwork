/**
 * Unit tests for handleDriveCommand re-auth retry logic.
 *
 * When a Drive API call fails with ScopeInsufficientError, handleDriveCommand
 * must: (1) delete the stale token, (2) create a fresh service via the factory,
 * and (3) retry the command. All other errors must route through fatalExit (logServiceError
 * + process.exit(1)) rather than propagating as thrown exceptions.
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ScopeInsufficientError, ServiceError } from "../../../src/services/errors.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { DriveService } from "../../../src/services/drive-service.ts";

// Hoist module mocks so they take effect before handleDriveCommand is imported.
void mock.module("../../../src/utils/command-service.ts", () => ({
  ensureInitialized: async () => {},
}));

void mock.module("ora", () => ({
  default: () => ({ start: () => ({ stop: () => {} }) }),
}));

const logServiceErrorCalls: unknown[] = [];
void mock.module("../../../src/utils/command-error-handler.ts", () => ({
  logServiceError: (err: unknown) => { logServiceErrorCalls.push(err); },
}));

import { handleDriveCommand } from "../../../src/commands/drive.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StorageQuota = {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
};

/**
 * Builds a serviceFactory that tracks how many times it has been called.
 * The first service created throws ScopeInsufficientError when throwOnFirst=true;
 * subsequent services return the provided quota.
 */
function makeStatsFactory(throwOnFirst: boolean, quota: StorageQuota = {}) {
  let callCount = 0;
  const factory = (_acc: string): DriveService => {
    callCount++;
    const thisCall = callCount;
    return {
      getStorageQuota: async (): Promise<StorageQuota> => {
        if (throwOnFirst && thisCall === 1) {
          throw new ScopeInsufficientError("get storage quota");
        }
        return quota;
      },
    } as unknown as DriveService;
  };
  return { factory, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleDriveCommand re-auth retry", () => {
  let originalGetInstance: typeof TokenStore.getInstance;
  let deleteTokenCalls: Array<[string, string]>;
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
    // Prevent fatalExit from terminating the test process.
    processExitSpy = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    TokenStore.getInstance = originalGetInstance;
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("creates a fresh service (factory called twice) when ScopeInsufficientError is thrown", async () => {
    const { factory, getCallCount } = makeStatsFactory(true);
    await handleDriveCommand("stats", [], "default", factory);
    expect(getCallCount()).toBe(2);
  });

  it("calls deleteToken('drive', account) before retrying", async () => {
    const { factory } = makeStatsFactory(true);
    await handleDriveCommand("stats", [], "work", factory);
    expect(deleteTokenCalls).toEqual([["drive", "work"]]);
  });

  it("uses the account from the call when deleting the token", async () => {
    const { factory } = makeStatsFactory(true);
    await handleDriveCommand("stats", [], "personal", factory);
    expect(deleteTokenCalls[0]?.[1]).toBe("personal");
  });

  it("succeeds after the retry when the second service call works", async () => {
    const { factory } = makeStatsFactory(true, { usage: "5000", limit: "15000000000" });
    const result = await handleDriveCommand("stats", [], "default", factory);
    expect(result).toBeUndefined();
  });

  it("calls logServiceError and exits for non-scope non-auth errors", async () => {
    let callCount = 0;
    const factory = (_acc: string): DriveService => {
      callCount++;
      return {
        getStorageQuota: async () => {
          throw new ServiceError("quota exceeded", "RATE_LIMIT", 429);
        },
      } as unknown as DriveService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleDriveCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(logServiceErrorCalls[0]).toBeInstanceOf(ServiceError);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(1);
    expect(deleteTokenCalls).toHaveLength(0);
    exitSpy.mockRestore();
  });

  it("does not call deleteToken when there is no error", async () => {
    const { factory } = makeStatsFactory(false, { usage: "1000" });
    await handleDriveCommand("stats", [], "default", factory);
    expect(deleteTokenCalls).toHaveLength(0);
  });

  it("calls fatalExit when the re-auth retry also fails (max-attempt guard)", async () => {
    let callCount = 0;
    const factory = (_acc: string): DriveService => {
      callCount++;
      return {
        getStorageQuota: async () => { throw new ScopeInsufficientError("drive stats"); },
      } as unknown as DriveService;
    };

    let exitCode: unknown;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined as never;
    });

    await handleDriveCommand("stats", [], "default", factory);

    expect(logServiceErrorCalls).toHaveLength(1);
    expect(exitCode).toBe(1);
    expect(callCount).toBe(2); // first attempt + one re-auth retry, no more
    exitSpy.mockRestore();
  });
});
