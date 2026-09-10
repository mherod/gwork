import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import * as openModule from "open";
import { AuthManager } from "../../../src/services/auth-manager.ts";
import type { TokenStore } from "../../../src/services/token-store.ts";
import type { Logger } from "../../../src/utils/logger.ts";

// These tests bind real loopback sockets, but never open a browser, contact
// Google, read credentials from disk, or instantiate the real token store.
const realCreateServer = http.createServer;
const originalOAuth2 = google.auth.OAuth2;
const authOptions = {
  service: "gmail", account: "fixture", requiredScopes: ["mail"],
  credentialsPath: "/unused/fixture-credentials.json",
};

describe("OAuth callback ports", () => {
  const servers: http.Server[] = [];
  let originalPort: string | undefined;
  let manager: AuthManager;
  let store: { getToken: ReturnType<typeof mock>; saveToken: ReturnType<typeof mock>; deleteToken: ReturnType<typeof mock> };
  let client: {
    generateAuthUrl: ReturnType<typeof mock>;
    getToken: ReturnType<typeof mock>;
    setCredentials: ReturnType<typeof mock>;
  };
  let openedRedirect: string | undefined;
  let boundPort: number | undefined;
  let openSpy: ReturnType<typeof spyOn>;

  function credentials(type: "installed" | "web", redirectUris: string[]) {
    spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
      [type]: { client_id: "fixture-client", client_secret: "fixture-secret", redirect_uris: redirectUris },
    }));
  }

  async function expectSignInFailure(message: string) {
    const signIn = manager.getAuthClient(authOptions);
    expect(signIn).rejects.toThrow(message);
    await signIn.catch(() => {});
  }

  async function occupyPort() {
    const server = realCreateServer();
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return { server, port: (server.address() as AddressInfo).port };
  }

  async function freePort() {
    const { server, port } = await occupyPort();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
  }

  beforeEach(() => {
    originalPort = process.env.GWORK_OAUTH_PORT;
    delete process.env.GWORK_OAUTH_PORT;
    openedRedirect = undefined;
    boundPort = undefined;
    store = { getToken: mock(() => null), saveToken: mock(() => {}), deleteToken: mock(() => {}) };
    client = {
      generateAuthUrl: mock((options: { redirect_uri: string }) =>
        `https://accounts.example.invalid/auth?redirect_uri=${encodeURIComponent(options.redirect_uri)}`),
      getToken: mock(async () => ({ tokens: { access_token: "fixture-access", refresh_token: "fixture-refresh" } })),
      setCredentials: mock(() => {}),
    };
    google.auth.OAuth2 = function OAuth2Mock() { return client; } as unknown as typeof google.auth.OAuth2;
    const logger = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) };
    manager = new AuthManager({ tokenStore: store as unknown as TokenStore, logger: logger as unknown as Logger });
    spyOn(http, "createServer").mockImplementation((handler: http.RequestListener) => {
      const server = realCreateServer(handler);
      servers.push(server);
      return server;
    });
    openSpy = spyOn(openModule, "default").mockImplementation(async (url: string) => {
      openedRedirect = new URL(url).searchParams.get("redirect_uri")!;
      boundPort = (servers.at(-1)!.address() as AddressInfo).port;
      const callback = new URL(openedRedirect);
      callback.searchParams.set("code", "fixture-code");
      const response = await fetch(callback, { signal: AbortSignal.timeout(3000) });
      await response.text();
      return { unref() {} } as Awaited<ReturnType<typeof openModule.default>>;
    });
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
    google.auth.OAuth2 = originalOAuth2;
    if (originalPort === undefined) delete process.env.GWORK_OAUTH_PORT;
    else process.env.GWORK_OAUTH_PORT = originalPort;
    mock.restore();
  });

  it("retries an occupied desktop callback port and propagates the bound port to both OAuth requests", async () => {
    const { server: unrelatedServer, port } = await occupyPort();
    credentials("installed", [`http://127.0.0.1:${port}/oauth2callback`]);

    await manager.getAuthClient(authOptions);

    expect(unrelatedServer.listening).toBe(true);
    expect(boundPort).not.toBe(port);
    expect(openedRedirect).toBe(`http://127.0.0.1:${boundPort}/oauth2callback`);
    expect(client.getToken).toHaveBeenCalledWith({ code: "fixture-code", redirect_uri: openedRedirect });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(store.saveToken).toHaveBeenCalledTimes(1);
    expect(store.deleteToken).not.toHaveBeenCalled();
  });

  it("honours an explicit desktop port instead of the occupied credentials port", async () => {
    const { port } = await occupyPort();
    const override = await freePort();
    process.env.GWORK_OAUTH_PORT = String(override);
    credentials("installed", [`http://127.0.0.1:${port}/callback`]);

    await manager.getAuthClient(authOptions);

    expect(boundPort).toBe(override);
    expect(openedRedirect).toBe(`http://127.0.0.1:${override}/callback`);
  });

  it("allows an explicit zero to select a free desktop port", async () => {
    const { port } = await occupyPort();
    process.env.GWORK_OAUTH_PORT = "0";
    credentials("installed", [`http://127.0.0.1:${port}/callback`]);

    await manager.getAuthClient(authOptions);

    expect(boundPort).toBeGreaterThan(0);
    expect(boundPort).not.toBe(port);
    expect(client.getToken).toHaveBeenCalledWith({ code: "fixture-code", redirect_uri: openedRedirect });
  });

  it("does not silently replace an occupied explicit port", async () => {
    const { port } = await occupyPort();
    process.env.GWORK_OAUTH_PORT = String(port);
    credentials("installed", ["http://127.0.0.1:3000/"]);

    await expectSignInFailure(`port ${port} is already in use`);

    expect(openSpy).not.toHaveBeenCalled();
    expect(store.saveToken).not.toHaveBeenCalled();
  });

  it("names the required URI when a web client's registered port is occupied", async () => {
    const { port } = await occupyPort();
    const registeredUri = `http://127.0.0.1:${port}/registered-callback`;
    credentials("web", [registeredUri]);

    await expectSignInFailure(`requires the registered redirect URI ${registeredUri}`);

    expect(openSpy).not.toHaveBeenCalled();
    expect(store.saveToken).not.toHaveBeenCalled();
  });

  it("selects an explicitly requested registered web URI and preserves its exact spelling", async () => {
    const { port } = await occupyPort();
    const override = await freePort();
    const registeredUri = `http://127.0.0.1:${override}`;
    process.env.GWORK_OAUTH_PORT = String(override);
    credentials("web", [`http://127.0.0.1:${port}/callback`, registeredUri]);

    await manager.getAuthClient(authOptions);

    expect(boundPort).toBe(override);
    expect(openedRedirect).toBe(registeredUri);
    expect(client.getToken).toHaveBeenCalledWith({ code: "fixture-code", redirect_uri: registeredUri });
  });

  for (const override of ["0", "45678"]) {
    it(`rejects an unregistered web port override (${override}) before opening the browser`, async () => {
      process.env.GWORK_OAUTH_PORT = override;
      credentials("web", ["http://localhost:3000/callback"]);

      await expectSignInFailure("requires an exact registered redirect URI");

      expect(openSpy).not.toHaveBeenCalled();
      expect(http.createServer).not.toHaveBeenCalled();
    });
  }

  it("rejects a zero port even when it appears in a web credentials URI", async () => {
    credentials("web", ["http://localhost:0/callback"]);

    await expectSignInFailure("requires a registered redirect URI with a fixed port");

    expect(http.createServer).not.toHaveBeenCalled();
  });

  for (const invalidPort of ["", "-1", "65536", "3000oops", "1.5"]) {
    it(`rejects an invalid port override (${JSON.stringify(invalidPort)}) before listening`, async () => {
      process.env.GWORK_OAUTH_PORT = invalidPort;
      credentials("installed", ["http://localhost:3000/"]);

      await expectSignInFailure("GWORK_OAUTH_PORT must be an integer");

      expect(http.createServer).not.toHaveBeenCalled();
    });
  }

  it("keeps an actionable error if binding a free port also fails", async () => {
    credentials("installed", ["http://localhost:3000/callback"]);
    const server = Object.assign(new EventEmitter(), {
      listen: mock((_port: number, _host: string) => {
        queueMicrotask(() => server.emit("error", Object.assign(new Error("occupied"), { code: "EADDRINUSE" })));
        return server;
      }),
    });
    spyOn(http, "createServer").mockReturnValue(server as unknown as http.Server);

    await expectSignInFailure("Could not bind a free loopback port");

    expect(server.listen.mock.calls.map(call => call[0])).toEqual([3000, 0]);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
