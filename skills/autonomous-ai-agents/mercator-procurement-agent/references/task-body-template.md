# Task Body Template for Procurement Tasks

Use this template when creating a Kanban task for Mercator. Fill in all bracketed fields. Adjust sections per item type.

## Template

```
## Item: [Item Name]

**Type:** [Item type — be specific. "E-Bike" not "bike", "Gaming chair" not "chair"]
**Budget:** Max €[amount] (hard cap, do not exceed. [Reference price/user precedent if any])
**Location:** [City], [Country]
**Marketplaces:** [e.g. Kleinanzeigen (priority), eBay]
**Deadline:** [Within N days/weeks]
**Condition:** [Good, fully functional, no major damage]

## Specs
- [Key spec 1]
- [Key spec 2]
- [Key spec 3]
- Must be [rideable/usable/functional] immediately — no project items
- Extras preferred: [list of desirable extras]

## Fraud & Stolen Check
- Verify serial/frame number photo from seller
- Check against relevant theft database
- If serial is scratched/filed or seller refuses to provide — reject immediately
- Ask why selling and how long owned (inconsistencies = fraud signal)
- Request photo with today's date (proves possession)
- Check seller account age and rating

## Delivery
- Pickup in person (user handles payment + transport)
- Seller must accept cash on pickup
- Never agree to off-platform payment or shipping

## Negotiation guidance
- Fair market range: [range based on real market data]
- Open at 15-20% below asking
- Walk away at €[max price]
- Specific adjustment: [e.g. battery issues = significant reduction]
```

## Example: E-Bike Purchase

This is the actual body used for a successful e-bike search:

```
## Item: E-Bike (Pedelec)

**Type:** E-Bike — MUST be an e-bike, NO regular bicycles
**Budget:** Max €600 (hard cap, do not exceed). Reference: user bought a good e-bike for €400 before.
**Location:** Berlin, Germany
**Marketplaces:** Kleinanzeigen (priority), eBay
**Deadline:** Within 1 week
**Condition:** Good, fully functional, no major rust or damage

## Specs
- Wheel size: 24" is okay
- Motor: Good quality, battery is the most critical component
- Battery health #1 priority — must ask seller: battery age, range per charge, charge cycles, any degradation
- Must come with battery charger
- Must come with keys (ask seller specifically — both battery key and any wheel lock key)
- Must be rideable immediately — no project bikes
- Extras preferred: lights, rack, fenders, lock
- Frame: Men's/Unisex, suitable for ~175cm rider

## Fraud & Stolen Check
- Verify against bike theft database (e.g. ebike-diebstahl.de, ADFC bike registry, Polizei stolen bike database) — check frame number/serial
- Verify frame number/serial photo from seller
- If frame number is scratched, filed off, or seller refuses to provide — reject immediately
- Ask why selling and how long owned (inconsistencies = fraud signal)
- Check seller account age and rating on Kleinanzeigen
- Request a photo of the bike with today's date on paper (proves seller has the actual item)

## Delivery
- Pickup in person (user handles payment + transport)
- Seller must accept cash on pickup
- Never agree to off-platform payment or shipping

## Negotiation guidance
- Fair market for decent used e-bike in Berlin: €400–€700 (user has bought good one for €400 before)
- Open at 15-20% below asking
- Walk away at €700 absolute max
- Battery health issues = significant price reduction or reject
```

## Pitfalls

- **Ambiguous item type** — "bicycle" when user means "e-bike" wastes a full agent run. Confirm the exact type before creating the task.
- **Unrealistic budget** — check real market prices before setting budget. E-bikes under €500 in Berlin are nearly all broken or suspicious.
- **Missing battery health for e-bikes** — battery is the single most expensive component. Always list it first in specs.
- **Forgotten stolen check** — always require serial/frame number and verify against a theft database. Scratched serial = guaranteed theft.
- **Forgotten keys/charger** — many used e-bikes don't include these. Must be explicitly asked.
- **Daytime-only responses** — Kleinanzeigen sellers in Germany typically reply 08:00-22:00. Night-time outreach is queued, not ignored.
