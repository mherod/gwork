/**
 * Gmail service wrapper for Google Gmail API v1.
 * Provides methods for managing messages, threads, labels, and profiles.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import { withRetry } from "./retry.ts";
import { validateResourceId, validateMaxResults } from "./validators.ts";
import type { gmail_v1 } from "googleapis";
import type {
  GmailClient,
  Message,
  Thread,
  Label,
  Profile,
  ListMessagesOptions,
  SearchMessagesOptions,
  ListThreadsOptions,
  MessagesResponse,
  ThreadsResponse,
} from "../types/google-apis.ts";

export class MailService extends BaseService {
  private gmail: GmailClient | null = null;

  constructor(account = "default") {
    super(
      "Gmail",
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.labels",
      ],
      account
    );
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    // Initialize Gmail client - auth is guaranteed non-null after ensureInitialized()
    this.gmail = google.gmail({ version: "v1", auth: this.getAuth() });
  }

  // ============= LABEL OPERATIONS =============

  /**
   * Lists all labels in the user's mailbox.
   *
   * @returns Array of Label objects
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const mail = new MailService();
   * await mail.initialize();
   * const labels = await mail.listLabels();
   * ```
   */
  async listLabels(): Promise<Label[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.gmail!.users.labels.list({
        userId: "me",
      });
      return result.data.labels || [];
    } catch (error: unknown) {
      handleGoogleApiError(error, "list labels");
    }
  }

  /**
   * Creates a new label.
   *
   * @param labelData - Label properties (name, labelListVisibility, etc.)
   * @returns Created Label object
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const label = await mail.createLabel({ name: "Work" });
   * ```
   */
  async createLabel(labelData: Partial<Label>): Promise<Label> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.gmail!.users.labels.create({
        userId: "me",
        requestBody: labelData,
      });
      if (!result.data) {
        throw new Error("No label data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "create label");
    }
  }

  /**
   * Deletes a label.
   *
   * @param labelId - ID of label to delete
   * @returns Success indicator
   * @throws {NotFoundError} If label not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await mail.deleteLabel("Label_1");
   * ```
   */
  async deleteLabel(labelId: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(labelId, "labelId");

    try {
      await this.gmail!.users.labels.delete({
        userId: "me",
        id: labelId,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete label");
    }
  }

  // ============= MESSAGE OPERATIONS =============

  /**
   * Lists messages with optional filtering and pagination.
   *
   * @param options - Optional parameters
   * @param options.maxResults - Max messages to return (1-500, default: 10)
   * @param options.q - Gmail search query (e.g., "from:user@example.com")
   * @param options.labelIds - Filter by label IDs
   * @param options.pageToken - Token for next page
   *
   * @returns Object with messages array and pagination metadata
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If options are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const { messages, nextPageToken } = await mail.listMessages({
   *   maxResults: 25,
   *   q: "is:unread"
   * });
   *
   * // Fetch next page
   * if (nextPageToken) {
   *   const nextPage = await mail.listMessages({ pageToken: nextPageToken });
   * }
   * ```
   */
  async listMessages(options: ListMessagesOptions = {}): Promise<MessagesResponse> {
    await this.initialize();
    this.ensureInitialized();

    const { maxResults = 10, q = null, labelIds = null, pageToken = null } = options;

    // Validate options
    if (maxResults > 0) {
      validateMaxResults(maxResults, 500);
    }

    const params: {
      userId: string;
      maxResults: number;
      q?: string;
      labelIds?: string[];
      pageToken?: string;
    } = {
      userId: "me",
      maxResults,
    };

    if (q !== null && q !== undefined) params.q = q;
    if (labelIds !== null && labelIds !== undefined) params.labelIds = labelIds;
    if (pageToken !== null && pageToken !== undefined) params.pageToken = pageToken;

    try {
      return await withRetry(
        async () => {
          const result = await this.gmail!.users.messages.list(params);
          return {
            messages: result.data.messages || [],
            nextPageToken: result.data.nextPageToken || null,
            resultSizeEstimate: result.data.resultSizeEstimate || null,
          };
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "list messages");
    }
  }

  /**
   * Gets a single message by ID.
   *
   * @param messageId - ID of message to retrieve
   * @param format - Response format: "full" (default), "metadata", or "minimal"
   * @returns Message object with requested format
   * @throws {NotFoundError} If message not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If messageId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const message = await mail.getMessage("1234567890");
   * const metadataOnly = await mail.getMessage("1234567890", "metadata");
   * ```
   */
  async getMessage(
    messageId: string,
    format: "full" | "metadata" | "minimal" = "full"
  ): Promise<Message> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(messageId, "messageId");

    try {
      const result = await this.gmail!.users.messages.get({
        userId: "me",
        id: messageId,
        format,
      });
      if (!result.data) {
        throw new Error("No message data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get message");
    }
  }

  /**
   * Searches for messages matching a Gmail search query.
   *
   * @param query - Gmail search query (uses operators like from:, subject:, etc.)
   * @param options - Optional parameters
   * @param options.maxResults - Max results to return (default: 10)
   * @param options.pageToken - Token for next page
   *
   * @returns Object with matching messages and pagination metadata
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const { messages } = await mail.searchMessages("from:boss@company.com is:unread");
   * const results = await mail.searchMessages("filename:pdf", { maxResults: 50 });
   * ```
   */
  async searchMessages(
    query: string,
    options: SearchMessagesOptions = {}
  ): Promise<MessagesResponse> {
    await this.initialize();
    this.ensureInitialized();

    const { maxResults = 10, pageToken = null } = options;

    if (maxResults > 0) {
      validateMaxResults(maxResults, 500);
    }

    const params: {
      userId: string;
      q: string;
      maxResults: number;
      pageToken?: string;
    } = {
      userId: "me",
      q: query,
      maxResults,
    };

    if (pageToken !== null && pageToken !== undefined) params.pageToken = pageToken;

    try {
      return await withRetry(
        async () => {
          const result = await this.gmail!.users.messages.list(params);
          return {
            messages: result.data.messages || [],
            nextPageToken: result.data.nextPageToken || null,
            resultSizeEstimate: result.data.resultSizeEstimate || null,
          };
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "search messages");
    }
  }

  /**
   * Deletes a message.
   *
   * @param messageId - ID of message to delete
   * @returns Success indicator
   * @throws {NotFoundError} If message not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If messageId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await mail.deleteMessage("1234567890");
   * ```
   */
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(messageId, "messageId");

    try {
      await this.gmail!.users.messages.delete({
        userId: "me",
        id: messageId,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete message");
    }
  }

  /**
   * Modifies message labels.
   *
   * @param messageId - ID of message to modify
   * @param addLabelIds - Label IDs to add
   * @param removeLabelIds - Label IDs to remove
   * @returns Modified Message object
   * @throws {NotFoundError} If message not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If messageId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const modified = await mail.modifyMessage("123", ["STARRED"], ["UNREAD"]);
   * ```
   */
  async modifyMessage(
    messageId: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = []
  ): Promise<Message> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(messageId, "messageId");

    try {
      const result = await this.gmail!.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      });
      if (!result.data) {
        throw new Error("No message data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "modify message");
    }
  }

  /**
   * Archives a message (removes from INBOX).
   *
   * @param messageId - ID of message to archive
   * @returns Modified Message object
   * @throws {NotFoundError} If message not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await mail.archiveMessage("123");
   * ```
   */
  async archiveMessage(messageId: string): Promise<Message> {
    return await this.modifyMessage(messageId, [], ["INBOX"]);
  }

  /**
   * Unarchives a message (adds to INBOX).
   *
   * @param messageId - ID of message to unarchive
   * @returns Modified Message object
   * @throws {NotFoundError} If message not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await mail.unarchiveMessage("123");
   * ```
   */
  async unarchiveMessage(messageId: string): Promise<Message> {
    return await this.modifyMessage(messageId, ["INBOX"], []);
  }

  /**
   * Batch deletes multiple messages.
   *
   * @param messageIds - Array of message IDs to delete
   * @returns Success indicator with count
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await mail.batchDeleteMessages(["123", "456", "789"]);
   * console.log(`Deleted ${result.count} messages`);
   * ```
   */
  async batchDeleteMessages(messageIds: string[]): Promise<{ success: boolean; count: number }> {
    await this.initialize();
    this.ensureInitialized();

    try {
      await this.gmail!.users.messages.batchDelete({
        userId: "me",
        requestBody: {
          ids: messageIds,
        },
      });
      return { success: true, count: messageIds.length };
    } catch (error: unknown) {
      handleGoogleApiError(error, "batch delete messages");
    }
  }

  // ============= THREAD OPERATIONS =============

  /**
   * Gets a single thread by ID.
   *
   * @param threadId - ID of thread to retrieve
   * @returns Thread object with full message content
   * @throws {NotFoundError} If thread not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If threadId is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const thread = await mail.getThread("1234567890");
   * ```
   */
  async getThread(threadId: string): Promise<Thread> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(threadId, "threadId");

    try {
      const result = await this.gmail!.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      if (!result.data) {
        throw new Error("No thread data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get thread");
    }
  }

  /**
   * Lists threads with optional filtering and pagination.
   *
   * @param options - Optional parameters
   * @param options.maxResults - Max threads to return (default: 10)
   * @param options.q - Gmail search query
   * @param options.labelIds - Filter by label IDs
   * @param options.pageToken - Token for next page
   *
   * @returns Object with threads array and pagination metadata
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If options are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const { threads, nextPageToken } = await mail.listThreads({
   *   maxResults: 20,
   *   q: "is:unread"
   * });
   * ```
   */
  async listThreads(options: ListThreadsOptions = {}): Promise<ThreadsResponse> {
    await this.initialize();
    this.ensureInitialized();

    const { maxResults = 10, q = null, labelIds = null, pageToken = null } = options;

    if (maxResults > 0) {
      validateMaxResults(maxResults, 500);
    }

    const params: {
      userId: string;
      maxResults: number;
      q?: string;
      labelIds?: string[];
      pageToken?: string;
    } = {
      userId: "me",
      maxResults,
    };

    if (q !== null && q !== undefined) params.q = q;
    if (labelIds !== null && labelIds !== undefined) params.labelIds = labelIds;
    if (pageToken !== null && pageToken !== undefined) params.pageToken = pageToken;

    try {
      return await withRetry(
        async () => {
          const result = await this.gmail!.users.threads.list(params);
          return {
            threads: result.data.threads || [],
            nextPageToken: result.data.nextPageToken || null,
            resultSizeEstimate: result.data.resultSizeEstimate || null,
          };
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "list threads");
    }
  }

  // ============= ATTACHMENT OPERATIONS =============

  /**
   * Gets an attachment from a message.
   *
   * @param messageId - ID of message containing attachment
   * @param attachmentId - ID of attachment to retrieve
   * @returns Attachment data with body (base64 encoded)
   * @throws {NotFoundError} If attachment not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If IDs are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const attachment = await mail.getAttachment("msg123", "att456");
   * ```
   */
  async getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<gmail_v1.Schema$MessagePartBody> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(messageId, "messageId");
    validateResourceId(attachmentId, "attachmentId");

    try {
      const result = await this.gmail!.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });
      if (!result.data) {
        throw new Error("No attachment data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get attachment");
    }
  }

  // ============= PROFILE OPERATIONS =============

  /**
   * Gets the user's Gmail profile information.
   *
   * @returns Profile object with messages/threads counts and history ID
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const profile = await mail.getProfile();
   * console.log(`You have ${profile.messagesTotal} total messages`);
   * ```
   */
  async getProfile(): Promise<Profile> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.gmail!.users.getProfile({
        userId: "me",
      });
      if (!result.data) {
        throw new Error("No profile data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get profile");
    }
  }
}
