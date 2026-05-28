---
name: camofox-browser-automation
description: "Automate web tasks using the Camofox headless browser server — navigate, scrape, screenshot, extract page data."
version: 1.2.0
author: Hermes Agent
tags: [browser, automation, scraping, camofox, screenshots]
---

# Camofox Browser Automation

Camofox is a headless browser server (Firefox-based with anti-detection) that runs on port 9377. It provides a REST API for browser automation — create tabs, navigate, extract content, click elements, take screenshots.

## Server Setup

```bash
# Clone and start
git clone https://github.com/jo-inc/camofox-browser.git /tmp/camofox-browser
cd /tmp/camofox-browser && npm install
CAMOFOX_PORT=9377 npm start
```

Server status (always check this first):
```
GET http://localhost:9377/
→ {"ok":true,"enabled":true,"running":false,"engine":"camoufox","browserConnected":false,"browserRunning":false}
```

If `browserConnected: false`, the browser isn't running — creating a tab auto-starts it.

## Hermes Config (for persistent sessions)

```yaml
browser:
  engine: camofox
  camofox:
    managed_persistence: true
    creds_source: none
```

## Core API

### Create Tab (auto-starts browser)

```
POST /tabs
{"userId": "mercator", "sessionKey": "task-name", "url": "https://example.com"}
→ {"tabId": "uuid", "url": "...", "title": "..."}
```

- `userId` isolates cookies/storage per user
- `sessionKey` groups tabs by task
- Sessions timeout after 30 mins of inactivity

### Navigate

```
POST /tabs/{tabId}/navigate
{"userId": "mercator", "url": "https://example.com/page"}
```

Returns when page is loaded. Wait 2-3 seconds after navigation for JS-rendered content.

### Get Page Snapshot (accessibility tree)

```
GET /tabs/{tabId}/snapshot?userId=mercator
→ {"url": "...", "snapshot": "accessibility tree text with element refs e1, e2, ..."}
```

Use this to see page structure and find element refs for clicking.

### Extract Images From Page

```
GET /tabs/{tabId}/images?userId=mercator
→ {"tabId": "...", "images": [{"src": "https://...", "alt": "...", "width": N, "height": N}, ...]}
```

Filter ad-specific images from CDN domains (e.g. `img.kleinanzeigen.de`). Ignore static assets (logos, icons).

### Take Screenshot

```
GET /tabs/{tabId}/screenshot?userId=mercator
```

**Returns raw PNG bytes** (not JSON!). Write directly to file:
```python
resp = urllib.request.urlopen(f"http://localhost:9377/tabs/{tab_id}/screenshot?userId={user}")
with open("screenshot.jpg", "wb") as f:
    f.write(resp.read())
```

Some endpoints may return `{"screenshot": "<base64>"}` — handle both by checking if response starts with `b'{'`.

### Click Element

```
POST /tabs/{tabId}/click
{"userId": "mercator", "ref": "e1"}
```

Use `ref` from snapshot, or `selector` (CSS selector).

### Type Text

```
POST /tabs/{tabId}/type
{"userId": "mercator", "ref": "e2", "text": "Hello", "pressEnter": true}
```

### Get Page Links

```
GET /tabs/{tabId}/links?userId=mercator&limit=50
→ {"links": [{"url": "...", "text": "..."}, ...]}
```

### Execute JavaScript

```python
POST /tabs/{tabId}/evaluate
{"userId": "mercator", "expression": "document.title"}
→ {"result": "Page Title"}
```

**Note:** The field is `expression` (not `script`). Omitting it returns `{"error": "expression is required"}`.

### Scroll

```
POST /tabs/{tabId}/scroll
{"userId": "mercator", "direction": "down", "amount": 500}
```

### Close Tab

```
DELETE /tabs/{tabId}?userId=mercator
```

### Manage Sessions

```
DELETE /sessions/{userId}    # Delete all user data (cookies, storage)
GET /sessions/{userId}/cookies  # Export cookies
```

## Common Workflows

### Send a Message on Kleinanzeigen Listing

Useful for procurement agents — send messages to marketplace sellers directly through the browser, bypassing email notifications:

