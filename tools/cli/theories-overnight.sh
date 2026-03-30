#!/usr/bin/env bash
# ============================================================================
# theories-overnight.sh — Run theories-v2 in repeated passes overnight.
#
# Each pass runs all 4 analysis types with fresh bookmark samples.
# Stops after N passes or when the time budget runs out.
#
# Usage:
#   ./theories-overnight.sh                    # default: 6 passes, 6 hours
#   ./theories-overnight.sh --passes 10        # more passes
#   ./theories-overnight.sh --hours 4          # shorter window
#   ./theories-overnight.sh --turns 3          # fewer turns per session
#
# Each pass sends its own email, so you wake up to multiple findings.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASSES=6
MAX_HOURS=6
TURNS=3
EMAIL="${FT_THEORIES_EMAIL:-}"
SKIP_SYNC=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --passes)     PASSES="$2"; shift 2 ;;
        --hours)      MAX_HOURS="$2"; shift 2 ;;
        --turns)      TURNS="$2"; shift 2 ;;
        --email)      EMAIL="$2"; shift 2 ;;
        --skip-sync)  SKIP_SYNC=true; shift ;;
        --help|-h)
            cat <<USAGE
Usage: theories-overnight.sh [OPTIONS]

Options:
  --passes N       Number of analysis passes (default: 6)
  --hours N        Max runtime in hours (default: 6)
  --turns N        Turns per session (default: 3)
  --email ADDRESS  Email recipient
  --skip-sync      Skip bookmark freshness check
USAGE
            exit 0
            ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

if [[ -z "$EMAIL" ]]; then
    echo "Set FT_THEORIES_EMAIL or pass --email. Exiting."
    exit 1
fi

START_EPOCH=$(date +%s)
MAX_SECONDS=$((MAX_HOURS * 3600))
LOG_DIR="$HOME/theories/logs"
mkdir -p "$LOG_DIR"
OVERNIGHT_LOG="$LOG_DIR/$(date +%Y-%m-%d)-overnight.log"

log() { echo "[overnight] $(date +%H:%M:%S) $*" | tee -a "$OVERNIGHT_LOG"; }

log "Starting overnight run: ${PASSES} passes, ${MAX_HOURS}h budget, ${TURNS} turns/session"
log "Email: ${EMAIL}"

# Analysis types to cycle through — each pass picks one
TYPES=("scan" "adopt" "pattern" "explore")

for pass in $(seq 1 "$PASSES"); do
    elapsed=$(( $(date +%s) - START_EPOCH ))
    if [[ "$elapsed" -ge "$MAX_SECONDS" ]]; then
        log "Time budget exhausted after $((elapsed / 3600))h. Stopping."
        break
    fi

    remaining_hours=$(( (MAX_SECONDS - elapsed) / 3600 ))
    type_idx=$(( (pass - 1) % ${#TYPES[@]} ))
    analysis_type="${TYPES[$type_idx]}"

    log "Pass ${pass}/${PASSES} — type: ${analysis_type} (${remaining_hours}h remaining)"

    SYNC_FLAG=""
    # Only sync on the first pass
    if [[ "$pass" -gt 1 || "$SKIP_SYNC" == "true" ]]; then
        SYNC_FLAG="--skip-sync"
    fi

    bash "$SCRIPT_DIR/theories-v2.sh" \
        --type "$analysis_type" \
        --turns "$TURNS" \
        --budget 1 \
        --email "$EMAIL" \
        $SYNC_FLAG \
        2>&1 | tee -a "$OVERNIGHT_LOG" || {
        log "Pass ${pass} failed — continuing"
    }

    log "Pass ${pass} complete."

    # Brief pause between passes to avoid hammering the API
    if [[ "$pass" -lt "$PASSES" ]]; then
        sleep 10
    fi
done

elapsed=$(( $(date +%s) - START_EPOCH ))
log "Overnight run complete. ${PASSES} passes in $((elapsed / 60))m."
log "Log: ${OVERNIGHT_LOG}"
