# Calendar Live Notifications

Push notifications for calendar events using a lightweight polling watcher. Runs as a `no_agent=True` cron job so the script's stdout is delivered verbatim as the notification message.

## Architecture

```
Google Calendar API <-- [Python script polls every 10 min] --o-- stdout --→ WhatsApp + Telegram
                              ↕
                     .calendar_notified.json
                     (dedup tracker, auto-clean 24h)
```

## The Watcher Script

Place at `~/.hermes/scripts/calendar_monitor.py`:

```python
#!/usr/bin/env python3
"""Calendar event monitor — runs every 10 minutes, checks Google Calendar for
events starting now, and outputs notification messages."""

import json, os, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
TOKEN_PATH = HERMES_HOME / "google_token.json"
NOTIFIED_LOG = HERMES_HOME / ".calendar_notified.json"
TIMEZONE = "Europe/Berlin"  # CHANGE ME
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

def load_notified():
    if NOTIFIED_LOG.exists():
        try:
            data = json.loads(NOTIFIED_LOG.read_text())
            cutoff = time.time() - 86400
            return {k: v for k, v in data.items() if v > cutoff}
        except: return {}
    return {}

def save_notified(notified):
    NOTIFIED_LOG.write_text(json.dumps(notified, indent=2))

def get_service():
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("calendar", "v3", credentials=creds)

def main():
    now = datetime.now(timezone.utc)
    notified = load_notified()
    service = get_service()
    time_min = now.isoformat()
    time_max = (now + timedelta(minutes=10)).isoformat()
    events = service.events().list(calendarId="primary", timeMin=time_min,
        timeMax=time_max, singleEvents=True, orderBy="startTime").execute()
    items = events.get("items", [])
    if not items:
        sys.exit(0)
    messages = []
    for event in items:
        event_id = event.get("iCalUID", event["id"])
        start = event["start"]
        instance_key = f"{event_id}_{start.get('dateTime', start.get('date'))}"
        if instance_key in notified:
            continue
        summary = event.get("summary", "Untitled event")
        end = event["end"]
        if "dateTime" in start:
            start_dt = datetime.fromisoformat(start["dateTime"])
            end_dt = datetime.fromisoformat(end["dateTime"])
            start_fmt, end_fmt = start_dt.strftime("%H:%M"), end_dt.strftime("%H:%M")
        else:
            start_fmt, end_fmt = "All day", ""
        diff = start_dt - now
        urgency = "NOW" if diff.total_seconds() < 60 else f"in {int(diff.total_seconds() // 60)} min"
        msg_parts = [f"{summary}"]
        if start_fmt: msg_parts.append(f"{start_fmt} - {end_fmt}")
        if event.get("location"): msg_parts.append(event["location"])
        if event.get("description"): msg_parts.append(event["description"][:120])
        messages.append("\n".join(msg_parts))
        notified[instance_key] = time.time()
    if messages:
        print("\n---\n".join(messages))
        save_notified(notified)

if __name__ == "__main__":
    main()
```

## Cron Job Setup

```bash
hermes cron create \
  --name "Calendar watcher" \
  --schedule "every 10m" \
  --script calendar_monitor.py \
  --no-agent \
  --deliver all
```

**Key flags:**
- `--no-agent` — skips the LLM entirely; script stdout is sent verbatim
- `--deliver all` — fans out to every connected home channel (WhatsApp + Telegram + etc.)
- `--repeat forever` — default, runs indefinitely
- `--script calendar_monitor.py` — resolves relative to `~/.hermes/scripts/`

## Dedup Behavior

The script tracks notified event instance IDs via iCalUID + start time. Entries older than 24h are automatically cleaned on each run. Silent exit (exit 0, no output) when no new events are starting — keeps your chat quiet between events.

## Customization

- **Change the lookahead window:** Edit `timedelta(minutes=10)` — shorter = more frequent checks, longer = earlier notifications
- **Change the timezone:** Update the `TIMEZONE` variable
- **Filter calendars:** Add `&calendarId=<secondary>` or use `event.get("organizer")` to filter by source
- **Notification format:** Edit the `msg_parts` list to rearrange fields

## Pitfalls

- The script reads the Google token from `~/.hermes/google_token.json` — must be set up via the google-workspace OAuth flow first
- Token refresh is handled in `get_service()`, but if the token is revoked entirely, the cron job silently fails (exit 1, empty output) — check `hermes cron log <job_id>` for errors
- The dedup tracker is a plain JSON file — if the machine crashes between script runs, up to one notification per event may be lost (it re-notifies on next run since the tracker won't have the id)
- **`invalid_scope` on token refresh**: If you replace `Credentials.from_authorized_user_file()` with a manual `Credentials()` constructor, you MUST pass the token's ORIGINAL scopes, not a restricted subset. Google's OAuth server rejects refresh requests that request fewer scopes than the original token was issued for (returns `invalid_scope: Bad Request`). To get the original scopes, read them from the stored token file: `raw = json.loads(token_path.read_text()); scopes = raw.get("scopes", SCOPES)`. Passing `scopes=SCOPES` (a reduced set like `calendar.readonly` when the token was issued with broader scopes like `calendar, gmail.send, drive`) will always fail on refresh.
