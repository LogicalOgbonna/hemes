---
name: kanban-worker
description: Pitfalls, examples, and edge cases for Hermes Kanban workers. The lifecycle itself is auto-injected into every worker's system prompt as KANBAN_GUIDANCE (from agent/prompt_builder.py); this skill is what you load when you want deeper detail on specific scenarios.
version: 2.0.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [kanban, multi-agent, collaboration, workflow, pitfalls]
    related_skills: [kanban-orchestrator]
---

# Kanban Worker — Pitfalls and Examples

> You're seeing this skill because the Hermes Kanban dispatcher spawned you as a worker with `--skills kanban-worker` — it's loaded automatically for every dispatched worker. The **lifecycle** (6 steps: orient → work → heartbeat → block/complete) also lives in the `KANBAN_GUIDANCE` block that's auto-injected into your system prompt. This skill is the deeper detail: good handoff shapes, retry diagnostics, edge cases.

## Workspace handling

Your workspace kind determines how you should behave inside `$HERMES_KANBAN_WORKSPACE`:

| Kind | What it is | How to work |
|---|---|---|
| `scratch` | Fresh tmp dir, yours alone | Read/write freely; it gets GC'd when the task is archived. |
| `dir:<path>` | Shared persistent directory | Other runs will read what you write. Treat it like long-lived state. Path is guaranteed absolute (the kernel rejects relative paths). |
| `worktree` | Git worktree at the resolved path | If `.git` doesn't exist, run `git worktree add <path> ${HERMES_KANBAN_BRANCH:-wt/$HERMES_KANBAN_TASK}` from the main repo first, then cd and work normally. Commit work here. |

## Tenant isolation

If `$HERMES_TENANT` is set, the task belongs to a tenant namespace. When reading or writing persistent memory, prefix memory entries with the tenant so context doesn't leak across tenants:

- Good: `business-a: Acme is our biggest customer`
- Bad (leaks): `Acme is our biggest customer`

## Good summary + metadata shapes

The `kanban_complete(summary=..., metadata=...)` handoff is how downstream workers read what you did. Patterns that work:

**Coding task:**
```python
kanban_complete(
    summary="shipped rate limiter — token bucket, keys on user_id with IP fallback, 14 tests pass",
    metadata={
        "changed_files": ["rate_limiter.py", "tests/test_rate_limiter.py"],
        "tests_run": 14,
        "tests_passed": 14,
        "decisions": ["user_id primary, IP fallback for unauthenticated requests"],
    },
)
```

**Coding task that needs human review (review-required):**

For most code-changing tasks, the work isn't truly *done* until a human reviewer has eyes on it. Block instead of complete, with `reason` prefixed `review-required: ` so the dashboard surfaces the row as needing review. Drop the structured metadata (changed files, test counts, diff/PR url) into a comment first, since `kanban_block` only carries the human-readable reason — comments are the durable annotation channel. Reviewer either approves and runs `hermes kanban unblock <id>` (which re-spawns you with the comment thread for any follow-ups) or asks for changes via another comment.

```python
import json

kanban_comment(
    body="review-required handoff:\n" + json.dumps({
        "changed_files": ["rate_limiter.py", "tests/test_rate_limiter.py"],
        "tests_run": 14,
        "tests_passed": 14,
        "diff_path": "/path/to/worktree",  # or PR url if pushed
        "decisions": ["user_id primary, IP fallback for unauthenticated requests"],
    }, indent=2),
)
kanban_block(
    reason="review-required: rate limiter shipped, 14/14 tests pass — needs eyes on the user_id/IP fallback choice before merging",
)
```

Use `kanban_complete` only when the task is genuinely terminal — e.g. a one-line typo fix, a docs change with no functional consequences, or a research task where the artifact IS the writeup itself.

**Research task:**
```python
kanban_complete(
    summary="3 competing libraries reviewed; vLLM wins on throughput, SGLang on latency, Tensorrt-LLM on memory efficiency",
    metadata={
        "sources_read": 12,
        "recommendation": "vLLM",
        "benchmarks": {"vllm": 1.0, "sglang": 0.87, "trtllm": 0.72},
    },
)
```

**Review task:**
```python
kanban_complete(
    summary="reviewed PR #123; 2 blocking issues found (SQL injection in /search, missing CSRF on /settings)",
    metadata={
        "pr_number": 123,
        "findings": [
            {"severity": "critical", "file": "api/search.py", "line": 42, "issue": "raw SQL concat"},
            {"severity": "high", "file": "api/settings.py", "issue": "missing CSRF middleware"},
        ],
        "approved": False,
    },
)
```

Shape `metadata` so downstream parsers (reviewers, aggregators, schedulers) can use it without re-reading your prose.

## Claiming cards you actually created

