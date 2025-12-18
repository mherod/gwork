import { describe, test, expect } from "bun:test";
import { parseAccount } from "../../../src/utils/args.ts";

describe("parseAccount", () => {
  test("extracts account flag from beginning of args", () => {
    const result = parseAccount(["--account", "work@example.com", "list"]);
    expect(result.account).toBe("work@example.com");
    expect(result.args).toEqual(["list"]);
  });

  test("extracts account flag from middle of args", () => {
    const result = parseAccount([
      "list",
      "--account",
      "personal@example.com",
      "--today",
    ]);
    expect(result.account).toBe("personal@example.com");
    expect(result.args).toEqual(["list", "--today"]);
  });

  test("extracts account flag from end of args", () => {
    const result = parseAccount(["list", "--today", "--account", "test@domain"]);
    expect(result.account).toBe("test@domain");
    expect(result.args).toEqual(["list", "--today"]);
  });

  test("defaults to 'default' when no account specified", () => {
    const result = parseAccount(["list", "--today"]);
    expect(result.account).toBe("default");
    expect(result.args).toEqual(["list", "--today"]);
  });

  test("defaults to 'default' for empty args", () => {
    const result = parseAccount([]);
    expect(result.account).toBe("default");
    expect(result.args).toEqual([]);
  });

  test("preserves all other flags when extracting account", () => {
    const result = parseAccount([
      "--verbose",
      "list",
      "--max-results",
      "50",
      "--account",
      "work@example.com",
      "--format",
      "json",
    ]);
    expect(result.account).toBe("work@example.com");
    expect(result.args).toEqual([
      "--verbose",
      "list",
      "--max-results",
      "50",
      "--format",
      "json",
    ]);
  });

  describe("different account formats", () => {
    test("handles email addresses", () => {
      const result = parseAccount(["--account", "user@gmail.com", "list"]);
      expect(result.account).toBe("user@gmail.com");
    });

    test("handles workspace domains", () => {
      const result = parseAccount([
        "--account",
        "user@company.workspace.com",
        "list",
      ]);
      expect(result.account).toBe("user@company.workspace.com");
    });

    test("handles simple account names", () => {
      const result = parseAccount(["--account", "work", "list"]);
      expect(result.account).toBe("work");
    });

    test("handles account names with hyphens", () => {
      const result = parseAccount(["--account", "my-work-account", "list"]);
      expect(result.account).toBe("my-work-account");
    });

    test("handles account names with dots", () => {
      const result = parseAccount(["--account", "personal.email", "list"]);
      expect(result.account).toBe("personal.email");
    });
  });

  describe("edge cases", () => {
    test("ignores --account without value (no extraction)", () => {
      const result = parseAccount(["list", "--account"]);
      expect(result.account).toBe("default");
      expect(result.args).toEqual(["list", "--account"]);
    });

    test("handles multiple --account flags (uses last)", () => {
      const result = parseAccount([
        "--account",
        "first@example.com",
        "list",
        "--account",
        "second@example.com",
      ]);
      expect(result.account).toBe("second@example.com");
      // Last --account flag and value are consumed
      expect(result.args).toEqual(["list"]);
    });

    test("distinguishes --account from similar flags", () => {
      const result = parseAccount([
        "list",
        "--account-name",
        "something",
        "--account",
        "test@example.com",
      ]);
      expect(result.account).toBe("test@example.com");
      expect(result.args).toEqual(["list", "--account-name", "something"]);
    });

    test("preserves command position", () => {
      const result = parseAccount([
        "--account",
        "work@example.com",
        "contacts",
        "list",
      ]);
      expect(result.account).toBe("work@example.com");
      expect(result.args).toEqual(["contacts", "list"]);
    });
  });

  describe("return object structure", () => {
    test("always returns object with 'account' and 'args' properties", () => {
      const result = parseAccount(["test"]);
      expect(typeof result).toBe("object");
      expect("account" in result).toBe(true);
      expect("args" in result).toBe(true);
      expect(typeof result.account).toBe("string");
      expect(Array.isArray(result.args)).toBe(true);
    });

    test("args array contains all arguments except --account flag and value", () => {
      const input = [
        "arg1",
        "arg2",
        "--account",
        "work@example.com",
        "arg3",
        "arg4",
      ];
      const result = parseAccount(input);
      expect(result.args.length).toBe(4); // 6 inputs - 2 for --account flag and value
      expect(result.args).toEqual(["arg1", "arg2", "arg3", "arg4"]);
    });

    test("does not modify the original input array", () => {
      const input = ["list", "--account", "test@example.com"];
      const inputCopy = [...input];
      parseAccount(input);
      expect(input).toEqual(inputCopy);
    });
  });

  describe("real-world scenarios", () => {
    test("parses typical calendar command", () => {
      const result = parseAccount([
        "list",
        "--today",
        "--max-results",
        "20",
        "--account",
        "personal@gmail.com",
      ]);
      expect(result.account).toBe("personal@gmail.com");
      expect(result.args).toContain("list");
      expect(result.args).toContain("--today");
      expect(result.args).toContain("--max-results");
      expect(result.args).toContain("20");
    });

    test("parses typical contacts command with options", () => {
      const result = parseAccount([
        "duplicates",
        "--threshold",
        "85",
        "--format",
        "json",
        "--account",
        "work@company.com",
        "--max-results",
        "100",
      ]);
      expect(result.account).toBe("work@company.com");
      expect(result.args).toContain("duplicates");
      expect(result.args).toContain("--threshold");
      expect(result.args).toContain("85");
    });

    test("parses command with no options", () => {
      const result = parseAccount([
        "profile",
        "--account",
        "user@example.com",
      ]);
      expect(result.account).toBe("user@example.com");
      expect(result.args).toEqual(["profile"]);
    });
  });
});
