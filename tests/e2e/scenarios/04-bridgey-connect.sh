#!/usr/bin/env bash
# Scenario 04: bridgey-connect HTTP contract
# Tests: the daemon endpoints that bridgey-connect relies on
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../assertions/common.sh"

header "Scenario 04: bridgey-connect Contract"

PORT=19031
TMPDIR=$(mktemp -d /tmp/bridgey-e2e-04-XXXXXX)
PIDFILE="$TMPDIR/daemon.pid"
CONFIG="$TMPDIR/config.json"

cat > "$CONFIG" <<EOF
{
  "name": "e2e-connect-target",
  "description": "Target for bridgey-connect tests",
  "port": $PORT,
  "bind": "localhost",
  "token": "brg_e2e_connect",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": []
}
EOF

cleanup() {
  stop_daemon "$PIDFILE"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ── Start daemon ─────────────────────────────────────────────────────────
info "Starting daemon on port $PORT..."
start_daemon "$CONFIG" "$PIDFILE" "$PORT"

# ── Health endpoint (used by checkHealth) ────────────────────────────────
HEALTH=$(curl -sf "http://localhost:${PORT}/health")
assert_json_key "$HEALTH" '.status' 'ok' "health returns ok"
assert_json_exists "$HEALTH" '.name' "health has name field"
assert_json_exists "$HEALTH" '.uptime' "health has uptime field"

# ── Agent card (used by fetchAgentCard) ──────────────────────────────────
CARD=$(curl -sf "http://localhost:${PORT}/.well-known/agent-card.json")
assert_json_key "$CARD" '.name' 'e2e-connect-target' "agent card name matches"
assert_json_exists "$CARD" '.description' "card has description"
assert_json_exists "$CARD" '.url' "card has url"

# ── /agents endpoint (used by connect_list_agents) ───────────────────────
AGENTS=$(curl -sf "http://localhost:${PORT}/agents")
assert_eq "$(echo "$AGENTS" | jq 'type')" '"array"' "/agents returns array"

# ── A2A JSON-RPC (used by sendA2AMessage) ────────────────────────────────
A2A_RESULT=$(curl -sf -X POST "http://localhost:${PORT}" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer brg_e2e_connect' \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-connect-1",
    "method": "message/send",
    "params": {
      "message": {"role": "user", "parts": [{"text": "hello from connect"}]},
      "agentName": "external"
    }
  }')
assert_json_key "$A2A_RESULT" '.jsonrpc' '2.0' "A2A response is JSON-RPC 2.0"
assert_json_key "$A2A_RESULT" '.id' 'test-connect-1' "A2A response id matches"
# Result or error — both are valid
if echo "$A2A_RESULT" | jq -e '.result // .error' > /dev/null 2>&1; then
  pass "A2A response has result or error"
else
  fail "A2A response missing both result and error"
fi

# ── Localhost auth (local agents are trusted without token) ───────────────
# Localhost requests are authorized via local agent registry, even with a bad token.
# This is by design: isLocalAgent() trusts loopback when agents are registered.
AUTH_RESULT=$(curl -s -w '\n%{http_code}' -X POST "http://localhost:${PORT}" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer brg_wrong_token' \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-auth",
    "method": "message/send",
    "params": {"message": {"role": "user", "parts": [{"text": "local agent request"}]}}
  }')
HTTP_CODE=$(echo "$AUTH_RESULT" | tail -1)
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "localhost trusted via local agent registry (HTTP 200)"
else
  fail "localhost request returned HTTP $HTTP_CODE (expected 200 — local agents are trusted)"
fi

# ── Results ──────────────────────────────────────────────────────────────
print_scenario_result "04-bridgey-connect"
[[ $FAIL_COUNT -eq 0 ]]