If your run produced new kanban tasks (via `kanban_create`), pass the ids in `created_cards` on `kanban_complete`. The kernel verifies each id exists and was created by your profile; any phantom id blocks the completion with an error listing what went wrong, and the rejected attempt is permanently recorded on the task's event log. **Only list ids you captured from a successful `kanban_create` return value — never invent ids from prose, never paste ids from earlier runs, never claim cards another worker created.**

```python
# GOOD — capture return values, then claim them.
c1 = kanban_create(title="remediate SQL injection", assignee="security-worker")
c2 = kanban_create(title="fix CSRF middleware", assignee="web-worker")

kanban_complete(
    summary="Review done; spawned remediations for both findings.",
    metadata={"pr_number": 123, "approved": False},
    created_cards=[c1["task_id"], c2["task_id"]],
)
```

```python
# BAD — claiming ids you don't have captured return values for.
kanban_complete(
    summary="Created remediation cards t_a1b2c3d4, t_deadbeef",  # hallucinated
    created_cards=["t_a1b2c3d4", "t_deadbeef"],                   # → gate rejects
)
```

If a `kanban_create` call fails (exception, tool_error), the card was NOT created — do not include a phantom id for it. Retry the create, or omit the id and mention the failure in your summary. The prose-scan pass also catches `t_<hex>` references in your free-form summary that don't resolve; these don't block the completion but show up as advisory warnings on the task in the dashboard.

## Block reasons that get answered fast

Bad: `"stuck"` — the human has no context.

Good: one sentence naming the specific decision you need. Leave longer context as a comment instead.

```python
kanban_comment(
    task_id=os.environ["HERMES_KANBAN_TASK"],
    body="Full context: I have user IPs from Cloudflare headers but some users are behind NATs with thousands of peers. Keying on IP alone causes false positives.",
)
kanban_block(reason="Rate limit key choice: IP (simple, NAT-unsafe) or user_id (requires auth, skips anonymous endpoints)?")
```

The block message is what appears in the dashboard / gateway notifier. The comment is the deeper context a human reads when they open the task.

## Heartbeats worth sending

Good heartbeats name progress: `"epoch 12/50, loss 0.31"`, `"scanned 1.2M/2.4M rows"`, `"uploaded 47/120 videos"`.

Bad heartbeats: `"still working"`, empty notes, sub-second intervals. Every few minutes max; skip entirely for tasks under ~2 minutes.

## Retry scenarios

If you open the task and `kanban_show` returns `runs: [...]` with one or more closed runs, you're a retry. The prior runs' `outcome` / `summary` / `error` tell you what didn't work. Don't repeat that path. Typical retry diagnostics:

- `outcome: "timed_out"` — the previous attempt hit `max_runtime_seconds`. You may need to chunk the work or shorten it.
- `outcome: "crashed"` — OOM or segfault. Reduce memory footprint.
- `outcome: "spawn_failed"` + `error: "..."` — usually a profile config issue (missing credential, bad PATH). Ask the human via `kanban_block` instead of retrying blindly.
- `outcome: "reclaimed"` + `summary: "task archived..."` — operator archived the task out from under the previous run; you probably shouldn't be running at all, check status carefully.
- `outcome: "blocked"` — a previous attempt blocked; the unblock comment should be in the thread by now.

## Notification routing

You can configure the gateway to receive cross-profile Kanban task notifications by adding `notification_sources` to `~/.hermes/config.yaml`.
- `notification_sources: ['*']` accepts subscriptions from all profiles.
- `notification_sources: ['default', 'zilor-ppt']` or `"default,zilor-ppt"` restricts subscriptions to specified profiles.
- Omitting the key keeps the default behavior (profile isolation).

## Delivery targets

When `$HERMES_DELIVERY_TARGETS` is set, it contains a JSON array of platform:target strings (e.g. `["whatsapp:163354970747009@lid"]`). Before calling `kanban_complete` or `kanban_block`, deliver your final output to each target using `send_message`. This ensures the human who dispatched you sees your full response.

The `send_message` tool is always available to kanban workers — its gate check returns True when `HERMES_KANBAN_TASK` is set. You do not need to check if the gateway is running; the tool handles routing through the parent gateway process.

**Known pitfall — WhatsApp @lid targets:** WhatsApp chat IDs use `@lid` (users), `@g.us` (groups), and `@broadcast` suffix formats. These are now handled by the tool, but if you see `"Platform 'whatsapp' is not configured"`, it means your profile's gateway config lacks a WhatsApp entry. The fix is either (a) set `WHATSAPP_BRIDGE_PORT=3000` in the profile's `.env`, or (b) ensure the default profile's gateway config has WhatsApp enabled — workers inherit bridge connectivity from the parent gateway process.

### Delivery lifecycle for interactive tasks

