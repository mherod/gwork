/**
 * Unit tests for AuthManager.
 *
 * Tests verify:
 * - Token loading and validation
 * - Token refresh and credential synchronization
 * - New authentication flow (custom OAuth HTTP server with prompt=consent)
 * - Error handling
 * - Cleanup of invalid tokens
 *
 * All dependencies (TokenStore, Logger, OAuth2Client, fs, http, open) are properly mocked.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { AuthManager } from "../../../src/services/auth-manager.ts";
import type { TokenStore } from "../../../src/services/token-store.ts";
import type { Logger } from "../../../src/services/logger.ts";
import type { TokenData } from "../../../src/services/token-store.ts";
import { createMockCredentials } from "../../helpers/mock-oauth.ts";
import * as fs from "fs/promises";
import { google } from "googleapis";
import * as http from "http";
import * as openModule from "open";

// Helper: build a mock OAuth2 client that includes generateAuthUrl and getToken
function makeMockOAuth2Client(credentials?: {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}) {
  const creds = {
    access_token: credentials?.access_token ?? "mock-access-token",
    refresh_token: credentials?.refresh_token ?? "mock-refresh-token",
    expiry_date: credentials?.expiry_date ?? (Date.now() + 3600000),
  };
  return {
    setCredentials: mock(() => {}),
    getAccessToken: mock(async () => ({ token: creds.access_token })),
    getToken: mock(async (_opts: unknown) => ({
      tokens: {
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
        expiry_date: creds.expiry_date,
      },
    })),
    generateAuthUrl: mock((_opts: unknown) => "https://accounts.google.com/o/oauth2/auth?mock"),
    credentials: creds,
  };
}

// Helper: mock http.createServer so it immediately simulates a successful OAuth callback
// without binding to any real port.
function mockHttpServerSuccess(fakeCode = "mock-auth-code") {
  // Build a fake server object
  const fakeServer = {
    listen: mock(function (this: typeof fakeServer, _port: number, cb?: () => void) {
      // Simulate the server starting and call the listen callback
      if (cb) cb();
      return fakeServer;
    }),
    close: mock(() => {}),
    address: mock(() => ({ port: 49152 })),
    on: mock(() => fakeServer),
  };

  // We intercept createServer and capture the request handler,
  // then call it with a fake IncomingMessage containing ?code=<fakeCode>
  const createServerSpy = spyOn(http, "createServer").mockImplementation(
    (handler: http.RequestListener) => {
      // Schedule the fake callback after the event loop tick so server.listen()
      // has already been called (which sets redirectUri.port via address()).
      void Promise.resolve().then(() => {
        const fakeReq = {
          url: `/?code=${fakeCode}`,
        } as http.IncomingMessage;
        const fakeRes = {
          end: mock(() => {}),
        } as unknown as http.ServerResponse;
        // Call the handler to simulate the OAuth redirect arriving
        (handler as (req: http.IncomingMessage, res: http.ServerResponse) => void)(fakeReq, fakeRes);
      });

      return fakeServer as unknown as http.Server;
    }
  );

  return { fakeServer, createServerSpy };
}

describe("AuthManager", () => {
  let mockTokenStore: TokenStore;
  let mockLogger: Logger;
  let authManager: AuthManager;
  let credentialsPath: string;
  let _openSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Create mocks
    mockTokenStore = {
      getToken: mock(() => null),
      saveToken: mock(() => {}),
      deleteToken: mock(() => {}),
    } as unknown as TokenStore;

    mockLogger = {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
    } as unknown as Logger;

    authManager = new AuthManager({
      tokenStore: mockTokenStore,
      logger: mockLogger,
    });

    // Create mock credentials file
    credentialsPath = createMockCredentials();

    // Prevent real browser launch during authentication
    _openSpy = spyOn(openModule, "default").mockResolvedValue({
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof openModule.default>);
  });

  afterEach(() => {
    // spyOn mocks are restored automatically by bun:test
  });

  describe("cleanupInvalidTokens", () => {
    it("should delete token with empty scopes", async () => {
      const invalidToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: [], // Empty scopes
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValueOnce(invalidToken);

      // Mock fs.readFile to fail so authenticate() throws (we only care about cleanup)
      spyOn(fs, "readFile").mockRejectedValue(new Error("Should not read file"));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // Should delete invalid token during cleanup
      expect(mockTokenStore.deleteToken).toHaveBeenCalledWith("gmail", "default");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Removing token with empty scopes")
      );
    });

    it("should delete token with wrong scopes", async () => {
      const wrongScopeToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"], // Wrong scope
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // First call in cleanup
        .mockReturnValueOnce(null) // Second call in cleanup (empty account)
        .mockReturnValueOnce(wrongScopeToken); // Third call in loadExistingAuth

      // Mock fs.readFile so we never reach createOAuth2ClientFromToken
      spyOn(fs, "readFile").mockRejectedValue(new Error("Should not read file"));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // Should delete token with wrong scopes in loadExistingAuth
      expect(mockTokenStore.deleteToken).toHaveBeenCalledWith("gmail", "default");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Token has incorrect scopes")
      );
    });

    it("should not delete token with valid scopes", async () => {
      const validToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // First call in cleanup (service/account)
        .mockReturnValueOnce(null) // Second call in cleanup (empty account)
        .mockReturnValueOnce(validToken); // Third call in loadExistingAuth

      const mockAuthClient = makeMockOAuth2Client();

      // Mock google.auth.OAuth2 constructor
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      });

      // Should NOT delete valid token
      expect(mockTokenStore.deleteToken).not.toHaveBeenCalledWith("gmail", "default");
      // Should save token (for refresh/update)
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
    });
  });

  describe("getAuthClient", () => {
    it("should call getToken during cleanup when no token exists", async () => {
      // Mock: No token in store
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      // Mock fs.readFile to fail so authenticate() throws
      spyOn(fs, "readFile").mockRejectedValue(new Error("File not found"));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // Should call getToken during cleanup
      expect(mockTokenStore.getToken).toHaveBeenCalledWith("gmail", "default");
    });

    it("should load and refresh existing valid token", async () => {
      const mockToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_access_token",
        refresh_token: "test_refresh_token",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // cleanup - no token for service/account
        .mockReturnValueOnce(null) // cleanup - no token for empty account
        .mockReturnValueOnce(mockToken); // loadExistingAuth - token exists

      const mockAuthClient = makeMockOAuth2Client({
        access_token: "test_access_token",
        refresh_token: "test_refresh_token",
      });

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      const result = await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      });

      expect(mockTokenStore.getToken).toHaveBeenCalled();
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      expect(result).toBe(mockAuthClient);
      expect(mockAuthClient.setCredentials.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(mockAuthClient.getAccessToken).toHaveBeenCalled();
    });

    it("should authenticate when no valid token exists", async () => {
      // Mock: No token in store
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      const mockAuthClient = makeMockOAuth2Client({
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
      });

      // Mock google.auth.OAuth2 constructor — returns client with generateAuthUrl + getToken
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      // Mock http server so it immediately delivers a fake OAuth code
      const { fakeServer } = mockHttpServerSuccess("fake-code-123");

      const result = await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      });

      // Should have called getToken on the OAuth2 client (code exchange)
      expect(mockAuthClient.getToken).toHaveBeenCalled();
      // Should have saved the token
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      // Should have returned the auth client
      expect(result).toBe(mockAuthClient);
      // Server should have been closed after callback
      expect(fakeServer.close).toHaveBeenCalled();
    });
  });

  describe("cleanupInvalidTokens (legacy empty-account)", () => {
    it("should delete legacy empty-account token for default account", async () => {
      const legacyToken: TokenData = {
        service: "gmail",
        account: "",
        access_token: "legacy_token",
        refresh_token: "legacy_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: [], // Empty scopes
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // First call: service/account — no token
        .mockReturnValueOnce(legacyToken); // Second call: empty account — legacy token

      spyOn(fs, "readFile").mockRejectedValue(new Error("Stop after cleanup"));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      expect(mockTokenStore.deleteToken).toHaveBeenCalledWith("gmail", "");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Removing legacy token with empty account string")
      );
    });

    it("should skip legacy cleanup for non-default accounts", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null); // Only one cleanup call for non-default

      spyOn(fs, "readFile").mockRejectedValue(new Error("Stop after cleanup"));

      await authManager.getAuthClient({
        service: "gmail",
        account: "work@example.com",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // getToken should only be called once for the service/account (no empty-account call)
      // Plus once in loadExistingAuth
      const getTokenCalls = (mockTokenStore.getToken as ReturnType<typeof mock>).mock.calls;
      const emptyAccountCalls = getTokenCalls.filter(
        (call: unknown[]) => call[1] === ""
      );
      expect(emptyAccountCalls.length).toBe(0);
    });
  });

  describe("loadExistingAuth error handling", () => {
    it("should delete token on auth error (invalid_grant)", async () => {
      const validToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // cleanup
        .mockReturnValueOnce(null) // cleanup empty account
        .mockReturnValueOnce(validToken); // loadExistingAuth

      const mockAuthClient = makeMockOAuth2Client();
      mockAuthClient.getAccessToken.mockRejectedValue(new Error("invalid_grant: Token has been revoked"));

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      // Should fall through to authenticateAndSave which will fail
      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      expect(mockTokenStore.deleteToken).toHaveBeenCalledWith("gmail", "default");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("invalid_grant")
      );
    });

    it("should NOT delete token on non-auth error (transient)", async () => {
      const validToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(validToken);

      const mockAuthClient = makeMockOAuth2Client();
      mockAuthClient.getAccessToken.mockRejectedValue(new Error("ECONNRESET: Connection reset"));

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // Should NOT delete token for transient errors
      expect(mockTokenStore.deleteToken).not.toHaveBeenCalledWith("gmail", "default");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Token not deleted - may be transient error")
      );
    });
  });

  describe("refreshTokenIfNeeded", () => {
    it("should retry on transient errors with backoff", async () => {
      const validToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(validToken);

      const mockAuthClient = makeMockOAuth2Client();
      // Fail twice with transient error, succeed on third try
      mockAuthClient.getAccessToken
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ token: "refreshed_token" });

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      const result = await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      });

      // Should have retried 3 times total
      expect(mockAuthClient.getAccessToken.mock.calls.length).toBe(3);
      // Should have saved the token
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      // Should return the auth client
      expect(result).toBe(mockAuthClient);
      // Should log retry attempts
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Retrying in")
      );
    });

    it("should throw immediately on auth errors (invalid_grant)", async () => {
      const validToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "test_token",
        refresh_token: "test_refresh",
        expiry_date: Date.now() + 3600000,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(validToken);

      const mockAuthClient = makeMockOAuth2Client();
      mockAuthClient.getAccessToken.mockRejectedValue(new Error("invalid_grant: Token revoked"));

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      }).catch(() => {});

      // Should NOT retry — only one getAccessToken call
      expect(mockAuthClient.getAccessToken.mock.calls.length).toBe(1);
      // Should warn about revoked token
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Token refresh failed")
      );
    });
  });

  describe("authenticateAndSave error paths", () => {
    const authOpts = {
      service: "gmail" as const,
      account: "default",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      credentialsPath: "",
    };

    beforeEach(() => {
      authOpts.credentialsPath = credentialsPath;
    });

    it("should throw when credentials have no redirect_uris", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: [],
        },
      }));

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("No redirect_uris found");
      }
    });

    it("should throw when redirect_uri is not localhost", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["https://example.com/callback"],
        },
      }));

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("redirect_uri must point to localhost");
      }
    });

    it("should reject when OAuth callback contains error param", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      const mockAuthClient = makeMockOAuth2Client();
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      // Mock server that sends error param instead of code
      const fakeServer = {
        listen: mock(function (this: typeof fakeServer, _port: number, cb?: () => void) {
          if (cb) cb();
          return fakeServer;
        }),
        close: mock(() => {}),
        address: mock(() => ({ port: 49152 })),
        on: mock(() => fakeServer),
      };

      spyOn(http, "createServer").mockImplementation(
        (handler: http.RequestListener) => {
          void Promise.resolve().then(() => {
            const fakeReq = { url: "/?error=access_denied" } as http.IncomingMessage;
            const fakeRes = { end: mock(() => {}) } as unknown as http.ServerResponse;
            (handler as (req: http.IncomingMessage, res: http.ServerResponse) => void)(fakeReq, fakeRes);
          });
          return fakeServer as unknown as http.Server;
        }
      );

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("access_denied");
      }

      expect(fakeServer.close).toHaveBeenCalled();
    });

    it("should reject when OAuth callback has no code", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      const mockAuthClient = makeMockOAuth2Client();
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      const fakeServer = {
        listen: mock(function (this: typeof fakeServer, _port: number, cb?: () => void) {
          if (cb) cb();
          return fakeServer;
        }),
        close: mock(() => {}),
        address: mock(() => ({ port: 49152 })),
        on: mock(() => fakeServer),
      };

      spyOn(http, "createServer").mockImplementation(
        (handler: http.RequestListener) => {
          void Promise.resolve().then(() => {
            const fakeReq = { url: "/" } as http.IncomingMessage;
            const fakeRes = { end: mock(() => {}) } as unknown as http.ServerResponse;
            (handler as (req: http.IncomingMessage, res: http.ServerResponse) => void)(fakeReq, fakeRes);
          });
          return fakeServer as unknown as http.Server;
        }
      );

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("No authentication code");
      }

      expect(fakeServer.close).toHaveBeenCalled();
    });

    it("should throw when no access_token received", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      const mockAuthClient = makeMockOAuth2Client();
      // Return tokens without access_token
      mockAuthClient.getToken.mockResolvedValue({
        tokens: {
          access_token: null,
          refresh_token: "some_refresh",
          expiry_date: Date.now() + 3600000,
        },
      });

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      mockHttpServerSuccess("valid-code");

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("No access token received");
      }
    });

    it("should throw when getToken fails during code exchange", async () => {
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      const mockAuthClient = makeMockOAuth2Client();
      mockAuthClient.getToken.mockRejectedValue(new Error("Token exchange failed"));

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      mockHttpServerSuccess("valid-code");

      try {
        await authManager.getAuthClient(authOpts);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("Token exchange failed");
      }
    });
  });

  describe("credential synchronization", () => {
    it("should save token with correct scopes (not old scopes)", async () => {
      const oldToken: TokenData = {
        service: "gmail",
        account: "default",
        access_token: "old_token",
        refresh_token: "refresh_token",
        expiry_date: Date.now() + 3600000,
        scopes: ["old_scope"], // Old/incorrect scopes
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const requiredScopes = ["https://www.googleapis.com/auth/gmail.readonly"];

      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // Cleanup call
        .mockReturnValueOnce(oldToken); // Load call

      const mockAuthClient = makeMockOAuth2Client({
        access_token: "old_token",
        refresh_token: "refresh_token",
      });

      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as unknown as typeof google.auth.OAuth2;

      spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
        installed: {
          client_id: "test-client-id",
          client_secret: "test-secret",
          redirect_uris: ["http://localhost"],
        },
      }));

      await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes,
        credentialsPath,
      });

      // Verify saveToken was called with correct scopes (not old scopes)
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      const saveTokenCall = (mockTokenStore.saveToken as ReturnType<typeof mock>).mock.calls[0];
      expect(saveTokenCall[0].scopes).toEqual(requiredScopes);
      expect(saveTokenCall[0].scopes).not.toEqual(oldToken.scopes);
    });
  });
});
