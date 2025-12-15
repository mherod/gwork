import type { calendar_v3, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Calendar API Types
export type Calendar = calendar_v3.Schema$Calendar;
export type CalendarListEntry = calendar_v3.Schema$CalendarListEntry;
export type Event = calendar_v3.Schema$Event;
export type Events = calendar_v3.Schema$Events;
export type FreeBusyRequest = calendar_v3.Schema$FreeBusyRequest;
export type FreeBusyResponse = calendar_v3.Schema$FreeBusyResponse;

// Gmail API Types
export type Message = gmail_v1.Schema$Message;
export type MessageList = gmail_v1.Schema$ListMessagesResponse;
export type Thread = gmail_v1.Schema$Thread;
export type ThreadList = gmail_v1.Schema$ListThreadsResponse;
export type Label = gmail_v1.Schema$Label;
export type LabelList = gmail_v1.Schema$ListLabelsResponse;
export type Profile = gmail_v1.Schema$Profile;

// API Client Types
export type CalendarClient = calendar_v3.Calendar;
export type GmailClient = gmail_v1.Gmail;

// Auth Types
export type AuthClient = OAuth2Client;

// Event Options
export interface ListEventsOptions {
  maxResults?: number;
  timeMin?: string;
  timeMax?: string | null;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
  q?: string | null;
}

export interface SearchEventsOptions {
  maxResults?: number;
  timeMin?: string;
  timeMax?: string | null;
}

// Message Options
export interface ListMessagesOptions {
  maxResults?: number;
  q?: string | null;
  labelIds?: string[] | null;
  pageToken?: string | null;
}

export interface SearchMessagesOptions {
  maxResults?: number;
  pageToken?: string | null;
}

export interface ListThreadsOptions {
  maxResults?: number;
  q?: string | null;
  labelIds?: string[] | null;
  pageToken?: string | null;
}

// Response Types
export interface MessagesResponse {
  messages: Message[];
  nextPageToken?: string | null;
  resultSizeEstimate?: number | null;
}

export interface ThreadsResponse {
  threads: Thread[];
  nextPageToken?: string | null;
  resultSizeEstimate?: number | null;
}
