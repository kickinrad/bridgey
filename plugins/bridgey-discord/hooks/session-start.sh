#!/usr/bin/env bash
# bridgey-discord SessionStart — auto-install deps on first run
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-.}"

# One-time: install production dependencies if missing
if [ ! -d "$PLUGIN_ROOT/node_modules/discord.js" ]; then
  echo "bridgey-discord: installing dependencies..."
  npm install --omit=dev --prefix "$PLUGIN_ROOT" --silent 2>/dev/null
  echo "bridgey-discord: dependencies installed."
fi
