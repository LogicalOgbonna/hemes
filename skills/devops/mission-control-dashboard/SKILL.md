---
name: mission-control-dashboard
description: "Hermes Mission Control — web dashboard showing kanban tasks, agent activity, and run history in real-time. GIC-inspired design."
version: 2.1.0
author: Hermes Agent
---

# Hermes Mission Control Dashboard (v2)

A real-time web dashboard for the Hermes multi-agent orchestrator. Shows all kanban tasks, agent statuses, activity feed, detail pane with markdown rendering. Design inspired by General Intelligence Company (GIC) — calm authority, sophisticated minimalism.

## Architecture

- **Backend:** Python 3.11+ / Flask + Flask-HTTPAuth (basic auth)
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
- **Data:** SQLite at `~/.hermes/kanban.db`
- **Tunnel:** Cloudflare Tunnel (`trycloudflare.com`, ephemeral)
- **CDN deps:** `marked` (markdown), `DOMPurify` (sanitize)

## File Layout

```
~/.hermes/dashboard/
├── app.py                    # Flask app, routes, auth
├── db.py                     # SQLite connection + queries
├── schema.sql                # Schema extensions (agents, activity tables)
├── requirements.txt          # flask, flask-httpauth
├── static/
│   ├── styles/
│   │   ├── tokens.css        # Design tokens (GIC palette, spacing, type)
│   │   ├── base.css          # Reset, typography, layout
│   │   ├── components.css    # All component styles
│   │   └── animations.css    # @keyframes, transitions, reduced-motion
│   └── scripts/
│       ├── state.js          # Pub/sub state store
│       ├── api.js            # Fetch wrappers + polling (5s interval)
│       ├── markdown.js       # marked + DOMPurify config
│       ├── render.js         # Render functions per component
│       ├── shortcuts.js      # Keyboard shortcuts (j/k/enter/u/r/?/esc)
│       └── main.js           # Entry point, hydration from __INITIAL_STATE__
└── templates/
    └── index.html            # Jinja template (server-rendered shell)
```

## Starting

```bash
cd ~/.hermes/dashboard && venv/bin/python app.py
```

Defaults to port 8765. Auth: `admin` / `hermes` (override with env vars `HERMES_OPERATOR_USER`, `HERMES_OPERATOR_PASSWORD`).

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Server-rendered HTML shell |
| GET | `/api/health` | Unauthenticated health check |
| GET | `/api/state` | Full snapshot (agents, tasks, stats, activity) |
| GET | `/api/state?since=<id>` | Incremental activity since event id |
| GET | `/api/tasks` | List tasks (params: status, agent, limit, offset) |
| GET | `/api/tasks/<id>` | Single task with comments |
| POST | `/api/tasks/<id>/comment` | Add operator comment |
| POST | `/api/tasks/<id>/action` | Action: unblock, approve, reject, reassign |
| GET | `/api/agents` | Agent roster |
| POST | `/api/agents/<name>/heartbeat` | Agent heartbeat (no auth) |
| POST | `/api/agents/<name>/event` | Agent activity event |
| GET | `/api/todos` | List todos |
| POST | `/api/todos` | Add a todo (body: `{text: "..."}`) |
| POST | `/api/todos/<id>/toggle` | Toggle done/undone |
| DELETE | `/api/todos/<id>` | Delete a todo |

## Components

- **Hero band:** Dark Night Sky background, serif title, agent pill, clock, refresh
- **Stats strip:** 5 cards with animated counters (staggered entrance, ease-out cubic)
- **Task board:** Status-grouped cards with agent-colored left rail, collapsible groups
- **Detail pane:** Selected task with rendered markdown body, comments timeline, activity timeline, action buttons
- **Activity feed:** Live-updating (5s poll), agent-color-coded dots, scroll-preserving prepend
- **Filter chips:** Per-agent filter, syncs to URL `?agent=` param
- **Todos panel:** Inline checklist in the sidebar, below Activity. Add, toggle, delete. Stored in `todos` table in kanban.db. Backed by `/api/todos` CRUD routes. Rendered by `renderTodos(state)` in render.js, called from `fullPage()` and `refresh()`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous task |
| `enter` | Open selected task |
| `u` | Unblock current task |
| `r` | Refresh |
| `?` | Shortcut help overlay |
| `esc` | Close overlay |

## Design Reference (GIC "Architectural Night Sky")

The dashboard follows the General Intelligence Company aesthetic. Key rules:

