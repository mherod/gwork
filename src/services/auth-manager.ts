/**
 * Authentication manager for OAuth2Client lifecycle and credential synchronization.
 * 
 * **RESPONSIBILITIES:**
 * - Creates and manages OAuth2Client instances
 * - Coordinates token refresh and credential synchronization
 * - Ensures credentials are always in sync between OAuth2Client and TokenStore
 * - Handles token validation and cleanup
 * 
 * **DESIGN PRINCIPLES:**
 * - Single Responsibility: Only handles OAuth2Client operations
 * - Dependency Injection: TokenStore and Logger are injected
 * - Testable: All dependencies can be mocked
 * 
 * **CRITICAL: Credential Synchronization**
 * 
 * After any token operation (refresh, save, load), we MUST call `setCredentials()`
 * on the OAuth2Client to ensure the auth object's internal state matches what's
 * in the database. Without this, refreshed tokens won't work until the next run.
 * 
 * @module auth-manager
 */

import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import type { AuthClient } from "../types/google-apis.ts";
import type { TokenStore } from "./token-store.ts";
import type { Logger } from "./logger.ts";
import type { TokenData } from "./token-store.ts";
import * as fs from "fs/promises";

export interface AuthManagerConfig {
  tokenStore: TokenStore;
  logger: Logger;
}

export interface GetAuthClientOptions {
  service: string;
  account: string;
  requiredScopes: string[];
  credentialsPath: string;
}

/**
 * Manages OAuth2Client instances and ensures credential synchronization.
 * 
 * This class handles all OAuth2Client operations, ensuring that credentials
 * are always synchronized between the OAuth2Client instance and the TokenStore.
 */
export class AuthManager {
  constructor(private config: AuthManagerConfig) {}

  /**
   * Gets an authenticated OAuth2Client for the specified service and account.
   * 
   * **Flow:**
   * 1. Check for existing token in TokenStore
   * 2. If token exists and valid: Load and refresh if needed
   * 3. If token invalid/missing: Authenticate and save
   * 4. Ensure credentials are synchronized
   * 
   * @param options - Service configuration
   * @returns Authenticated OAuth2Client
   * @throws Error if authentication fails
   */
  async getAuthClient(options: GetAuthClientOptions): Promise<AuthClient> {
    const { service, account, requiredScopes, credentialsPath } = options;
    const { tokenStore, logger } = this.config;

    // Clean up invalid tokens before attempting to load
    this.cleanupInvalidTokens(service, account, requiredScopes, logger, tokenStore);

    // Try to load existing token
    const existingAuth = await this.loadExistingAuth(
      service,
      account,
      requiredScopes,
      credentialsPath,
      tokenStore,
      logger
    );

    if (existingAuth) {
      return existingAuth;
    }

    // No valid token found - authenticate
    return await this.authenticateAndSave(
      service,
      account,
      requiredScopes,
      credentialsPath,
      tokenStore,
      logger
    );
  }

  /**
   * Cleans up invalid tokens (empty scopes, wrong scopes).
   * 
   * @private
   */
  private cleanupInvalidTokens(
    service: string,
    account: string,
    _requiredScopes: string[],
    logger: Logger,
    tokenStore: TokenStore
  ): void {
    const serviceKey = service.toLowerCase();
    
    // Clean up token with empty scopes for this service/account
    const existingToken = tokenStore.getToken(serviceKey, account);
    if (existingToken) {
      const hasEmptyScopes = !existingToken.scopes || 
                             (Array.isArray(existingToken.scopes) && existingToken.scopes.length === 0);
      if (hasEmptyScopes) {
        logger.info(`Removing token with empty scopes for ${service} (account: ${account})`);
        tokenStore.deleteToken(serviceKey, account);
      }
    }
    
    // Clean up legacy tokens with empty account strings
    if (account === "default") {
      const emptyAccountToken = tokenStore.getToken(serviceKey, "");
      if (emptyAccountToken) {
        const hasEmptyScopes = !emptyAccountToken.scopes || 
                               (Array.isArray(emptyAccountToken.scopes) && emptyAccountToken.scopes.length === 0);
        if (hasEmptyScopes) {
          logger.info(`Removing legacy token with empty account string for ${service}`);
          tokenStore.deleteToken(serviceKey, "");
        }
      }
    }
  }

