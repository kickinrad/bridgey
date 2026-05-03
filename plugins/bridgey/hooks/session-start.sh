#!/usr/bin/env bash
# bridgey SessionStart hook — bootstrap + watchdog
set -euo pipefail

CONFIG="${BRIDGEY_CONFIG:-${HOME}/.bridgey/bridgey.config.json}"
PIDFILE="/tmp/bridgey-${USER}.pid"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-.}"

# Check if config exists
if [ ! -f "$CONFIG" ]; then
  echo "bridgey: not configured. Run /bridgey:setup to get started."
  exit 0
fi

# Check if bundle exists
if [ ! -f "$PLUGIN_ROOT/dist/watchdog.js" ]; then
  echo "bridgey: dist/watchdog.js not found — daemon will not start. Run 'npm run build' in bridgey plugin directory." >&2
  exit 1
fi

# Start watchdog (idempotent — exits if daemon already running)
node "$PLUGIN_ROOT/dist/watchdog.js" --config "$CONFIG" --pidfile "$PIDFILE"

# Optional: scan tailnet for agents (silent if tailscale not installed)
if command -v tailscale &>/dev/null && [ -f "$PLUGIN_ROOT/dist/scan-cli.js" ]; then
  node "$PLUGIN_ROOT/dist/scan-cli.js" 2>/dev/null || true
fi
