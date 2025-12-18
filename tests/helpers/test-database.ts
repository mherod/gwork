import { Database } from "../../src/utils/sqlite-wrapper.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

/**
 * Creates an in-memory SQLite database for testing.
 * Uses `:memory:` which is fast and automatically cleaned up.
 *
 * @returns A test database instance
 *
 * @example
 * ```typescript
 * const db = createTestDatabase();
 * db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
 * // Use db for testing
 * db.close();
 * ```
 */
export function createTestDatabase(): Database {
  return new Database(":memory:");
}

/**
 * Creates a temporary file-based SQLite database for testing.
 * Useful when you need persistent storage during a test.
 * The cleanup function should be called in afterEach hook.
 *
 * @returns Object with database instance and cleanup function
 *
 * @example
 * ```typescript
 * let cleanup: () => void;
 *
 * beforeEach(() => {
 *   const { db, cleanup: c } = createTestDatabaseFile();
 *   testDb = db;
 *   cleanup = c;
 * });
 *
 * afterEach(() => {
 *   cleanup();
 * });
 * ```
 */
export function createTestDatabaseFile(): {
  db: Database;
  cleanup: () => void;
} {
  const testDbPath = join(tmpdir(), `test-${Date.now()}-${Math.random()}.db`);
  const db = new Database(testDbPath, { create: true });

  return {
    db,
    cleanup: () => {
      try {
        db.close();

        // Remove main database file
        if (existsSync(testDbPath)) {
          unlinkSync(testDbPath);
        }

        // Remove SQLite WAL files if they exist
        [".db-shm", ".db-wal"].forEach((suffix) => {
          const walFile = testDbPath + suffix;
          if (existsSync(walFile)) {
            unlinkSync(walFile);
          }
        });
      } catch (error) {
        console.error("Error cleaning up test database:", error);
      }
    },
  };
}
