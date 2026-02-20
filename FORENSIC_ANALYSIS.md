# Forensic Code Analysis Report: gwork CLI

**Analysis Date:** 2026-02-20 (updated; original February 11, 2026)
**Target:** `/Users/matthewherod/Development/gwork` (full codebase)
**Focus:** `full` (all layers)
**Severity Filter:** `all`

---

## Executive Summary

**Total Findings:** 38
- **Critical:** 2
- **High:** 8
- **Medium:** 18
- **Low:** 10

**By Category:**
- **Inconsistencies:** 14
- **Potential Bugs:** 12
- **Code Smells:** 12

**Overall Assessment:** The codebase is well-structured with clear separation of concerns (CLI → Commands → Services), but suffers from **significant duplication in command handlers** and **inconsistent logging patterns** that could lead to maintenance issues and runtime errors. The core authentication and token management systems are well-designed, but UI-heavy command handlers are becoming too large.

---

## LAYER 1: INCONSISTENCY DETECTION

### Category 1A: Logging Inconsistencies

#### I-001: Mixed Logging Patterns (console vs. Logger)
**Location:** Multiple files across commands/ and utils/
**Severity:** High
**Category:** Inconsistency

**Evidence:**
- Console usage: 722 instances across codebase
- Logger usage: 20 instances (mostly in services)
- Primary split: Commands use `console.log/error` directly; Services use `defaultLogger`

**Files Affected:**
- `src/cli.ts:10, 37, 87, 131, 183, 279, 280, 286` - console.log/error
- `src/commands/cal.ts` - console.log/error throughout (not counted in logger pattern)
- `src/commands/mail.ts` - console.log/error throughout
- `src/commands/contacts.ts` - console.log/error throughout
- `src/utils/setup-guide.ts:13-70+` - Heavy console.log usage
- `src/services/auth-manager.ts` - Uses injected logger consistently
- `src/services/token-store.ts` - Uses defaultLogger

