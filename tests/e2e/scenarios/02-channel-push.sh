#!/usr/bin/env bash
# Scenario 02: Channel Push
# Tests: inbound message delivery to channel capture server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../assertions/common.sh"

header "Scenario 02: Channel Push"

PORT=19011
CAPTURE_PORT=19012
TMPDIR=$(mktemp -d /tmp/bridgey-e2e-02-XXXXXX)
PIDFILE="$TMPDIR/daemon.pid"
CONFIG="$TMPDIR/config.json"
CAPTURE_LOG="$TMPDIR/capture.log"

cat > "$CONFIG" <<EOF
{
  "name": "e2e-channel",
  "description": "E2E channel push test",
  "port": $PORT,
  "bind": "localhost",
  "token": "brg_e2e_channel",
  "workspace": "/tmp",
  "max_turns": 1,
  "agents": []
}
EOF

# Simple capture server using node
CAPTURE_SCRIPT="$TMPDIR/capture.js"
cat > "$CAPTURE_SCRIPT" <<'NODEJS'
const http = require('http');
const fs = require('fs');
const messages = [];
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        messages.push(parsed);
        fs.writeFileSync(process.env.CAPTURE_LOG, JSON.stringify(messages, null, 2));
      } catch {}
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{"ok":true}');
    });
  } else if (req.method === 'GET' && req.url === '/messages') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(messages));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(parseInt(process.env.CAPTURE_PORT), '127.0.0.1', () => {
  console.log('capture listening on ' + process.env.CAPTURE_PORT);
});
NODEJS

cleanup() {
  stop_daemon "$PIDFILE"
  # Kill capture server
  if [[ -n "${CAPTURE_PID:-}" ]]; then
    kill "$CAPTURE_PID" 2>/dev/null || true
  fi
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ── Start capture server ─────────────────────────────────────────────────
info "Starting capture server on port $CAPTURE_PORT..."
CAPTURE_LOG="$CAPTURE_LOG" CAPTURE_PORT="$CAPTURE_PORT" node "$CAPTURE_SCRIPT" &
CAPTURE_PID=$!
sleep 0.5

# ── Start daemon ─────────────────────────────────────────────────────────
info "Starting daemon on port $PORT..."
start_daemon "$CONFIG" "$PIDFILE" "$PORT"

# ── Register channel ─────────────────────────────────────────────────────
REG_RESULT=$(curl -sf -X POST "http://localhost:${PORT}/channel/register" \
  -H 'Content-Type: application/json' \
  -d "{\"push_url\": \"http://127.0.0.1:${CAPTURE_PORT}\"}")
assert_json_key "$REG_RESULT" '.ok' 'true' "channel registered"

# ── Send inbound message ─────────────────────────────────────────────────
INBOUND_RESULT=$(curl -sf -X POST "http://localhost:${PORT}/messages/inbound" \
  -H 'Content-Type: application/json' \
  -d '{
    "transport": "discord",
    "chat_id": "discord:12345",
    "sender": "testuser",
    "content": "hello from e2e test",
    "meta": {"guild_id": "999"}
  }')
assert_json_key "$INBOUND_RESULT" '.ok' 'true' "inbound message accepted"

# Wait for push delivery
sleep 0.5

# ── Verify capture server received the message ──────────────────────────
MESSAGES=$(curl -sf "http://127.0.0.1:${CAPTURE_PORT}/messages")
MSG_COUNT=$(echo "$MESSAGES" | jq 'length')
assert_eq "$MSG_COUNT" "1" "capture received 1 message"

FIRST_MSG=$(echo "$MESSAGES" | jq '.[0]')
assert_json_key "$FIRST_MSG" '.content' 'hello from e2e test' "message content correct"
assert_json_key "$FIRST_MSG" '.meta.transport' 'discord' "meta.transport is discord"
assert_json_key "$FIRST_MSG" '.meta.chat_id' 'discord:12345' "meta.chat_id correct"
assert_json_key "$FIRST_MSG" '.meta.sender' 'testuser' "meta.sender correct"
assert_json_key "$FIRST_MSG" '.meta.guild_id' '999' "meta.guild_id passed through"

# ── Verify meta keys have no hyphens ─────────────────────────────────────
META_KEYS=$(echo "$FIRST_MSG" | jq -r '.meta | keys[]')
ALL_VALID=true
while IFS= read -r key; do
  if [[ ! "$key" =~ ^[a-zA-Z0-9_]+$ ]]; then
    fail "meta key '$key' contains invalid characters"
    ALL_VALID=false
  fi
done <<< "$META_KEYS"
[[ "$ALL_VALID" == "true" ]] && pass "all meta keys use underscores only"

# ── Results ──────────────────────────────────────────────────────────────
print_scenario_result "02-channel-push"
[[ $FAIL_COUNT -eq 0 ]]
