#!/usr/bin/env bash
# bridgey-discord SessionStart — auto-install deps on first run
set -euo pipefail

# The bot app lives in the repo, not the plugin — the plugin is the control surface only
APP_ROOT="${BRIDGEY_DISCORD_APP_ROOT:-${HOME}/projects/markets/bridgey/apps/discord-bot}"

# One-time: install production dependencies if missing
if [ -d "$APP_ROOT" ] && [ ! -d "$APP_ROOT/node_modules/discord.js" ]; then
  echo "bridgey-discord: installing dependencies..."
  npm install --omit=dev --prefix "$APP_ROOT" --silent 2>/dev/null
  echo "bridgey-discord: dependencies installed."
fi
