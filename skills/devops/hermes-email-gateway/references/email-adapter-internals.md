# Email Adapter Internals

Detailed analysis of `gateway/platforms/email.py` discovered during the Kleinanzeigen auto-reply debugging session (May 2026).

## Key Classes and Functions

### `_is_automated_sender(address, headers)` (line 91)

Checks sender against `_NOREPLY_PATTERNS` tuple and RFC header patterns. Not exhaustive — `@mail.kleinanzeigen.de` addresses pass through.

### `EmailAdapter.__init__` (line 248)

- Reads env vars: `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_IMAP_HOST`, `EMAIL_IMAP_PORT` (default 993), `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` (default 587), `EMAIL_POLL_INTERVAL` (default 15)
- `_seen_uids: set` — tracks processed IMAP UIDs to avoid duplicates (capped at 2000)
- `_thread_context: dict[sender_addr] -> {subject, message_id}` — threading for replies

### `_fetch_new_messages()` (line 364)

Runs in executor thread. Opens fresh IMAP connection each cycle:
1. Login, send IMAP ID
2. SELECT INBOX, UID SEARCH UNSEEN
3. For each new UID: parse From, Subject, body, attachments
4. Skip if `_is_automated_sender()` returns True
5. Return list of dicts with: uid, sender_addr, sender_name, subject, message_id, in_reply_to, body, attachments, date

### `_dispatch_message(msg_data)` (line 431)

1. Skip self-messages (sender == own address)
2. Skip automated senders (second check)
3. Skip if `EMAIL_ALLOWED_USERS` is set and sender not in list
4. Build MessageEvent with sender as chat_id/user_id
5. Store thread context
6. Call `self.handle_message(event)` — this is where the agent gets involved

### The Race Condition

`_dispatch_message` checks `EMAIL_ALLOWED_USERS` BEFORE calling `handle_message`. But the gateway's authorization check in `run.py` happens AFTER the message is dispatched. If the agent responds faster than the authorization check runs, the reply goes out even for unauthorized senders.

This was the root cause of the Kleinanzeigen replies — the gateway logged "Unauthorized user" as a warning, but the reply had already been sent.

### `send(chat_id, content, reply_to)` (line 503)

Original implementation (before May 2026 patch) sent replies unconditionally. Now checks `EMAIL_ALLOW_OUTBOUND` env var:

```python
allowed = os.getenv("EMAIL_ALLOW_OUTBOUND", "").strip().lower()
if allowed not in ("1", "true", "yes"):
    logger.info("[Email] Read-only mode: not sending reply to %s", chat_id)
    return SendResult(success=False, error="Email outbound is disabled (read-only mode)")
```

### `_send_email(to_addr, body, reply_to_msg_id)` (line 521)

Builds MIME message with:
- In-Reply-To and References headers from thread context
- Subject: "Re: <original subject>"
- Message-ID: `<hermes-{uuid}@{domain}>`
- Plain text body via MIMEText

## Logging Pattern

```
INFO  [Email] New message from <sender>: <subject>
WARNING gateway.run: Unauthorized user: <sender> (<name> über Kleinanzeigen) on email   # Only if EMAIL_ALLOWED_USERS is set
INFO  [Email] Sent reply to <sender> (subject: Re: <subject>)                           # Only if outbound is on
ERROR [Email] IMAP fetch error: <message>                                                # Periodic timeouts are normal
```

## Conversation History (May 27, 2026)

The following Kleinanzeigen email auto-replies were sent (ALL via email, not via the Kleinanzeigen browser chat):

| Time (UTC) | Seller | Listing | Emails sent |
|------------|--------|---------|-------------|
| 03:55 | Boris | Elops 120e | Received email → auto-replied via email 4s later |
| 04:15 | Mike | Chrisson 28er (€600) | Received email → auto-replied via email 1s later |
| 04:23 | Mike | Follow-up | Another seller reply → gateway warned "Unauthorized" but auto-reply sent anyway |
| 05:39 | Privat | INSYNC e-bike (€320) | Received email → auto-replied via email 2s later |
| 06:12 | Lars | Gudereit LC-45 | Received email → auto-replied via email 1s later |
| 08:54 | Noah | BBF bike (28") | Received email → auto-replied via email 1s later |

All these emails bypassed `_is_automated_sender()` because `mail.kleinanzeigen.de` doesn't match any noreply pattern. The replies went to the Kleinanzeigen notification email address, which Kleinanzeigen forwarded as chat messages to the sellers — making the sellers see bot-like responses from the Kleinanzeigen account.
