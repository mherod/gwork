
import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { handleAccountsCommand } from "../../../src/commands/accounts.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import type { TokenData } from "../../../src/services/token-store.ts";
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

  describe("account lifecycle", () => {
    const token = (overrides: Partial<TokenData> = {}): TokenData => ({
      service: "gmail", account: "account@example.com", access_token: "access",
      refresh_token: "refresh", expiry_date: Date.now() - 3600000,
      scopes: ["mail"], created_at: 1, updated_at: 1, ...overrides,
    });

    function mockStore(tokens: TokenData[]) {
      const store = {
        listTokens: mock(() => tokens),
        deleteToken: mock((_service: string, _account: string) => true),
        close: mock(() => {}),
      };
      TokenStore.getInstance = () => store as unknown as TokenStore;
      return store;
    }

    async function expectCommandError(args: string[], message: string) {
      const error = await handleAccountsCommand(args).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(message);
    }

    test("explicit list preserves the default listing", async () => {
      const store = mockStore([token()]);
      await handleAccountsCommand([]);
      const defaultOutput = [...consoleLogSpy.mock.calls];
      consoleLogSpy.mockClear();
      await handleAccountsCommand(["list"]);
      expect(consoleLogSpy.mock.calls).toEqual(defaultOutput);
      expect(store.deleteToken).not.toHaveBeenCalled();
      expect(store.close).toHaveBeenCalledTimes(2);
    });

    test("remove previews the exact account across services without deleting", async () => {
      const store = mockStore([
        token(), token({ service: "calendar" }), token({ account: "other@example.com" }),
      ]);
      await handleAccountsCommand(["remove", "account@example.com"]);
      expect(store.deleteToken).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("Tokens selected for removal (2):");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Preview only"));
      expect(store.close).toHaveBeenCalled();
    });

    test("confirmed removal deletes and reports each selected service", async () => {
      const store = mockStore([
        token(), token({ service: "calendar" }), token({ account: "other@example.com" }),
      ]);
      await handleAccountsCommand(["remove", "account@example.com", "--confirm"]);
      expect(store.deleteToken.mock.calls).toEqual([
        ["gmail", "account@example.com"], ["calendar", "account@example.com"],
      ]);
      expect(consoleLogSpy).toHaveBeenCalledWith('Removed: "account@example.com" / "gmail"');
      expect(consoleLogSpy).toHaveBeenCalledWith('Removed: "account@example.com" / "calendar"');
    });

    test("service selection removes only the selected account and service", async () => {
      const store = mockStore([
        token(), token({ service: "calendar" }), token({ account: "other@example.com" }),
      ]);
      await handleAccountsCommand(["remove", "account@example.com", "--service", "gmail", "--confirm"]);
      expect(store.deleteToken.mock.calls).toEqual([["gmail", "account@example.com"]]);
    });

    test("an unknown account produces an empty plan", async () => {
      const store = mockStore([token()]);
      await handleAccountsCommand(["remove", "missing@example.com", "--confirm"]);
      expect(store.deleteToken).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("No matching tokens found. Nothing to remove.");
    });

    const pruneFixtures = () => [
      token(), // An expired access token is still refreshable.
      token({ service: "calendar", account: "" }),
      token({ service: "contacts", account: "   " }),
      token({ service: "drive", scopes: [] }),
      token({ service: "tasks", scopes: [" "] }),
      token({ service: "test-1234567890" }),
      token({ service: "test-production" }),
    ];

    test("prune previews empty account and scope entries without deleting", async () => {
      const store = mockStore(pruneFixtures());
      await handleAccountsCommand(["prune"]);
      expect(store.deleteToken).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("Tokens selected for removal (4):");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"" / "calendar" — empty account name'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("empty scopes"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Preview only"));
    });

    test("confirmed prune retains usable, refreshable and fixture tokens by default", async () => {
      const store = mockStore(pruneFixtures());
      await handleAccountsCommand(["prune", "--confirm"]);
      expect(store.deleteToken.mock.calls).toEqual([
        ["calendar", ""], ["contacts", "   "], ["drive", "account@example.com"], ["tasks", "account@example.com"],
      ]);
    });

    test("fixture pruning is opt-in and matches only test-<digits> service names", async () => {
      const store = mockStore(pruneFixtures());
      await handleAccountsCommand(["prune", "--include-test-fixtures", "--confirm"]);
      expect(store.deleteToken).toHaveBeenCalledTimes(5);
      expect(store.deleteToken).toHaveBeenCalledWith("test-1234567890", "account@example.com");
      expect(store.deleteToken).not.toHaveBeenCalledWith("test-production", "account@example.com");
      expect(store.deleteToken).not.toHaveBeenCalledWith("gmail", "account@example.com");
    });

    test("fixture pruning still requires confirmation", async () => {
      const store = mockStore([token({ service: "test-1234567890" })]);
      await handleAccountsCommand(["prune", "--include-test-fixtures"]);
      expect(store.deleteToken).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith("Tokens selected for removal (1):");
    });

    test("unknown subcommands fail before opening the store", async () => {
      const getInstance = mock(() => { throw new Error("Store must not open"); });
      TokenStore.getInstance = getInstance;
      await expectCommandError(["anything"], "Unknown subcommand: anything");
      expect(getInstance).not.toHaveBeenCalled();
    });

    for (const args of [
      ["remove", "--confirm"],
      ["remove", "account@example.com", "--service"],
      ["remove", "account@example.com", "--service", "--confirm"],
      ["remove", "account@example.com", "--service", "gmail", "--service", "calendar", "--confirm"],
      ["remove", "account@example.com", "other@example.com", "--confirm"],
      ["prune", "--confrim"],
      ["prune", "account@example.com", "--confirm"],
      ["list", "--confirm"],
    ]) {
      test(`invalid arguments never delete: ${args.join(" ")}`, async () => {
        const store = mockStore(pruneFixtures());
        await expectCommandError(args, "Usage:");
        expect(store.deleteToken).not.toHaveBeenCalled();
        expect(store.close).toHaveBeenCalled();
      });
    }

    test("a token already removed by another process is reported honestly", async () => {
      const store = mockStore([token()]);
      store.deleteToken.mockReturnValue(false);
      await handleAccountsCommand(["remove", "account@example.com", "--confirm"]);
      expect(consoleLogSpy).toHaveBeenCalledWith('Already absent: "account@example.com" / "gmail"');
    });

    test("deletion failures close the store and do not report success", async () => {
      const store = mockStore([token()]);
      store.deleteToken.mockImplementation(() => { throw new Error("Storage failed"); });
      await expectCommandError(["remove", "account@example.com", "--confirm"], "Storage failed");
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Removed:"));
      expect(store.close).toHaveBeenCalled();
    });
  });
});
