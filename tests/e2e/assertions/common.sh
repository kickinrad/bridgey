#!/usr/bin/env bash
# Shared assertion helpers for bridgey E2E tests

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Counters ─────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0

# ── Output ───────────────────────────────────────────────────────────────

pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo -e "  ${GREEN}✓${RESET} $*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo -e "  ${RED}✗${RESET} $*"; }
info() { echo -e "  ${CYAN}→${RESET} $*"; }
header() { echo -e "\n${BOLD}${BLUE}━━━ $* ━━━${RESET}"; }

# ── Assertions ───────────────────────────────────────────────────────────

assert_eq() {
  local actual="$1" expected="$2" label="${3:-assert_eq}"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local actual="$1" expected="$2" label="${3:-assert_contains}"
  if [[ "$actual" == *"$expected"* ]]; then
    pass "$label"
  else
    fail "$label (expected to contain '$expected', got '$actual')"
  fi
}

assert_json_key() {
  local json="$1" key="$2" expected="$3" label="${4:-assert_json_key}"
  local actual
  actual=$(echo "$json" | jq -r "$key" 2>/dev/null)
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label ($key: expected '$expected', got '$actual')"
  fi
}

assert_json_exists() {
  local json="$1" key="$2" label="${3:-assert_json_exists}"
  local val
  val=$(echo "$json" | jq -e "$key" 2>/dev/null)
  if [[ $? -eq 0 && "$val" != "null" ]]; then
    pass "$label"
  else
    fail "$label ($key not found or null)"
  fi
}

assert_http_ok() {
  local url="$1" label="${2:-assert_http_ok}"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)
  if [[ "$status" =~ ^2[0-9]{2}$ ]]; then
    pass "$label (HTTP $status)"
  else
    fail "$label (expected 2xx, got HTTP $status)"
  fi
}

assert_http_status() {
  local url="$1" expected="$2" label="${3:-assert_http_status}"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)
  if [[ "$status" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected HTTP $expected, got $status)"
  fi
}

assert_file() {
  local path="$1" label="${2:-assert_file}"
  if [[ -f "$path" ]]; then
    pass "$label"
  else
    fail "$label (file not found: $path)"
  fi
}

assert_no_secret() {
  local text="$1" label="${2:-assert_no_secret}"
  if echo "$text" | grep -qiE '(api.key|secret|token|password|brg_[a-z0-9]+)'; then
    fail "$label (possible secret detected)"
  else
    pass "$label"
  fi
}

# ── Process Management ───────────────────────────────────────────────────

TRACKED_PIDS=()

wait_for_health() {
  local url="$1" timeout="${2:-10}"
  local deadline=$((SECONDS + timeout))
  while [[ $SECONDS -lt $deadline ]]; do
    if curl -sf "$url/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

start_daemon() {
  local config_path="$1" pidfile="$2" port="$3"
  local daemon_script="${REPO_ROOT}/plugins/bridgey/dist/daemon.js"

  node "$daemon_script" start --config "$config_path" --pidfile "$pidfile" > /dev/null 2>&1 &
  disown

  if wait_for_health "http://localhost:${port}" 10; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null)
    TRACKED_PIDS+=("$pid")
    info "Daemon started (pid $pid, port $port)"
    return 0
  else
    fail "Daemon failed to start on port $port"
    return 1
  fi
}

stop_daemon() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    info "Stopped daemon (pid $pid)"
  fi
}

cleanup_pids() {
  for pid in "${TRACKED_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  TRACKED_PIDS=()
}

# ── Run Directory ────────────────────────────────────────────────────────

setup_run_dir() {
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  RUN_DIR="${REPO_ROOT}/tests/e2e/runs/${timestamp}"
  mkdir -p "$RUN_DIR"
  info "Run directory: $RUN_DIR"
}

# ── Summary ──────────────────────────────────────────────────────────────

print_scenario_result() {
  local name="$1"
  if [[ $FAIL_COUNT -eq 0 ]]; then
    echo -e "${GREEN}  ✓ ${name}: ${PASS_COUNT} passed${RESET}"
  else
    echo -e "${RED}  ✗ ${name}: ${PASS_COUNT} passed, ${FAIL_COUNT} failed${RESET}"
  fi
}

# ── Trap ─────────────────────────────────────────────────────────────────

_cleanup_trap() {
  cleanup_pids
}

trap _cleanup_trap EXIT SIGINT SIGTERM
