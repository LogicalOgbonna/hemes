---
name: google-calendar-automation
description: "Create, manage, and synchronize Google Calendar events programmatically — conversational daily itinerary planning, spreadsheet/CSV bulk import, custom event creation, recurring events with RRULE, cron notification setup, and OAuth scope management."
version: 1.0.0
author: Hermes Agent
tags: [google, calendar, itinerary, planning, schedule, spreadsheet, import, recurring, OAuth, gcal]
related_skills: [google-workspace, automated-notifications]
---

# Google Calendar Automation

Programmatic Google Calendar event creation through three main workflows: conversational daily itinerary building, spreadsheet/CSV bulk import, and custom event creation. All workflows share the same OAuth backend and Google Calendar API integration.

## Common Prerequisites

All workflows require:

1. **Google Workspace OAuth** — Set up and authenticated (`setup.py --check` returns `AUTHENTICATED`)
2. **Full calendar scope** — The OAuth token must include `https://www.googleapis.com/auth/calendar` (write). If only `calendar.readonly`, re-authenticate with `$GSETUP --revoke`
3. **Target timezone known** — `UTC`, `Europe/Berlin`, `Africa/Lagos`, etc.
4. **google_api.py script** available at `~/.hermes/skills/productivity/google-workspace/scripts/google_api.py`

### Check OAuth status

```bash
GAPI="python ~/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
$GAPI calendar list --start YYYY-MM-DDT00:00:00+02:00 --end YYYY-MM-DDT23:59:59+02:00
```

If list works but create returns `HttpError 403: insufficient authentication scopes`, the token only has read-only scope:

```bash
# Fix: revoke and re-authorize
$GSETUP --revoke
# Then re-run setup with full scopes
```

Verify with: `jq '.scopes' ~/.hermes/google_token.json`

### Timezone Rule

**Every ISO 8601 datetime MUST include the offset** (`+02:00`, `-05:00`, `Z`). Omitting it causes Google Calendar to apply its own default timezone, shifting all events.

---

## Workflow A: Conversational Daily Itinerary Planning

Use when the user asks to plan/rework a daily schedule in conversation — "rework my today's itinerary", "plan my day", "build a schedule for tomorrow".

### Steps

#### Step 1: Check current calendar state

```bash
$GAPI calendar list --start YYYY-MM-DDT00:00:00+02:00 --end YYYY-MM-DDT23:59:59+02:00
```

Summarize existing events (time, title) before proposing changes.

#### Step 2: Gather constraints from the user

Ask about:
- **Wake time** — when does the day start?
- **Cancellations** — any existing blocks to remove?
- **Priorities** — first deep work session?
- **Errands/appointments** — fixed-time commitments
- **Reading/learning** — break activity
- **Existing blocks to keep** — family time, lunch, evening reflection

#### Step 3: Build time-blocked itinerary

Typical block types:

| Block Type | Typical Duration | Placement |
|---|---|---|
| Morning routine | 45-60 min | After wake |
| Errand / appointment | Variable, fixed time | As scheduled |
| Deep work session | 1.5-3 hrs | Morning (peak energy) |
| Lunch | 45-60 min | Midday |
| Deep work session 2 | 1.5-3 hrs | Afternoon |
| Break / reading | 15-30 min | Between deep work blocks |
| Evening / family | 2-3 hrs | Evening |
| Reading / reflection | 15-30 min | Before bed |

Present the itinerary as a table and ask for confirmation before creating events.

#### Step 4: Sync to Google Calendar

Once confirmed, create each time block:

```bash
$GAPI calendar create --summary "Block name" --start "2026-05-25T08:00:00+02:00" --end "2026-05-25T09:00:00+02:00"
```

Create events sequentially to avoid rate limits.

#### Step 5: Verify

```bash
$GAPI calendar list --start YYYY-MM-DDT00:00:00+02:00 --end YYYY-MM-DDT23:59:59+02:00
```

### Pitfalls for this workflow

- **Partial-scope token.** If create returns 403, fix scopes as shown above.
- **Event deletion.** Never delete existing events without the user's explicit confirmation.
- **Overnight events.** Events spanning midnight (e.g., 23:30-01:00) need end datetime on the next calendar date.
- **Concurrent API calls.** For 8+ events, create them sequentially.
- **Recurring blocks.** For daily recurring blocks (same time every day), use a single event with RRULE instead of N copies.

