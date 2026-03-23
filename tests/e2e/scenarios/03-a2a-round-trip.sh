#!/usr/bin/env bash
# Scenario 03: A2A Round-Trip
# Tests: two daemons, message send via /send, requires claude CLI
# Gated: BRIDGEY_TEST_CLAUDE=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../assertions/common.sh"

header "Scenario 03: A2A Round-Trip"

if [[ "${BRIDGEY_TEST_CLAUDE:-}" != "1" ]]; then
  info "Skipped (requires BRIDGEY_TEST_CLAUDE=1)"
  pass "skipped — set BRIDGEY_TEST_CLAUDE=1 for real claude -p test"
  print_scenario_result "03-a2a-round-trip"
  exit 0
fi

PORT_A=19021
PORT_B=19022
TMPDIR=$(mktemp -d /tmp/bridgey-e2e-03-XXXXXX)
PIDFILE_A="$TMPDIR/daemon-a.pid"
PIDFILE_B="$TMPDIR/daemon-b.pid"
CONFIG_A="$TMPDIR/config-a.json"
CONFIG_B="$TMPDIR/config-b.json"

cat > "$CONFIG_A" <<EOF
{
  "name": "e2e-agent-a",
  "description": "E2E agent A",
  "port": $PORT_A,
  "bind": "localhost",
  "token": "brg_e2e_agenta",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": [{"name": "e2e-agent-b", "url": "http://localhost:$PORT_B", "token": "brg_e2e_agentb"}]
}
EOF

cat > "$CONFIG_B" <<EOF
{
  "name": "e2e-agent-b",
  "description": "E2E agent B",
  "port": $PORT_B,
  "bind": "localhost",
  "token": "brg_e2e_agentb",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": [{"name": "e2e-agent-a", "url": "http://localhost:$PORT_A", "token": "brg_e2e_agenta"}]
}
EOF

cleanup() {
  stop_daemon "$PIDFILE_A"
  stop_daemon "$PIDFILE_B"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ── Start both daemons ───────────────────────────────────────────────────
info "Starting daemon A on port $PORT_A..."
start_daemon "$CONFIG_A" "$PIDFILE_A" "$PORT_A"

info "Starting daemon B on port $PORT_B..."
start_daemon "$CONFIG_B" "$PIDFILE_B" "$PORT_B"

# ── Agent discovery ──────────────────────────────────────────────────────
AGENTS_A=$(curl -sf "http://localhost:${PORT_A}/agents" -H "Authorization: Bearer brg_e2e_agenta")
assert_contains "$AGENTS_A" "e2e-agent-b" "agent A knows agent B"

# ── Send message A → B via /send ─────────────────────────────────────────
info "Sending message from A to B (this invokes claude -p, may take a while)..."
SEND_RESULT=$(curl -sf --max-time 300 -X POST "http://localhost:${PORT_A}/send" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer brg_e2e_agenta' \
  -d '{"agent": "e2e-agent-b", "message": "Reply with exactly: e2e-test-ok"}')

assert_json_exists "$SEND_RESULT" '.response' "got response from agent B"

RESPONSE=$(echo "$SEND_RESULT" | jq -r '.response // empty')
if [[ -n "$RESPONSE" ]]; then
  pass "non-empty response from agent B"
else
  fail "empty response from agent B"
fi

# ── Check audit log ──────────────────────────────────────────────────────
AUDIT="$HOME/.bridgey/audit.jsonl"
if [[ -f "$AUDIT" ]]; then
  if tail -20 "$AUDIT" | grep -q "e2e-agent"; then
    pass "audit log contains e2e entry"
  else
    fail "audit log missing e2e entry"
  fi
else
  info "No audit log found (may be in temp dir)"
fi

# ── Results ──────────────────────────────────────────────────────────────
print_scenario_result "03-a2a-round-trip"
[[ $FAIL_COUNT -eq 0 ]]
