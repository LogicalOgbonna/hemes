# Kleinanzeigen Message Sending — Working Technique

## Problem

The Camofox `/click` endpoint often returns `{"ok":true}` for the send button but the message is **not actually sent**. The text stays in the textbox silently. Root causes:

1. **Cookie consent dialog overlay** — intercepts clicks on elements underneath
2. **Stale page state / shifted refs** — the refs (e1, e2...) change between page loads
3. **React JS handler not triggered** — Playwright's `.click()` doesn't always fire React's synthetic event handlers
4. **Empty-text send button** — the send button has `textContent === ''` (empty) because it's an SVG icon button, so `document.querySelector('button:contains("Senden")')` fails

## Reliable Send Technique (evaluate + dispatchEvent)

### Step 1 — Dismiss cookie dialog (if present)

```python
import json, urllib.request

def js(tab_id, expression):
    """Evaluate JavaScript in the Camofox browser tab."""
    data = json.dumps({"userId": "mercator", "expression": expression}).encode()
    req = urllib.request.Request(
        f"http://localhost:9377/tabs/{tab_id}/evaluate",
        data=data,
        headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
    return resp.get("result", resp.get("error", ""))

# Dismiss cookie dialog
js(tab_id, """
(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
        if (b.textContent.includes('Alle akzeptieren')) {
            b.click();
            return 'dismissed';
        }
    }
    return 'no dialog found';
})()
""")
```

### Step 2 — Verify correct conversation is open

Check the URL for `conversationId=<id>`. If absent, the click to open the conversation didn't register.

```python
def get_url(tab_id):
    """Get the current URL of the tab."""
    req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/snapshot?userId=mercator")
    resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
    return resp.get("url", "")

url = get_url(tab_id)
assert "conversationId=" in url, f"No conversation open: {url}"
```

### Step 3 — Check for stale text in the textbox

Multiple failed send attempts stack text. Clear the textbox first if needed.

```python
js(tab_id, """
(() => {
    const ta = document.getElementById('nachricht');
    if (ta && ta.value.trim()) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, '');
        ta.dispatchEvent(new Event('input', {bubbles: true}));
        return 'cleared: ' + ta.value.length;
    }
    return 'already empty';
})()
""")
```

### Step 4 — Type message via native setter (not Camofox /type endpoint)

The Camofox `/type` endpoint can fail if the textbox ref is stale. Use the JavaScript evaluate instead:

```python
message = "Hallo Andi, ..."  # your message here
js(tab_id, f"""
(() => {{
    const ta = document.getElementById('nachricht');
    if (!ta) return 'no textarea';
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(ta, {json.dumps(message)});
    ta.dispatchEvent(new Event('input', {{bubbles: true}}));
    return 'typed: ' + ta.value.substring(0, 30);
}})()
""")
```

### Step 5 — Click send by aria-label with mouse event dispatch

This is the critical step. The send button is:
- `<button type="submit">` with empty textContent (SVG icon inside)
- `aria-label="Senden"`
- Inside the conversation detail pane

```python
js(tab_id, """
(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
        const label = b.getAttribute('aria-label') || '';
        if (label === 'Senden') {
            b.click();
            b.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
            return 'clicked: ' + (b.className || '').substring(0, 40);
        }
    }
    return 'no Senden button found';
})()
""")
```

### Step 6 — Wait and verify

```python
import time
time.sleep(3)

# Check if textbox is empty (message sent)
result = js(tab_id, """
(() => {
    const ta = document.getElementById('nachricht');
    if (ta && ta.value.trim()) return 'STILL IN TEXTBOX: ' + ta.value.substring(0, 50);
    return 'EMPTY — MESSAGE SENT';
})()
""")
print(f"Result: {result}")
```

### Step 7 — Verify in thread (belt-and-suspenders)

Navigate to the messages page and check the conversation preview shows your message:

```python
# Navigate fresh
data = json.dumps({"userId": "mercator", "url": "https://www.kleinanzeigen.de/m-nachrichten.html"}).encode()
req = urllib.request.Request(
    f"http://localhost:9377/tabs/{tab_id}/navigate",
    data=data,
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=15)
time.sleep(2)

# Check snapshot for your message text in the preview
req = urllib.request.Request(f"http://localhost:9377/tabs/{tab_id}/snapshot?userId=mercator&compact=true")
resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
snap = resp.get("snapshot", "")
for line in snap.split('\\n'):
    if 'akzeptiert' in line.lower() or 'Abholung' in line or 'Adresse' in line:
        print(f"✅ Confirmed: {line.strip()[:100]}")
```

## Key Facts About the Kleinanzeigen Send Button

| Attribute | Value |
|-----------|-------|
| tagName | `BUTTON` |
| type | `submit` |
| aria-label | `Senden` |
| textContent | `""` (empty — SVG icon) |
| className | Contains `Button` |
| parent | Inside a div in the conversation detail pane |

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| API returns ok, message not in thread | Cookie dialog overlay | Dismiss cookie dialog first |
| API returns ok, text stays in textbox | Stale page state or refs shifted | Use evaluate + dispatchEvent approach |
| Wrong conversation gets the message | Article index changed | Verify URL has correct conversationId |
| Type endpoint fails ("not a textarea") | Ref points to wrong element (shifted) | Use native setter via evaluate instead |
| Click times out | Cookie dialog overlay | Use evaluate (non-blocking) instead of ref click |

## The One Reasonable Full-Stack Flow

```python
def send_kleinanzeigen_message(tab_id, message):
    import json, urllib.request, time
    
    def js(expr):
        data = json.dumps({"userId": "mercator", "expression": expr}).encode()
        req = urllib.request.Request(
            f"http://localhost:9377/tabs/{tab_id}/evaluate",
            data=data, headers={"Content-Type": "application/json"})
        resp = json.loads(urllib.request.urlopen(req, timeout=20).read())
        return resp.get("result", "")
    
    # 1. Dismiss cookie dialog
    js("""(()=>{const b=document.querySelectorAll('button');for(const x of b){if(x.textContent.includes('Alle akzeptieren')){x.click();return 1}}return 0})()""")
    time.sleep(1)
    
    # 2. Clear + set textbox
    js(f"""(()=>{{const ta=document.getElementById('nachricht');if(!ta)return 0;const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(ta,'');ta.dispatchEvent(new Event('input',{{bubbles:true}}));s.call(ta,{json.dumps(message)});ta.dispatchEvent(new Event('input',{{bubbles:true}}));return 1}})()""")
    time.sleep(1)
    
    # 3. Click send by aria-label
    js("""(()=>{const b=document.querySelectorAll('button');for(const x of b){if(x.getAttribute('aria-label')==='Senden'){x.click();x.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return 1}}return 0})()""")
    time.sleep(3)
    
    # 4. Verify
    result = js("""(()=>{const ta=document.getElementById('nachricht');return ta&&ta.value.trim()?'FAIL':'SENT'})()""")
    return result == 'SENT'
```
