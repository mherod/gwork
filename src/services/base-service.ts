/**
 * Base service class with shared authentication and initialization logic.
 * All Google API service classes extend this.
 * 
 * **DESIGN:**
 * - Delegates all OAuth2Client operations to AuthManager
 * - Focuses only on service-specific initialization
 * - Simple and testable with mocked AuthManager
 */

import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import { InitializationError } from "./errors.ts";
import { defaultLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import type { AuthClient } from "../types/google-apis.ts";
import { AuthManager } from "./auth-manager.ts";
import { TokenStore } from "./token-store.ts";
import * as path from "path";
import * as os from "os";

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
    logger: Logger = defaultLogger
  ) {
    this.account = account;
    this.SCOPES = scopes;
    this.logger = logger;
    // Create AuthManager with dependencies
    this.authManager = new AuthManager({
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
}
