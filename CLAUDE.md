# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**gwork** is a comprehensive CLI tool for Google Workspace (Calendar, Gmail, Drive, Contacts). It exposes the Google APIs through a developer-friendly command-line interface.

The codebase is built with TypeScript using Bun as the primary runtime, with additional Node.js compatibility for CLI distribution via npm.

## Development Commands

```bash
# Install dependencies (required before build — bun run build fails on missing modules)
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

# Drive operations
gwork drive list
gwork drive download <fileId>                   # Downloads file; exports Google Docs as .docx
gwork drive download <fileId> --output ./out.pdf
gwork drive upload ./file.pdf --name "Report"
```

### Extracting File IDs from Google URLs

The `drive download` command takes a file ID, not a URL. Extract the ID from Google Workspace URLs:
- `docs.google.com/document/d/<fileId>/edit` → use `<fileId>`
- `docs.google.com/spreadsheets/d/<fileId>/edit` → use `<fileId>`
- `drive.google.com/file/d/<fileId>/view` → use `<fileId>`

## Architecture

### Core Structure

- `src/cli.ts` — entry point; routes top-level commands.
- `src/commands/{accounts,cal,contacts,drive,mail,sheets,docs,slides}.ts` — command dispatchers; `registry.ts` is the shared registry.
- `src/services/{auth-manager,base-service,calendar-service,contacts-service,drive-service,error-handler,mail-service,token-store}.ts` — Google API wrappers; `token-store.ts` is the SQLite-backed multi-account store.
- `src/utils/{args,sqlite-wrapper,setup-guide,format,logger,output,...}.ts` — argument parsing, SQLite abstraction (Bun/Node), credentials onboarding, formatting.
- `src/types/google-apis.ts` — Google API response types.

### Data Flow

`cli.ts` → command handler → service `initialize()` (credentials check, token load/refresh) → Google API call. Tokens persist in `~/.gwork_tokens.db` keyed by `(service, account)`; missing credentials trigger the setup guide.

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
# Output: dist/cli.js (~13 MB minified)

# Key build flags:
# --target=node         : Compile for Node.js runtime
# --minify              : Reduce bundle size
# --external better-sqlite3 : Keep native binary external (not bundled)
```

### Versioning

- **DO** update the version in **both** `package.json` (the `"version"` field) AND `src/cli.ts` (`printVersion` function at line ~202). They must always match.
- There is no `pnpm version` equivalent that updates `src/cli.ts` — edit both files directly with the Edit tool.
- **DO** use `pnpm link --global` (not `npm link`) to test the production build locally; `npm link` is blocked by hooks.

### npm Authentication (Non-Interactive)

`npm login` / `pnpm login` are interactive. Use the registry REST API: write a temp `bun` script that `PUT`s to `https://registry.npmjs.org/-/user/org.couchdb.user:mherod` with `Content-Type: application/json` and `npm-otp: <OTP>` headers and body `{ name, password, type: "user" }`, then append `//registry.npmjs.org/:_authToken=<token>` to `~/.npmrc`. Verify with `pnpm whoami`.

Credentials from 1Password: `op item get npmjs.com --fields Username` / `--fields password --reveal` / `--otp`.

**DON'T** use `bun -e '...'` for scripts containing `!` — `!` triggers shell history expansion. Write to a temp `.ts` file and run with `bun /tmp/script.ts`.

**DON'T** use `python` / `python3` — unreliable and blocked by a pretooluse hook. Use `bun -e` for one-liners or temp `.ts` files for multi-line.

### Publishing

```bash
# Dry run first — verify file list and no sensitive data
pnpm publish --dry-run

# Publish with OTP (retrieve from: op item get npmjs.com --otp)
pnpm publish --otp=<code>
```

### Transitive Dependency Fixes (Vulnerabilities & Deprecations)

This project uses **two separate override mechanisms** that affect different lockfiles:

- **`"overrides"` (root-level)** — read by bun; controls `bun.lock` resolution
- **`"pnpm.overrides"`** — read by pnpm; controls `pnpm-lock.yaml` resolution

**DO** add vulnerability-fixing overrides to the root-level `"overrides"` block (bun reads this, not `pnpm.overrides`). For deprecation-only warnings, `pnpm.overrides` is sufficient.

```json
"overrides": {
  "minimatch": ">=9.0.6",
  "qs": ">=6.14.1",
  "ajv": ">=6.14.0 <7"
},
"pnpm": {
  "overrides": {
    "minimatch": ">=9.0.6",
    "qs": ">=6.14.1",
    "ajv": ">=6.14.0 <7",
    "glob": ">=13.0.6",
    "rimraf": ">=6.1.3",
    "node-domexception": ">=2.0.2"
  }
}
```

After adding an override, run `bun install` to regenerate `bun.lock`, then `bun audit` to confirm no vulnerabilities remain.