---

## Workflow B: Spreadsheet/CSV Import

Use when the user has a `.xlsx` or `.csv` schedule file to bulk-import into Google Calendar.

### Prerequisites

- `pandas` and `openpyxl` installed: `uv pip install pandas openpyxl`
- Target timezone known

### Event Classification

| Type | Behavior |
|------|----------|
| **Daily** | Same time slot every day → create **ONE** event with `RRULE:FREQ=DAILY`. Do NOT create N individual events. |
| **One-off** | Single occurrence → create as an individual event. |

### Required Columns

| Column | Description |
|--------|-------------|
| `Date` | Date string, e.g. `2026-05-26` |
| `Start` | Start time, e.g. `06:00` |
| `End` | End time (may contain `(+1 day)` for overnight events) |
| `Event title` | Event name/summary |
| `Description` | Optional |
| `Location` | Optional |
| `Type` | `Daily` or `One-off` |

### Steps

#### 1. Read and Inspect the File

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

#### 2. Parse Data

- Parse `Date` + `Start` into a datetime
- Parse `End` — handle `(+1 day)` suffix by adding one day
- Always include timezone (ISO 8601 with offset)
- Group events by name+time for daily recurring detection

#### 3. Create Events

**For recurring daily events** — use the Google Calendar API client directly with RRULE:

```python
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

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
```

**For one-off events**:

```bash
$GAPI calendar create --summary "Meeting" --start "2026-05-30T12:00:00+01:00" --end "2026-05-30T13:00:00+01:00"
```

#### 4. Handle Overnight Events

Events spanning midnight (e.g., "Wind down" 23:30–01:00+1 day): set end datetime on the next calendar date.

#### 5. Verify

```bash
$GAPI calendar list --start YYYY-MM-DDT00:00:00Z --end YYYY-MM-DDT23:59:59Z
```

### Pitfalls for this workflow

- **Duplicate detection.** Running the import twice creates duplicate events. Check for existing events before creation.
- **Scope check.** Ensure OAuth token includes calendar write scope.
- **Batch creation rate limits.** Space out creation if 50+ events.
- **Recurring vs individual.** Do NOT create 14 copies of a daily event — use `RRULE:FREQ=DAILY`.
- **OAuth on WhatsApp.** When receiving raw JSON credentials from the user, write them to `~/.hermes/google_client_secret.json`, then run `setup.py --client-secret ~/.hermes/google_client_secret.json`.

---

## Workflow C: Setting Up Cron Notifications

After creating calendar events, use the `automated-notifications` skill to set up automated alerts.

```bash
cronjob action=create \
  schedule="0 6 * * *" \          # match event start time
  prompt="Time for 🌅 Wake & hydrate (06:00-06:15)." \
  name="Wake & hydrate" \
  deliver="all"                    # fan out to all platforms
```

Rules:
- **Daily events** → daily cron expressions (`0 6 * * *`)
- **One-off events** → absolute date cron (`0 12 30 5 *`) with `--repeat 1`
- **Timezones:** Cron schedules are UTC. Adjust if user's events are in a different timezone (e.g., 06:00 CEST = `0 4 * * *` UTC)
- **Overnight events:** Fire at start time (23:30)

For many event slots, create cron jobs in parallel batches. Use `cronjob action=list` to review, `cronjob action=pause` to temporarily disable.

---

## Shared Pitfalls (All Workflows)

- **Timezone is mandatory.** Omit at your peril — Google Calendar defaults to its own timezone.
- **Event deletion.** Never delete existing events without user confirmation.
- **Partial-scope tokens.** If `calendar list` works but `calendar create` returns 403, the OAuth token only has read-only scope. Fix: `$GSETUP --revoke` then re-authorize.
- **Rate limits.** Google Calendar API has usage limits. Create events sequentially, not in parallel.
- **Overnight events.** End datetime must be on the next calendar date.
- **Recurring events.** Use `RRULE:FREQ=DAILY` for daily blocks — one event, not N copies.
- **Cron notification timezone.** Cron schedules are UTC; adjust from user's local timezone.

## References

- `google-workspace` skill: OAuth setup and google_api.py script
- `automated-notifications` skill: no_agent cron notification pattern
