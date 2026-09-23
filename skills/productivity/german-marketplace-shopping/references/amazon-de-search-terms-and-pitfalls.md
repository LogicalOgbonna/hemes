# Amazon.de — Blocking Evidence, Reproduction Commands, Search-Term Workflow

Session-specific detail distilled from the "gym kit shopping" debugging rounds (June 2025). Kept as a support file under `german-marketplace-shopping` because it documents *why* Amazon.de cannot be automated and *what to do instead*.

## Fabricated-ASIN evidence

LLM subagents fabricate Amazon ASINs at ~100% across every approach:

| Approach | Result |
|----------|--------|
| Batch delegate_task (3 parallel) | All fabricated |
| Single-task delegate_task | All fabricated |
| Told to "return raw search results only" | All fabricated |
| Told to "web_fetch and verify the page title" | Claimed verification passed on fake URLs |
| Told to "extract Amazon.de URLs from search results" | Mixed real-looking with clearly sequential ASINs (e.g. B0B1C2D3E4) |
| Sequential single-task calls | All fabricated |

**Do not attempt to get Amazon.de product links via `delegate_task` subagents.**

## Workable search: DuckDuckGo lite

Use Python `requests` (not curl — curl gets blocked) to search via DuckDuckGo lite:

```python
import requests, re
r = requests.post("https://lite.duckduckgo.com/lite/",
    data={"q": "search term Amazon"},
    headers={"User-Agent": "Mozilla/5.0"})
links = re.findall(r'https?://[^"\'<>\s]*amazon\.de[^"\'<>\s]*', r.text)
```

DuckDuckGo lite returns Amazon **search-result** links (not product page links). Amazon product pages with `/dp/ASIN` are NOT returned by this method.

## Verifying Amazon.de links via terminal — does not work

Amazon serves different content to different User-Agents. The title extraction that runs:

```bash
curl -sL --compressed -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.amazon.de/dp/{ASIN}" 2>/dev/null | grep -oP '<title[^>]*>\K[^<]+'
```

Both real and fake ASINs return `<title dir="ltr">Amazon.de</title>` when fetched via curl — **Amazon does not distinguish real vs fake product pages to automated requests.** You cannot programmatically verify an Amazon.de ASIN from the terminal.

## Confirmed blocking

- **curl to Amazon.de**: Returns 200 but serves a generic page regardless of ASIN validity
- **curl to Google**: Returns captcha/bot-detection page
- **Python requests to Amazon.de**: Same as curl
- **Python requests to idealo.de**: Returns 503
- **Subagent web_fetch**: Claims to verify but results are fabricated

## What actually works

There is no reliable programmatic way to get working Amazon.de product links. The only thing that works is:

1. **Provide search terms** the user can paste into Amazon.de themselves:
   - "Nike Dri-FIT Training T-Shirt Herren"
   - "Under Armour UA Tech T-Shirt Herren"
   - "Nike Dri-FIT Trainingsshorts Herren"
   - etc.
2. **Recommend specific product lines by name** (Nike Dri-FIT, Under Armour UA Tech, Adidas Tiro, etc.)
3. **Give price ranges** from known SRPs
4. **Confirm Prime + same-day** is standard for well-known brands on Amazon.de in Berlin

This is better than sending fake links. The user can search, see photos and prices, and choose sizes.

## Prime & same-day delivery (Berlin)

- Prime eligibility is shown on the product page
- Same-day delivery to Berlin is available for orders before ~12:00
- Same-day availability depends on Amazon FC stock in Berlin
- Prices and availability fluctuate hourly

## Price extraction

Prices from search snippets are approximate. For exact prices, visit the product page. Prices in EUR.

## Product categories (worked example: gym clothing)

- **Shirts**: Look for Dri-FIT (Nike), UA Tech (Under Armour), Own the Run / Trainingsshirt (Adidas)
- **Shorts**: Dri-FIT Shorts (Nike), Own the Run Shorts (Adidas)
- **Trousers**: Dri-FIT Academy (Nike), Tiro League (Adidas), Rival Fleece (Under Armour)
- **Training shoes**: Metcon (Nike, ~€140), Dropset (Adidas, ~€100), Fuse (Puma, ~€75)

See `references/verified-gym-kit-2025-06.md` for the full search-term list and a starter-set recommendation.
