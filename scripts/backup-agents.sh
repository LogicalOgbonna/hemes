#!/bin/bash
# Daily Hermes backup — profiles, skills, and config to the hemes git repo
# Runs via cron. Commits and pushes changes daily.
#
# Backs up:
#   agents/<name>/   — agent SOUL.md, config, profile (from ~/.hermes/profiles/)
#   skills/          — all installed skills (from ~/.hermes/skills/)
#   scripts/         — backup scripts themselves (from hemes/scripts/)

set -e

REPO_DIR="/home/ubuntu/hemes"
HERMES_DIR="$HOME/.hermes"
INF="/home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"

cd "$REPO_DIR"

echo "=== Skills backup ==="
SKILLS_DST="$REPO_DIR/skills"
rm -rf "$SKILLS_DST"
mkdir -p "$SKILLS_DST"
cp -r "$HERMES_DIR/skills/"* "$SKILLS_DST/" 2>/dev/null || true
skill_count=$(find "$SKILLS_DST" -name "SKILL.md" | wc -l)
echo "  $skill_count skills backed up"

echo "=== Agent profiles backup ==="
AGENTS_DST="$REPO_DIR/agents"
PROFILES_SRC="$HERMES_DIR/profiles"
mkdir -p "$AGENTS_DST"

for profile in zeus athena; do
    src="$PROFILES_SRC/$profile"
    dst="$AGENTS_DST/$profile"
    
    if [ ! -d "$src" ]; then
        echo "  Skipping $profile — not found"
        continue
    fi
    
    mkdir -p "$dst"
    for file in SOUL.md config.yaml profile.yaml .env; do
        if [ -f "$src/$file" ]; then
            cp "$src/$file" "$dst/$file"
            echo "  $profile/$file"
        fi
    done
done

# Root Hermes config
mkdir -p "$AGENTS_DST/default"
for file in config.yaml; do
    if [ -f "$HERMES_DIR/$file" ]; then
        cp "$HERMES_DIR/$file" "$AGENTS_DST/default/$file" 2>/dev/null || true
    fi
done
echo "  default/config.yaml"

echo "=== Scripts backup ==="
SCRIPTS_DST="$REPO_DIR/scripts"
if [ -d "$SCRIPTS_DST" ]; then
    script_count=$(find "$SCRIPTS_DST" -name "*.sh" | wc -l)
    echo "  $script_count scripts"
fi

# Commit and push.
# Checks are scoped to the backup paths only: unrelated working-tree changes
# elsewhere in the repo (e.g. apps/) must not trigger a commit attempt or get
# swept into the backup commit (pathspec commit).
BACKUP_PATHS="agents skills scripts"
if git diff --quiet -- $BACKUP_PATHS && git diff --cached --quiet -- $BACKUP_PATHS && [ -z "$(git ls-files --others --exclude-standard -- $BACKUP_PATHS)" ]; then
    echo "No changes to commit"
else
    git add $BACKUP_PATHS
    git commit -m "backup: agents + skills $(date +%Y-%m-%d)" -- $BACKUP_PATHS
    
    GIT_ASKPASS="$HOME/.hermes/scripts/git-askpass.sh"
    $INF run --projectId=$PROJECT_ID --path=/ --env=prod -- \
      env GIT_ASKPASS="$GIT_ASKPASS" \
      bash -c "cd $REPO_DIR && git push origin main 2>&1" | tail -3
    
    echo "✅ Backed up and pushed"
fi
