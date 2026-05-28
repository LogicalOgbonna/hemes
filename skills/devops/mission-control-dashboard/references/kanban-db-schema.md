# kanban.db Schema Reference

The Hermes kanban board uses SQLite at `~/.hermes/kanban.db`. These tables are used by the Mission Control dashboard.

## Table: tasks

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT | Primary key, e.g. `t_2b52c65c` |
| `title` | TEXT | Task title |
| `body` | TEXT | Markdown body/description |
| `assignee` | TEXT | Agent codename (e.g. `mercator`, `zeus`) |
| `status` | TEXT | `running`, `blocked`, `ready`, `done`, `archived` |
| `priority` | INTEGER | Dispatcher tiebreaker |
| `created_by` | TEXT | Who created it (`worker`, `orchestrator`) |
| `created_at` | INTEGER | Unix timestamp |
| `started_at` | INTEGER | Unix timestamp (when dispatcher claimed) |
| `completed_at` | INTEGER | Unix timestamp (nullable) |
| `tenant` | TEXT | Project namespace (nullable) |
| `result` | TEXT | Short result log line (nullable) |

**No `updated_at` column.** Use `COALESCE(started_at, created_at)` for recency.

## Table: task_comments

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Auto-increment PK |
| `task_id` | TEXT | FK to tasks.id |
| `author` | TEXT | Agent codename or `system` |
| `body` | TEXT | Comment text (often markdown) |
| `created_at` | INTEGER | Unix timestamp |

## Table: task_events

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Auto-increment PK |
| `task_id` | TEXT | FK to tasks.id |
| `run_id` | INTEGER | FK to task_runs.id |
| `kind` | TEXT | `created`, `claimed`, `spawned`, `commented`, `blocked`, `unblocked`, `completed` |
| `payload` | TEXT | JSON blob |
| `created_at` | INTEGER | Unix timestamp |

## Table: task_runs

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Auto-increment PK |
| `task_id` | TEXT | FK to tasks.id |
| `profile` | TEXT | Profile name that runs the task |
| `status` | TEXT | `running`, `completed`, `failed`, `blocked` |
| `outcome` | TEXT | Result (nullable) |
| `summary` | TEXT | Human-readable summary (nullable) |
| `metadata` | TEXT | JSON blob (nullable) |
| `error` | TEXT | Error message if failed |
| `started_at` | INTEGER | Unix timestamp |
| `ended_at` | INTEGER | Unix timestamp (nullable) |

## Table: task_links

| Column | Type | Notes |
|--------|------|-------|
| `parent_id` | TEXT | Parent task id |
| `child_id` | TEXT | Child task id |

## Extension Tables (Mission Control)

Created by `schema.sql`:

### agents

| Column | Type | Notes |
|--------|------|-------|
| `codename` | TEXT | PK, e.g. `mercator`, `zeus` |
| `display_name` | TEXT | Human name |
| `role` | TEXT | `procurement`, `build`, `testing`, `orchestrator` |
| `status` | TEXT | `active`, `idle`, `offline` |
| `last_heartbeat` | TEXT | ISO datetime (nullable) |
| `current_task_id` | TEXT | Current task, nullable |
| `shared_secret_hash` | TEXT | For agent auth |

### activity

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Auto-increment PK |
| `task_id` | TEXT | FK to tasks.id |
| `type` | TEXT | Event type: `blocked`, `unblocked`, `claimed`, `spawned`, `completed`, `comment` |
| `actor` | TEXT | Agent codename or `operator` |
| `message` | TEXT | Free text |
| `timestamp` | TEXT | ISO datetime (default `datetime('now')`) |
