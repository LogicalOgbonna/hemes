# Kleinanzeigen Login via Camofox

Kleinanzeigen uses **Auth0** for authentication. The login flow has three stages:

## Prerequisites

Get credentials from Infisical before starting:

```bash
infisical export --projectId="${INFISICAL_PROJECT_ID:-24881f6a-bfc0-4f83-82df-d0fcc27e8dab}" --env=prod --format=json -o /tmp/ka_creds.json
# Keys: KLEINANZEIGEN_EMAIL=arinze.devops@gmail.com, KLEINANZEIGEN_PASSWORD=Monkey2020@
```

Create a tab with the same userId used previously to attempt session recovery:

```bash
curl -s -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","sessionKey":"ebike_search","url":"https://www.kleinanzeigen.de/m-meine-anzeigen.html"}'
```

If the response URL contains `login.kleinanzeigen.de` instead of `kleinanzeigen.de`, the session was lost — proceed with login below. If it lands on the Kleinanzeigen homepage directly, the session was recovered — skip to "Navigate to Messages".

## Stage 1: Email Entry

Navigate to: `https://www.kleinanzeigen.de/m-einloggen.html?targetUrl=/`

Page elements:
- Textbox `e4` — "E-mail" field
- Button `e6` — "Weiter" (Continue)

**Steps:**
1. `POST /tabs/{tabId}/type` with ref `e4`, text = email
2. Wait 1.5s for UI transition
3. `POST /tabs/{tabId}/click` with ref `e6`

This redirects to `https://login.kleinanzeigen.de/u/login/identifier?state=...`

## Stage 2: Password Entry

Page elements:
- Textbox `e5` — "Passwort" field
- Button `e8` — "Einloggen" button

**Steps:**
1. `POST /tabs/{tabId}/type` with ref `e5`, text = password
2. Wait 1.5s
3. `POST /tabs/{tabId}/click` with ref `e8`

## Stage 3: MFA (SMS Code)

If 2FA is enabled, a code is sent via SMS to the registered phone number.

Page elements:
- Textbox `e4` — "6-stelligen Code eingeben"
- Button `e5` — "Fortfahren"
- Button `e6` — "Erneut senden" (resend code)

**Flow:**
1. User receives SMS with 6-digit code — **notify the user** and ask them to provide it
2. `POST /tabs/{tabId}/type` with ref `e4`, text = the 6-digit code
3. `POST /tabs/{tabId}/click` with ref `e5` ("Fortfahren")

After successful login, the URL redirects to the main Kleinanzeigen page and the session is persisted via Camofox's profile storage.

## Cookie Consent

On first visit to Kleinanzeigen, a cookie consent dialog appears. Accept before interacting with the page:

- Button `e61` — "Alle Cookies und Tracking akzeptieren"

If the ref differs (e.g. `e4` on some page variants), scan the snapshot for "Alle Cookies" or "akzeptieren" in the button text.

## Navigate to Messages

```bash
curl -s -X POST "http://localhost:9377/tabs/{tabId}/navigate" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"mercator","url":"https://www.kleinanzeigen.de/m-nachrichten.html"}'
```

## Reading the Messages List

The messages page snapshot shows all conversations as `<article>` elements. Each article contains:
- Checkbox ref (for selection — clicking this does NOT open the conversation)
- Image `alt` text matching the listing title
- Timestamp + seller name
- `heading [level=3]` with the listing title
- Text preview of the last message

To open a specific conversation, click its image using a CSS attribute-contains selector:

```python
# Open Chrisson 28er conversation (from seller "Mike")
open_conversation(selector='img[alt*="Chrisson"]')
```

After clicking, verify the URL now contains `?conversationId=<id>` to confirm the right conversation is open.

## Session Recovery After Restart

If `managed_persistence: true` is set in Hermes config AND the Camofox persistence plugin is enabled, profiles survive server restarts. To recover:

1. Create a tab with the EXACT same userId used during login (e.g. `"mercator"`)
2. The persistence plugin auto-loads `storage-state.json` for that userId
3. Navigate to `https://www.kleinanzeigen.de/m-nachrichten.html`
4. If redirected to login, the session was truly lost — re-run the full login flow above

Profiles are stored at `~/.camofox/profiles/<sha256-hash>/`. If this directory was cleared (e.g. during a full system reset), sessions cannot be recovered.
