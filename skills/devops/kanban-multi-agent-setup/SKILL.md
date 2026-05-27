---
name: kanban-multi-agent-setup
description: "Setup and configure a Kanban multi-agent system with specialist worker profiles, boards, and orchestration."
version: 1.0.0
author: Hermes Agent
platforms: [linux, macos, windows]
---

# Kanban Multi-Agent System Setup

## Overview

Set up a Kanban-based multi-agent system where specialist profiles (researcher, developer, reviewer, etc.) pick tasks from a board and work independently. The orchestrator (main agent) creates tasks with dependency links, and the kanban dispatcher spawns workers in sequence.

## Architecture

```
Orchestrator (main agent)
    │ Creates tasks with parent/child links
    ▼
Kanban Board (SQLite)
    │ Dispatcher checks every 60s
    ▼
Specialist Profiles (athena, developer, etc.)
    │ Each gets: own model, tools, skills, SOUL.md persona
    ▼
Task completed → downstream tasks auto-promote
```

## Setup steps

### Step 1: Create specialist profiles

```bash
# List existing profiles first
hermes profile list

# Clone from default
hermes profile create <name> --clone-from default

# Or clone and copy config + skills
hermes profile create <name> --clone-all
```

### Step 2: Configure profile toolsets

Workers need appropriate toolsets for their role. Edit the profile's `config.yaml`:

```bash
hermes -p <name> config set toolsets '["web", "file", "terminal", "delegation"]'
```

Common toolset combinations:
- **Researcher**: `web`, `file`, `delegation`
- **Developer**: `web`, `file`, `terminal`
- **Reviewer**: `file`, `terminal`

**Important:** Do NOT include `kanban` or `kanban-worker` as a toolset. Kanban tools (`kanban_show`, `kanban_create`, `kanban_complete`, etc.) are auto-injected by the dispatcher when spawning a worker.

**Pitfall:** Kanban workers spawned by the dispatcher may not inherit all profile toolsets on first run. If a worker reports missing tools, test with a simple tool-verification task before debugging. The dispatcher reads the top-level `toolsets` key from the profile's `config.yaml`.

### Step 3: Set SOUL.md persona

Write a concise persona to `~/.hermes/profiles/<name>/SOUL.md`:

```markdown
You are <Name>, the <Role>. You specialize in <task description>.

Core values: <values>.
Output structure: <expected format>.

You are <tone>. Your job is to <single responsibility>.
```

### Step 4: Create worker skill (system prompt)

Create a skill under `kanban-workers/` category with the worker's full system prompt. Include core principles, workflow steps, output format, and hard rules. Then load it via the profile's config or pass `skills=['<name>']` when creating tasks.

```bash
# Create skill first
# Then verify it's enabled on the profile
hermes -p <name> skills list | grep <skill-name>
```

### Step 5: Initialize the board

```bash
# One-time init (creates kanban.db)
hermes kanban init

# Verify the gateway is running (dispatcher ticks inside gateway)
hermes gateway status
```

### Step 6: Create and assign tasks

```python
# Creator profile (main agent) creates tasks
t1 = kanban_create(
    title="Research topic X",
    assignee="athena",
    body="Full task description with tags in metadata",
    # Pass skills to load for the worker
    # skills=["athena-researcher"],
)

t2 = kanban_create(
    title="Implement based on research",
    assignee="developer",
    body="...",
    parents=[t1["task_id"]],  # child waits for parent
)
```

### Step 7: Configure GitHub Project board statuses

The GitHub Projects board and the Hermes kanban DB are **separate systems**. The Hermes kanban DB has its own internal statuses (Triage→Todo→Ready→Running→Blocked→Completed→Archived). The GitHub Project board has a "Status" single-select field that defaults to Todo/In Progress/Done.

To configure custom workflow statuses on the GitHub board, use the GraphQL API:

