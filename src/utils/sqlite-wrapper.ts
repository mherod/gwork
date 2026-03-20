/**
 * SQLite Wrapper - Provides a unified interface for both Bun's native sqlite and better-sqlite3
 * This allows the same code to work in both Bun and Node.js environments
 */

import { execFileSync } from "node:child_process";

// Determine runtime
const isBun = typeof Bun !== "undefined";

// Import appropriate SQLite module
let SQLiteModule: any;

if (isBun) {
  SQLiteModule = await import("bun:sqlite");
} else {
  SQLiteModule = await loadBetterSqlite3();
}

/**
 * Checks whether an error is a native binding load failure.
 * These occur when better-sqlite3 was compiled for a different Node.js ABI version.
 */
function isBindingError(error: unknown): boolean {
  const msg = (error as any)?.message || String(error);
  return msg.includes("Could not locate the bindings file") ||
    msg.includes("ERR_MODULE_NOT_FOUND") ||
    msg.includes("better_sqlite3.node") ||
    msg.includes("NODE_MODULE_VERSION");
}

/**
 * Verifies the native binding loads by creating and immediately closing
 * an in-memory database.
 */
function verifyBinding(mod: any): void {
  const Ctor = mod.default || mod;
  const testDb = new Ctor(":memory:");
  testDb.close();
}

/**
 * Attempts to rebuild better-sqlite3 native binding using node-gyp.
 * Returns true on success, false on failure.
 */
function tryRebuild(): boolean {
  try {
    const pkgPath = require.resolve("better-sqlite3/package.json");
    const dir = pkgPath.replace(/\/package\.json$/, "");
    console.error(`  Rebuilding in ${dir}…`);
    // Try node-gyp directly first, then fall back to npx
    // node-gyp may not be globally installed
    try {
      execFileSync("node-gyp", ["rebuild", "--directory", dir], {
        stdio: "inherit",
        timeout: 120_000,
      });
      return true;
    } catch {
      // node-gyp not found globally — try via npx
      execFileSync("npx", ["node-gyp", "rebuild", "--directory", dir], {
        stdio: "inherit",
        timeout: 120_000,
      });
      return true;
    }
  } catch {
    return false;
  }
}

function printManualFixMessage(): void {
  console.error(
    "\n❌ Error: better-sqlite3 native binding could not be loaded.\n" +
      "This usually means the binding needs to be compiled for your current Node.js version.\n" +
      "To fix this, run one of:\n" +
      "  npm rebuild better-sqlite3\n" +
      "  pnpm rebuild better-sqlite3\n" +
      "Or reinstall gwork: npm install -g gwork\n"
  );
}

/**
 * Loads better-sqlite3, auto-rebuilding the native binding if it was compiled
 * for a different Node.js ABI version.
 *
 * Flow:
 * 1. Import better-sqlite3 and verify the binding loads
 * 2. If the binding is incompatible, run `node-gyp rebuild`
 * 3. Re-import and return the fresh module
 * 4. If rebuild fails, print a manual-fix message and exit
 */
async function loadBetterSqlite3(): Promise<any> {
  try {
    const mod = await import("better-sqlite3");
    verifyBinding(mod);
    return mod;
  } catch (error) {
    if (!isBindingError(error)) {
      throw error;
    }

    console.error(
      "\n⚠ better-sqlite3 native binding is incompatible with Node.js " +
        process.version + ". Attempting auto-rebuild…\n"
    );

    if (tryRebuild()) {
      try {
        const freshMod = await import("better-sqlite3");
        verifyBinding(freshMod);
        console.error("✔ Rebuild succeeded. Continuing…\n");
        return freshMod;
      } catch {
        printManualFixMessage();
        process.exit(1);
      }
    } else {
      printManualFixMessage();
      process.exit(1);
    }
  }
}

export interface Statement {
  run(params?: Record<string, any>): { changes: number; lastInsertRowid?: number };
  get(params?: Record<string, any>): any;
  all(params?: Record<string, any>): any[];
  finalize?(): void;
}