```python
import urllib.request, json, time

tab_id = "your-tab-id"

# 1. Navigate to the listing
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/navigate",
    data=json.dumps({"userId": "mercator", "url": listing_url}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=15)
time.sleep(3)

# 2. Get snapshot to find refs
req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/snapshot?userId=mercator")
resp = urllib.request.urlopen(req, timeout=10)
snap = json.loads(resp.read())
snapshot = snap.get("snapshot", "")

# 3. Find the message textbox by scanning for 'textbox' + 'Nachricht'
#    Looks like: textbox "Nachricht Nachricht" [e19]
# 4. Type the message
msg = "Hallo, ich habe Interesse. Können Sie mir bitte mehr Details zur Batterie nennen?"
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/type",
    data=json.dumps({"userId": "mercator", "ref": "e19", "text": msg}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
time.sleep(1)

# 5. Find and click the send button
#    Looks like: button "Nachricht senden" [e23]
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/click",
    data=json.dumps({"userId": "mercator", "ref": "e23"}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
```

**Finding the correct refs:** Refs (`e19`, `e23`) change every navigation. You must get a fresh snapshot after each page load and scan for the right element by type (textbox/button) and label text.

### Check Messages on Kleinanzeigen

Navigate back to the messages page to verify sent messages:

```python
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/navigate",
    data=json.dumps({"userId": "mercator", "url": "https://www.kleinanzeigen.de/m-nachrichten.html"}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=15)
time.sleep(2)

# Screenshot to verify
resp = urllib.request.urlopen(
    f"http://localhost:9377/tabs/{tab_id}/screenshot?userId=mercator", timeout=15)
with open("messages.png", "wb") as f:
    f.write(resp.read())

# Or get snapshot text to read message list
req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/snapshot?userId=mercator")
resp = urllib.request.urlopen(req, timeout=10)
snap = json.loads(resp.read())
```

The conversation list shows each thread with a heading (item title), seller name, timestamp, and a text preview of the last message. Look for pairing code messages — if present, Hermes' email gateway intercepted the reply.

```python
import urllib.request, json, time

# Create tab
req = urllib.request.Request("http://localhost:9377/tabs",
    data=json.dumps({"userId": "agent", "url": listing_url}).encode(),
    headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req, timeout=15)
tab_id = json.loads(resp.read())["tabId"]

# Wait for page to load
time.sleep(3)

# Take screenshot
resp = urllib.request.urlopen(f"http://localhost:9377/tabs/{tab_id}/screenshot?userId=agent", timeout=15)
with open("screenshot.jpg", "wb") as f:
    f.write(resp.read())
```

### Extract All Listing Images and Download Main

```python
# Get images
resp = urllib.request.urlopen(f"http://localhost:9377/tabs/{tab_id}/images?userId=agent", timeout=10)
images = json.loads(resp.read()).get("images", [])

# Filter to listing photos (not logos/icons)
listing_imgs = [i for i in images if "img.kleinanzeigen.de" in i.get("src", "")]

# Download main image
if listing_imgs:
    urllib.request.urlretrieve(listing_imgs[0]["src"], "main_photo.jpg")
```

## Pitfalls

- **Browser starts on first tab creation** — creating a tab may take 3-5 seconds the first time as the browser launches
- **30-min session timeout** — inactive tabs are auto-closed. Always recreate if you get a 404
- **Screenshot returns raw PNG, not JSON** — the `/screenshot` endpoint returns binary image data, not a JSON wrapper. Don't try to `json.loads()` it
- **Kleinanzeigen login persists per userId** — once logged in, all tabs for that userId share the session
- **Rate limits** — don't hammer the API. Add `time.sleep(1-3)` between navigations to avoid overwhelming the browser
- **`$_59.AUTO` image rule** — Kleinanzeigen image URLs include a size rule (`?rule=$_59.AUTO`). This returns ~960px wide, which is good enough
- **Element refs change on every navigation** — Refs like `e19`, `e23` are per-page-snapshot. After any navigation or click, you MUST get a fresh snapshot to find the new refs. Stale refs return 404 or click the wrong element
- **Check browser status first** — always `GET /` to confirm `browserConnected: true` before trying to create tabs
- **Opening Kleinanzeigen conversations** — The messages page lists conversations as `<article>` elements. To open a specific conversation, click the article's image using a CSS selector: `img[alt*="partial item title"]`. DO NOT use `h3` selectors — Playwright's strict mode detects multiple matching headings and throws `strict mode violation`. The `img` element inside each article is unique. Clicking the associated checkbox ref (e15, e16, etc.) only selects/deselects the checkbox; it does not open the conversation.
- **Verifying the correct conversation is open** — After clicking a conversation, the URL contains `?conversationId=<id>`. Always check this before typing a message. If the conversation ID doesn't match the expected seller, re-open the correct conversation before sending.
- **`selector` fallback when `ref` fails** — If clicking by ref returns a "strict mode violation" (multiple elements match) or a 404, try CSS selectors instead: `{"userId": "mercator", "selector": "button:has-text(\"Senden\")"}` or `{"userId": "mercator", "selector": "a[href*=\"partial-link\"]"}`. CSS selectors bypass the snapshot ref system and find elements by DOM query directly.
- **Kleinanzeigen listing contact form has two textboxes** — The "message the seller" form on an ad page has TWO textboxes: the message body (typically ref e18) and a profile/name field (typically ref e19). The profile field is auto-filled. The send button is "Nachricht senden" (typically ref e22), NOT any icon button next to it (which is the "share" button at e24 or "add to favorites" at e25).
- **Kleinanzeigen search URLs are finicky** — The URL format for filtered searches changes. A known-working pattern: `https://www.kleinanzeigen.de/s-<city>/<query>/preis:<min>:<max>/k0l<locationId>`. Berlin's location ID is `3331`. Example: `https://www.kleinanzeigen.de/s-berlin/e-bike/preis:0:699/k0l3331`. Setting location via URL parameter `l3331` in some category paths redirects to a 404 page. Use the search box + location field UI instead of constructing search URLs manually.
- **JSON encoding of special characters in terminal** — When using `curl` from a shell, German umlauts (ä, ö, ü, ß), the € symbol, and Unicode quotes get mangled by the shell's character encoding. Use `execute_code` with `json.dumps()` to build the payload, then pass the string via `terminal()`. Example:
  ```python
  from hermes_tools import terminal
  import json
  payload = json.dumps({"userId": "mercator", "ref": "e22", "text": "Hallo, 400€ bar — was ist Ihr bester Preis?"})
  result = terminal(f'curl -s -X POST "http://localhost:9377/tabs/{tab_id}/click" -H "Content-Type: application/json" -d \'{payload}\'')
  ```
