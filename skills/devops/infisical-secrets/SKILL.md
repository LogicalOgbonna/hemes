---
name: infisical-secrets
description: "Manage all secrets via Infisical — no local .env files. Base secrets in /, project secrets in /<project>, auto-synced across profiles."
version: 2.4.0
created_by: agent
platforms: [linux, macos]
metadata:
  hermes:
    tags: [infisical, secrets, credentials, security, env, profiles]
    related_skills: [hermes-agent, kanban-multi-agent-setup]
---

# Infisical Secrets Management

All secrets are managed through **Infisical** (cloud at app.infisical.com). No secrets are stored in local `.env` files on disk. Hermes reads them from Infisical at runtime.

## Folder Structure

```
/                          ← Base secrets: shared credentials
  ├── DEEPSEEK_API_KEY
  ├── TELEGRAM_BOT_TOKEN
  ├── WHATSAPP_* 
  ├── EMAIL_*
  ├── GITHUB_TOKEN
  ├── VERCEL_TOKEN
  ├── NEON_API_KEY
  └── ... (anything multiple profiles/jobs need)

/<project_name>            ← Project-specific secrets (created per project)
  ├── DEEPSEEK_API_KEY     ← Copied from / if project needs it
  ├── VERCEL_TOKEN         ← Copied from / if project needs it
  ├── NEON_API_KEY         ← Copied from / if project needs it
  ├── NEON_PROJECT_ID      ← Project-specific
  └── ... (project-local secrets)
```

### Rules

1. **Base `/`** — holds secrets that multiple profiles, cron jobs, or projects depend on. Created once, updated centrally.
2. **`/<project_name>`** — created when starting work on a new project (e.g. `/todo-app`, `/hermes-agent`). Contains only the secrets that project actually needs.
3. **Seeds from base** — when creating a project folder, copy the relevant base secrets into it so the project is self-contained and doesn't need base access at runtime.
4. **No local `.env` files** — once a secret is in Infisical, delete its local `.env` copy. `.env` files that remain on disk are stale references only (for documentation), not live config.

## Installation

The apt package is stuck at an old version (0.38.0) and blocks writes. Install via npm:

```bash
npm install -g @infisical/cli
# Verify:
infisical --version
# Expect v0.43+ (or latest)
```

For ARM64 (aarch64) Linux, this is the only reliable install method — the GitHub release tarball naming is inconsistent for ARM.

## Authentication (Machine Identity)

Authentication method hierarchy (prefer the first that fits your use case):

| Method | Persistence | Best for |
|--------|-------------|----------|
| **Universal auth** (client ID + secret) | Auto-refreshing token, stored in `~/.infisical.json` | Long-running daemons, gateway |
| **Token auth** (access token JWT) | 30-day TTL, must be re-created | Short-lived scripts, CI |
| **Cloud IAM** (AWS/GCP/Azure) | Zero stored credentials | Cloud-hosted agents |

### Universal auth (client ID + secret) — PREFERRED

Login once — the session persists in `~/.infisical.json` and auto-refreshes:

```bash
infisical login --method=universal-auth \
  --client-id=<CLIENT_ID> \
  --client-secret=<CLIENT_SECRET> \
  --silent
```

After login, all `infisical` commands use the stored session automatically — no need to pass env vars.

**Pitfall — session may not persist on all setups.** On some systems (notably Linux without a persistent credential store), `infisical login --silent` succeeds and returns a token but does NOT create `~/.infisical.json`. The next `infisical secrets` command fails with "No valid login session found, triggering login flow". Workaround: always use `--silent --plain` to capture the token from stdout, then pass it via `INFISICAL_TOKEN` env var or embed it in a wrapper script (see "Zero-Disk Gateway" below).

**To get an access token from universal auth for ephemeral use:**
```bash
infisical login --method=universal-auth \
  --client-id=<CLIENT_ID> \
  --client-secret=<CLIENT_SECRET> \
  --silent --plain
# The last line of stdout is the JWT access token
```

