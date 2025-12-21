/**
 * Base service class with shared authentication and initialization logic.
 * All Google API service classes extend this.
 */

import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { TokenStore } from "./token-store.ts";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import { InitializationError } from "./errors.ts";
import { Logger, defaultLogger } from "./logger.ts";
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
   * @param credentialsPath - Path to credentials JSON file
   * @returns AuthClient if valid token found, null otherwise
   */
  protected async loadSavedAuthIfExist(credentialsPath: string): Promise<AuthClient | null> {
    try {
      const token = this.tokenStore.getToken(this.serviceName.toLowerCase(), this.account);

      if (!token) return null;

      // Scope validation
      const hasRequiredScopes = this.SCOPES.every((scope) => token.scopes.includes(scope));

      if (!hasRequiredScopes) {
        this.logger.info(
          `Token has incorrect scopes for ${this.serviceName}. Re-authenticating...`
        );
        this.tokenStore.deleteToken(this.serviceName.toLowerCase(), this.account);
        return null;
      }

      // Reconstruct auth client from stored credentials
      const credentialsContent = await fs.readFile(credentialsPath, "utf8");
      const credentials = JSON.parse(credentialsContent);
      const clientConfig = credentials.installed || credentials.web;

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
      await auth.getAccessToken();
      this.logger.info(`Using saved ${this.serviceName} token (account: ${this.account})`);
      return auth;
    } catch (error) {
      this.logger.warn(`Saved ${this.serviceName} token is invalid. Re-authenticating...`);
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
    const credentials = await auth.getCredentials();
    const accessToken = await auth.getAccessToken();

    this.tokenStore.saveToken(this.serviceName.toLowerCase(), this.account, {
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
}
