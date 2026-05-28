# Gateway tmpfs Wrapper with Universal Auth

Concrete pattern for running the Hermes gateway with Infisical secrets injected in-memory, using a tmpfs wrapper script and universal auth — no credentials or tokens stored on persistent disk.

## When to Use

- You want zero secrets on persistent disk (container security requirement)
- You have universal auth client ID + secret (not just an access token)
- The gateway runs as a systemd user service

## How It Works

```
systemd → /dev/shm/hermes-gateway/gateway.sh (tmpfs, RAM)
              ↓
         infisical login --method=universal-auth --silent --plain
              ↓  (stdout: JWT access token)
         INFISICAL_TOKEN=*** infisical run --projectId=... --path=/ --env=prod --
              ↓  (injects 29+ secrets into child process)
         python -m hermes_cli.main gateway run --replace
```

## Full Setup

```bash
# 1. Create secure tmpfs directory
mkdir -p /dev/shm/hermes-gateway && chmod 700 /dev/shm/hermes-gateway

# 2. Write the wrapper (credentials live only in RAM)
#    WARNING: client ID/secret appear in the script on disk in /dev/shm
#    (tmpfs = RAM-backed, wiped on reboot)
cat > /dev/shm/hermes-gateway/gateway.sh << 'GATEWAY_SCRIPT'
#!/bin/bash
# tmpfs (RAM) - no persistent disk - wiped on reboot
set -euo pipefail

CLIENT_ID="62476dd6-1349-43f6-a833-d656bc7d01c4"
CLIENT_SECRET="1d53...n
GATEWAY_SCRIPT
chmod 500 /dev/shm/hermes-gateway/gateway.sh
```

But wait — the wrapper needs the client secret. To keep it from being in the terminal output, use `execute_code` to write it:

```python
from hermes_tools import write_file

script = "#!/bin/bash\nset -euo pipefail\n..."
write_file(path="/dev/shm/hermes-gateway/gateway.sh", content=script)
```

## Pitfalls

### Universal auth login does NOT persist session
`infisical login --method=universal-auth --silent` may succeed but NOT create `~/.infisical.json`. The next command finds "No valid login session found". Always use `--silent --plain` and capture the token from stdout:

```bash
AUTH_OUTPUT=*** login --method=universal-auth \
  --client-id="$CLIENT_ID" --client-secret="$CLIENT_SECRET" \
  --silent --plain 2>/dev/null)
INFISICAL_TOKEN=*** "$AUTH_OUTPUT" | tail -1)
```

The `--plain` flag is essential — without it, stdout is a table with the token buried in formatting that `tail -1` can't parse.

### After container reboot, gateway won't start
`/dev/shm` is tmpfs and wiped on reboot. The systemd unit references a script that no longer exists. The gateway fails to start. Recovery: re-create the wrapper in `/dev/shm` after every boot.

To avoid this, use the Approach B (INFISICAL_TOKEN in systemd Environment) if you expect frequent container restarts.

## Diagnosis When Platforms Go Missing

Symptom: `hermes gateway status` shows "active (running)" but no messages arrive on Telegram/WhatsApp.

Check:
```bash
grep "platform" ~/.hermes/logs/gateway.log | tail -10
```

If you see "No messaging platforms enabled" the `.env` was stubbed without updating the systemd unit.

Step-by-step recovery:
1. **Check if WhatsApp bridge is still alive**: `curl -s http://127.0.0.1:3000/health` — if it returns `{"status":"connected"}`, the bridge session survived
2. **Get an Infisical token**: see the universal auth pattern above
3. **Fix the systemd unit**: point ExecStart at `infisical run ...` or the tmpfs wrapper
4. **Restart**: `systemctl --user daemon-reload && systemctl --user restart hermes-gateway.service`
5. **Verify**: wait 5-10 seconds, then grep the log for "telegram connected" / "whatsapp connected"

WhatsApp bridge session data (`creds.json`) persist in `~/.hermes/whatsapp/session/` independent of the gateway or .env — no re-pairing needed as long as the bridge process stays alive or can restart from its session files.
