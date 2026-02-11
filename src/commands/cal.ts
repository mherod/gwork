import chalk from "chalk";
import ora from "ora";
import { compact, orderBy, startCase, isEmpty, uniqBy, map } from "lodash-es";
import type { Event } from "../types/google-apis.ts";
import { CalendarService } from "../services/calendar-service.ts";
import { formatEventDate, parseDateRange } from "../utils/format.ts";
import { handleServiceError } from "../utils/command-error-handler.ts";
import { ensureInitialized } from "../utils/command-service.ts";

export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  // Create service instance with the specified account
  const calendarService = new CalendarService(account);

  // Ensure service is initialized (checks credentials) before any command
  await ensureInitialized(calendarService);
  
  switch (subcommand) {
    case "list":
      await listEvents(calendarService, args);
      break;
    case "calendars":
      await listCalendars(calendarService, args);
      break;
    case "get":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal get <calendarId> <eventId>");
        process.exit(1);
      }
      await getEvent(calendarService, args[0], args[1]);
      break;
    case "create":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal create <calendarId> --title <title> --start <datetime>");
        process.exit(1);
      }
      await createEvent(calendarService, args[0], args.slice(1));
      break;
    case "update":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal update <calendarId> <eventId>");
        process.exit(1);
      }
      await updateEvent(calendarService, args[0], args[1], args.slice(2));
      break;
    case "delete":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal delete <calendarId> <eventId> --confirm");
        process.exit(1);
      }
      await deleteEvent(calendarService, args[0], args[1], args.slice(2));
      break;
    case "search": {
      if (args.length === 0 || !args[0]) {
        console.error("Error: search query is required");
        console.error("Usage: gwork cal search <query> [options]");
        process.exit(1);
      }
      // Extract query (first arg) and remaining options
      const searchQuery = args[0];
      const searchExtraArgs = args.slice(1);
      await searchEvents(calendarService, searchQuery, searchExtraArgs);
      break;
    }
    case "freebusy":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: start and end times are required");
        console.error("Usage: gwork cal freebusy <start> <end>");
        process.exit(1);
      }
      await getFreeBusy(calendarService, args[0], args[1], args.slice(2));
      break;
    case "create-calendar":
      if (args.length === 0) {
        console.error("Error: title is required");
        console.error("Usage: gwork cal create-calendar <title>");
        process.exit(1);
      }
      await createCalendar(calendarService, compact(args).join(" "));
      break;
    case "stats":
      await getStats(calendarService, args);
      break;
    case "duplicate":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal duplicate <calendarId> <eventId> [options]");
        process.exit(1);
      }
      await duplicateEvent(calendarService, args[0], args[1], args.slice(2));
      break;
    case "bulk-update":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal bulk-update <calendarId> [options]");
        process.exit(1);
      }
      await bulkUpdateEvents(calendarService, args[0], args.slice(1));
      break;
    case "update-recurring":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal update-recurring <calendarId> <eventId> [options]");
        process.exit(1);
      }
      await updateRecurringEvent(calendarService, args[0], args[1], args.slice(2));
      break;
    case "export":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal export <calendarId> [options]");
        process.exit(1);
      }
      await exportEvents(calendarService, args[0], args.slice(1));
      break;
    case "batch-create":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal batch-create <calendarId> [options]");
        process.exit(1);
      }
      await batchCreateEvents(calendarService, args[0], args.slice(1));
      break;
    case "reminders":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal reminders <calendarId> <eventId> <action> [options]");
        process.exit(1);
      }
      await manageReminders(calendarService, args[0], args[1], args.slice(2));
      break;
    case "check-conflict":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal check-conflict <calendarId> [options]");
        process.exit(1);
      }
      await checkConflict(calendarService, args[0], args.slice(1));
      break;
    case "quick":
      await quickAction(calendarService, args);
      break;
    case "compare":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: two calendarIds are required");
        console.error("Usage: gwork cal compare <calendarId1> <calendarId2> [options]");
        process.exit(1);
      }
      await compareCalendars(calendarService, args[0], args[1], args.slice(2));
      break;
    case "color":
      await manageColor(calendarService, args);
      break;
    case "recurrence":
      await workWithRecurrence(args);
      break;
    case "create-recurring":
      if (args.length === 0 || !args[0]) {
        console.error("Error: calendarId is required");
        console.error("Usage: gwork cal create-recurring <calendarId> [options]");
        process.exit(1);
      }
      await createRecurringEvent(calendarService, args[0], args.slice(1));
      break;
    case "recurrence-info":
      if (args.length < 2 || !args[0] || !args[1]) {
        console.error("Error: calendarId and eventId are required");
        console.error("Usage: gwork cal recurrence-info <calendarId> <eventId>");
        process.exit(1);
      }
      await showRecurrenceInfo(calendarService, args[0], args[1]);
      break;
    case "date":
      await dateUtilities(args);
      break;
    default:
      console.error(`Unknown cal subcommand: ${subcommand}`);
      console.error("Run 'gwork cal --help' for usage information");
      process.exit(1);
  }
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
        if (value) options.max = parseInt(value);
      } else if (arg === "--days") {
        const value = args[++i];
        if (value) options.days = parseInt(value);
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
        spinner.fail("Invalid date range");
        console.error(
          chalk.red(
            "Valid ranges: today, tomorrow, this-week, next-week, this-month, next-month"
          )
        );
        process.exit(1);
      }
    }

    if (options.today) {
      const todayOptions: any = {};
      if (options.query) {
        todayOptions.q = options.query;
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
      console.log(chalk.yellow("No events found"));
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify(events, null, 2));
    } else {
      console.log(chalk.bold("\nEvents:"));
      console.log("─".repeat(80));
      events.forEach((event: any, index: number) => {
        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        const isAllDay = !!event.start?.date;
        const summary = event.summary || "No title";
        const location = event.location || "";
        const attendees = event.attendees?.length || 0;

        console.log(
          `\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(summary)}`
        );
        console.log(
          `   ${chalk.gray("Start:")} ${formatEventDate(start, isAllDay)}`
        );
        if (end && end !== start) {
          const endFormatted = formatEventDate(end, isAllDay);
          if (endFormatted !== formatEventDate(start, isAllDay)) {
            console.log(`   ${chalk.gray("End:")} ${endFormatted}`);
          }
        }
        if (location) {
          console.log(`   ${chalk.gray("Location:")} ${location}`);
        }
        if (attendees > 0) {
          console.log(`   ${chalk.gray("Attendees:")} ${attendees}`);
        }
        if (event.description) {
          const desc =
            event.description.length > 100
              ? event.description.substring(0, 100) + "..."
              : event.description;
          console.log(`   ${chalk.gray("Description:")} ${desc}`);
        }
      });
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch events");
    handleServiceError(error);
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
      console.log(chalk.yellow("No calendars found"));
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify(calendars, null, 2));
    } else {
      console.log(chalk.bold("\nCalendars:"));
      console.log("─".repeat(80));
      calendars.forEach((calendar: any) => {
        const accessRole = calendar.accessRole || "unknown";
        const color =
          accessRole === "owner"
            ? chalk.green
            : accessRole === "writer"
            ? chalk.yellow
            : chalk.gray;

        console.log(`\n${color(calendar.summary || calendar.id)}`);
        console.log(`  ${chalk.gray("ID:")} ${calendar.id}`);
        console.log(`  ${chalk.gray("Access:")} ${accessRole}`);
        if (calendar.description) {
          console.log(
            `  ${chalk.gray("Description:")} ${calendar.description}`
          );
        }
        if (calendar.primary) {
          console.log(`  ${chalk.cyan("(Primary Calendar)")}`);
        }
      });
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch calendars");
    handleServiceError(error);
  }
}