- **Dark hero strip** at top (`#1f1f29` Night Sky), **light body** below for low cognitive load during long sessions
- **Serif headings** for gravitas, **clean sans-serif** for body copy
- **Single cool blue accent** (`#0081c0` Cofounder Blue) — NO neon greens, hot pinks, or saturated accent colors (it's not a Bloomberg terminal)
- **Muted status colors** — running (blue tint), blocked (warm coral), ready (warm neutral), done (muted sage)
- **Agent identity colors** — each agent gets a muted, distinct color. Currently: mercator (blue), zeus (purple), athena (teal), hermes (gray). Add new agents by adding `--agent-<name>` CSS custom property — no JS change needed
- **Animation only for state change**, not decoration. Staggered card entrance, smooth hover transitions, pulse only on running status dots
- **Soft shadows** (`--shadow-*` tokens), **rounded corners** from the radius scale (4px buttons to 24px modals)
- **No glassmorphism, no heavy gradients, no monospace outside IDs, timestamps, and code**
- **Reduced motion** query disables all translations and pulses

## Pitfalls

### Dashboard process dies (no supervisor)

The dashboard runs as a bare `venv/bin/python app.py` process with no systemd service or supervisor. It can die silently (OOM, exception, SIGTERM). There is no auto-restart. To restart: `cd ~/.hermes/dashboard && venv/bin/python app.py &`. Consider wrapping in a systemd --user service or a cron heartbeat if uptime matters.

### Cloudflared binary architecture mismatch

The system is **ARM64 (aarch64)**. Download `cloudflared-linux-arm64`, NOT `cloudflared-linux-amd64` — the amd64 binary gives `Exec format error`. Correct download:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /tmp/cloudflared
chmod +x /tmp/cloudflared
/tmp/cloudflared tunnel --url http://localhost:8765
```

### CDN script loading order (defer vs no-defer)

When CDN scripts (`marked`, `DOMPurify`) use `defer` but local scripts do not, the local scripts execute DURING parsing (blocking) while deferred scripts run AFTER parsing. Result: `marked` and `DOMPurify` are undefined when `main.js` runs.

**Symptom:** Markdown falls back to plain-text escaping — task bodies show raw `## Headers` and `**bold**` syntax. No console errors because the fallback is silent.

**Fix:** All scripts must use `defer` consistently:
```html
<script src="cdn/marked.min.js" defer></script>
<script src="cdn/dompurify.min.js" defer></script>
<script src="scripts/state.js" defer></script>
<script src="scripts/main.js" defer></script>
```

Execution order matches document order. Never mix deferred and non-deferred scripts when execution order matters.

### sqlite3.Row in Python 3.11

`sqlite3.Row` has NO `.get()` method in Python 3.11 (added in 3.12). Use `"col" in row` for existence checks:
```python
# WRONG — AttributeError on Python 3.11:
author = c.get("author", "system")

# RIGHT:
author = c["author"] if "author" in c else "system"
```

### No `updated_at` column in kanban tasks table

The `tasks` table has no `updated_at`. For "last activity" sorting use `COALESCE(started_at, created_at) DESC`. Never refer to `t.updated_at` in SQL — it doesn't exist.

### Timestamp overwrite bug (dict mutation ordering)

When converting Unix timestamps to ISO strings in a dict, save the original values first:
```python
# WRONG — reads the ISO string back as if it were still an int:
task["started_at"] = ts_to_iso(task["started_at"])
task["updated_at"] = ts_to_iso(task["started_at"])  # BOOM: str to fromtimestamp()

# RIGHT:
started_ts = task["started_at"]
task["started_at"] = ts_to_iso(started_ts)
task["updated_at"] = ts_to_iso(started_ts)
```

The error message is: `TypeError: 'str' object cannot be interpreted as an integer`

## Reference Files

- `references/kanban-db-schema.md` — Full table/column reference for ~/.hermes/kanban.db (useful for query tuning)
- `references/schema-extensions.md` — Dashboard-specific tables (agents, activity, todos)
- `references/debugging-common-issues.md` — JS rendering bugs (missing innerHTML, broken brace nesting)

## Related Skills

- `mercator-procurement-agent` — The procurement agent whose tasks appear on this dashboard
- `infisical-secrets` — Credential storage used by the agents tracked here

## Troubleshooting

- **Port in use:** `kill $(lsof -t -i:8765)` then restart
- **Tunnel down:** Re-run cloudflared: `cloudflared tunnel --url http://localhost:8765`
- **No tasks showing:** Check `~/.hermes/kanban.db` exists
- **Auth not working:** Check `HERMES_OPERATOR_USER` / `HERMES_OPERATOR_PASSWORD` env vars
- **Markdown not rendering in detail pane:** CDN scripts (`marked`, `DOMPurify`) must use `defer` and load BEFORE local JS. If local scripts don't have `defer`, the CDN libs won't be available when `main.js` runs. Solution: add `defer` to ALL script tags so they execute in DOM order: `marked` → `dompurify` → `state.js` → `api.js` → `markdown.js` → `render.js` → `shortcuts.js` → `main.js`.
- **Dashboard showing 404s for `/api/status`:** Old v1 browser tab has cached JS polling the wrong endpoints. Hard refresh (Cmd+Shift+R) loads the v2 frontend which polls `/api/state` instead.
- **Markdown not rendering:** Check CDN script defer consistency
