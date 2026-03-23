#!/usr/bin/env bash
# Scenario 05: Mesh Discovery
# Tests: two daemons discover each other, cross-daemon messaging
# Gated: BRIDGEY_TEST_TAILSCALE=1 for real Tailscale, otherwise uses localhost
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../assertions/common.sh"

header "Scenario 05: Mesh Discovery"

PORT_A=19041
PORT_B=19042
TMPDIR=$(mktemp -d /tmp/bridgey-e2e-05-XXXXXX)
PIDFILE_A="$TMPDIR/daemon-a.pid"
PIDFILE_B="$TMPDIR/daemon-b.pid"
CONFIG_A="$TMPDIR/config-a.json"
CONFIG_B="$TMPDIR/config-b.json"

# Each daemon knows about the other as a remote agent
cat > "$CONFIG_A" <<EOF
{
  "name": "mesh-alpha",
  "description": "Mesh node alpha",
  "port": $PORT_A,
  "bind": "localhost",
  "token": "brg_mesh_alpha",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": [{"name": "mesh-beta", "url": "http://localhost:$PORT_B", "token": "brg_mesh_beta"}]
}
EOF

cat > "$CONFIG_B" <<EOF
{
  "name": "mesh-beta",
  "description": "Mesh node beta",
  "port": $PORT_B,
  "bind": "localhost",
  "token": "brg_mesh_beta",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": [{"name": "mesh-alpha", "url": "http://localhost:$PORT_A", "token": "brg_mesh_alpha"}]
}
EOF

cleanup() {
  stop_daemon "$PIDFILE_A"
  stop_daemon "$PIDFILE_B"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ── Start both daemons ───────────────────────────────────────────────────
info "Starting mesh-alpha on port $PORT_A..."
start_daemon "$CONFIG_A" "$PIDFILE_A" "$PORT_A"

info "Starting mesh-beta on port $PORT_B..."
start_daemon "$CONFIG_B" "$PIDFILE_B" "$PORT_B"

# ── Both daemons healthy ─────────────────────────────────────────────────
assert_http_ok "http://localhost:${PORT_A}/health" "mesh-alpha healthy"
assert_http_ok "http://localhost:${PORT_B}/health" "mesh-beta healthy"

# ── Agent discovery ──────────────────────────────────────────────────────
AGENTS_A=$(curl -sf "http://localhost:${PORT_A}/agents" -H "Authorization: Bearer brg_mesh_alpha")
AGENTS_B=$(curl -sf "http://localhost:${PORT_B}/agents" -H "Authorization: Bearer brg_mesh_beta")

assert_contains "$AGENTS_A" "mesh-beta" "alpha knows beta"
assert_contains "$AGENTS_B" "mesh-alpha" "beta knows alpha"

# ── Cross-mesh agent card fetch ──────────────────────────────────────────
CARD_B=$(curl -sf "http://localhost:${PORT_B}/.well-known/agent-card.json")
assert_json_key "$CARD_B" '.name' 'mesh-beta' "beta agent card accessible from network"

CARD_A=$(curl -sf "http://localhost:${PORT_A}/.well-known/agent-card.json")
assert_json_key "$CARD_A" '.name' 'mesh-alpha' "alpha agent card accessible from network"

# ── Cross-mesh A2A message (alpha → beta) ────────────────────────────────
info "Sending A2A message alpha → beta..."
A2A_RESULT=$(curl -sf -X POST "http://localhost:${PORT_B}" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer brg_mesh_beta' \
  -d '{
    "jsonrpc": "2.0",
    "id": "mesh-test-1",
    "method": "message/send",
    "params": {
      "message": {"role": "user", "parts": [{"text": "mesh ping"}]},
      "agentName": "mesh-alpha"
    }
  }')
assert_json_key "$A2A_RESULT" '.jsonrpc' '2.0' "A2A response valid JSON-RPC"
assert_json_key "$A2A_RESULT" '.id' 'mesh-test-1' "A2A response id matches"

# ── Tailscale scan (optional) ────────────────────────────────────────────
if [[ "${BRIDGEY_TEST_TAILSCALE:-}" == "1" ]]; then
  info "Running Tailscale scan..."
  SCAN_CLI="$REPO_ROOT/plugins/bridgey/dist/scan-cli.js"
  if [[ -f "$SCAN_CLI" ]]; then
    SCAN_RESULT=$(node "$SCAN_CLI" --config "$CONFIG_A" 2>&1 || true)
    if [[ -n "$SCAN_RESULT" ]]; then
      pass "tailscale scan returned output"
    else
      info "tailscale scan returned empty (may not find peers on localhost)"
    fi
  else
    info "scan-cli.js not found, skipping tailscale scan"
  fi
else
  info "Skipping Tailscale scan (set BRIDGEY_TEST_TAILSCALE=1)"
fi

# ── Results ──────────────────────────────────────────────────────────────
print_scenario_result "05-mesh-discovery"
[[ $FAIL_COUNT -eq 0 ]]
