# gwork

Swiss Army knife for Google Workspace - A CLI tool for Gmail, Google Calendar, Contacts, and more.

## Installation

### From npm

```bash
npm install -g gwork
```

### From source

```bash
git clone https://github.com/mherod/gwork.git
cd gwork
bun install
bun run build
bun link
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Test the CLI
gwork --help
gwork mail --help
gwork cal --help
gwork contacts --help
```

### Native binding (pnpm / Node 25+)

`gwork` uses `better-sqlite3` for token storage, which requires a native `.node` binding compiled for your current Node.js ABI. If you install via **pnpm** or switch Node versions and see an error like:

```
Error: Could not locate the bindings file. Tried: .../better_sqlite3.node
```

Rebuild the native binding for your current Node version:

```bash
pnpm rebuild better-sqlite3
# or
npm rebuild better-sqlite3
```

## Usage

```bash
gwork <command> [options]

Commands:
  mail           Gmail operations
  cal            Google Calendar operations
  contacts       Google Contacts operations

Options:
  -h, --help     Show help message
  -v, --version  Show version

Examples:
  gwork mail --help
  gwork cal --help
  gwork contacts --help
```

## Setup

### Google API Credentials

To use calendar, Gmail, and Contacts features, you need OAuth2 credentials from Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Calendar API**, **Gmail API**, and **People API**
4. Create OAuth2 credentials (Desktop app type)
5. Download credentials and save as `~/.credentials.json`
6. Run any `gwork cal`, `gwork mail`, or `gwork contacts` command to authenticate

**On first run**, the CLI will display a friendly setup guide if credentials are missing, walking you through the process step-by-step.

### Token Management

Tokens are securely stored in a local SQLite database at `~/.gwork_tokens.db`:
- **Multi-account support**: Store tokens for multiple Google accounts (default, work, personal, etc.)
- **Automatic refresh**: Tokens are automatically refreshed before expiry
- **Per-account**: Each account has independent access and refresh tokens

**Using different accounts:**
```bash
# Use the default account (implicit)
gwork cal list

# Use a specific account
gwork cal list --account work@example.com
gwork mail messages -n 10 --account personal@example.com

# View all stored tokens
bun run src/scripts/list-tokens.ts
```

When you use the `--account` flag, the CLI will authenticate with that account (if not already authenticated) and store the token separately. You can easily switch between accounts.

## Commands

See [FEATURES.md](FEATURES.md) for complete feature list and implementation status.

### Mail (Gmail) - 30 Commands

**Core Operations:**
```bash
gwork mail labels                           # List all labels
gwork mail messages -n 20                   # List 20 most recent messages
gwork mail get <messageId>                  # Get full message details
gwork mail search "from:example@gmail.com"  # Search messages
gwork mail stats                            # Gmail statistics
```

**Quick Filters:**
```bash
gwork mail unread                # Unread messages
gwork mail starred               # Starred messages
gwork mail important             # Important messages
gwork mail drafts                # Draft messages
```

**Threads:**
```bash
gwork mail threads               # List threads
gwork mail thread <threadId>     # Get thread details
```

**Message Actions:**
```bash
gwork mail delete <messageId>              # Delete message
gwork mail archive <messageId>             # Archive message
gwork mail mark-read <messageId>           # Mark as read
gwork mail star <messageId>                # Star message
gwork mail add-label <messageId> <label>   # Add label
```

**Batch Operations:**
```bash
gwork mail delete-query "subject:newsletter"  # Delete matching messages
gwork mail archive-query "older_than:1y"      # Archive old messages
gwork mail archive-many <id1> <id2> <id3>     # Archive multiple
```

**Attachments:**
```bash
gwork mail attachments <messageId>                    # List attachments
gwork mail download <messageId> <attachmentId> output.pdf  # Download
```

**Label Management:**
```bash
gwork mail create-label "Work" --color "#ff0000"  # Create label
gwork mail delete-label <labelId>                 # Delete label
```

### Calendar (Google Calendar) - 24 Commands

**List Events:**
```bash
gwork cal list                       # List upcoming events
gwork cal list --today               # Today's events
gwork cal list --range this-week     # This week's events
gwork cal list -n 20                 # Show 20 events
gwork cal list --location "Office"   # Filter by location
gwork cal list --attendee "john@"    # Filter by attendee
gwork cal list -f json               # Output as JSON
```

**Manage Events:**
```bash
# Get event details
gwork cal get <calendarId> <eventId>

# Create event
gwork cal create primary --title "Meeting" --start "2025-12-20T14:00:00" \
  --location "Office" --attendees "alice@gmail.com,bob@gmail.com"

# Update event
gwork cal update primary <eventId> --title "Updated Meeting"

# Delete event
gwork cal delete primary <eventId> --confirm

# Search events
gwork cal search "meeting"
```

**Quick Actions:**
```bash
gwork cal quick --meeting "Team Sync"   # 1-hour meeting starting now
gwork cal quick --reminder "Call John"  # All-day reminder
gwork cal quick --block 2               # 2-hour focus time block
```