### Token auth (access token JWT)

Set the `INFISICAL_TOKEN` env var. No login needed:

```bash
export INFISICAL_TOKEN="eyJh..."   # Machine identity access token
```

**Pitfall:** Access tokens expire in 30 days. Create a new one from the Infisical dashboard when expired.

The machine identity must have the Hermes project attached. Find the project ID:

```bash
curl -s -H "Authorization: Bearer $INFISICAL_TOKEN" \
  "https://app.infisical.com/api/v1/projects"
```

Then pass `--projectId` for all commands.

## Working with Secrets

All commands need the project ID. Set it once or pass `--projectId` each time:

```bash
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"
```

### List secrets

```bash
INFISICAL_TOKEN=$TOKEN infisical secrets --projectId=$PROJECT_ID --path="/" --env=prod
```

### Get a single value

```bash
INFISICAL_TOKEN=$TOKEN infisical secrets get KEY --projectId=$PROJECT_ID --path="/" --env=prod --plain
```

### Set a secret (preferred: `--file` approach)

The most reliable way to set secrets — especially ones with special characters — is to write a `.env` file and use `--file`:

```bash
# Write an env-formatted file with all secrets
cat > /tmp/secrets.env << 'EOF'
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
VERCEL_TOKEN=vcp_...
EOF

# Load them all at once
INFISICAL_TOKEN=$TOKEN infisical secrets set \
  --projectId=$PROJECT_ID --path="/" --env=prod \
  --file=/tmp/secrets.env

rm /tmp/secrets.env
```

### Set a secret (inline — simple values only)

Works for short alphanumeric values without special chars:

```bash
INFISICAL_TOKEN=$TOKEN infisical secrets set \
  --projectId=$PROJECT_ID --path="/" --env=prod \
  "KEY=simple-value"
```

**CRITICAL PITFALL — @filepath is broken in CLI v0.43.x:** The `key=@/path/to/file` syntax **does NOT work** — it stores the literal string `@/tmp/val.txt` as the secret value instead of reading the file contents. Do NOT use `@filepath` syntax. Use `--file` instead.

**Also:** The CLI rejects empty values with "ensure that each secret has a non-empty key and value". Skip keys with blank values rather than trying to set them.

### Delete a secret

```bash
INFISICAL_TOKEN=$TOKEN infisical secrets delete --projectId=$PROJECT_ID --path="/" --env=prod KEY
```

## Creating a Project Folder

**CRITICAL:** You CANNOT set secrets at a path that doesn't exist yet — `infisical secrets set --path=/todo-app` will fail with "Folder with path '/todo-app' was not found". Folders must be created first via the API, then secrets can be added.

### Step 1: Create the folder via API

```bash
curl -s -X POST "https://app.infisical.com/api/v2/folders" \
  -H "Authorization: Bearer $INFISICAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'"$PROJECT_ID"'",
    "environment": "prod",
    "name": "todo-app",
    "path": "/"
  }'
```

The response returns a `folder.id`. No CLI command exists for folder creation.

### Step 2: Add project-specific secrets

Use `--file` with an env-formatted file for all values:

```bash
# Write secrets to an env file, then load via --file
cat > /tmp/project.env << 'EOF'
NEON_PROJECT_ID=my-project
DATABASE_URL=postgresql://user:pass@host:5432/db
EOF

INFISICAL_TOKEN=$TOKEN infisical secrets set \
  --projectId=$PROJECT_ID --path="/todo-app" --env=prod \
  --file=/tmp/project.env

rm /tmp/project.env
```

### Step 3: Copy relevant base secrets into it

