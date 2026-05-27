---
name: spreadsheet-to-calendar
description: "Import structured schedule data from Excel/CSV into Google Calendar — parse, create recurring daily events, handle one-off events, overnight spans, and timezone awareness."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Google, Calendar, Excel, Spreadsheet, Import, Recurring, OAuth]
    related_skills: [google-workspace]
---

# Spreadsheet to Google Calendar

Import structured schedule data from `.xlsx` or `.csv` files into Google Calendar. Handles daily recurring blocks, one-off events, overnight events (e.g., 23:30–01:00+1), and timezone-aware datetimes.

## Prerequisites

- Google Workspace OAuth must be set up and authenticated (`setup.py --check` returns `AUTHENTICATED`)
- `pandas` and `openpyxl` installed (use `uv pip install pandas openpyxl`)
- Target timezone known (`UTC`, `Africa/Lagos`, `Europe/Berlin`, `America/New_York`, etc.)

## Event Classification

Spreadsheet data typically has two event types:

| Type | Behavior |
|------|----------|
| **Daily** | Same time slot every day → create ONE event with `RRULE:FREQ=DAILY` recurrence. Do NOT create 14 individual events. |
| **One-off** | Single occurrence → create as an individual event. |

## Required Spreadsheet Columns

| Column | Description |
|--------|-------------|
| `Date` | Date string, e.g. `2026-05-26` |
| `Start` | Start time, e.g. `06:00` |
| `End` | End time, e.g. `06:15` (may contain `(+1 day)` for overnight events) |
| `Event title` | Event name/summary |
| `Description` | Optional event description |
| `Location` | Optional event location |
| `Type` | `Daily` or `One-off` |

## Step-by-Step Workflow

### 1. Read and Inspect the File

```bash
cd ~/.hermes
python3 -c "
import pandas as pd
df = pd.read_excel('document_cache/FILENAME.xlsx')
print('Columns:', list(df.columns))
print('Shape:', df.shape)
print(df.to_string())
"
```

- Use `pandas` for `.xlsx` files (requires `openpyxl` engine)
- Use `pandas` for `.csv` files (`pd.read_csv`)
- Print all rows to understand the structure before creating events

### 2. Parse Data

- Parse `Date` + `Start` into a datetime object
- Parse `End` — handle `(+1 day)` suffix by adding one day to the end datetime
- Timezone: **always include the timezone** (ISO 8601 with offset, e.g., `2026-05-26T06:00:00+01:00`)
- Group events by name and time slot for daily recurring events

### 3. Create Calendar Events

Use the google_api.py script:

```bash
GAPI="python ~/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
```

**For recurring daily events** (create ONE event per time slot):

```bash
$GAPI calendar create \
  --summary "🌅 Wake & hydrate" \
  --description "Drink a full glass of water." \
  --start 2026-05-26T06:00:00+01:00 \
  --end 2026-05-26T06:15:00+01:00
```

Note: The google_api.py script currently supports single events. For truly recurring events with RRULE, you may need to POST directly to the Google Calendar API v3 with a `recurrence` field like `['RRULE:FREQ=DAILY']`, or create a Python script that uses the `google-api-python-client` library.

