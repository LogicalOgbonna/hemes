# Neon DB Maintenance & Troubleshooting

Diagnosing and fixing common Neon database issues for projects deployed on Vercel with Infisical.

## Quick Reference

```
Environment: infisical run --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab --path=/<project> --env=prod -- <cmd>
Infisical auth: universal auth (client-id + client-secret) — login via subprocess for scripting
Vercel project ID: prj_ByBJItuj8gzffT4ZaKwKnBDCXSAY (todo-app)
```

## "password authentication failed"

### Step 1: Identify the role

```python
project_id = "wandering-rain-90639158"  # Neon project ID (from hostname)
# Get all roles on the main branch
import urllib.request, json
req = urllib.request.Request(
    f"https://console.neon.tech/api/v2/projects/{project_id}/branches/{branch_id}/roles",
    headers={"Authorization": f"Bearer {NEON_API_KEY}"}
)
roles = json.loads(urllib.request.urlopen(req).read())
```

The connection string uses format: `postgresql://<role>:***@<host>/<db>?sslmode=require`

### Step 2: Reset the password

```python
body = json.dumps({"role": {}}).encode()  # empty body = Neon generates a new password
req = urllib.request.Request(
    f"https://console.neon.tech/api/v2/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password",
    data=body, headers={"Authorization": f"Bearer {NEON_API_KEY}", "Content-Type": "application/json"}, method="POST"
)
resp = json.loads(urllib.request.urlopen(req).read())
new_pass = resp["role"]["password"]
```

**Never hardcode `***` as the password in an f-string.** The password variable must be interpolated via `{variable_name}`.

### Step 3: Build the new URL

```python
pw_part = f"{role_name}:{new_pass}"  # ← use {new_pass} NOT literal ***
host = "ep-XXXX-pooler.c-3.us-east-2.aws.neon.tech"  # pooled endpoint from .env
url = f"postgresql://{pw_part}@{host}/{db}?channel_binding=require&sslmode=require"
```

### Step 4: Verify the connection

```python
import subprocess, tempfile
with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.js') as f:
    f.write(f'''
const p = new (require("pg")).Pool({{connectionString:"{url}",ssl:{{rejectUnauthorized:false}},max:1}});
p.query("SELECT NOW()",(e,r)=>{{if(e){{console.error("ERR:",e.message);process.exit(1)}}console.log("OK");p.end()}});
''')
    tmp = f.name
subprocess.run(["node", tmp], cwd="/path/to/project-with-node_modules")
```

### Step 5: Update Infisical

```python
import tempfile, subprocess
with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.env') as f:
    f.write(f"DATABASE_URL={url}\n")
    p = f.name
subprocess.run([INF, "secrets", "set", f"--projectId={pid}", "--path=/<project>", "--env=prod", f"--file={p}"],
    env={**os.environ, "INFISICAL_TOKEN": inf_token})
os.unlink(p)
```

### Step 6: Sync to Vercel

```python
# Delete old env var
urllib.request.urlopen(urllib.request.Request(
    f"https://api.vercel.com/v9/projects/{vercel_pid}/env/{env_id}",
    headers=headers, method="DELETE"
))
# Set new env var
urllib.request.urlopen(urllib.request.Request(
    f"https://api.vercel.com/v10/projects/{vercel_pid}/env",
    data=json.dumps({"key":"DATABASE_URL","value":db_url,"target":["preview","development","production"],"type":"plain"}).encode(),
    headers={**headers, "Content-Type": "application/json"}, method="POST"
))
```

### Step 7: Trigger redeploy

```
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_ByBJItuj8gzffT4ZaKwKnBDCXSAY/a9vC2CY6Gn"
```

## Schema Fixes

### `id` column has no default

When `INSERT INTO todos (title) VALUES ($1)` fails with `null value in column "id"`, the `id` column is `text` type with no default.

**Fix:** Add UUID auto-generation:
```sql
ALTER TABLE todos ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

### Check table schema
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name='todos'
ORDER BY ordinal_position;
```

## Infisical Path Convention

- **`/`** (base) — shared credentials (GITHUB_TOKEN, NEON_API_KEY, VERCEL_TOKEN, INFISICAL universal auth creds)
- **`/<project>`** (per project) — DATABASE_URL, project-specific secrets
- Always verify which path has the secret before updating: `infisical secrets get KEY --projectId=... --path=... --env=prod --plain`
