---
name: automated-notifications
description: "Pattern for building automated notification systems: polling an API on a cron schedule with a Python script and delivering alerts via no_agent cron jobs."
version: 1.0.0
author: Hermes Agent
tags: [cron, notifications, monitoring, polling, scripts, automation, calendar, watcher]
---

# Automated Notifications

Pattern for building notification systems that automatically alert a user when events occur in an external system (Google Calendar, GitHub, APIs, etc.).

## Core Pattern

The most reliable architecture is a **polling script** + **no_agent cron job**:

```
┌──────────────┐     every N min     ┌──────────────────┐
│  External API │ ◄────────────────── │  Python Script   │
│  (Calendar,   │                     │  (polls, checks, │
│   GitHub, ...)│                     │   deduplicates)  │
└──────────────┘                     └────────┬─────────┘
                                              │ stdout (if events found)
                                              ▼
                                    ┌──────────────────┐
                                    │  no_agent=true    │
                                    │  Cron Job         │
                                    │  delivers stdout  │
                                    │  verbatim to user │
                                    └──────────────────┘
```

**Why this beats individual cron jobs per event:**
- No need to create/delete cron jobs when events change
- Automatically handles new events without manual intervention
- Single cron job maintains state via a local JSON file
- Dedup prevents duplicate notifications (system tracks what it's already sent)

## Script Contract

The Python script must follow these rules:

| Behavior | Meaning |
|----------|---------|
| `exit(0)` with **empty stdout** | Nothing to notify — cron stays silent |
| `exit(0)` with **non-empty stdout** | Output is delivered verbatim to the user on all configured platforms |
| `sys.exit(0)` when no events found | Prevents unwanted empty notifications |

## State Tracking for Dedup

Use a JSON file to track notified event instances so you never notify twice about the same event:

```python
NOTIFIED_LOG = HERMES_HOME / ".notified_cache.json"

def load_notified():
    if NOTIFIED_LOG.exists():
        data = json.loads(NOTIFIED_LOG.read_text())
        cutoff = time.time() - 86400  # 24h cleanup
        return {k: v for k, v in data.items() if v > cutoff}
    return {}

def save_notified(notified):
    NOTIFIED_LOG.write_text(json.dumps(notified, indent=2))
```

## Cron Job Setup

```bash
cronjob action=create \
  schedule="every 10m" \
  script=your_monitor.py \
  no_agent=true \
  deliver="all" \
  name="My watcher name"
```

Key parameters:
- **no_agent=true** — skip the LLM, deliver script stdout verbatim
- **deliver="all"** — fan out to all connected platforms (WhatsApp, Telegram, etc.)
- **script** — path relative to `~/.hermes/scripts/`

## Pitfalls

1. **Script path resolution**: Relative paths resolve under `~/.hermes/scripts/`. Use an absolute path or place scripts there.
2. **`no_agent=True` REQUIREMENTS**: Script MUST be set. prompt and skills are ignored. Only stdout triggers delivery.
3. **`no_agent=True` SILENT SEMANTICS**: Empty stdout = nothing sent to user. This is intentional — design your script to stay quiet when there's nothing new.
4. **`no_agent=True` ERROR SEMANTICS**: Non-zero exit or timeout sends an error alert so broken watchers can't fail silently.
5. **Dedup state path**: Use a dotfile under `~/.hermes/` to avoid cluttering the user's home directory.
6. **Poll interval**: Match the interval to how far ahead you look. A script checking "events starting in the next 10 min" should run every 10 min or more frequently.
7. **Token management**: Scripts run by cron jobs don't have interactive terminal access. Tokens must be pre-configured (OAuth tokens, API keys in `.env`).
8. **OAuth scope lock-in**: `Credentials.from_authorized_user_file()` preserves ALL scopes from the stored token, not just the ones in the script's `SCOPES` constant. A token created with extra scopes (Gmail, Drive, etc.) will fail on refresh with `invalid_scope` if any scope is no longer valid for the client. **Always create tokens with exactly the scopes your script needs** — never reuse a token from a project with broader Google API access. See `references/google-calendar-monitor.md` for the re-auth fix.
9. **`cron-run sessions should not schedule cron jobs`**: The no_agent script runs outside the agent loop, so this rule doesn't apply to the script itself. But the agent creating the cron job should never make the cron job chain-create other cron jobs.
10. **Script must be executable**: The cron scheduler runs the script directly (not via `python3 script.py`), so the file needs the executable bit set. After writing the script, always run `chmod +x ~/.hermes/scripts/your_script.py`. Without it, the job fails with `Permission denied` silently via the error-alert path.

## References

- `references/google-calendar-monitor.md` — full implementation for Google Calendar event notifications

## Related Skills

- **google-workspace** — for setting up Google Calendar OAuth
- **cronjob** tool — for scheduling
- **github-auth** — for GitHub API token setup
- **hermes-email-gateway** — email is one of the delivery platforms; configure/secure the gateway when notifications should arrive via email
