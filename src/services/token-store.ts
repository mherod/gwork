/**
 * Token storage service for managing OAuth2 tokens across multiple Google services and accounts.
 * 
 * **CRITICAL FOR FUTURE DEVELOPERS:**
 * 
 * This service uses SQLite for persistent token storage and **MUST** use database retry logic
 * for all operations. Database lock errors are common when multiple processes access the same
 * database file simultaneously (e.g., multiple CLI instances, background processes).
 * 
 * **IMPORTANT: ALL DATABASE OPERATIONS USE RETRY LOGIC**
 * 
 * Every database operation in this class is wrapped with `withDbRetrySync()` to handle
 * transient "database is locked" errors automatically. This is **not optional** - removing
 * retry logic will cause production failures.
 * 
 * **WHY RETRY LOGIC IS ESSENTIAL:**
 * 
 * 1. **Concurrent access:** Multiple CLI processes may access tokens simultaneously
 * 2. **WAL checkpoints:** SQLite WAL mode performs periodic checkpoints that briefly lock the DB
 * 3. **Long transactions:** Other processes may hold locks during token refresh operations
 * 4. **File system delays:** Network file systems (NFS, etc.) can cause lock delays
 * 
 * **DATABASE CONFIGURATION:**
 * 
 * - **WAL mode enabled:** Better concurrent read performance
 * - **busy_timeout: 5 seconds:** SQLite waits up to 5s for locks to clear
 * - **Retry logic:** Additional layer above SQLite's busy_timeout
 * - **Location:** `~/.gwork_tokens.db` (user's home directory)
 * 
 * **OPERATIONS WITH RETRY PROTECTION:**
 * 
 * All of these methods automatically retry on database lock errors:
 * - `saveToken()` - Token storage/updates
 * - `getToken()` - Token retrieval
 * - `listTokens()` - Token listing
 * - `deleteToken()` - Token deletion
 * - `hasValidScopes()` - Scope validation (uses getToken internally)
 * - `initializeSchema()` - Schema initialization
 * 
 * **PERFORMANCE CHARACTERISTICS:**
 * 
 * - **Retry delays:** 1s → 2s → 4s → 8s → 10s (worst case ~25s total)
 * - **Typical case:** Operations succeed immediately or on first retry
 * - **Frequency:** Token operations are infrequent (auth happens rarely)
 * - **Acceptable:** Retry delays are acceptable for authentication operations
 * 
 * **FUTURE CONSIDERATIONS:**
 * 
 * If you need to add new database operations:
 * 1. **Always wrap with withDbRetrySync()** - never call db methods directly
 * 2. **Consider async migration** - make methods async and use withDbRetry() instead
 * 3. **Test concurrent access** - verify retry logic works under load
 * 4. **Monitor retry frequency** - frequent retries indicate a design issue
 * 
 * **EXAMPLE OF CORRECT USAGE:**
 * 
 * ```typescript
 * // ✅ CORRECT: Wrapped in retry logic (current implementation)
 * saveToken(data: TokenData): void {
 *   withDbRetrySync(() => {
 *     const stmt = this.db.prepare("INSERT INTO tokens ...");
 *     stmt.run({ ...data });
 *   });
 * }
 * 
 * // ❌ WRONG: Direct database call (will fail on locks!)
 * saveToken(data: TokenData): void {
 *   const stmt = this.db.prepare("INSERT INTO tokens ...");
 *   stmt.run({ ...data }); // No retry protection!
 * }
 * ```
 * 
 * **TESTING:**
 * 
 * - Unit tests verify retry behavior (tests/unit/services/token-store.test.ts)
 * - Tests should simulate concurrent access scenarios
 * - Monitor test execution time (retries add latency)
 * 
 * @module token-store
 * @see {@link withDbRetrySync} for retry logic implementation
 * @see {@link Database} for SQLite wrapper
 */