```bash
# Write all copied secrets to one env file, then upload at once
cat > /tmp/copy.env << 'EOF'
EOF

for key in VERCEL_TOKEN GITHUB_TOKEN NEON_API_KEY; do
  val=$(INFISICAL_TOKEN=$TOKEN infisical secrets get "$key" \
    --projectId=$PROJECT_ID --path="/" --env=prod --plain)
  if [ -n "$val" ]; then
    # Use Python to safely append (avoids bash escaping issues)
    python3 -c "
import os
key = '$key'
val = '''$val'''
with open('/tmp/copy.env', 'a') as f:
    f.write(f'{key}={val}\n')
"
  fi
done

INFISICAL_TOKEN=$TOKEN infisical secrets set \
  --projectId=$PROJECT_ID --path="/todo-app" --env=prod \
  --file=/tmp/copy.env

rm /tmp/copy.env
```

### Step 4: Update the profile's `.env` to point to the new path

```bash
echo "INFISICAL_PATH=/todo-app" >> ~/.hermes/profiles/zeus/.env
```

### From `execute_code` (Python)

```python
import subprocess, os, tempfile

# 1. Create folder
folder_data = json.dumps({
    "projectId": PROJECT_ID,
    "environment": "prod",
    "name": "todo-app",
    "path": "/"
}).encode()
req = urllib.request.Request(
    "https://app.infisical.com/api/v2/folders",
    data=folder_data,
    headers={"Authorization": f"Bearer {inf_token}", "Content-Type": "application/json"}
)
urllib.request.urlopen(req)

# 2. Set secrets via @filepath
tf = tempfile.NamedTemporaryFile(mode='w', delete=False)
tf.write(db_url)
tf.close()
subprocess.run([INF, "secrets", "set", f"--projectId={PROJECT_ID}",
    "--path=/todo-app", "--env=prod", f"DATABASE_URL=@{tf.name}"])
os.unlink(tf.name)
```

## Profile Integration (Zeus, Athena, etc.)

Each Hermes profile's `.env` should contain ONLY metadata, never actual secrets:

```bash
# This file is managed by Infisical — do not edit directly
INFISICAL_PROJECT_ID=24881f6a-bfc0-4f83-82df-d0fcc27e8dab
INFISICAL_PATH=/
INFISICAL_ENV=prod
```

### Primary Method: `infisical run` (secrets in memory, never on disk)

Use `infisical run` to inject secrets as environment variables **directly into the process memory**. No `.env` file is written — secrets exist only in the Hermes process's memory and are gone when it exits.

```bash
# Start Hermes CLI with secrets injected
INFISICAL_TOKEN=$TOKEN infisical run \
  --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/ --env=prod -- \
  /home/ubuntu/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main chat

# Start gateway with secrets injected (absolute paths required — see pitfall below)
INFISICAL_TOKEN=$TOKEN infisical run \
  --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/ --env=prod -- \
  /home/ubuntu/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main gateway run --replace
```

**Advantages:**
- ✅ **Never touches disk** — no `.env` file is created or overwritten
- ✅ **Process memory only** — container breach can't exfiltrate a secrets file
- ✅ **Transient** — when process dies, env vars are gone
- ✅ **No file dependencies** — works in any environment (containers, CI, bare metal)

**Authentication for infisical run:**

Set `INFISICAL_TOKEN` as an env var before calling `infisical run`:
```bash
export INFISICAL_TOKEN="eyJh..."   # Machine identity access token
```

For daemon processes (gateway), the `INFISICAL_TOKEN` itself must be stored somewhere. Options (ordered by security):
1. **Cloud IAM** — authenticate via AWS/GCP/Azure metadata service (no stored token)
2. **Systemd service EnvironmentFile** — readable only by root
3. **Hermes config.yaml** — `hermes config set agent.env.INFISICAL_TOKEN <value>`

### Systemd Gateway Unit Migration

When migrating from a direct `.env`-based gateway to Infisical-injected secrets, you MUST update the systemd unit **before** stubbing the `.env` file. There are two approaches depending on how zero-disk you need to be.

#### Approach A: tmpfs Wrapper with Universal Auth (Zero-Disk — PREFERRED)

Avoids storing any INFISICAL_TOKEN or credentials on persistent disk. The wrapper script lives in `/dev/shm` (tmpfs, RAM-backed, wiped on reboot) and authenticates to Infisical via universal auth at every startup.

