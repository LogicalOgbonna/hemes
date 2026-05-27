# Vercel Environment Variable Sync

Full sync script for pushing Infisical secrets to a Vercel project.

## The Sync Script

Save as `~/.hermes/scripts/sync-vercel-env.sh`:

```bash
#!/bin/bash
# Sync Infisical secrets to Vercel project env vars
# Usage: sync-vercel-env.sh <infisical-path> <vercel-env-targets>
#   INFISICAL_PATH   e.g. /todo-app (default: /)
#   VERCEL_ENVS      e.g. preview,development (default: preview,development)
# Requires: INFISICAL_TOKEN, VERCEL_TOKEN in environment

set -euo pipefail

INFISICAL_PATH="${1:-/}"
VERCEL_ENVS="${2:-preview,development}"
INF_PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"
VERCEL_PROJECT_ID="prj_ByBJItuj8gzffT4ZaKwKnBDCXSAY"

echo "=== Syncing Infisical $INFISICAL_PATH -> Vercel $VERCEL_PROJECT_ID ($VERCEL_ENVS) ==="

# Get VERCEL_TOKEN from Infisical
VERCEL_TOKEN=$(infisical secrets get VERCEL_TOKEN \
  --projectId=$INF_PROJECT_ID --path="$INFISICAL_PATH" --env=prod --plain 2>/dev/null)

if [ -z "$VERCEL_TOKEN" ]; then
  VERCEL_TOKEN="${VERCEL_TOKEN:-}"
fi
if [ -z "$VERCEL_TOKEN" ]; then
  echo "ERROR: VERCEL_TOKEN not found"
  exit 1
fi

# Export secrets to env
eval "$(infisical export --projectId=$INF_PROJECT_ID --path="$INFISICAL_PATH" --env=prod --format=dotenv-export 2>/dev/null)"

# Get secret keys
KEYS=$(infisical secrets --projectId=$INF_PROJECT_ID --path="$INFISICAL_PATH" --env=prod --output=json 2>/dev/null | python3 -c "
import sys, json
secrets = json.load(sys.stdin)
for s in secrets.get('secrets', []):
    print(s['secretKey'])
")

for key in $KEYS; do
  val="${!key:-}"
  if [ -n "$val" ]; then
    echo "  Setting $key..."
    curl -s -X POST "https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$key\",\"value\":\"$val\",\"target\":[\"preview\",\"development\"],\"type\":\"plain\"}" > /dev/null
  fi
done

echo "=== Sync complete ==="
```

## Dry-run mode

Preview current Vercel env vars without modifying:

```bash
curl -s "https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | python3 -c "
import sys, json
existing = {e['key']: e['value'][:20]+'...' for e in json.load(sys.stdin).get('envs',[])}
for k, v in sorted(existing.items()):
    print(f'  {k}: {v}')
"
```

## Commands Reference

| Action | Command |
|--------|---------|
| List env vars | `curl -s "https://api.vercel.com/v10/projects/$VID/env" -H "Authorization: Bearer $TOKEN"` |
| Add/update one | `POST /v10/projects/$VID/env` with `{key, value, target, type}` |
| Delete | `DELETE /v10/projects/$VID/env/$ENV_ID` |
| Get project ID | From `.vercel/project.json` -> `projectId` |

## Adding a New Project

1. Create Infisical path via `POST /api/v2/folders`
2. Copy base secrets into it
3. Get Vercel project ID from `.vercel/project.json`
4. Note both in this reference for future syncs
