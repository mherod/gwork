/**
 * Google Drive service wrapper for Google Drive API v3.
 * Provides methods for managing files, folders, and permissions.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import type { drive_v3 } from "googleapis";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  webViewLink?: string;
  shared?: boolean;
}

export interface ListFilesOptions {
  maxResults?: number;
  folderId?: string;
  query?: string;
  orderBy?: string;
}

export interface UploadFileOptions {
  name: string;
  mimeType?: string;
  parentId?: string;
  filePath: string;
}

export interface DriveStorageQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
}

export class DriveService extends BaseService {
  private drive: drive_v3.Drive | null = null;

  constructor(account = "default") {
    super(
      "Drive",
      [
        "https://www.googleapis.com/auth/drive",
      ],
      account
    );
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    this.drive = google.drive({ version: "v3", auth: this.getAuth() });
  }

  // ============= FILE OPERATIONS =============

  async listFiles(options: ListFilesOptions = {}): Promise<DriveFile[]> {
    await this.initialize();
    this.ensureInitialized();

    const { maxResults = 10, folderId, query, orderBy = "modifiedTime desc" } = options;

    let q = "trashed = false";
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }
    if (query) {
      q += ` and (${query})`;
    }

    try {
      const result = await this.drive!.files.list({
        pageSize: maxResults,
        fields: "files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared)",
        q,
        orderBy,
      });
      return (result.data.files || []).map(this.mapFile);
    } catch (error: unknown) {
      handleGoogleApiError(error, "list files");
    }
  }

  async getFile(fileId: string): Promise<DriveFile> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.drive!.files.get({
        fileId,
        fields: "id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared",
      });
      return this.mapFile(result.data);
    } catch (error: unknown) {
      handleGoogleApiError(error, "get file");
    }
  }

  async searchFiles(query: string, maxResults = 10): Promise<DriveFile[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.drive!.files.list({
        pageSize: maxResults,
        fields: "files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared)",
        q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
        orderBy: "modifiedTime desc",
      });
      return (result.data.files || []).map(this.mapFile);
    } catch (error: unknown) {
      handleGoogleApiError(error, "search files");
    }
  }

  async downloadFile(fileId: string, destPath: string): Promise<void> {
    await this.initialize();
    this.ensureInitialized();

    const fs = await import("node:fs");
    const path = await import("node:path");

    try {
      // Get file metadata to determine if it's a Google Workspace file
      const meta = await this.drive!.files.get({
        fileId,
        fields: "id,name,mimeType",
      });

      const mimeType = meta.data.mimeType || "";

      // Google Workspace files need to be exported
      const exportMimeMap: Record<string, string> = {
        "application/vnd.google-apps.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };

      const resolvedDest = path.resolve(destPath);
      const dest = fs.createWriteStream(resolvedDest);

      const exportMime = exportMimeMap[mimeType];
      if (exportMime) {
        const response = await this.drive!.files.export(
          { fileId, mimeType: exportMime },
          { responseType: "stream" }
        );
        await new Promise<void>((resolve, reject) => {
          (response.data as NodeJS.ReadableStream).pipe(dest);
          dest.on("finish", resolve);
          dest.on("error", reject);
        });
      } else {
        const response = await this.drive!.files.get(
          { fileId, alt: "media" },
          { responseType: "stream" }
        );
        await new Promise<void>((resolve, reject) => {
          (response.data as NodeJS.ReadableStream).pipe(dest);
          dest.on("finish", resolve);
          dest.on("error", reject);
        });
      }
    } catch (error: unknown) {
      handleGoogleApiError(error, "download file");
    }
  }

  async uploadFile(options: UploadFileOptions): Promise<DriveFile> {
    await this.initialize();
    this.ensureInitialized();

    const fs = await import("node:fs");
    const path = await import("node:path");
    const mime = options.mimeType ?? "application/octet-stream";

    try {
      const result = await this.drive!.files.create({
        requestBody: {
          name: options.name,
          mimeType: mime,
          parents: options.parentId ? [options.parentId] : undefined,
        },
        media: {
          mimeType: mime,
          body: fs.createReadStream(path.resolve(options.filePath)),
        },
        fields: "id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared",
      });
      return this.mapFile(result.data);
    } catch (error: unknown) {
      handleGoogleApiError(error, "upload file");
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.initialize();
    this.ensureInitialized();

    try {
      await this.drive!.files.delete({ fileId });
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete file");
    }
  }

  async createFolder(name: string, parentId?: string): Promise<DriveFile> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.drive!.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
        },
        fields: "id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared",
      });
      return this.mapFile(result.data);
    } catch (error: unknown) {
      handleGoogleApiError(error, "create folder");
    }
  }

  async moveFile(fileId: string, folderId: string): Promise<DriveFile> {
    await this.initialize();
    this.ensureInitialized();

    try {
      // Get current parents to remove them
      const current = await this.drive!.files.get({
        fileId,
        fields: "parents",
      });
      const previousParents = (current.data.parents || []).join(",");

      const result = await this.drive!.files.update({
        fileId,
        addParents: folderId,
        removeParents: previousParents,
        fields: "id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,shared",
      });
      return this.mapFile(result.data);
    } catch (error: unknown) {
      handleGoogleApiError(error, "move file");
    }
  }

  async getFilePermissions(fileId: string): Promise<drive_v3.Schema$Permission[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.drive!.permissions.list({
        fileId,
        fields: "permissions(id,type,role,emailAddress,displayName)",
      });
      return result.data.permissions || [];
    } catch (error: unknown) {
      handleGoogleApiError(error, "get file permissions");
    }
  }

  async getStorageQuota(): Promise<DriveStorageQuota> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.drive!.about.get({
        fields: "storageQuota",
      });
      const quota = result.data.storageQuota || {};
      return {
        limit: quota.limit ?? undefined,
        usage: quota.usage ?? undefined,
        usageInDrive: quota.usageInDrive ?? undefined,
        usageInDriveTrash: quota.usageInDriveTrash ?? undefined,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get storage quota");
    }
  }

  private mapFile(file: drive_v3.Schema$File): DriveFile {
    return {
      id: file.id || "",
      name: file.name || "",
      mimeType: file.mimeType || "",
      size: file.size ?? undefined,
      modifiedTime: file.modifiedTime ?? undefined,
      createdTime: file.createdTime ?? undefined,
      parents: file.parents ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
      shared: file.shared ?? undefined,
    };
  }
}
