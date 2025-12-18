import { mock } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Create mock OAuth2 credentials file
 * Returns the path to the credentials file for use in tests
 */
export function createMockCredentials(): string {
  const credentialsDir = join(tmpdir(), `gwork-test-${Date.now()}-${Math.random()}`);
  mkdirSync(credentialsDir, { recursive: true });

  const credentialsPath = join(credentialsDir, ".credentials.json");
  const credentials = {
    installed: {
      client_id: "test-client-id.apps.googleusercontent.com",
      client_secret: "test-client-secret",
      redirect_uris: ["http://localhost"],
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    },
  };

  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
  return credentialsPath;
}

/**
 * Mock process.exit to prevent tests from terminating
 * Returns an object with the mock and a restore function
 */
export function mockProcessExit() {
  const originalExit = process.exit;
  const exitMock = mock((code?: number | string) => {
    throw new Error(`process.exit(${code ?? 0})`);
  });

  process.exit = exitMock as any;

  return {
    mock: exitMock,
    restore: () => {
      process.exit = originalExit;
    },
    wasCalled: () => exitMock.mock.calls.length > 0,
    getLastCode: () => {
      const calls = exitMock.mock.calls;
      return calls.length > 0 ? calls[calls.length - 1][0] : undefined;
    },
  };
}

/**
 * Mock authentication flow for services
 */
export function createMockAuthenticate() {
  return mock(
    async ({ scopes, keyfilePath }: any = {}) =>
      Promise.resolve({
        credentials: {
          access_token: "mock-access-token-123",
          refresh_token: "mock-refresh-token-456",
          expiry_date: Date.now() + 3600000,
          scope: scopes?.join(" ") || "https://www.googleapis.com/auth/cloud-platform",
          token_type: "Bearer",
        },
        getAccessToken: mock(async () => ({
          token: "mock-access-token-123",
        })),
        refreshAccessToken: mock(async () => ({
          credentials: {
            access_token: "mock-refreshed-token-789",
            refresh_token: "mock-refresh-token-456",
            expiry_date: Date.now() + 3600000,
          },
        })),
      })
  );
}

/**
 * Create a mock OAuth2 client with all necessary methods
 */
export function createMockOAuth2Client() {
  return {
    setCredentials: mock(() => {}),
    getAccessToken: mock(async () => ({
      token: "mock-access-token",
      res: { status: 200 },
    })),
    refreshAccessToken: mock(async () => ({
      credentials: {
        access_token: "mock-refreshed-token",
        refresh_token: "mock-refresh-token",
        expiry_date: Date.now() + 3600000,
        scope: "https://www.googleapis.com/auth/calendar",
      },
    })),
    hasScopes: mock((scopes: string[]) => true),
    setDefaultHeaders: mock(() => {}),
    request: mock(async (options: any) => ({
      status: 200,
      data: {},
    })),
  };
}

/**
 * Track console output for testing
 * Useful for verifying error messages and logging
 */
export function captureConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const infos: string[] = [];

  console.log = mock((...args: any[]) => {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    logs.push(message);
  });

  console.error = mock((...args: any[]) => {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    errors.push(message);
  });

  console.warn = mock((...args: any[]) => {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    warns.push(message);
  });

  console.info = mock((...args: any[]) => {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    infos.push(message);
  });

  return {
    getLogs: () => logs,
    getErrors: () => errors,
    getWarns: () => warns,
    getInfos: () => infos,
    getAllOutput: () => [...logs, ...errors, ...warns, ...infos],
    hasError: (text: string) => errors.some((e) => e.includes(text)),
    hasLog: (text: string) => logs.some((l) => l.includes(text)),
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
    },
    clear: () => {
      logs.length = 0;
      errors.length = 0;
      warns.length = 0;
      infos.length = 0;
    },
  };
}

/**
 * Create a mock environment for service initialization
 * Handles both token store and API client setup
 */
export function createMockServiceEnvironment() {
  return {
    credentialsPath: createMockCredentials(),
    exitMock: mockProcessExit(),
    consoleMock: captureConsole(),
    oauth2Client: createMockOAuth2Client(),

    restore: function () {
      this.exitMock.restore();
      this.consoleMock.restore();
    },

    cleanup: function () {
      this.restore();
    },
  };
}
