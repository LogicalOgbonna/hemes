---
name: mercator-procurement-agent
description: "Create a procurement & negotiation agent profile (Mercator) for P2P marketplace purchases via Kanban board."
version: 1.3.0
author: Hermes Agent
tags: [procurement, negotiation, kleinanzeigen, marketplace, agent]
---

# Mercator Procurement Agent Setup

Creates an autonomous procurement agent that handles P2P marketplace purchases (Kleinanzeigen, eBay, etc.) end-to-end via Kanban tickets.

## Profile Setup

```bash
mkdir -p ~/.hermes/profiles/mercator
```

Create three files:

### 1. `profile.yaml`
```yaml
description: "Procurement and negotiation agent for peer-to-peer marketplace purchases"
description_auto: false
```

### 2. `config.yaml`
```yaml
platform_toolsets:
  cli: '["hermes-cli","web","file","terminal","browser"]'
toolsets: '["web", "file", "terminal", "browser", "kanban"]'
agent:
  max_turns: 200
```

### 3. `.env`
```
INFISICAL_PROJECT_ID=<project-id>
INFISICAL_PATH=/
INFISICAL_ENV=prod
CAMOFOX_USER_ID=hermes
```

### 4. `SOUL.md`
Full procurement agent prompt covering six-phase operating loop: Intake → Discovery → Vetting → Negotiation → Condition Verification → Resolution.

## Prerequisites

- Camofox browser server running at localhost:9377
- Kleinanzeigen account logged in via Camofox (persistent session)
- Infisical configured with KLEINANZEIGEN_EMAIL and KLEINANZEIGEN_PASSWORD at path /

## Creating a Purchase Task

Use the template in `references/task-body-template.md` to write the task body. Be specific about item type, budget (check real prices first), and always include stolen-check and accessory verification.

```bash
# Via kanban API
kanban_create(
    title="Purchase: <item> in <city> (max €<budget>)",
    assignee="mercator",
    body="""Use template from references/task-body-template.md"""
)
```

## Pitfalls

- **Ambiguous item type** — "bicycle" when user means "e-bike" wastes an agent run. Get the exact type upfront. See the E-Bike example in `references/task-body-template.md`.
- **Wrong conversation when sending messages** — When using `POST /tabs/{tabId}/navigate` to navigate to the messages page, the tab might land on a different conversation than expected. The URL query parameter `conversationId` tells you which conversation is active. Always check it before typing a message. To open the right conversation: click the article's image using `img[alt*="listing title"]` — clicking `h3` or generic elements fails due to Playwright strict mode violations (multiple matching elements). If you sent a message to the wrong seller, you cannot delete it — you must apologize to the recipient and re-send to the correct conversation.
- **JSON encoding of umlauts and special characters in terminal** — When using `curl` to the Camofox API from terminal, German characters (ä, ö, ü, ß, €, „ “) get mangled in shell-quoted JSON strings. Instead of constructing JSON in a shell string, use `execute_code` with Python's `json.dumps()` to build the payload, then pass it via `terminal()` as a here-string. Example:
  ```python
  from hermes_tools import terminal
  import json
  msg = "Hallo, 400€ bar heute — was ist ihr bester Preis?"
  payload = json.dumps({"userId": "mercator", "ref": "e22", "text": msg})
  result = terminal(f'curl -s -X POST http://localhost:9377/tabs/{tab_id}/click -H "Content-Type: application/json" -d \'{payload}\'')
  ```
  This avoids shell interpolation issues entirely. Do NOT rely on shell quoting for messages with special characters.
