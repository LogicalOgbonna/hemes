# Post-Restart Recovery: Camofox + Kleinanzeigen

When the Camofox server has been fully down (process killed, system reboot, Docker stopped) and you need to recover a logged-in Kleinanzeigen session, persistent profiles may NOT survive. This reference covers the full recovery flow.

## Detection: How Dead is It?

Run these checks to understand what state you're in:

### Server completely dead
```
curl -sf http://localhost:9377/health
→ connection refused (curl error 7)
```
Action: Start Camofox via background npm.

### Server up, no browser process
```
curl -sf http://localhost:9377/health
→ {"ok":true,"browserConnected":false,"browserRunning":false,...}
```
Action: Creating a tab auto-launches the Camoufox binary, but persistent session may or may not survive.

### Creating a tab → login redirect
```
POST /tabs {"userId":"mercator","url":"https://www.kleinanzeigen.de/m-nachrichten.html"}
→ Response URL contains login.kleinanzeigen.de
```
Session is truly lost. Even though you used the same userId, the browser profile storage was wiped or the persistence plugin state was cleared on restart. Proceed to full re-login.

## Step 1: Start Camofox

The server runs via npm, NOT Docker, on this setup:

```
terminal(background=true, command="cd /tmp/camofox-browser && npm start")
```

Wait 3-5 seconds, then verify:

```
curl -sf http://localhost:9377/health
```

Expected: `{"ok":true,"engine":"camoufox","browserConnected":false,"browserRunning":false,...}`

`browserConnected` will be `false` until a tab is created — this is normal.

## Step 2: Retrieve Credentials from Infisical (Token-Based)

Do NOT use `infisical export` — that requires a pre-existing token. Instead, use the universal-auth login+secrets-get pattern (same approach as gateway-wrapper.sh):

```bash
INF="/home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical"
CLIENT_ID="62476dd6-1349-43f6-a833-d656bc7d01c4"
CLIENT_SECRET="***REDACTED***"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"

# Step A: Authenticate and get a fresh token
TOKEN=$($INF login --method=universal-auth \
  --client-id="$CLIENT_ID" \
  --client-secret="$CLIENT_SECRET" \
  --silent --plain 2>/dev/null | tail -1)

# Step B: Retrieve specific secrets
EMAIL=$($INF secrets get \
  --token="$TOKEN" \
  --projectId="$PROJECT_ID" \
  --path=/ --env=prod \
  --plain KLEINANZEIGEN_EMAIL 2>/dev/null)

PASSWORD=$($INF secrets get \
  --token="$TOKEN" \
  --projectId="$PROJECT_ID" \
  --path=/ --env=prod \
  --plain KLEINANZEIGEN_PASSWORD 2>/dev/null)
```

**Key advantage over `infisical export`:** This works from a completely clean state with no pre-existing Infisical token, no `$INFISICAL_TOKEN` env var, and no prior `infisical login` session. The client secret is hardcoded in `/home/ubuntu/.hermes/scripts/gateway-wrapper.sh`.

The client-secret is stored in clear text in gateway-wrapper.sh (line 8) for universal-auth. This is the canonical auth method for Hermes → Infisical on this machine.

## Step 3: Create Tab — Detect Session Loss

```bash
curl -s -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","sessionKey":"task-name","url":"https://www.kleinanzeigen.de/m-nachrichten.html"}'
```

Check the response URL field:
- URL contains `kleinanzeigen.de/m-nachrichten` → session recovered, skip to Step 6
- URL contains `login.kleinanzeigen.de` → session lost, continue to Step 4
- Connection error → wait 2 more seconds and retry

## Step 4: Login via Camofox REST API (terminal + curl)

Use `curl` commands via `terminal()` — no `execute_code` needed for a simple login.

### 4a: Get snapshot to verify email page
```
curl -s "http://localhost:9377/tabs/{tabId}/snapshot?userId=mercator" | python3 -c "import json,sys;print(json.load(sys.stdin)['snapshot'][:400])"
```

Elements on email page:
- Textbox `e4` — "E-mail" input
- Button `e6` — "Weiter" (Continue)

### 4b: Type email
```
curl -s -X POST http://localhost:9377/tabs/{tabId}/type \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","ref":"e4","text":"arinze.devops@gmail.com"}'
```

### 4c: Click Weiter
```
curl -s -X POST http://localhost:9377/tabs/{tabId}/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","ref":"e6"}'
```

This navigates to the password page. Elements:
- Textbox `e5` — "Passwort" input
- Button `e8` — "Einloggen" button

### 4d: Type password
```
curl -s -X POST http://localhost:9377/tabs/{tabId}/type \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","ref":"e5","text":"Monkey2020@"}'
```