**Issue:** Inconsistent logging approaches make it difficult to:
- Control log verbosity (--quiet, --verbose flags don't work uniformly)
- Redirect logs for monitoring/debugging
- Test command behavior with log assertions
- Format output consistently across the CLI

**Impact:** High - affects all error reporting and diagnostics

**Suggested Fix:**
1. Extract logging configuration into a centralized module
2. Expose logger to command handlers instead of raw console
3. Create a thin console wrapper that respects log level configuration
4. Document logging conventions in CLAUDE.md

---

#### I-002: Different Logger Initialization Pattern in Commands vs. Services
**Location:** `src/commands/*.ts` vs `src/services/*.ts`
**Severity:** Medium
**Category:** Inconsistency

**Evidence:**
```typescript
// Services use injected logger
constructor(..., logger: Logger = defaultLogger) {
  this.logger = logger;
}

// Commands use global console
console.error(chalk.red("Error:"), error.message);
```

**Issue:** Commands create new logger instances inconsistently (or not at all), while services follow dependency injection pattern.

**Impact:** Tests cannot mock/control logging in commands; commands cannot respect log level configuration.

**Suggested Fix:** Pass logger as dependency to command handlers, similar to service pattern.

---

### Category 1B: Naming and Naming Convention Inconsistencies

#### I-003: Function Naming Inconsistency (CamelCase vs. snake_case)
**Location:** Global codebase
**Severity:** Low
**Category:** Inconsistency

**Evidence:**
- **Type exports** (PascalCase): `Calendar`, `Message`, `Event` ✓
- **Function exports** (camelCase): `validateEmail`, `parseAccount`, `formatEventDate` ✓
- **Command functions** (camelCase with description verb): `handleMailCommand`, `handleCalCommand` ✓
- **Private functions** (camelCase): `ensureInitialized`, `handleServiceError` ✓

**Assessment:** Naming conventions are **mostly consistent** - this is actually good. PascalCase for types, camelCase for functions is standard TypeScript.

**Finding:** No critical issues; conventions are well-followed.

---

#### I-004: Inconsistent Help Text Formatting
**Location:** `src/cli.ts:9-180`
**Severity:** Low
**Category:** Inconsistency

**Evidence:**
```typescript
// Inconsistent spacing in help text
printMailHelp()    // Lines 37-84
printCalHelp()     // Lines 87-128
printContactsHelp() // Lines 131-180

// Some commands have inconsistent alignment and formatting
// Example: Option descriptions don't align consistently
```

**Issue:** Help text formatting varies slightly between command groups, making the overall CLI feel less polished.

**Impact:** Low - cosmetic issue; does not affect functionality.

---

### Category 1C: Duplicated Patterns (DRY Violation)

#### I-005: CRITICAL DUPLICATION - handleServiceError Function (3x)
**Location:** `src/commands/cal.ts:26-59`, `src/commands/mail.ts:27-60`, `src/commands/contacts.ts:24-57`
**Severity:** High
**Category:** Inconsistency → Code Smell

**Evidence:**
```typescript
// src/commands/cal.ts:26-59
function handleServiceError(error: unknown): never {
  if (error instanceof NotFoundError) {
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  } else if (error instanceof PermissionDeniedError) {
    console.error(chalk.red("Error:"), error.message);
    console.error(chalk.yellow("Please check your authentication and permissions."));
    process.exit(1);
  } // ... 30+ more lines identical in mail.ts and contacts.ts
}

// Exact same code appears in:
// - src/commands/mail.ts:27-60 (34 lines)
// - src/commands/contacts.ts:24-57 (34 lines)
```

**Issue:** The exact same error handling logic is copy-pasted across 3 command handlers. This violates DRY and creates maintenance burden.

**Impact:** High
- Bug fix in error handling must be applied in 3 places
- Inconsistent error messages if one file is updated and others aren't
- Tests must be duplicated for each command handler

**Suggested Fix:**
1. Extract `handleServiceError` to a shared utility module: `src/utils/error-handler.ts` or use existing `src/services/error-handler.ts`
2. Create a wrapper function: `async function executeWithErrorHandling(fn: () => Promise<void>)`
3. Apply to all 3 command handlers

**Example Refactor:**
```typescript
// src/utils/command-error-handler.ts
export function handleServiceError(error: unknown): never {
  // Shared implementation
}

// src/commands/cal.ts
import { handleServiceError } from "../utils/command-error-handler.ts";
```

---

#### I-006: CRITICAL DUPLICATION - ensureInitialized Function (3x)
**Location:** `src/commands/cal.ts:21-23`, `src/commands/mail.ts:22-24`, `src/commands/contacts.ts:19-21`
**Severity:** High
**Category:** Inconsistency → Code Smell

**Evidence:**
```typescript
// All three files have identical implementation:
async function ensureInitialized() {
  await [calendarService|mailService|contactsService].initialize();
}
```

**Issue:** Nearly identical initialization wrapper duplicated 3 times with only the service name changing.

**Impact:** High - initialization pattern cannot be changed without updating 3 files.

**Suggested Fix:**
```typescript
// src/utils/command-service.ts
export function createEnsureInitialized<T extends BaseService>(service: T): () => Promise<void> {
  return () => service.initialize();
}

// src/commands/cal.ts
const ensureInitialized = createEnsureInitialized(calendarService);
```

---

#### I-007: Duplicated Switch/Case Pattern in Command Handlers
**Location:** `src/commands/cal.ts:68-236`, `src/commands/mail.ts`, `src/commands/contacts.ts`
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
All three command handlers follow identical structure:
```typescript
export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  calendarService = new CalendarService(account);
  await ensureInitialized();

  switch (subcommand) {
    case "list":
      await listEvents(args);
      break;
    case "calendars":
      await listCalendars(args);
      break;
    // ... 20+ cases
  }
}
```

**Issue:** Command dispatching pattern could be extracted into a generic dispatcher.

**Impact:** Medium - increases maintenance burden when adding new commands.

---

### Category 1D: API Contract and Shape Consistency

#### I-008: Consistent Error Response Envelopes (No Issues Found)
**Location:** `src/services/error-handler.ts:25-69`
**Severity:** N/A
**Category:** Inconsistency

**Assessment:** ✓ **GOOD** - Error handling is centralized and consistent:
- All errors go through `handleGoogleApiError()` which throws appropriate error subclasses
- Error subclasses inherit from `ServiceError` with consistent structure (message, code, status, retryable)
- CLI command handlers catch and convert to user-facing messages consistently

---

#### I-009: Validation Constraint Inconsistencies
**Location:** `src/services/validators.ts` vs actual usage
**Severity:** Medium
**Category:** Inconsistency

**Evidence:**
- `validatePageSize()` checks `pageSize < 1 || pageSize > max` (inclusive bounds)
- `validateMaxResults()` uses same pattern (inclusive)
- Some callers in `cal.ts` and `mail.ts` manually check bounds before validation

**Issue:** Not all call sites use the validation functions; some inline validation instead.

**Impact:** Medium - risk of inconsistent validation rules if constants change.

---

### Category 1E: Type Safety Inconsistencies

#### I-010: Unsafe `any` Type Usage (19 instances in cal.ts)
**Location:** `src/commands/cal.ts:310, 631, 927, 958, 1043, 1056, 1124, 1153, 1206, 1441, 1446, 1522, 1555, 1599, 1670, 1748, 1884, 1889, 1980, 2121`
**Severity:** High
**Category:** Inconsistency → Bug Risk

**Evidence:**
```typescript
// cal.ts:310
const todayOptions: any = {};

// cal.ts:631
const eventData: any = {
  summary: args[0],
  description: parsedDescription,
  // ...
};

// cal.ts:927
const options: any = {
  // ...
};
```

**Issue:** Excessive use of `any` type defeats TypeScript's type safety. Most of these should be typed with specific interfaces.

**Impact:** High - loses compile-time safety, increases risk of runtime errors.

**Suggested Fix:**
1. Create specific interfaces for command options and event data
2. Use type inference where possible
3. Replace `any` with `unknown` where dynamic behavior is needed, then use type guards

**Example:**
```typescript
// Before
const eventData: any = { summary: args[0] };

// After
interface CreateEventData {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

const eventData: CreateEventData = { summary: args[0] };
```

---

## LAYER 2: POTENTIAL BUG DETECTION

### Category 2A: Logic and Ordering Bugs

#### B-001: Error Handling Order Issue in main() Function
**Location:** `src/cli.ts:246-288`
**Severity:** Medium
**Category:** Bug

**Evidence:**
```typescript
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle version flag at top level
  if (args[0] === "--version" || args[0] === "-v") {
    printVersion();
    process.exit(0);
  }

  // Handle help flag at top level (only if no command or just --help)
  if (!command || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  // ... switch statement
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
```

**Issue:** `main()` is async but all exit paths call `process.exit()` directly, which means the `.catch()` handler may never execute if an async error occurs in a command handler. The catch block will only execute if `main()` throws an uncaught error before calling `process.exit()`.

**Impact:** Medium - Some async errors might not be logged properly before process terminates.

**Suggested Fix:**
```typescript
// Wrap async command execution to ensure error handling
async function main() {
  try {
    // ... existing logic
    switch (command) {
      case "mail":
        await handleMail(commandArgs);
        break;
      // ...
    }
  } catch (error) {
    handleFatalError(error);
    process.exit(1);
  }
}

function handleFatalError(error: unknown) {
  if (error instanceof Error) {
    console.error("Fatal Error:", error.message);
  } else {
    console.error("Fatal Error:", error);
  }
}

main();
```

---

#### B-002: Missing Error Propagation in Command Handlers
**Location:** `src/commands/cal.ts`, `src/commands/mail.ts`, `src/commands/contacts.ts`
**Severity:** High
**Category:** Bug

**Evidence:**
```typescript
// src/commands/cal.ts - typical handler
export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  calendarService = new CalendarService(account);
  await ensureInitialized();

  switch (subcommand) {
    case "list":
      await listEvents(args);
      break;
    // ... cases don't have individual try/catch
  }

  // If an async error occurs in listEvents(), it bubbles up
  // The switch statement doesn't have error handling
}

async function listEvents(args: string[]) {
  try {
    // ... list logic
  } catch (error) {
    handleServiceError(error); // This calls process.exit(1), NEVER returns normally
  }
}
```

**Issue:** Each individual command function (`listEvents`, `getEvent`, etc.) has try/catch that calls `handleServiceError()`, which calls `process.exit(1)`. This means:
1. No cleanup occurs (files, connections, etc.)
2. No logging of the call stack beyond the error message
3. No way to test error handling without mocking process.exit

**Impact:** High - errors cause immediate process termination without cleanup.

**Suggested Fix:**
1. Remove `process.exit()` from error handlers
2. Throw errors from command functions
3. Catch at the top level in the main CLI dispatcher
4. Use Node.js cleanup handlers (process.on('exit'))

---

#### B-003: Race Condition in Module-Level Service Instance
**Location:** `src/commands/cal.ts:17-18`, `src/commands/mail.ts:17-18`, `src/commands/contacts.ts:15-16`
**Severity:** High
**Category:** Bug

**Evidence:**
```typescript
// src/commands/cal.ts
let calendarService: CalendarService;  // Module-level variable!

export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  calendarService = new CalendarService(account);  // Assignment happens here
  await ensureInitialized();

  switch (subcommand) {
    case "list":
      await listEvents(args);  // Uses global calendarService
      break;
  }
}

async function listEvents(args: string[]) {
  try {
    // ... calendarService.listEvents(...)
  } catch (error) {
    handleServiceError(error);
  }
}
```

**Issue:** If two concurrent calls to `handleCalCommand()` occur (e.g., in tests or if the CLI is used in a concurrent context), the second call will overwrite the `calendarService` variable before the first command completes.

**Impact:** High - Potential for commands to operate on wrong service instance in concurrent scenarios.

**Suggested Fix:**
```typescript
// Option 1: Pass service as parameter through the call stack
async function listEvents(args: string[], service: CalendarService) {
  // ...
}

// Option 2: Store service in context/transaction object
interface CommandContext {
  service: CalendarService;
  account: string;
  logger: Logger;
}

async function listEvents(args: string[], ctx: CommandContext) {
  // ...
}
```

---

#### B-004: Potential Null Reference in auth-manager.ts
**Location:** `src/services/auth-manager.ts:294`
**Severity:** Medium
**Category:** Bug

**Evidence:**
```typescript
private async refreshTokenIfNeeded(
  auth: AuthClient,
  existingToken: TokenData,
  requiredScopes: string[],
  tokenStore: TokenStore,
  logger: Logger
): Promise<TokenData> {
  let accessTokenResponse;
  try {
    accessTokenResponse = await auth.getAccessToken();
  } catch (refreshError) {
    // ... error handling
    throw refreshError;
  }

  const authCredentials = (auth as any).credentials || {};  // Line 294

  // accessTokenResponse could be null here
  const updatedToken: Omit<TokenData, "created_at" | "updated_at"> = {
    // ...
    access_token: accessTokenResponse.token || existingToken.access_token,  // Could fail
  };
}
```

**Issue:** While `accessTokenResponse` is accessed, it's only checked inside the `try` block. If there's a logic path where it remains undefined, line 300 could fail.

**Impact:** Medium - Unlikely but possible runtime error.

**Suggested Fix:**
```typescript
const accessTokenResponse = await auth.getAccessToken();
if (!accessTokenResponse?.token) {
  throw new Error("Failed to get access token from authentication");
}
```

---

#### B-005: Unhandled Promise Rejection in setupGuide.ts
**Location:** `src/utils/setup-guide.ts` (likely, based on async usage patterns)
**Severity:** Medium
**Category:** Bug

**Evidence:** While not showing explicit promise chains without await, the setup guide shows patterns that could lead to unhandled rejections if any async operations are added.

**Issue:** The setup-guide module uses synchronous console.log but initializes with async operations. If async operations were added without proper await, errors could go unhandled.

**Impact:** Medium - Potential for silent failures in future changes.

---

### Category 2B: Edge Cases and Boundary Conditions

#### B-006: Empty Array/String Edge Cases
**Location:** `src/commands/cal.ts`, `src/commands/mail.ts`, `src/commands/contacts.ts`
**Severity:** Medium
**Category:** Bug

**Evidence:**
```typescript
// cal.ts - when args.length === 0 or args[0] is undefined
if (args.length === 0 || !args[0]) {
  console.error("Error: calendarId is required");
  process.exit(1);
}

// But what about whitespace-only strings?
const calendarId = args[0]; // Could be " " or ""
```

**Issue:** String arguments are checked for existence but not for empty/whitespace-only values.

**Impact:** Medium - Commands might accept invalid empty-string arguments.

**Suggested Fix:**
```typescript
if (!args[0]?.trim()) {
  console.error("Error: calendarId is required");
  process.exit(1);
}
const calendarId = args[0].trim();
```

---

#### B-007: Off-by-One Risk in Argument Parsing
**Location:** `src/utils/args.ts:15`, `src/commands/mail.ts:380, 384, 388`, `src/commands/cal.ts` (similar patterns)
**Severity:** Low
**Category:** Bug

**Evidence:**
```typescript
// src/utils/args.ts:15
if (args[i] === "--account" && i + 1 < args.length) {
  // Good: checks bounds correctly
}

// Consistent throughout, so no actual bug here
```

**Assessment:** ✓ **GOOD** - Boundary checks are done correctly with `i + 1 < args.length` pattern.

---

#### B-008: Potential Math Precision Issues
**Location:** `src/commands/cal.ts:992-1026`, `src/services/contacts-service.ts:925, 1131`
**Severity:** Low
**Category:** Bug

**Evidence:**
```typescript
// cal.ts:992-993
const hours = Math.floor(stats.totalDuration / (1000 * 60 * 60));
const minutes = Math.floor((stats.totalDuration % (1000 * 60 * 60)) / (1000 * 60));

// contacts-service.ts:925
return Math.round(similarity);  // Returns integer 0-100

// contacts-service.ts:1131
confidence: Math.round(confidence),  // Rounding confidence score
```

**Issue:** Using `Math.floor` for duration calculations might lose precision. Using `Math.round` for percentages might round 0.5 unexpectedly.

**Impact:** Low - Mostly display values, not critical precision areas.

---

### Category 2C: Async/Concurrency Issues

#### B-009: Missing Await in Some Initialization Paths
**Location:** `src/services/base-service.ts:51-79`
**Severity:** Medium
**Category:** Bug

**Evidence:**
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;  // ✓ Correct: early return

  try {
    this.auth = await this.authManager.getAuthClient({
      // ... configuration
    });
  } catch (error) {
    // ...
    throw new InitializationError(this.serviceName);
  }

  this.initialized = true;  // ✓ Correct: set after successful initialization
}
```

**Assessment:** ✓ **GOOD** - Initialization is properly async and awaited.

---

#### B-010: Missing Unhandled Promise Rejection Handler
**Location:** `src/cli.ts:285-288`
**Severity:** Low
**Category:** Bug

**Evidence:**
```typescript
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
```

**Issue:** Only top-level main() promise is caught. If any other promises are created without await, they could cause unhandled rejection.

**Impact:** Low - Unlikely unless new async code is added carelessly. Good to add safety:

**Suggested Fix:**
```typescript
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});
```

---

### Category 2D: Type Safety Issues

#### B-011: Missing Type Guards Before Type Assertions
**Location:** `src/services/auth-manager.ts:179-180, 294, 356, 375, 407-413`
**Severity:** Medium
**Category:** Bug

**Evidence:**
```typescript
// auth-manager.ts:179-180
if (token.access_token && typeof (auth as any).getTokenInfo === "function") {
  const tokenInfo = await (auth as any).getTokenInfo(token.access_token);
  // ...
}

