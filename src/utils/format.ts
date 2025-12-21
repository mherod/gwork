import {
  format,
  parseISO,
  isValid,
  isToday,
  isTomorrow,
  isYesterday,
  isThisWeek,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

export function formatEventDate(dateString: string, isAllDay = false): string {
  if (!dateString) return "N/A";
  try {
    const date = parseISO(dateString);
    if (!isValid(date)) return dateString;

    if (isAllDay) {
      if (isToday(date)) return "Today";
      if (isTomorrow(date)) return "Tomorrow";
      if (isYesterday(date)) return "Yesterday";
      return format(date, "MMM d, yyyy");
    }

    if (isToday(date)) {
      return format(date, "h:mm a") + " (today)";
    }
    if (isTomorrow(date)) {
      return format(date, "h:mm a") + " (tomorrow)";
    }
    if (isThisWeek(date)) {
      return format(date, "EEE h:mm a");
    }
    return format(date, "MMM d, yyyy h:mm a");
  } catch {
    return dateString;
  }
}

export function parseDateRange(range: string) {
  const today = startOfDay(new Date());

  switch (range.toLowerCase()) {
    case "today":
      return { timeMin: today, timeMax: endOfDay(today) };
    case "tomorrow":
      const tomorrow = addDays(today, 1);
      return { timeMin: tomorrow, timeMax: endOfDay(tomorrow) };
    case "this-week":
      return { timeMin: startOfWeek(today), timeMax: endOfWeek(today) };
    case "next-week":
      const nextWeek = addWeeks(today, 1);
      return { timeMin: startOfWeek(nextWeek), timeMax: endOfWeek(nextWeek) };
    case "this-month":
      return { timeMin: startOfMonth(today), timeMax: endOfMonth(today) };
    case "next-month":
      const nextMonth = addMonths(today, 1);
      return {
        timeMin: startOfMonth(nextMonth),
        timeMax: endOfMonth(nextMonth),
      };
    case "this-year":
      return { timeMin: startOfYear(today), timeMax: endOfYear(today) };
    case "next-year":
      const nextYear = addYears(today, 1);
      return { timeMin: startOfYear(nextYear), timeMax: endOfYear(nextYear) };
    default:
      return null;
  }
}