  /**
   * Loads existing auth client from TokenStore if valid.
   * 
   * @private
   */
  private async loadExistingAuth(
    service: string,
    account: string,
    requiredScopes: string[],
    credentialsPath: string,
    tokenStore: TokenStore,
    logger: Logger
  ): Promise<AuthClient | null> {
    try {
      const serviceKey = service.toLowerCase();
      const token = tokenStore.getToken(serviceKey, account);

      if (!token) return null;

      // Validate scopes
      if (!token.scopes || token.scopes.length === 0) {
        logger.info(`Token has no scopes for ${service}. Re-authenticating...`);
        tokenStore.deleteToken(serviceKey, account);
        return null;
      }

      const hasRequiredScopes = requiredScopes.every((scope) => token.scopes.includes(scope));
      if (!hasRequiredScopes) {
        const missingScopes = requiredScopes.filter((scope) => !token.scopes.includes(scope));
        logger.info(
          `Token has incorrect scopes for ${service}. Missing: ${missingScopes.join(", ")}. Re-authenticating...`
        );
        tokenStore.deleteToken(serviceKey, account);
        return null;
      }

      // Create OAuth2Client from token
      const auth = await this.createOAuth2ClientFromToken(token, credentialsPath);
      
      // Validate token using getTokenInfo() if available (like in the Google example)
      // This helps catch invalid tokens early before attempting API calls
      try {
        if (token.access_token && typeof (auth as any).getTokenInfo === "function") {
          const tokenInfo = await (auth as any).getTokenInfo(token.access_token);
          // Check if token is expired or invalid
          if (tokenInfo.expiry_date && tokenInfo.expiry_date * 1000 < Date.now()) {
            logger.info(`Token is expired. Refreshing...`);
            // Will be refreshed in refreshTokenIfNeeded below
          }
        }
      } catch (tokenInfoError) {
        // If getTokenInfo fails, token might be invalid - but don't delete yet
        // Let refreshTokenIfNeeded handle it (it will try to refresh)
        logger.debug(`Token info check failed (may be expired): ${tokenInfoError instanceof Error ? tokenInfoError.message : String(tokenInfoError)}`);
      }
      
      // Refresh token if needed and synchronize credentials
      const originalExpiry = token.expiry_date;
      const refreshedToken = await this.refreshTokenIfNeeded(auth, token, requiredScopes, tokenStore, logger);
      
      // CRITICAL: Synchronize credentials after refresh
      this.syncCredentials(auth, refreshedToken);
      
      // Check if token was refreshed by comparing expiry dates
      const wasRefreshed = refreshedToken.expiry_date !== originalExpiry;
      if (wasRefreshed) {
        logger.info(`Refreshed and saved ${service} token (account: ${account})`);
      } else {
        logger.info(`Using saved ${service} token (account: ${account})`);
      }
      
      return auth;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Only delete token for authentication-related errors
      // Don't delete for network errors, file system errors, or other transient issues
      const isAuthError = 
        errorMessage.includes("invalid_grant") ||
        errorMessage.includes("invalid_token") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("authentication") ||
        errorMessage.includes("credentials") ||
        (error instanceof Error && "code" in error && (error as any).code === 401);
      
      if (isAuthError) {
        logger.warn(`Saved ${service} token is invalid (${errorMessage}). Re-authenticating...`);
        tokenStore.deleteToken(service.toLowerCase(), account);
      } else {
        // For non-auth errors, log but don't delete token - might be transient
        logger.warn(`Error loading ${service} token (${errorMessage}). Token not deleted - may be transient error.`);
      }
      
      return null;
    }
  }

  /**
   * Creates OAuth2Client from stored token data.
   * 
   * @private
   */
  private async createOAuth2ClientFromToken(
    token: TokenData,
    credentialsPath: string
  ): Promise<AuthClient> {
    const credentialsContent = await fs.readFile(credentialsPath, "utf8");
    const credentialsFile = JSON.parse(credentialsContent);
    const clientConfig = credentialsFile.installed || credentialsFile.web;

    const auth = new google.auth.OAuth2(
      clientConfig.client_id,
      clientConfig.client_secret,
      clientConfig.redirect_uris?.[0] || "http://localhost"
    ) as unknown as AuthClient;

    auth.setCredentials({
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expiry_date: token.expiry_date,
    });

    return auth;
  }