**Duplicate & Copy:**
```bash
gwork cal duplicate primary <eventId> --start "2025-12-21T10:00:00"
gwork cal duplicate primary <eventId> --calendar "work@group.calendar.google.com"
```

**Calendars:**
```bash
gwork cal calendars                  # List all calendars
gwork cal create-calendar "Work"     # Create new calendar
```

**Statistics & Analysis:**
```bash
gwork cal stats                      # Calendar statistics
gwork cal stats --days 60            # Stats for next 60 days
gwork cal freebusy <start> <end>     # Check free/busy times
gwork cal check-conflict primary --start "2025-12-20T14:00:00" --end "2025-12-20T15:00:00"
gwork cal compare primary "work@group.calendar.google.com" --days 30
```

**Export & Import:**
```bash
gwork cal export primary --format json --output events.json --days 30
gwork cal export primary --format csv --output events.csv
gwork cal export primary --format ical --output events.ics
gwork cal batch-create primary --file events.json --confirm
```

**Bulk Operations:**
```bash
gwork cal bulk-update primary --query "meeting" --location "Remote" --dry-run
gwork cal bulk-update primary --query "meeting" --location "Remote" --confirm
```

**Reminders:**
```bash
gwork cal reminders primary <eventId> --list
gwork cal reminders primary <eventId> --add 30           # 30 min before
gwork cal reminders primary <eventId> --remove 0         # Remove first
gwork cal reminders primary <eventId> --clear            # Clear all
gwork cal reminders primary <eventId> --default          # Use defaults
```

**Event Colors:**
```bash
gwork cal color --list                              # List available colors
gwork cal color primary <eventId> --set 9           # Set to Blueberry
```

**Recurring Events:**
```bash
# Create recurring event
gwork cal create-recurring primary --title "Weekly Meeting" \
  --start "2025-12-20T10:00:00" --freq WEEKLY --byday MO,WE,FR --count 10

# Update all instances
gwork cal update-recurring primary <eventId> --title "New Title" --confirm

# Show recurrence info
gwork cal recurrence-info primary <eventId> --occurrences 5

# Work with recurrence rules
gwork cal recurrence --parse "FREQ=DAILY;COUNT=10"
gwork cal recurrence --text "every weekday"
```

**Date Utilities:**
```bash
gwork cal date --format "2025-12-20" --relative     # Show relative time
gwork cal date --parse "tomorrow" --iso             # Convert to ISO
gwork cal date --add 7 --days                       # Add 7 days to now
```

### Contacts (Google Contacts) - 30+ Commands

**List & Search:**
```bash
gwork contacts list                           # List all contacts
gwork contacts list -n 50                     # List 50 contacts
gwork contacts search "john"                  # Search by name
gwork contacts find-email "john@example.com"  # Find by email
gwork contacts get <resourceName>             # Get contact details
```

**Create & Update:**
```bash
# Create contact
gwork contacts create --first-name John --last-name Doe \
  --email john@example.com --phone "+1-555-1234" --confirm

# Update contact
gwork contacts update <resourceName> --email newemail@example.com --confirm

# Delete contact
gwork contacts delete <resourceName> --confirm
```

**Group Management:**
```bash
gwork contacts groups                                # List all groups
gwork contacts create-group "Friends" --confirm     # Create group
gwork contacts group-contacts <groupResourceName>   # List group members
gwork contacts add-to-group <group> <contact1> <contact2> --confirm
gwork contacts remove-from-group <group> <contact> --confirm
```

**Batch Operations:**
```bash
# Create multiple contacts from JSON
gwork contacts batch-create contacts.json --confirm

# Delete multiple contacts
gwork contacts batch-delete <id1> <id2> <id3> --confirm
```

**Account & Analytics:**
```bash
gwork contacts profile                        # Your profile info
gwork contacts stats                          # Contact statistics
```

**Advanced Operations - Duplicate Detection:**
```bash
gwork contacts duplicates                     # Find duplicate contacts
gwork contacts duplicates --threshold 85      # More strict matching
gwork contacts merge <contact1> <contact2> --confirm
gwork contacts auto-merge --dry-run           # Preview before merging
gwork contacts auto-merge --confirm           # Merge all duplicates
```

**Advanced Operations - Data Quality:**
```bash
gwork contacts find-missing-names             # Find incomplete entries
gwork contacts analyze-generic-names          # Find suspicious names
gwork contacts analyze-imported               # Find imported/stale contacts
```

**Advanced Operations - Marketing Detection:**
```bash
gwork contacts detect-marketing               # Find marketing contacts
gwork contacts detect-marketing --threshold 50 # Stricter threshold
gwork contacts detect-marketing --delete --dry-run  # Preview deletion
gwork contacts detect-marketing --delete --confirm  # Remove marketing contacts
```

## Publishing

To publish to npm:

```bash
bun run build
npm publish
```

The `prepublishOnly` script will automatically build before publishing.
