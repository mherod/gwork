import { describe, test, expect } from "bun:test";
import { formatEventDate, parseDateRange } from "../../../src/utils/format.ts";
import {
  startOfDay,
  endOfDay,
  addDays,
  startOfWeek,
  endOfWeek,
} from "date-fns";

describe("formatEventDate", () => {
  test("returns 'N/A' for empty string", () => {
    const result = formatEventDate("");
    expect(result).toBe("N/A");
  });

  test("returns 'N/A' for null/undefined", () => {
    expect(formatEventDate(null as any)).toBe("N/A");
    expect(formatEventDate(undefined as any)).toBe("N/A");
  });

  test("returns original string for invalid date", () => {
    const result = formatEventDate("not-a-date");
    expect(result).toBe("not-a-date");
  });

  describe("All-day events", () => {
    test("formats today's all-day event as 'Today'", () => {
      const today = new Date().toISOString().split("T")[0];
      const result = formatEventDate(today, true);
      expect(result).toBe("Today");
    });

    test("formats tomorrow's all-day event as 'Tomorrow'", () => {
      const tomorrow = new Date(Date.now() + 86400000)
        .toISOString()
        .split("T")[0];
      const result = formatEventDate(tomorrow, true);
      expect(result).toBe("Tomorrow");
    });

    test("formats yesterday's all-day event as 'Yesterday'", () => {
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .split("T")[0];
      const result = formatEventDate(yesterday, true);
      expect(result).toBe("Yesterday");
    });

    test("formats future all-day event with month and day", () => {
      const futureDate = new Date(Date.now() + 86400000 * 10);
      const isoString = futureDate.toISOString().split("T")[0];
      const result = formatEventDate(isoString, true);

      // Should match format like "Jan 28, 2025"
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    });

    test("formats past all-day event with month and day", () => {
      const pastDate = new Date(Date.now() - 86400000 * 10);
      const isoString = pastDate.toISOString().split("T")[0];
      const result = formatEventDate(isoString, true);

      // Should match format like "Dec 08, 2025"
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    });
  });

  describe("Timed events", () => {
    test("formats today's timed event with time and '(today)' suffix", () => {
      const today = new Date();
      const todayStr = today.toISOString();
      const result = formatEventDate(todayStr, false);

      // Should contain "(today)" and a time
      expect(result).toContain("(today)");
      expect(result).toMatch(/\d{1,2}:\d{2}/); // Has time like "10:30"
    });

    test("formats tomorrow's timed event with time and '(tomorrow)' suffix", () => {
      const tomorrow = new Date(Date.now() + 86400000);
      const tomorrowStr = tomorrow.toISOString();
      const result = formatEventDate(tomorrowStr, false);

      expect(result).toContain("(tomorrow)");
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    test("formats event this week with day abbreviation and time", () => {
      // Get a date 2 days from now (still this week)
      const futureInWeek = new Date(Date.now() + 86400000 * 2);
      const futureStr = futureInWeek.toISOString();
      const result = formatEventDate(futureStr, false);

      // Should have day abbreviation (Mon, Tue, Wed, etc.) and time
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2}/); // "Wed 2:30 PM"
      expect(result).not.toContain("today");
      expect(result).not.toContain("tomorrow");
    });

    test("formats event outside this week with full date and time", () => {
      // Get a date 30 days in the future
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const futureStr = futureDate.toISOString();
      const result = formatEventDate(futureStr, false);

      // Should have full date format like "Jan 17, 2025 2:30 PM"
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2}/);
    });
  });

  describe("Edge cases", () => {
    test("handles ISO 8601 strings correctly", () => {
      const isoString = "2025-12-25T10:30:00Z";
      const result = formatEventDate(isoString, false);
      expect(result).toBeDefined();
      expect(result).not.toBe("");
    });

    test("handles dates with timezone offset", () => {
      const withOffset = "2025-12-25T10:30:00+05:00";
      const result = formatEventDate(withOffset, false);
      expect(result).toBeDefined();
      expect(result).not.toBe("");
    });

    test("handles partial ISO strings", () => {
      const partialISO = "2025-12-25";
      const result = formatEventDate(partialISO, true);
      expect(result).toBeDefined();
      // Should format it even if just date
      expect(result).toMatch(/^[A-Z][a-z]{2}|Today|Tomorrow|Yesterday/);
    });
  });
});

