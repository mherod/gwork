import chalk from "chalk";
import ora from "ora";
import { compact, orderBy, startCase, isEmpty, uniqBy, map } from "lodash-es";
import type { Event } from "../types/google-apis.ts";
import type { calendar_v3 } from "googleapis";
import { CalendarService } from "../services/calendar-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { formatEventDate, parseDateRange } from "../utils/format.ts";
import { ensureInitialized } from "../utils/command-service.ts";
import { logger } from "../utils/logger.ts";
import { CommandRegistry } from "./registry.ts";

const calRegistry = new CommandRegistry<CalendarService>()
  .register("list", (svc, args) => listEvents(svc, args))
  .register("calendars", (svc, args) => listCalendars(svc, args))
  .register("get", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal get <calendarId> <eventId>");
    }
    return getEvent(svc, args[0], args[1]);
  })
  .register("create", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal create <calendarId> --title <title> --start <datetime>");
    }
    return createEvent(svc, args[0], args.slice(1));
  })
  .register("update", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal update <calendarId> <eventId>");
    }
    return updateEvent(svc, args[0], args[1], args.slice(2));
  })
  .register("delete", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal delete <calendarId> <eventId> --confirm");
    }
    return deleteEvent(svc, args[0], args[1], args.slice(2));
  })
  .register("search", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: search query is required", "gwork cal search <query> [options]");
    }
    return searchEvents(svc, args[0], args.slice(1));
  })
  .register("freebusy", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: start and end times are required", "gwork cal freebusy <start> <end>");
    }
    return getFreeBusy(svc, args[0], args[1], args.slice(2));
  })
  .register("create-calendar", (svc, args) => {
    if (args.length === 0) {
      throw new ArgumentError("Error: title is required", "gwork cal create-calendar <title>");
    }
    return createCalendar(svc, compact(args).join(" "));
  })
  .register("stats", (svc, args) => getStats(svc, args))
  .register("duplicate", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal duplicate <calendarId> <eventId> [options]");
    }
    return duplicateEvent(svc, args[0], args[1], args.slice(2));
  })
  .register("bulk-update", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal bulk-update <calendarId> [options]");
    }
    return bulkUpdateEvents(svc, args[0], args.slice(1));
  })
  .register("update-recurring", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal update-recurring <calendarId> <eventId> [options]");
    }
    return updateRecurringEvent(svc, args[0], args[1], args.slice(2));
  })
  .register("export", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal export <calendarId> [options]");
    }
    return exportEvents(svc, args[0], args.slice(1));
  })
  .register("batch-create", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal batch-create <calendarId> [options]");
    }
    return batchCreateEvents(svc, args[0], args.slice(1));
  })
  .register("reminders", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal reminders <calendarId> <eventId> <action> [options]");
    }
    return manageReminders(svc, args[0], args[1], args.slice(2));
  })
  .register("check-conflict", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal check-conflict <calendarId> [options]");
    }
    return checkConflict(svc, args[0], args.slice(1));
  })
  .register("quick", (svc, args) => quickAction(svc, args))
  .register("compare", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: two calendarIds are required", "gwork cal compare <calendarId1> <calendarId2> [options]");
    }
    return compareCalendars(svc, args[0], args[1], args.slice(2));
  })
  .register("color", (svc, args) => manageColor(svc, args))
  .register("recurrence", (_svc, args) => workWithRecurrence(args))
  .register("create-recurring", (svc, args) => {
    if (args.length === 0 || !args[0]) {
      throw new ArgumentError("Error: calendarId is required", "gwork cal create-recurring <calendarId> [options]");
    }
    return createRecurringEvent(svc, args[0], args.slice(1));
  })
  .register("recurrence-info", (svc, args) => {
    if (args.length < 2 || !args[0] || !args[1]) {
      throw new ArgumentError("Error: calendarId and eventId are required", "gwork cal recurrence-info <calendarId> <eventId>");
    }
    return showRecurrenceInfo(svc, args[0], args[1]);
  })
  .register("date", (_svc, args) => dateUtilities(args));

type CalServiceFactory = (account: string) => CalendarService;

export async function handleCalCommand(
  subcommand: string,
  args: string[],
  account = "default",
  serviceFactory: CalServiceFactory = (acc) => new CalendarService(acc)
) {
  // Create service instance with the specified account
  const calendarService = serviceFactory(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized(calendarService);

  await calRegistry.execute(subcommand, calendarService, args);
}

async function listEvents(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Fetching events...").start();
  try {
    // Parse options from args
    const options: {
      calendar: string;
      max: number;
      days: number;
      range?: string;
      today?: boolean;
      upcoming?: boolean;
      query?: string;
      location?: string;
      attendee?: string;
      format?: string;
    } = {
      calendar: "primary",
      max: 10,
      days: 7,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "-c" || arg === "--calendar") {
        const value = args[++i];
        if (value) options.calendar = value;
      } else if (arg === "-n" || arg === "--max") {
        const value = args[++i];
        if (value) options.max = parseInt(value, 10);
      } else if (arg === "--days") {
        const value = args[++i];
        if (value) options.days = parseInt(value, 10);
      } else if (arg === "--range") {
        const value = args[++i];
        if (value) options.range = value;
      } else if (arg === "--today") {
        options.today = true;
      } else if (arg === "--upcoming") {
        options.upcoming = true;
      } else if (arg === "--query" || arg === "-q") {
        const value = args[++i];
        if (value) options.query = value;
      } else if (arg === "--location") {
        const value = args[++i];
        if (value) options.location = value;
      } else if (arg === "--attendee") {
        const value = args[++i];
        if (value) options.attendee = value;
      } else if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    let events: Event[];
    let timeRange = null;

    if (options.range) {
      timeRange = parseDateRange(options.range);
      if (!timeRange) {
        throw new ArgumentError("Invalid date range", "Valid ranges: today, tomorrow, this-week, next-week, this-month, next-month");
      }
    }

    if (options.today) {
      const todayOptions: Record<string, string | undefined> = {};
      if (options.query) {
        todayOptions["q"] = options.query;
      }
      // getTodayEvents doesn't support query, so we use listEvents directly
      const today = new Date();
      const timeMin = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const timeMax = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1
      );
      const result = await calendarService.listEvents(options.calendar, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 50,
        ...todayOptions,
      });
      events = result.events;
    } else if (options.upcoming) {
      const timeMin = new Date();
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + options.days);
      const upcomingOptions: {
        timeMin: string;
        timeMax: string;
        maxResults: number;
        q?: string;
      } = {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 50,
      };
      if (options.query) {
        upcomingOptions.q = options.query;
      }
      const result = await calendarService.listEvents(options.calendar, upcomingOptions);
      events = result.events;
    } else if (timeRange) {
      const listOptions: {
        maxResults: number;
        timeMin: string;
        timeMax: string;
        q?: string;
      } = {
        maxResults: options.max,
        timeMin: timeRange.timeMin.toISOString(),
        timeMax: timeRange.timeMax.toISOString(),
      };
      
      if (options.query) {
        listOptions.q = options.query;
      }

      const result = await calendarService.listEvents(options.calendar, listOptions);
      events = result.events;
    } else {
      const timeMin = new Date();
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + options.days);

      const listOptions: {
        maxResults: number;
        timeMin: string;
        timeMax: string;
        q?: string;
      } = {
        maxResults: options.max,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      };
      
      if (options.query) {
        listOptions.q = options.query;
      }

      const result = await calendarService.listEvents(options.calendar, listOptions);
      events = result.events;
    }

    // Apply filters
    if (options.location) {
      const locationFilter = options.location.toLowerCase();
      events = events.filter((e) =>
        e.location?.toLowerCase().includes(locationFilter)
      );
    }
    if (options.attendee) {
      const attendeeFilter = options.attendee.toLowerCase();
      events = events.filter((e) =>
        e.attendees?.some((a) =>
          a.email?.toLowerCase().includes(attendeeFilter)
        )
      );
    }

    spinner.succeed(`Found ${events.length} event(s)`);

    if (events.length === 0) {
      logger.info(chalk.yellow("No events found"));
      return;
    }

    if (options.format === "json") {
      logger.info(JSON.stringify(events, null, 2));
    } else {
      logger.info(chalk.bold("\nEvents:"));
      logger.info("─".repeat(80));
      events.forEach((event: Event, index: number) => {
        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        const isAllDay = !!event.start?.date;
        const summary = event.summary || "No title";
        const location = event.location || "";
        const attendees = event.attendees?.length || 0;

        logger.info(
          `\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(summary)}`
        );
        if (start) {
          logger.info(
            `   ${chalk.gray("Start:")} ${formatEventDate(start, isAllDay)}`
          );
          if (end && end !== start) {
            const endFormatted = formatEventDate(end, isAllDay);
            if (endFormatted !== formatEventDate(start, isAllDay)) {
              logger.info(`   ${chalk.gray("End:")} ${endFormatted}`);
            }
          }
        }
        if (location) {
          logger.info(`   ${chalk.gray("Location:")} ${location}`);
        }
        if (attendees > 0) {
          logger.info(`   ${chalk.gray("Attendees:")} ${attendees}`);
        }
        if (event.description) {
          const desc =
            event.description.length > 100
              ? event.description.substring(0, 100) + "..."
              : event.description;
          logger.info(`   ${chalk.gray("Description:")} ${desc}`);
        }
      });
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch events");
    throw error;
  }
}