**DON'T** use open-ended `>=X` semver ranges that cross a major version boundary. For example, `"ajv": ">=6.14.0"` resolves to ajv v8, which has a completely different API and breaks ESLint v9 (which uses ajv v6 internally). Always cap with `<NEXT_MAJOR`: `"ajv": ">=6.14.0 <7"`.

**DON'T** add `node-domexception` to the bun root `"overrides"`. The v2.x package removed the default export that `fetch-blob` (`import DOMException from 'node-domexception'`) depends on — this breaks the production build with `error: No matching export in "node_modules/node-domexception/index.js" for import "default"`. Leave `node-domexception` in `pnpm.overrides` only.

**DON'T** add a package to `peerDependencies` if it's already in `devDependencies` — this produces a spurious `pnpm link --global` warning about unresolved peers. `typescript` belongs only in `devDependencies`.

**Known unresolvable deprecation warnings**: `node-domexception` (entire package retired upstream — even v2.0.2 is flagged deprecated; no replacement exists) and `prebuild-install@7.1.3` (from `better-sqlite3`, already at latest). These cannot be eliminated via overrides — ignore them if they reappear.

### Build Timestamp Injection

Build injects `__BUILD_TIME__` via `bun --define __BUILD_TIME__=$(date -u +'"%Y-%m-%dT%H:%M:%SZ"')`. In source: `declare const __BUILD_TIME__: string | undefined;` then guard with `typeof __BUILD_TIME__ !== "undefined"` — the constant is undefined in dev/test.

### Type Checking

There is no `typecheck` script in `package.json`. Run type checks with:

```bash
bunx tsc --noEmit
```

### Package Manager

- **DO** use `pnpm` for installing packages and managing the lockfile. The `npm` command is blocked by a pretooluse hook.
- **DO** use `bun add <pkg>` to add new dependencies (updates `package.json` and `bun.lock`).
- **DO** run `bun install` after changing `package.json`. Also run `pnpm install` to regenerate `pnpm-lock.yaml`, then commit it — the stop hook enforces lockfile sync.
- **DO** use `bun run <script>` for running package.json scripts — `pnpm run` is blocked by swiz hooks when a bun lockfile is detected (even though pnpm manages packages). Note: `pnpm link --global` is still valid for global linking.
- **DON'T** use `npm install` or `npm link`; they are blocked.

### better-sqlite3 Native Binding (Local Dev)

After `pnpm install` (or when switching Node.js versions), the `better-sqlite3` native binding may be missing or stale. Run:

```bash
pnpm run rebuild-sqlite3
```

**DON'T** use `pnpm rebuild better-sqlite3` — it silently exits 0 without rebuilding under pnpm's virtual store layout. The `rebuild-sqlite3` script uses `node-gyp rebuild --directory <resolved-path>` which is reliable.

**DON'T** put `npm rebuild better-sqlite3` in scripts — `npm` is blocked by a pretooluse hook.

Symptoms of a missing binding: `Error: Could not locate the bindings file. Tried: .../better_sqlite3.node`

### MIME / Email Construction

- **DO** use `nodemailer` with `streamTransport: true` to construct RFC 2822 messages for `gmail.users.messages.send`. It handles header encoding, multipart/mixed boundaries, and attachment MIME types correctly.
- **DON'T** hand-roll RFC 2822 message construction. Hand-rolled implementations hit `no-control-regex` lint errors on non-ASCII header encoding patterns and are fragile.

```typescript
import { createTransport } from "nodemailer";
const transporter = createTransport({ streamTransport: true, newline: "unix" });
const info = await transporter.sendMail(mailOptions);
const stream = info.message as NodeJS.ReadableStream; // Buffer | Readable — cast required
```

## Shell Scripting Rules

- **DON'T** use `python` or `python3` in Bash commands or scripts. The system Python version is unreliable across environments.
- **DO** use `bun` for inline scripting: `bun -e 'code'` for expressions, `bun script.ts` for files.

## Task Hygiene

- **DO** call `TaskCreate` then `TaskUpdate` (status: `in_progress`) as the very first actions in every session, even for trivial single-command tasks like `pnpm link --global`. The `pretooluse-require-tasks` hook blocks Bash/Edit immediately if no `in_progress` task exists — there is no grace period.
- **DO** always create at least one pending task alongside each in_progress task. CHECK 4 in `pretooluse-require-tasks` blocks Edit/Write/Bash when all incomplete tasks are in_progress and none are pending. Before the first Edit/Bash call, create both the in_progress work task and a pending "Verify changes" or similar next-step task.
- **DON'T** assume that short tasks are exempt. The hook fires regardless of task complexity.

## Git & Contribution

- **Branching**:
  - **DO** create feature branches for all changes (e.g., `feat/add-accounts`, `fix/token-refresh`).
  - **DON'T** push directly to `main`. Repository rules block direct pushes — this applies to release commits too. Create a `chore/release-X.Y.Z` branch, push it, open a PR, and merge via `gh pr merge --squash`.
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
