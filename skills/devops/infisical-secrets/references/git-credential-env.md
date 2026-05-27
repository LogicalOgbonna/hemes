# Git Credential Helper Setup

When git needs to authenticate with GitHub and `GITHUB_TOKEN` is injected via
`infisical run`, standard git credential helpers fail because they expect
either a stored file or interactive stdin.

## Two Approaches

### Approach 1: `credential.helper` (interactive shell, CLI sessions)

Works when git runs in a normal shell with stdin available.

```bash
# One-time setup
git config --global credential.helper /path/to/git-credential-env.sh

# Remove any stored credentials
rm -f ~/.git-credentials

# Clean remote URL (no embedded token)
git remote set-url origin https://github.com/owner/repo.git
```

The script at `scripts/git-credential-env.sh` reads the protocol context from
git's stdin and responds with `GITHUB_TOKEN` from the environment.

### Approach 2: `GIT_ASKPASS` (non-interactive, cron, CI)

Works when git runs in a non-interactive context where stdin is not available
(cron jobs, `bash -c`, `infisical run -- bash -c "git push..."`).

```bash
export GIT_ASKPASS=/path/to/git-askpass.sh
git push origin main
# Git asks: "Username for 'https://github.com'"
# Script responds: "token"
# Git asks: "Password for 'https://token@github.com'"
# Script responds: "$GITHUB_TOKEN"
```

The script at `scripts/git-askpass.sh` is called once per prompt, so it works
even in fully non-interactive pipelines.

## Verification

Test that the helper works within `infisical run`:

```bash
# Test with credential.helper
INFISICAL_TOKEN=$TOKEN infisical run --projectId=... --path=/ --env=prod -- \
  bash -c "cd /repo && git fetch --dry-run 2>&1"

# Test with GIT_ASKPASS (for cron/non-interactive)
INFISICAL_TOKEN=$TOKEN infisical run --projectId=... --path=/ --env=prod -- \
  env GIT_ASKPASS=/path/to/git-askpass.sh \
  bash -c "cd /repo && git push origin main 2>&1"
```

## Recovering from a Failed Push

If git push fails with "could not read Username for 'https://github.com': No
such device or address", it means the credential helper is not getting stdin.
Switch to `GIT_ASKPASS`:

```bash
export GIT_ASKPASS=/path/to/git-askpass.sh
git push origin main
```

## Security Notes

- `GITHUB_TOKEN` lives only in process memory (via `infisical run`)
- No token is written to `~/.git-credentials` or any file
- The remote URL is clean (`https://github.com/owner/repo.git` — no embedded token)
- If `GITHUB_TOKEN` is not set, both scripts gracefully return nothing (git will still prompt interactively)
