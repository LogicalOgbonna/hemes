# Debugging Hermes Email Gateway Interference with Marketplace

When Hermes has an email gateway connected (Gmail via Infisical) and you're messaging sellers on Kleinanzeigen via the browser, the email gateway can auto-respond to Kleinanzeigen notification emails and leak pairing codes / bot-like messages to sellers.

## How It Happens

1. Hermes email gateway polls Gmail IMAP every 15 seconds
2. Seller replies on Kleinanzeigen -> Kleinanzeigen sends notification to your Gmail
3. Email comes from `@mail.kleinanzeigen.de` (e.g. `5v5jxj93p3qvv-...-ek-ek@mail.kleinanzeigen.de`)
4. The `_is_automated_sender()` check in `email.py` does NOT catch these because:
   - The sender address doesn't contain "noreply", "mailer-daemon", "notifications@" etc.
   - Kleinanzeigen doesn't set `Auto-Submitted`, `Precedence`, or `List-Unsubscribe` headers
5. The gateway dispatches the email as a message event -> agent generates a reply -> reply sent back to Kleinanzeigen's notification address -> Kleinanzeigen forwards it to the seller

## How to Detect

Check the gateway logs:

```bash
grep "mail.kleinanzeigen" ~/.hermes/logs/gateway.log
grep "mail.kleinanzeigen" ~/.hermes/logs/agent.log
```

The pattern looks like:

```
[Email] New message from 5v5jxj93p3qvv-...-ek-ek@mail.kleinanzeigen.de: Re: Nutzer-Anfrage zu deiner Anzeige "..."
WARNING gateway.run: Unauthorized user: ...@mail.kleinanzeigen.de (... über Kleinanzeigen) on email
[Email] Sent reply to ...@mail.kleinanzeigen.de (subject: Re: Nutzer-Anfrage zu deiner Anzeige "...")
```

Each "Sent reply" entry means a bot-generated message went to a seller.

## Timeline from Real Incident

| Seller | Item | Time | Reply Time |
|--------|------|------|------------|
| Boris | Elops 120e | 04:03 | 3 seconds |
| Mike | Chrisson 28er €600 | 04:15 | 1 second |
| Mike (follow-up) | | 04:23 | (just received) |
| Privat | INSYNC Pendler €320 | 05:39 | 2 seconds |
| Lars | Gudereit LC-45 | 06:12 | 1 second |
| Noah | BBF bike | 08:54 | 1 second |

Auto-replies happen within 1-3 seconds of the email arriving in the inbox.

## How to Fix

### Option A: Set EMAIL_ALLOWED_USERS (recommended)

Restrict the email gateway to only process emails from your own address:

```bash
# In Infisical at path /, set:
EMAIL_ALLOWED_USERS=arinze.develops@gmail.com
```

Then restart the gateway. Only emails FROM this address will be processed; everything else (including Kleinanzeigen notifications) is dropped at the dispatch level.

### Option B: Patch the source

Add `@mail.kleinanzeigen.de` to the `_NOREPLY_PATTERNS` tuple in `gateway/platforms/email.py`:

```python
_NOREPLY_PATTERNS = (
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
    "mailer-daemon", "postmaster", "bounce", "notifications@",
    "automated@", "auto-confirm", "auto-reply", "automailer",
    "kleinanzeigen",  # marketplace email notifications
)
```

Restart the gateway after patching.

### Option C: Disable email gateway entirely

```bash
hermes config set gateway.platforms.email.enabled false
hermes gateway restart
```

Only do this if you don't need email-to-Hermes interaction.

### Option D: Approve pairing codes (worst, damage control)

If messages already went out, pairing codes landed in the Kleinanzeigen chat. You cannot delete sent messages on Kleinanzeigen. Approve the codes to at least unlock the threads:

```bash
hermes pairing approve email <CODE>
```

Then re-message sellers directly via the Camofox browser.

## Verification

After applying the fix, check that Kleinanzeigen emails are no longer processed:

```bash
# Tail the gateway log
tail -f ~/.hermes/logs/gateway.log | grep "kleinanzeigen\|Sent reply"
```

No more "Sent reply to ...@mail.kleinanzeigen.de" entries confirms the fix works.