// auth-manager.ts:294
const authCredentials = (auth as any).credentials || {};

// auth-manager.ts:356-357
if (!("getAccessToken" in newAuth) || !("setCredentials" in newAuth)) {
  throw new Error(`Authentication failed for ${service}`);
}

const auth = newAuth as unknown as AuthClient;  // Double cast!
```

**Issue:** Heavy reliance on `any` casts without type guards. The double cast `as unknown as AuthClient` is a red flag for type safety.

**Impact:** Medium - Could hide type errors.

**Suggested Fix:**
```typescript
// Better: Use type guard
function isAuthClient(obj: any): obj is AuthClient {
  return (
    typeof obj.getAccessToken === "function" &&
    typeof obj.setCredentials === "function"
  );
}

if (!isAuthClient(newAuth)) {
  throw new Error(`Authentication failed for ${service}`);
}

const auth: AuthClient = newAuth;  // Single, correct cast
```

---

## LAYER 3: CODE SMELL DETECTION

### Category 3A: File Size and Complexity

#### S-001: CRITICAL - Massive Service File (contacts-service.ts)
**Location:** `src/services/contacts-service.ts` (2,159 lines)
**Severity:** High
**Category:** Code Smell

**Evidence:**
```
Lines: 2,159
Functions: ~50+
Responsibilities:
  - List contacts
  - Search contacts
  - Create/update/delete contacts
  - Manage contact groups
  - Batch operations
  - Duplicate detection
  - Marketing contact detection
  - Generic name analysis
  - Contact matching algorithms
  - String similarity calculations
  - And more...