**Warning:** `infisical login --silent` may not persist the session to `~/.infisical.json` on all setups. Always use the `--silent --plain` flag and capture the token from stdout.

Create the wrapper at `/dev/shm/hermes-gateway/gateway.sh`:

```bash
mkdir -p /dev/shm/hermes-gateway && chmod 700 /dev/shm/hermes-gateway
```

```bash
cat > /dev/shm/hermes-gateway/gateway.sh << 'GATEWAY_EOF'
#!/bin/bash
set -euo pipefail

CLIENT_ID="<your-universal-auth-client-id>"
CLIENT_SECRET="<your-universal-auth-client-secret>"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"

AUTH_OUTPUT=$(infisical login \
  --method=universal-auth \
  --client-id="$CLIENT_ID" \
  --client-secret="$CLIENT_SECRET" \
  --silent --plain 2>/dev/null)
INFISICAL_TOKEN=$(echo "$AUTH_OUTPUT" | tail -1)

if [ -z "$INFISICAL_TOKEN" ]; then
  echo "FATAL: Infisical auth failed" >&2
  exit 1
fi
export INFISICAL_TOKEN

exec /home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical run \
  --projectId="$PROJECT_ID" \
  --path=/ \
  --env=prod -- \
  /home/ubuntu/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main gateway run --replace
GATEWAY_EOF

chmod 500 /dev/shm/hermes-gateway/gateway.sh
```

Update the systemd unit's ExecStart to point at this wrapper:

```ini
[Service]
ExecStart=
ExecStart=/dev/shm/hermes-gateway/gateway.sh
```

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway.service
```

**Note:** If the container reboots, `/dev/shm` is wiped and the wrapper is gone. Recreate it after a restart before the gateway can work again.

#### Approach B: Systemd Environment with INFISICAL_TOKEN (Simpler, Token on Disk)

Store the machine identity access token in the systemd unit's Environment. The token is visible in the systemd unit file on disk but expires in 30 days.

```bash
systemctl --user edit hermes-gateway.service
```

Paste this override:

```ini
[Service]
ExecStart=
ExecStart=/home/ubuntu/.nvm/versions/node/v22.22.3/bin/infisical run \
  --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/ --env=prod -- \
  /home/ubuntu/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main gateway run --replace
Environment=INFISICAL_TOKEN=<your-machine-identity-token>
```

Then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway.service
# Verify:
hermes gateway status
grep "platform" ~/.hermes/logs/gateway.log | tail -5
```

**If the gateway is already broken** you can test with a one-shot command before updating the unit:

```bash
export INFISICAL_TOKEN="eyJ..."
infisical run --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/ --env=prod -- \
  /home/ubuntu/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main gateway run --replace
```

**WhatsApp bridge note:** The bridge process runs as a separate Node.js daemon (`node bridge.js --port 3000 --session ...`). It keeps its own credentials in `~/.hermes/whatsapp/session/creds.json` and is unaffected by the .env change. When the gateway reconnects under `infisical run`, it finds the bridge already healthy on port 3000. No re-pairing is needed after a gateway migration — the WhatsApp session survives independently.

### Alternative: Cron-refreshed .env (fallback)

If `infisical run` isn't feasible for a specific use case, sync secrets to `.env` periodically:

```bash
INFISICAL_TOKEN=$TOKEN infisical export \
  --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/ --env=prod --format=dotenv-export > ~/.hermes/.env
```

Run this as a cron job. Trade-off: secrets exist on disk between syncs.

## Syncing Infisical Secrets to Vercel

Single source of truth: secrets live in Infisical, and Vercel project env vars are synced from Infisical before each deploy. Never set Vercel env vars manually — the sync script does it.

### Workflow

```
Infisical/(<project>)  ──sync──>  Vercel project env vars  ──use──>  Deploy preview
       │                                  │
   Manage here                      Read at build time
```

