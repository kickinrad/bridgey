#!/bin/bash
set -euo pipefail

# bridgey-deploy entrypoint
# Generates a complete bridgey daemon config from environment variables (when one
# isn't already persisted), registers the optional MCP fleet, then starts the daemon.

BRIDGEY_DIR="${BRIDGEY_DIR:-/data/bridgey}"
BRIDGEY_CONFIG="${BRIDGEY_DIR}/bridgey.config.json"
# BRIDGEY_NAME is the canonical var the deploy stack provides; BRIDGEY_AGENT_NAME
# is kept as a back-compat fallback for older compose files.
BRIDGEY_NAME="${BRIDGEY_NAME:-${BRIDGEY_AGENT_NAME:-agent}}"
BRIDGEY_DESCRIPTION="${BRIDGEY_DESCRIPTION:-}"
BRIDGEY_BIND="${BRIDGEY_BIND:-0.0.0.0}"
BRIDGEY_PORT="${BRIDGEY_PORT:-3000}"
BRIDGEY_WORKSPACE="${BRIDGEY_WORKSPACE:-/workspace}"
BRIDGEY_MAX_TURNS="${BRIDGEY_MAX_TURNS:-5}"
BRIDGEY_AGENTS="${BRIDGEY_AGENTS:-[]}"

mkdir -p "${BRIDGEY_DIR}"

# Generate config from env vars if it doesn't exist or BRIDGEY_FORCE_CONFIG is set.
# Emits the COMPLETE BridgeyConfig schema (name, description, port, bind, token,
# workspace, max_turns, agents). An incomplete config crash-loops the daemon —
# it iterates config.agents unconditionally on boot, so a missing `agents` throws
# "config.agents is not iterable". A token is generated when none is provided.
if [ ! -f "${BRIDGEY_CONFIG}" ] || [ "${BRIDGEY_FORCE_CONFIG:-}" = "true" ]; then
  BRIDGEY_TOKEN="${BRIDGEY_TOKEN:-$(node -e "console.log('brg_'+require('crypto').randomBytes(32).toString('hex'))")}"
  cat > "${BRIDGEY_CONFIG}" <<CONF
{
  "name": "${BRIDGEY_NAME}",
  "description": "${BRIDGEY_DESCRIPTION}",
  "bind": "${BRIDGEY_BIND}",
  "port": ${BRIDGEY_PORT},
  "token": "${BRIDGEY_TOKEN}",
  "workspace": "${BRIDGEY_WORKSPACE}",
  "max_turns": ${BRIDGEY_MAX_TURNS},
  "agents": ${BRIDGEY_AGENTS},
  "trusted_networks": ["172.16.0.0/12", "10.0.0.0/8", "100.64.0.0/10"]
}
CONF
  echo "Generated bridgey config at ${BRIDGEY_CONFIG}"
fi

# Register agentgateway MCP fleet endpoint if configured (idempotent — skip if already registered)
if [ -n "${BRIDGEY_AGENTGATEWAY_URL:-}" ]; then
  if ! claude mcp list 2>/dev/null | grep -q '^mcp-fleet'; then
    claude mcp add --transport http --scope user mcp-fleet "$BRIDGEY_AGENTGATEWAY_URL" || \
      echo "[entrypoint] WARN: failed to register mcp-fleet" >&2
  fi
fi

# If a bundled daemon exists, run it as PID 1
if [ -f "/opt/bridgey/daemon.js" ]; then
  exec node /opt/bridgey/daemon.js --config "${BRIDGEY_CONFIG}"
fi

# Fallback: keep container alive for claude exec
echo "No bundled daemon found — running in exec-only mode"
exec sleep infinity
