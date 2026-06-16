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

# Start watchdog DETACHED. The SessionStart hook has a 10s timeout; running the
# watchdog in the foreground means Claude Code kills the hook's process group at
# the 10s mark, reaping the long-running daemon (clean "Shutting down..." ~10s
# after every start). setsid escapes the hook's process group; nohup + background
# + closing stdin fully detach it so the daemon persists across sessions as
# intended. Idempotent: skip if a daemon is already alive per the pidfile.
if [ ! -f "$PIDFILE" ] || ! kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  setsid nohup node "$PLUGIN_ROOT/dist/watchdog.js" --config "$CONFIG" --pidfile "$PIDFILE" \
    >>"${HOME}/.bridgey/watchdog.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
fi

# Optional: scan tailnet for agents (silent if tailscale not installed)
if command -v tailscale &>/dev/null && [ -f "$PLUGIN_ROOT/dist/scan-cli.js" ]; then
  node "$PLUGIN_ROOT/dist/scan-cli.js" 2>/dev/null || true
fi