```bash
# 1. Get the project node ID
PROJECT_ID=$(curl -s -X POST https://api.github.com/graphql \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query{user(login:\"USERNAME\"){projectsV2(first:10){nodes{id title}}}}"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['data']['user']['projectsV2']['nodes']; print([p['id'] for p in d if 'PROJECT_NAME' in p['title']][0])")

# 2. Find the Status field ID and its current options
# (check the field's ID and options via the same GraphQL query)

# 3. Update the Status field with custom options using updateProjectV2Field mutation
curl -s -X POST https://api.github.com/graphql \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { updateProjectV2Field(input: { fieldId: \"FIELD_ID\", singleSelectOptions: [ {name: \"Triage\", color: GRAY, description: \"New items waiting to be triaged\"}, {name: \"Todo\", color: BLUE, description: \"Tasks logged but not started\"}, {name: \"Ready\", color: ORANGE, description: \"Ready to be picked up\"}, {name: \"Running\", color: GREEN, description: \"Actively being worked on\"}, {name: \"Blocked\", color: RED, description: \"Stuck — needs intervention\"}, {name: \"Completed\", color: PURPLE, description: \"Finished\"}, {name: \"Archived\", color: GRAY, description: \"No longer relevant\"} ] }) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } } }"
  }'
```

Valid values for `color`: `GRAY`, `BLUE`, `GREEN`, `YELLOW`, `ORANGE`, `RED`, `PINK`, `PURPLE`.

When replacing all options, you must include **all** existing and new options in a single call. Existing options can keep their IDs to preserve item field values across the update; new options omit the `id` field entirely. The `updateProjectV2Field` mutation replaces the full options list — it does not append.

### Step 8: Link GitHub issues to the project board

After creating a GitHub issue, add it to the project board and set its status:

```python
# 1. Create the issue via REST API — get back node_id
# 2. Add to project via addProjectV2ItemById
# 3. Set status via updateProjectV2ItemFieldValue
```

See `references/github-projects-v2-graphql.md` for the exact GraphQL mutations, including how to handle option IDs (they change when you re-run `updateProjectV2Field` without preserving IDs — always re-query after updates).

The full pipeline:
```
POST /repos/{owner}/{repo}/issues  →  get node_id
addProjectV2ItemById(contentId: node_id)  →  get item.id
updateProjectV2ItemFieldValue(itemId: item.id, singleSelectOptionId: option_id)
```

### Step 9: Create GitHub labels as tags

Create categorical labels on a GitHub repo for tagging tasks:

```bash
# Create labels one at a time via the REST API
LABELS=(
  "bug:bug"
  "feature:a2eeef"
  "research:7057ff"
  "docs:0075ca"
  "refactor:ffffff"
  "blog:bfd4f2"
  "frontend:1d76db"
  "backend:5319e7"
  "infra:fbca04"
  "urgent:b60205"
  "quick-win:0e8a16"
  "blocked:000000"
)

for entry in "${LABELS[@]}"; do
  name="${entry%%:*}"
  color="${entry##*:}"
  curl -s -X POST "https://api.github.com/repos/OWNER/REPO/labels" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    -d "{\"name\":\"$name\",\"color\":\"$color\"}"
done
```

Label colors use 6-digit hex without the `#` prefix.

A good label scheme splits into three categories:
- **Type:** bug, feature, research, docs, refactor, blog
- **Area:** frontend, backend, infra
- **Priority:** urgent, quick-win, blocked

### Step 10: Set up a developer profile (Vercel + Neon)

For a developer agent that deploys to Vercel and manages databases:

**Profile creation:**
```bash
hermes profile create <name> --clone-from default
```

**SOUL.md** — the full developer system prompt should cover:
- Core principles (it must run, correctness over cleverness, verify before reporting)
- Workflow: understand → inspect → plan → implement → quality gate → deploy → smoke-check → post
- Quality gate (MANDATORY before deploy): install → typecheck → lint → build → tests
- Deploy flow for Vercel previews (see below)
- Smoke-check the live URL with curl before claiming it works
- Stack-agnostic detection: detect package manager from lockfile, framework from package.json

**Toolsets** for a developer profile:
```yaml
platform_toolsets:
  cli: '["hermes-cli","web","file","terminal"]'
toolsets: '["web", "file", "terminal"]'
```
Note: Do NOT include `kanban` — kanban tools are auto-injected by the dispatcher.

