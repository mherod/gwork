# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**gwork** is a comprehensive CLI tool for Google Workspace (Calendar + Gmail). It provides 54 fully implemented commands (24 calendar + 30 Gmail) that expose the Google APIs through a developer-friendly command-line interface.

The codebase is built with TypeScript using Bun as the primary runtime, with additional Node.js compatibility for CLI distribution via npm.

## Development Commands

```bash
# Install dependencies
bun install

# Run CLI in development mode (direct execution)
bun src/cli.ts cal list
bun src/cli.ts mail messages -n 5
bun src/cli.ts cal list --today

# Or use the dev script (equivalent to above)
bun run dev cal list
bun run dev mail messages -n 5

# Lint
bun run lint
bun run lint:fix

# Build for production (bundles for Node.js)
bun run build

# Test production build
gwork --help
gwork cal list
gwork mail messages -n 5
```

## Architecture

### Core Structure

```
src/
├── cli.ts                      # Entry point; routes commands to handlers
├── commands/
│   ├── accounts.ts             # Accounts command handler
│   ├── cal.ts                  # Calendar command dispatcher (24 commands)
│   └── mail.ts                 # Gmail command dispatcher (30 commands)
├── services/
│   ├── calendar-service.ts     # Google Calendar API wrapper
│   ├── mail-service.ts         # Gmail API wrapper
│   └── token-store.ts          # Multi-account token persistence (SQLite)
├── utils/
│   ├── sqlite-wrapper.ts       # Bun/Node.js SQLite abstraction layer
│   ├── setup-guide.ts          # User onboarding for credentials setup
│   └── format.ts               # Date/time formatting utilities
└── types/
    └── google-apis.ts          # TypeScript types for Google API responses
```

### Data Flow

1. **CLI Entry** (`src/cli.ts`): Routes top-level commands (mail/cal) to handlers
2. **Command Handlers** (`src/commands/*.ts`): Parse arguments and call service methods
3. **Services** (`src/services/*.ts`): Google API wrappers; call `initialize()` first (checks credentials, loads/refreshes tokens)
4. **Token Management** (`src/services/token-store.ts`): Singleton that manages SQLite database at `~/.gwork_tokens.db` with support for multiple accounts per service
5. **Setup Flow** (`src/utils/setup-guide.ts`): Friendly onboarding if credentials missing

### Token Management & Authentication

- **Credentials**: OAuth2 credentials from Google Cloud Console saved to `~/.credentials.json`
- **Token Store**: SQLite database at `~/.gwork_tokens.db` stores access/refresh tokens indexed by (service, account)
- **Multi-account**: Supports separate tokens for different Google accounts (e.g., "default", "work", "personal")
- **Token Refresh**: Google's local-auth library handles automatic refresh before expiry
- **Setup Detection**: Both `CalendarService` and `MailService` check for credentials on initialization and display friendly setup guide if missing
- **Account verification**: `MailService.initialize()` calls `gmail.users.getProfile({ userId: "me" })` after auth and throws a clear mismatch error if the token's `emailAddress` doesn't match the requested `--account`. DON'T skip this check — the Gmail API `userId: "me"` does not filter by email; without it, a mismatched token silently queries the wrong mailbox.
- **Account scoping in search results**: `searchMessages` in `src/commands/mail.ts` filters fetched messages by `To`/`Delivered-To` headers when `account !== "default"`. This is defence-in-depth: always filter results client-side when account isolation is required, even when the token lookup is expected to be correct.

### SQLite Abstraction Layer

The `sqlite-wrapper.ts` provides a unified interface that works in both:
- **Bun runtime** (development, scripts): Uses native `bun:sqlite`
- **Node.js runtime** (CLI distribution): Uses `better-sqlite3` npm package

This abstraction normalizes parameter syntax (`@param` for both, internally converts to `$param` for Bun) and method names, keeping business logic clean of runtime conditionals.

## Key Design Patterns

1. **Singleton Services**: `CalendarService` and `MailService` are instantiated once per process
2. **Lazy Initialization**: Services don't authenticate until `.initialize()` is called (happens before each command)
3. **Abstraction Over Dual-Runtime**: SQLite wrapper hides implementation differences
4. **Multi-Account Ready**: TokenStore uses composite key (service, account) for future multi-account support
5. **Fail-Fast with Guidance**: If credentials missing, show friendly setup guide instead of cryptic errors

