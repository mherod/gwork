import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { TokenStore } from "./token-store.ts";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import type {
  CalendarClient,
  AuthClient,
  Event,
  CalendarListEntry,
  Calendar as CalendarType,
  FreeBusyResponse,
  ListEventsOptions,
  SearchEventsOptions,
} from "../types/google-apis.ts";

export class CalendarService {
  private calendar: CalendarClient | null = null;
  private auth: AuthClient | null = null;
  private readonly SCOPES: string[];
  private tokenStore: TokenStore;
  private account: string;

  constructor(account: string = "default") {
    this.account = account;
    this.tokenStore = TokenStore.getInstance();
    this.SCOPES = [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
    ];
  }

  async initialize() {
    if (this.calendar) return;

    const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");

    // Check if credentials file exists and show setup guide if not
    if (!ensureCredentialsExist()) {
      process.exit(1);
    }

    // Try to load existing token first
    let auth = await this.loadSavedAuthIfExist();

    if (!auth) {
      // If no saved token, authenticate and save it
      try {
        auth = await authenticate({
          scopes: this.SCOPES,
          keyfilePath: CREDENTIALS_PATH,
        });
        await this.saveAuth(auth);
      } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          console.error("\n❌ Error: Credentials file not found at " + CREDENTIALS_PATH);
          ensureCredentialsExist();
          process.exit(1);
        }
        throw error;
      }
    }

    this.auth = auth;
    this.calendar = google.calendar({ version: "v3", auth: this.auth });
  }

  private async loadSavedAuthIfExist() {
    try {
      const token = this.tokenStore.getToken("calendar", this.account);

      if (!token) {
        return null;
      }

      // Check if token has the required scopes
      const hasRequiredScopes = this.SCOPES.every((scope) =>
        token.scopes.includes(scope)
      );

      if (!hasRequiredScopes) {
        console.log(
          "Token has incorrect scopes. Deleting token to re-authenticate..."
        );
        this.tokenStore.deleteToken("calendar", this.account);
        return null;
      }

      // Load credentials to get client_id and client_secret
      const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");
      const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, "utf8");
      const credentials = JSON.parse(credentialsContent);
      const clientConfig = credentials.installed || credentials.web;

      // Create auth object with client credentials
      const auth = new google.auth.OAuth2(
        clientConfig.client_id,
        clientConfig.client_secret,
        clientConfig.redirect_uris?.[0] || "http://localhost"
      );
      auth.setCredentials({
        refresh_token: token.refresh_token,
        access_token: token.access_token,
        expiry_date: token.expiry_date,
      });

      // Test if the token is still valid by making a simple request
      try {
        await auth.getAccessToken();
        console.log(`Using saved Calendar token (account: ${this.account})`);
        return auth;
      } catch (error) {
        // Token is expired or invalid, remove it
        console.log("Saved token is invalid. Re-authenticating...");
        this.tokenStore.deleteToken("calendar", this.account);
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to load saved token:", message);
      this.tokenStore.deleteToken("calendar", this.account);
    }
    return null;
  }

  private async saveAuth(auth: AuthClient) {
    try {
      this.tokenStore.saveToken({
        service: "calendar",
        account: this.account,
        access_token: auth.credentials.access_token,
        refresh_token: auth.credentials.refresh_token,
        expiry_date: auth.credentials.expiry_date,
        scopes: this.SCOPES,
      });
      console.log(`Calendar token saved (account: ${this.account})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to save token:", message);
    }
  }

  async listEvents(calendarId = "primary", options: ListEventsOptions = {}): Promise<Event[]> {
    await this.initialize();

    const {
      maxResults = 10,
      timeMin = new Date().toISOString(),
      timeMax = null,
      singleEvents = true,
      orderBy = "startTime",
      q = null,
    } = options;

    const params: {
      calendarId: string;
      timeMin: string;
      maxResults: number;
      singleEvents: boolean;
      orderBy: "startTime" | "updated";
      timeMax?: string;
      q?: string;
    } = {
      calendarId,
      timeMin,
      maxResults,
      singleEvents,
      orderBy,
    };

    if (timeMax !== null && timeMax !== undefined) params.timeMax = timeMax;
    if (q !== null && q !== undefined) params.q = q;

    try {
      if (!this.calendar) {
        throw new Error("Calendar service not initialized");
      }
      const result = await this.calendar.events.list(params);
      return result.data.items || [];
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(
          `Calendar not found: ${calendarId}. Please check the calendar ID and ensure you have access.`
        );
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to calendar ${calendarId}. Please check your permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list events: ${error.message}`);
      }
      throw error;
    }
  }

  async getEvent(calendarId: string, eventId: string): Promise<Event> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    try {
      const result = await this.calendar.events.get({
        calendarId,
        eventId,
      });

      if (!result.data) {
        throw new Error("No event data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(
          `Event or calendar not found. Calendar: ${calendarId}, Event: ${eventId}`
        );
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to calendar ${calendarId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get event: ${error.message}`);
      }
      throw error;
    }
  }

  async createEvent(calendarId: string, eventData: Partial<Event>): Promise<Event> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    const result = await this.calendar.events.insert({
      calendarId,
      resource: eventData,
    });

    if (!result.data) {
      throw new Error("No event data returned");
    }
    return result.data;
  }

  async updateEvent(calendarId: string, eventId: string, eventData: Partial<Event>): Promise<Event> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    const result = await this.calendar.events.update({
      calendarId,
      eventId,
      resource: eventData,
    });

    if (!result.data) {
      throw new Error("No event data returned");
    }
    return result.data;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    await this.calendar.events.delete({
      calendarId,
      eventId,
    });

    return { success: true };
  }

  async listCalendars(): Promise<CalendarListEntry[]> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    try {
      const result = await this.calendar.calendarList.list();
      return result.data.items || [];
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to list calendars. Please check your authentication and permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list calendars: ${error.message}`);
      }
      throw error;
    }
  }

  async getCalendar(calendarId: string): Promise<CalendarType> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    try {
      const result = await this.calendar.calendars.get({
        calendarId,
      });

      if (!result.data) {
        throw new Error("No calendar data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(
          `Calendar not found: ${calendarId}. Please check the calendar ID.`
        );
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to calendar ${calendarId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get calendar: ${error.message}`);
      }
      throw error;
    }
  }

  async searchEvents(query: string, calendarId = "primary", options: SearchEventsOptions = {}): Promise<Event[]> {
    await this.initialize();

    const {
      maxResults = 10,
      timeMin = new Date().toISOString(),
      timeMax = null,
    } = options;

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
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

    const result = await this.calendar.events.list(params);
    return result.data.items || [];
  }

  async getFreeBusy(timeMin: Date, timeMax: Date, calendarIds: string[] = ["primary"]): Promise<FreeBusyResponse> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    const result = await this.calendar.freebusy.query({
      resource: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      },
    });

    if (!result.data) {
      throw new Error("No freebusy data returned");
    }
    return result.data;
  }

  async createCalendar(calendarData: Partial<CalendarType>): Promise<CalendarType> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    const result = await this.calendar.calendars.insert({
      resource: calendarData,
    });

    if (!result.data) {
      throw new Error("No calendar data returned");
    }
    return result.data;
  }

  async updateCalendar(calendarId: string, calendarData: Partial<CalendarType>): Promise<CalendarType> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    const result = await this.calendar.calendars.update({
      calendarId,
      resource: calendarData,
    });

    if (!result.data) {
      throw new Error("No calendar data returned");
    }
    return result.data;
  }

  async deleteCalendar(calendarId: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.calendar) {
      throw new Error("Calendar service not initialized");
    }

    await this.calendar.calendars.delete({
      calendarId,
    });

    return { success: true };
  }

  async getUpcomingEvents(days = 7, calendarId = "primary"): Promise<Event[]> {
    await this.initialize();

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + days);

    return await this.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
    });
  }

  async getTodayEvents(calendarId = "primary"): Promise<Event[]> {
    await this.initialize();

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

    return await this.listEvents(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
    });
  }
}