### 4e: Click Einloggen
```
curl -s -X POST http://localhost:9377/tabs/{tabId}/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","ref":"e8"}'
```

On success, the response URL should be something like `https://www.kleinanzeigen.de/m-nachrichten.html?login=success`.

**If 2FA/MFA is enabled:** After login, Kleinanzeigen sends an SMS. The page will show a 6-digit code input. Notify the user and wait for them to provide the code. Steps: type code into textbox (ref e4), click "Fortfahren" (ref e5).

## Step 5: Accept Cookie Consent Dialog

After login, a cookie consent dialog ("Willkommen bei Kleinanzeigen") always appears. It silently blocks ALL page interactions. ALWAYS dismiss first:

### Check for dialog
Look at the snapshot for `- dialog "Willkommen bei Kleinanzeigen"`. If present, dismiss it.

### Dismiss via ref click (fast when ref is stable)
Scan the snapshot for a button containing "Alle Cookies und Tracking akzeptieren". In the post-login state, this is typically ref `e48`, but refs change on every snapshot — scan dynamically:

```bash
# Find the accept button ref dynamically
curl -s "http://localhost:9377/tabs/{tabId}/snapshot?userId=mercator" | grep -i "akzeptieren"
```

Then click:
```
curl -s -X POST http://localhost:9377/tabs/{tabId}/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","ref":"e48"}'
```

### Alternative: dismiss via evaluate (JS approach, always works)
```bash
curl -s -X POST http://localhost:9377/tabs/{tabId}/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","expression":"(()=>{const btns=document.querySelectorAll(\"button\");for(const b of btns){if(b.textContent.includes(\"Alle akzeptieren\")){b.click();return \"dismissed\"}}return \"none\";})()"}'
```

## Step 6: Navigate to Messages and Read

```bash
curl -s -X POST http://localhost:9377/tabs/{tabId}/navigate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","url":"https://www.kleinanzeigen.de/m-nachrichten.html"}'
sleep 2

# Get snapshot to read conversation list
curl -s "http://localhost:9377/tabs/{tabId}/snapshot?userId=mercator"
```

The snapshot shows all conversations as `article` elements. Each has:
- `heading [level=3]` with listing title (and "Reserviert •" or "Gelöscht •" prefix)
- Seller name + timestamp
- Text preview of last message

Messages inside a conversation thread appear as `listitem` elements inside a `list` element in the article detail pane (right side on desktop, full screen on mobile).

## Pitfalls

- **Refs change every snapshot** — e4/e6/e5/e8 are the SNAPSHOT-SCOPED values from THIS session. They may differ next time. Always scan the snapshot for the correct input/button labels.
- **Cookie dialog returns on EVERY fresh session** — After server restart + re-login, the dialog is always shown. This is not a one-time thing. Never skip the cookie check.
- **Infisical client secret is not a secret** — It's stored in plaintext in gateway-wrapper.sh. That's by design (universal auth with a machine client). The actual secrets (API keys, passwords) are protected by Infisical RBAC.
- **`tail -1` on login output** — Infisical login outputs several lines; the actual token is always the last non-empty line.
- **`secrets get --plain` may not work on older infisical CLI** — If `--plain` isn't supported, use `--output=plain` instead or fall back to the `infisical run -- echo $VAR` pattern.
- **After login, navigate again** — The login redirects to `/m-nachrichten.html?login=success` which loads the messages page directly, but navigating again ensures the page state is fresh.

## Alternative: Using execute_code (Python) instead of terminal curl

For messages with German umlauts (ä, ö, ü, ß, €), use `execute_code` with `json.dumps()` to avoid shell encoding issues:

```python
from hermes_tools import terminal
import json

tab_id = "your-tab-id"

# Login with email (no special chars needed for email)
terminal(f'curl -s -X POST http://localhost:9377/tabs/{tab_id}/type -H "Content-Type: application/json" -d \'{json.dumps({"userId": "mercator", "ref": "e4", "text": "arinze.devops@gmail.com"})}\'')

# Click Weiter
terminal(f'curl -s -X POST http://localhost:9377/tabs/{tab_id}/click -H "Content-Type: application/json" -d \'{json.dumps({"userId": "mercator", "ref": "e6"})}\'')

# Type password
terminal(f'curl -s -X POST http://localhost:9377/tabs/{tab_id}/type -H "Content-Type: application/json" -d \'{json.dumps({"userId": "mercator", "ref": "e5", "text": "Monkey2020@"})}\'')

# Click Einloggen
terminal(f'curl -s -X POST http://localhost:9377/tabs/{tab_id}/click -H "Content-Type: application/json" -d \'{json.dumps({"userId": "mercator", "ref": "e8"})}\'')
```

This avoids all shell escaping issues with special characters.
