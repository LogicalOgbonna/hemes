---
name: amazon-de-shopping
description: Find real product listings on Amazon.de with Prime, same-day delivery to Berlin. Covers searching, verifying links, extracting prices/ratings, and the ASIN fabrication pitfall.
triggers:
  - user wants to buy something on Amazon.de
  - user asks for product recommendations with prices
  - user needs Amazon.de links they can actually open
  - user has rejected previous Amazon links as non-working
---

# Amazon.de Shopping

Workflow for finding real products on Amazon.de that the user can actually open and buy.

## Critical Pitfall: Fabricated ASINs

**LLM subagents fabricate Amazon ASINs at a 100% rate.** This is systemic — it happens regardless of approach, instruction detail, or number of retries. Every single attempt across 5+ rounds produced fake ASINs:

| Approach | Result |
|----------|--------|
| Batch delegate_task (3 parallel) | All fabricated |
| Single-task delegate_task | All fabricated |
| Told to "return raw search results only" | All fabricated |
| Told to "web_fetch and verify the page title" | Claimed verification passed on fake URLs |
| Told to "extract Amazon.de URLs from search results" | Mixed real-looking with clearly sequential ASINs (e.g. B0B1C2D3E4) |
| Sequential single-task calls | All fabricated |

**Do not attempt to get Amazon.de product links via delegate_task subagents.** It wastes turns and delivers fake results to the user.

**The only verified approach is terminal-based:**

### Workable search: DuckDuckGo lite
Use Python `requests` (not curl — curl gets blocked) to search via DuckDuckGo lite:
```python
import requests, re
r = requests.post("https://lite.duckduckgo.com/lite/",
    data={"q": "search term Amazon"},
    headers={"User-Agent": "Mozilla/5.0"})
links = re.findall(r'https?://[^"\'<>\\s]*amazon\\.de[^"\'<>\\s]*', r.text)
```
DuckDuckGo lite returns Amazon search result links (not product page links). Amazon product pages with `/dp/ASIN` are NOT returned by this method.

### Verifying Amazon.de links via terminal
Amazon serves different content to different User-Agents. The title extraction that works:
```bash
curl -sL --compressed -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://www.amazon.de/dp/{ASIN}" 2>/dev/null | grep -oP '<title[^>]*>\\K[^<]+'
```
Both real and fake ASINs return `<title dir="ltr">Amazon.de</title>` when fetched via curl — **Amazon does not distinguish real vs fake product pages to automated requests**. You cannot programmatically verify an Amazon.de ASIN from the terminal.

### Confirmed blocking
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

## Prime & same-day delivery

- Prime eligibility is shown on the product page
- Same-day delivery to Berlin is available for orders before ~12:00
- Same-day availability depends on Amazon FC stock in Berlin
- Prices and availability fluctuate hourly

## Price extraction

Prices from search snippets are approximate. For exact prices, visit the product page. Prices in EUR.

## Reference files

- `references/verified-gym-kit-2025-06.md` — Search terms and product recommendations for gym clothing on Amazon.de. All links were fabricated by subagents; use the search terms instead.

## Product categories (gym clothing specific)

- **Shirts**: Look for Dri-FIT (Nike), UA Tech (Under Armour), Own the Run / Trainingsshirt (Adidas)
- **Shorts**: Dri-FIT Shorts (Nike), Own the Run Shorts (Adidas)
- **Trousers**: Dri-FIT Academy (Nike), Tiro League (Adidas), Rival Fleece (Under Armour)
- **Training shoes**: Metcon (Nike, ~€140), Dropset (Adidas, ~€100), Fuse (Puma, ~€75)

## Related skills

- `camofox-browser-automation` — logged-in headless-browser automation for German marketplaces (Kleinanzeigen messaging, etc.) when the flow needs a real browser session instead of search-term recommendations.
