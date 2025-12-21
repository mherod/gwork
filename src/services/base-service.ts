/**
 * Base service class with shared authentication and initialization logic.
 * All Google API service classes extend this.
 */

import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { TokenStore } from "./token-store.ts";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import { InitializationError } from "./errors.ts";
import { defaultLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import type { AuthClient } from "../types/google-apis.ts";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

export abstract class BaseService {
  protected auth: AuthClient | null = null;
  protected readonly SCOPES: string[];
  protected tokenStore: TokenStore;
  protected account: string;
  protected logger: Logger;
  protected initialized = false;

  constructor(
    protected serviceName: string,
    scopes: string[],
    account: string = "default",
    logger: Logger = defaultLogger
  ) {
    this.account = account;
    this.SCOPES = scopes;
    this.tokenStore = TokenStore.getInstance();
    this.logger = logger;
  }

  /**
   * Initialize the service: check credentials, load/refresh tokens, and set up auth client.
   * Safe to call multiple times - skips initialization if already done.
   *
   * @throws {InitializationError} If credentials missing or authentication fails
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");

    if (!ensureCredentialsExist()) {
      throw new InitializationError(this.serviceName);
    }

    let auth = await this.loadSavedAuthIfExist(CREDENTIALS_PATH);

    if (!auth) {
      const newAuth = await authenticate({
        scopes: this.SCOPES,
        keyfilePath: CREDENTIALS_PATH,
      });

      if (
        newAuth &&
        typeof newAuth === "object" &&
        "getAccessToken" in newAuth &&
        "setCredentials" in newAuth
      ) {
        auth = newAuth as unknown as AuthClient;
        await this.saveAuth(auth);
      } else {
        throw new InitializationError(this.serviceName);
      }
    }

    this.auth = auth;
    this.initialized = true;
  }

  /**
   * Loads saved authentication token if it exists and is valid.
   * Validates token has required scopes and can still access API.
   * 
   * **CRITICAL FOR FUTURE DEVELOPERS:**
   * 
   * This method performs several critical operations that MUST be maintained:
   * 
   * 1. **Token Refresh Synchronization**: When a token is expired, `getAccessToken()` 
   *    automatically refreshes it. However, the refreshed token MUST be saved to the 
   *    database AND the auth object's credentials MUST be explicitly updated via 
   *    `setCredentials()`. This ensures the refreshed token is available immediately 
   *    in the current session, not just on the next run.
   * 
   * 2. **Scope Preservation**: Always save `this.SCOPES` (the service's required scopes) 
   *    to the database, NOT the old scopes from the token. This ensures scopes are 
   *    fundamental to the token store mechanism and can be queried correctly.
   * 
   * 3. **Credential Synchronization**: After saving a refreshed token, you MUST call 
   *    `auth.setCredentials()` with the saved token data. Without this, the auth object 
   *    may have stale credentials that don't match what's in the database, causing the 
   *    refreshed token to only work on the next run.
   * 
   * **WHY THIS MATTERS:**
   * 
   * - **Immediate Token Availability**: Without explicit credential synchronization, 
   *   refreshed tokens are saved to the database but the auth object continues using 
   *   old credentials until the next initialization. This causes authentication failures 
   *   in the current session.
   * 
   * - **Scope Consistency**: Saving incorrect or empty scopes breaks token querying 
   *   functionality. The token store relies on accurate scope data to find the right 
   *   token for a given service and account.
   * 
   * - **Database-Object Sync**: The database and the auth object must always be in sync. 
   *   If they diverge, you'll have inconsistent state that's hard to debug.
   * 
   * **PRACTICAL USE CASES:**
   * 
   * 1. **Token Expiry During Long-Running Session**: 
   *    - User runs a command that takes 2 hours
   *    - Token expires after 1 hour
   *    - Token is automatically refreshed
   *    - Without credential sync: Next API call fails (uses old token)
   *    - With credential sync: Next API call succeeds (uses refreshed token)
   * 
   * 2. **Multiple Commands in Same Session**:
   *    - User runs `gwork cal list` (token expires, gets refreshed)
   *    - User immediately runs `gwork cal get <id>` 
   *    - Without credential sync: Second command fails
   *    - With credential sync: Second command succeeds
   * 
   * 3. **Scope Updates**:
   *    - Service requirements change (new scopes needed)
   *    - Old token has incorrect scopes
   *    - Token is deleted and re-authenticated with correct scopes
   *    - New token is saved with `this.SCOPES` (correct scopes)
   * 
   * **CAVEATS AND NUANCES:**
   * 
   * - **Token Refresh Detection**: We detect refresh by comparing expiry dates and access 
   *   tokens. However, OAuth2Client may refresh tokens silently even if not expired 
   *   (e.g., for security reasons). Always save credentials after `getAccessToken()`.
   * 
   * - **Refresh Token Preservation**: When refreshing, we preserve the existing refresh 
   *   token. The refresh token doesn't change unless the user re-authenticates.
   * 
   * - **Empty Scope Handling**: Old tokens may have empty scope arrays. These are 
   *   detected and the token is deleted, forcing re-authentication with correct scopes.
   * 
   * - **Error Handling**: If token validation fails (e.g., refresh token invalid), 
   *   the token is deleted and the method returns null, triggering re-authentication.
   * 
   * - **Performance**: Token refresh adds ~100-500ms latency. This is acceptable for 
   *   the reliability it provides.
   * 
   * **DO NOT:**
   * 
   * - ❌ Skip `setCredentials()` after saving refreshed token (breaks immediate use)
   * - ❌ Save `token.scopes` instead of `this.SCOPES` (breaks scope querying)
   * - ❌ Assume `getAccessToken()` updates auth object automatically (it doesn't sync)
   * - ❌ Remove scope validation (allows tokens with wrong permissions)
   * 
   * **DO:**
   * 
   * - ✅ Always call `setCredentials()` after saving refreshed token
   * - ✅ Always save `this.SCOPES` to ensure correct scope data
   * - ✅ Handle empty scopes by deleting token and re-authenticating
   * - ✅ Log refresh operations for debugging
   * - ✅ Preserve refresh token when updating access token
   *
   * @param credentialsPath - Path to credentials JSON file
   * @returns AuthClient if valid token found, null otherwise (triggers re-authentication)
   * @throws Error if credentials file cannot be read or parsed
   */
  protected async loadSavedAuthIfExist(credentialsPath: string): Promise<AuthClient | null> {
    try {
      const token = this.tokenStore.getToken(this.serviceName.toLowerCase(), this.account);

      if (!token) return null;

      // Scope validation
      // Handle case where token has empty scopes (old tokens or migration issue)
      if (!token.scopes || token.scopes.length === 0) {
        this.logger.info(
          `Token has no scopes for ${this.serviceName}. Re-authenticating...`
        );
        this.tokenStore.deleteToken(this.serviceName.toLowerCase(), this.account);
        return null;
      }

      const hasRequiredScopes = this.SCOPES.every((scope) => token.scopes.includes(scope));

      if (!hasRequiredScopes) {
        const missingScopes = this.SCOPES.filter((scope) => !token.scopes.includes(scope));
        this.logger.info(
          `Token has incorrect scopes for ${this.serviceName}. Missing: ${missingScopes.join(", ")}. Re-authenticating...`
        );
        this.tokenStore.deleteToken(this.serviceName.toLowerCase(), this.account);
        return null;
      }

      // Reconstruct auth client from stored credentials
      const credentialsContent = await fs.readFile(credentialsPath, "utf8");
      const credentialsFile = JSON.parse(credentialsContent);
      const clientConfig = credentialsFile.installed || credentialsFile.web;

      const auth = new google.auth.OAuth2(
        clientConfig.client_id,
        clientConfig.client_secret,
        clientConfig.redirect_uris?.[0] || "http://localhost"
      );

      auth.setCredentials({
        refresh_token: token.refresh_token,
        access_token: token.access_token,
        expiry_date: token.expiry_date,
      });

      // Validate token by making a test API call
      // This will automatically refresh if expired
      // NOTE: getAccessToken() updates OAuth2Client's internal credentials,
      // but we need to explicitly sync them with setCredentials() below
      const accessTokenResponse = await auth.getAccessToken();
      const authCredentials = (auth as any).credentials || {};
      
      // Check if token was refreshed by comparing expiry dates or access tokens
      // This helps with logging but isn't strictly necessary for functionality
      const wasRefreshed = 
        (authCredentials.expiry_date && authCredentials.expiry_date !== token.expiry_date) ||
        (accessTokenResponse.token && accessTokenResponse.token !== token.access_token);
      
      // CRITICAL: Always save the current credentials to ensure expiry_date is up to date
      // This handles cases where the token was silently refreshed by OAuth2Client
      // 
      // IMPORTANT: Always use this.SCOPES to ensure correct scopes are saved
      // Don't preserve old scopes from database as they may be incorrect/empty
      // Scopes are fundamental to the token store mechanism for querying tokens
      const savedToken = {
        service: this.serviceName.toLowerCase(),
        account: this.account,
        access_token: accessTokenResponse.token || token.access_token,
        refresh_token: token.refresh_token, // Keep existing refresh token (doesn't change)
        scopes: this.SCOPES, // Always use service's required scopes (not token.scopes)
        expiry_date: authCredentials.expiry_date || token.expiry_date,
      };
      
      this.tokenStore.saveToken(savedToken);
      
      // CRITICAL: Update the auth object's credentials with the saved token
      // 
      // WHY THIS IS ESSENTIAL:
      // - getAccessToken() refreshes the token and updates OAuth2Client's internal state
      // - However, the auth object returned to the caller may not have these updates
      // - Without setCredentials(), the refreshed token is saved to DB but not used
      // - This causes the refreshed token to only work on the NEXT run, not immediately
      // 
      // WHAT THIS FIXES:
      // - Ensures auth object credentials match what's in the database
      // - Makes refreshed token available immediately in current session
      // - Prevents "token works on next run but not now" bugs
      // 
      // WHEN THIS MATTERS:
      // - Token expires during long-running session (e.g., 2-hour script)
      // - Multiple commands run in same session (token refreshes between commands)
      // - Token refresh happens silently (OAuth2Client auto-refresh)
      // 
      // DO NOT REMOVE THIS: Without it, refreshed tokens won't work until next run
      auth.setCredentials({
        access_token: savedToken.access_token,
        refresh_token: savedToken.refresh_token,
        expiry_date: savedToken.expiry_date,
      });
      
      if (wasRefreshed) {
        this.logger.info(`Refreshed and saved ${this.serviceName} token (account: ${this.account})`);
      } else {
        this.logger.info(`Using saved ${this.serviceName} token (account: ${this.account})`);
      }
      
      return auth;
    } catch (error) {
      // Log the actual error for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Saved ${this.serviceName} token is invalid (${errorMessage}). Re-authenticating...`
      );
      this.tokenStore.deleteToken(this.serviceName.toLowerCase(), this.account);
      return null;
    }
  }

  /**
   * Saves authentication token to persistent storage.
   *
   * @param auth - Authenticated OAuth2 client
   */
  protected async saveAuth(auth: AuthClient): Promise<void> {
    const accessToken = await auth.getAccessToken();
    
    // Try to get credentials, but handle cases where it might not be available
    // OAuth2Client may not have getCredentials() method in all versions
    let credentials: any = {};
    try {
      // Check if getCredentials exists and is callable
      const getCredentialsMethod = (auth as any).getCredentials;
      if (typeof getCredentialsMethod === "function") {
        credentials = await getCredentialsMethod.call(auth);
      } else {
        // Fallback: extract from internal credentials if available
        credentials = (auth as any).credentials || {};
      }
    } catch (error) {
      // If getCredentials fails, use empty credentials object
      this.logger.warn("Could not retrieve full credentials, using available token data");
      credentials = {};
    }

    this.tokenStore.saveToken({
      service: this.serviceName.toLowerCase(),
      account: this.account,
      access_token: accessToken.token || credentials.access_token || "",
      refresh_token: credentials.refresh_token || "",
      scopes: this.SCOPES,
      expiry_date: credentials.expiry_date || 0,
    });
  }

  /**
   * Ensures service is initialized. Throws if not.
   * Called at start of all public methods.
   *
   * @throws {InitializationError} If service not initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized || !this.auth) {
      throw new InitializationError(this.serviceName);
    }
  }

  /**
   * Gets the authenticated auth client, ensuring it's not null.
   * Throws if service is not initialized.
   * 
   * @returns Non-null AuthClient
   * @throws {InitializationError} If service not initialized
   * @protected
   */
  protected getAuth(): AuthClient {
    if (!this.initialized || !this.auth) {
      throw new InitializationError(this.serviceName);
    }
    return this.auth;
  }
}
