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
  echo "bridgey: build not found. Run 'npm run build' in the plugin directory."
  exit 0
fi

# Start watchdog (idempotent — exits if daemon already running)
exec node "$PLUGIN_ROOT/dist/watchdog.js" --config "$CONFIG" --pidfile "$PIDFILE"
