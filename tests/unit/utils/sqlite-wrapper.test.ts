import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "../../../src/utils/sqlite-wrapper.ts";
import { createTestDatabase, createTestDatabaseFile } from "../../helpers/test-database.ts";

describe("SQLite Database Wrapper", () => {
  describe("In-memory databases", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
    });

    afterEach(() => {
      db.close();
    });

    test("creates in-memory database successfully", () => {
      expect(db).toBeDefined();
      expect(typeof db.exec).toBe("function");
    });

    test("executes SQL statements with exec()", () => {
      expect(() => {
        db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      }).not.toThrow();

      // Verify table was created
      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
      );
      const result = stmt.get();
      expect(result).toBeDefined();
    });

    test("lists tables after creation", () => {
      db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");

      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const tables = stmt.all();

      expect(tables.length).toBeGreaterThanOrEqual(2);
      expect(tables.map((t: any) => t.name)).toContain("users");
      expect(tables.map((t: any) => t.name)).toContain("posts");
    });
  });

  describe("File-based databases", () => {
    let db: Database;
    let cleanup: () => void;

    beforeEach(() => {
      const result = createTestDatabaseFile();
      db = result.db;
      cleanup = result.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    test("creates file-based database successfully", () => {
      expect(db).toBeDefined();
    });

    test("persists data across operations", () => {
      db.exec("CREATE TABLE data (id INTEGER PRIMARY KEY, value TEXT)");

      const insert = db.prepare("INSERT INTO data (value) VALUES (@val)");
      insert.run({ val: "test-data" });

      const select = db.prepare("SELECT value FROM data WHERE id = 1");
      const result = select.get();

      expect(result.value).toBe("test-data");
    });
  });

  describe("SQL execution", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
    });

    afterEach(() => {
      db.close();
    });

    test("creates tables with exec()", () => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);

      const stmt = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
      );
      const table = stmt.get();
      expect(table).toBeDefined();
      expect(table.sql).toContain("name TEXT NOT NULL");
      expect(table.sql).toContain("email TEXT UNIQUE");
    });

    test("executes multiple statements with exec()", () => {
      db.exec(`
        CREATE TABLE table1 (id INTEGER PRIMARY KEY);
        CREATE TABLE table2 (id INTEGER PRIMARY KEY);
        CREATE TABLE table3 (id INTEGER PRIMARY KEY);
      `);

      const stmt = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'");
      const result = stmt.get();
      expect(result.count).toBeGreaterThanOrEqual(3);
    });

    test("creates indexes with exec()", () => {
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
      db.exec("CREATE INDEX idx_items_name ON items(name)");

      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_items_name'"
      );
      const index = stmt.get();
      expect(index).toBeDefined();
    });
  });

  describe("Prepared statements", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER)");
    });

    afterEach(() => {
      db.close();
    });

    test("prepares SQL statements", () => {
      const stmt = db.prepare("SELECT * FROM test");
      expect(stmt).toBeDefined();
      expect(typeof stmt.run).toBe("function");
      expect(typeof stmt.get).toBe("function");
      expect(typeof stmt.all).toBe("function");
    });

    test("inserts data with run()", () => {
      const stmt = db.prepare("INSERT INTO test (name, value) VALUES (@name, @value)");
      expect(() => {
        stmt.run({ name: "test", value: 42 });
      }).not.toThrow();

      // Verify the insert worked by querying it back
      const select = db.prepare("SELECT name, value FROM test WHERE name = @name");
      const row = select.get({ name: "test" });
      expect(row).toBeDefined();
      expect(row.value).toBe(42);
    });

    test("retrieves single row with get()", () => {
      const insert = db.prepare("INSERT INTO test (name, value) VALUES (@name, @value)");
      insert.run({ name: "alice", value: 10 });

      const select = db.prepare("SELECT * FROM test WHERE name = @name");
      const row = select.get({ name: "alice" });

      expect(row).toBeDefined();
      expect(row.name).toBe("alice");
      expect(row.value).toBe(10);
    });

    test("retrieves all rows with all()", () => {
      const insert = db.prepare("INSERT INTO test (name, value) VALUES (@name, @value)");
      insert.run({ name: "alice", value: 10 });
      insert.run({ name: "bob", value: 20 });
      insert.run({ name: "charlie", value: 30 });

      const select = db.prepare("SELECT * FROM test ORDER BY id");
      const rows = select.all();

      expect(rows.length).toBe(3);
      expect(rows[0].name).toBe("alice");
      expect(rows[1].name).toBe("bob");
      expect(rows[2].name).toBe("charlie");
    });

    test("filters results with WHERE clause", () => {
      const insert = db.prepare("INSERT INTO test (name, value) VALUES (@name, @value)");
      insert.run({ name: "alice", value: 10 });
      insert.run({ name: "bob", value: 20 });
      insert.run({ name: "alice", value: 15 });

      const select = db.prepare("SELECT * FROM test WHERE name = @name ORDER BY value");
      const rows = select.all({ name: "alice" });

      expect(rows.length).toBe(2);
      expect(rows[0].value).toBe(10);
      expect(rows[1].value).toBe(15);
    });
  });

  describe("Named parameter handling", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, key TEXT, val TEXT)");
    });

    afterEach(() => {
      db.close();
    });

    test("handles @param syntax for named parameters", () => {
      const stmt = db.prepare("INSERT INTO items (key, val) VALUES (@key, @val)");
      expect(() => {
        stmt.run({ key: "test-key", val: "test-value" });
      }).not.toThrow();
    });

    test("retrieves data using @param syntax", () => {
      const insert = db.prepare("INSERT INTO items (key, val) VALUES (@key, @val)");
      insert.run({ key: "mykey", val: "myvalue" });

      const select = db.prepare("SELECT val FROM items WHERE key = @key");
      const row = select.get({ key: "mykey" });

      expect(row.val).toBe("myvalue");
    });

    test("updates data using @param syntax", () => {
      const insert = db.prepare("INSERT INTO items (key, val) VALUES (@key, @val)");
      insert.run({ key: "test", val: "old" });

      const update = db.prepare("UPDATE items SET val = @newVal WHERE key = @key");
      update.run({ key: "test", newVal: "new" });

      const select = db.prepare("SELECT val FROM items WHERE key = @key");
      const row = select.get({ key: "test" });

      expect(row.val).toBe("new");
    });

    test("deletes data using @param syntax", () => {
      const insert = db.prepare("INSERT INTO items (key, val) VALUES (@key, @val)");
      insert.run({ key: "toDelete", val: "value" });

      const del = db.prepare("DELETE FROM items WHERE key = @key");
      del.run({ key: "toDelete" });

      const select = db.prepare("SELECT COUNT(*) as count FROM items");
      const result = select.get();

      expect(result.count).toBe(0);
    });

    test("handles multiple parameters in single statement", () => {
      const stmt = db.prepare(
        "INSERT INTO items (key, val) VALUES (@key1, @val1), (@key2, @val2)"
      );
      expect(() => {
        stmt.run({ key1: "k1", val1: "v1", key2: "k2", val2: "v2" });
      }).not.toThrow();

      const select = db.prepare("SELECT COUNT(*) as count FROM items");
      const result = select.get();

      expect(result.count).toBe(2);
    });
  });

  describe("Pragmas", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
    });

    afterEach(() => {
      db.close();
    });

    test("can call pragma without throwing", () => {
      expect(() => {
        db.pragma("journal_mode", "WAL");
      }).not.toThrow();
    });

    test("can retrieve pragma values", () => {
      expect(() => {
        const mode = db.pragma("journal_mode");
        expect(mode).toBeDefined();
      }).not.toThrow();
    });

    test("gets database info with pragmas", () => {
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      // Some pragma operations may not return values
      expect(() => {
        db.pragma("table_info", "test");
      }).not.toThrow();
    });
  });

  describe("Data types", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
      db.exec(`
        CREATE TABLE types (
          id INTEGER PRIMARY KEY,
          intVal INTEGER,
          textVal TEXT,
          realVal REAL,
          blobVal BLOB,
          jsonVal TEXT
        )
      `);
    });

    afterEach(() => {
      db.close();
    });

    test("stores and retrieves INTEGER", () => {
      const insert = db.prepare("INSERT INTO types (intVal) VALUES (@val)");
      insert.run({ val: 42 });

      const select = db.prepare("SELECT intVal FROM types");
      const row = select.get();

      expect(row.intVal).toBe(42);
      expect(typeof row.intVal).toBe("number");
    });

    test("stores and retrieves TEXT", () => {
      const insert = db.prepare("INSERT INTO types (textVal) VALUES (@val)");
      insert.run({ val: "hello world" });

      const select = db.prepare("SELECT textVal FROM types");
      const row = select.get();

      expect(row.textVal).toBe("hello world");
    });

    test("stores and retrieves REAL", () => {
      const insert = db.prepare("INSERT INTO types (realVal) VALUES (@val)");
      insert.run({ val: 3.14159 });

      const select = db.prepare("SELECT realVal FROM types");
      const row = select.get();

      expect(Math.abs(row.realVal - 3.14159)).toBeLessThan(0.00001);
    });

    test("stores and retrieves JSON strings", () => {
      const jsonData = JSON.stringify({ key: "value", number: 42 });
      const insert = db.prepare("INSERT INTO types (jsonVal) VALUES (@val)");
      insert.run({ val: jsonData });

      const select = db.prepare("SELECT jsonVal FROM types");
      const row = select.get();

      const parsed = JSON.parse(row.jsonVal);
      expect(parsed.key).toBe("value");
      expect(parsed.number).toBe(42);
    });
  });

  describe("Transactions and error handling", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT UNIQUE)");
    });

    afterEach(() => {
      db.close();
    });

    test("handles constraint violations", () => {
      const insert = db.prepare("INSERT INTO test (value) VALUES (@val)");
      insert.run({ val: "unique-value" });

      // Second insert with same value should fail or throw
      expect(() => {
        insert.run({ val: "unique-value" });
      }).toThrow();
    });

    test("handles NULL values correctly", () => {
      const insert = db.prepare("INSERT INTO test (value) VALUES (@val)");
      insert.run({ val: null });

      const select = db.prepare("SELECT value FROM test WHERE id = 1");
      const row = select.get();

      expect(row.value).toBeNull();
    });

    test("closes database properly", () => {
      const testDb = createTestDatabase();
      expect(() => {
        testDb.close();
      }).not.toThrow();
    });
  });

  describe("Complex queries", () => {
    let db: Database;

    beforeEach(() => {
      db = createTestDatabase();
      db.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, title TEXT);
      `);

      // Insert test data
      const insertUser = db.prepare("INSERT INTO users (name) VALUES (@name)");
      insertUser.run({ name: "Alice" });
      insertUser.run({ name: "Bob" });

      const insertPost = db.prepare("INSERT INTO posts (userId, title) VALUES (@userId, @title)");
      insertPost.run({ userId: 1, title: "First Post" });
      insertPost.run({ userId: 1, title: "Second Post" });
      insertPost.run({ userId: 2, title: "Bob's Post" });
    });

    afterEach(() => {
      db.close();
    });

    test("executes JOIN query", () => {
      const query = db.prepare(`
        SELECT u.name, p.title
        FROM users u
        JOIN posts p ON u.id = p.userId
        WHERE u.id = @userId
        ORDER BY p.title
      `);

      const rows = query.all({ userId: 1 });
      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe("Alice");
      expect(rows[0].title).toContain("Post");
    });

    test("executes GROUP BY query", () => {
      const query = db.prepare(`
        SELECT userId, COUNT(*) as postCount
        FROM posts
        GROUP BY userId
        ORDER BY userId
      `);

      const rows = query.all();
      expect(rows.length).toBe(2);
      expect(rows[0].postCount).toBe(2);
      expect(rows[1].postCount).toBe(1);
    });

    test("executes aggregate functions", () => {
      const query = db.prepare("SELECT COUNT(*) as total FROM posts");
      const result = query.get();
      expect(result.total).toBe(3);
    });
  });
});
