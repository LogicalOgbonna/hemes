# WhatsApp send_message for Kanban Workers

## Target Format

WhatsApp chat IDs use the format `whatsapp:<number>@lid`:

- `whatsapp:163354970747009@lid` — 1:1 DM with a user
- `whatsapp:123456789@g.us` — group chat
- `whatsapp:123456789@broadcast` — broadcast list
- `whatsapp:+4915257306` — bare E.164 number (resolved by the adapter)

The `@lid` suffix tells the target parser this is an explicit chat ID, not a channel name to look up in the directory. Without it, the tool tries channel directory resolution and fails.

## Bridge Architecture

The WhatsApp adapter runs as a local HTTP bridge:

```
kanban worker → send_message(target="whatsapp:...") → localhost:3000/send → WhatsApp
```

The bridge port defaults to 3000 (like Bailey or whatsapp-web.js bridges). Override with `WHATSAPP_BRIDGE_PORT` env var.

## No Gateway Config Needed

Unlike Telegram or Discord, WhatsApp send_message works from kanban workers WITHOUT a profile-scoped platform entry in `config.yaml`. The tool falls back to env vars and defaults:

- If `config.platforms[Platform("whatsapp")]` exists → uses that config
- If not → synthesizes `PlatformConfig(enabled=True, token="", extra={"bridge_port": <env or 3000>})`

This was added so kanban workers under isolated profiles (mentor, athena, zeus) can send WhatsApp messages without duplicating the gateway config into every profile.

## Hitting the Bridge Directly

For debugging or scripting outside the agent:

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"chatId": "163354970747009@lid", "message": "hello from script"}'
```

## History

- `_parse_target_ref` in `tools/send_message_tool.py` lacked a WhatsApp-specific handler — `@lid` suffixes fell through all checks and returned `(None, None, False)`, causing channel-directory lookup failure. Fixed at line 387 by adding a WhatsApp branch that treats any target with `@` as explicit.
- `send_message_tool` at line 222 lacked a WhatsApp fallback pconfig for profiles without gateway config. Fixed by adding a `elif platform_name == "whatsapp":` branch that reads `WHATSAPP_BRIDGE_PORT` env var (default 3000).
