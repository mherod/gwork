import path from "node:path";
import os from "node:os";
import { Database } from "../utils/sqlite-wrapper.ts";

export interface TokenData {
  service: string;
  account: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scopes: string[];
  created_at: number;
  updated_at: number;
}

export class TokenStore {
  private db: Database;
  private static instance: TokenStore | null = null;

  private constructor() {
    const dbPath = path.join(os.homedir(), ".gwork_tokens.db");
    this.db = new Database(dbPath, { create: true });

    // Enable WAL mode for better performance
    this.db.pragma("journal_mode", "WAL");

    this.initializeSchema();
  }

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        service TEXT NOT NULL,
        account TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiry_date INTEGER NOT NULL,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (service, account)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_service
      ON tokens(service)
    `);
  }

  saveToken(data: Omit<TokenData, "created_at" | "updated_at">): void {
    const now = Date.now();
    const scopesJson = JSON.stringify(data.scopes);

    const stmt = this.db.prepare(`
      INSERT INTO tokens (
        service, account, access_token, refresh_token,
        expiry_date, scopes, created_at, updated_at
      ) VALUES (
        @service, @account, @access_token, @refresh_token,
        @expiry_date, @scopes, @created_at, @updated_at
      )
      ON CONFLICT(service, account) DO UPDATE SET
        access_token = @access_token,
        refresh_token = @refresh_token,
        expiry_date = @expiry_date,
        scopes = @scopes,
        updated_at = @updated_at
    `);

    stmt.run({
      service: data.service,
      account: data.account,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: data.expiry_date,
      scopes: scopesJson,
      created_at: now,
      updated_at: now,
    });
  }

  getToken(service: string, account: string = "default"): TokenData | null {
    const stmt = this.db.prepare(`
      SELECT * FROM tokens
      WHERE service = @service AND account = @account
    `);

    const row: any = stmt.get({ service, account });

    if (!row) return null;

    return {
      service: row.service,
      account: row.account,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
      scopes: JSON.parse(row.scopes),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  getDefaultToken(service: string): TokenData | null {
    return this.getToken(service, "default");
  }

  listTokens(service?: string): TokenData[] {
    let stmt;
    let rows: any[];

    if (service) {
      stmt = this.db.prepare(`
        SELECT * FROM tokens
        WHERE service = @service
        ORDER BY account
      `);
      rows = stmt.all({ service });
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM tokens
        ORDER BY service, account
      `);
      rows = stmt.all();
    }

    return rows.map(row => ({
      service: row.service,
      account: row.account,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
      scopes: JSON.parse(row.scopes),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  deleteToken(service: string, account: string = "default"): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM tokens
      WHERE service = @service AND account = @account
    `);

    const result = stmt.run({ service, account });

    return result.changes > 0;
  }

  hasValidScopes(service: string, requiredScopes: string[], account: string = "default"): boolean {
    const token = this.getToken(service, account);
    if (!token) return false;

    return requiredScopes.every(scope => token.scopes.includes(scope));
  }

  close(): void {
    this.db.close();
  }
}
