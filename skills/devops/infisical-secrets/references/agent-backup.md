# Agent Profile Backup to Git

Daily git-backed backup of Hermes agent profiles (SOUL.md, config, profile
metadata) so agent state survives container restarts.

## Structure

```
hemes/
├── apps/todo-app/         ← app code
├── agents/
│   ├── zeus/              ← copied from ~/.hermes/profiles/zeus/
│   ├── athena/            ← copied from ~/.hermes/profiles/athena/
│   └── default/           ← root Hermes config
└── scripts/
    └── backup-agents.sh   ← the backup script
```

## What's Backed Up Per Agent

| File | Source | Purpose |
|------|--------|---------|
| `SOUL.md` | `~/.hermes/profiles/<name>/SOUL.md` | Agent persona and workflow instructions |
| `config.yaml` | `~/.hermes/profiles/<name>/config.yaml` | Toolset and behavior config |
| `profile.yaml` | `~/.hermes/profiles/<name>/profile.yaml` | Profile description |
| `.env` | `~/.hermes/profiles/<name>/.env` | Infisical metadata stub (no secrets) |

## What's NOT Backed Up

- State databases (`state.db`, `sessions/`) — ephemeral, container-local
- Secret values — only Infisical stubs
- Skills — stored globally in `~/.hermes/skills/`

## How It Works

1. Cron job runs at 2:00 AM daily via Hermes scheduler
2. Script copies profile files to `hemes/agents/<name>/`
3. Commits changes to git
4. Pushes to GitHub using `infisical run` + `GIT_ASKPASS` for auth

## Script

`scripts/backup-agents.sh` in the hemes repo:

```bash
#!/bin/bash
set -e

REPO_DIR="/home/ubuntu/hemes"
AGENTS_DIR="$REPO_DIR/agents"
HERMES_PROFILES="$HOME/.hermes/profiles"
INF="/home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"

# Copy each profile
for profile in zeus athena; do
    if [ ! -d "$HERMES_PROFILES/$profile" ]; then continue; fi
    mkdir -p "$AGENTS_DIR/$profile"
    for file in SOUL.md config.yaml profile.yaml .env; do
        [ -f "$HERMES_PROFILES/$profile/$file" ] && cp "$HERMES_PROFILES/$profile/$file" "$AGENTS_DIR/$profile/$file"
    done
done

# Commit and push
cd "$REPO_DIR"
if ! git diff --quiet && git diff --cached --quiet; then
    git add agents/
    git commit -m "agents: daily backup $(date +%Y-%m-%d)"
    $INF run --projectId=$PROJECT_ID --path=/ --env=prod -- \
      env GIT_ASKPASS="$HOME/.hermes/scripts/git-askpass.sh" \
      bash -c "cd $REPO_DIR && git push origin main 2>&1"
fi
```

## Setting Up for a New Agent Profile

1. Create the profile in `~/.hermes/profiles/<name>/` with at least a `SOUL.md`
2. Add the profile name to the `for profile in ...` loop in the backup script
3. The cron job picks it up automatically on the next run

## Cron Job

Created via Hermes cron:
- Schedule: `0 2 * * *` (2:00 AM daily)
- Name: `agent-profile-backup`
- Script: `backup-agents.sh`
- Next run: Next 2:00 AM
