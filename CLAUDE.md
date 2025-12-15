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
```

## Important Notes

- Default to Bun for development; the CLI distributes as a Node.js bundle
- Don't use better-sqlite3 in Bun scripts (use native `bun:sqlite` via the wrapper)
- Don't use dotenv; Bun automatically loads `.env` files
- All sensitive files (`.credentials.json`, `~/.gwork_tokens.db`) are properly ignored in `.gitignore`
- When adding new Google API operations, follow the existing pattern: Service method → Command handler → CLI interface
