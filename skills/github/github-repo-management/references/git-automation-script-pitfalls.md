# Git Automation Script Pitfalls

Common gotchas when writing shell scripts that automate git operations (backups, syncs, CI helpers, cron jobs). These bite most often when the script uses `set -e` (exit on first error), which is standard practice.

## Pitfall: `git diff --quiet` in `set -e` scripts

**The problem:** A script uses `git diff --quiet` to check whether the repo has changes before committing:

```bash
set -e
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo "No changes"
else
    git add agents/ skills/
    git commit -m "backup: $(date +%Y-%m-%d)"
    git push
fi
```

`git diff --quiet` returns exit code 1 (failure) when **any** file in the repo is dirty — including files in unrelated directories you don't intend to commit. If the repo has stray modified files in another subdirectory (e.g. `apps/todo-app/`), the condition evaluates to "has changes" even when your target paths have none. This triggers a spurious `git commit` that fails with "nothing to commit" (exit 1), and `set -e` kills the whole script.

**The fix:** Stage the specific paths you care about first, then check `git diff --cached --quiet` — this only detects changes in the paths you're about to commit:

```bash
set -e
git add agents/ skills/ scripts/
if git diff --cached --quiet; then
    echo "No backup changes to commit"
else
    git commit -m "backup: $(date +%Y-%m-%d)"

    GIT_ASKPASS="$HOME/.hermes/scripts/git-askpass.sh"
    $INF run --projectId=$PROJECT_ID --path=/ --env=prod -- \
      env GIT_ASKPASS="$GIT_ASKPASS" \
      bash -c "cd $REPO_DIR && git push origin main 2>&1" | tail -3

    echo "✅ Backed up and pushed"
fi
```

This is safe: `git add` on unchanged files is a no-op (exit 0), so `set -e` won't kill you. And `git commit` only runs when there's actually something to commit.

### Bonus: `git add` is idempotent

Running `git add` on files that haven't changed is harmless — it re-stages the same content and produces a zero exit code. This makes "always stage, then check" a safe pattern.

## General Principle

When gating a git commit in a `set -e` script, **always scope the "do we have changes?" check to exactly the paths you'll commit**. Never check the whole repo state — unrelated artifacts (scratch files, build output, test fixtures in other directories) will cause false positives.