1. **Create a project folder** in Infisical (`/<project>`) with the secrets the Vercel project needs
2. **Run the sync** before deploying — pushes Infisical secrets → Vercel project env vars
3. **Deploy** — Vercel build/runtime picks up the synced env vars

### Sync script

```bash
# Sync Infisical /<project> → Vercel project env vars
# Args: $1 = Infisical path (e.g. /todo-app), $2 = Vercel env targets (e.g. preview,development)
# Requires: INFISICAL_TOKEN, VERCEL_TOKEN in environment

INFISICAL_PATH="${1:-/}"
VERCEL_ENVS="${2:-preview,development}"
PROJECT_ID="24881f6a-bfc0-4f83-82df-d0fcc27e8dab"
VERCEL_PROJECT_ID="prj_ByBJItuj8gzffT4ZaKwKnBDCXSAY"

# Get secrets from Infisical
SECRETS_JSON=$(infisical secrets --projectId=$PROJECT_ID --path="$INFISICAL_PATH" --env=prod)

# Parse and push each to Vercel
infisical run --projectId=$PROJECT_ID --path="$INFISICAL_PATH" --env=prod -- \
  bash -c "
    for key in DATABASE_URL NEON_API_KEY DEEPSEEK_API_KEY; do
      val=\"\${!key}\"
      [ -n \"\$val\" ] && echo \"\$val\" | vercel env add \"\$key\" $VERCEL_ENVS --token=\$VERCEL_TOKEN --yes 2>/dev/null
    done
  "
```

### Vercel API (alternative to CLI)

For bulk syncs, use the Vercel REST API directly.

**⚠️ Vercel does NOT upsert env vars.** POST with an existing key returns 400 "duplicate key". Always DELETE the old env var first:

```bash
# 1. List current env vars and find the one to replace
curl -s "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID/env" \
  -H "Authorization: Bearer $VERCEL_TOKEN"
# 2. Delete the old one
curl -s -X DELETE "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID/env/$ENV_VAR_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN"
# 3. Create the new one
curl -s -X POST "https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env" \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{
    "key": "DATABASE_URL",
    "value": "postgresql://...",
    "target": ["preview", "development", "production"],
    "type": "plain"
  }'
```

When a secret key existed in multiple targets (e.g. "preview" and "development" as separate env vars), you'll find multiple entries to delete. Vercel exposes one env per target — delete all before setting a unified value with all targets.

### Per-project pattern

| Infisical path | Vercel project | Vercel project ID |
|---|---|---|
| `/` (base) | — | — |
| `/todo-app` | todo-app | `prj_ByBJItuj8gzffT4ZaKwKnBDCXSAY` |
| `/<new-project>` | <new-project> | (get from `.vercel/project.json`) |

To add a new project: create its Infisical folder, copy base secrets into it, note the Vercel project ID from `.vercel/project.json`, then sync.

See `references/vercel-env-sync.md` for the full script with error handling and dry-run mode.

## Agent Profile Backup to Git

Daily git-backed backup of agent profiles (SOUL.md, config) so state survives container restarts. The backup script copies `~/.hermes/profiles/<name>/` files to the project repo at `agents/<name>/`, then commits and pushes to GitHub.

Auth pattern: the push runs inside `infisical run` with `GIT_ASKPASS` using `GITHUB_TOKEN` from Infisical — no token ever touches disk. **Do not rely on the persisted `infisical login` session for cron pushes** — it expires silently and the run dies with a 403 "Your token has expired". The script mints a fresh universal-auth token on every push (`infisical login --method=universal-auth --client-id=... --client-secret=... --plain --silent`, captured from stdout, passed as `INFISICAL_TOKEN`), so it never depends on session state.

