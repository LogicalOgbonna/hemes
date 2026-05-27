# Worker Profile Setup Reference

This document captures the exact sequence and rationale for setting up kanban worker profiles, based on the hands-on experience building Athena (the researcher agent).

## The problem

Kanban workers spawned by the dispatcher are heavily sandboxed. A fresh clone of the default profile gives the worker only `kanban_*` tools — no web, terminal, or file access. This is because the kanban dispatcher launches workers via the CLI (`hermes -p <name> chat -q '...'`), and the `platform_toolsets.cli` controls what tools CLI sessions get.

## The fix

Two separate config keys must be configured on the profile:

### `platform_toolsets.cli` (what a CLI-launched session gets)

```yaml
platform_toolsets:
  cli:
    - hermes-cli
    - web
    - file
    - terminal
```

Set via CLI: `hermes -p <name> config set platform_toolsets.cli '["hermes-cli","web","file","terminal"]'`

This is the MOST important setting. Without it, a profile launched via `hermes -p <name> chat -q '...'` only gets the `hermes-cli` tools (plus whatever the dispatcher injects).

### `toolsets` (the profile's general capability)

```yaml
toolsets:
  - web
  - file
  - terminal
  - delegation
```

Set via CLI: `hermes -p <name> config set toolsets '["web", "file", "terminal", "delegation"]'`

Do NOT include `kanban-worker` in the toolsets list — the dispatcher injects this automatically when spawning a worker. Including it may cause tool conflicts.

## Verification

After configuration, verify both keys are set:

```python
import os, yaml
c = yaml.safe_load(open(os.path.expanduser('~/.hermes/profiles/<name>/config.yaml')))
print('CLI tools:', c.get('platform_toolsets', {}).get('cli'))
print('Profile toolsets:', c.get('toolsets'))
```

Expected output:
```
CLI tools: ['hermes-cli', 'web', 'file', 'terminal']
Profile toolsets: ['web', 'file', 'terminal', 'delegation']
```

## What tools each worker type typically needs

| Agent type | Needs | toolsets |
|-----------|-------|----------|
| Researcher (Athena) | Web search, file read, curl | web, file, terminal |
| Developer | Shell, git, file edit | terminal, file |
| Reviewer | File read, shell for tests | file, terminal |
| Writer | File write | file |

## Complete setup script pattern

```bash
# Replace <name> and <source-profile> as needed
NAME="<agent-name>"
SOURCE="default"

# 1. Create profile
hermes profile create $NAME --clone-from $SOURCE

# 2. Set SOUL.md (personality/prompt)
# Manually edit ~/.hermes/profiles/$NAME/SOUL.md

# 3. Configure tools
hermes -p $NAME config set platform_toolsets.cli '["hermes-cli","web","file","terminal"]'
hermes -p $NAME config set toolsets '["web", "file", "terminal", "delegation"]'

# 4. Verify skills
hermes -p $NAME skills list

# 5. Verify config
python3 -c "import os,yaml; c=yaml.safe_load(open(os.path.expanduser('~/.hermes/profiles/$NAME/config.yaml'))); print('CLI:', c.get('platform_toolsets',{}).get('cli')); print('toolsets:', c.get('toolsets'))"
```

## Pitfalls

- Setting `toolsets` without `platform_toolsets.cli` → worker gets sandboxed (only kanban tools)
- Setting `platform_toolsets.cli` without `toolsets` → worker may still work but toolsets config is incomplete
- Including `kanban-worker` in `toolsets` → dispatcher may inject it twice (harmless but redundant)
- Changing toolsets does NOT affect running sessions — only the NEXT worker spawn picks up changes. The dispatcher reads the config each tick (every 60s by default)
- The gateway does NOT need restarting for profile config changes — the dispatcher reads config on each dispatch tick