async function listCalendars(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Fetching calendars...").start();
  try {
    const options: { format: string } = { format: "table" };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "-f" || arg === "--format") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const calendars = await calendarService.listCalendars();
    spinner.succeed(`Found ${calendars.length} calendar(s)`);

    if (calendars.length === 0) {
      logger.info(chalk.yellow("No calendars found"));
      return;
    }

    if (options.format === "json") {
      logger.info(JSON.stringify(calendars, null, 2));
    } else {
      logger.info(chalk.bold("\nCalendars:"));
      logger.info("─".repeat(80));
      calendars.forEach((calendar: calendar_v3.Schema$CalendarListEntry) => {
        const accessRole = calendar.accessRole || "unknown";
        const color =
          accessRole === "owner"
            ? chalk.green
            : accessRole === "writer"
            ? chalk.yellow
            : chalk.gray;

        logger.info(`\n${color(calendar.summary || calendar.id)}`);
        logger.info(`  ${chalk.gray("ID:")} ${calendar.id}`);
        logger.info(`  ${chalk.gray("Access:")} ${accessRole}`);
        if (calendar.description) {
          logger.info(
            `  ${chalk.gray("Description:")} ${calendar.description}`
          );
        }
        if (calendar.primary) {
          logger.info(`  ${chalk.cyan("(Primary Calendar)")}`);
        }
      });
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch calendars");
    throw error;
  }
}

async function getEvent(calendarService: CalendarService, calendarId: string, eventId: string) {
  const spinner = ora("Fetching event details...").start();
  try {
    const event = await calendarService.getEvent(calendarId, eventId);
    spinner.succeed("Event details fetched");

    logger.info(chalk.bold("\nEvent Details:"));
    logger.info("─".repeat(80));
    logger.info(`${chalk.cyan("Title:")} ${event.summary || "No title"}`);
    logger.info(`${chalk.cyan("ID:")} ${event.id}`);
    logger.info(
      `${chalk.cyan("Start:")} ${event.start?.dateTime ?? event.start?.date}`
    );
    logger.info(
      `${chalk.cyan("End:")} ${event.end?.dateTime ?? event.end?.date}`
    );
    if (event.location) {
      logger.info(`${chalk.cyan("Location:")} ${event.location}`);
    }
    if (event.description) {
      logger.info(`${chalk.cyan("Description:")} ${event.description}`);
    }
    if (event.attendees && event.attendees.length > 0) {
      logger.info(`\n${chalk.cyan("Attendees:")}`);
      event.attendees.forEach((attendee: calendar_v3.Schema$EventAttendee) => {
        const status = attendee.responseStatus || "no-response";
        const statusColor =
          status === "accepted"
            ? chalk.green
            : status === "declined"
            ? chalk.red
            : status === "tentative"
            ? chalk.yellow
            : chalk.gray;
        logger.info(`  ${attendee.email} (${statusColor(status)})`);
      });
    }
    if (event.htmlLink) {
      logger.info(`\n${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch event details");
    throw error;
  }
}

async function createEvent(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Creating event...").start();
  try {
    // Parse options
    const options: {
      title?: string;
      start?: string;
      end?: string;
      duration?: string;
      location?: string;
      description?: string;
      attendees?: string;
      allDay?: boolean;
    } = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--title") {
        options.title = args[++i]!;
      } else if (args[i] === "--start") {
        options.start = args[++i]!;
      } else if (args[i] === "--end") {
        options.end = args[++i]!;
      } else if (args[i] === "--duration") {
        options.duration = args[++i]!;
      } else if (args[i] === "--location") {
        options.location = args[++i]!;
      } else if (args[i] === "--description") {
        options.description = args[++i]!;
      } else if (args[i] === "--attendees") {
        options.attendees = args[++i]!;
      } else if (args[i] === "--all-day") {
        options.allDay = true;
      }
    }

    if (!options.title || !options.start) {
      throw new ArgumentError("Missing required options", "Required: --title <title> --start <datetime>");
    }

    let startTime;
    if (options.allDay) {
      startTime = new Date(options.start);
      startTime.setHours(0, 0, 0, 0);
    } else {
      startTime = new Date(options.start);
    }

    let endTime;
    if (options.end) {
      endTime = new Date(options.end);
    } else {
      endTime = new Date(
        startTime.getTime() + parseInt(options.duration || "60", 10) * 60000
      );
    }

    if (options.allDay) {
      endTime.setHours(23, 59, 59, 999);
    }

    const eventData: Partial<Event> = {
      summary: options.title,
      start: options.allDay
        ? { date: startTime.toISOString().split("T")[0] }
        : { dateTime: startTime.toISOString() },
      end: options.allDay
        ? { date: endTime.toISOString().split("T")[0] }
        : { dateTime: endTime.toISOString() },
    };

    if (options.location) {
      eventData.location = options.location;
    }

    if (options.description) {
      eventData.description = options.description;
    }

    if (options.attendees) {
      eventData.attendees = map(
        compact(options.attendees.split(",").map((e) => e.trim())),
        (email: string) => ({
          email: email.trim(),
        })
      );
    }

    const event = await calendarService.createEvent(calendarId, eventData);
    spinner.succeed("Event created successfully");

    logger.info(chalk.green(`\nEvent created:`));
    logger.info(`${chalk.cyan("Title:")} ${event.summary}`);
    logger.info(`${chalk.cyan("ID:")} ${event.id}`);
    logger.info(
      `${chalk.cyan("Start:")} ${event.start?.dateTime ?? event.start?.date}`
    );
    logger.info(
      `${chalk.cyan("End:")} ${event.end?.dateTime ?? event.end?.date}`
    );
    if (event.htmlLink) {
      logger.info(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to create event");
    throw error;
  }
}

async function updateEvent(
  calendarService: CalendarService,
  calendarId: string,
  eventId: string,
  args: string[]
) {
  const spinner = ora("Updating event...").start();
  try {
    const currentEvent = await calendarService.getEvent(calendarId, eventId);
    const eventData = { ...currentEvent };

    // Parse options
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "--title") {
        const value = args[++i];
        if (value) eventData.summary = value;
      } else if (arg === "--start") {
        const value = args[++i];
        if (value) {
          const startTime = new Date(value);
          eventData.start = eventData.start?.date
            ? { date: startTime.toISOString().split("T")[0] }
            : { dateTime: startTime.toISOString() };
        }
      } else if (arg === "--end") {
        const value = args[++i];
        if (value) {
          const endTime = new Date(value);
          eventData.end = eventData.end?.date
            ? { date: endTime.toISOString().split("T")[0] }
            : { dateTime: endTime.toISOString() };
        }
      } else if (arg === "--location") {
        const value = args[++i];
        if (value) eventData.location = value;
      } else if (arg === "--description") {
        const value = args[++i];
        if (value) eventData.description = value;
      }
    }

    const event = await calendarService.updateEvent(
      calendarId,
      eventId,
      eventData
    );
    spinner.succeed("Event updated successfully");

    logger.info(chalk.green(`\nEvent updated:`));
    logger.info(`${chalk.cyan("Title:")} ${event.summary}`);
    logger.info(`${chalk.cyan("ID:")} ${event.id}`);
  } catch (error: unknown) {
    spinner.fail("Failed to update event");
    throw error;
  }
}

async function deleteEvent(
  calendarService: CalendarService,
  calendarId: string,
  eventId: string,
  args: string[]
) {
  const confirm = args.includes("--confirm");

  if (!confirm) {
    throw new ArgumentError("Please use --confirm flag to confirm this operation", "gwork cal delete <calendarId> <eventId> --confirm");
  }

  const spinner = ora("Deleting event...").start();
  try {
    await calendarService.deleteEvent(calendarId, eventId);
    spinner.succeed("Event deleted successfully");
    logger.info(chalk.green("Event has been deleted"));
  } catch (error: unknown) {
    spinner.fail("Failed to delete event");
    throw error;
  }
}

async function searchEvents(calendarService: CalendarService, query: string, extraArgs: string[] = []) {
  const spinner = ora("Searching events...").start();
  try {
    const options: {
      maxResults: number;
      calendar: string;
      timeMin?: string;
      timeMax?: string;
    } = {
      maxResults: 10,
      calendar: "primary",
    };

    // Parse additional options
    for (let i = 0; i < extraArgs.length; i++) {
      const arg = extraArgs[i];
      if (!arg) continue;
      
      if (arg === "--max-results" || arg === "-n") {
        const value = extraArgs[++i];
        if (value) options.maxResults = parseInt(value, 10);
      } else if (arg === "-c" || arg === "--calendar") {
        const value = extraArgs[++i];
        if (value) options.calendar = value;
      } else if (arg === "--days") {
        const value = extraArgs[++i];
        if (value) {
          const days = parseInt(value, 10);
          const timeMin = new Date();
          const timeMax = new Date();
          timeMax.setDate(timeMax.getDate() + days);
          options.timeMin = timeMin.toISOString();
          options.timeMax = timeMax.toISOString();
        }
      } else if (arg === "--start") {
        const value = extraArgs[++i];
        if (value) options.timeMin = new Date(value).toISOString();
      } else if (arg === "--end") {
        const value = extraArgs[++i];
        if (value) options.timeMax = new Date(value).toISOString();
      }
    }

    // Default time range if not specified
    if (!options.timeMin) {
      options.timeMin = new Date().toISOString();
    }
    if (!options.timeMax) {
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 30);
      options.timeMax = timeMax.toISOString();
    }

    const events = await calendarService.searchEvents(query, options.calendar, {
      maxResults: options.maxResults,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
    });

    spinner.succeed(`Found ${events.length} event(s) matching "${query}"`);

    if (events.length === 0) {
      logger.info(chalk.yellow("No events found"));
      return;
    }

    logger.info(chalk.bold(`\nSearch results for: "${query}"`));
    logger.info("─".repeat(80));
    events.forEach((event: Event, index: number) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const summary = event.summary || "No title";

      logger.info(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(summary)}`);
      logger.info(`   ${chalk.gray("Start:")} ${start ?? "Unknown"}`);
      if (event.location) {
        logger.info(`   ${chalk.gray("Location:")} ${event.location}`);
      }
    });
  } catch (error: unknown) {
    spinner.fail("Search failed");
    throw error;
  }
}