describe("parseDateRange", () => {
  describe("today range", () => {
    test("parses 'today' range correctly", () => {
      const result = parseDateRange("today");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toBeDefined();
      expect(result?.timeMax).toBeDefined();
      expect(result?.timeMin).toEqual(startOfDay(new Date()));
      expect(result?.timeMax).toEqual(endOfDay(new Date()));
    });

    test("is case-insensitive for 'today'", () => {
      const result1 = parseDateRange("TODAY");
      const result2 = parseDateRange("Today");
      const result3 = parseDateRange("tOdAy");

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });
  });

  describe("tomorrow range", () => {
    test("parses 'tomorrow' range correctly", () => {
      const result = parseDateRange("tomorrow");
      expect(result).not.toBeNull();

      const tomorrow = addDays(startOfDay(new Date()), 1);
      expect(result?.timeMin).toEqual(tomorrow);
      expect(result?.timeMax).toEqual(endOfDay(tomorrow));
    });

    test("is case-insensitive for 'tomorrow'", () => {
      const result = parseDateRange("TOMORROW");
      expect(result).not.toBeNull();
    });
  });

  describe("weekly ranges", () => {
    test("parses 'this-week' range", () => {
      const result = parseDateRange("this-week");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toEqual(startOfWeek(startOfDay(new Date())));
      expect(result?.timeMax).toEqual(endOfWeek(new Date()));
    });

    test("parses 'next-week' range", () => {
      const result = parseDateRange("next-week");
      expect(result).not.toBeNull();

      const nextWeek = addDays(startOfDay(new Date()), 7);
      expect(result?.timeMin).toEqual(startOfWeek(nextWeek));
      expect(result?.timeMax).toEqual(endOfWeek(nextWeek));
    });

    test("is case-insensitive for weekly ranges", () => {
      const result1 = parseDateRange("THIS-WEEK");
      const result2 = parseDateRange("This-Week");
      const result3 = parseDateRange("this-week");

      expect(result1?.timeMin).toEqual(result2?.timeMin);
      expect(result2?.timeMin).toEqual(result3?.timeMin);
    });
  });

  describe("monthly ranges", () => {
    test("parses 'this-month' range", () => {
      const result = parseDateRange("this-month");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toBeDefined();
      expect(result?.timeMax).toBeDefined();
    });

    test("parses 'next-month' range", () => {
      const result = parseDateRange("next-month");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toBeDefined();
      expect(result?.timeMax).toBeDefined();
    });
  });

  describe("yearly ranges", () => {
    test("parses 'this-year' range", () => {
      const result = parseDateRange("this-year");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toBeDefined();
      expect(result?.timeMax).toBeDefined();
    });

    test("parses 'next-year' range", () => {
      const result = parseDateRange("next-year");
      expect(result).not.toBeNull();
      expect(result?.timeMin).toBeDefined();
      expect(result?.timeMax).toBeDefined();
    });
  });

  describe("invalid ranges", () => {
    test("returns null for unknown range", () => {
      const result = parseDateRange("unknown");
      expect(result).toBeNull();
    });

    test("returns null for empty string", () => {
      const result = parseDateRange("");
      expect(result).toBeNull();
    });

    test("returns null for random text", () => {
      expect(parseDateRange("random-text")).toBeNull();
      expect(parseDateRange("gibberish")).toBeNull();
      expect(parseDateRange("next-decade")).toBeNull();
    });
  });

  describe("range completeness", () => {
    test("all parsed ranges have both timeMin and timeMax", () => {
      const ranges = [
        "today",
        "tomorrow",
        "this-week",
        "next-week",
        "this-month",
        "next-month",
        "this-year",
        "next-year",
      ];

      ranges.forEach((range) => {
        const result = parseDateRange(range);
        expect(result).not.toBeNull();
        expect(result?.timeMin).toBeDefined();
        expect(result?.timeMax).toBeDefined();
        expect(result?.timeMin instanceof Date).toBe(true);
        expect(result?.timeMax instanceof Date).toBe(true);
      });
    });

    test("timeMax is always after timeMin", () => {
      const ranges = [
        "today",
        "tomorrow",
        "this-week",
        "next-week",
        "this-month",
        "next-month",
        "this-year",
        "next-year",
      ];

      ranges.forEach((range) => {
        const result = parseDateRange(range);
        if (!result) {
          throw new Error("Expected date range result");
        }
        expect(result.timeMax > result.timeMin).toBe(true);
      });
    });
  });
});
