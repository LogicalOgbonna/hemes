# Google Calendar Event Monitor

Full Python implementation for monitoring Google Calendar events and delivering notifications when events start.

## Dependencies

```
google-api-python-client google-auth-oauthlib
```

Install via: `uv pip install google-api-python-client google-auth-oauthlib`

## Script Template

Save to `~/.hermes/scripts/calendar_monitor.py`:

```python
#!/usr/bin/env python3
"""
Calendar event monitor — runs every 10 minutes, checks Google Calendar for
events starting now, outputs notification messages for no_agent cron delivery.
"""

import json, os, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
TOKEN_PATH = HERMES_HOME / "google_token.json"
NOTIFIED_LOG = HERMES_HOME / ".calendar_notified.json"
TIMEZONE = "Europe/Berlin"  # ← CHANGE THIS
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


def load_notified():
    if NOTIFIED_LOG.exists():
        data = json.loads(NOTIFIED_LOG.read_text())
        cutoff = time.time() - 86400
        return {k: v for k, v in data.items() if v > cutoff}
    return {}


def save_notified(notified):
    NOTIFIED_LOG.write_text(json.dumps(notified, indent=2))


def get_service():
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("calendar", "v3", credentials=creds)


def format_event(event, now):
    summary = event.get("summary", "Untitled event")
    start = event["start"]
    end = event["end"]
    if "dateTime" in start:
        start_dt = datetime.fromisoformat(start["dateTime"])
        end_dt = datetime.fromisoformat(end["dateTime"])
        start_fmt = start_dt.strftime("%H:%M")
        end_fmt = end_dt.strftime("%H:%M")
    else:
        start_dt = datetime.fromisoformat(start["date"])
        start_fmt = "All day"
        end_fmt = ""
    diff = start_dt - now
    urgency = "NOW" if diff.total_seconds() < 60 else f"in {int(diff.total_seconds() // 60)} min"
    msg = [f"🔔 {summary}"]
    if start_fmt:
        msg.append(f"⏰ {start_fmt} - {end_fmt}")
    if event.get("location"):
        msg.append(f"📍 {event['location']}")
    if event.get("description"):
        msg.append(f"📝 {event['description'][:120]}")
    msg.append(f"⏱ Starts {urgency}")
    return "\n".join(msg)


def main():
    now = datetime.now(timezone.utc)
    notified = load_notified()
    service = get_service()
    time_min = now.isoformat()
    time_max = (now + timedelta(minutes=10)).isoformat()
    events = (
        service.events()
        .list(calendarId="primary", timeMin=time_min, timeMax=time_max,
              singleEvents=True, orderBy="startTime")
        .execute()
        .get("items", [])
    )
    if not events:
        sys.exit(0)
    messages = []
    for event in events:
        event_id = event.get("iCalUID", event["id"])
        instance_key = f"{event_id}_{event['start'].get('dateTime', event['start'].get('date'))}"
        if instance_key in notified:
            continue
        messages.append(format_event(event, now))
        notified[instance_key] = time.time()
    if messages:
        print("\n\n---\n\n".join(messages))
        save_notified(notified)


if __name__ == "__main__":
    main()
```

## Cron Job Setup

```bash
# Make script executable first — cron runs it directly, not via 'python3'
chmod +x ~/.hermes/scripts/calendar_monitor.py

cronjob action=create \
  schedule="every 10m" \
  script=calendar_monitor.py \
  no_agent=true \
  deliver="all" \
  name="Calendar event watcher"
```

## Key Design Decisions

1. **Look-ahead window** (10 min) should match the poll interval or be slightly longer to avoid missing events.
2. **Dedup key** uses iCalUID + start time so recurring events get separate notifications per instance.
3. **24-hour state cleanup** prevents the notification log from growing unbounded.
4. **Silent exit** when no events means zero noise — the user only hears from this when there's actually something to do.

## Troubleshooting: OAuth Token Issues

### Symptom: `invalid_scope` — Scope mismatch on refresh

The script fails with:
```
google.auth.exceptions.RefreshError: ('invalid_scope: Bad Request',
  {'error': 'invalid_scope', 'error_description': 'Bad Request'})
```

The traceback points to `get_service()` — `creds.refresh(Request())` in particular.

### Root Cause

`Credentials.from_authorized_user_file()` loads **all** scopes stored in the token file, not just the ones in the script's `SCOPES` constant. If the token was originally created with extra scopes (Gmail, Drive, Sheets, Contacts, etc.), the refresh call sends those full scopes to Google's OAuth server. Google rejects them if any scope is no longer valid for the client.

Even manually constructing a `Credentials` object with restricted scopes won't fix the refresh — the refresh token itself is cryptographically bound to the original scope set at issuance time, and Google rejects scope changes on refresh.

### Quick Diagnostic

If you're unsure whether scope mismatch is the cause, you can temporarily construct the `Credentials` object manually to confirm the token and credentials are otherwise valid:

```python
import json
raw = json.loads(TOKEN_PATH.read_text())
creds = Credentials(
    token=raw.get("token"),
    refresh_token=raw.get("refresh_token"),
    token_uri=raw.get("token_uri", "https://oauth2.googleapis.com/token"),
    client_id=raw.get("client_id"),
    client_secret=raw.get("client_secret"),
    scopes=SCOPES,
)
```

This will still fail on refresh if the token has mismatched scopes, but it makes the root cause clearer. The permanent fix is to re-authenticate (see below).

### Fix: Re-authenticate With Only the Scopes You Need

