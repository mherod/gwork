/**
 * Base service class with shared authentication and initialization logic.
 * All Google API service classes extend this.
 * 
 * **DESIGN:**
 * - Delegates all OAuth2Client operations to AuthManager
 * - Focuses only on service-specific initialization
 * - Simple and testable with mocked AuthManager
 */

import { google } from "googleapis";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import { InitializationError } from "./errors.ts";
import { logger as defaultLogger } from "../utils/logger.ts";
import type { Logger } from "../utils/logger.ts";
import type { AuthClient } from "../types/google-apis.ts";
import { AuthManager } from "./auth-manager.ts";
import { TokenStore } from "./token-store.ts";
import * as path from "path";
import * as os from "os";

export interface BaseServiceDeps {
  authManager?: AuthManager;
}

export abstract class BaseService {
  protected auth: AuthClient | null = null;
  protected readonly SCOPES: string[];
  protected account: string;
  protected logger: Logger;
  protected initialized = false;
  private authManager: AuthManager;

  constructor(
    protected serviceName: string,
    scopes: string[],
    account = "default",
    logger: Logger = defaultLogger,
    deps?: BaseServiceDeps
  ) {
    this.account = account;
    this.SCOPES = scopes;
    this.logger = logger;
    this.authManager = deps?.authManager ?? new AuthManager({
      tokenStore: TokenStore.getInstance(),
      logger: this.logger,
    });
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

    // Delegate all authentication to AuthManager
    // AuthManager handles: token loading, refresh, credential sync, cleanup
    try {
      this.auth = await this.authManager.getAuthClient({
        service: this.serviceName,
        account: this.account,
        requiredScopes: this.SCOPES,
        credentialsPath: CREDENTIALS_PATH,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Authentication failed: ${errorMessage}`);
      throw new InitializationError(this.serviceName);
    }

    this.initialized = true;
    
    // Note: Subclasses should override initialize() to set up their API clients
    // after calling super.initialize(). The auth object is now ready to use.
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

  /**
   * Verifies that the authenticated token belongs to the requested account.
   * Uses the OAuth2 userinfo endpoint which works with any Google API token.
   * Subclasses should call this in initialize() when account !== "default".
   *
   * @throws {Error} If the token's email doesn't match the requested account
   */
  protected async verifyAccount(): Promise<void> {
    if (this.account === "default") return;

    const oauth2 = google.oauth2({ version: "v2", auth: this.getAuth() });
    const userinfo = await oauth2.userinfo.get();
    const authenticatedEmail = userinfo.data.email ?? "";

    if (authenticatedEmail.toLowerCase() !== this.account.toLowerCase()) {
      throw new Error(
        `Account mismatch: token is authenticated as "${authenticatedEmail}" but "--account ${this.account}" was requested. ` +
        `Run "gwork ${this.serviceName.toLowerCase()} --account ${this.account}" to re-authenticate the correct account.`
      );
    }
  }
}