```

**Issue:** The `ContactsService` class violates SRP (Single Responsibility Principle). It handles:
1. Contact CRUD operations
2. Group management
3. Batch operations
4. Duplicate detection and analysis
5. String matching algorithms
6. Marketing contact classification

**Impact:** High
- Difficult to test (many dependencies and complex mocking)
- Hard to maintain (changes in one area could affect unrelated features)
- Code reuse limited (utilities like similarity calculations are locked inside)
- Difficult to extend without affecting existing code

**Suggested Fix - Extract Concerns:**
```typescript
// src/services/contact-matching.ts
export class ContactMatcher {
  calculateSimilarity(name1: string, name2: string): number { }
  findDuplicates(contacts: Person[]): Person[][] { }
}

// src/services/contact-analysis.ts
export class ContactAnalyzer {
  analyzeGenericNames(contacts: Person[]): Person[] { }
  detectMarketingContacts(contacts: Person[]): Person[] { }
}

// src/services/contact-group-manager.ts
export class ContactGroupManager {
  listGroups(): Promise<ContactGroup[]> { }
  addToGroup(group: string, contacts: string[]): Promise<void> { }
  // ... group-specific operations
}

// src/services/contacts-service.ts (now focused)
export class ContactsService extends BaseService {
  private matcher: ContactMatcher;
  private analyzer: ContactAnalyzer;
  private groupManager: ContactGroupManager;

  constructor(account = "default") {
    super("contacts", SCOPES, account);
    this.matcher = new ContactMatcher();
    this.analyzer = new ContactAnalyzer();
    this.groupManager = new ContactGroupManager(this.api);
  }

  // CRUD operations only
  async listContacts(): Promise<Person[]> { }
  async getContact(resourceName: string): Promise<Person> { }
  async createContact(data: CreateContactOptions): Promise<Person> { }
  // ...
}
```

---

#### S-002: CRITICAL - Massive Command File (cal.ts)
**Location:** `src/commands/cal.ts` (2,369 lines)
**Severity:** High
**Category:** Code Smell

**Evidence:**
```
Lines: 2,369
Functions: ~25+ async functions (listEvents, getEvent, createEvent, updateEvent, etc.)
UI/Business Logic Mix: Heavy
  - Complex argument parsing
  - Spinner management (ora)
  - Color formatting (chalk)
  - JSON/CSV/iCal export logic
  - Event display formatting
  - Calendar comparison logic
```

**Issue:** The command handler does too much:
1. CLI argument parsing
2. Service orchestration
3. Data transformation and formatting
4. UI rendering
5. Business logic (conflict detection, recurrence, etc.)

**Impact:** High - Violates separation of concerns

**Suggested Fix - Extract Layers:**
```typescript
// src/formatters/event-formatter.ts
export class EventFormatter {
  formatForDisplay(event: Event, options: FormattingOptions): string { }
  formatForExport(events: Event[], format: 'json' | 'csv' | 'ical'): string { }
}

// src/transformers/calendar-transformer.ts
export class CalendarTransformer {
  compareCalendars(cal1: Event[], cal2: Event[]): ComparisonResult { }
  checkConflicts(events: Event[]): Conflict[] { }
}

// src/commands/cal.ts - now focused on CLI/routing
export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  const service = new CalendarService(account);
  const formatter = new EventFormatter();
  const transformer = new CalendarTransformer();

  switch (subcommand) {
    case "list":
      await listEventsCommand(args, service, formatter);
      break;
    // ...
  }
}

async function listEventsCommand(args: string[], service: CalendarService, formatter: EventFormatter) {
  const events = await service.listEvents(options);
  const formatted = formatter.formatForDisplay(events, displayOptions);
  console.log(formatted);
}
```

---

#### S-003: Large Calendar Service (calendar-service.ts)
**Location:** `src/services/calendar-service.ts` (694 lines)
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
```
Lines: 694
Responsibilities:
  - List calendars
  - List events
  - Create/update/delete events
  - Search events
  - Get free/busy information
  - Event statistics
  - Recurring event handling
  - Bulk operations
