---
name: hemes-kanban-conventions
description: "Tags, workflow, and conventions for the Hemes kanban board — including worker profile setup, task lifecycle, and operations."
version: 2.0.0
author: Hermes Agent
---

# Hemes Kanban Conventions

## Tags

Every task must include tags in its body. See `references/labels-reference.md` for the complete label reference (colors, hex codes, and API details).

### Type tags (pick one)
- `bug` — Bug fix
- `feature` — New feature
- `research` — Investigation / research
- `docs` — Documentation
- `refactor` — Code refactoring / cleanup
- `blog` — Blog post / content

### Area tags (pick one or more)
- `frontend` — Frontend / UI work
- `backend` — Backend / API work
- `infra` — Infrastructure / DevOps

### Priority tags (optional)
- `urgent` — Time-sensitive, high priority
- `quick-win` — Small effort, high value
- `blocked` — Blocked by external dependency

### Tag format in task body

```
## Tags
type: research
area: backend
priority: quick-win
```

## Task body template

```
## Goal
One-sentence description of what needs to be done.

## Tags
type: [bug|feature|research|docs|refactor|blog]
area: [frontend|backend|infra]
priority: [urgent|quick-win|blocked]

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Dependencies
- Parent task IDs, if any
```

## Orchestration flow

The orchestrator (not individual agents) manages the entire workflow:

1. Orchestrator designs the complete pipeline up front when a request comes in
2. Tasks are created with parent/child links using `parents=[...]` on `kanban_create`
3. Dispatcher only spawns the CHILD when ALL parents reach `done`
4. Each agent completes ONE job and returns findings via `kanban_complete`
5. Downstream agents auto-activate when their parents complete
6. No agent decides where to pass its output — the dependency graph is pre-defined

### Example pipeline

```
Orchestrator creates:
  T1: [Research X] ── assignee: athena ── no parents
  T2: [Implement based on findings] ── assignee: developer ── parents: [T1]
  T3: [Review implementation] ── assignee: reviewer ── parents: [T2]

Flow:
  T1 starts immediately (no parents)
  T2 auto-promotes from todo to ready when T1 completes
  T3 auto-promotes from todo to ready when T2 completes
  Each agent reads parent task outputs via kanban_show()
```

## Worker profile setup

**Critical: kanban workers are sandboxed by default.** When the dispatcher spawns a worker, it only provides kanban-specific tools (`kanban_show`, `kanban_complete`, `kanban_block`, etc.) — NOT web, file, or terminal tools — even if the profile's `toolsets` list includes them.

To give workers the tools they need, configure BOTH settings on the profile:

```bash
# Step 1: Create the profile (clone from existing)
hermes profile create athena --clone-from default

# Step 2: Set the profile's SOUL.md with the agent personality
# Edit ~/.hermes/profiles/<name>/SOUL.md

# Step 3: Configure platform toolsets for CLI-based workers
# This is what the kanban dispatcher uses when spawning workers
hermes -p <name> config set platform_toolsets.cli '["hermes-cli","web","file","terminal"]'

# Step 4: Set the profile-level toolsets
hermes -p <name> config set toolsets '["web", "file", "terminal", "delegation"]'

# Step 5: Verify the skill is available
hermes -p <name> skills list | grep <skill-name>

# Step 6: Verify config
python3 -c "
import os,yaml
c = yaml.safe_load(open(os.path.expanduser('~/.hermes/profiles/<name>/config.yaml')))
print('CLI:', c.get('platform_toolsets',{}).get('cli'))
print('toolsets:', c.get('toolsets'))
"
```

**Why both are needed:** `toolsets` controls the profile's default capabilities. `platform_toolsets.cli` controls what tools the profile gets when launched via CLI (`hermes -p <name> chat -q '...'`), which is exactly how the kanban dispatcher spawns workers. Without `platform_toolsets.cli`, the CLI-launched worker only gets the `hermes-cli` platform toolset (plus the `kanban-worker` toolset injected by the dispatcher).

### Verified tool availability

After correct configuration, Athena (researcher agent) confirmed 25+ tools available:
- kanban ops (board management)
- terminal (shell commands, curl for web access)
- file (read, write, search, patch)
- delegation (subagent spawning)
- memory, skills, messaging, cron, TTS, and more

### Skills in kanban tasks

The `kanban_create` tool accepts a `skills` parameter to force-load skills into the dispatched worker. When creating a task via the tool (not the CLI):

```python
kanban_create(
    title="Research topic X",
    assignee="athena",
    skills=["athena-researcher"],  # loads the researcher skill
    body="..."
)
```

Note: The `hermes kanban create` CLI command does NOT support `--skills` — use the tool programmatically or include skill context in the task body.

## Profile creation workflow (full)

When creating a new specialist agent profile:

1. **Clone** — `hermes profile create <name> --clone-from default`
2. **Personality** — Write a SOUL.md with the agent's system prompt
3. **Tool config** — Set `platform_toolsets.cli` AND `toolsets` as shown above
4. **Create skills** — Create a skill for the agent's domain knowledge (e.g. `athena-researcher`)
5. **Verify** — `hermes -p <name> skills list | grep <skill>` to confirm the skill is enabled
6. **Test** — Create a kanban task with the profile as assignee and verify it picks it up

## .env file safety

**NEVER use shell redirect operators (`>`, `>>`) directly on `~/.hermes/.env`** from terminal commands. A mistyped command like:

```bash
echo "..."> ~/.hermes/.env | grep "GITHUB" | ...
```

...will **wipe the entire .env file**. The redirect evaluates before the pipe, replacing the file with a single line.

**Safe alternatives:**
- Use `sed -i` for targeted line edits
- Use a Python script to read/write the file line by line
- Use `hermes config set` for config values
- Use `hermes setup` for guided configuration
- If the .env is corrupted, copy from a sibling profile's .env (e.g. `cp ~/.hermes/profiles/<name>/.env ~/.hermes/.env`) if it has the same API keys

## Calendar event monitoring (no_agent cron pattern)

The `calendar_monitor.py` script demonstrates the `no_agent=True` cron pattern:

1. Write a Python script in `~/.hermes/scripts/` that produces stdout on events
2. Create a cron job with `no_agent=True` so stdout is delivered verbatim
3. Script exits silently (exit 0) when nothing to report

```bash
hermes cron create \
  --schedule "every 10 minutes" \
  --script calendar_monitor.py \
  --no_agent true \
  --deliver all \
  --name "Calendar event watcher"
```

The script should:
- Return non-empty stdout → delivered as notification
- Exit 0 with empty stdout → silent (no notification)
- Track already-notified events to avoid duplicates (use a JSON log file)
