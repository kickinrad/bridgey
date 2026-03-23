#!/usr/bin/env bash
set -euo pipefail

# ── bridgey E2E Test Runner ──────────────────────────────────────────────
# Usage: ./run-e2e.sh [--scenario N[,N...]] [--all] [--dry-run]
# Requires: BRIDGEY_TEST_E2E=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Gate check ───────────────────────────────────────────────────────────
if [[ "${BRIDGEY_TEST_E2E:-}" != "1" ]]; then
  echo -e "${DIM}Skipping E2E tests (set BRIDGEY_TEST_E2E=1 to run)${RESET}"
  exit 0
fi

# ── Argument parsing ─────────────────────────────────────────────────────
SCENARIOS=""
RUN_ALL=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)  SCENARIOS="$2"; shift 2 ;;
    --all)       RUN_ALL=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--scenario N[,N...]] [--all] [--dry-run]"
      echo "  --scenario 1,3   Run specific scenarios"
      echo "  --all             Run all scenarios"
      echo "  --dry-run         Show what would run"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${RESET}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SCENARIOS" && "$RUN_ALL" != "true" ]]; then
  RUN_ALL=true
fi

# ── Prerequisites ────────────────────────────────────────────────────────
check_prereqs() {
  local missing=()

  ! command -v node &>/dev/null && missing+=("node")
  ! command -v jq &>/dev/null && missing+=("jq")
  ! command -v curl &>/dev/null && missing+=("curl")
  [[ ! -f "$REPO_ROOT/plugins/bridgey/dist/daemon.js" ]] && missing+=("daemon build (run: npm run build)")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo -e "${RED}Missing prerequisites:${RESET}"
    for m in "${missing[@]}"; do
      echo -e "  ${RED}✗ ${m}${RESET}"
    done
    exit 1
  fi
}

check_prereqs

# ── Discover scenarios ───────────────────────────────────────────────────
SCENARIO_DIR="$SCRIPT_DIR/scenarios"
declare -a SCENARIO_FILES=()

if [[ "$RUN_ALL" == "true" ]]; then
  for f in "$SCENARIO_DIR"/*.sh; do
    [[ -f "$f" ]] && SCENARIO_FILES+=("$f")
  done
else
  IFS=',' read -ra IDS <<< "$SCENARIOS"
  for id in "${IDS[@]}"; do
    padded=$(printf "%02d" "$id")
    found=false
    for f in "$SCENARIO_DIR"/${padded}-*.sh; do
      if [[ -f "$f" ]]; then
        SCENARIO_FILES+=("$f")
        found=true
      fi
    done
    if [[ "$found" == "false" ]]; then
      echo -e "${RED}Scenario $padded not found${RESET}" >&2
      exit 1
    fi
  done
fi

if [[ ${#SCENARIO_FILES[@]} -eq 0 ]]; then
  echo -e "${RED}No scenarios found${RESET}"
  exit 1
fi

# ── Run directory ────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$SCRIPT_DIR/runs/$TIMESTAMP"
mkdir -p "$RUN_DIR"

# ── Banner ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${BLUE}║          bridgey E2E Test Runner                ║${RESET}"
echo -e "${BOLD}${BLUE}╠══════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}${BLUE}║${RESET} Scenarios: ${#SCENARIO_FILES[@]}                                    ${BOLD}${BLUE}║${RESET}"
echo -e "${BOLD}${BLUE}║${RESET} Run dir:   ${DIM}${RUN_DIR}${RESET}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}Dry run — would execute:${RESET}"
  for f in "${SCENARIO_FILES[@]}"; do
    echo -e "  ${CYAN}→${RESET} $(basename "$f")"
  done
  exit 0
fi

# ── Execute scenarios ────────────────────────────────────────────────────
TOTAL_PASS=0
TOTAL_FAIL=0
RESULTS=()

for scenario_file in "${SCENARIO_FILES[@]}"; do
  scenario_name="$(basename "$scenario_file" .sh)"
  scenario_dir="$RUN_DIR/$scenario_name"
  mkdir -p "$scenario_dir"

  echo -e "${BOLD}${CYAN}▸ Running: ${scenario_name}${RESET}"
  start_time=$SECONDS

  # Run the scenario, capture output
  set +e
  bash "$scenario_file" > "$scenario_dir/stdout.log" 2> "$scenario_dir/stderr.log"
  exit_code=$?
  set -e

  duration=$((SECONDS - start_time))

  # Cat stdout to terminal for visibility
  cat "$scenario_dir/stdout.log"

  if [[ $exit_code -eq 0 ]]; then
    echo -e "  ${GREEN}✓ ${scenario_name} passed${RESET} ${DIM}(${duration}s)${RESET}"
    TOTAL_PASS=$((TOTAL_PASS + 1))
    RESULTS+=("${GREEN}✓ ${scenario_name} (${duration}s)${RESET}")
  else
    echo -e "  ${RED}✗ ${scenario_name} failed (exit $exit_code)${RESET} ${DIM}(${duration}s)${RESET}"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    RESULTS+=("${RED}✗ ${scenario_name} (${duration}s)${RESET}")
    # Show stderr on failure
    if [[ -s "$scenario_dir/stderr.log" ]]; then
      echo -e "  ${DIM}stderr:${RESET}"
      head -20 "$scenario_dir/stderr.log" | sed 's/^/    /'
    fi
  fi
  echo ""
done

# ── Summary ──────────────────────────────────────────────────────────────
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${BLUE}║                    SUMMARY                      ║${RESET}"
echo -e "${BOLD}${BLUE}╠══════════════════════════════════════════════════╣${RESET}"
for r in "${RESULTS[@]}"; do
  echo -e "${BOLD}${BLUE}║${RESET} $r"
done
echo -e "${BOLD}${BLUE}╠══════════════════════════════════════════════════╣${RESET}"

if [[ $TOTAL_FAIL -eq 0 ]]; then
  echo -e "${BOLD}${BLUE}║${RESET} ${GREEN}${BOLD}All ${TOTAL_PASS} scenarios passed ✓${RESET}"
else
  echo -e "${BOLD}${BLUE}║${RESET} ${RED}${BOLD}${TOTAL_FAIL} failed${RESET}, ${GREEN}${TOTAL_PASS} passed${RESET}"
fi
echo -e "${BOLD}${BLUE}║${RESET} Results: ${DIM}${RUN_DIR}${RESET}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════╝${RESET}"

[[ $TOTAL_FAIL -gt 0 ]] && exit 1
exit 0