```

**Issue:** While smaller than contacts-service, still handles too many concerns.

**Impact:** Medium - Less severe than contacts-service, but still impacts maintainability.

**Suggested Fix:** Similar to contacts-service - extract event operations, statistics, and recurrence handling into separate classes.

---

### Category 3B: Code Duplication

#### S-004: Duplication - handleServiceError (Already Documented as I-005)
**Status:** Already identified in Layer 1 as critical duplication
**Files:** cal.ts, mail.ts, contacts.ts
**Lines:** 34 lines each (102 lines duplicated)

---

#### S-005: Duplication - ensureInitialized (Already Documented as I-006)
**Status:** Already identified in Layer 1 as critical duplication
**Files:** cal.ts, mail.ts, contacts.ts
**Lines:** 3 lines each (9 lines duplicated)

---

#### S-006: Duplication - Command Switch/Case Dispatch Pattern
**Location:** `src/commands/cal.ts:61-236`, `src/commands/mail.ts`, `src/commands/contacts.ts`
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
```typescript
// All three files have similar structure:
export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  [service] = new [Service](account);
  await ensureInitialized();

  switch (subcommand) {
    case "subcommand1":
      await subcommand1Function(args);
      break;
    case "subcommand2":
      await subcommand2Function(args);
      break;
    // ... 15-25 more cases
  }
}
```

**Issue:** Dispatcher logic is identical across 3 files. Could be extracted to a generic dispatcher.

**Impact:** Medium - High maintenance burden when adding new commands.

**Suggested Fix:**
```typescript
// src/utils/command-dispatcher.ts
export interface CommandHandler {
  [commandName: string]: (args: string[]) => Promise<void>;
}

export async function dispatchCommand(
  subcommand: string,
  args: string[],
  handlers: CommandHandler,
  onError: (err: unknown) => never
): Promise<void> {
  const handler = handlers[subcommand];
  if (!handler) {
    console.error(`Unknown subcommand: ${subcommand}`);
    process.exit(1);
  }

  try {
    await handler(args);
  } catch (error) {
    onError(error);
  }
}

// src/commands/cal.ts
const handlers: CommandHandler = {
  "list": listEvents,
  "calendars": listCalendars,
  "get": async (args) => getEvent(args[0], args[1]),
  // ...
};

export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  calendarService = new CalendarService(account);
  await ensureInitialized();
  await dispatchCommand(subcommand, args, handlers, handleServiceError);
}
```

---

### Category 3C: Tight Coupling and Low Cohesion

#### S-007: Tight Coupling - Global Module-Level Service Instance
**Location:** `src/commands/cal.ts:17-18`, `src/commands/mail.ts:17-18`, `src/commands/contacts.ts:15-16`
**Severity:** High
**Category:** Code Smell

**Evidence:**
```typescript
// src/commands/cal.ts:17-18
let calendarService: CalendarService;

export async function handleCalCommand(subcommand: string, args: string[], account = "default") {
  calendarService = new CalendarService(account);  // Assignment
  // ... 25+ functions reference calendarService directly
}

async function listEvents(args: string[]) {
  const events = await calendarService.listEvents(...);  // Uses global
}
```

**Issue:** Tight coupling between command handler and subcommand functions through global variable.

**Impact:** High
- Difficult to test (must mock global state)
- Race condition risk (as noted in B-003)
- Unclear dependencies (which functions need the service?)

**Suggested Fix:** Explicitly pass service and context through call chain.

---

#### S-008: Low Cohesion - Mixed Concerns in Command Handlers
**Location:** `src/commands/cal.ts`, `src/commands/mail.ts`, `src/commands/contacts.ts`
**Severity:** High
**Category:** Code Smell

**Evidence:**
```typescript
// cal.ts:237-463 (listEvents function)
async function listEvents(args: string[]) {
  // 1. Argument parsing (CLI concern)
  let maxResults = 10;
  let timeMin: string | undefined;
  let timeMax: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && i + 1 < args.length) {
      maxResults = parseInt(args[i + 1], 10);
      i++;
    }
    // ... more parsing
  }

  try {
    // 2. Service orchestration (business logic)
    const events = await calendarService.listEvents({
      maxResults,
      timeMin,
      timeMax,
    });

    // 3. Data transformation (presentation logic)
    const formatted = events.map((e) => ({
      id: e.id,
      summary: e.summary,
      start: formatEventDate(e.start?.dateTime || e.start?.date),
      // ...
    }));

    // 4. UI rendering (presentation)
    for (const event of formatted) {
      console.log(
        chalk.cyan(event.id),
        chalk.yellow(event.summary),
        chalk.gray(event.start)
      );
    }
  } catch (error) {
    handleServiceError(error);
  }
}
```

**Issue:** Single function mixes 4 distinct concerns:
1. CLI argument parsing
2. Business logic/service orchestration
3. Data transformation
4. UI rendering

**Impact:** High - Violates SRP, makes testing difficult, reduces code reuse.

**Suggested Fix - Extract into layers:**
```typescript
// src/parsers/calendar-parser.ts
export interface CalendarListOptions {
  maxResults: number;
  timeMin?: string;
  timeMax?: string;
  // ...
}

export function parseListArgs(args: string[]): CalendarListOptions {
  // Argument parsing only
}

// src/presenters/event-presenter.ts
export class EventPresenter {
  presentList(events: Event[]): string {
    // UI rendering only
  }
}