- **Hermes email gateway intercepts seller replies** — When Mercator messages sellers on Kleinanzeigen, Kleinanzeigen sends notification emails to the user's inbox. If Hermes' email gateway is enabled, it intercepts these emails and auto-responds with pairing codes (e.g. "Hi~ I don't recognize you yet! Here's your pairing code: XXXX..."). Seller replies are lost to the pairing code system. See `references/email-gateway-debugging.md` for full debugging procedure.
- **Unrealistic budget** — e-bikes under €500 in Berlin are nearly all broken. Budget must reflect real market.
- **Missing battery health priority** — for e-bikes, battery is #1. Motor is secondary. Always list battery spec first.
- **Forgotten stolen check** — always verify serial against theft database and request serial photo.
- **Forgotten keys/charger inquiry** — not all sellers include these. Must be explicitly asked.
- **Daytime-only responses** — Kleinanzeigen sellers reply 08:00-22:00. Messages sent at night are queued, not ignored. Don't block the task — it will unblock naturally when responses arrive.
- **Dead eBay API** — eBay.de frequently blocks automation. Don't rely on eBay as a secondary marketplace for this user. Fall back to Kleinanzeigen only.
- **Spec update during run** — if the user corrects specs mid-run (e.g. "e-bike not regular bike"), block the task, update the body, unblock. The agent restarts with the right context.
- **Kanban DB status vs GitHub board status are separate** — the Hermes kanban DB (SQLite) and the GitHub Projects board have independent Status fields. Don't conflate them.
- **Infisical export requires `--projectId`** with machine identity — the `INFISICAL_PROJECT_ID` env var is set to `24881f6a-bfc0-4f83-82df-d0fcc27e8dab` but the CLI does NOT read it automatically. Always pass `--projectId="$INFISICAL_PROJECT_ID"` explicitly: `infisical export --projectId="$INFISICAL_PROJECT_ID" --env=prod --format=json`.

## Email Gateway Interference

**Critical pitfall:** If Hermes has an email gateway enabled, Kleinanzeigen email notifications (sent when sellers reply via email) are intercepted by Hermes. The email gateway polls Gmail IMAP every 15 seconds. When it picks up `@mail.kleinanzeigen.de` notification emails, the auto-responder generates pairing codes or bot-like replies that get sent back to the Kleinanzeigen notification address and then forwarded to sellers. This breaks the communication loop.

**How Kleinanzeigen notifications slip through:** The `_is_automated_sender()` check in `gateway/platforms/email.py` looks for patterns like "noreply", "notifications@", "mailer-daemon" in the sender address, and RFC headers like `Auto-Submitted`, `Precedence`, `List-Unsubscribe`. Kleinanzeigen emails don't match any of these patterns — they come from individual `@mail.kleinanzeigen.de` addresses without automated-mail headers.

### Detection

Check gateway logs for Kleinanzeigen email activity:

```bash
grep "mail.kleinanzeigen" ~/.hermes/logs/gateway.log
```

Auto-replies appear as `[Email] Sent reply to ...@mail.kleinanzeigen.de`. Each entry means a bot-generated message was sent to a seller. Auto-replies happen within 1-3 seconds of the email arriving in the inbox. See `references/email-gateway-debugging.md` for detailed log patterns and a timeline from a real incident.

### Fix Options

#### Option A: Set EMAIL_ALLOWED_USERS (recommended)

The cleanest fix. Restrict the email gateway to only process emails from your own address. Set this in Infisical at path `/`:

```
EMAIL_ALLOWED_USERS=arinze.develops@gmail.com
```

Restart the gateway after applying. Only emails FROM this address will create sessions; Kleinanzeigen notifications and all other external senders are silently dropped at the dispatch level.

#### Option B: Patch the source

Add `kleinanzeigen` to the `_NOREPLY_PATTERNS` tuple in `gateway/platforms/email.py`:

```python
_NOREPLY_PATTERNS = (
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
    "mailer-daemon", "postmaster", "bounce", "notifications@",
    "automated@", "auto-confirm", "auto-reply", "automailer",
    "kleinanzeigen",  # marketplace email notifications
)
```

Restart the gateway after patching. This prevents any sender with "kleinanzeigen" in their address from being processed.

#### Option C: Disable email gateway entirely

```bash
hermes config set gateway.platforms.email.enabled false
hermes gateway restart
```

Only do this if you don't need email-to-Hermes interaction.

#### Option E: Read-only mode patch (applied May 2026)

Patched `gateway/platforms/email.py` to add a `send()` guard that checks the `EMAIL_ALLOW_OUTBOUND` env var. When unset or not `true`, all email replies are silently dropped with a log line `[Email] Read-only mode: not sending reply`. Incoming emails are still received and logged, but no responses go out.

```python
allowed = os.getenv("EMAIL_ALLOW_OUTBOUND", "").strip().lower()
if allowed not in ("1", "true", "yes"):
    logger.info("[Email] Read-only mode: not sending reply to %s", chat_id)
    return SendResult(success=False, error="Email outbound is disabled (read-only mode)")
```

