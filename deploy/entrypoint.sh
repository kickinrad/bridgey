#!/bin/bash
set -euo pipefail

CONFIG_PATH="/data/bridgey/bridgey.config.json"

# Generate config from environment variables
cat > "$CONFIG_PATH" <<EOF
{
  "name": "${BRIDGEY_NAME}",
  "description": "${BRIDGEY_DESCRIPTION:-Claude Code persona}",
  "port": ${BRIDGEY_PORT:-8092},
  "bind": "0.0.0.0",
  "token": "${BRIDGEY_TOKEN}",
  "workspace": "/workspace",
  "max_turns": ${BRIDGEY_MAX_TURNS:-5},
  "agents": ${BRIDGEY_AGENTS:-[]},
  "trusted_networks": ["100.64.0.0/10", "172.16.0.0/12", "10.0.0.0/8"]
}
EOF

echo "Starting bridgey daemon: ${BRIDGEY_NAME} on port ${BRIDGEY_PORT}"
exec node /app/dist/daemon.js start --config "$CONFIG_PATH"
