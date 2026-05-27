# Vercel + Neon Deployment Patterns

> **Secrets note:** All credentials (VERCEL_TOKEN, NEON_API_KEY, etc.) are managed via Infisical at path `/` in the Hermes project. Fetch them with `infisical secrets get KEY --plain` before using in these scripts. See the `infisical-secrets` skill for details.

## Vercel Preview Deploy (3-step)

The canonical non-interactive preview deploy flow:

```bash
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
PREVIEW_URL="$(vercel deploy --prebuilt --token="$VERCEL_TOKEN" --yes)"
echo "$PREVIEW_URL"
```

Notes:
- `vercel deploy` prints the URL to **stdout** (inspect/log lines go to stderr)
- For first-time projects, link first: `vercel link --yes --token="$VERCEL_TOKEN"`
- Never deploy to production (`--prod`) unless the task explicitly says so
- If Vercel CLI isn't installed: `npx vercel <args>` auto-installs on first use

## Setting Environment Variables on Vercel

```bash
# For a preview deployment
vercel env add DATABASE_URL preview --token="$VERCEL_TOKEN"
# Then paste the value interactively, OR pipe it:
echo "$DATABASE_URL" | vercel env add DATABASE_URL preview --token="$VERCEL_TOKEN"
```

For automated flows, set the env var before `vercel build` so the build process can access it.

## Smoke-checking a Live URL

```bash
curl -sS -o /dev/null -w "%{http_code}" "$PREVIEW_URL"
# Expect 2xx or a 3xx redirect — NOT 4xx/5xx
```

For API endpoints:
```bash
curl -s "$PREVIEW_URL/api/todos" | head -c 200
```

## Programmatic Neon Database Creation

Create a project and get a connection string in one flow:

```bash
# 1. Create project
PROJECT_RESPONSE=$(curl -s -X POST https://neon.tech/api/v2/projects \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project":{"name":"my-project","region_id":"aws-us-east-1"}}')

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])")

# 2. Get connection URI
CONNECTION_URI=$(echo "$PROJECT_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
conn = d['connection_uris'][0]['connection_parameters']
print(f'postgresql://{conn[\"user\"]}:{conn[\"password\"]}@{conn[\"host\"]}/{conn[\"database\"]}')
")

echo "$CONNECTION_URI"
```

**Important:** The `region_id` should be close to the Vercel deployment region. Common values:
- `aws-us-east-1` (N. Virginia)
- `aws-us-east-2` (Ohio)
- `aws-eu-west-1` (Ireland)
- `aws-eu-central-1` (Frankfurt)

## Passing Database URL to Vercel

After creating the Neon project:

```bash
# Basic approach: pipe to vercel env
echo "$CONNECTION_URI" | vercel env add DATABASE_URL preview --token="$VERCEL_TOKEN" --yes

# The env must be set BEFORE vercel build for the build to use it
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
```

## Resolving "Neon API 404" Errors

If `GET /api/v2/projects` returns 404:
1. Verify the API key format — it should start with `napi_`
2. Check the API base URL — production is `https://neon.tech/api/v2`
3. Confirm the token has the `projects:read` scope

## Credential Hygiene

- All secrets now live in Infisical at path `/` or `/<project>` — never in local `.env` files
- The `.env` files on disk contain only metadata (INFISICAL_PROJECT_ID, INFISICAL_PATH, INFISICAL_ENV)
- Fetch secrets from Infisical at runtime rather than baking them into scripts or configs
- When copying a workspace with `.env`, delete it (`rm -rf workspace/.env`) before committing to git
- Vercel env vars set via CLI are stored encrypted by Vercel — still avoid echoing them in terminal output