**Secrets (Infisical):** All credentials are managed by Infisical — never stored in local `.env` files. The profile's `.env` contains only metadata:

```
INFISICAL_PROJECT_ID=<project-id>
INFISICAL_PATH=/
INFISICAL_ENV=prod
```

Secrets live at `/` in Infisical (VERCEL_TOKEN, NEON_API_KEY, etc.). See the `infisical-secrets` skill for the full workflow: installation, auth, project folder structure, and pitfalls.

**Before each Vercel deploy, sync Infisical secrets to the Vercel project env vars** so the build can access them. See `infisical-secrets` → "Syncing Infisical Secrets to Vercel" section and its `references/vercel-env-sync.md` for the sync script.

Vercel token authentication test (fetch from Infisical first):
```bash
export INFISICAL_TOKEN=*** && \
VERCEL_TOKEN=*** secrets get VERCEL_TOKEN --projectId=$PID --path=/ --env=prod --plain) && \
npx vercel whoami --token="$VERCEL_TOKEN"
```

Neon API test (fetch from Infisical first):
```bash
export INFISICAL_TOKEN=*** && \
NEON_API_KEY=*** secrets get NEON_API_KEY --projectId=$PID --path=/ --env=prod --plain) && \
curl -s -H "Authorization: Bearer *** https://neon.tech/api/v2/projects
```

**Programmatic Neon database creation** (for CI/agent flows):
```bash
# Create a project
curl -s -X POST https://neon.tech/api/v2/projects \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project":{"name":"my-project","region_id":"aws-us-east-1"}}'

# Create a database
curl -s -X POST "https://neon.tech/api/v2/projects/$PROJECT_ID/databases" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"database":{"name":"mydb","owner_name":"neondb_owner"}}'
```

The API returns connection strings that can be passed to Vercel as env vars.

### Step 11: Create kanban tickets with a detailed spec

When creating a task on the Hermes board for a developer agent, include a detailed spec with:

```markdown
## Goal
<one-sentence description of what to build>

## Acceptance Criteria
- [ ] <specific measurable outcome 1>
- [ ] <specific measurable outcome 2>
- [ ] Quality gate passes (typecheck, lint, build, tests)
- [ ] Deployed as Vercel preview
- [ ] Smoke-check passes on live URL

## Tech stack
- Framework: <e.g. Next.js App Router, TypeScript, Tailwind>
- Database: <e.g. Neon Postgres via Prisma>
- Deploy: Vercel preview

## Deliverable
Post to this ticket with:
- Preview URL (live, verified)
- Database/project info
- Files touched
- Checks passed
- Limitations/follow-ups

## Notes
- New project goes in the org's repo or a subdirectory
- Commit with clear messages
- Use the detected package manager
```

## Common pitfalls

### .env file corruption

**Never** use shell redirect (`>`) to write to `.env` files. It overwrites the entire file, losing all API keys. Use `write_file` or Python scripts to modify specific lines instead.

```bash
# DANGER — this overwrites .env
echo "GIT...**"> ~/.hermes/.env

# SAFE — use Python or sed
python3 -c "
import os
p = os.path.expanduser('~/.hermes/.env')
with open(p) as f: lines = f.readlines()
# Modify specific lines
with open(p, 'w') as f: f.writelines(lines)
"
```

### Token masking in write_file

When writing a Python script that needs to read tokens from `.env`, the tool may mask `GITHUB_TOKEN=` followed by the value. Workaround: build the string or use `execute_code` with `terminal()` calls instead of `write_file`.

**Preferred pattern for inline scripts:**
```python
from hermes_tools import terminal
result = terminal("python3 your_script_here")
```

**External script pattern:**
Create the script using heredoc in terminal rather than write_file when token patterns are involved:
```bash
cat > script.py << 'PYEOF'
# Script content here
PYEOF
python3 script.py
```

### Worker tool availability