To re-enable outbound replies after securing the gateway: set `EMAIL_ALLOW_OUTBOUND=true` in Infisical at `/` and restart the Hermes gateway.

#### Option D: Approve pairing codes (damage control after the fact)

If messages already went out, pairing codes landed in the Kleinanzeigen chat. You cannot delete sent messages on Kleinanzeigen — they are permanent. To at least unlock the threads so you can continue communicating:

```bash
hermes pairing approve email <CODE>
```

Then re-message sellers directly via the Camofox browser instead of relying on email replies.

## Camofox Browser Messaging Workflow

Use this when you need to message sellers directly through the browser (bypassing email):

### Post-Restart Recovery (Sessions Lost)

After a Camofox server restart, persistent sessions may not survive. If you navigate to Kleinanzeigen and get redirected to the login page:

1. **Export credentials from Infisical:**
   ```bash
   infisical export --projectId=$INFISICAL_PROJECT_ID --env=prod --format=json -o /tmp/creds.json
   # Keys: KLEINANZEIGEN_EMAIL, KLEINANZEIGEN_PASSWORD
   ```

2. **Create a tab with the same userId** used previously (e.g. `"mercator"`) to auto-recover if profiles still exist:
   ```python
   curl -X POST http://localhost:9377/tabs -d '{"userId":"mercator","url":"https://www.kleinanzeigen.de"}'
   ```

3. **If still redirected to login**, re-authenticate via the three-stage Auth0 flow (see `camofox-browser-setup/references/kleinanzeigen-login.md`):
   - Email entry → "Weiter"
   - Password entry → "Einloggen"
   - MFA (SMS code) if enabled — user must provide the code
   - Accept cookie consent dialog ("Alle Cookies und Tracking akzeptieren")

4. **Navigate to messages** after login:
   ```python
   curl -X POST http://localhost:9377/tabs/{tabId}/navigate -d '{"userId":"mercator","url":"https://www.kleinanzeigen.de/m-nachrichten.html"}'
   ```

### Send a Message via Listing Page

1. Navigate to the listing URL directly
2. Wait 3-4 seconds for the page to render
3. Find the message textbox ref in the snapshot (looks like: `textbox "Nachricht Nachricht" [eN]`)
4. Type the message: `POST /tabs/{tabId}/type` with `{"ref": "eN", "text": "..."}`
5. Find the send button ref (looks like: `button "Nachricht senden" [eM]`)
6. Click send: `POST /tabs/{tabId}/click` with `{"ref": "eM"}`

**Note:** The Kleinanzeigen listing contact form has TWO textboxes: one for the message (ref e18 typically) and one for the profile name (ref e19 typically). The profile name is auto-filled. The exclamation-mark icon at ref e23 is NOT the send button — look for `button "Nachricht senden"` instead.

```python
import urllib.request, json, time

req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/navigate",
    data=json.dumps({"userId": "mercator", "url": listing_url}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=15)
time.sleep(3)

req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/snapshot?userId=mercator")
resp = urllib.request.urlopen(req, timeout=10)
snap = json.loads(resp.read())

# Type message
req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/type",
    data=json.dumps({"userId": "mercator", "ref": "e18", "text": msg}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
time.sleep(1)

# Click send — button ref is typically e22 but scan for 'Nachricht senden'
req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/click",
    data=json.dumps({"userId": "mercator", "ref": "e22"}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
```

**Important:** Always write messages in German on Kleinanzeigen. Include specific battery questions for e-bikes: age, range per charge, charge cycles, key included, charger included. Write naturally, one question at a time.

### Aggressive Negotiation Tactics

When this user asks you to bargain on Kleinanzeigen, they want **ruthless negotiation** — 25-30% off the asking price. Use any ethical (and legally permissible) tactic to drive the price down. Polite inquiries are not sufficient.

#### Opening Offer Strategy (Anchor Low)

Send the first offer at **33-40% below asking** to anchor low. Use these pressure points simultaneously:

