---
name: project-repo-workflow
description: "Each project gets its own GitHub repo with Vercel CI/CD. No monorepo for apps. Create repo, init, deploy, and configure per project."
version: 1.2.0
created_by: agent
platforms: [linux, macos]
metadata:
  hermes:
    tags: [github, vercel, repo, project, ci-cd, deployment]
    related_skills: [hermes-agent, infisical-secrets, kanban-multi-agent-setup]
---

# Project Repo Workflow

Each project (app, service, etc.) gets its **own GitHub repository**. No monorepo. Each repo owns its own Vercel project for CI/CD.

## Rules

1. **One project = one repo** — never nest apps inside a monorepo
2. **Repo name** = project name (e.g. `todo-app`, `api-gateway`)
3. **Repo description** = one-line summary of what it does
4. **Vercel project** = linked to the repo, auto-deploys on push
5. **Secrets** = managed via Infisical at `/<project>` path, synced to Vercel via dashboard integration
6. **The `hemes` repo** only contains Hermes agent configs (agents/, skills/, scripts/)

## Prerequisites (one-time per GitHub account)

**Vercel GitHub app must be installed.** Without it, the API returns 400: "To link a GitHub repository, you need to install the GitHub integration first."

Install here: **https://github.com/apps/vercel**

Grant access to the repos you want Vercel to deploy. This is a one-time setup — after installation, all future projects can be linked programmatically.

## Workflow

### 1. Create the GitHub repo

```bash
# Using gh CLI
gh repo create <project-name> --private --description "<one-line description>" --clone

# Or via API
curl -s -X POST https://api.github.com/user/repos \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"name":"<project-name>","description":"<description>","private":true}'
```

### 2. Initialize the project

```bash
git clone https://github.com/LogicalOgbonna/<project>.git
cd <project>
# Copy or create the project files
git add .
git commit -m "feat: initial scaffold"
git push origin main
```

### 3. Connect Vercel project to the repo (enables CI/CD)

⚠️ **`vercel link` creates only a** local `.vercel/project.json` — it does **NOT** set up CI/CD. For auto-deploy on push, the Vercel project must be connected to the GitHub repo via the API (requires the Vercel GitHub app — see Prerequisites).

**If GitHub app is NOT installed yet:** After installing, connect the existing Vercel project to the new repo:

```bash
# Get the Vercel project ID from the original project's .vercel/project.json first
# Then patch to add git repo — only works after GitHub app is installed
curl -s -X POST "https://api.vercel.com/v9/projects" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<project>",
    "gitRepository": {"repo": "LogicalOgbonna/<project>", "type": "github"},
    "framework": "nextjs"
  }'
```

**Important:** You cannot `PATCH /v9/projects/{id}` to add `gitRepository` — the field is only accepted on creation (`POST /v9/projects`). To connect an existing project to a repo, create a **new project** with the same name (Vercel allows this when the old project is disconnected), or use the Vercel dashboard (Import Git Repository).

**If GitHub app IS installed:** Creating the Vercel project with `gitRepository` in the POST body sets up CI/CD immediately — every push to main auto-deploys.

```bash
# Create project + link repo in one call
curl -s -X POST "https://api.vercel.com/v9/projects" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<project>",
    "gitRepository": {"repo": "LogicalOgbonna/<project>", "type": "github"},
    "framework": "nextjs"
  }'
```

After this, `git push origin main` → Vercel auto-deploys. No deploy hooks or webhooks needed.

### 4. Create Infisical project path

```bash
# Create the folder
curl -s -X POST https://app.infisical.com/api/v2/folders \
  -H "Authorization: Bearer $INFISICAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"24881f6a-bfc0-4f83-82df-d0fcc27e8dab","environment":"prod","name":"<project>","path":"/"}'

# Add project secrets (from a .env file)
infisical secrets set --projectId=24881f6a-bfc0-4f83-82df-d0fcc27e8dab \
  --path=/<project> --env=prod --file=<project>.env
```

### 5. Notify user for Infisical Vercel integration

After the repo is created and Vercel is linked, alert the user:
> "Infisical Vercel integration needs to be set up. Go to app.infisical.com → Project Hermes → Integrations → Vercel. Map `/<project>` → Vercel `<project>` (Preview + Development)."

## Moving an app out of the hemes monorepo

When migrating an existing app from `hemes/apps/<project>/`:

```bash
# 1. Create new repo
gh repo create <project> --private --description "<description>"

# 2. Clone fresh, copy files
git clone https://github.com/LogicalOgbonna/<project>.git /tmp/<project>
cd /tmp/<project>
cp -r /home/ubuntu/hemes/apps/<project>/* .
git add .
git commit -m "feat: initial scaffold from hemes monorepo"
git push origin main

# 3. Remove from hemes monorepo
cd /home/ubuntu/hemes
git rm -r apps/<project>
git commit -m "chore: move <project> to own repo"
git push origin main

# 4. Link Vercel
cd /tmp/<project>
vercel link --yes --token="$VERCEL_TOKEN"

# 5. Deploy first preview
vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
vercel build --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --token="$VERCEL_TOKEN" --yes

# 6. Notify user to set up Infisical Vercel integration
```

## Pitfalls

- **`vercel link` != CI/CD.** Creating a local `.vercel/project.json` does NOT enable auto-deploy on push. Only connecting the GitHub repo via the Vercel API/dashboard (with the GitHub app installed) gives you CI/CD.
- **Cannot PATCH an existing project to add `gitRepository`.** Vercel API v9 only accepts `gitRepository` on creation (`POST /v9/projects`). To wire up an existing project, either create a new one or use the Vercel dashboard.
- **Vercel GitHub app must be installed first.** Without it, all attempts to set `gitRepository` return HTTP 400 with "You need to install the GitHub integration first."
- **Don't commit `.env` or secrets** to any repo — ever
- **Repo naming**: lowercase, hyphens. `todo-app` ✓, `TodoApp` ✗
- The `hemes/scripts/` directory stays in the hemes repo — agent infrastructure
- Each project gets its own `/<project>` Infisical path — copy only needed base secrets
- For an existing Vercel project that was created via `vercel link` without a git connection, the cleanest path is: accept it won't have CI/CD, deploy manually via `vercel deploy`. Or delete + recreate via API with `gitRepository`.