import path from "node:path";
import os from "node:os";
import { Database } from "../utils/sqlite-wrapper.ts";
import { withDbRetrySync } from "../utils/db-retry.ts";
import { defaultLogger } from "./logger.ts";

export interface TokenData {
  service: string;
  account: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scopes: string[];
  created_at: number;
  updated_at: number;
}

/**
 * Singleton token storage service for OAuth2 tokens.
 * 
 * **CRITICAL:** All database operations use retry logic to handle concurrent access.
 * 
 * @see TokenStore class documentation for important details about retry logic
 */
export class TokenStore {
  private db: Database;
  private static instance: TokenStore | null = null;

  /**
   * Private constructor for singleton pattern.
   * 
   * **IMPORTANT:** Database initialization uses retry logic for pragma operations.
   * 
   * Configuration:
   * - WAL mode: Enables better concurrent read performance
   * - busy_timeout: 5 seconds - SQLite waits up to 5s for locks to clear
   * - Retry logic: Additional protection above SQLite's busy_timeout
   * 
   * @internal
   */
  private constructor() {
    const dbPath = path.join(os.homedir(), ".gwork_tokens.db");
    this.db = new Database(dbPath, { create: true });

    // Enable WAL mode for better performance and concurrent access
    // Set busy timeout to 5 seconds for better lock handling
    // Both operations are wrapped in retry logic to handle initialization locks
    withDbRetrySync(
      () => {
        this.db.pragma("journal_mode", "WAL");
        // Set busy timeout to 5 seconds for better lock handling
        // This tells SQLite to wait up to 5 seconds before returning "database is locked"
        // Combined with retry logic, this provides robust lock handling
        this.db.pragma("busy_timeout", 5000);
      },
      { logger: defaultLogger }
    );

    this.initializeSchema();
  }

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  /**
   * Initializes the database schema (tables and indexes).
   * 
   * **CRITICAL:** Schema operations use retry logic to handle database locks.
   * 
   * **Behavior:**
   * - Creates tokens table if it doesn't exist
   * - Creates service index for faster lookups
   * - Idempotent: Safe to call multiple times (IF NOT EXISTS)
   * - Retries on database lock errors with exponential backoff
   * 
   * **When it runs:**
   * - Automatically called during TokenStore construction
   * - Only runs once per TokenStore instance (singleton)
   * - Safe if multiple processes initialize simultaneously
   * 
   * **Performance:**
   * - Typical: Succeeds immediately (< 20ms)
   * - With lock: May retry 1-5 times (1s → 2s → 4s → 8s → 10s delays)
   * - Only runs once per process lifetime
   * 
   * **Thread safety:**
   * - Safe for concurrent initialization from multiple processes
   * - IF NOT EXISTS clauses prevent conflicts
   * - Retry logic handles any transient lock issues
   * 
   * @internal
   * @throws Error if database operation fails after all retries
   */
  private initializeSchema() {
    withDbRetrySync(
      () => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS tokens (
            service TEXT NOT NULL,
            account TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expiry_date INTEGER NOT NULL,
            scopes TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (service, account)
          )
        `);
      },
      { logger: defaultLogger }
    );

    withDbRetrySync(
      () => {
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_service
          ON tokens(service)
        `);
      },
      { logger: defaultLogger }
    );
  }

  /**
   * Saves or updates an OAuth2 token for a service and account.
   * 
   * **CRITICAL:** This operation uses retry logic to handle database locks.
   * 
   * **Behavior:**
   * - Upsert operation: Creates new token or updates existing one
   * - Automatically sets created_at and updated_at timestamps
   * - Stores scopes as JSON string
   * - Retries on database lock errors with exponential backoff
   * 
   * **Performance:**
   * - Typical: Succeeds immediately (< 10ms)
   * - With lock: May retry 1-5 times (1s → 2s → 4s → 8s → 10s delays)
   * - Worst case: ~25 seconds total (very rare)
   * 
   * **Use cases:**
   * - Saving new authentication tokens after OAuth flow
   * - Updating tokens after refresh
   * - Storing tokens for multiple accounts/services
   * 
   * **Thread safety:**
   * - Safe for concurrent calls from multiple processes
   * - Retry logic handles concurrent access gracefully
   * - SQLite handles concurrent writes (with WAL mode)
   * 
   * @param data - Token data to save (without timestamps)
   * @throws Error if database operation fails after all retries
   * 
   * @example
   * ```typescript
   * const store = TokenStore.getInstance();
   * store.saveToken({
   *   service: "gmail",
   *   account: "default",
   *   access_token: "ya29...",
   *   refresh_token: "1//0...",
   *   expiry_date: Date.now() + 3600000,
   *   scopes: ["https://www.googleapis.com/auth/gmail.readonly"]
   * });
   * ```
   */
  saveToken(data: Omit<TokenData, "created_at" | "updated_at">): void {
    withDbRetrySync(
      () => {
        const now = Date.now();
        const scopesJson = JSON.stringify(data.scopes);

        const stmt = this.db.prepare(`
          INSERT INTO tokens (
            service, account, access_token, refresh_token,
            expiry_date, scopes, created_at, updated_at
          ) VALUES (
            @service, @account, @access_token, @refresh_token,
            @expiry_date, @scopes, @created_at, @updated_at
          )
          ON CONFLICT(service, account) DO UPDATE SET
            access_token = @access_token,
            refresh_token = @refresh_token,
            expiry_date = @expiry_date,
            scopes = @scopes,
            updated_at = @updated_at
        `);

        stmt.run({
          service: data.service,
          account: data.account,
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expiry_date: data.expiry_date,
          scopes: scopesJson,
          created_at: now,
          updated_at: now,
        });
      },
      { logger: defaultLogger }
    );
  }

  /**
   * Retrieves an OAuth2 token for a service and account.
   * 
   * **CRITICAL:** This operation uses retry logic to handle database locks.
   * 
   * **Behavior:**
   * - Returns null if token doesn't exist (not an error)
   * - Parses JSON scopes back to array
   * - Retries on database lock errors with exponential backoff
   * 
   * **Performance:**
   * - Typical: Succeeds immediately (< 5ms)
   * - With lock: May retry 1-5 times (1s → 2s → 4s → 8s → 10s delays)
   * - Worst case: ~25 seconds total (very rare)
   * 
   * **Use cases:**
   * - Loading saved tokens during service initialization
   * - Checking if tokens exist before authentication
   * - Retrieving tokens for token refresh operations
   * 
   * **Thread safety:**
   * - Safe for concurrent reads from multiple processes
   * - WAL mode enables concurrent reads without blocking
   * - Retry logic handles any transient lock issues
   * 
   * @param service - Service name (e.g., "gmail", "calendar", "contacts")
   * @param account - Account identifier (default: "default")
   * @returns Token data if found, null otherwise
   * @throws Error if database operation fails after all retries
   * 
   * @example
   * ```typescript
   * const store = TokenStore.getInstance();
   * const token = store.getToken("gmail", "default");
   * if (token) {
   *   console.log(`Token expires at: ${new Date(token.expiry_date)}`);
   * }
   * ```
   */
  getToken(service: string, account: string = "default"): TokenData | null {
    return withDbRetrySync(
      () => {
        const stmt = this.db.prepare(`
          SELECT * FROM tokens
          WHERE service = @service AND account = @account
        `);

        const row: any = stmt.get({ service, account });

        if (!row) return null;

        return {
          service: row.service,
          account: row.account,
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expiry_date: row.expiry_date,
          scopes: JSON.parse(row.scopes),
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      },
      { logger: defaultLogger }
    );
  }

  getDefaultToken(service: string): TokenData | null {
    return this.getToken(service, "default");
  }

  /**
   * Lists all stored tokens, optionally filtered by service.
   * 
   * **CRITICAL:** This operation uses retry logic to handle database locks.
   * 
   * **Behavior:**
   * - Returns all tokens if service not specified
   * - Returns tokens for specific service if service specified
   * - Sorted by service and account for consistent ordering
   * - Retries on database lock errors with exponential backoff
   * 
   * **Performance:**
   * - Typical: Succeeds immediately (< 10ms for small datasets)
   * - With lock: May retry 1-5 times (1s → 2s → 4s → 8s → 10s delays)
   * - Scales with number of tokens (linear scan)
   * 
   * **Use cases:**
   * - Debugging: See all stored tokens
   * - Multi-account management: List tokens for all accounts
   * - Service-specific queries: List tokens for a specific service
   * 
   * **Thread safety:**
   * - Safe for concurrent reads from multiple processes
   * - WAL mode enables concurrent reads
   * - Retry logic handles transient locks
   * 
   * @param service - Optional service name to filter by
   * @returns Array of token data (empty array if none found)
   * @throws Error if database operation fails after all retries
   * 
   * @example
   * ```typescript
   * const store = TokenStore.getInstance();
   * 
   * // List all tokens
   * const allTokens = store.listTokens();
   * 
   * // List tokens for specific service
   * const gmailTokens = store.listTokens("gmail");
   * ```
   */
  listTokens(service?: string): TokenData[] {
    return withDbRetrySync(
      () => {
        let stmt;
        let rows: any[];

        if (service) {
          stmt = this.db.prepare(`
            SELECT * FROM tokens
            WHERE service = @service
            ORDER BY account
          `);
          rows = stmt.all({ service });
        } else {
          stmt = this.db.prepare(`
            SELECT * FROM tokens
            ORDER BY service, account
          `);
          rows = stmt.all();
        }

        return rows.map(row => ({
          service: row.service,
          account: row.account,
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expiry_date: row.expiry_date,
          scopes: JSON.parse(row.scopes),
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
      },
      { logger: defaultLogger }
    );
  }

  /**
   * Deletes a token for a service and account.
   * 
   * **CRITICAL:** This operation uses retry logic to handle database locks.
   * 
   * **Behavior:**
   * - Returns true if token was deleted, false if it didn't exist
   * - Idempotent: Safe to call multiple times
   * - Retries on database lock errors with exponential backoff
   * 
   * **Performance:**
   * - Typical: Succeeds immediately (< 5ms)
   * - With lock: May retry 1-5 times (1s → 2s → 4s → 8s → 10s delays)
   * - Worst case: ~25 seconds total (very rare)
   * 
   * **Use cases:**
   * - Logout: Remove tokens when user logs out
   * - Token invalidation: Delete invalid/expired tokens
   * - Account removal: Clean up tokens for removed accounts
   * - Re-authentication: Clear old tokens before new auth flow
   * 
   * **Thread safety:**
   * - Safe for concurrent calls from multiple processes
   * - Retry logic handles concurrent deletes gracefully
   * - SQLite handles concurrent writes (with WAL mode)
   * 
   * @param service - Service name (e.g., "gmail", "calendar")
   * @param account - Account identifier (default: "default")
   * @returns true if token was deleted, false if it didn't exist
   * @throws Error if database operation fails after all retries
   * 
   * @example
   * ```typescript
   * const store = TokenStore.getInstance();
   * const deleted = store.deleteToken("gmail", "default");
   * if (deleted) {
   *   console.log("Token deleted successfully");
   * }
   * ```
   */
  deleteToken(service: string, account: string = "default"): boolean {
    return withDbRetrySync(
      () => {
        const stmt = this.db.prepare(`
          DELETE FROM tokens
          WHERE service = @service AND account = @account
        `);

        const result = stmt.run({ service, account });

        return result.changes > 0;
      },
      { logger: defaultLogger }
    );
  }

  hasValidScopes(service: string, requiredScopes: string[], account: string = "default"): boolean {
    const token = this.getToken(service, account);
    if (!token) return false;

    return requiredScopes.every(scope => token.scopes.includes(scope));
  }

  close(): void {
    this.db.close();
  }
}