async function getFreeBusy(calendarService: CalendarService, start: string, end: string, args: string[]) {
  const spinner = ora("Fetching free/busy information...").start();
  try {
    const startTime = new Date(start);
    const endTime = new Date(end);
    let calendarIds = ["primary"];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-c" || args[i] === "--calendars") {
        const calendarArg = args[++i];
        if (calendarArg) {
          calendarIds = map(compact(calendarArg.split(",")), (id) => id.trim());
        }
      }
    }

    const freeBusy = await calendarService.getFreeBusy(
      startTime,
      endTime,
      calendarIds
    );
    spinner.succeed("Free/busy information fetched");

    logger.info(chalk.bold("\nFree/Busy Information:"));
    logger.info("─".repeat(80));
    logger.info(
      `${chalk.cyan("Time Range:")} ${startTime.toISOString()} to ${endTime.toISOString()}`
    );

    Object.entries(freeBusy.calendars || {}).forEach(([calendarId, info]: [string, calendar_v3.Schema$FreeBusyGroup | undefined]) => {
      logger.info(`\n${chalk.cyan("Calendar:")} ${calendarId}`);
      const busyPeriods = (info as any)?.busy as calendar_v3.Schema$TimePeriod[] | undefined;
      if (busyPeriods && busyPeriods.length > 0) {
        logger.info(chalk.red("Busy times:"));
        busyPeriods.forEach((busy: calendar_v3.Schema$TimePeriod) => {
          const start = busy.start ? new Date(busy.start) : new Date();
          const end = busy.end ? new Date(busy.end) : new Date();
          logger.info(
            `  ${start.toLocaleString()} - ${end.toLocaleString()}`
          );
        });
      } else {
        logger.info(chalk.green("Free during this time"));
      }
    });
  } catch (error: unknown) {
    spinner.fail("Failed to fetch free/busy information");
    throw error;
  }
}

async function createCalendar(calendarService: CalendarService, title: string) {
  const spinner = ora("Creating calendar...").start();
  try {
    const calendarData = {
      summary: title,
      timeZone: "UTC",
    };

    const calendar = await calendarService.createCalendar(calendarData);
    spinner.succeed("Calendar created successfully");

    logger.info(chalk.green(`\nCalendar created:`));
    logger.info(`${chalk.cyan("Title:")} ${calendar.summary ?? "Unknown"}`);
    logger.info(`${chalk.cyan("ID:")} ${calendar.id ?? "Unknown"}`);
    logger.info(`${chalk.cyan("Timezone:")} ${calendar.timeZone ?? "Unknown"}`);
  } catch (error: unknown) {
    spinner.fail("Failed to create calendar");
    throw error;
  }
}

async function getStats(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Analyzing calendar...").start();
  try {
    const options: { calendar: string; days: number } = {
      calendar: "primary",
      days: 30,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "-c" || arg === "--calendar") {
        const value = args[++i];
        if (value) options.calendar = value;
      } else if (arg === "--days") {
        const value = args[++i];
        if (value) options.days = parseInt(value, 10);
      }
    }

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + options.days);

    const result = await calendarService.listEvents(options.calendar, {
      maxResults: 2500,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    const events = result.events;

    spinner.succeed(`Analyzed ${events.length} event(s)`);

    const stats: {
      total: number;
      allDay: number;
      timed: number;
      withLocation: number;
      withAttendees: number;
      totalDuration: number;
      byDay: Record<string, number>;
    } = {
      total: events.length,
      allDay: 0,
      timed: 0,
      withLocation: 0,
      withAttendees: 0,
      totalDuration: 0,
      byDay: {},
    };

    events.forEach((event: Event) => {
      if (event.start?.date) {
        stats.allDay++;
      } else {
        stats.timed++;
        if (event.start?.dateTime && event.end?.dateTime) {
          const duration =
            new Date(event.end.dateTime).getTime() -
            new Date(event.start.dateTime).getTime();
          stats.totalDuration += duration;
        }
      }
      if (event.location) stats.withLocation++;
      if (event.attendees && event.attendees.length > 0) stats.withAttendees++;

      const date = event.start?.date || event.start?.dateTime?.split("T")[0];
      if (date) {
        const day = new Date(date).toLocaleDateString("en-US", {
          weekday: "long",
        });
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;
      }
    });

    const hours = Math.floor(stats.totalDuration / (1000 * 60 * 60));
    const minutes = Math.floor(
      (stats.totalDuration % (1000 * 60 * 60)) / (1000 * 60)
    );

    logger.info(chalk.bold("\nCalendar Statistics:"));
    logger.info("─".repeat(80));
    logger.info(`${chalk.cyan("Total Events:")} ${stats.total}`);
    logger.info(`${chalk.cyan("All-day Events:")} ${stats.allDay}`);
    logger.info(`${chalk.cyan("Timed Events:")} ${stats.timed}`);
    logger.info(
      `${chalk.cyan("Events with Location:")} ${stats.withLocation}`
    );
    logger.info(
      `${chalk.cyan("Events with Attendees:")} ${stats.withAttendees}`
    );
    if (stats.timed > 0) {
      logger.info(
        `${chalk.cyan("Total Time Scheduled:")} ${hours}h ${minutes}m`
      );
      logger.info(
        `${chalk.cyan("Average Event Duration:")} ${Math.floor(stats.totalDuration / stats.timed / (1000 * 60))} minutes`
      );
    }

    if (!isEmpty(stats.byDay)) {
      logger.info(`\n${chalk.cyan("Events by Day of Week:")}`);
      const sortedDays = orderBy(
        Object.entries(stats.byDay),
        [([, count]) => count],
        ["desc"]
      );
      sortedDays.forEach(([day, count]) => {
        const countNum = typeof count === "number" ? count : 0;
        const bar = "█".repeat(Math.floor((countNum / stats.total) * 50));
        logger.info(
          `  ${day.padEnd(10)} ${countNum.toString().padStart(3)} ${chalk.gray(bar)}`
        );
      });
    }
  } catch (error: unknown) {
    spinner.fail("Failed to analyze calendar");
    throw error;
  }
}