async function getEvent(calendarService: CalendarService, calendarId: string, eventId: string) {
  const spinner = ora("Fetching event details...").start();
  try {
    const event = await calendarService.getEvent(calendarId, eventId);
    spinner.succeed("Event details fetched");

    console.log(chalk.bold("\nEvent Details:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Title:")} ${event.summary || "No title"}`);
    console.log(`${chalk.cyan("ID:")} ${event.id}`);
    console.log(
      `${chalk.cyan("Start:")} ${event.start?.dateTime ?? event.start?.date}`
    );
    console.log(
      `${chalk.cyan("End:")} ${event.end?.dateTime ?? event.end?.date}`
    );
    if (event.location) {
      console.log(`${chalk.cyan("Location:")} ${event.location}`);
    }
    if (event.description) {
      console.log(`${chalk.cyan("Description:")} ${event.description}`);
    }
    if (event.attendees && event.attendees.length > 0) {
      console.log(`\n${chalk.cyan("Attendees:")}`);
      event.attendees.forEach((attendee: any) => {
        const status = attendee.responseStatus || "no-response";
        const statusColor =
          status === "accepted"
            ? chalk.green
            : status === "declined"
            ? chalk.red
            : status === "tentative"
            ? chalk.yellow
            : chalk.gray;
        console.log(`  ${attendee.email} (${statusColor(status)})`);
      });
    }
    if (event.htmlLink) {
      console.log(`\n${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch event details");
    handleServiceError(error);
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
      spinner.fail("Missing required options");
      console.error(
        chalk.red("Required: --title <title> --start <datetime>")
      );
      process.exit(1);
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
        startTime.getTime() + parseInt(options.duration || "60") * 60000
      );
    }

    if (options.allDay) {
      endTime.setHours(23, 59, 59, 999);
    }

    const eventData: any = {
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

    console.log(chalk.green(`\nEvent created:`));
    console.log(`${chalk.cyan("Title:")} ${event.summary}`);
    console.log(`${chalk.cyan("ID:")} ${event.id}`);
    console.log(
      `${chalk.cyan("Start:")} ${event.start?.dateTime ?? event.start?.date}`
    );
    console.log(
      `${chalk.cyan("End:")} ${event.end?.dateTime ?? event.end?.date}`
    );
    if (event.htmlLink) {
      console.log(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create event");
    handleServiceError(error);
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

    console.log(chalk.green(`\nEvent updated:`));
    console.log(`${chalk.cyan("Title:")} ${event.summary}`);
    console.log(`${chalk.cyan("ID:")} ${event.id}`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to update event");
    handleServiceError(error);
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
    console.log(
      chalk.yellow("Please use --confirm flag to confirm this operation")
    );
    process.exit(1);
  }

  const spinner = ora("Deleting event...").start();
  try {
    await calendarService.deleteEvent(calendarId, eventId);
    spinner.succeed("Event deleted successfully");
    console.log(chalk.green("Event has been deleted"));
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to delete event");
    handleServiceError(error);
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
        if (value) options.maxResults = parseInt(value);
      } else if (arg === "-c" || arg === "--calendar") {
        const value = extraArgs[++i];
        if (value) options.calendar = value;
      } else if (arg === "--days") {
        const value = extraArgs[++i];
        if (value) {
          const days = parseInt(value);
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
      console.log(chalk.yellow("No events found"));
      return;
    }

    console.log(chalk.bold(`\nSearch results for: "${query}"`));
    console.log("─".repeat(80));
    events.forEach((event: any, index: number) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const summary = event.summary || "No title";

      console.log(`\n${chalk.bold(`${index + 1}.`)} ${chalk.cyan(summary)}`);
      console.log(`   ${chalk.gray("Start:")} ${start ?? "Unknown"}`);
      if (event.location) {
        console.log(`   ${chalk.gray("Location:")} ${event.location}`);
      }
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Search failed");
    handleServiceError(error);
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

    console.log(chalk.bold("\nFree/Busy Information:"));
    console.log("─".repeat(80));
    console.log(
      `${chalk.cyan("Time Range:")} ${startTime.toISOString()} to ${endTime.toISOString()}`
    );

    Object.entries(freeBusy.calendars || {}).forEach(([calendarId, info]: any) => {
      console.log(`\n${chalk.cyan("Calendar:")} ${calendarId}`);
      if (info.busy && info.busy.length > 0) {
        console.log(chalk.red("Busy times:"));
        info.busy.forEach((busy: any) => {
          const start = new Date(busy.start);
          const end = new Date(busy.end);
          console.log(
            `  ${start.toLocaleString()} - ${end.toLocaleString()}`
          );
        });
      } else {
        console.log(chalk.green("Free during this time"));
      }
    });
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to fetch free/busy information");
    handleServiceError(error);
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

    console.log(chalk.green(`\nCalendar created:`));
    console.log(`${chalk.cyan("Title:")} ${calendar.summary ?? "Unknown"}`);
    console.log(`${chalk.cyan("ID:")} ${calendar.id ?? "Unknown"}`);
    console.log(`${chalk.cyan("Timezone:")} ${calendar.timeZone ?? "Unknown"}`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create calendar");
    handleServiceError(error);
  }
}

async function getStats(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Analyzing calendar...").start();
  try {
    const options: any = {
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
        if (value) options.days = parseInt(value);
      }
    }

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + parseInt(options.days));

    const result = await calendarService.listEvents(options.calendar, {
      maxResults: 2500,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    const events = result.events;

    spinner.succeed(`Analyzed ${events.length} event(s)`);

    const stats: any = {
      total: events.length,
      allDay: 0,
      timed: 0,
      withLocation: 0,
      withAttendees: 0,
      totalDuration: 0,
      byDay: {} as any,
    };

    events.forEach((event: any) => {
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

    console.log(chalk.bold("\nCalendar Statistics:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Total Events:")} ${stats.total}`);
    console.log(`${chalk.cyan("All-day Events:")} ${stats.allDay}`);
    console.log(`${chalk.cyan("Timed Events:")} ${stats.timed}`);
    console.log(
      `${chalk.cyan("Events with Location:")} ${stats.withLocation}`
    );
    console.log(
      `${chalk.cyan("Events with Attendees:")} ${stats.withAttendees}`
    );
    if (stats.timed > 0) {
      console.log(
        `${chalk.cyan("Total Time Scheduled:")} ${hours}h ${minutes}m`
      );
      console.log(
        `${chalk.cyan("Average Event Duration:")} ${Math.floor(stats.totalDuration / stats.timed / (1000 * 60))} minutes`
      );
    }

    if (!isEmpty(stats.byDay)) {
      console.log(`\n${chalk.cyan("Events by Day of Week:")}`);
      const sortedDays = orderBy(
        Object.entries(stats.byDay),
        [([, count]) => count],
        ["desc"]
      );
      sortedDays.forEach(([day, count]) => {
        const countNum = typeof count === "number" ? count : 0;
        const bar = "█".repeat(Math.floor((countNum / stats.total) * 50));
        console.log(
          `  ${day.padEnd(10)} ${countNum.toString().padStart(3)} ${chalk.gray(bar)}`
        );
      });
    }

    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to analyze calendar");
    handleServiceError(error);
  }
}

async function duplicateEvent(calendarService: CalendarService, calendarId: string, eventId: string, args: string[]) {
  const spinner = ora("Duplicating event...").start();
  try {
    const options: any = { toCalendar: calendarId };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--to-calendar") {
        options.toCalendar = args[++i];
      } else if (args[i] === "--start") {
        options.start = args[++i];
      }
    }

    const originalEvent = await calendarService.getEvent(calendarId, eventId);

    // Create new event data from original
    const newEventData: any = {
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

    console.log(chalk.green(`\nEvent duplicated:`));
    console.log(`${chalk.cyan("Title:")} ${newEvent.summary}`);
    console.log(`${chalk.cyan("ID:")} ${newEvent.id}`);
    console.log(
      `${chalk.cyan("Start:")} ${newEvent.start?.dateTime ?? newEvent.start?.date}`
    );
    if (newEvent.htmlLink) {
      console.log(`${chalk.cyan("Link:")} ${newEvent.htmlLink}`);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to duplicate event");
    handleServiceError(error);
  }
}

async function quickAction(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Creating quick event...").start();
  try {
    const options: any = { calendar: "primary" };

    let action = null;
    let value = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--meeting") {
        action = "meeting";
        value = args[++i];
      } else if (args[i] === "--reminder") {
        action = "reminder";
        value = args[++i];
      } else if (args[i] === "--block") {
        action = "block";
        value = args[++i];
      } else if (args[i] === "-c" || args[i] === "--calendar") {
        options.calendar = args[++i];
      }
    }

    if (!action || !value) {
      spinner.fail("Missing action");
      console.error(
        chalk.red("Usage: gwork cal quick --meeting <title> | --reminder <title> | --block <hours>")
      );
      process.exit(1);
    }

    const now = new Date();
    let eventData: any = {};

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
        spinner.fail("Invalid hours");
        console.error(chalk.red("Hours must be a number"));
        process.exit(1);
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

    console.log(chalk.green(`\nEvent created:`));
    console.log(`${chalk.cyan("Title:")} ${event.summary}`);
    console.log(`${chalk.cyan("ID:")} ${event.id}`);
    if (event.htmlLink) {
      console.log(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create quick event");
    handleServiceError(error);
  }
}

async function exportEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Exporting events...").start();
  try {
    const options: any = {
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
      events.forEach((event: any) => {
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

      events.forEach((event: any) => {
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
      spinner.fail("Invalid format");
      console.error(chalk.red("Valid formats: json, csv, ical"));
      process.exit(1);
    }

    if (options.output) {
      const fs = await import("node:fs");
      fs.writeFileSync(options.output, output);
      spinner.succeed(`Exported ${events.length} event(s) to ${options.output}`);
    } else {
      spinner.succeed(`Exported ${events.length} event(s)`);
      console.log(output);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to export events");
    handleServiceError(error);
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
      spinner.fail("Missing action");
      console.error(
        chalk.red("Usage: gwork cal reminders <calendarId> <eventId> <action> [options]")
      );
      console.error("Actions: list, add, remove, clear, default");
      process.exit(1);
    }

    const action = args[0];
    const event = await calendarService.getEvent(calendarId, eventId);

    if (action === "list") {
      spinner.succeed("Reminders fetched");
      const reminders = event.reminders?.overrides || [];
      const useDefault = event.reminders?.useDefault || false;

      console.log(chalk.bold("\nEvent Reminders:"));
      console.log("─".repeat(80));
      if (useDefault) {
        console.log(chalk.cyan("Using default reminders"));
      }
      if (reminders.length === 0 && !useDefault) {
        console.log(chalk.yellow("No reminders set"));
      } else {
        reminders.forEach((reminder: any, index: number) => {
          const method = reminder.method || "popup";
          const minutes = reminder.minutes || 0;
          console.log(
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
          if (value) minutes = parseInt(value);
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
      console.log(chalk.green(`Added reminder: ${minutes} minutes before event`));
    } else if (action === "remove") {
      let index = -1;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === "--index") {
          const value = args[++i];
          if (value) index = parseInt(value) - 1;
        }
      }

      if (index < 0) {
        spinner.fail("Invalid index");
        console.error(chalk.red("Please specify --index <number>"));
        process.exit(1);
      }

      const reminders = event.reminders?.overrides || [];
      if (index >= reminders.length) {
        spinner.fail("Index out of range");
        process.exit(1);
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
      spinner.fail("Invalid action");
      console.error(chalk.red("Valid actions: list, add, remove, clear, default"));
      process.exit(1);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to manage reminders");
    handleServiceError(error);
  }
}

async function bulkUpdateEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Bulk updating events...").start();
  try {
    const options: any = {
      dryRun: false,
      query: null,
    };

    const updates: any = {};

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--query") {
        options.query = args[++i];
      } else if (args[i] === "--title") {
        updates.summary = args[++i];
      } else if (args[i] === "--location") {
        updates.location = args[++i];
      } else if (args[i] === "--description") {
        updates.description = args[++i];
      } else if (args[i] === "--title-pattern") {
        updates.titlePattern = args[++i];
      } else if (args[i] === "--dry-run") {
        options.dryRun = true;
      }
    }

    if (isEmpty(updates)) {
      spinner.fail("No updates specified");
      console.error(chalk.red("Please specify at least one field to update"));
      process.exit(1);
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
      console.log(chalk.yellow("\nDry run - no changes will be made:"));
      events.slice(0, 10).forEach((event: any, index: number) => {
        console.log(`\n${index + 1}. ${event.summary || "No title"}`);
        if (updates.summary) {
          console.log(`   Title: "${event.summary}" -> "${updates.summary}"`);
        }
        if (updates.titlePattern && event.summary) {
          const newTitle = updates.titlePattern.replace(/%s/g, event.summary);
          console.log(`   Title: "${event.summary}" -> "${newTitle}"`);
        }
        if (updates.location) {
          console.log(`   Location: "${event.location || ""}" -> "${updates.location}"`);
        }
        if (updates.description) {
          console.log(`   Description: "${(event.description || "").substring(0, 50)}..." -> "${updates.description.substring(0, 50)}..."`);
        }
      });
      if (events.length > 10) {
        console.log(chalk.gray(`\n... and ${events.length - 10} more events`));
      }
      process.exit(0);
    }

    let updated = 0;
    for (const event of events) {
      const eventUpdates: any = { ...event };

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
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to bulk update events");
    handleServiceError(error);
  }
}

async function batchCreateEvents(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Batch creating events...").start();
  try {
    const options: any = {
      file: null,
      stdin: false,
      template: null,
      dryRun: false,
    };

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--file" || args[i] === "-f") {
        options.file = args[++i];
      } else if (args[i] === "--stdin") {
        options.stdin = true;
      } else if (args[i] === "--template") {
        options.template = args[++i];
      } else if (args[i] === "--dry-run") {
        options.dryRun = true;
      }
    }

    let eventsData: any[] = [];

    if (options.stdin) {
      const fs = await import("node:fs");
      const input = fs.readFileSync(0, "utf8");
      eventsData = JSON.parse(input);
    } else if (options.file) {
      const fs = await import("node:fs");
      const fileContent = fs.readFileSync(options.file, "utf8");
      eventsData = JSON.parse(fileContent);
    } else {
      spinner.fail("No input specified");
      console.error(chalk.red("Please specify --file <path> or --stdin"));
      process.exit(1);
    }

    if (!Array.isArray(eventsData)) {
      spinner.fail("Invalid input format");
      console.error(chalk.red("Input must be a JSON array of event objects"));
      process.exit(1);
    }

    if (options.template) {
      // Apply template
      eventsData = eventsData.map((event: any) => {
        const templateEvent: any = { ...event };
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
          const date = event.date || new Date().toISOString().split("T")[0];
          templateEvent.start = { date };
          const nextDay = new Date(date);
          nextDay.setDate(nextDay.getDate() + 1);
          templateEvent.end = { date: nextDay.toISOString().split("T")[0] };
        }
        return templateEvent;
      });
    }

    spinner.succeed(`Loaded ${eventsData.length} event(s)`);

    if (options.dryRun) {
      console.log(chalk.yellow("\nDry run - events that would be created:"));
      eventsData.slice(0, 10).forEach((event: any, index: number) => {
        console.log(`\n${index + 1}. ${event.summary || "No title"}`);
        console.log(`   Start: ${event.start?.dateTime ?? event.start?.date ?? "N/A"}`);
        if (event.location) {
          console.log(`   Location: ${event.location}`);
        }
      });
      if (eventsData.length > 10) {
        console.log(chalk.gray(`\n... and ${eventsData.length - 10} more events`));
      }
      process.exit(0);
    }

    let created = 0;
    for (const eventData of eventsData) {
      try {
        await calendarService.createEvent(calendarId, eventData);
        created++;
      } catch (_error: unknown) {
        console.error(chalk.red(`Failed to create event: ${eventData.summary || "Unknown"}`));
        // Continue with other events even if one fails
      }
    }

    spinner.succeed(`Created ${created} event(s)`);
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to batch create events");
    handleServiceError(error);
  }
}

async function checkConflict(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Checking for conflicts...").start();
  try {
    const options: any = {
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
        if (value) options.duration = parseInt(value);
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

    console.log(chalk.bold("\nConflict Check:"));
    console.log("─".repeat(80));
    console.log(
      `${chalk.cyan("Time Range:")} ${startTime.toLocaleString()} to ${endTime.toLocaleString()}`
    );

    let hasConflicts = false;
    Object.entries(freeBusy.calendars || {}).forEach(([calId, info]: any) => {
      if (info.busy && info.busy.length > 0) {
        hasConflicts = true;
        console.log(`\n${chalk.red("Conflicts in:")} ${calId}`);
        info.busy.forEach((busy: any) => {
          const start = new Date(busy.start);
          const end = new Date(busy.end);
          console.log(
            `  ${chalk.yellow(start.toLocaleString())} - ${chalk.yellow(end.toLocaleString())}`
          );
        });
      } else {
        console.log(`\n${chalk.green("Free in:")} ${calId}`);
      }
    });

    if (!hasConflicts) {
      console.log(chalk.green("\n✓ No conflicts found - time slot is available"));
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to check conflicts");
    handleServiceError(error);
  }
}

async function compareCalendars(calendarService: CalendarService, calendarId1: string, calendarId2: string, args: string[]) {
  const spinner = ora("Comparing calendars...").start();
  try {
    const options: any = {
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
    const overlapping: Overlap[] = [];
    events1.forEach((e1) => {
      const start1 = e1.start?.dateTime ?? e1.start?.date;
      const end1 = e1.end?.dateTime ?? e1.end?.date;
      events2.forEach((e2) => {
        const start2 = e2.start?.dateTime ?? e2.start?.date;
        const end2 = e2.end?.dateTime ?? e2.end?.date;
        if (start1 && start2 && end1 && end2) {
          const s1 = new Date(start1).getTime();
          const e1Time = new Date(end1).getTime();
          const s2 = new Date(start2).getTime();
          const e2Time = new Date(end2).getTime();
          if ((s1 < e2Time && s2 < e1Time)) {
            overlapping.push({ event1: e1, event2: e2 });
          }
        }
      });
    });

    if (options.format === "json") {
      console.log(
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
      console.log(chalk.bold("\nCalendar Comparison:"));
      console.log("─".repeat(80));
      console.log(`${chalk.cyan("Calendar 1:")} ${calendarId1} - ${events1.length} events`);
      console.log(`${chalk.cyan("Calendar 2:")} ${calendarId2} - ${events2.length} events`);
      console.log(`${chalk.cyan("Overlapping:")} ${overlapping.length} events`);

      if (unique1.length > 0) {
        console.log(`\n${chalk.yellow(`Unique to ${calendarId1}:`)} ${unique1.length} events`);
        unique1.slice(0, 5).forEach((event) => {
          console.log(`  - ${event.summary || "No title"}`);
        });
        if (unique1.length > 5) {
          console.log(chalk.gray(`  ... and ${unique1.length - 5} more`));
        }
      }

      if (unique2.length > 0) {
        console.log(`\n${chalk.yellow(`Unique to ${calendarId2}:`)} ${unique2.length} events`);
        unique2.slice(0, 5).forEach((event) => {
          console.log(`  - ${event.summary || "No title"}`);
        });
        if (unique2.length > 5) {
          console.log(chalk.gray(`  ... and ${unique2.length - 5} more`));
        }
      }

      if (overlapping.length > 0) {
        console.log(`\n${chalk.red("Overlapping events:")}`);
        overlapping.slice(0, 5).forEach((overlap) => {
          console.log(
            `  ${overlap.event1.summary || "No title"} <-> ${overlap.event2.summary || "No title"}`
          );
        });
        if (overlapping.length > 5) {
          console.log(chalk.gray(`  ... and ${overlapping.length - 5} more`));
        }
      }
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to compare calendars");
    handleServiceError(error);
  }
}

async function updateRecurringEvent(calendarService: CalendarService, calendarId: string, eventId: string, args: string[]) {
  const spinner = ora("Updating recurring event...").start();
  try {
    const options: any = {
      dryRun: false,
      allInstances: false,
    };

    const updates: any = {};

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
      spinner.fail("No updates specified");
      console.error(chalk.red("Please specify at least one field to update"));
      process.exit(1);
    }

    const originalEvent = await calendarService.getEvent(calendarId, eventId);

    if (!originalEvent.recurrence || originalEvent.recurrence.length === 0) {
      spinner.fail("Event is not recurring");
      console.error(chalk.red("This event does not have recurrence rules"));
      process.exit(1);
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

    const recurringInstances = instances.filter((e: any) => {
      return e.recurringEventId === eventId || e.id === eventId;
    });

    spinner.succeed(`Found ${recurringInstances.length} instance(s)`);

    if (options.dryRun) {
      console.log(chalk.yellow("\nDry run - instances that would be updated:"));
      recurringInstances.slice(0, 10).forEach((instance: any, index: number) => {
        console.log(`\n${index + 1}. ${instance.summary || "No title"}`);
        console.log(`   Start: ${instance.start?.dateTime ?? instance.start?.date}`);
        if (updates.summary) {
          console.log(`   Title: "${instance.summary}" -> "${updates.summary}"`);
        }
        if (updates.location) {
          console.log(`   Location: "${instance.location || ""}" -> "${updates.location}"`);
        }
      });
      if (recurringInstances.length > 10) {
        console.log(chalk.gray(`\n... and ${recurringInstances.length - 10} more instances`));
      }
      process.exit(0);
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
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to update recurring event");
    handleServiceError(error);
  }
}

async function manageColor(calendarService: CalendarService, args: string[]) {
  const spinner = ora("Managing colors...").start();
  try {
    const colorMap: any = {
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
      console.log(chalk.bold("\nGoogle Calendar Colors:"));
      console.log("─".repeat(80));
      Object.entries(colorMap).forEach(([id, name]) => {
        const nameStr = typeof name === "string" ? name : String(name);
        console.log(`  ${id.toString().padStart(2)}. ${startCase(nameStr)}`);
      });
      process.exit(0);
    }

    if (args.length < 3) {
      spinner.fail("Missing parameters");
      console.error(chalk.red("Usage: gwork cal color set <calendarId> <eventId> <colorId>"));
      process.exit(1);
    }

    if (args[0] === "set") {
      if (!args[1] || !args[2] || !args[3]) {
        spinner.fail("Missing parameters");
        console.error(chalk.red("Usage: gwork cal color set <calendarId> <eventId> <colorId>"));
        process.exit(1);
      }
      const calendarId = args[1];
      const eventId = args[2];
      const colorId = parseInt(args[3]);

      if (isNaN(colorId) || colorId < 1 || colorId > 11) {
        spinner.fail("Invalid color ID");
        console.error(chalk.red("Color ID must be between 1 and 11"));
        process.exit(1);
      }

      const event = await calendarService.getEvent(calendarId, eventId);
      await calendarService.updateEvent(calendarId, eventId, {
        ...event,
        colorId: colorId.toString(),
      });

      spinner.succeed("Color updated");
      console.log(
        chalk.green(`Event color set to: ${startCase(colorMap[colorId] ?? "Unknown")} (${colorId})`)
      );
      process.exit(0);
    } else {
      spinner.fail("Invalid action");
      console.error(chalk.red("Valid actions: list, set"));
      process.exit(1);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to manage color");
    handleServiceError(error);
  }
}

async function workWithRecurrence(args: string[]) {
  const spinner = ora("Working with recurrence...").start();
  try {
    if (args.length === 0 || args[0] === "help") {
      console.log(chalk.bold("\nRecurrence Utilities:"));
      console.log("─".repeat(80));
      console.log("Parse RRULE: gwork cal recurrence parse <rrule>");
      console.log("Show occurrences: gwork cal recurrence occurrences <rrule> [--count N]");
      process.exit(0);
    }

    const action = args[0];

    if (action === "parse") {
      if (args.length < 2 || !args[1]) {
        spinner.fail("Missing RRULE");
        console.error(chalk.red("Usage: gwork cal recurrence parse <rrule>"));
        process.exit(1);
      }

      const { RRule } = await import("rrule");
      const rrule = RRule.fromString(args[1]);
      const text = rrule.toText();
      spinner.succeed("RRULE parsed");
      console.log(chalk.cyan(`Natural language: ${text}`));
      console.log(chalk.gray(`RRULE: ${args[1]}`));
    } else if (action === "occurrences") {
      if (args.length < 2) {
        spinner.fail("Missing RRULE");
        console.error(chalk.red("Usage: gwork cal recurrence occurrences <rrule> [--count N]"));
        process.exit(1);
      }

      let count = 10;
      for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === "--count") {
          const value = args[++i];
          if (value) count = parseInt(value);
        }
      }

      const { RRule } = await import("rrule");
      const rruleString = args[1];
      if (!rruleString) {
        spinner.fail("Missing RRULE");
        process.exit(1);
      }
      const rrule = RRule.fromString(rruleString);
      const occurrences = rrule.all().slice(0, count);

      spinner.succeed(`Found ${occurrences.length} occurrence(s)`);
      console.log(chalk.bold("\nNext Occurrences:"));
      occurrences.forEach((date: Date, index: number) => {
        console.log(`  ${index + 1}. ${date.toLocaleString()}`);
      });
    } else {
      spinner.fail("Invalid action");
      console.error(chalk.red("Valid actions: parse, occurrences"));
      process.exit(1);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to work with recurrence");
    handleServiceError(error);
  }
}

async function createRecurringEvent(calendarService: CalendarService, calendarId: string, args: string[]) {
  const spinner = ora("Creating recurring event...").start();
  try {
    const options: any = {};

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
      } else if (args[i] === "--rrule") {
        options.rrule = args[++i]!;
      } else if (args[i] === "--frequency") {
        options.frequency = args[++i]!;
      } else if (args[i] === "--count") {
        options.count = parseInt(args[++i]!);
      } else if (args[i] === "--until") {
        options.until = args[++i]!;
      }
    }

    if (!options.title || !options.start) {
      spinner.fail("Missing required options");
      console.error(chalk.red("Required: --title <title> --start <datetime>"));
      process.exit(1);
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
        spinner.fail("Invalid frequency");
        const validFrequencies = Object.keys(freqMap).map(f => startCase(f)).join(", ");
        console.error(chalk.red(`Valid frequencies: ${validFrequencies}`));
        process.exit(1);
      }

      const rrule = new RRule({
        freq,
        dtstart: new Date(options.start),
        count: options.count,
        until: options.until ? new Date(options.until) : undefined,
      });
      rruleString = rrule.toString();
    } else {
      spinner.fail("Missing recurrence rule");
      console.error(chalk.red("Please specify --rrule or --frequency"));
      process.exit(1);
    }

    const startTime = new Date(options.start);
    let endTime;
    if (options.end) {
      endTime = new Date(options.end);
    } else {
      endTime = new Date(
        startTime.getTime() + parseInt(options.duration || "60") * 60000
      );
    }

    const eventData: any = {
      summary: options.title,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      recurrence: [rruleString],
    };

    if (options.location) eventData.location = options.location;
    if (options.description) eventData.description = options.description;

    const event = await calendarService.createEvent(calendarId, eventData);
    spinner.succeed("Recurring event created");

    console.log(chalk.green(`\nRecurring event created:`));
    console.log(`${chalk.cyan("Title:")} ${event.summary}`);
    console.log(`${chalk.cyan("ID:")} ${event.id}`);
    console.log(`${chalk.cyan("RRULE:")} ${rruleString}`);
    if (event.htmlLink) {
      console.log(`${chalk.cyan("Link:")} ${event.htmlLink}`);
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to create recurring event");
    handleServiceError(error);
  }
}

async function showRecurrenceInfo(calendarService: CalendarService, calendarId: string, eventId: string) {
  const spinner = ora("Fetching recurrence info...").start();
  try {
    const event = await calendarService.getEvent(calendarId, eventId);

    if (!event.recurrence || event.recurrence.length === 0) {
      spinner.succeed("Event is not recurring");
      console.log(chalk.yellow("This event does not have recurrence rules"));
      process.exit(0);
    }

    const rruleString = event.recurrence.find((r: string) => r.startsWith("RRULE:"))?.substring(6) || event.recurrence[0];
    
    if (!rruleString) {
      spinner.fail("No recurrence rule found");
      process.exit(1);
    }

    const { RRule } = await import("rrule");
    const rrule = RRule.fromString(rruleString);
    const text = rrule.toText();
    const occurrences = rrule.all().slice(0, 10);

    spinner.succeed("Recurrence info fetched");

    console.log(chalk.bold("\nRecurrence Information:"));
    console.log("─".repeat(80));
    console.log(`${chalk.cyan("Event:")} ${event.summary || "No title"}`);
    console.log(`${chalk.cyan("RRULE:")} ${rruleString}`);
    console.log(`${chalk.cyan("Natural language:")} ${text}`);

    if (occurrences.length > 0) {
      console.log(`\n${chalk.cyan("Next 10 Occurrences:")}`);
      const { formatDistance } = await import("date-fns");
      occurrences.forEach((date: Date, index: number) => {
        const relative = formatDistance(date, new Date(), { addSuffix: true });
        console.log(`  ${index + 1}. ${date.toLocaleString()} (${relative})`);
      });
    }
    process.exit(0);
  } catch (error: unknown) {
    spinner.fail("Failed to get recurrence info");
    handleServiceError(error);
  }
}

async function dateUtilities(args: string[]) {
  try {
    if (args.length === 0 || args[0] === "help") {
      console.log(chalk.bold("\nDate Utilities:"));
      console.log("─".repeat(80));
      console.log("Format: gwork cal date format <date> [--format <format>]");
      console.log("Parse: gwork cal date parse <dateString>");
      console.log("Add: gwork cal date add <date> <amount> <unit>");
      console.log("Diff: gwork cal date diff <date1> <date2>");
      process.exit(0);
    }

    const action = args[0];
    const { format: formatDate, addDays, addWeeks, addMonths, differenceInDays, differenceInHours, formatDistance } = await import("date-fns");

    if (action === "format") {
      if (args.length < 2) {
        console.error(chalk.red("Usage: gwork cal date format <date> [--format <format>]"));
        process.exit(1);
      }

      if (!args[1]) {
        console.error(chalk.red("Usage: gwork cal date format <date> [--format <format>]"));
        process.exit(1);
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

      const formatMap: any = {
        iso: date.toISOString(),
        unix: Math.floor(date.getTime() / 1000).toString(),
        natural: formatDate(date, "MMMM d, yyyy 'at' h:mm a"),
        relative: formatDistance(date, new Date(), { addSuffix: true }),
      };

      console.log(formatMap[formatStr] || date.toISOString());
    } else if (action === "parse") {
      if (args.length < 2 || !args[1]) {
        console.error(chalk.red("Usage: gwork cal date parse <dateString>"));
        process.exit(1);
      }

      const date = new Date(args[1]);
      console.log(`Parsed: ${date.toISOString()}`);
      console.log(`Formatted: ${formatDate(date, "MMMM d, yyyy 'at' h:mm a")}`);
    } else if (action === "add") {
      if (args.length < 4 || !args[1] || !args[2] || !args[3]) {
        console.error(chalk.red("Usage: gwork cal date add <date> <amount> <unit>"));
        process.exit(1);
      }

      let date = new Date(args[1]);
      const amount = parseInt(args[2]);
      const unit = args[3].toLowerCase();

      if (unit === "days" || unit === "day") {
        date = addDays(date, amount);
      } else if (unit === "weeks" || unit === "week") {
        date = addWeeks(date, amount);
      } else if (unit === "months" || unit === "month") {
        date = addMonths(date, amount);
      } else {
        console.error(chalk.red("Invalid unit. Use: days, weeks, months"));
        process.exit(1);
      }

      console.log(date.toISOString());
    } else if (action === "diff") {
      if (args.length < 3 || !args[1] || !args[2]) {
        console.error(chalk.red("Usage: gwork cal date diff <date1> <date2>"));
        process.exit(1);
      }

      const date1 = new Date(args[1]);
      const date2 = new Date(args[2]);
      const days = differenceInDays(date2, date1);
      const hours = differenceInHours(date2, date1);

      console.log(`Difference: ${days} days (${hours} hours)`);
      console.log(`Relative: ${formatDistance(date2, date1)}`);
    } else {
      console.error(chalk.red("Invalid action. Use: format, parse, add, diff"));
      process.exit(1);
    }
    process.exit(0);
  } catch (error: unknown) {
    handleServiceError(error);
  }
}