- **Kleinanzeigen conversation navigation** — The messages page (`/m-nachrichten.html`) lists conversations as `<article>` elements. To open a specific conversation, DO NOT click the `h3` heading (Playwright strict mode detects multiple matching headings and throws `strict mode violation`). Instead, click the article's image using a CSS selector with attribute-contains match:
  ```python
  # Open conversation for "Chrisson 28er"
  click(userId="mercator", selector='img[alt*="Chrisson"]')
  ```
  After clicking, the URL changes to include `?conversationId=<id>`. Verify the correct conversation is open before typing a message — clicking the checkbox ref (eN) only selects/deselects the checkbox, it does NOT open the conversation.
- **Kleinanzeigen cookie consent** — On first visit or after session reset, a cookie consent dialog appears over the page. Click the "Alle Cookies und Tracking akzeptieren" button (typically ref `e4` or `e61`) before interacting with any page content. Without dismissing it, clicks may land on invisible overlay elements and fail silently.

## Blob Storage (image cache)

When capturing listing images, write to a task-scoped directory rather than cwd:

```python
import os, time
from pathlib import Path

cache_dir = Path.home() / ".hermes" / "image_cache" / task_name
cache_dir.mkdir(parents=True, exist_ok=True)
path = cache_dir / f"listing_{int(time.time())}.jpg"

resp = urllib.request.urlopen(screenshot_url)
path.write_bytes(resp.read())
```

## Profile Persistence

Camofox stores browser profiles (cookies, localStorage) on disk for session recovery across server restarts.

### Storage location

Profiles live at `~/.camofox/profiles/` (default) or the path set by `CAMOFOX_PROFILE_DIR` env var. Each subdirectory is a **SHA-256 hash** of the userId:

```
~/.camofox/profiles/
├── 2a85318b.../     # userId = "mercator_procurement"
│   ├── storage-state.json   # cookies + localStorage
│   └── meta.json            # {userId, updatedAt, storageStatePath}
├── 47eb3be8.../     # userId = "mercator"
│   ├── storage-state.json
│   └── meta.json
├── 8cfde6ef.../     # userId = "hermes"
└── ...
```

### Finding the right profile

To find which profile belongs to a userId, read the `meta.json` file in each subdirectory:

```bash
for dir in ~/.camofox/profiles/*/; do
    hash=$(basename "$dir")
    if [ -f "$dir/meta.json" ]; then
        echo "$hash: $(cat $dir/meta.json)"
    fi
done
```

### Restoring a session

When Camofox restarts, previously logged-in sessions can be recovered by using the SAME userId that was used when the profile was created. The persistence plugin auto-loads `storage-state.json` when a tab is created with a matching userId.

### Key userIds used in this setup

| userId | Purpose |
|--------|---------|
| `mercator` | Main Kleinanzeizen procurement agent |
| `mercator_procurement` | Earlier Mercator iteration (may have older session) |
| `hermes` | Generic/default sessions |
