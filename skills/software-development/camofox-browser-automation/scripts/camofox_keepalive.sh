#!/bin/bash
# Keep Camofox browser server alive — restarts if down
# Checks BOTH health endpoint AND browserConnected field
set -e

CAMOFOX_DIR="/tmp/camofox-browser"
HEALTH_URL="http://localhost:9377/health"

# Check BOTH that server responds AND browser is connected
response=$(curl -sf "$HEALTH_URL" 2>/dev/null)
if echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('browserConnected') and d.get('browserRunning') else 1)" 2>/dev/null; then
  exit 0  # Server running AND browser connected
fi

# If server responds but no browser, create a tab to trigger browser launch
if [ -n "$response" ]; then
  # Server is up but browser isn't — fix by creating a tab (auto-starts browser)
  curl -s -X POST http://localhost:9377/tabs \
    -H 'Content-Type: application/json' \
    -d '{"userId":"healthcheck","sessionKey":"keepalive","url":"about:blank"}' > /dev/null 2>&1
  sleep 3
  # Re-check
  response2=$(curl -sf "$HEALTH_URL" 2>/dev/null)
  if echo "$response2" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('browserConnected') else 1)" 2>/dev/null; then
    echo "Camofox browser re-launched at $(date)"
    exit 0
  fi
fi

# Full restart needed
cd "$CAMOFOX_DIR"
nohup npm start &>/tmp/camofox.log &
echo "Camofox full restart at $(date)"
