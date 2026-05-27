---
name: daily-itinerary-planner
description: "Plan, rework, and sync daily schedules with Google Calendar — conversational itinerary building with time-blocking."
version: 1.0.0
author: Hermes Agent
category: productivity
tags:
  - calendar
  - itinerary
  - planning
  - schedule
  - google-workspace
related_skills:
  - google-workspace
  - spreadsheet-to-calendar
---

# Daily Itinerary Planner

Plan or rework a daily schedule in conversation and sync the result to Google Calendar. This skill covers the conversational workflow of time-blocked daily planning — different from bulk spreadsheet imports (see `spreadsheet-to-calendar` skill).

## Trigger

User asks to:
- "Rework my today's itinerary"
- "Plan my day"
- "Rearrange my schedule for tomorrow"
- "Can you build a schedule for [date]?"
- Any request involving wake time, cancellations, priority shifts, or errands that needs a structured day plan

## Workflow

### Step 1: Check current calendar state

Use the `google-workspace` skill's Google Calendar API to list today's events:

```bash
GAPI="python ~/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
$GAPI calendar list --start YYYY-MM-DDT00:00:00+02:00 --end YYYY-MM-DDT23:59:59+02:00
```

- If the calendar is empty, note that to the user
- If events exist, summarize them (time, title) before proposing changes

**Timezone rule:** Always use the user's timezone. Common ones: `+02:00` (CEST), `+01:00` (CET/WAT), `Z` (UTC). The user's timezone should be in memory.

### Step 2: Gather constraints from the user

Ask about:
- **Wake time** — when does the day start?
- **Cancellations** — any existing blocks to remove? (e.g. "no gym today")
- **Priorities** — what's the first deep work session?
- **Errands/appointments** — specific commitments with fixed times (e.g. "Media Mart at 9-10am")
- **Reading/learning** — any book or topic to slot in as a break activity
- **Existing blocks to keep** — family time, lunch, evening reflection

### Step 3: Build the time-blocked itinerary

Structure the day as a table with clear time ranges. Typical block types:

| Block Type | Typical Duration | Placement |
|---|---|---|
| Morning routine | 45-60 min | After wake |
| Errand / appointment | Variable, fixed time | As scheduled |
| Deep work session | 1.5-3 hrs | Morning (peak energy) |
| Lunch | 45-60 min | Midday |
| Deep work session 2 | 1.5-3 hrs | Afternoon |
| Break / reading | 15-30 min | Between deep work blocks |
| Evening / family | 2-3 hrs | Evening |
| Reading / reflection | 15-30 min | Before bed |

Present the itinerary to the user and ask for confirmation or adjustments before creating calendar events.

### Step 4: Sync to Google Calendar

Once confirmed, create each time block as a Google Calendar event:

```bash
$GAPI calendar create --summary "Block name" --start "2026-05-25T08:00:00+02:00" --end "2026-05-25T09:00:00+02:00"
```

- Create events sequentially or in a small batch script
- Each event needs a clear summary (the block name) and properly timezoned start/end
- Create ALL confirmed blocks in one pass

### Step 5: Verify

```bash
$GAPI calendar list --start YYYY-MM-DDT00:00:00+02:00 --end YYYY-MM-DDT23:59:59+02:00
```

## Pitfalls

- **Partial-scope token.** If `calendar list` works but `calendar create` returns `HttpError 403: insufficient authentication scopes`, the OAuth token only has `calendar.readonly` not `calendar` (write). Fix: `$GSETUP --revoke` then re-authorize with full scopes. Verify with `jq '.scopes' ~/.hermes/google_token.json`.
- **Timezone omission.** Every ISO 8601 datetime MUST include the offset (`+02:00`, `-05:00`, or `Z`). Omitting it causes Google Calendar to apply its own default timezone, shifting all events.
- **Event deletion.** Never delete existing calendar events without the user's explicit confirmation. Show which events will be removed.
- **Concurrent API calls.** Calendar API has rate limits. For 8+ events, create them sequentially (a bash loop is fine). Avoid parallel creation.
- **Overnight events.** Events that span midnight (e.g., 23:30-01:00) need end datetime on the next calendar date.
- **Recurring events.** For daily recurring blocks (same time every day), use a single event with RRULE instead of creating N copies. This skill handles one-off daily plans; see `spreadsheet-to-calendar` for recurring schedules.
