# Mission Control Dashboard — Schema Extensions

These tables are created by `schema.sql` in the kanban.db at `~/.hermes/kanban.db`. The Hermes Agent's own `tasks` table is unmodified.

## `agents`

Agent roster for the dashboard.

| Column | Type | Notes |
|--------|------|-------|
| codename | TEXT PK | e.g. 'mercator', 'zeus', 'athena', 'hermes' |
| display_name | TEXT | Human-readable name |
| role | TEXT | 'procurement', 'build', 'testing', 'orchestrator' |
| status | TEXT | 'active', 'idle', 'offline' |
| last_heartbeat | TEXT | ISO datetime |
| current_task_id | TEXT | FK to tasks.id |
| shared_secret_hash | TEXT | For agent API auth |

## `activity`

Activity/event log for the dashboard.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | Event ID (used for `since` queries) |
| task_id | TEXT | FK to tasks.id, nullable |
| type | TEXT | 'comment', 'unblocked', 'info', etc. |
| actor | TEXT | Agent codename or 'operator' |
| message | TEXT | Event description |
| timestamp | TEXT | ISO datetime, default `datetime('now')` |

## `todos`

Simple operator todo list (added May 2026).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| text | TEXT | Todo item description |
| done | INTEGER | 0 or 1 |
| created_at | TEXT | ISO datetime, default `datetime('now')` |