Using the API client directly (when google_api.py doesn't support recurrence):

```python
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from datetime import datetime, timedelta
import pytz

creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
service = build("calendar", "v3", credentials=creds)

event = {
    "summary": "🌅 Wake & hydrate",
    "description": "Drink a full glass of water.",
    "start": {"dateTime": "2026-05-26T06:00:00", "timeZone": "Europe/Berlin"},
    "end": {"dateTime": "2026-05-26T06:15:00", "timeZone": "Europe/Berlin"},
    "recurrence": ["RRULE:FREQ=DAILY"],
}
created = service.events().insert(calendarId="primary", body=event).execute()
print(f"Created: {created.get('htmlLink')}")
```

**For one-off events** (create individual events):

```bash
$GAPI calendar create \
  --summary "Meeting with Arthur" \
  --description "" \
  --start 2026-05-30T12:00:00+01:00 \
  --end 2026-05-30T13:00:00+01:00
```

### 4. Handle Overnight Events

Events that span midnight (e.g., "Wind down" 23:30–01:00+1 day):
- End datetime = next calendar day
- E.g., start `2026-05-26T23:30:00+01:00`, end `2026-05-27T01:00:00+01:00`

### 5. Verify

List events to confirm creation:

```bash
$GAPI calendar list --start 2026-05-26T00:00:00Z --end 2026-05-26T23:59:59Z
```

### 6. Set Up Cron Job Notifications (Optional)

After creating calendar events, the user may want automated WhatsApp/Telegram notifications at each event time. Create one cron job per event time slot:

```bash
hermes cron create \
  --schedule "0 6 * * *" \                 # cron expression for event start time
  --prompt "Send a notification that it's time for 🌅 Wake & hydrate (06:00-06:15)." \
  --name "Wake & hydrate" \
  --deliver all                             # fans out to all connected platforms
```

Rules for notification cron jobs:
- **Schedule:** Use cron expressions matching the event start times (`0 6 * * *` for 06:00, `30 6 * * *` for 06:30, etc.)
- **deliver: "all"** sends the notification to every connected home channel (WhatsApp, Telegram, etc.) simultaneously
- **prompt** should be self-contained — cron jobs run with no conversation history
- **Daily recurring events** → schedule them with daily cron expressions (`* * * *` = every day)
- **One-off events** → use absolute date-based cron (`0 12 30 5 *` = May 30 at 12:00)
- **One-off events that already passed** — don't create cron jobs for past events; only schedule upcoming ones
- For many event slots (e.g., 15 daily blocks), create them in parallel batches to save time

## Pitfalls

- **Timezone is mandatory.** Google Calendar accepts `Z` (UTC) or `+HH:MM` offset. Always specify — omitting it causes default timezone to apply.
- **Batch creation rate limits.** Google Calendar API has usage limits. Space out bulk creation if creating 50+ events.
- **Recurring vs individual.** Do NOT create 14 copies of a daily event — use `RRULE:FREQ=DAILY` for one recurring event.
- **Duplicate detection.** If you run the import twice, you'll create duplicate events. Consider checking for existing events before creation.
- **Overnight events.** The `(+1 day)` suffix in time strings must be parsed explicitly — Google Calendar expects the end datetime to be on the next calendar date.
- **Scope check.** Ensure OAuth token includes `https://www.googleapis.com/auth/calendar` scope. `setup.py --check` shows `AUTHENTICATED (partial)` if scopes are missing.
- **OAuth on WhatsApp.** When receiving raw JSON credentials from the user (instead of a file path), write the JSON content to a file at `~/.hermes/google_client_secret.json` and then run `setup.py --client-secret ~/.hermes/google_client_secret.json`.
- **Cron notification timezone.** Cron job schedules are in UTC. If the user's events are in CEST (UTC+2), adjust the cron time accordingly (e.g., 06:00 CEST = `0 4 * * *` UTC). However, if using the `hermes cron create` tool directly, the schedule is parsed as-is — verify with `next_run_at` in the creation response.
- **Overnight cron timing.** Events ending after midnight (e.g., 23:30-01:00) still fire their start-time cron job at 23:30. The notification is about STARTING the activity, not about duration.
- **One-off cron jobs repeat forever.** If a one-off event is truly one-time, consider setting `--repeat 1` so the job auto-removes after firing, or delete it manually afterwards with `hermes cron remove JOB_ID`.
- **Large number of cron jobs.** 15+ cron jobs for a daily routine is normal and manageable. Use `hermes cron list` to review all active jobs. Use `hermes cron pause JOB_ID` to temporarily disable specific slots without deleting them.
