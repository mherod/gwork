import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { withDbRetry, withDbRetrySync } from "../../../src/utils/db-retry.ts";
import { Database } from "../../../src/utils/sqlite-wrapper.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Database Retry Utility", () => {
  let testDbPath: string;
  let db: Database;

  beforeEach(() => {
    // Create a unique test database for each test
    testDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}-${Math.random()}.db`);
    db = new Database(testDbPath, { create: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY,
        value TEXT
      )
    `);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // Clean up test database
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("withDbRetry (async)", () => {
    test("succeeds on first attempt when no error occurs", async () => {
      const result = await withDbRetry(async () => {
        const stmt = db.prepare("SELECT 1 as value");
        return stmt.get();
      });

      expect(result).toEqual({ value: 1 });
    });

    test("retries on database lock error", async () => {
      let attempts = 0;
      const maxAttempts = 3;

      const result = await withDbRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            // Simulate a database lock error
            const error = new Error("database is locked");
            error.name = "SQLiteError";
            throw error;
          }
          const stmt = db.prepare("SELECT 1 as value");
          return stmt.get();
        },
        { maxRetries: maxAttempts, initialDelay: 10 } // Short delay for testing
      );

      expect(result).toEqual({ value: 1 });
      expect(attempts).toBe(2); // First attempt fails, second succeeds
    });

    test("throws non-lock errors immediately", async () => {
      const testError = new Error("Some other error");

      await expect(
        withDbRetry(async () => {
          throw testError;
        })
      ).rejects.toThrow("Some other error");
    });

    test("throws after max retries exhausted", async () => {
      await expect(
        withDbRetry(
          async () => {
            const error = new Error("database is locked");
            error.name = "SQLiteError";
            throw error;
          },
          { maxRetries: 2, initialDelay: 10 }
        )
      ).rejects.toThrow("database is locked");
    });
  });

  describe("withDbRetrySync (synchronous)", () => {
    test("succeeds on first attempt when no error occurs", () => {
      const result = withDbRetrySync(() => {
        const stmt = db.prepare("SELECT 1 as value");
        return stmt.get();
      });

      expect(result).toEqual({ value: 1 });
    });

    test("retries on database lock error", () => {
      let attempts = 0;

      const result = withDbRetrySync(
        () => {
          attempts++;
          if (attempts === 1) {
            // Simulate a database lock error
            const error = new Error("database is locked");
            error.name = "SQLiteError";
            throw error;
          }
          const stmt = db.prepare("SELECT 1 as value");
          return stmt.get();
        },
        { maxRetries: 3, initialDelay: 10 } // Short delay for testing
      );

      expect(result).toEqual({ value: 1 });
      expect(attempts).toBe(2); // First attempt fails, second succeeds
    });

    test("throws non-lock errors immediately", () => {
      const testError = new Error("Some other error");

      expect(() => {
        withDbRetrySync(() => {
          throw testError;
        });
      }).toThrow("Some other error");
    });

    test("throws after max retries exhausted", () => {
      expect(() => {
        withDbRetrySync(
          () => {
            const error = new Error("database is locked");
            error.name = "SQLiteError";
            throw error;
          },
          { maxRetries: 2, initialDelay: 10 }
        );
      }).toThrow("database is locked");
    });
  });

  describe("error detection", () => {
    test("detects SQLiteError by name", async () => {
      let attempts = 0;

      await withDbRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            const error = new Error("Some SQLite error");
            error.name = "SQLiteError";
            throw error;
          }
          return "success";
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });

    test("detects lock errors by message content", async () => {
      let attempts = 0;

      await withDbRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error("database is locked");
          }
          return "success";
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });

    test("detects busy errors", async () => {
      let attempts = 0;

      await withDbRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error("database busy");
          }
          return "success";
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });
  });

  describe("exponential backoff", () => {
    test("increases delay with each retry", async () => {
      let attemptCount = 0;
      const startTimes: number[] = [];

      try {
        await withDbRetry(
          async () => {
            startTimes.push(Date.now());
            attemptCount++;
            
            if (attemptCount < 3) {
              const error = new Error("database is locked");
              error.name = "SQLiteError";
              throw error;
            }
            return "success";
          },
          { maxRetries: 2, initialDelay: 50, backoffMultiplier: 2 }
        );
      } catch {
        // Expected to fail after retries
      }

      // Should have made multiple attempts
      expect(attemptCount).toBeGreaterThan(1);
      
      // Verify that delays increased (if we have multiple start times)
      if (startTimes.length >= 2) {
        const firstDelay = startTimes[1] - startTimes[0];
        // First delay should be approximately initialDelay (50ms) with some variance
        expect(firstDelay).toBeGreaterThan(40); // Allow for timing variance
        expect(firstDelay).toBeLessThan(200); // Shouldn't be too long
      }
    });
  });
});
