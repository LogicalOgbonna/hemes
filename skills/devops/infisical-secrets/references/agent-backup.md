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

**Doc-hygiene note:** the `hemes/skills/` tree is a generated copy — the script does `rm -rf` + re-copy from `~/.hermes/skills/` every run. Never edit files under `hemes/skills/`; edit the source in `~/.hermes/skills/` and the next run commits it.

## How It Works

1. Cron job runs at 2:00 AM daily via Hermes scheduler
2. Script copies profile files to `hemes/agents/<name>/`
3. Commits changes to git (change detection is **scoped to `agents/ skills/ scripts/`** — unrelated working-tree changes elsewhere in the repo never trigger or leak into backup commits; commit uses a pathspec)
4. Pushes to GitHub using `infisical run` + `GIT_ASKPASS` for auth

## Auth

- `GITHUB_TOKEN` is fetched from Infisical (project `24881f6a-bfc0-4f83-82df-d0fcc27e8dab`) via `infisical run`.
- The push step first fetches a **fresh universal-auth token** using the machine identity in `~/.hermes/.infisical-auth.env` (`CLIENT_ID`/`CLIENT_SECRET`) and passes it as `INFISICAL_TOKEN` to `infisical run`. This keeps pushes working even after the persisted CLI session expires.
- `set -o pipefail` ensures a failed push fails the script (no false success).

## Script

`scripts/backup-agents.sh` in the hemes repo:

```bash
#!/bin/bash
set -e
set -o pipefail

REPO_DIR="/home/ubuntu/hemes"
HERMES_DIR="$HOME/.hermes"
INF="/home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"

cd "$REPO_DIR"

# Copy each profile
for profile in zeus athena; do
    if [ ! -d "$HERMES_DIR/profiles/$profile" ]; then continue; fi
    for file in SOUL.md config.yaml profile.yaml .env; do
        [ -f "$HERMES_DIR/profiles/$profile/$file" ] && \
            cp "$HERMES_DIR/profiles/$profile/$file" "agents/$profile/$file"
    done
done

# Commit and push — checks scoped to backup paths only
BACKUP_PATHS="agents skills scripts"
if git diff --quiet -- $BACKUP_PATHS && git diff --cached --quiet -- $BACKUP_PATHS \
   && [ -z "$(git ls-files --others --exclude-standard -- $BACKUP_PATHS)" ]; then
    echo "No changes to commit"
else
    git add $BACKUP_PATHS
    git commit -m "backup: agents + skills $(date +%Y-%m-%d)" -- $BACKUP_PATHS
    # Fresh machine-identity token so pushes survive CLI session expiry
    set -a; . "$HOME/.hermes/.infisical-auth.env"; set +a
    TOKEN=$($INF login --method=universal-auth --client-id="$CLIENT_ID" \
            --client-secret="$CLIENT_SECRET" --plain --silent 2>/dev/null | tail -1) || TOKEN=""
    INFISICAL_TOKEN="$TOKEN" $INF run --projectId=$PROJECT_ID --path=/ --env=prod --silent -- \
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