async function duplicateEvent(calendarService: CalendarService, calendarId: string, eventId: string, args: string[]) {
  const spinner = ora("Duplicating event...").start();
  try {
    const options: { toCalendar: string; start?: string } = { toCalendar: calendarId };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--to-calendar") {
        const value = args[++i];
        if (value) options.toCalendar = value;
      } else if (args[i] === "--start") {
        const value = args[++i];
        if (value) options.start = value;
      }
    }

    const originalEvent = await calendarService.getEvent(calendarId, eventId);

    // Create new event data from original
    const newEventData: Partial<Event> = {
      summary: originalEvent.summary,
      description: originalEvent.description,
      location: originalEvent.location,
      attendees: originalEvent.attendees,
      reminders: originalEvent.reminders,
      colorId: originalEvent.colorId,
    };

    // Handle start/end times
    if (options.start) {
      const newStart = new Date(options.start);
      const originalStart = originalEvent.start?.dateTime
        ? new Date(originalEvent.start.dateTime)
        : originalEvent.start?.date
        ? new Date(originalEvent.start.date)
        : new Date();

      if (originalEvent.start?.date) {
        // All-day event
        newEventData.start = { date: newStart.toISOString().split("T")[0] };
        const originalEnd = originalEvent.end?.date
          ? new Date(originalEvent.end.date)
          : newStart;
        const duration = originalEnd.getTime() - originalStart.getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        newEventData.end = { date: newEnd.toISOString().split("T")[0] };
      } else {
        // Timed event
        const originalEnd = originalEvent.end?.dateTime
          ? new Date(originalEvent.end.dateTime)
          : newStart;
        const duration = originalEnd.getTime() - originalStart.getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        newEventData.start = { dateTime: newStart.toISOString() };
        newEventData.end = { dateTime: newEnd.toISOString() };
      }
    } else {
      // Copy original start/end
      newEventData.start = originalEvent.start;
      newEventData.end = originalEvent.end;
    }

    const newEvent = await calendarService.createEvent(
      options.toCalendar,
      newEventData
    );
    spinner.succeed("Event duplicated successfully");

    logger.info(chalk.green(`\nEvent duplicated:`));
    logger.info(`${chalk.cyan("Title:")} ${newEvent.summary}`);
    logger.info(`${chalk.cyan("ID:")} ${newEvent.id}`);
    logger.info(
      `${chalk.cyan("Start:")} ${newEvent.start?.dateTime ?? newEvent.start?.date}`
    );
    if (newEvent.htmlLink) {
      logger.info(`${chalk.cyan("Link:")} ${newEvent.htmlLink}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to duplicate event");
    throw error;
  }
}

async function quickAction(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Creating quick event...").start();
  try {
    const options: { calendar: string } = { calendar: "primary" };

    let action: string | null = null;
    let value: string | null = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--meeting") {
        action = "meeting";
        const v = args[++i];
        if (v) value = v;
      } else if (args[i] === "--reminder") {
        action = "reminder";
        const v = args[++i];
        if (v) value = v;
      } else if (args[i] === "--block") {
        action = "block";
        const v = args[++i];
        if (v) value = v;
      } else if (args[i] === "-c" || args[i] === "--calendar") {
        const v = args[++i];
        if (v) options.calendar = v;
      }
    }

    if (!action || !value) {
      throw new ArgumentError("Missing action", "Usage: gwork cal quick --meeting <title> | --reminder <title> | --block <hours>");
    }

    const now = new Date();
    let eventData: Partial<Event> = {};

    if (action === "meeting") {
      const end = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
      eventData = {
        summary: value,
        start: { dateTime: now.toISOString() },
        end: { dateTime: end.toISOString() },
      };
    } else if (action === "reminder") {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      eventData = {
        summary: value,
        start: { date: today.toISOString().split("T")[0] },
        end: { date: tomorrow.toISOString().split("T")[0] },
      };
    } else if (action === "block") {
      const hours = parseFloat(value);
      if (isNaN(hours)) {
        throw new ArgumentError("Invalid hours", "Hours must be a number");
      }
      const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
      eventData = {
        summary: `Focus time (${hours}h)`,
        start: { dateTime: now.toISOString() },
        end: { dateTime: end.toISOString() },
      };
    }

    const event = await calendarService.createEvent(options.calendar, eventData);
    spinner.succeed("Quick event created");

    logger.info(chalk.green(`\nEvent created:`));
    logger.info(`${chalk.cyan("Title:")} ${event.summary}`);
    logger.info(`${chalk.cyan("ID:")} ${event.id}`);
    if (event.htmlLink) {
      logger.info(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to create quick event");
    throw error;
  }
}

async function exportEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Exporting events...").start();
  try {
    const options: { format: string; output: string | null } = {
      format: "json",
      output: null,
    };

    let timeMin = new Date();
    let timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 30);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "--format" || arg === "-f") {
        const value = args[++i];
        if (value) options.format = value;
      } else if (arg === "--start") {
        const value = args[++i];
        if (value) timeMin = new Date(value);
      } else if (arg === "--end") {
        const value = args[++i];
        if (value) timeMax = new Date(value);
      } else if (arg === "--output" || arg === "-o") {
        const value = args[++i];
        if (value) options.output = value;
      }
    }

    const result = await calendarService.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 2500,
    });
    const events = result.events;

    let output = "";

    if (options.format === "json") {
      output = JSON.stringify(events, null, 2);
    } else if (options.format === "csv") {
      output = "Title,Start,End,Location,Description\n";
      events.forEach((event: Event) => {
        const title = (event.summary || "").replace(/"/g, '""');
        const start = event.start?.dateTime ?? event.start?.date ?? "";
        const end = event.end?.dateTime ?? event.end?.date ?? "";
        const location = (event.location || "").replace(/"/g, '""');
        const description = (event.description || "").replace(/"/g, '""').replace(/\n/g, " ");
        output += `"${title}","${start}","${end}","${location}","${description}"\n`;
      });
    } else if (options.format === "ical") {
      output = "BEGIN:VCALENDAR\n";
      output += "VERSION:2.0\n";
      output += "PRODID:-//gwork//EN\n";
      output += "CALSCALE:GREGORIAN\n";

      events.forEach((event: Event) => {
        output += "BEGIN:VEVENT\n";
        output += `UID:${event.id}@gwork\n`;
        output += `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z\n`;

        if (event.start?.dateTime) {
          output += `DTSTART:${event.start.dateTime.replace(/[-:]/g, "").split(".")[0]}Z\n`;
        } else if (event.start?.date) {
          output += `DTSTART;VALUE=DATE:${event.start.date.replace(/-/g, "")}\n`;
        }

        if (event.end?.dateTime) {
          output += `DTEND:${event.end.dateTime.replace(/[-:]/g, "").split(".")[0]}Z\n`;
        } else if (event.end?.date) {
          output += `DTEND;VALUE=DATE:${event.end.date.replace(/-/g, "")}\n`;
        }

        if (event.summary) {
          output += `SUMMARY:${event.summary.replace(/\n/g, "\\n")}\n`;
        }
        if (event.description) {
          output += `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}\n`;
        }
        if (event.location) {
          output += `LOCATION:${event.location.replace(/\n/g, "\\n")}\n`;
        }
        output += "END:VEVENT\n";
      });

      output += "END:VCALENDAR\n";
    } else {
      throw new ArgumentError("Invalid format", "Valid formats: json, csv, ical");
    }

    if (options.output) {
      const fs = await import("node:fs");
      fs.writeFileSync(options.output, output);
      spinner.succeed(`Exported ${events.length} event(s) to ${options.output}`);
    } else {
      spinner.succeed(`Exported ${events.length} event(s)`);
      logger.info(output);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to export events");
    throw error;
  }
}

async function manageReminders(
  calendarService: CalendarService,
  calendarId: string,
  eventId: string,
  args: string[]
) {
  const spinner = ora("Managing reminders...").start();
  try {
    if (args.length === 0) {
      throw new ArgumentError("Missing action", "Usage: gwork cal reminders <calendarId> <eventId> <action> [options]\nActions: list, add, remove, clear, default");
    }

    const action = args[0];
    const event = await calendarService.getEvent(calendarId, eventId);

    if (action === "list") {
      spinner.succeed("Reminders fetched");
      const reminders = event.reminders?.overrides || [];
      const useDefault = event.reminders?.useDefault || false;

      logger.info(chalk.bold("\nEvent Reminders:"));
      logger.info("─".repeat(80));
      if (useDefault) {
        logger.info(chalk.cyan("Using default reminders"));
      }
      if (reminders.length === 0 && !useDefault) {
        logger.info(chalk.yellow("No reminders set"));
      } else {
        reminders.forEach((reminder: calendar_v3.Schema$EventReminder, index: number) => {
          const method = reminder.method || "popup";
          const minutes = reminder.minutes || 0;
          logger.info(
            `${index + 1}. ${method} - ${minutes} minutes before event`
          );
        });
      }
    } else if (action === "add") {
      let minutes = 15;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === "--minutes") {
          const value = args[++i];
          if (value) minutes = parseInt(value, 10);
        }
      }

      const reminders = event.reminders?.overrides || [];
      reminders.push({ method: "popup", minutes });

      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        reminders: {
          useDefault: false,
          overrides: reminders,
        },
      });
      spinner.succeed("Reminder added");
      logger.info(chalk.green(`Added reminder: ${minutes} minutes before event`));
    } else if (action === "remove") {
      let index = -1;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === "--index") {
          const value = args[++i];
          if (value) index = parseInt(value, 10) - 1;
        }
      }

      if (index < 0) {
        throw new ArgumentError("Invalid index", "Please specify --index <number>");
      }

      const reminders = event.reminders?.overrides || [];
      if (index >= reminders.length) {
        throw new ArgumentError("Index out of range", "Please specify a valid index");
      }

      reminders.splice(index, 1);

      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        reminders: {
          useDefault: reminders.length === 0,
          overrides: reminders,
        },
      });
      spinner.succeed("Reminder removed");
    } else if (action === "clear") {
      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        reminders: {
          useDefault: false,
          overrides: [],
        },
      });
      spinner.succeed("All reminders cleared");
    } else if (action === "default") {
      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        reminders: {
          useDefault: true,
          overrides: [],
        },
      });
      spinner.succeed("Using default reminders");
    } else {
      throw new ArgumentError("Invalid action", "Valid actions: list, add, remove, clear, default");
    }
  } catch (error: unknown) {
    spinner.fail("Failed to manage reminders");
    throw error;
  }
}

async function bulkUpdateEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Bulk updating events...").start();
  try {
    const options: { dryRun: boolean; query: string | null } = {
      dryRun: false,
      query: null,
    };

    const updates: {
      summary?: string;
      location?: string;
      description?: string;
      titlePattern?: string;
    } = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      if (arg === "--query") {
        const value = args[++i];
        if (value) options.query = value;
      } else if (arg === "--title") {
        const value = args[++i];
        if (value) updates.summary = value;
      } else if (arg === "--location") {
        const value = args[++i];
        if (value) updates.location = value;
      } else if (arg === "--description") {
        const value = args[++i];
        if (value) updates.description = value;
      } else if (arg === "--title-pattern") {
        const value = args[++i];
        if (value) updates.titlePattern = value;
      } else if (arg === "--dry-run") {
        options.dryRun = true;
      }
    }

    if (isEmpty(updates)) {
      throw new ArgumentError("No updates specified", "Please specify at least one field to update");
    }

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 365);

    let events;
    if (options.query) {
      events = await calendarService.searchEvents(
        options.query,
        calendarId,
        {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 2500,
        }
      );
    } else {
      const result = await calendarService.listEvents(calendarId, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
      });
      events = result.events;
    }

    spinner.succeed(`Found ${events.length} event(s) to update`);

    if (options.dryRun) {
      logger.info(chalk.yellow("\nDry run - no changes will be made:"));
      events.slice(0, 10).forEach((event: Event, index: number) => {
        logger.info(`\n${index + 1}. ${event.summary || "No title"}`);
        if (updates.summary) {
          logger.info(`   Title: "${event.summary}" -> "${updates.summary}"`);
        }
        if (updates.titlePattern && event.summary) {
          const newTitle = updates.titlePattern.replace(/%s/g, event.summary);
          logger.info(`   Title: "${event.summary}" -> "${newTitle}"`);
        }
        if (updates.location) {
          logger.info(`   Location: "${event.location || ""}" -> "${updates.location}"`);
        }
        if (updates.description) {
          logger.info(`   Description: "${(event.description || "").substring(0, 50)}..." -> "${updates.description.substring(0, 50)}..."`);
        }
      });
      if (events.length > 10) {
        logger.info(chalk.gray(`\n... and ${events.length - 10} more events`));
      }
      return;
    }

    let updated = 0;
    for (const event of events) {
      const eventUpdates: Partial<Event> = { ...event };

      if (updates.summary) {
        eventUpdates.summary = updates.summary;
      } else if (updates.titlePattern && event.summary) {
        eventUpdates.summary = updates.titlePattern.replace(/%s/g, event.summary ?? "");
      }

      if (updates.location !== undefined) {
        eventUpdates.location = updates.location;
      }

      if (updates.description !== undefined) {
        eventUpdates.description = updates.description;
      }

      if (event.id) {
        await calendarService.updateEvent(calendarId, event.id, eventUpdates);
      }
      updated++;
    }

    spinner.succeed(`Updated ${updated} event(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to bulk update events");
    throw error;
  }
}

