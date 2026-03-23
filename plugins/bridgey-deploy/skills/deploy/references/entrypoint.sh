#!/bin/bash
set -euo pipefail

# bridgey-deploy entrypoint
# Generates bridgey config from environment variables, then starts the daemon

BRIDGEY_DIR="${BRIDGEY_DIR:-/data/bridgey}"
BRIDGEY_CONFIG="${BRIDGEY_DIR}/bridgey.config.json"
BRIDGEY_BIND="${BRIDGEY_BIND:-0.0.0.0}"
BRIDGEY_PORT="${BRIDGEY_PORT:-3000}"
BRIDGEY_AGENT_NAME="${BRIDGEY_AGENT_NAME:-agent}"

mkdir -p "${BRIDGEY_DIR}"

# Generate config from env vars if it doesn't exist or BRIDGEY_FORCE_CONFIG is set
if [ ! -f "${BRIDGEY_CONFIG}" ] || [ "${BRIDGEY_FORCE_CONFIG:-}" = "true" ]; then
  cat > "${BRIDGEY_CONFIG}" <<CONF
{
  "name": "${BRIDGEY_AGENT_NAME}",
  "bind": "${BRIDGEY_BIND}",
  "port": ${BRIDGEY_PORT},
  "dataDir": "${BRIDGEY_DIR}",
  "trusted_networks": ["172.16.0.0/12", "10.0.0.0/8", "100.64.0.0/10"]
}
CONF
  echo "Generated bridgey config at ${BRIDGEY_CONFIG}"
fi

# If a bundled daemon exists, run it as PID 1
if [ -f "/opt/bridgey/daemon.js" ]; then
  exec node /opt/bridgey/daemon.js --config "${BRIDGEY_CONFIG}"
fi

# Fallback: keep container alive for claude exec
echo "No bundled daemon found — running in exec-only mode"
exec sleep infinity
