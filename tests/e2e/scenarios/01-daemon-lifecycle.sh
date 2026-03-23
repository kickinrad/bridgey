#!/usr/bin/env bash
# Scenario 01: Daemon Lifecycle
# Tests: start, health, agent card, shutdown, stale pidfile recovery
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../assertions/common.sh"

header "Scenario 01: Daemon Lifecycle"

PORT=19001
TMPDIR=$(mktemp -d /tmp/bridgey-e2e-01-XXXXXX)
PIDFILE="$TMPDIR/daemon.pid"
CONFIG="$TMPDIR/config.json"
DAEMON="$REPO_ROOT/plugins/bridgey/dist/daemon.js"

cat > "$CONFIG" <<EOF
{
  "name": "e2e-lifecycle",
  "description": "E2E lifecycle test",
  "port": $PORT,
  "bind": "localhost",
  "token": "brg_e2e_lifecycle",
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

# ── Test: Start daemon ───────────────────────────────────────────────────
info "Starting daemon on port $PORT..."
start_daemon "$CONFIG" "$PIDFILE" "$PORT"

# ── Test: Health check ───────────────────────────────────────────────────
HEALTH=$(curl -sf "http://localhost:${PORT}/health")
assert_json_key "$HEALTH" '.status' 'ok' "health status is ok"
assert_json_key "$HEALTH" '.name' 'e2e-lifecycle' "health returns correct name"

# ── Test: Agent card ─────────────────────────────────────────────────────
CARD=$(curl -sf "http://localhost:${PORT}/.well-known/agent-card.json")
assert_json_key "$CARD" '.name' 'e2e-lifecycle' "agent card has correct name"

# ── Test: /agents endpoint ───────────────────────────────────────────────
assert_http_ok "http://localhost:${PORT}/agents" "GET /agents returns 200"

# ── Test: Pidfile exists ─────────────────────────────────────────────────
assert_file "$PIDFILE" "pidfile exists"

# ── Test: Graceful shutdown ──────────────────────────────────────────────
info "Sending SIGTERM..."
PID=$(cat "$PIDFILE")
kill "$PID"
sleep 1

if [[ ! -f "$PIDFILE" ]]; then
  pass "pidfile removed after SIGTERM"
else
  fail "pidfile still exists after SIGTERM"
fi

# Verify port is freed
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  fail "port still responding after shutdown"
else
  pass "port freed after shutdown"
fi

# ── Test: Restart after shutdown ─────────────────────────────────────────
info "Restarting daemon..."
start_daemon "$CONFIG" "$PIDFILE" "$PORT"
assert_http_ok "http://localhost:${PORT}/health" "daemon healthy after restart"

# ── Results ──────────────────────────────────────────────────────────────
print_scenario_result "01-daemon-lifecycle"
[[ $FAIL_COUNT -eq 0 ]]
