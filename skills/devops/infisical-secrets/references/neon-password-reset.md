# Neon Database Password Reset

When a Neon Postgres password expires or becomes stale (common with pooled connection strings managed via Infisical), follow this workflow to diagnose, fix, and update all secret stores.

## Detection

Symptoms of stale DB password:
- `password authentication failed for user 'neondb_owner'` when connecting via `pg` or `@neondatabase/serverless`
- App returns 500 errors on DB queries
- Cached `.env` file has a working password but the Infisical-stored value is stale

Test the DB directly (from project dir with `pg` installed):

```bash
infisical run --projectId=<PROJECT_ID> --path=/todo-app --env=prod -- \
  bash -c 'cd <PROJECT_DIR> && node -e "const{Pool}=require(\"pg\");const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1});p.query(\"SELECT NOW()\",(e,r)=>{if(e){console.error(\"ERR:\",e.message);process.exit(1)}console.log(\"OK:\",r.rows[0].now);p.end()})"'
```

## Reset the Password via Neon API

### Prerequisites

- **NEON_API_KEY** — stored in Infisical at `/` (base/shared)
- **Project ID** — found via `GET /api/v2/projects`

### Step 1: Identify the project

List all Neon projects, find the one matching your app (e.g. "hemes-todo").

### Step 2: Identify branches and roles

```bash
curl -s -H "Authorization: Bearer *** \
  "https://console.neon.tech/api/v2/projects/<PROJECT_ID>/branches"

curl -s -H "Authorization: Bearer *** \
  "https://console.neon.tech/api/v2/projects/<PROJECT_ID>/branches/<BRANCH_ID>/roles"
```

### Step 3: Reset the password

Neon generates a new password when you POST with an empty role body:

```bash
curl -s -X POST -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{"role": {}}' \
  "https://console.neon.tech/api/v2/projects/<PROJECT_ID>/branches/<BRANCH_ID>/roles/neondb_owner/reset_password"
```

Response includes `{"role": {"password": "npg_XXXX..."}}`.

### Step 4: Build the connection URL

Pooled endpoint (serverless): `ep-<ID>-pooler.c-<REGION>.aws.neon.tech`
Direct endpoint: `ep-<ID>.c-<REGION>.aws.neon.tech`

```
postgresql://neondb_owner:PASSWORD@HOST/neondb?channel_binding=require&sslmode=require
```

**⚠️ CRITICAL — use proper variable interpolation:**
```python
# CORRECT
url = f"postgresql://neondb_owner:{new_pass}@{host}/{db}?{params}"

# WRONG — literal *** in f-string
url = f"postgresql://neondb_owner:***@..."  # BUG
```

### Step 5: Test and update Infisical

```python
import tempfile, subprocess
with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.env') as f:
    f.write(f"DATABASE_URL={url}\n")
    tmp = f.name
subprocess.run([INF, "secrets", "set", f"--projectId={pid}", "--path=/todo-app",
    "--env=prod", f"--file={tmp}"], env=env)
os.unlink(tmp)
```

Verify:
```bash
infisical run --projectId=<PROJECT_ID> --path=/todo-app --env=prod -- \
  bash -c 'cd <PROJECT_DIR> && node test_db_conn.js'
```

## Common Schema Issues

### "null value in column 'id' violates not-null constraint"

The `id` column may be `text` with no default. Fix:

```sql
ALTER TABLE todos ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

Requires PostgreSQL 13+ (built-in `gen_random_uuid()`).

Check current schema:
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns WHERE table_name='todos'
ORDER BY ordinal_position;
```

## Next Step: Sync to Vercel

After resetting the password and updating Infisical, you MUST sync the new `DATABASE_URL` to Vercel's project env vars. Vercel reads env vars at build time, not from Infisical at runtime — the old password is baked into every running deployment until you sync.

### Option A: Vercel API (direct)

```python
headers = {"Authorization": f"Bearer {VERCEL_TOKEN}", "Content-Type": "application/json"}

# Delete old DATABASE_URL first (avoid duplicate key)
req = urllib.request.Request(
    f"https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/env",
    headers=headers
)
for env_var in json.loads(urllib.request.urlopen(req).read()).get("envs", []):
    if env_var.get("key") == "DATABASE_URL":
        urllib.request.urlopen(urllib.request.Request(
            f"https://api.vercel.com/v9/projects/{VERCEL_PROJECT_ID}/env/{env_var['id']}",
            headers=headers, method="DELETE"), timeout=15)

# Set new value
body = json.dumps({
    "key": "DATABASE_URL", "value": new_url,
    "target": ["preview", "development", "production"], "type": "plain"
})
urllib.request.Request(
    f"https://api.vercel.com/v10/projects/{VERCEL_PROJECT_ID}/env",
    data=body.encode(), headers=headers, method="POST"
)
```

### Option B: Deploy hook (after env var is set)

```bash
curl -s -X POST "https://api.vercel.com/v1/integrations/deploy/prj_XXXXX/hook_id"
```

### Verify

```bash
curl -s https://your-app.vercel.app/api/todos
# Should return [] or data, not {"error": "Failed to fetch todos"}
```

## Pitfalls

- **Password not in URL** — double-check f-string interpolation: use `{new_pass}` not `***` literal text
- **Pooled vs direct URL** — pooled uses `-pooler` suffix and `channel_binding=require` param
- **Deploy needed** — after updating Infisical, re-deploy (Vercel auto-deploy on push) for the app to pick up the new value
- **`pg` module not found** — run from project dir where node_modules is installed, or use `cd <project> && node ...`
