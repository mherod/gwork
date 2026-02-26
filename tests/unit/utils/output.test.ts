import { describe, test, expect, spyOn, afterEach } from "bun:test";
import chalk from "chalk";
import { logger } from "../../../src/utils/logger.ts";
import { SEPARATOR } from "../../../src/utils/format.ts";
import { printSectionHeader } from "../../../src/utils/output.ts";

// ─── SEPARATOR ────────────────────────────────────────────────────────────────

describe("SEPARATOR", () => {
  test("is exactly 80 characters long", () => {
    expect(SEPARATOR).toHaveLength(80);
  });

  test("consists entirely of the ─ (box-drawing) character", () => {
    expect(SEPARATOR).toMatch(/^─+$/);
  });

  test("matches the original inline expression", () => {
    expect(SEPARATOR).toBe("─".repeat(80));
  });
});

// ─── printSectionHeader ───────────────────────────────────────────────────────

describe("printSectionHeader", () => {
  let loggerInfoSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    loggerInfoSpy.mockRestore();
  });

  test("calls logger.info exactly twice", () => {
    loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => {});

    printSectionHeader("\nTest Section:");

    expect(loggerInfoSpy).toHaveBeenCalledTimes(2);
  });

  test("first call is chalk.bold of the title", () => {
    loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => {});

    printSectionHeader("\nMessages:");

    const firstArg = (loggerInfoSpy.mock.calls[0] as [string])[0];
    expect(firstArg).toBe(chalk.bold("\nMessages:"));
  });

  test("second call is the SEPARATOR constant", () => {
    loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => {});

    printSectionHeader("\nMessages:");

    const secondArg = (loggerInfoSpy.mock.calls[1] as [string])[0];
    expect(secondArg).toBe(SEPARATOR);
  });

  test("second call is an 80-character separator string", () => {
    loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => {});

    printSectionHeader("\nMessages:");

    const secondArg = (loggerInfoSpy.mock.calls[1] as [string])[0];
    expect(secondArg).toHaveLength(80);
  });

  test("works with template literal titles (e.g. search results)", () => {
    loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => {});
    const query = "standup meeting";

    printSectionHeader(`\nSearch results for: "${query}"`);

    const firstArg = (loggerInfoSpy.mock.calls[0] as [string])[0];
    expect(firstArg).toBe(chalk.bold(`\nSearch results for: "${query}"`));
    expect(loggerInfoSpy).toHaveBeenCalledTimes(2);
  });

  test("call order: bold title before separator", () => {
    const calls: string[] = [];
    loggerInfoSpy = spyOn(logger, "info").mockImplementation((arg: unknown) => {
      calls.push(String(arg));
    });

    printSectionHeader("\nCalendars:");

    // First call must be the bold title, second must be the separator
    expect(calls[0]).toBe(chalk.bold("\nCalendars:"));
    expect(calls[1]).toBe(SEPARATOR);
  });
});
