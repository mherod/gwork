import { mock, spyOn } from "bun:test";
import { google } from "googleapis";
import { AuthManager } from "../../../src/services/auth-manager.ts";
import { TokenStore } from "../../../src/services/token-store.ts";
import * as errorHandler from "../../../src/services/error-handler.ts";
import * as setupGuide from "../../../src/utils/setup-guide.ts";
import type { AuthClient } from "../../../src/types/google-apis.ts";

/** Keep service tests on the real initialization path without touching disk or OAuth. */
export function mockWorkspaceAuth() {
  const auth = {} as AuthClient;
  const tokenStore = spyOn(TokenStore, "getInstance").mockReturnValue({} as TokenStore);
  const credentials = spyOn(setupGuide, "ensureCredentialsExist").mockReturnValue(true);
  const authenticate = spyOn(AuthManager.prototype, "getAuthClient").mockResolvedValue(auth);
  const userinfo = mock(async () => ({ data: { email: "work@example.com" } }));
  const oauth = spyOn(google, "oauth2").mockReturnValue({
    userinfo: { get: userinfo },
  } as unknown as ReturnType<typeof google.oauth2>);
  const apiError = spyOn(errorHandler, "handleGoogleApiError");

  return {
    auth, authenticate, userinfo, oauth, apiError,
    restore() {
      apiError.mockRestore();
      oauth.mockRestore();
      authenticate.mockRestore();
      credentials.mockRestore();
      tokenStore.mockRestore();
    },
  };
}