export class Database {
  private db: any;
  private isBunRuntime: boolean;

  constructor(filename: string, options?: { readonly?: boolean; create?: boolean }) {
    this.isBunRuntime = isBun;

    if (this.isBunRuntime) {
      // Bun's Database constructor
      const DatabaseClass = SQLiteModule.default || SQLiteModule;
      this.db = new DatabaseClass(filename);
    } else {
      // better-sqlite3 constructor
      const BetterSQLite = SQLiteModule.default;
      this.db = new BetterSQLite(filename, options);
    }
  }

  /**
   * Execute a SQL statement (for DDL like CREATE TABLE)
   */
  exec(sql: string): void {
    if (this.isBunRuntime) {
      this.db.run(sql);
    } else {
      this.db.exec(sql);
    }
  }

  /**
   * Set a pragma value
   */
  pragma(pragma: string, value?: any): any {
    if (this.isBunRuntime) {
      // Bun uses run() for pragmas
      if (value !== undefined) {
        this.db.run(`PRAGMA ${pragma} = ${value};`);
      } else {
        const stmt = this.db.query(`PRAGMA ${pragma};`);
        return stmt.get();
      }
    } else {
      // better-sqlite3 has a pragma() method but different signature
      if (value !== undefined) {
        // For setting a pragma, use exec
        this.db.exec(`PRAGMA ${pragma} = ${value};`);
      } else {
        // For getting a pragma, use pragma() with options
        return this.db.pragma(pragma, { simple: true });
      }
    }
  }

  /**
   * Prepare a SQL statement
   * Returns a unified Statement interface
   */
  prepare(sql: string): Statement {
    // Normalize parameter syntax: convert @param to $param for Bun
    const normalizedSql = this.isBunRuntime
      ? sql.replace(/@(\w+)/g, "$$$1") // @param -> $param
      : sql;

    if (this.isBunRuntime) {
      const stmt = this.db.query(normalizedSql);
      return this.wrapBunStatement(stmt);
    } else {
      const stmt = this.db.prepare(normalizedSql);
      return this.wrapBetterSqlite3Statement(stmt);
    }
  }

  /**
   * Wrap Bun's statement to match our interface
   */
  private wrapBunStatement(bunStmt: any): Statement {
    return {
      run: (params?: Record<string, any>) => {
        const normalizedParams = this.normalizeBunParams(params);
        const result = bunStmt.run(normalizedParams);
        return {
          changes: result?.changes ?? 0,
          lastInsertRowid: result?.lastInsertRowid,
        };
      },
      get: (params?: Record<string, any>) => {
        const normalizedParams = this.normalizeBunParams(params);
        return bunStmt.get(normalizedParams);
      },
      all: (params?: Record<string, any>) => {
        const normalizedParams = this.normalizeBunParams(params);
        return bunStmt.all(normalizedParams);
      },
      finalize: () => {
        if (bunStmt.finalize) bunStmt.finalize();
      },
    };
  }

  /**
   * Wrap better-sqlite3's statement to match our interface
   */
  private wrapBetterSqlite3Statement(stmt: any): Statement {
    return {
      run: (params?: Record<string, any>) => {
        const result = stmt.run(params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (params?: Record<string, any>) => {
        return stmt.get(params);
      },
      all: (params?: Record<string, any>) => {
        return stmt.all(params);
      },
      finalize: () => {
        // better-sqlite3 doesn't require explicit finalization
      },
    };
  }

  /**
   * Normalize parameter names for Bun (param -> $param)
   */
  private normalizeBunParams(
    params?: Record<string, any>
  ): Record<string, any> | undefined {
    if (!params) return undefined;

    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      const normalizedKey = key.startsWith("$") ? key : `$${key}`;
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  /**
   * Close the database
   */
  close(): void {
    if (this.isBunRuntime) {
      this.db.close();
    } else {
      this.db.close();
    }
  }

  /**
   * Check if running in Bun
   */
  static get isBun(): boolean {
    return isBun;
  }
}
