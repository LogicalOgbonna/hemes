# Camofox Screenshot Endpoint Behavior

The `GET /tabs/{tabId}/screenshot?userId={user}` endpoint returns raw PNG bytes — **not** JSON.

## What NOT to do

```python
# This FAILS — response is binary, not JSON:
data = json.loads(resp.read())  # UnicodeDecodeError: 'utf-8' can't decode byte 0x89
```

## What works

```python
import urllib.request

resp = urllib.request.urlopen(
    f"http://localhost:9377/tabs/{tab_id}/screenshot?userId=mercator",
    timeout=15
)
with open("screenshot.jpg", "wb") as f:
    f.write(resp.read())
```

## Why this matters

The response starts with `0x89 0x50 0x4E 0x47` (PNG magic bytes). Python tries to decode it as UTF-8 and fails with:

```
UnicodeDecodeError: 'utf-8' codec can't decode byte 0x89 in position 0: invalid start byte
```

## Handling both raw and base64 responses

Some Camofox endpoints may return JSON with base64-encoded image. Be defensive:

```python
raw = resp.read()
if raw.startswith(b'{'):
    data = json.loads(raw)
    img_data = base64.b64decode(data["screenshot"])
    with open(path, "wb") as f:
        f.write(img_data)
else:
    with open(path, "wb") as f:
        f.write(raw)
```

In practice, the screenshot endpoint returns raw PNG. The base64 wrapper is a fallback for proxy configurations.
