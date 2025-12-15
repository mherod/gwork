import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { TokenStore } from "./token-store.ts";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import type { gmail_v1 } from "googleapis";
import type {
  GmailClient,
  AuthClient,
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

export class MailService {
  private gmail: GmailClient | null = null;
  private auth: AuthClient | null = null;
  private readonly SCOPES: string[];
  private tokenStore: TokenStore;
  private account: string;

  constructor(account: string = "default") {
    this.account = account;
    this.tokenStore = TokenStore.getInstance();
    this.SCOPES = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.labels",
    ];
  }

  async initialize() {
    if (this.gmail) return;

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
    this.gmail = google.gmail({ version: "v1", auth: this.auth });
  }

  private async loadSavedAuthIfExist() {
    try {
      const token = this.tokenStore.getToken("gmail", this.account);

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
        this.tokenStore.deleteToken("gmail", this.account);
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
        console.log(`Using saved Gmail token (account: ${this.account})`);
        return auth;
      } catch (error) {
        // Token is expired or invalid, remove it
        console.log("Saved Gmail token is invalid. Re-authenticating...");
        this.tokenStore.deleteToken("gmail", this.account);
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to load saved Gmail token:", message);
      this.tokenStore.deleteToken("gmail", this.account);
    }
    return null;
  }

  private async saveAuth(auth: AuthClient) {
    try {
      this.tokenStore.saveToken({
        service: "gmail",
        account: this.account,
        access_token: auth.credentials.access_token,
        refresh_token: auth.credentials.refresh_token,
        expiry_date: auth.credentials.expiry_date,
        scopes: this.SCOPES,
      });
      console.log(`Gmail token saved (account: ${this.account})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to save Gmail token:", message);
    }
  }

  async listLabels(): Promise<Label[]> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.labels.list({
        userId: "me",
      });
      return result.data.labels || [];
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to list labels. Please check your authentication and permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list labels: ${error.message}`);
      }
      throw error;
    }
  }

  async listMessages(options: ListMessagesOptions = {}): Promise<MessagesResponse> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    const {
      maxResults = 10,
      q = null,
      labelIds = null,
      pageToken = null,
    } = options;

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
      const result = await this.gmail.users.messages.list(params);
      return {
        messages: result.data.messages || [],
        nextPageToken: result.data.nextPageToken || null,
        resultSizeEstimate: result.data.resultSizeEstimate || null,
      };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to list messages. Please check your authentication and permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list messages: ${error.message}`);
      }
      throw error;
    }
  }

  async getMessage(messageId: string, format: "full" | "metadata" | "minimal" = "full"): Promise<Message> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format,
      });
      if (!result.data) {
        throw new Error("No message data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Message not found: ${messageId}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to message ${messageId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get message: ${error.message}`);
      }
      throw error;
    }
  }

  async searchMessages(query: string, options: SearchMessagesOptions = {}): Promise<MessagesResponse> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    const { maxResults = 10, pageToken = null } = options;

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
      const result = await this.gmail.users.messages.list(params);
      return {
        messages: result.data.messages || [],
        nextPageToken: result.data.nextPageToken || null,
        resultSizeEstimate: result.data.resultSizeEstimate || null,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to search messages: ${error.message}`);
      }
      throw error;
    }
  }

  async getThread(threadId: string): Promise<Thread> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      if (!result.data) {
        throw new Error("No thread data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Thread not found: ${threadId}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to thread ${threadId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get thread: ${error.message}`);
      }
      throw error;
    }
  }

  async listThreads(options: ListThreadsOptions = {}): Promise<ThreadsResponse> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    const {
      maxResults = 10,
      q = null,
      labelIds = null,
      pageToken = null,
    } = options;

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
      const result = await this.gmail.users.threads.list(params);
      return {
        threads: result.data.threads || [],
        nextPageToken: result.data.nextPageToken || null,
        resultSizeEstimate: result.data.resultSizeEstimate || null,
      };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to list threads. Please check your authentication and permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list threads: ${error.message}`);
      }
      throw error;
    }
  }

  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      await this.gmail.users.messages.delete({
        userId: "me",
        id: messageId,
      });
      return { success: true };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Message not found: ${messageId}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to delete message ${messageId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to delete message: ${error.message}`);
      }
      throw error;
    }
  }

  async modifyMessage(
    messageId: string,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = []
  ): Promise<Message> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.messages.modify({
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
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Message not found: ${messageId}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to modify message ${messageId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to modify message: ${error.message}`);
      }
      throw error;
    }
  }

  async archiveMessage(messageId: string): Promise<Message> {
    // Archive = remove INBOX label
    return await this.modifyMessage(messageId, [], ["INBOX"]);
  }

  async unarchiveMessage(messageId: string): Promise<Message> {
    // Unarchive = add INBOX label
    return await this.modifyMessage(messageId, ["INBOX"], []);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<gmail_v1.Schema$MessagePartBody> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });
      if (!result.data) {
        throw new Error("No attachment data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(
          `Attachment not found: ${attachmentId} in message ${messageId}`
        );
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to attachment ${attachmentId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get attachment: ${error.message}`);
      }
      throw error;
    }
  }

  async createLabel(labelData: Partial<Label>): Promise<Label> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.labels.create({
        userId: "me",
        requestBody: labelData,
      });
      if (!result.data) {
        throw new Error("No label data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to create label. Please check your permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to create label: ${error.message}`);
      }
      throw error;
    }
  }

  async deleteLabel(labelId: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      await this.gmail.users.labels.delete({
        userId: "me",
        id: labelId,
      });
      return { success: true };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Label not found: ${labelId}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: You don't have access to delete label ${labelId}`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to delete label: ${error.message}`);
      }
      throw error;
    }
  }

  async getProfile(): Promise<Profile> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      const result = await this.gmail.users.getProfile({
        userId: "me",
      });
      if (!result.data) {
        throw new Error("No profile data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to get profile. Please check your authentication and permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to get profile: ${error.message}`);
      }
      throw error;
    }
  }

  async batchDeleteMessages(messageIds: string[]): Promise<{ success: boolean; count: number }> {
    await this.initialize();

    if (!this.gmail) {
      throw new Error("Gmail service not initialized");
    }

    try {
      await this.gmail.users.messages.batchDelete({
        userId: "me",
        requestBody: {
          ids: messageIds,
        },
      });
      return { success: true, count: messageIds.length };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          `Permission denied: Unable to delete messages. Please check your permissions.`
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to batch delete messages: ${error.message}`);
      }
      throw error;
    }
  }
}

