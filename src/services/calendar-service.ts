/**
 * Google Calendar API service wrapper.
 * Provides methods for managing calendars, events, free/busy queries, and convenience date methods.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import { withRetry } from "./retry.ts";
import {
  validateResourceId,
  validateMaxResults,
  validateDateString,
} from "./validators.ts";
import type {
  CalendarClient,
  Event,
  CalendarListEntry,
  Calendar as CalendarType,
  FreeBusyResponse,
  ListEventsOptions,
  SearchEventsOptions,
} from "../types/google-apis.ts";
import type { calendar_v3 } from "googleapis";

export interface EventsResponse {
  events: Event[];
  nextPageToken?: string | null;
}

export class CalendarService extends BaseService {
  private calendar: CalendarClient | null = null;

  constructor(account: string = "default") {
    super(
      "Calendar",
      [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar",
      ],
      account
    );
  }

  /**
   * Initialize the service: authenticate and set up Calendar API client.
   * Overrides BaseService.initialize() to initialize the calendar client.
   *
   * @throws {InitializationError} If credentials missing or authentication fails
   */
  async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    // Initialize Calendar API client
    this.calendar = google.calendar({ version: "v3", auth: this.auth });
  }

  // ============= EVENT OPERATIONS =============

  /**
   * Lists events from a calendar with optional filtering and pagination.
   *
   * @param calendarId - Calendar ID (default: "primary")
   * @param options - Optional parameters
   * @param options.maxResults - Maximum events to return (1-2500, default: 10)
   * @param options.timeMin - Start time (ISO 8601, default: now)
   * @param options.timeMax - End time (ISO 8601, optional)
   * @param options.singleEvents - Expand recurring events (default: true)
   * @param options.orderBy - Sort order: "startTime" (default) or "updated"
   * @param options.q - Search query string
   * @param options.pageToken - Token for fetching next page
   *
   * @returns Object with events array and pagination metadata
   * @throws {NotFoundError} If calendar not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If parameters are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const cal = new CalendarService();
   * await cal.initialize();
   *
   * // Get upcoming events
   * const { events, nextPageToken } = await cal.listEvents("primary", {
   *   maxResults: 25,
   *   timeMin: new Date().toISOString()
   * });
   *
   * // Fetch next page
   * if (nextPageToken) {
   *   const nextPage = await cal.listEvents("primary", { pageToken: nextPageToken });
   * }
   * ```
   */
  async listEvents(
    calendarId = "primary",
    options: ListEventsOptions = {}
  ): Promise<EventsResponse> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    const {
      maxResults = 10,
      timeMin = new Date().toISOString(),
      timeMax = null,
      singleEvents = true,
      orderBy = "startTime",
      q = null,
      pageToken = null,
    } = options;

    // Validate inputs
    if (maxResults > 0) {
      validateMaxResults(maxResults, 2500);
    }
    if (timeMin) {
      validateDateString(timeMin, "timeMin");
    }
    if (timeMax) {
      validateDateString(timeMax, "timeMax");
    }

    const params: {
      calendarId: string;
      timeMin: string;
      maxResults: number;
      singleEvents: boolean;
      orderBy: "startTime" | "updated";
      timeMax?: string;
      q?: string;
      pageToken?: string;
    } = {
      calendarId,
      timeMin,
      maxResults,
      singleEvents,
      orderBy,
    };

    if (timeMax !== null && timeMax !== undefined) params.timeMax = timeMax;
    if (q !== null && q !== undefined) params.q = q;
    if (pageToken !== null && pageToken !== undefined) params.pageToken = pageToken;

    try {
      return await withRetry(
        async () => {
          const result = await this.calendar!.events.list(params);
          return {
            events: result.data.items || [],
            nextPageToken: result.data.nextPageToken || null,
          };
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "list events");
    }
  }

  /**
   * Gets a single event by ID.
   *
   * @param calendarId - Calendar ID containing the event
   * @param eventId - Event ID to retrieve
   * @returns Event object with full details
   * @throws {NotFoundError} If event or calendar not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If IDs are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const event = await cal.getEvent("primary", "abc123xyz");
   * ```
   */
  async getEvent(calendarId: string, eventId: string): Promise<Event> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");
    validateResourceId(eventId, "eventId");

    try {
      const result = await this.calendar!.events.get({
        calendarId,
        eventId,
      });

      if (!result.data) {
        throw new Error("No event data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get event");
    }
  }

  /**
   * Creates a new event.
   *
   * @param calendarId - Calendar ID to create event in
   * @param eventData - Event properties (summary, start, end, etc.)
   * @returns Created Event object
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If calendarId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const event = await cal.createEvent("primary", {
   *   summary: "Team Meeting",
   *   start: { dateTime: "2024-01-15T10:00:00Z" },
   *   end: { dateTime: "2024-01-15T11:00:00Z" }
   * });
   * ```
   */
  async createEvent(calendarId: string, eventData: Partial<Event>): Promise<Event> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    try {
      const result = await this.calendar!.events.insert({
        calendarId,
        requestBody: eventData as calendar_v3.Schema$Event,
      });

      if (!result.data) {
        throw new Error("No event data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "create event");
    }
  }

  /**
   * Updates an existing event.
   *
   * @param calendarId - Calendar ID containing the event
   * @param eventId - Event ID to update
   * @param eventData - Updated event properties
   * @returns Updated Event object
   * @throws {NotFoundError} If event not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If IDs are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const updated = await cal.updateEvent("primary", "abc123", {
   *   summary: "Updated Meeting Title"
   * });
   * ```
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    eventData: Partial<Event>
  ): Promise<Event> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");
    validateResourceId(eventId, "eventId");

    try {
      const result = await this.calendar!.events.update({
        calendarId,
        eventId,
        requestBody: eventData as calendar_v3.Schema$Event,
      });

      if (!result.data) {
        throw new Error("No event data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "update event");
    }
  }

  /**
   * Deletes an event.
   *
   * @param calendarId - Calendar ID containing the event
   * @param eventId - Event ID to delete
   * @returns Success indicator
   * @throws {NotFoundError} If event not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If IDs are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await cal.deleteEvent("primary", "abc123");
   * ```
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");
    validateResourceId(eventId, "eventId");

    try {
      await this.calendar!.events.delete({
        calendarId,
        eventId,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete event");
    }
  }

  /**
   * Searches for events matching a query string.
   *
   * @param query - Search query (searches summary, description, etc.)
   * @param calendarId - Calendar ID to search (default: "primary")
   * @param options - Optional parameters
   * @param options.maxResults - Max results to return (default: 10)
   * @param options.timeMin - Start time (ISO 8601, default: now)
   * @param options.timeMax - End time (ISO 8601, optional)
   *
   * @returns Array of matching Event objects
   * @throws {NotFoundError} If calendar not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If parameters are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const results = await cal.searchEvents("meeting", "primary", {
   *   maxResults: 20,
   *   timeMin: new Date().toISOString()
   * });
   * ```
   */
  async searchEvents(
    query: string,
    calendarId = "primary",
    options: SearchEventsOptions = {}
  ): Promise<Event[]> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    const {
      maxResults = 10,
      timeMin = new Date().toISOString(),
      timeMax = null,
    } = options;

    // Validate inputs
    if (maxResults > 0) {
      validateMaxResults(maxResults, 2500);
    }
    if (timeMin) {
      validateDateString(timeMin, "timeMin");
    }
    if (timeMax) {
      validateDateString(timeMax, "timeMax");
    }

    const params: {
      calendarId: string;
      q: string;
      maxResults: number;
      timeMin: string;
      singleEvents: boolean;
      orderBy: "startTime";
      timeMax?: string;
    } = {
      calendarId,
      q: query,
      maxResults,
      timeMin,
      singleEvents: true,
      orderBy: "startTime",
    };

    if (timeMax !== null && timeMax !== undefined) params.timeMax = timeMax;

    try {
      return await withRetry(
        async () => {
          const result = await this.calendar!.events.list(params);
          return result.data.items || [];
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "search events");
    }
  }

  /**
   * Gets events for the next N days.
   *
   * @param days - Number of days ahead (default: 7)
   * @param calendarId - Calendar ID (default: "primary")
   * @returns Array of upcoming Event objects
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * // Get next 7 days
   * const upcoming = await cal.getUpcomingEvents(7);
   *
   * // Get next 30 days
   * const month = await cal.getUpcomingEvents(30);
   * ```
   */
  async getUpcomingEvents(days = 7, calendarId = "primary"): Promise<Event[]> {
    await this.initialize();
    this.ensureInitialized();

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + days);

    const result = await this.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
    });

    return result.events;
  }

  /**
   * Gets all events for today.
   *
   * @param calendarId - Calendar ID (default: "primary")
   * @returns Array of today's Event objects
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const today = await cal.getTodayEvents();
   * console.log(`You have ${today.length} events today`);
   * ```
   */
  async getTodayEvents(calendarId = "primary"): Promise<Event[]> {
    await this.initialize();
    this.ensureInitialized();

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

    const result = await this.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
    });

    return result.events;
  }

  // ============= CALENDAR OPERATIONS =============

  /**
   * Lists all calendars the user has access to.
   *
   * @returns Array of CalendarListEntry objects
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const calendars = await cal.listCalendars();
   * calendars.forEach(c => console.log(c.summary));
   * ```
   */
  async listCalendars(): Promise<CalendarListEntry[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.calendar!.calendarList.list();
      return result.data.items || [];
    } catch (error: unknown) {
      handleGoogleApiError(error, "list calendars");
    }
  }

  /**
   * Gets a single calendar by ID.
   *
   * @param calendarId - Calendar ID to retrieve
   * @returns Calendar object with full details
   * @throws {NotFoundError} If calendar not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If calendarId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const calendar = await cal.getCalendar("primary");
   * ```
   */
  async getCalendar(calendarId: string): Promise<CalendarType> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    try {
      const result = await this.calendar!.calendars.get({
        calendarId,
      });

      if (!result.data) {
        throw new Error("No calendar data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get calendar");
    }
  }

  /**
   * Creates a new calendar.
   *
   * @param calendarData - Calendar properties (summary, description, timeZone, etc.)
   * @returns Created Calendar object
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const calendar = await cal.createCalendar({
   *   summary: "Work Calendar",
   *   timeZone: "America/New_York"
   * });
   * ```
   */
  async createCalendar(calendarData: Partial<CalendarType>): Promise<CalendarType> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.calendar!.calendars.insert({
        requestBody: calendarData as calendar_v3.Schema$Calendar,
      });

      if (!result.data) {
        throw new Error("No calendar data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "create calendar");
    }
  }

  /**
   * Updates an existing calendar.
   *
   * @param calendarId - Calendar ID to update
   * @param calendarData - Updated calendar properties
   * @returns Updated Calendar object
   * @throws {NotFoundError} If calendar not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If calendarId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const updated = await cal.updateCalendar("abc123", {
   *   summary: "Updated Calendar Name"
   * });
   * ```
   */
  async updateCalendar(
    calendarId: string,
    calendarData: Partial<CalendarType>
  ): Promise<CalendarType> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    try {
      const result = await this.calendar!.calendars.update({
        calendarId,
        requestBody: calendarData as calendar_v3.Schema$Calendar,
      });

      if (!result.data) {
        throw new Error("No calendar data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "update calendar");
    }
  }

  /**
   * Deletes a calendar.
   *
   * @param calendarId - Calendar ID to delete
   * @returns Success indicator
   * @throws {NotFoundError} If calendar not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If calendarId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await cal.deleteCalendar("abc123");
   * ```
   */
  async deleteCalendar(calendarId: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(calendarId, "calendarId");

    try {
      await this.calendar!.calendars.delete({
        calendarId,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete calendar");
    }
  }

  // ============= FREE/BUSY OPERATIONS =============

  /**
   * Queries free/busy status for one or more calendars.
   *
   * @param timeMin - Start time for query
   * @param timeMax - End time for query
   * @param calendarIds - Array of calendar IDs to check (default: ["primary"])
   * @returns FreeBusyResponse with busy time slots
   * @throws {ValidationError} If dates or calendar IDs are invalid
   * @throws {PermissionDeniedError} If user lacks access to any calendar
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const timeMin = new Date("2024-01-15T09:00:00Z");
   * const timeMax = new Date("2024-01-15T17:00:00Z");
   * const freebusy = await cal.getFreeBusy(timeMin, timeMax, ["primary"]);
   *
   * // Check if a specific time slot is free
   * const calendars = freebusy.calendars || {};
   * const primaryBusy = calendars["primary"]?.busy || [];
   * ```
   */
  async getFreeBusy(
    timeMin: Date,
    timeMax: Date,
    calendarIds: string[] = ["primary"]
  ): Promise<FreeBusyResponse> {
    await this.initialize();
    this.ensureInitialized();

    // Validate inputs
    if (timeMin >= timeMax) {
      throw new Error("timeMin must be before timeMax");
    }
    if (calendarIds.length === 0) {
      throw new Error("At least one calendar ID is required");
    }
    calendarIds.forEach((id) => validateResourceId(id, "calendarId"));

    try {
      const result = await this.calendar!.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: calendarIds.map((id) => ({ id })),
        },
      });

      if (!result.data) {
        throw new Error("No freebusy data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "query free/busy");
    }
  }
}