If a spawned kanban worker reports "I don't have web tools" despite having `web` in their profile toolsets:
1. Check the dispatcher logs: `grep -i "spawn\\|<profile>" ~/.hermes/logs/gateway.log`
2. Verify `toolsets` is set correctly in profile config.yaml (note: DO NOT include `kanban` or `kanban-worker` as a toolset — kanban tools are auto-injected by the dispatcher, and listing them is meaningless)
3. Consider adding tasks with explicit `skills` parameter to load the worker's skill
4. Test with a simple tool-verification task first (e.g. "run curl to check an API")
5. If the worker says tools are missing, the dispatcher's worker spawn may restrict toolsets — check if `delegation` is also needed for the worker's `terminal`/`file` tools to be inherited

### Duplicate task creation (auto-decompose)

The dispatcher may auto-decompose research tasks if `kanban.auto_decompose: true` in gateway config. Set to `false` if you want full control over task decomposition.

### Confusing Hermes kanban DB with GitHub Project board

The **Hermes kanban board** (SQLite `~/.hermes/kanban.db`) and a **GitHub Projects board** are independent systems with their own status schemas.

**DO NOT** claim GitHub board statuses are set up because the Hermes kanban DB has them. The Hermes kanban dispatcher internally tracks Triage→Todo→Ready→Running→Blocked→Completed→Archived in its SQLite DB. The GitHub Projects board has a completely separate "Status" field that defaults to Todo/In Progress/Done.

**Always verify** external system state before reporting it as configured. Use the GraphQL API to query the GitHub board's actual Status field options before making claims.

When setting up a GitHub board alongside a Hermes kanban system:
1. Configure both independently
2. The GitHub board statuses should mirror the Hermes kanban statuses for consistency
3. Verify with a live API query, not by assuming the defaults are what you want

### User gave you exact names — use them

When a user specifies status names (e.g. "Triage → Todo → Ready → Running → Blocked → Completed → Archived"), use those **exact** names. Don't substitute synonyms like "Done" for "Completed" or keep default options like "In Progress" alongside the user's "Running". Having both "In Progress" and "Running" as separate options creates a confusing dual-column workflow — remove the default options that conflict.

### Option IDs change after re-running updateProjectV2Field

Every time you run `updateProjectV2Field` with `singleSelectOptions` and omit the `id` field, GitHub generates **new IDs** for those options. This means:

- If you ran a mutation creating Triage with ID `2b770297`, then ran another mutation replacing all options (e.g. renaming "Done" → "Completed"), the new Triage will have a DIFFERENT ID (e.g. `99c10a20`)
- Any code that references the old option ID will fail with "The single select option Id does not belong to the field"
- **Always re-query the options after updating** before using them in `updateProjectV2ItemFieldValue`

Pattern:
1. Query current options → get IDs
2. Run `updateProjectV2Field` with IDs preserved for stable options
3. Query options again → get any new IDs
4. Use fresh IDs in `updateProjectV2ItemFieldValue`

## Orchestration patterns

### Pipeline (serial)
```
Researcher → Developer → Reviewer
```
Create with serial parent links: T2 parents=[T1], T3 parents=[T2]

### Fan-out + fan-in (parallel research)
```
  ┌─ T1: Cost research (parallel)
T0 ── T2: Performance research (parallel)
  └── T3: Synthesis (waits for T1 + T2)
```
Create T1 and T2 with no parents, T3 with parents=[T1, T2]

### Pipeline with review gate
```
T1: Implement feature → T2: Review code
  If T2 finds issues → new T3: Fix issues (parents=[T2])
  If T2 approves → done
```

## References

- `hermes-agent` skill: CLI reference for profile management, kanban commands
- `kanban-orchestrator` skill: orchestrator playbook (bundled, read-only)
- `kanban-worker` skill: worker pitfalls (bundled, read-only)
- `hemes-kanban-conventions` skill: this project's tag/label conventions
- `infisical-secrets` skill: secrets management via Infisical (all credentials, no local .env)
- `references/github-projects-v2-graphql.md`: GraphQL API reference for configuring GitHub Projects v2 board status fields
- `references/vercel-neon-patterns.md`: Vercel preview deploy flow, Neon API usage, smoke-check patterns, and credential hygiene for developer agents