For tasks that need human input before they can complete (like intake or Q&A), use the block-for-answers pattern. **Ask ONE question per block cycle** — not multiple. Sending a batch of questions overwhelms the user and forces them to type a long answer before the next run can continue. One question → block → wait → next question keeps the interaction tight and lets the user answer at their pace.

Use this pattern when your task is interactive (needs human answers before it can complete):

```python
import json, os

# 1. Check if there are delivery targets
targets_raw = os.environ.get("HERMES_DELIVERY_TARGETS")
if targets_raw:
    targets = json.loads(targets_raw)
    output = "my final response text here..."
    for t in targets:
        send_message(target=t, message=output)

# 2. If you need user input to continue, block after delivering
kanban_comment(
    body=f"Sent intake questions to {targets}. Waiting for user's answers.",
)
kanban_block(reason="Sent questions to user via delivery targets. Waiting for their answer.")
# 3. Next run (after unblock) checks the comment thread for answers
```

### Platform-specific pitfalls

**WhatsApp:** Target format is `whatsapp:<chat_id>@lid`. The `@lid` suffix is required — bare numeric chat IDs are treated as E.164 phone numbers and won't resolve. The worker sends to a local HTTP bridge at `localhost:3000` (override with `WHATSAPP_BRIDGE_PORT` env var). This bridge is always available — no profile-scoped gateway config needed.

**WhatsApp bridge not configured in profile:** If the worker's profile (`~/.hermes/profiles/<name>/config.yaml`) doesn't have a WhatsApp platform entry, `send_message` will still work because the tool falls back to env vars/defaults. If your profile has no WhatsApp config and send_message fails with "not configured", check that `WHATSAPP_BRIDGE_PORT` (default 3000) is reachable.

**Telegram:** Target format is `telegram:<chat_id>` or `telegram:<chat_id>:<thread_id>` for topics. Requires the Telegram adapter to be configured in the gateway config.

**General rule:** If `send_message` resolves the target but says "Platform 'X' is not configured," the tool needs a platform config entry in the profile-scoped or default gateway config. Some platforms (WhatsApp, Weixin) have env-var fallbacks; others require `config.yaml` entries.

See `references/whatsapp-send-message.md` for the full WhatsApp bridge architecture, target format reference, and debugging commands.

## Do NOT

- Call `delegate_task` as a substitute for `kanban_create`. `delegate_task` is for short reasoning subtasks inside YOUR run; `kanban_create` is for cross-agent handoffs that outlive one API loop.
- Modify files outside `$HERMES_KANBAN_WORKSPACE` unless the task body says to.
- Create follow-up tasks assigned to yourself — assign to the right specialist.
- Complete a task you didn't actually finish. Block it instead.
- **Assume profile .env vars are available in your subprocess.** The kanban dispatcher spawns workers by running `hermes -p <profile> ...` which sources the profile's config.yaml but does NOT inject the profile's `.env` file into the worker's environment. API keys and tokens stored in `~/.hermes/profiles/<name>/.env` will NOT be visible to `process.env` or shell environment variables.

  **Solution:** The profile's `.env` file is now an Infisical metadata stub — actual secrets live in Infisical. To make secrets available inside your worker process, wrap `hermes` with `infisical run`:

  ```bash
  export INFISICAL_TOKEN=*** && \
  infisical run --projectId=<PID> --path=/ --env=prod -- \
    hermes chat -q "my task command"
  ```

  The `infisical-secrets` skill governs this workflow. If your task requires secrets (VERCEL_TOKEN, NEON_API_KEY, etc.), the orchestrator should either: (a) verify `infisical run` is wired into the worker's startup, (b) pass task-scoped secrets in the task body/comment thread, or (c) set them in the default profile's env that the dispatcher runs under.

## Pitfalls

**Task state can change between dispatch and your startup.** Between when the dispatcher claimed and when your process actually booted, the task may have been blocked, reassigned, or archived. Always `kanban_show` first. If it reports `blocked` or `archived`, stop — you shouldn't be running.

**Workspace may have stale artifacts.** Especially `dir:` and `worktree` workspaces can have files from previous runs. Read the comment thread — it usually explains why you're running again and what state the workspace is in.

**Don't rely on the CLI when the guidance is available.** The `kanban_*` tools work across all terminal backends (Docker, Modal, SSH). `hermes kanban <verb>` from your terminal tool will fail in containerized backends because the CLI isn't installed there. When in doubt, use the tool.

## CLI fallback (for scripting)

Every tool has a CLI equivalent for human operators and scripts:
- `kanban_show` ↔ `hermes kanban show <id> --json`
- `kanban_complete` ↔ `hermes kanban complete <id> --summary "..." --metadata '{...}'`
- `kanban_block` ↔ `hermes kanban block <id> "reason"`
- `kanban_create` ↔ `hermes kanban create "title" --assignee <profile> [--parent <id>]`
- etc.

Use the tools from inside an agent; the CLI exists for the human at the terminal.