1. **Back up** the old token (already done if you follow the re-auth flow below)
2. **Generate a fresh token** using a console-based OAuth flow with **only** the `calendar.readonly` scope
3. The new token will have exactly one scope, and refresh will work cleanly

Run this re-auth script (saves output to `~/.hermes/google_token.json`):

```bash
cat > /tmp/reauth_calendar.py << 'PYEOF'
#!/usr/bin/env python3
"""Re-authenticate Google Calendar with readonly scope via console flow."""
import json, os, shutil
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
TOKEN_PATH = HERMES_HOME / "google_token.json"
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

# Back up old token
if TOKEN_PATH.exists():
    shutil.copy2(TOKEN_PATH, TOKEN_PATH.with_suffix(".json.bak"))
    print(f"Backed up old token to {TOKEN_PATH}.bak")

token = json.loads(TOKEN_PATH.read_text())
client_config = {
    "installed": {
        "client_id": token["client_id"],
        "client_secret": token["client_secret"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"],
    }
}
flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
flow.redirect_uri = "urn:ietf:wg:oauth:2.0:oob"
auth_url, _ = flow.authorization_url(prompt="consent")
print("=" * 60)
print("Open this URL in your browser:")
print("=" * 60)
print(auth_url)
print("=" * 60)
print("Authorize, then paste the code here:")
code = input("> ").strip()
creds = flow.fetch_token(code=code)
TOKEN_PATH.write_text(creds.to_json())
print(f"New token saved to {TOKEN_PATH}")
print(f"Scopes: {creds.scopes}")
PYEOF
python3 /tmp/reauth_calendar.py
```

- Open the printed URL in a browser
- Authorize **only** "View your calendars" (the `calendar.readonly` scope)
- Google shows you a code (looks like `4/0A...`)
- Paste it into the terminal

After the new token is saved, the cron job will refresh cleanly on the next run.

### Prevention

When you first set up the Google Calendar monitor, **always create the token with only `calendar.readonly`** — don't borrow a token from a project that needed Gmail, Drive, or other scopes. If you're reusing an OAuth client ID that was used for other Google services, generate a fresh token just for this script.

You can verify the scopes in your token file:
```bash
python3 -c "import json; t=json.load(open('/home/ubuntu/.hermes/google_token.json')); print('\\n'.join(t.get('scopes',[])))"
```

If you see scopes other than `calendar.readonly`, the token will likely hit the `invalid_scope` error on the first refresh (typically 1 hour after creation).

### Symptom: `invalid_grant` — Token expired or revoked

The script fails with:
```
google.auth.exceptions.RefreshError:
  ('invalid_grant: Token has been expired or revoked.', {...})
```

This is **not** a scope mismatch — the entire refresh token is dead. Google revoked it (or it naturally expired after months of no use).

#### Diagnosis

Run:
```bash
GSETUP="python ${HERMES_HOME:-$HOME/.hermes}/skills/productivity/google-workspace/scripts/setup.py"
$GSETUP --check
```

If it prints `REFRESH_FAILED: invalid_grant`, the token is dead.

#### Fix: Re-authorize via setup.py (agent-mediated flow)

This flow works on any platform including WhatsApp/mobile — no local callback server needed:

```bash
# Step 1: Generate auth URL
$GSETUP --auth-url
```

Send the printed URL to the user. The `setup.py` script uses `http://localhost:1` as the redirect URI — the user opens the URL on their phone, authorizes "View your calendars", and gets a browser error page (expected because localhost:1 can't be reached on mobile). They copy the **entire URL** from the address bar (it contains `?code=...&scope=...`) and paste it back.

```bash
# Step 2: Exchange the code
$GSETUP --auth-code "THE_PASTED_URL_OR_CODE"
```

This saves a fresh token with the exact scopes granted (no mismatch risk).

```bash
# Step 3: Verify
$GSETUP --check   # Should print AUTHENTICATED
```

The cron job picks up the new token on its next run — no restart needed.

#### Why this happens

Google refresh tokens expire:
- After 6 months of no usage
- When the user manually revokes access (Google Account → Security → Third-party apps)
- When the Google Cloud OAuth client is deleted or disabled
- On certain Google Cloud project configuration changes (consent screen reconfiguration, client secret rotation)

#### Agent-mediated vs interactive re-auth

The re-auth script in the `invalid_scope` fix section above uses `input()` — it's designed for interactive terminal use where the user is at a keyboard. When the user is on WhatsApp/Telegram/Discord (mobile), use the `setup.py` approach instead:
1. Agent runs `$GSETUP --auth-url`
2. Agent sends the URL to the user
3. User visits URL on their phone, authorizes, copies the redirect URL from the error page
4. User pastes the URL to the agent
5. Agent runs `$GSETUP --auth-code "URL"` to exchange

This works because `setup.py` stores the PKCE verifier locally before generating the URL, so the code exchange can happen in a later step without the user being on the same machine.

## Timezone Pitfall

When creating recurring Google Calendar events via the API, the **start/end times must include the correct timezone offset** in the `dateTime` field. Using a UTC template date for a daily RRULE can cause events to appear at the wrong local hour in CEST. Always pass the correct `timeZone` in the event body:

```python
"start": {
    "dateTime": "2026-05-26T06:00:00+02:00",  # CEST
    "timeZone": "Europe/Berlin",
}
```

The `timeZone` field is advisory for display; the actual `dateTime` offset (+02:00) is what Google uses for scheduling.
