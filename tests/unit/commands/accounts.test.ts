
import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { handleAccountsCommand } from "../../../src/commands/accounts.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import chalk from "chalk";

// Mock ora
void mock.module("ora", () => {
  return {
    default: () => ({
      start: () => ({
        stop: () => {},
        succeed: () => {},
        fail: () => {},
      }),
    }),
  };
});

describe("handleAccountsCommand", () => {
  let originalExit: any;
  let exitSpy: any;
  let consoleLogSpy: any;
  let originalTokenStoreInstance: any;
  let originalGetInstance: any;

  beforeEach(() => {
    // Mock process.exit
    originalExit = process.exit;
    exitSpy = spyOn(process, "exit").mockImplementation((() => {}) as any);

    // Spy on console.log
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

    // Save original TokenStore instance and getInstance method
    originalTokenStoreInstance = (TokenStore as any).instance;
    originalGetInstance = TokenStore.getInstance;

    // Reset TokenStore instance
    (TokenStore as any).instance = null;
  });

  afterEach(() => {
    process.exit = originalExit;
    consoleLogSpy.mockRestore();

    // Restore TokenStore
    if ((TokenStore as any).instance) {
        try {
            // Check if close exists before calling it (it might be our mock)
            if (typeof (TokenStore as any).instance.close === 'function') {
                (TokenStore as any).instance.close();
            }
        } catch (_error) {
            void _error;
        }
    }
    (TokenStore as any).instance = originalTokenStoreInstance;
    TokenStore.getInstance = originalGetInstance;
  });

  test("displays message when no accounts configured", async () => {
    // Mock TokenStore to return empty list
    const mockListTokens = mock(() => []);
    const mockClose = mock(() => {});

    (TokenStore as any).getInstance = () => ({
      listTokens: mockListTokens,
      close: mockClose,
    });

    await handleAccountsCommand([]);

    expect(mockListTokens).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(chalk.yellow("No configured accounts found."));
    // Expect implicit return (undefined) rather than exit(0) in the early return case?
    // Looking at the code:
    // if (tokens.length === 0) { ... return; }
    // So process.exit is NOT called in this case.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("lists configured accounts", async () => {
    // Mock TokenStore to return some tokens
    const tokens = [
      {
        service: "gmail",
        account: "test@example.com",
        expiry_date: Date.now() + 10000,
        scopes: ["scope1"],
      },
      {
        service: "calendar",
        account: "test@example.com",
        expiry_date: Date.now() - 10000, // Expired
        scopes: ["scope2"],
      }
    ];

    const mockListTokens = mock(() => tokens);
    const mockClose = mock(() => {});

    (TokenStore as any).getInstance = () => ({
      listTokens: mockListTokens,
      close: mockClose,
    });

    await handleAccountsCommand([]);

    expect(mockListTokens).toHaveBeenCalled();
    // Verify some output
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("test@example.com"));
    expect(mockClose).toHaveBeenCalled();
  });

  test("shows scopes when verbose flag is used", async () => {
    const tokens = [
        {
          service: "gmail",
          account: "test@example.com",
          expiry_date: Date.now() + 10000,
          scopes: ["https://mail.google.com/"],
        }
      ];

      const mockListTokens = mock(() => tokens);
      const mockClose = mock(() => {});

      (TokenStore as any).getInstance = () => ({
        listTokens: mockListTokens,
        close: mockClose,
      });

      await handleAccountsCommand(["--verbose"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Scopes:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("https://mail.google.com/"));
  });

  for (const fixture of [
    { refresh_token: "refresh", scopes: ["mail"], expiresIn: -3600000, status: "Active" },
    { refresh_token: "", scopes: ["mail"], expiresIn: -3600000, status: "Needs re-auth" },
    { refresh_token: "refresh", scopes: [], expiresIn: 3600000, status: "Invalid — re-auth required" },
    { refresh_token: "", scopes: ["mail"], expiresIn: 3600000, status: "Active" },
    { refresh_token: "refresh", scopes: [" "], expiresIn: -3600000, status: "Invalid — re-auth required" },
  ]) {
    test(`reports ${fixture.status} with refresh=${!!fixture.refresh_token} scopes=${fixture.scopes.length} expiry=${fixture.expiresIn}`, async () => {
      TokenStore.getInstance = () => ({
        listTokens: () => [{ service: "gmail", account: "fixture@example.com", access_token: "access",
          ...fixture, expiry_date: Date.now() + fixture.expiresIn }], close: () => {},
      }) as unknown as TokenStore;
      await handleAccountsCommand([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`Status:`));
      const statusLine = consoleLogSpy.mock.calls.map((args: unknown[]) => args.join(" ")).find((line: string) => line.includes("Status:"));
      expect(statusLine).toContain(fixture.status);
      expect(statusLine).not.toContain("Expiring soon");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Access token expires:"));
    });
  }
});
