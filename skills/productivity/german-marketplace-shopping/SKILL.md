---
name: german-marketplace-shopping
description: Buy on German online marketplaces — Amazon.de search-term recommendations (scraping/ASIN automation is blocked) and Kleinanzeigen seller messaging via a logged-in headless browser. Covers channel selection, the fabricated-ASIN pitfall, Prime/same-day delivery, and price extraction.
triggers:
  - user wants to buy something on Amazon.de
  - user asks for product recommendations with prices in Germany
  - user wants to find or message a seller on Kleinanzeigen
  - user needs marketplace links they can actually open
  - user has rejected previous marketplace links as non-working
tags: [shopping, marketplace, amazon, kleinanzeigen, germany, procurement]
---

# German Marketplace Shopping

Class-level playbook for buying on German online marketplaces. Decide the channel first, then follow that channel's section.

## Channel selection

| Marketplace | Automatable? | Approach |
|---|---|---|
| **Amazon.de** | No reliable automation | Recommend product lines + exact search terms; the user searches and buys. See [Amazon.de](#amazonde). |
| **Kleinanzeigen** | Yes (logged-in headless browser) | Drive search, screenshots and seller messaging with the Camofox browser stack. See [Kleinanzeigen](#kleinanzeigen). |

Rule of thumb: if the site serves generic pages to automated requests and hides real inventory behind JS + bot detection (Amazon.de), do not fight it — switch to search-term handoff. If the site is drivable with a persistent logged-in browser profile (Kleinanzeigen), automate it.

## Amazon.de

### Critical pitfall: fabricated ASINs
LLM subagents fabricate Amazon ASINs at ~100%. Every approach tried produced fake links:

| Approach | Result |
|----------|--------|
| Batch delegate_task (3 parallel) | All fabricated |
| Single-task delegate_task | All fabricated |
| "return raw search results only" | All fabricated |
| "web_fetch and verify the page title" | Claimed verification passed on fake URLs |
| "extract Amazon.de URLs from search results" | Mixed real-looking with sequential ASINs (e.g. B0B1C2D3E4) |
| Sequential single-task calls | All fabricated |

**Do not attempt to obtain Amazon.de product links via delegate_task subagents.** It wastes turns and delivers fake links to the user.

### Automation is blocked (verified)
- `curl` / Python `requests` to Amazon.de: HTTP 200 but a generic page regardless of whether the ASIN is real, so you cannot verify an ASIN programmatically.
- Both real and fake ASINs return `<title dir="ltr">Amazon.de</title>`.
- `curl` to Google: captcha/bot page. Python `requests` to idealo.de: 503.
- Subagent `web_fetch`: claims to verify, results are fabricated.
- DuckDuckGo lite (via Python `requests`, not curl) returns Amazon **search-result** links, never `/dp/ASIN` product pages.

Full detail + reproduction commands: `references/amazon-de-search-terms-and-pitfalls.md`.

### What actually works
1. Give the user **search terms** to paste into Amazon.de themselves ("Nike Dri-FIT Training T-Shirt Herren", …).
2. Recommend **specific product lines** by name (Nike Dri-FIT, Under Armour UA Tech, Adidas Tiro, …).
3. Give **price ranges** from known SRPs.
4. Confirm **Prime + same-day** is standard for well-known brands on Amazon.de in Berlin.

This beats handing over fake links — the user can search, see photos/prices, and pick sizes.

### Prime & same-day (Berlin)
Prime eligibility is on the product page. Same-day delivery to Berlin for orders before ~12:00, subject to Berlin FC stock. Prices/availability fluctuate hourly.

### Price extraction
Snippet prices are approximate; exact prices require the product page. Currency EUR.

## Kleinanzeigen

Kleinanzeigen *is* automatable with a logged-in headless browser. Use the `camofox-browser-automation` skill for the full mechanics — server lifecycle + keepalive cron, persistent login profiles, the `/tabs` REST API (snapshot / click / type / evaluate / screenshot), and Infisical-backed credentials.

The purchasing-relevant gotchas that live in that skill and bite hardest here:
- **Cookie-consent dialog silently swallows clicks** — dismiss it via `evaluate` before any interaction; it returns on fresh navigations.
- **Element refs (`e19`, …) shift after every navigation** — always re-snapshot; prefer the stable `document.getElementById('nachricht')` textarea.
- **The messages-page send button ignores the ref click** — use `evaluate` + `dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}))`.
- **Conversations reorder after sending** — the thread you just messaged jumps to the top; verify `?conversationId=` before typing.
- **Strict-mode violations** on ambiguous selectors — fall back to `evaluate` with a specific `querySelector`.

See `camofox-browser-automation` and its `references/post-restart-recovery.md` / `references/kleinanzeigen-login.md`.

## Related skills
- `camofox-browser-automation` — headless-browser mechanics (setup, keepalive, API, Kleinanzeigen workflows).
- `mercator-procurement-agent` — procurement/negotiation profile that drives the Kleinanzeigen stack.

## References
- `references/amazon-de-search-terms-and-pitfalls.md` — Amazon.de blocking evidence, reproduction commands, and the search-term workflow.
- `references/verified-gym-kit-2025-06.md` — worked example: search terms + recommended products for gym clothing on Amazon.de.