Backup-script pitfalls learned the hard way (apply to ANY git commit/push automation):
- **Run the push OUTSIDE the change-detection branch — always attempt it.** If the push only runs when there are new changes to commit, a failed push (expired token, network) followed by a no-change day means the remote silently lags forever — the script reports "No backup changes to commit" and never retries. `git push` is idempotent ("Everything up-to-date" is a no-op success), so structure it as: commit-if-changed, then always push.
- **Scope change detection to the committed paths.** A whole-repo `git diff --quiet` trips on unrelated dirty files (e.g. a WIP `apps/` tree), forcing the script into the commit branch; with nothing staged in scope, `git commit` fails and `set -e` aborts before the push ever runs — every day, silently. Check only the backup paths: `git diff --quiet -- <paths>` + `git ls-files --others --exclude-standard -- <paths>` for untracked.
- **Commit with a pathspec** (`git commit -m ... -- <paths>`) so unrelated pre-staged changes never get swept into automation commits.
- **Never pipe a push to `tail` without `set -o pipefail`** — the pipeline's exit code is `tail`'s, so a failed push prints a false success ("✅ Backed up and pushed") while the remote never updated. Add `set -o pipefail` (or check `${PIPESTATUS[0]}`).
- **A stale `INFISICAL_TOKEN` env var beats a fresh login.** If the shell still exports an old token, `infisical run` uses it and dies with 403 "Your token has expired" even right after `infisical login`. Export the newly minted token explicitly, or `env -u INFISICAL_TOKEN infisical run ...` to use the persisted session.
- A dirty working tree elsewhere in the repo is NOT a backup failure — report it but don't let it block or contaminate the backup commit.

See `references/agent-backup.md` for the full script, setup, and adding new profiles.

## Git Credential Integration

When git needs to push/pull to GitHub, it needs `GITHUB_TOKEN`. With `infisical run`, the token is in the environment but not on disk — git can't read it directly.

Use a **credential helper script** that reads `GITHUB_TOKEN` from the env:

```bash
# One-time setup:
git config --global credential.helper /path/to/git-credential-env.sh
rm -f ~/.git-credentials
git remote set-url origin https://github.com/owner/repo.git
```

The script is at `scripts/git-credential-env.sh`. For non-interactive contexts (cron, CI), use `scripts/git-askpass.sh` with `GIT_ASKPASS` instead. See `references/git-credential-env.md` for full setup, verification, and troubleshooting.

## Protected .env Files

The root `~/.hermes/.env` is a protected system file — `write_file` and `terminal` both block modifications to it. To replace it:

1. Upload all secrets to Infisical first (via `execute_code` with `INFISICAL_TOKEN` env var)
2. Use the terminal with explicit user approval to rewrite the file:

```bash
cat > ~/.hermes/.env << 'EOF'
INFISICAL_PROJECT_ID=...
INFISICAL_PATH=/
INFISICAL_ENV=prod
EOF
```

The protection exists because `.env` usually contains live credentials — once migrated, the user must explicitly approve the replacement.

## Workflow for Adding a New Secret

1. Add it to Infisical at `/` if it's a shared credential
2. Copy it to each project folder (`/<project>`) that needs it
3. Delete the local `.env` copy if one exists
4. Update this skill if it's a new category of secret (e.g. a new provider token)

## Pitfalls

### CRITICAL: Stubbing `.env` bricks the gateway if systemd unit is not updated

Replacing `~/.hermes/.env` with an Infisical-only stub **instantly kills all messaging platforms** (Telegram, WhatsApp, etc.) unless the systemd gateway unit also runs under `infisical run`. The default systemd unit runs the gateway directly:

```
ExecStart=...python -m hermes_cli.main gateway run --replace
```

This bypasses Infisical entirely — the gateway process never sees the platform credentials. The symptom is "No messaging platforms enabled" in the gateway log despite the service showing "active (running)".

**Always update the systemd unit BEFORE or simultaneously with stubbing `.env`.** See "Systemd Gateway Unit Migration" below for the exact override command.

**If already broken:** The WhatsApp bridge Node.js process and its session data (`~/.hermes/whatsapp/session/`) survive independently — no re-pairing needed. Two recovery paths: (a) update the systemd unit to wrap with `infisical run`, or (b) temporarily restore `.env` with credentials and restart the gateway. Diagnosis: `hermes gateway status` + `grep 'No messaging platforms enabled' ~/.hermes/logs/gateway.log`.

