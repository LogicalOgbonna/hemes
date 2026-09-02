---
name: hermes-email-gateway
description: "Configure, secure, and troubleshoot the Hermes email gateway platform — IMAP polling, auto-reply prevention, sender allowlisting, and common pitfalls."
version: 1.0.0
created_by: agent
platforms: [linux, macos]
metadata:
  hermes:
    tags: [hermes, email, gateway, security, imap, smtp, platform]
    related_skills: [hermes-agent, infisical-secrets, mission-control-dashboard, automated-notifications]
---

# Hermes Email Gateway Platform

The email gateway is a Hermes messaging platform that uses **IMAP** to receive incoming emails and **SMTP** to send replies. It's configured via environment variables injected through Infisical at runtime.

## How It Works

1. **Polling loop** — On `connect()`, the `EmailAdapter` opens an IMAP SSL connection, searches for UNSEEN messages every 15 seconds (configurable via `EMAIL_POLL_INTERVAL`)
2. **Message dispatch** — Each unseen email is parsed, checked against automated-sender rules, and dispatched as a `MessageEvent` to the agent's conversation loop
3. **Agent responds** — The agent generates a reply text, which is sent back via SMTP to the original sender
4. **Threading** — The adapter stores `thread_context` per sender (subject, message-id) so replies use `In-Reply-To` headers for proper email threading

## Environment Variables

All stored in Infisical at path `/` (project ID: 24881f6a-bfc0-4f83-82df-d0fcc27e8dab):

| Variable | Purpose | Required |
|----------|---------|----------|
| `EMAIL_ADDRESS` | The email address the gateway reads from / sends as | Yes |
| `EMAIL_PASSWORD` | Gmail app-specific password (not account password) | Yes |
| `EMAIL_IMAP_HOST` | IMAP server (e.g. `imap.gmail.com`) | Yes |
| `EMAIL_SMTP_HOST` | SMTP server (e.g. `smtp.gmail.com`) | Yes |
| `EMAIL_POLL_INTERVAL` | Seconds between inbox checks (default: 15) | No |
| `EMAIL_ALLOWED_USERS` | Comma-separated list of allowed senders | No |
| `EMAIL_ALLOW_OUTBOUND` | Set to `true` to enable sending replies (default: disabled) | No |

**Credentials are injected via Infisical into the gateway process at startup.** No `.env` file on disk contains these values.

## Security: Read-Only Mode (Default)

**Since May 2026, the email gateway defaults to read-only mode.** The `send()` method in `gateway/platforms/email.py` checks `EMAIL_ALLOW_OUTBOUND` — if not set to `true`/`1`/`yes`, replies are silently dropped with a log message:

```python
async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult:
    allowed = os.getenv("EMAIL_ALLOW_OUTBOUND", "").strip().lower()
    if allowed not in ("1", "true", "yes"):
        logger.info("[Email] Read-only mode: not sending reply to %s", chat_id)
        return SendResult(success=False, error="Email outbound is disabled (read-only mode)")
    # ... rest of send logic
```

The log line is:
```
[Email] Read-only mode: not sending reply to <recipient>
```

This was added because the gateway was auto-responding to ALL incoming emails without proper sender verification, including automated Kleinanzeigen notification emails which bypassed the built-in automated-sender detection.

**To enable outbound replies:** Set `EMAIL_ALLOW_OUTBOUND=true` in Infisical at path `/` **and** restart the gateway. Without restarting, the patched code won't be reloaded.

**To apply the patch fresh (if missing):** Edit `gateway/platforms/email.py` in the Hermes repo and add the env check at the top of the `send()` method as shown above. The patch was originally applied at line 507-516 of the method. Run `hermes gateway restart` or kill the gateway process (it will auto-restart via supervisor) to pick up changes.

## Security: Automated Sender Detection

The email adapter has a built-in `_is_automated_sender()` check that skips emails matching:

**Patterns in sender address:** `noreply`, `no-reply`, `donotreply`, `mailer-daemon`, `postmaster`, `bounce`, `notifications@`, `automated@`, `auto-confirm`, `auto-reply`, `automailer`

**RFC header checks:**
- `Auto-Submitted` header present and not "no"
- `Precedence` is "bulk", "list", or "junk"
- `X-Auto-Response-Suppress` is truthy
- `List-Unsubscribe` header is present

### Pitfall: Kleinanzeigen-style automated mail

Kleinanzeigen notification emails come from `@mail.kleinanzeigen.de` which does NOT match any automated-sender pattern. They also lack the RFC headers that would flag them. Result: the email adapter dispatches them to the agent, which auto-replies — sending bot-like responses to real people.

**Fix:** Add `kleinanzeigen.de` (or similar marketplace notification domains) to the `_NOREPLY_PATTERNS` tuple in `gateway/platforms/email.py`, or keep read-only mode enabled.

## Security: EMAIL_ALLOWED_USERS

`EMAIL_ALLOWED_USERS` can restrict which senders the adapter dispatches messages for. However, there is a **race condition** — the check in `_dispatch_message()` prevents the email from becoming a `MessageEvent`, but if the gateway authorization check runs before this guard, a reply can still be sent.

**Best practice when enabling outbound:**
1. Set `EMAIL_ALLOWED_USERS` to only your own email address
2. Keep read-only mode off (`EMAIL_ALLOW_OUTBOUND=true`) but only add trusted senders to the allowlist
3. Add prompt-injection guardrails to the system prompt for email sessions
4. Consider setting `EMAIL_POLL_INTERVAL` higher (e.g., 60s) to reduce race window

## Pitfalls

### IMAP timeouts

Gmail's IMAP frequently times out under the default 30s timeout. Logs show:
```
[Email] IMAP fetch error: The read operation timed out
```

This is normal on high-latency connections. The adapter reconnects on the next poll cycle. No action needed.

### Gmail app passwords

Gmail requires an **app-specific password** (not the account password) for IMAP/SMTP access. Generate one at https://myaccount.google.com/apppasswords. The account must have 2FA enabled.

### No EMAIL_HOME_ADDRESS causes silent delivery

If `EMAIL_HOME_ADDRESS` is not set, the email platform has no home channel — incoming emails are processed but replies may behave unexpectedly. Set it to your own email address if you want email to function as a two-way chat channel.

### Gateway restart needed after changes

Changes to email platform code (`gateway/platforms/email.py`) or env vars require a gateway restart:
```bash
systemctl --user restart hermes-gateway.service   # systemd
# OR without systemd:
kill <gateway-pid>
# (gateway auto-restarts if managed by a supervisor)
```

### No home channel = no routing

Without `EMAIL_HOME_ADDRESS`, the platform adapter has no way to route incoming emails to you. They get processed by the agent but the response goes back to the original sender (if outbound is on). Set `EMAIL_HOME_ADDRESS` to your email for two-way chat.

## Related Skills

- `infisical-secrets` — Email credentials are stored in Infisical at path `/`
- `hermes-agent` — General Hermes configuration (gateway, platforms, logging)
- `mission-control-dashboard` — Dashboard that monitors agents including any email-triggered sessions
- `automated-notifications` — polling + no_agent cron pattern; the email gateway is one delivery platform for such notifications

## References

- `references/email-adapter-internals.md` — Detailed walkthrough of gateway/platforms/email.py (IMAP polling, SMTP sending, threading, automated-sender detection)