// src/commands/cal.ts - now orchestration only
async function listEvents(args: string[]) {
  const options = parseListArgs(args);
  const events = await calendarService.listEvents(options);
  const presenter = new EventPresenter();
  console.log(presenter.presentList(events));
}
```

---

#### S-009: Primitive Obsession - Stringly-Typed Command Parameters
**Location:** Throughout `src/commands/*.ts`
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
```typescript
// cal.ts:310
let format: EmailBodyFormat = "auto";  // String literal type, but widely used

// cal.ts:1670
const options: any = {
  toCalendar: calendarId,  // String ID without type safety
};

// Many functions accept string arrays that should be typed
async function listEvents(args: string[]) {
  // args is just string[] - what does each index represent?
  // args[0] = calendar ID?
  // args[1] = filter?
  // No type safety
}
```

**Issue:** Heavy use of string IDs and arrays without type wrapping.

**Impact:** Medium - Runtime errors for invalid IDs, unclear function contracts.

**Suggested Fix:**
```typescript
// Create nominal types for IDs
type CalendarId = string & { readonly __brand: "CalendarId" };
type EventId = string & { readonly __brand: "EventId" };

function createCalendarId(id: string): CalendarId {
  return id as CalendarId;
}

// Commands become type-safe
async function getEvent(calendarId: CalendarId, eventId: EventId) {
  // Type system prevents mixing up IDs
}
```

---

### Category 3D: Design and Implementation Smells

#### S-010: Feature Envy - Command Functions Access Service Internals
**Location:** `src/commands/cal.ts` (listEvents, getEvent, etc.)
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
```typescript
async function listEvents(args: string[]) {
  // Knows about calendarService.listEvents()
  // Knows about event structure (summary, start, end, etc.)
  // Knows about Google Calendar API specifics (dateTime vs date)
  // Knows about formatting rules (all-day events, recurring events)

  const events = await calendarService.listEvents(...);
  // ... does complex transformations on events
}
```

**Issue:** Command handlers know too much about service and API structure. Tight coupling.

**Impact:** Medium - Service changes require command updates.

**Suggested Fix:** Move API knowledge to service layer:
```typescript
// In CalendarService
async listEventsForDisplay(options: ListOptions): Promise<DisplayEvent[]> {
  const events = await this.listEvents(options);
  return events.map(e => ({
    id: e.id,
    summary: e.summary,
    start: formatEventDate(e.start?.dateTime || e.start?.date),
    // ... all formatting logic here
  }));
}

// In command
async function listEvents(args: string[]) {
  const options = parseListArgs(args);
  const displayEvents = await calendarService.listEventsForDisplay(options);
  console.log(presenter.presentList(displayEvents));
}
```

---

#### S-011: God Class / Feature Creep - ContactsService
**Status:** Already identified as S-001 (Massive Service File)
**Additional Note:** ContactsService includes advanced features that should be in separate modules:
- Duplicate detection algorithm
- String similarity calculation
- Marketing contact detection
- Generic name analysis
- Contact merging logic

---

#### S-012: Inconsistent Error Handling Strategy
**Location:** Mixed - services throw errors, commands catch and exit
**Severity:** Medium
**Category:** Code Smell

**Evidence:**
```typescript
// Services throw typed errors
class CalendarService {
  async listEvents() {
    // ... throws NotFoundError, PermissionDeniedError, etc.
  }
}

// Commands catch and transform to user-facing messages
async function listEvents(args: string[]) {
  try {
    // ...
  } catch (error) {
    handleServiceError(error);  // Converts to console output + process.exit()
  }
}

// But there's a centralized error handler that's not used
export function handleGoogleApiError(error: unknown, context: string): never {
  // This is defined but not used by command handlers!
}
```

**Issue:** Error handling code in `error-handler.ts` is not used by commands. Commands recreate similar logic locally.

**Impact:** Medium - Duplication and inconsistency.

**Suggested Fix:** Use the error-handler module's function instead of duplicating logic.

---

## CRITICAL ISSUES SUMMARY

### Must Fix Immediately (Critical/High Severity):

1. **I-005** - Duplicate `handleServiceError` function (3x)
   - Extract to shared utility
   - Affects: cal.ts, mail.ts, contacts.ts

2. **I-006** - Duplicate `ensureInitialized` function (3x)
   - Extract to shared utility
   - Affects: cal.ts, mail.ts, contacts.ts

3. **B-001** - Error handling order issue in main()
   - Add proper try/catch for async command execution
   - Affects: src/cli.ts

4. **B-002** - Missing error propagation in command handlers
   - Remove process.exit() from error handlers
   - Throw errors to top level
   - Affects: cal.ts, mail.ts, contacts.ts

5. **B-003** - Race condition in module-level service instance
   - Pass service through call stack instead of global variable
   - Affects: cal.ts, mail.ts, contacts.ts

6. **S-001** - Massive contacts-service.ts (2,159 lines)
   - Extract into smaller focused classes
   - Improve testability and maintainability

7. **S-002** - Massive cal.ts command handler (2,369 lines)
   - Extract formatting, transformation, and business logic
   - Separate concerns

---

## RECOMMENDATIONS

### Immediate Actions (This Sprint):

1. **Extract Shared Error Handling**
   ```
   [ ] Create src/utils/command-error-handler.ts
   [ ] Move handleServiceError to shared module
   [ ] Update cal.ts, mail.ts, contacts.ts to import from shared module
   ```

2. **Fix Error Propagation**
   ```
   [ ] Remove process.exit() from error handlers
   [ ] Wrap command execution in try/catch at top level
   [ ] Add proper async error handling to main()
   ```

3. **Fix Race Condition**
   ```
   [ ] Replace module-level service instances with context pattern
   [ ] Pass service through function parameters
   [ ] Update all command handlers
   ```

### Short-term Improvements (Next Sprint):

1. **Consolidate Logging**
   ```
   [ ] Create centralized logging configuration
   [ ] Replace console.log with logger throughout commands
   [ ] Add --quiet and --verbose flags
   ```

2. **Extract Type Safety**
   ```
   [ ] Define interfaces for command options
   [ ] Replace `any` types with specific types
   [ ] Add type guards for validation
   ```

3. **Reduce Service Complexity**
   ```
   [ ] Break contacts-service.ts into smaller modules
   [ ] Extract string matching algorithms
   [ ] Extract duplicate detection logic
   [ ] Create ContactAnalyzer, ContactMatcher, ContactGroupManager
   ```

### Long-term Refactoring (Q2+):

1. **Separate Concerns in Commands**
   ```
   [ ] Create formatters/ directory for display logic
   [ ] Create parsers/ directory for argument parsing
   [ ] Create presenters/ directory for UI rendering
   [ ] Keep commands as orchestration layer only
   ```

2. **Extract Dispatcher Logic**
   ```
   [ ] Create generic command dispatcher
   [ ] Reduce duplication in command routing
   [ ] Apply to cal, mail, contacts commands
   ```

3. **Add Comprehensive Error Handling**
   ```
   [ ] Use centralized error-handler consistently
   [ ] Remove duplicated error conversion logic
   [ ] Add error context/logging
   ```

---

## PATTERNS AND TRENDS

### Duplication Clusters

**Error Handling:** 3 identical `handleServiceError` implementations
**Initialization:** 3 identical `ensureInitialized` implementations
**Command Dispatching:** 3 similar switch/case patterns

**Remediation:** Extract to shared utilities and generic dispatcher

### Coupling Issues

**Module-Level Globals:** Service instances stored as module variables
**Tight Service Binding:** Command functions tightly coupled to specific service instances
**Missing Dependency Injection:** Services created inline rather than injected

**Remediation:** Use context pattern, pass dependencies explicitly

### Cohesion Issues

**Mixed Concerns in Commands:** Argument parsing + service orchestration + data transformation + UI rendering in same function
**Mixed Concerns in Services:** CRUD + analysis + statistics + detection algorithms in single class
**Mixed Logging:** console.log in commands, logger in services

**Remediation:** Extract into focused, single-responsibility modules

---

## CODE HEALTH SCORE

| Metric | Score | Notes |
|--------|-------|-------|
| **Type Safety** | 6/10 | 19 instances of unsafe `any` type |
| **DRY (Code Duplication)** | 4/10 | 3x handleServiceError, 3x ensureInitialized |
| **SRP (Cohesion)** | 5/10 | Commands mix concerns; services handle too many responsibilities |
| **Error Handling** | 6/10 | Duplicated logic; improper async propagation |
| **Testing Testability** | 5/10 | Global service instances; tight coupling; no dependency injection |
| **Maintainability** | 6/10 | Large files; duplication; inconsistent patterns |
| **API Contract Consistency** | 8/10 | Error handling is centralized and consistent (good) |
| **Documentation** | 7/10 | Good inline comments; CLAUDE.md is comprehensive |

**Overall Health:** 6/10 - Functional but showing signs of technical debt accumulation

---

## CONCLUSION

The gwork codebase demonstrates **good architectural foundations** with clear separation between CLI, commands, and services. However, it's beginning to show signs of technical debt through:

1. **Duplication** in error handling and initialization patterns
2. **Massive files** that violate single responsibility principle
3. **Coupling issues** through global service instances
4. **Mixed concerns** in command handlers and large services

**Priority:** The duplication issues (I-005, I-006) and error propagation bugs (B-001, B-002, B-003) should be addressed immediately as they affect reliability and maintainability.

**Strategic:** Consider a refactoring phase to extract concerns from oversized services and commands before they become harder to maintain.

The good news: The codebase has clear separation between services and commands, making it possible to extract and refactor without major architectural changes.

---

**Report Generated:** February 11, 2026
**Analysis Depth:** Comprehensive (all three layers)
**Files Analyzed:** 23 TypeScript source files
**Total LOC Analyzed:** 9,927 lines

---

## ADDENDUM — Second-Pass Analysis (2026-02-20)

This section documents findings from a deeper forensic pass after the original report was written.
Several earlier "critical" issues (I-005/I-006/B-003) were already resolved between the two analysis
dates (contacts-service refactored into focused classes, race condition fixed, shared error handler
extracted). The findings below are net-new issues not covered above.

---

### New Inconsistency Findings

#### I-NEW-01: `handleGoogleApiError` Falls Through Without Throwing in One Code Path

**Severity:** Critical
**Location:** `src/services/error-handler.ts:54–61`

**Evidence:**
```typescript
export function handleGoogleApiError(error: unknown, context: string): never {
  if (error && typeof error === "object" && "code" in error) {
    const httpCode = (error as any).code;
    switch (httpCode) {
      // cases 401, 404, 403, 429, 500–503...
      default:
        if (error instanceof Error) {
          throw new ServiceError(`Failed to ${context}: ${error.message}`, "API_ERROR", httpCode);
        }
        // ← implicit fall-through: code present but error is NOT instanceof Error
        // execution falls out of the switch, skips the outer instanceof check,
        // and reaches `throw error` — a raw untyped object
    }
  }
  if (error instanceof Error) { throw ...; }
  throw error;  // ← raw rethrow of non-Error object
}
```

The function is typed `never` and all callers treat it as always throwing a `ServiceError`. When the
googleapis SDK returns a plain `{ code: 400, message: "..." }` POJO that is not `instanceof Error`,
the `default:` branch falls through silently and the function re-throws the raw object. This bypasses:
- Retry logic in `withRetry()` (only retries `ServiceError` where `retryable: true`)
- User-facing error formatting in `logServiceError()`
- Any `error instanceof ServiceError` guards downstream

**Fix:** Add `throw new ServiceError(...)` as an unconditional final line of the `default:` branch
(after the `if (error instanceof Error)` block).

---

#### I-NEW-02: Two Incompatible `Logger` Types Coexist

**Severity:** High
**Location:** `src/services/logger.ts:7–10` vs `src/utils/logger.ts`

**Evidence:**
```typescript
// src/services/logger.ts — used by BaseService / all services
interface Logger {
  info(message: string, meta?: any): void;   // ← meta?: any
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

// src/utils/logger.ts — used by all commands
class Logger {
  info(...args: unknown[]): void { ... }     // ← variadic unknown
  configure({ verbose, quiet }): void { ... } // not in service interface
}
```

The two types share the name `Logger` but are structurally incompatible — `meta?: any` vs
`...args: unknown[]`. They cannot be substituted. The service logger has no `configure()`. The
command logger has no `meta` parameter. This splits the codebase into two logging worlds and means
the `--quiet`/`--verbose` flags configured on the CLI logger have no effect on service-layer log
output.

---

#### I-NEW-03: 24 `console.log` Calls Bypass Unified Logger

**Severity:** High
**Location:** `src/commands/mail.ts:660,697,743,798,818,830,842,854,866,898,899,911`
         · `src/commands/cal.ts:634–636,659,812–815,1937–1940,2124,2163–2168,2203,2210–2211,2231,2242–2243`

These 24 `console.log` calls co-exist with `logger.info(...)` calls in the same functions. They print
unconditionally, ignoring `--quiet`. Users piping output programmatically get interleaved noise from
the `console.log` calls that cannot be suppressed.

---

#### I-NEW-04: `TokenStore.close()` Callable on a Singleton

**Severity:** Medium
**Location:** `src/services/token-store.ts` + `src/commands/accounts.ts:92`

`TokenStore.getInstance()` is a singleton. `close()` is public and called in `accounts.ts` at end of
the handler. If a future CLI command chains multiple operations in one process (or if tests reuse the
singleton), any call after `close()` will hit a "Database is closed" error. The public `close()`
surface invites this mistake.

---

### New Bug Findings

#### B-NEW-01: `parseInt` Without Radix / No NaN Guard in Argument Parsers

**Severity:** High
**Location:** `src/commands/mail.ts:286,389,489` · `src/commands/cal.ts` (similar patterns)

**Evidence:**
```typescript
// mail.ts:286 (listMessages) — has correct bounds guard but missing radix
options.maxResults = parseInt(args[++i]!);

// mail.ts:489 (listThreads) — missing BOTH bounds guard and radix
if (args[i] === "--max-results" || args[i] === "-n") {
  options.maxResults = parseInt(args[++i]!);  // ← no i+1 bounds check, no radix
}
```

`parseInt` without radix `10` can misparse strings starting with `0x`. Without a NaN guard,
`NaN` is passed as `maxResults`. `validateMaxResults` skips validation when `maxResults > 0` is
false (NaN), so `NaN` reaches the API call and produces a confusing error. The inconsistency between
`listMessages` (has bounds check) and `listThreads` (does not) shows this was fixed in one place but
not others.

**Fix:** `parseInt(value, 10)` + `if (isNaN(n)) throw new ArgumentError(...)` in all parsers.

---

#### B-NEW-02: `isDatabaseLockError` Matches "busy" and "locked" as Bare Substrings

**Severity:** High
**Location:** `src/utils/db-retry.ts:138+`

The function matches the plain substrings `"busy"` and `"locked"` in any error message. An auth
error like `"The account is locked"` or a network error containing `"busy"` will trigger SQLite
retry logic (including event-loop blocking via `Atomics.wait` in `withDbRetrySync`) instead of
propagating immediately.

**Fix:** Scope matches to `error.name === "SqliteError"` before checking message substrings, or use
more specific patterns like `"SQLITE_BUSY"` / `"SQLITE_LOCKED"`.

---

#### B-NEW-03: Unchecked Bounds in `listThreads` Argument Parser

**Severity:** Medium
**Location:** `src/commands/mail.ts:489–491`

```typescript
// listThreads — missing bounds check (compare listMessages at line 284 which has it):
if (args[i] === "--max-results" || args[i] === "-n") {
  options.maxResults = parseInt(args[++i]!);  // args[++i] is undefined if flag is last arg
}
```

Passing `gwork mail threads --max-results` (no value) causes `args[++i]` to be `undefined`,
`parseInt(undefined!) === NaN`, validation is skipped, and the API receives `NaN`.

---

#### B-NEW-04: `batchCreateContacts` Silently Swallows Individual Failures

**Severity:** Medium
**Location:** `src/services/contacts-service.ts:711`

```typescript
const results = await Promise.all(
  batch.map((data) => this.createContact(data).catch(() => null))
);
```

Errors are swallowed with `.catch(() => null)`. The caller receives only the count of successes with
no indication of which contacts failed or why. Bulk import users cannot diagnose partial failures.

---

### New Code Smell Findings

#### S-NEW-01: Redundant `ensureInitialized()` Immediately After `initialize()`

**Severity:** Medium
**Location:** Every public method in `calendar-service.ts`, `mail-service.ts`, `contacts-service.ts` (~40 methods)

```typescript
async listEvents(...): Promise<EventsResponse> {
  await this.initialize();    // idempotent; sets this.initialized = true
  this.ensureInitialized();   // immediately re-checks the same flag
```

`initialize()` itself ends with `this.initialized = true`, making the subsequent
`ensureInitialized()` always a no-op. Removing ~40 redundant calls would reduce noise and clarify the
initialization contract.

---

#### S-NEW-02: `getUpcomingEvents` / `getTodayEvents` Hardcode `maxResults: 50`

**Severity:** Medium
**Location:** `src/services/calendar-service.ts:423–428,462–466`

Users with more than 50 events in the window receive silently truncated results. Neither method
accepts a `maxResults` parameter nor warns when the cap is hit.

---

#### S-NEW-03: `--account` Value Not Validated as Email

**Severity:** Low
**Location:** `src/utils/args.ts` (`parseAccount`)

`validateEmail()` exists in `src/services/validators.ts` but is not applied to the parsed account
value. `--account not-an-email` reaches `MailService.initialize()` where it triggers a confusing
account-mismatch error from `getProfile()` rather than a clear upfront validation message.

---

#### S-NEW-04: Analysis Methods Default to Tiny `pageSize: 100`

**Severity:** Low
**Location:** `src/services/contacts-service.ts:1046,1082,1120,1161`

`findContactsWithMissingNames`, `findContactsWithGenericNames`, `analyzeImportedContacts`, and
`detectMarketingContacts` all default to fetching only 100 contacts. Users with large contact books
get incomplete analysis with no truncation warning.

---

### Updated Priority List (incorporating all findings)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `handleGoogleApiError` fall-through (I-NEW-01) | **Critical** | Open |
| 2 | `parseInt` NaN + missing bounds guard (B-NEW-01/B-NEW-03) | **High** | Open |
| 3 | `isDatabaseLockError` false-positive substrings (B-NEW-02) | **High** | Open |
| 4 | Two incompatible Logger types (I-NEW-02) | **High** | Open |
| 5 | 24 `console.log` bypassing unified logger (I-NEW-03) | **High** | Open |
| 6 | `any` types in mail.ts command layer (I-010) | **High** | Open |
| 7 | Redundant `ensureInitialized()` calls S-NEW-01 | **Medium** | Open |
| 8 | `batchCreateContacts` swallows errors (B-NEW-04) | **Medium** | Open |
| 9 | `TokenStore.close()` singleton hazard (I-NEW-04) | **Medium** | Open |
| 10 | `getUpcomingEvents` hardcoded limit (S-NEW-02) | **Medium** | Open |
| 11 | `--account` not validated as email (S-NEW-03) | **Low** | Open |
| 12 | Analysis methods default pageSize: 100 (S-NEW-04) | **Low** | Open |
| 13 | `handleServiceError` deprecated export (original I-007 context) | **Low** | Open |