## Testing Guidelines

- **Runtime**: Run tests with `bun test`.
- **Mocking**: Use `bun:test` primitives (`mock`, `spyOn`).
- **Database in Tests**:
  - **DON'T** access the real SQLite database in unit tests. It causes "database is locked" errors due to concurrency.
  - **DO** mock `TokenStore.getInstance()` and its methods (e.g., `listTokens`) to return fixture data.
  - **DO** restore mocks and singletons in `afterEach` to prevent test pollution.

## Build & Publishing

```bash
# Build for Node.js distribution
bun run build
# Output: dist/cli.js (13.2 MB minified)

# Key build flags:
# --target=node         : Compile for Node.js runtime
# --minify              : Reduce bundle size
# --external better-sqlite3 : Keep native binary external (not bundled)

# Publish to npm
npm publish
# Automatically runs build via prepublishOnly script

# Versioning
- **DO** update version in `src/cli.ts` (`printVersion` function) to match `package.json` when bumping versions.
- **DO** use `pnpm link --global` (not `npm link`) to test the production build locally; `npm link` is blocked by hooks.
```

### Build Timestamp Injection

The build script injects the current UTC timestamp as a compile-time constant via `bun --define`:

```bash
--define __BUILD_TIME__=$(date -u +'"%Y-%m-%dT%H:%M:%SZ"')
```

In source files, declare it at the top before use:

```typescript
declare const __BUILD_TIME__: string | undefined;
```

Then guard with `typeof` before reading (the constant is undefined in dev/test mode):

```typescript
const buildTime = typeof __BUILD_TIME__ !== "undefined" ? ` (built ${__BUILD_TIME__})` : "";
```

### Type Checking

There is no `typecheck` script in `package.json`. Run type checks with:

```bash
bunx tsc --noEmit
```

### Package Manager

- **DO** use `pnpm` for installing packages and managing the lockfile. The `npm` command is blocked by a pretooluse hook.
- **DO** use `bun add <pkg>` to add new dependencies (updates `package.json` and `bun.lock`).
- **DO** run `pnpm install` after changing `package.json` to regenerate `pnpm-lock.yaml`, then commit it — the stop hook enforces lockfile sync.
- **DON'T** use `npm install` or `npm link`; they are blocked.

### MIME / Email Construction

- **DO** use `nodemailer` with `streamTransport: true` to construct RFC 2822 messages for `gmail.users.messages.send`. It handles header encoding, multipart/mixed boundaries, and attachment MIME types correctly.
- **DON'T** hand-roll RFC 2822 message construction. Hand-rolled implementations hit `no-control-regex` lint errors on non-ASCII header encoding patterns and are fragile.

```typescript
import { createTransport } from "nodemailer";
const transporter = createTransport({ streamTransport: true, newline: "unix" });
const info = await transporter.sendMail(mailOptions);
const stream = info.message as NodeJS.ReadableStream; // Buffer | Readable — cast required
```

## Git & Contribution

- **Branching**:
  - **DO** create feature branches for all changes (e.g., `feat/add-accounts`, `fix/token-refresh`).
  - **DON'T** push directly to `main`. Repository rules block direct pushes.
- **Pull Requests**:
  - **DO** use `gh pr create` to submit changes.
  - **DO** ensure all CI checks pass (`bun test`, `bun run lint`) before merging.
- **CI polling**: Poll with `sleep N && gh pr checks <PR>` in a foreground call. DON'T use `gh pr checks --watch` as a background task — it produces no actionable output until it finishes, leaving a dangling process.
- **Rebasing already-merged commits**: When rebasing a feature branch onto main and a commit was already incorporated via another PR (e.g., the commit's changes are already in main), use `git rebase --skip` to skip that commit rather than attempting to re-resolve its conflicts.

## Important Notes

- Default to Bun for development; the CLI distributes as a Node.js bundle
- ESLint uses flat config in `eslint.config.js`; update both `bun.lock` and `package-lock.json` when adding or changing dependencies
- Don't use better-sqlite3 in Bun scripts (use native `bun:sqlite` via the wrapper)
- Don't use dotenv; Bun automatically loads `.env` files
- All sensitive files (`.credentials.json`, `~/.gwork_tokens.db`) are properly ignored in `.gitignore`
- When adding new Google API operations, follow the existing pattern: Service method → Command handler → CLI interface
