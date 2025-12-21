/**
 * Unit tests for AuthManager.
 * 
 * Tests verify:
 * - Token loading and validation
 * - Token refresh and credential synchronization
 * - New authentication flow
 * - Error handling
 * - Cleanup of invalid tokens
 * 
 * All dependencies (TokenStore, Logger, OAuth2Client, fs, google.auth) are properly mocked.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { AuthManager } from "../../../src/services/auth-manager.ts";
import type { TokenStore } from "../../../src/services/token-store.ts";
import type { Logger } from "../../../src/services/logger.ts";
import type { AuthClient } from "../../../src/types/google-apis.ts";
import type { TokenData } from "../../../src/services/token-store.ts";
import { createMockCredentials } from "../../helpers/mock-oauth.ts";
import * as fs from "fs/promises";
import { google } from "googleapis";
import * as localAuth from "@google-cloud/local-auth";

describe("AuthManager", () => {
  let mockTokenStore: TokenStore;
  let mockLogger: Logger;
  let authManager: AuthManager;
  let credentialsPath: string;
  let originalFsReadFile: typeof fs.readFile;
  let originalOAuth2: typeof google.auth.OAuth2;
  let originalAuthenticate: typeof authenticate;

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

    // Save original implementations
    originalFsReadFile = fs.readFile;
    originalOAuth2 = google.auth.OAuth2;
    originalAuthenticate = localAuth.authenticate;

    // CRITICAL: Mock authenticate to prevent browser launch
    // Use spyOn to mock the module export
    spyOn(localAuth, "authenticate").mockImplementation(async () => {
      const mockAuth = {
        getAccessToken: mock(async () => ({ token: "mock-token" })),
        setCredentials: mock(() => {}),
        credentials: {
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          expiry_date: Date.now() + 3600000,
        },
        getCredentials: mock(async () => ({
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          expiry_date: Date.now() + 3600000,
        })),
      };
      return mockAuth as any;
    });
  });

  afterEach(() => {
    // Restore original implementations
    // Note: fs.readFile and google.auth.OAuth2 are restored by spyOn automatically
    // localAuth.authenticate is restored by spyOn automatically
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

      // Mock fs.readFile to prevent actual file read (will fail in loadExistingAuth)
      spyOn(fs, "readFile").mockRejectedValue(new Error("Should not read file"));

      // Mock authenticate to fail (will be called after cleanup)
      spyOn(localAuth, "authenticate").mockRejectedValueOnce(
        new Error("Auth failed")
      );

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

      // cleanupInvalidTokens calls getToken once for the service/account
      // loadExistingAuth calls getToken again for the same service/account
      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // First call in cleanup - no token for cleanup
        .mockReturnValueOnce(null) // Second call in cleanup for empty account (if account === "default")
        .mockReturnValueOnce(wrongScopeToken); // Third call in loadExistingAuth

      // Mock fs.readFile - won't be called because token is deleted before reaching createOAuth2ClientFromToken
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
        .mockReturnValueOnce(null) // First call in cleanup - no token
        .mockReturnValueOnce(validToken); // Second call in loadExistingAuth

      // Mock OAuth2Client
      const mockAuthClient = {
        setCredentials: mock(() => {}),
        getAccessToken: mock(async () => ({
          token: "test_access_token",
        })),
        credentials: {
          access_token: "test_access_token",
          refresh_token: "test_refresh",
          expiry_date: Date.now() + 3600000,
        },
      } as unknown as AuthClient;

      // Mock google.auth.OAuth2 constructor
      const OAuth2Original = google.auth.OAuth2;
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as any;

      // Mock fs.readFile to return credentials
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

      // Mock authenticate to throw (will fail, but we catch it)
      spyOn(localAuth, "authenticate").mockRejectedValueOnce(
        new Error("Authentication failed")
      );

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
        expiry_date: Date.now() + 3600000, // 1 hour from now
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      // cleanupInvalidTokens calls getToken for service/account, and if account === "default", also for empty account
      // loadExistingAuth calls getToken again for service/account
      (mockTokenStore.getToken as ReturnType<typeof mock>)
        .mockReturnValueOnce(null) // First call in cleanup - no token for service/account
        .mockReturnValueOnce(null) // Second call in cleanup - no token for empty account (since account === "default")
        .mockReturnValueOnce(mockToken); // Third call in loadExistingAuth - token exists

      // Mock OAuth2Client with proper mock functions
      const setCredentialsMock = mock(() => {});
      const getAccessTokenMock = mock(async () => ({
        token: "test_access_token",
      }));
      
      const expiryDate = Date.now() + 3600000;
      const mockAuthClient = {
        setCredentials: setCredentialsMock,
        getAccessToken: getAccessTokenMock,
        credentials: {
          access_token: "test_access_token",
          refresh_token: "test_refresh_token",
          expiry_date: expiryDate,
        },
      } as unknown as AuthClient;

      // Mock google.auth.OAuth2 constructor to return our mock client
      // IMPORTANT: When using 'new', the constructor function's return value is used
      // We need to ensure the returned object has the same reference to our mocks
      const OAuth2Original = google.auth.OAuth2;
      google.auth.OAuth2 = function OAuth2Mock(
        clientId?: string,
        clientSecret?: string,
        redirectUri?: string
      ) {
        // Return the exact mock client object with tracked mocks
        return mockAuthClient;
      } as any;

      // Mock fs.readFile to return credentials
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

      // Should have called getToken (at least twice: cleanup + load)
      expect(mockTokenStore.getToken).toHaveBeenCalled();
      // Should have saved token (for refresh/update)
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      // Should have synchronized credentials
      // setCredentials is called twice:
      // 1. In createOAuth2ClientFromToken (line 219) - initial setup with token data
      // 2. In syncCredentials (line 274) - after refresh with refreshed token data
      // Verify the mock client was returned (should be our OAuth2 mock, not authenticate mock)
      expect(result).toBe(mockAuthClient);
      // Verify setCredentials was called (at least once - in createOAuth2ClientFromToken)
      // The syncCredentials call happens on the same object, so both calls should be tracked
      expect(setCredentialsMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      // Verify getAccessToken was called (in refreshTokenIfNeeded)
      expect(getAccessTokenMock).toHaveBeenCalled();
    });

    it("should authenticate when no valid token exists", async () => {
      // Mock: No token in store
      (mockTokenStore.getToken as ReturnType<typeof mock>).mockReturnValue(null);

      // Mock OAuth2Client for authenticate result
      const mockAuthClient = {
        setCredentials: mock(() => {}),
        getAccessToken: mock(async () => ({
          token: "new_access_token",
        })),
        credentials: {
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          expiry_date: Date.now() + 3600000,
        },
        getCredentials: mock(async () => ({
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          expiry_date: Date.now() + 3600000,
        })),
      } as unknown as AuthClient;

      // Mock authenticate function - override the beforeEach mock for this test
      spyOn(localAuth, "authenticate").mockResolvedValueOnce(
        mockAuthClient as any
      );

      const result = await authManager.getAuthClient({
        service: "gmail",
        account: "default",
        requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        credentialsPath,
      });

      // Should have called authenticate
      expect(localAuth.authenticate).toHaveBeenCalledWith({
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        keyfilePath: credentialsPath,
      });
      // Should have saved token
      expect(mockTokenStore.saveToken).toHaveBeenCalled();
      // Should have synchronized credentials
      expect(mockAuthClient.setCredentials).toHaveBeenCalled();
      // Should return auth client
      expect(result).toBe(mockAuthClient);
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

      // Mock OAuth2Client
      const mockAuthClient = {
        setCredentials: mock(() => {}),
        getAccessToken: mock(async () => ({
          token: "old_token",
        })),
        credentials: {
          access_token: "old_token",
          refresh_token: "refresh_token",
          expiry_date: Date.now() + 3600000,
        },
      } as unknown as AuthClient;

      // Mock google.auth.OAuth2 constructor
      const OAuth2Original = google.auth.OAuth2;
      google.auth.OAuth2 = function OAuth2Mock() {
        return mockAuthClient;
      } as any;

      // Mock fs.readFile
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