  /**
   * Refreshes token if expired and saves to TokenStore.
   * Returns the token data (updated if refreshed).
   * 
   * @private
   */
  private async refreshTokenIfNeeded(
    auth: AuthClient,
    existingToken: TokenData,
    requiredScopes: string[],
    tokenStore: TokenStore,
    logger: Logger
  ): Promise<TokenData> {
    // getAccessToken() will automatically refresh if expired
    // This is the recommended approach (like in the Google example)
    let accessTokenResponse;
    try {
      accessTokenResponse = await auth.getAccessToken();
    } catch (refreshError) {
      // If refresh fails, it's likely an authentication error
      const errorMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
      if (
        errorMessage.includes("invalid_grant") ||
        errorMessage.includes("invalid_token") ||
        errorMessage.includes("unauthorized")
      ) {
        logger.warn(`Token refresh failed (${errorMessage}). Token may be revoked.`);
        throw refreshError; // Will be caught by loadExistingAuth and trigger re-auth
      }
      throw refreshError;
    }
    
    const authCredentials = (auth as any).credentials || {};
    
    // Always save current credentials (updates expiry_date even if not refreshed)
    const updatedToken: Omit<TokenData, "created_at" | "updated_at"> = {
      service: existingToken.service,
      account: existingToken.account,
      access_token: accessTokenResponse.token || existingToken.access_token,
      refresh_token: existingToken.refresh_token, // Refresh token doesn't change
      scopes: requiredScopes, // Always use required scopes (not old scopes)
      expiry_date: authCredentials.expiry_date || existingToken.expiry_date,
    };
    
    tokenStore.saveToken(updatedToken);
    
    // Return updated token data
    return {
      ...updatedToken,
      created_at: existingToken.created_at,
      updated_at: Date.now(),
    };
  }

  /**
   * Synchronizes OAuth2Client credentials with token data.
   * 
   * **CRITICAL:** This ensures the auth object's internal state matches
   * what's in the database. Without this, refreshed tokens won't work
   * until the next run.
   * 
   * @private
   */
  private syncCredentials(auth: AuthClient, token: TokenData): void {
    auth.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: token.expiry_date,
    });
  }

  /**
   * Authenticates user and saves token to TokenStore.
   * 
   * @private
   */
  private async authenticateAndSave(
    service: string,
    account: string,
    requiredScopes: string[],
    credentialsPath: string,
    tokenStore: TokenStore,
    logger: Logger
  ): Promise<AuthClient> {
    logger.info(`Authenticating ${service} service (account: ${account})...`);
    
    const newAuth = await authenticate({
      scopes: requiredScopes,
      keyfilePath: credentialsPath,
    });

    if (
      !newAuth ||
      typeof newAuth !== "object" ||
      !("getAccessToken" in newAuth) ||
      !("setCredentials" in newAuth)
    ) {
      throw new Error(`Authentication failed for ${service}`);
    }

    const auth = newAuth as unknown as AuthClient;

    // Validate token works
    const validationToken = await auth.getAccessToken();
    if (!validationToken.token) {
      throw new Error("No access token received from authentication");
    }

    // Save to database
    await this.saveAuthToStore(auth, service, account, requiredScopes, tokenStore);

    // CRITICAL: Get latest credentials after save and synchronize
    const latestAccessToken = await auth.getAccessToken();
    const authCredentials = (auth as any).credentials || {};
    
    this.syncCredentials(auth, {
      service: service.toLowerCase(),
      account,
      access_token: latestAccessToken.token || authCredentials.access_token || "",
      refresh_token: authCredentials.refresh_token || "",
      expiry_date: authCredentials.expiry_date || 0,
      scopes: requiredScopes,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    logger.info(`Successfully authenticated and saved ${service} token (account: ${account})`);
    return auth;
  }

  /**
   * Saves auth client credentials to TokenStore.
   * 
   * @private
   */
  private async saveAuthToStore(
    auth: AuthClient,
    service: string,
    account: string,
    requiredScopes: string[],
    tokenStore: TokenStore
  ): Promise<void> {
    const accessToken = await auth.getAccessToken();
    
    // Try to get full credentials
    let credentials: any = {};
    try {
      const getCredentialsMethod = (auth as any).getCredentials;
      if (typeof getCredentialsMethod === "function") {
        credentials = await getCredentialsMethod.call(auth);
      } else {
        credentials = (auth as any).credentials || {};
      }
    } catch (_error) {
      // If getCredentials fails, use available token data
      credentials = {};
    }

    tokenStore.saveToken({
      service: service.toLowerCase(),
      account,
      access_token: accessToken.token || credentials.access_token || "",
      refresh_token: credentials.refresh_token || "",
      scopes: requiredScopes,
      expiry_date: credentials.expiry_date || 0,
    });
  }
}