- **`infisical run` strips PATH.** The subprocess started by `infisical run` runs in a sanitized environment — it does NOT inherit the parent shell's PATH. Commands like `python` or `hermes` will fail with `executable file not found in $PATH`. Always use absolute paths for both `infisical` itself and the command being wrapped, even in one-shot test commands.
- **Install via npm, not apt.** The apt package (v0.38.0) is too old and blocks writes
- **The CLI requires `--projectId`** when using machine identity (env var or token). Without it, you get "Project ID is required when using machine identity".
- **`@filepath` stores the literal path** if the file doesn't exist or the path is malformed. Always verify the value was stored correctly with `infisical secrets get ... --plain`.
- **Empty values** are rejected with "ensure that each secret has a none empty key and value". Skip empty secrets rather than trying to store them.
- **Access tokens expire in 30 days.** Machine identity access tokens have a 30-day TTL. For long-running daemons, use universal auth (client ID + secret, auto-refreshing) or cloud IAM (no token to rotate).
- **Persisted `infisical login` sessions expire silently.** A cron job / daemon relying on the stored session will fail with 403 "Your token has expired" after expiry — and re-running `infisical login` may not produce a usable persisted session (status still shows expired). For automation, mint a fresh token per run (`infisical login --method=universal-auth ... --silent --plain`, take last stdout line) and pass it explicitly as `INFISICAL_TOKEN` — the env var takes precedence over any persisted session. See "Agent Profile Backup to Git".
- **Use `execute_code` for bulk uploads, not shell.** JWT tokens and secrets with special characters (`@`, `/`, `+`, `=`) break bash quoting. Use Python `subprocess.run()` inside `execute_code` to pass secrets as env vars and temp files.
- **Don't commit `.infisical.json`** — add to `.gitignore`
- **Don't echo secret values** in terminal or logs — mask them
- **Folder paths are case-sensitive**: `/TodoApp` ≠ `/todo-app`
- **Environment matters**: secrets in `dev` are invisible to `prod` and vice versa
- **The `INFISICAL_TOKEN` env var approach** is simpler than `infisical login` for automation — no persistent session files, just an env var
- **ARM64 Linux**: the apt repo and GitHub release tarballs both have issues on aarch64. npm install `@infisical/cli` is the known-good path.
- When copying secrets between folders, the `--plain` flag suppresses the "NEW/SECRET" table format — essential for scripting
- If a profile's `.env` is empty, Hermes may fail to start. Always keep at least `INFISICAL_PROJECT_ID`, `INFISICAL_PATH`, and `INFISICAL_ENV` in the profile `.env` to signal "managed by Infisical"

## References

- `references/gateway-restart-pattern.md` — Restart a bricked gateway with Infisical wrapper + secret-masking workaround for wrapper scripts
- `references/kanban-db-recovery.md` — Recover a corrupt kanban SQLite DB (page corruption → row-level surgical recovery)
- `references/neon-password-reset.md` — Reset expired/stale Neon DB passwords and update Infisical
- `references/vercel-env-sync.md` — Sync Infisical secrets to Vercel project env vars
- `references/git-credential-env.md` — Git credential helper setup for Infisical-managed tokens
- `references/agent-backup.md` — Daily git backup of agent profiles

## Deployed Scripts

- `~/.hermes/scripts/gateway-wrapper.sh` — Executable wrapper used by the systemd gateway unit (`~/.config/systemd/user/hermes-gateway.service`). Authenticates via Infisical universal auth, auto-repairs corrupt kanban DB via the technique in `references/kanban-db-recovery.md`, then injects secrets via `infisical run` and starts the gateway. Restart with: `systemctl --user restart hermes-gateway`.
- `~/.hermes/scripts/git-credential-env.sh` — Git credential helper that reads `GITHUB_TOKEN` from environment.
- `~/.hermes/scripts/git-askpass.sh` — Git askpass helper for non-interactive contexts.
