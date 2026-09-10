/**
 * Generic command handler with retry and re-authorization logic.
 * Replaces the duplicated fatalExit / reAuthAndRetry / handleXCommand
 * pattern that was copied across cal.ts, mail.ts, drive.ts, and contacts.ts.
 */

import { ScopeInsufficientError, AuthenticationRequiredError } from "../services/errors.ts";
import { logServiceError } from "./command-error-handler.ts";
import { retryWithBackoff } from "./retry-helper.ts";
import { logger } from "./logger.ts";

interface Initializable {
  initialize(forceReauth?: boolean): Promise<void>;
}

export interface CommandHandlerOptions<S extends Initializable> {
  /** Human-readable service name for log messages (e.g. "Calendar", "Gmail") */
  serviceName: string;
  /** Account identifier (e.g. "default", "work") */
  account: string;
  /** Subcommand name for retry context logging */
  subcommand: string;
  /** Factory that creates a fresh service instance for the given account */
  serviceFactory: (account: string) => S;
  /** Executes the subcommand against the given service instance */
  execute: (service: S) => Promise<void>;
}

/**
 * Handles a command with retry-on-transient-error and one-shot re-auth on
 * scope/authentication errors. On any other error, logs and exits.
 *
 * Flow:
 * 1. Create service → initialize → execute (wrapped in retryWithBackoff)
 * 2. If ScopeInsufficientError or AuthenticationRequiredError: force a fresh
 *    sign-in without deleting the old grant, and retry exactly once
 * 3. Any other error (or retry failure): log and exit
 */
export async function handleCommandWithRetry<S extends Initializable>(
  options: CommandHandlerOptions<S>
): Promise<void> {
  const { serviceName, account, subcommand, serviceFactory, execute } = options;

  const executeOperation = async () => {
    const service = serviceFactory(account);
    await service.initialize();
    return await execute(service);
  };

  try {
    return await retryWithBackoff(executeOperation, `${serviceName.toLowerCase()} ${subcommand}`);
  } catch (error) {
    if (error instanceof ScopeInsufficientError || error instanceof AuthenticationRequiredError) {
      const hint = (error as ScopeInsufficientError).hint ?? `Re-authenticating with ${serviceName}...`;
      logger.info(hint);
      const freshService = serviceFactory(account);
      try {
        await freshService.initialize(true);
        await execute(freshService);
      } catch (retryError) {
        logServiceError(retryError);
        process.exit(1);
      }
    } else {
      logServiceError(error);
      process.exit(1);
    }
  }
}