async function batchCreateEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Batch creating events...").start();
  try {
    const options: { file: string | null; stdin: boolean; template: string | null; dryRun: boolean } = {
      file: null,
      stdin: false,
      template: null,
      dryRun: false,
    };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--file" || args[i] === "-f") {
        const file = args[++i];
        if (file) options.file = file;
      } else if (args[i] === "--stdin") {
        options.stdin = true;
      } else if (args[i] === "--template") {
        const template = args[++i];
        if (template) options.template = template;
      } else if (args[i] === "--dry-run") {
        options.dryRun = true;
      }
    }

    let eventsData: Partial<Event>[] = [];

    if (options.stdin) {
      const fs = await import("node:fs");
      const input = fs.readFileSync(0, "utf8");
      eventsData = JSON.parse(input);
    } else if (options.file) {
      const fs = await import("node:fs");
      const fileContent = fs.readFileSync(options.file, "utf8");
      eventsData = JSON.parse(fileContent);
    } else {
      throw new ArgumentError("No input specified", "Please specify --file <path> or --stdin");
    }

    if (!Array.isArray(eventsData)) {
      throw new ArgumentError("Invalid input format", "Input must be a JSON array of event objects");
    }

    if (options.template) {
      // Apply template
      eventsData = eventsData.map((event: Partial<Event> & Record<string, unknown>) => {
        const templateEvent: Partial<Event> = { ...event };
        if (options.template === "meeting") {
          templateEvent.summary = event.summary || "Meeting";
          if (!templateEvent.start) {
            templateEvent.start = { dateTime: new Date().toISOString() };
          }
          if (!templateEvent.end && templateEvent.start?.dateTime) {
            const start = new Date(templateEvent.start.dateTime);
            templateEvent.end = {
              dateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
            };
          }
        } else if (options.template === "reminder") {
          templateEvent.summary = event.summary || "Reminder";
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          templateEvent.start = { date: today.toISOString().split("T")[0] };
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          templateEvent.end = { date: tomorrow.toISOString().split("T")[0] };
        } else if (options.template === "all-day") {
          templateEvent.summary = event.summary || "All-day event";
          const dateStr = (event["date"] as string | undefined) || new Date().toISOString().split("T")[0];
          templateEvent.start = { date: dateStr || "" };
          const nextDay = new Date(dateStr || "");
          nextDay.setDate(nextDay.getDate() + 1);
          templateEvent.end = { date: nextDay.toISOString().split("T")[0] };
        }
        return templateEvent;
      });
    }

    spinner.succeed(`Loaded ${eventsData.length} event(s)`);

    if (options.dryRun) {
      logger.info(chalk.yellow("\nDry run - events that would be created:"));
      eventsData.slice(0, 10).forEach((event: Partial<Event>, index: number) => {
        logger.info(`\n${index + 1}. ${event.summary || "No title"}`);
        logger.info(`   Start: ${event.start?.dateTime ?? event.start?.date ?? "N/A"}`);
        if (event.location) {
          logger.info(`   Location: ${event.location}`);
        }
      });
      if (eventsData.length > 10) {
        logger.info(chalk.gray(`\n... and ${eventsData.length - 10} more events`));
      }
      return;
    }

    let created = 0;
    for (const eventData of eventsData) {
      try {
        await calendarService.createEvent(calendarId, eventData);
        created++;
      } catch (_error: unknown) {
        logger.error(chalk.red(`Failed to create event: ${eventData.summary || "Unknown"}`));
        // Continue with other events even if one fails
      }
    }

    spinner.succeed(`Created ${created} event(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to batch create events");
    throw error;
  }
}

async function checkConflict(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Checking for conflicts...").start();
  try {
    const options: { calendars: string[]; duration: number } = {
      calendars: [calendarId],
      duration: 60,
    };

    let startTime: Date | null = null;
    let endTime: Date | null = null;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "--start") {
        const value = args[++i];
        if (value) startTime = new Date(value);
      } else if (arg === "--end") {
        const value = args[++i];
        if (value) endTime = new Date(value);
      } else if (arg === "--calendars" || arg === "-c") {
        const value = args[++i];
        if (value) options.calendars = map(compact(value.split(",")), (id: string) => id.trim());
      } else if (arg === "--duration") {
        const value = args[++i];
        if (value) options.duration = parseInt(value, 10);
      }
    }

    if (!startTime) {
      startTime = new Date();
    }
    if (!endTime) {
      endTime = new Date(startTime.getTime() + options.duration * 60 * 1000);
    }

    const freeBusy = await calendarService.getFreeBusy(
      startTime,
      endTime,
      options.calendars
    );

    spinner.succeed("Conflict check complete");

    logger.info(chalk.bold("\nConflict Check:"));
    logger.info("─".repeat(80));
    logger.info(
      `${chalk.cyan("Time Range:")} ${startTime.toLocaleString()} to ${endTime.toLocaleString()}`
    );

    let hasConflicts = false;
    Object.entries(freeBusy.calendars || {}).forEach(([calId, info]: [string, calendar_v3.Schema$FreeBusyGroup | undefined]) => {
      const busyPeriods = (info as any)?.busy as calendar_v3.Schema$TimePeriod[] | undefined;
      if (busyPeriods && busyPeriods.length > 0) {
        hasConflicts = true;
        logger.info(`\n${chalk.red("Conflicts in:")} ${calId}`);
        busyPeriods.forEach((busy: calendar_v3.Schema$TimePeriod) => {
          const start = busy.start ? new Date(busy.start) : new Date();
          const end = busy.end ? new Date(busy.end) : new Date();
          logger.info(
            `  ${chalk.yellow(start.toLocaleString())} - ${chalk.yellow(end.toLocaleString())}`
          );
        });
      } else {
        logger.info(`\n${chalk.green("Free in:")} ${calId}`);
      }
    });

    if (!hasConflicts) {
      logger.info(chalk.green("\n✓ No conflicts found - time slot is available"));
    }
  } catch (error: unknown) {
    spinner.fail("Failed to check conflicts");
    throw error;
  }
}

async function compareCalendars(calendarService: CalendarService, calendarId1: string, calendarId2: string, args: string[]) {
  const spinner = ora("Comparing calendars...").start();
  try {
    const options: { format: string } = {
      format: "table",
    };

    let timeMin = new Date();
    let timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 30);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      
      if (arg === "--start") {
        const value = args[++i];
        if (value) timeMin = new Date(value);
      } else if (arg === "--end") {
        const value = args[++i];
        if (value) timeMax = new Date(value);
      } else if (arg === "--format" || arg === "-f") {
        const value = args[++i];
        if (value) options.format = value;
      }
    }

    const [result1, result2] = await Promise.all([
      calendarService.listEvents(calendarId1, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
      }),
      calendarService.listEvents(calendarId2, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 2500,
      }),
    ]);
    const events1 = result1.events;
    const events2 = result2.events;

    spinner.succeed("Calendars compared");

    // Find unique events
    const events1Ids = new Set(events1.map((e) => e.id).filter(Boolean));
    const events2Ids = new Set(events2.map((e) => e.id).filter(Boolean));

    const unique1 = uniqBy(events1.filter((e) => e.id && !events2Ids.has(e.id)), "id");
    const unique2 = uniqBy(events2.filter((e) => e.id && !events1Ids.has(e.id)), "id");

    // Find overlapping (same time)
    interface Overlap {
      event1: Event;
      event2: Event;
    }

    // Pre-compute timestamps once per event (O(n+m)) before the O(n*m) comparison loop
    const times1 = events1.map((e) => {
      const start = e.start?.dateTime ?? e.start?.date;
      const end = e.end?.dateTime ?? e.end?.date;
      return start && end ? { s: new Date(start).getTime(), e: new Date(end).getTime() } : null;
    });
    const times2 = events2.map((e) => {
      const start = e.start?.dateTime ?? e.start?.date;
      const end = e.end?.dateTime ?? e.end?.date;
      return start && end ? { s: new Date(start).getTime(), e: new Date(end).getTime() } : null;
    });

    const overlapping: Overlap[] = [];
    events1.forEach((e1, i) => {
      const t1 = times1[i];
      if (!t1) return;
      events2.forEach((e2, j) => {
        const t2 = times2[j];
        if (!t2) return;
        if (t1.s < t2.e && t2.s < t1.e) {
          overlapping.push({ event1: e1, event2: e2 });
        }
      });
    });

    if (options.format === "json") {
      logger.info(
        JSON.stringify(
          {
            calendar1: { id: calendarId1, total: events1.length, unique: unique1.length },
            calendar2: { id: calendarId2, total: events2.length, unique: unique2.length },
            overlappingCount: overlapping.length,
            unique1: unique1,
            unique2: unique2,
            overlapping: overlapping,
          },
          null,
          2
        )
      );
    } else {
      logger.info(chalk.bold("\nCalendar Comparison:"));
      logger.info("─".repeat(80));
      logger.info(`${chalk.cyan("Calendar 1:")} ${calendarId1} - ${events1.length} events`);
      logger.info(`${chalk.cyan("Calendar 2:")} ${calendarId2} - ${events2.length} events`);
      logger.info(`${chalk.cyan("Overlapping:")} ${overlapping.length} events`);

      if (unique1.length > 0) {
        logger.info(`\n${chalk.yellow(`Unique to ${calendarId1}:`)} ${unique1.length} events`);
        unique1.slice(0, 5).forEach((event) => {
          logger.info(`  - ${event.summary || "No title"}`);
        });
        if (unique1.length > 5) {
          logger.info(chalk.gray(`  ... and ${unique1.length - 5} more`));
        }
      }

      if (unique2.length > 0) {
        logger.info(`\n${chalk.yellow(`Unique to ${calendarId2}:`)} ${unique2.length} events`);
        unique2.slice(0, 5).forEach((event) => {
          logger.info(`  - ${event.summary || "No title"}`);
        });
        if (unique2.length > 5) {
          logger.info(chalk.gray(`  ... and ${unique2.length - 5} more`));
        }
      }

      if (overlapping.length > 0) {
        logger.info(`\n${chalk.red("Overlapping events:")}`);
        overlapping.slice(0, 5).forEach((overlap) => {
          logger.info(
            `  ${overlap.event1.summary || "No title"} <-> ${overlap.event2.summary || "No title"}`
          );
        });
        if (overlapping.length > 5) {
          logger.info(chalk.gray(`  ... and ${overlapping.length - 5} more`));
        }
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to compare calendars");
    throw error;
  }
}

async function updateRecurringEvent(calendarService: CalendarService, calendarId: string, eventId: string, args: string[]) {
  const spinner = ora("Updating recurring event...").start();
  try {
    const options: { dryRun: boolean; allInstances: boolean } = {
      dryRun: false,
      allInstances: false,
    };

    const updates: {
      summary?: string;
      location?: string;
      description?: string;
    } = {};

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--title") {
        updates.summary = args[++i];
      } else if (args[i] === "--location") {
        updates.location = args[++i];
      } else if (args[i] === "--description") {
        updates.description = args[++i];
      } else if (args[i] === "--all-instances") {
        options.allInstances = true;
      } else if (args[i] === "--dry-run") {
        options.dryRun = true;
      }
    }

    if (isEmpty(updates)) {
      throw new ArgumentError("No updates specified", "Please specify at least one field to update");
    }

    const originalEvent = await calendarService.getEvent(calendarId, eventId);

    if (!originalEvent.recurrence || originalEvent.recurrence.length === 0) {
      throw new ArgumentError("Event is not recurring", "This event does not have recurrence rules");
    }

    // Find all instances
    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 1);

    const result = await calendarService.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 2500,
      q: originalEvent.summary || "",
    });
    const instances = result.events;

    const recurringInstances = instances.filter((e: Event) => {
      return e.recurringEventId === eventId || e.id === eventId;
    });

    spinner.succeed(`Found ${recurringInstances.length} instance(s)`);

    if (options.dryRun) {
      logger.info(chalk.yellow("\nDry run - instances that would be updated:"));
      recurringInstances.slice(0, 10).forEach((instance: Event, index: number) => {
        logger.info(`\n${index + 1}. ${instance.summary || "No title"}`);
        logger.info(`   Start: ${instance.start?.dateTime ?? instance.start?.date}`);
        if (updates.summary) {
          logger.info(`   Title: "${instance.summary}" -> "${updates.summary}"`);
        }
        if (updates.location) {
          logger.info(`   Location: "${instance.location || ""}" -> "${updates.location}"`);
        }
      });
      if (recurringInstances.length > 10) {
        logger.info(chalk.gray(`\n... and ${recurringInstances.length - 10} more instances`));
      }
      return;
    }

    let updated = 0;
    for (const instance of recurringInstances) {
      if (!instance.id) continue;
      
      const instanceUpdates: Partial<Event> = { ...instance };
      if (updates.summary) instanceUpdates.summary = updates.summary;
      if (updates.location !== undefined) instanceUpdates.location = updates.location;
      if (updates.description !== undefined) instanceUpdates.description = updates.description;

      await calendarService.updateEvent(calendarId, instance.id, instanceUpdates);
      updated++;
    }

    spinner.succeed(`Updated ${updated} instance(s)`);
  } catch (error: unknown) {
    spinner.fail("Failed to update recurring event");
    throw error;
  }
}

async function manageColor(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Managing colors...").start();
  try {
    const colorMap: Record<number, string> = {
      1: "Lavender",
      2: "Sage",
      3: "Grape",
      4: "Flamingo",
      5: "Banana",
      6: "Tangerine",
      7: "Peacock",
      8: "Graphite",
      9: "Blueberry",
      10: "Basil",
      11: "Tomato",
    };

    if (args.length === 0 || args[0] === "list") {
      spinner.succeed("Available colors:");
      logger.info(chalk.bold("\nGoogle Calendar Colors:"));
      logger.info("─".repeat(80));
      Object.entries(colorMap).forEach(([id, name]) => {
        const nameStr = typeof name === "string" ? name : String(name);
        logger.info(`  ${id.toString().padStart(2)}. ${startCase(nameStr)}`);
      });
      return;
    }

    if (args.length < 3) {
      throw new ArgumentError("Missing parameters", "Usage: gwork cal color set <calendarId> <eventId> <colorId>");
    }

    if (args[0] === "set") {
      if (!args[1] || !args[2] || !args[3]) {
        throw new ArgumentError("Missing parameters", "Usage: gwork cal color set <calendarId> <eventId> <colorId>");
      }
      const calendarId = args[1];
      const eventId = args[2];
      const colorId = parseInt(args[3], 10);

      if (isNaN(colorId) || colorId < 1 || colorId > 11) {
        throw new ArgumentError("Invalid color ID", "Color ID must be between 1 and 11");
      }

      const event = await calendarService.getEvent(calendarId, eventId);
      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        colorId: colorId.toString(),
      });

      spinner.succeed("Color updated");
      logger.info(
        chalk.green(`Event color set to: ${startCase(colorMap[colorId] ?? "Unknown")} (${colorId})`)
      );
    } else {
      throw new ArgumentError("Invalid action", "Valid actions: list, set");
    }
  } catch (error: unknown) {
    spinner.fail("Failed to manage color");
    throw error;
  }
}

async function workWithRecurrence(args: string[]) {
  const spinner = ora("Working with recurrence...").start();
  try {
    if (args.length === 0 || args[0] === "help") {
      logger.info(chalk.bold("\nRecurrence Utilities:"));
      logger.info("─".repeat(80));
      logger.info("Parse RRULE: gwork cal recurrence parse <rrule>");
      logger.info("Show occurrences: gwork cal recurrence occurrences <rrule> [--count N]");
      return;
    }

    const action = args[0];

    if (action === "parse") {
      if (args.length < 2 || !args[1]) {
        throw new ArgumentError("Missing RRULE", "Usage: gwork cal recurrence parse <rrule>");
      }

      const { RRule } = await import("rrule");
      const rrule = RRule.fromString(args[1]);
      const text = rrule.toText();
      spinner.succeed("RRULE parsed");
      logger.info(chalk.cyan(`Natural language: ${text}`));
      logger.info(chalk.gray(`RRULE: ${args[1]}`));
    } else if (action === "occurrences") {
      if (args.length < 2) {
        throw new ArgumentError("Missing RRULE", "Usage: gwork cal recurrence occurrences <rrule> [--count N]");
      }

      let count = 10;
      for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === "--count") {
          const value = args[++i];
          if (value) count = parseInt(value, 10);
        }
      }

      const { RRule } = await import("rrule");
      const rruleString = args[1];
      if (!rruleString) {
        throw new ArgumentError("Missing RRULE", "Usage: gwork cal recurrence occurrences <rrule> [--count N]");
      }
      const rrule = RRule.fromString(rruleString);
      const occurrences = rrule.all().slice(0, count);

      spinner.succeed(`Found ${occurrences.length} occurrence(s)`);
      logger.info(chalk.bold("\nNext Occurrences:"));
      occurrences.forEach((date: Date, index: number) => {
        logger.info(`  ${index + 1}. ${date.toLocaleString()}`);
      });
    } else {
      throw new ArgumentError("Invalid action", "Valid actions: parse, occurrences");
    }
  } catch (error: unknown) {
    spinner.fail("Failed to work with recurrence");
    throw error;
  }
}

async function createRecurringEvent(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Creating recurring event...").start();
  try {
    const options: {
      title?: string;
      start?: string;
      end?: string;
      duration?: string;
      location?: string;
      description?: string;
      rrule?: string;
      frequency?: string;
      count?: number;
      until?: string;
    } = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      if (arg === "--title") {
        const value = args[++i];
        if (value) options.title = value;
      } else if (arg === "--start") {
        const value = args[++i];
        if (value) options.start = value;
      } else if (arg === "--end") {
        const value = args[++i];
        if (value) options.end = value;
      } else if (arg === "--duration") {
        const value = args[++i];
        if (value) options.duration = value;
      } else if (arg === "--location") {
        const value = args[++i];
        if (value) options.location = value;
      } else if (arg === "--description") {
        const value = args[++i];
        if (value) options.description = value;
      } else if (arg === "--rrule") {
        const value = args[++i];
        if (value) options.rrule = value;
      } else if (arg === "--frequency") {
        const value = args[++i];
        if (value) options.frequency = value;
      } else if (arg === "--count") {
        const value = args[++i];
        if (value) options.count = parseInt(value, 10);
      } else if (arg === "--until") {
        const value = args[++i];
        if (value) options.until = value;
      }
    }

    if (!options.title || !options.start) {
      throw new ArgumentError("Missing required options", "Required: --title <title> --start <datetime>");
    }

    const { RRule } = await import("rrule");

    let rruleString: string;
    if (options.rrule) {
      rruleString = options.rrule;
    } else if (options.frequency) {
      const freqMap: Record<string, number> = {
        daily: RRule.DAILY,
        weekly: RRule.WEEKLY,
        monthly: RRule.MONTHLY,
        yearly: RRule.YEARLY,
      };

      const normalizedFreq = options.frequency.toLowerCase();
      const freq = freqMap[normalizedFreq];
      if (!freq) {
        const validFrequencies = Object.keys(freqMap).map(f => startCase(f)).join(", ");
        throw new ArgumentError("Invalid frequency", `Valid frequencies: ${validFrequencies}`);
      }

      const rrule = new RRule({
        freq,
        dtstart: new Date(options.start),
        count: options.count,
        until: options.until ? new Date(options.until) : undefined,
      });
      rruleString = rrule.toString();
    } else {
      throw new ArgumentError("Missing recurrence rule", "Please specify --rrule or --frequency");
    }

    const startTime = new Date(options.start);
    let endTime;
    if (options.end) {
      endTime = new Date(options.end);
    } else {
      endTime = new Date(
        startTime.getTime() + parseInt(options.duration || "60", 10) * 60000
      );
    }

    const eventData: Partial<Event> = {
      summary: typeof options.title === "string" ? options.title : "",
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      recurrence: [rruleString],
    };

    if (options.location) eventData.location = options.location;
    if (options.description) eventData.description = options.description;

    const event = await calendarService.createEvent(calendarId, eventData);
    spinner.succeed("Recurring event created");

    logger.info(chalk.green(`\nRecurring event created:`));
    logger.info(`${chalk.cyan("Title:")} ${event.summary}`);
    logger.info(`${chalk.cyan("ID:")} ${event.id}`);
    logger.info(`${chalk.cyan("RRULE:")} ${rruleString}`);
    if (event.htmlLink) {
      logger.info(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to create recurring event");
    throw error;
  }
}

async function showRecurrenceInfo(calendarService: CalendarService, calendarId: string, eventId: string) {
  const spinner = ora("Fetching recurrence info...").start();
  try {
    const event = await calendarService.getEvent(calendarId, eventId);

    if (!event.recurrence || event.recurrence.length === 0) {
      spinner.succeed("Event is not recurring");
      logger.info(chalk.yellow("This event does not have recurrence rules"));
      return;
    }

    const rruleString = event.recurrence.find((r: string) => r.startsWith("RRULE:"))?.substring(6) || event.recurrence[0];

    if (!rruleString) {
      throw new ArgumentError("No recurrence rule found", "This event has no valid RRULE");
    }

    const { RRule } = await import("rrule");
    const rrule = RRule.fromString(rruleString);
    const text = rrule.toText();
    const occurrences = rrule.all().slice(0, 10);

    spinner.succeed("Recurrence info fetched");

    logger.info(chalk.bold("\nRecurrence Information:"));
    logger.info("─".repeat(80));
    logger.info(`${chalk.cyan("Event:")} ${event.summary || "No title"}`);
    logger.info(`${chalk.cyan("RRULE:")} ${rruleString}`);
    logger.info(`${chalk.cyan("Natural language:")} ${text}`);

    if (occurrences.length > 0) {
      logger.info(`\n${chalk.cyan("Next 10 Occurrences:")}`);
      const { formatDistance } = await import("date-fns");
      occurrences.forEach((date: Date, index: number) => {
        const relative = formatDistance(date, new Date(), { addSuffix: true });
        logger.info(`  ${index + 1}. ${date.toLocaleString()} (${relative})`);
      });
    }
  } catch (error: unknown) {
    spinner.fail("Failed to get recurrence info");
    throw error;
  }
}

async function dateUtilities(args: string[]) {
  if (args.length === 0 || args[0] === "help") {
    logger.info(chalk.bold("\nDate Utilities:"));
    logger.info("─".repeat(80));
    logger.info("Format: gwork cal date format <date> [--format <format>]");
    logger.info("Parse: gwork cal date parse <dateString>");
    logger.info("Add: gwork cal date add <date> <amount> <unit>");
    logger.info("Diff: gwork cal date diff <date1> <date2>");
    return;
  }

  const action = args[0];
  const { format: formatDate, addDays, addWeeks, addMonths, differenceInDays, differenceInHours, formatDistance } = await import("date-fns");

  if (action === "format") {
    if (args.length < 2) {
      throw new ArgumentError("Missing date argument", "Usage: gwork cal date format <date> [--format <format>]");
    }

    if (!args[1]) {
      throw new ArgumentError("Missing date argument", "Usage: gwork cal date format <date> [--format <format>]");
    }

    const date = new Date(args[1]);
    let formatStr = "iso";

    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      if (arg === "--format") {
        const value = args[++i];
        if (value) formatStr = value;
      }
    }

    const formatMap: Record<string, string> = {
      iso: date.toISOString(),
      unix: Math.floor(date.getTime() / 1000).toString(),
      natural: formatDate(date, "MMMM d, yyyy 'at' h:mm a"),
      relative: formatDistance(date, new Date(), { addSuffix: true }),
    };

    logger.info(formatMap[formatStr] || date.toISOString());
  } else if (action === "parse") {
    if (args.length < 2 || !args[1]) {
      throw new ArgumentError("Missing date argument", "Usage: gwork cal date parse <dateString>");
    }

    const date = new Date(args[1]);
    logger.info(`Parsed: ${date.toISOString()}`);
    logger.info(`Formatted: ${formatDate(date, "MMMM d, yyyy 'at' h:mm a")}`);
  } else if (action === "add") {
    if (args.length < 4 || !args[1] || !args[2] || !args[3]) {
      throw new ArgumentError("Missing arguments", "Usage: gwork cal date add <date> <amount> <unit>");
    }

    let date = new Date(args[1]);
    const amount = parseInt(args[2], 10);
    const unit = args[3].toLowerCase();

    if (unit === "days" || unit === "day") {
      date = addDays(date, amount);
    } else if (unit === "weeks" || unit === "week") {
      date = addWeeks(date, amount);
    } else if (unit === "months" || unit === "month") {
      date = addMonths(date, amount);
    } else {
      throw new ArgumentError("Invalid unit", "Use: days, weeks, months");
    }

    logger.info(date.toISOString());
  } else if (action === "diff") {
    if (args.length < 3 || !args[1] || !args[2]) {
      throw new ArgumentError("Missing arguments", "Usage: gwork cal date diff <date1> <date2>");
    }

    const date1 = new Date(args[1]);
    const date2 = new Date(args[2]);
    const days = differenceInDays(date2, date1);
    const hours = differenceInHours(date2, date1);

    logger.info(`Difference: ${days} days (${hours} hours)`);
    logger.info(`Relative: ${formatDistance(date2, date1)}`);
  } else {
    throw new ArgumentError("Invalid action", "Use: format, parse, add, diff");
  }
}
