# Kanban Worker Output Delivery

## The Problem

When a kanban worker is dispatched via `_default_spawn`, its output goes to a log
file under `<board-root>/logs/<task-id>.log`. The worker has no built-in way to
deliver its final response back to the user on WhatsApp, Telegram, Discord, or any
messaging platform. This causes the dispatcher to see `exit_code=0` without
`kanban_complete` or `kanban_block` and flag a "protocol violation."

## The Spawn Chain

`_default_spawn()` in `hermes_cli/kanban_db.py` builds:

```bash
hermes -p <profile> --accept-hooks --skills kanban-worker chat -q work kanban task <id>
```

**Key properties:**
- stdout/stderr → log file
- stdin → /dev/null (no interactive input)
- Runs in the profile's HERMES_HOME
- `send_message` is available (core tool, gated open for kanban workers)
- `HERMES_DELIVERY_TARGETS` env var injected if set on the task

### Env vars injected by _default_spawn

| Variable | Source | Purpose |
|---|---|---|
| `HERMES_HOME` | `resolve_profile_env(profile_arg)` | Worker reads profile config |
| `HERMES_KANBAN_TASK` | `task.id` | Worker knows its task identity |
| `HERMES_KANBAN_WORKSPACE` | resolved workspace path | Working directory |
| `HERMES_KANBAN_DB` | `kanban_db_path(board=board)` | Pins the correct DB |
| `HERMES_KANBAN_BOARD` | resolved board slug | Board identification |
| `HERMES_KANBAN_WORKSPACES_ROOT` | `workspaces_root(board=board)` | Workspace isolation |
| `HERMES_KANBAN_RUN_ID` | `task.current_run_id` | Run tracking |
| `HERMES_KANBAN_CLAIM_LOCK` | `task.claim_lock` | Claim verification |
| `HERMES_PROFILE` | `profile_arg` | Tool attribution |
| `HERMES_TENANT` | `task.tenant` | (if set) |
| `HERMES_DELIVERY_TARGETS` | `task.delivery_targets` | (if set) JSON array of platform:target strings |
| `TERMINAL_TIMEOUT` | from config/task | (if set) |

## Implementation: delivery_targets

The system supports delivering worker output to messaging platforms via the
`delivery_targets` field on kanban tasks.

### 1. Task field

A JSON array column (TEXT, nullable). Set via `kanban_create(delivery_targets=["..."])`
or `hermes kanban create --delivery-target "platform:chat_id"`.

Format: `["platform:chat_id", "platform:chat_id:thread_id"]` — each entry matches
the `send_message` tool's target format.

### 2. Env var injected during spawn

`_default_spawn()` sets `HERMES_DELIVERY_TARGETS` as JSON:

```python
if task.delivery_targets:
    env["HERMES_DELIVERY_TARGETS"] = json.dumps(task.delivery_targets)
```

### 3. Worker reads the env var

The `kanban-worker` skill instructs workers to check `HERMES_DELIVERY_TARGETS`
and call `send_message` for each target before completing/blocking:

```python
import json, os
targets_raw = os.environ.get("HERMES_DELIVERY_TARGETS")
if targets_raw:
    targets = json.loads(targets_raw)
    output = "my final response text here..."
    for t in targets:
        send_message(target=t, message=output)
```

### 4. send_message is always available

The `_check_send_message()` gate returns `True` when `HERMES_KANBAN_TASK` is set.
`send_message` is a core tool — no additional toolset configuration needed.

## Platform-specific setup

### WhatsApp

Two things must work for WhatsApp delivery from kanban workers:

**a) Chat ID resolution** — WhatsApp uses IDs like `1234567890@lid` (users),
`1234567890@g.us` (groups), `1234567890@broadcast` (broadcast lists). The
`_parse_target_ref()` function in `tools/send_message_tool.py` must treat
`whatsapp:` targets containing `@` as explicit chat IDs. Added in May 2026:

```python
if platform_name == "whatsapp":
    if "@" in target_ref:
        return target_ref.strip(), None, True
```

Without this, the `@lid` suffix fails the numeric-only check and falls through to
channel-directory resolution, which cannot resolve it. This was discovered when
the Mentor agent's send_message returned `"Could not resolve '163354970747009@lid'
on whatsapp"`.

**b) Platform config fallback** — kanban workers run under their profile's
HERMES_HOME, which may not have WhatsApp configured. The `send_message_tool()`
handler now synthesizes a `PlatformConfig` for WhatsApp using the default bridge
port, matching the Weixin pattern:

```python
elif platform_name == "whatsapp":
    wa_port = os.getenv("WHATSAPP_BRIDGE_PORT", "3000").strip()
    pconfig = PlatformConfig(
        enabled=True,
        token="",
        extra={"bridge_port": int(wa_port)},
    )
```

The WhatsApp bridge is expected at `http://localhost:3000/send` (POST with
`{"chatId": chat_id, "message": message}`). Override the port with
`WHATSAPP_BRIDGE_PORT` env var. This was discovered when the Mentor agent's
send_message returned `"Platform 'whatsapp' is not configured"` because the
mentor profile had no gateway config.

### Telegram, Discord, Signal

Configured in the gateway config. Set `delivery_targets=["telegram:chat_id"]`
and the `send_message` tool routes through the parent gateway.

## Usage pattern

```python
# Main agent dispatches a task with delivery to WhatsApp
task = kanban_create(
    title="Research X",
    assignee="athena",
    body="...",
    delivery_targets=["whatsapp:163354970747009@lid"],
)

# Worker runs, calls send_message for each target,
# then calls kanban_complete or kanban_block
```

## Interactive (multi-turn) pattern

Kanban workers are single-shot CLI processes. For multi-turn conversations:

1. Worker sends question via `send_message` → `kanban_block`
2. Human (or main agent) adds answer as comment + `kanban_unblock`
3. Next worker run reads comments, sends next question → repeat
4. Final run delivers result and `kanban_complete`

One-question-at-a-time is preferred for intake/interviews. The worker should
send ONE question, block, and wait for the answer before proceeding to the next.