- **Competitor pricing:** "Ich habe in den letzten Tagen mehrere vergleichbare Angebote gesehen (nennen konkrete Alternativen) die zwischen X€-Y€ liegen mit ähnlicher Ausstattung."
- **Cash urgency:** "Ich könnte heute Nachmittag bar abholen und den Kaufvertrag direkt unterschreiben – unkompliziert und ohne langes hin und her."
- **Minor defect framing:** "Das Rad ist X Jahre alt mit Ykm — der Akku hat schon Degradation. Ein neuer Akku kostet 300-500€."
- **Purchase reason doubt:** "Warum verkaufst du? Neuanschaffung? Dann brauchst du es schnell los."

#### Negotiation Playbook

**Phase 1 — Initial Contact (listing page message)**
Combine interest signal with price doubt: "Das klingt interessant, aber der Preis von X€ ist für ein Y Jahre altes Modell mit Zkm deutlich über dem Marktwert. Ich könnte dir A€ bieten und heute bar abholen."

- For €600 asking → offer €380-400 (target: €420-450)
- For €700 asking → offer €450-490 (target: €490-525)
- For €500 asking → offer €330-350 (target: €350-375)

**Phase 2 — Seller pushes back**
- Ask "Was ist der BESTE Preis den du machen kannst?" — force them to name a number first
- Never accept the first counter-offer. Whatever they say, respond "Das ist leider noch zu hoch. Ich könnte maximal B€ bieten."
- Mention competitor listings again: "Ein [Marke/Modell] mit ähnlicher Ausstattung wird gerade für C€ angeboten."
- If seller offers €500-550 on a €600 listing, counter with €430-450.

**Phase 3 — Closing**
- "Wenn wir uns bei D€ einigen, komme ich heute Nachmittag mit Bargeld vorbei."
- "Ich bin flexibel was den Abholzeitpunkt angeht — auch heute Abend noch möglich."
- After agreeing a price, confirm: "Perfekt. Bitte schick mir deine Adresse und wir treffen uns heute um [Uhrzeit] zur Abholung."

#### Targeting Sellers

- **Active sellers** (responded within hours) are motivated — push harder
- **"VB" (Verhandlungsbasis)** in the listing means they expect negotiation — always negotiate
- **Sellers who mention "Neuanschaffung" or "Umzug"** need to sell fast — use this
- **Older listings (1+ week old)** — the seller is more flexible on price
- **Battery/key information** — if they confirm battery+keys included, use as a positive signal but DON'T let it soften your bargaining

### Verify Messages Sent

Navigate to the messages page and take a screenshot:

```python
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/navigate",
    data=json.dumps({"userId": "mercator", "url": "https://www.kleinanzeigen.de/m-nachrichten.html"}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=15)
time.sleep(2)
# Screenshot to verify
resp = urllib.request.urlopen(f"http://localhost:9377/tabs/{tab_id}/screenshot?userId=mercator", timeout=15)
with open("messages_check.png", "wb") as f:
    f.write(resp.read())
```

If pairing codes appear in the message list, the email gateway intercepted the reply. Re-send messages directly via the listing page instead.

### Check Email Gateway Logs

After verifying messages in the browser, always check if the email gateway auto-responded:

```bash
grep "mail.kleinanzeigen" ~/.hermes/logs/gateway.log
grep "Sent reply.*kleinanzeigen" ~/.hermes/logs/agent.log
```

If any `[Email] Sent reply` entries appear for Kleinanzeigen addresses, the gateway interfered and you need to fix it (see Email Gateway Interference section above) before continuing.

## Camofox Setup

### Listing Media Capture

After candidates are identified, capture listing images and attach to the task. Use Camofox browser API:

1. Navigate to listing: `POST /tabs/{tabId}/navigate` with the Kleinanzeigen URL
2. Extract images: `GET /tabs/{tabId}/images?userId={user}` — filter for `img.kleinanzeigen.de` URLs
3. Download main image via `urllib.request.urlretrieve()`
4. Screenshot listing: `GET /tabs/{tabId}/screenshot?userId={user}` — returns PNG bytes
5. Post a task comment with markdown containing listing name, URL, and notes via `POST /api/tasks/{id}/comment`
6. Deliver to user via `MEDIA:/path/to/image.jpg` in responses

See `camofox-browser-automation` skill for the full API reference.

## Related Files

- `references/task-body-template.md` — Template and real example for writing procurement task bodies
- `references/email-gateway-debugging.md` — Full debugging procedure for Hermes email gateway interference with marketplace notifications
