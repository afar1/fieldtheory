#!/usr/bin/env bash
# ============================================================================
# theories-overnight.sh — Repeated theories passes within a time budget.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAX_HOURS=8
TURNS=3
EMAIL="${FT_THEORIES_EMAIL:-}"
ENGINE="auto"
SKIP_SYNC=false
RATE_LIMIT_WAIT=1800        # 30 minutes
MAX_CONSECUTIVE_FAILURES=3

while [[ $# -gt 0 ]]; do
    case "$1" in
        --hours)      MAX_HOURS="$2"; shift 2 ;;
        --turns)      TURNS="$2"; shift 2 ;;
        --email)      EMAIL="$2"; shift 2 ;;
        --engine)     ENGINE="$2"; shift 2 ;;
        --skip-sync)  SKIP_SYNC=true; shift ;;
        --help|-h)
            cat <<USAGE
Usage: theories-overnight.sh [OPTIONS]

Options:
  --hours N        Max runtime in hours (default: 8)
  --turns N        Turns per analysis session (default: 3)
  --email ADDRESS  Email recipient (required)
  --engine ENGINE  codex, claude, or auto (default: auto — alternates both)
  --skip-sync      Skip bookmark freshness check
USAGE
            exit 0
            ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

if [[ -z "$EMAIL" ]]; then
    echo "Email required. Set FT_THEORIES_EMAIL or pass --email."
    exit 1
fi

START_EPOCH=$(date +%s)
MAX_SECONDS=$((MAX_HOURS * 3600))
LOG_DIR="$HOME/theories/logs"
mkdir -p "$LOG_DIR"
DATE_STAMP=$(date +%Y-%m-%d)
OVERNIGHT_LOG="$LOG_DIR/${DATE_STAMP}-overnight.log"

log() { echo "[overnight] $(date +%H:%M:%S) $*" | tee -a "$OVERNIGHT_LOG"; }

case "$ENGINE" in
    auto) engine_label="codex + claude alternating" ;;
    *) engine_label="$ENGINE" ;;
esac

log "═══════════════════════════════════════════════════════════"
log "Overnight theories run"
log "  Engine: ${engine_label}"
log "  Time window: ${MAX_HOURS}h"
log "  Turns/session: ${TURNS}"
log "  Email: ${EMAIL}"
log "  Rate limit wait: $((RATE_LIMIT_WAIT / 60))m between retries"
log "═══════════════════════════════════════════════════════════"

TYPES=("scan" "adopt" "pattern" "explore")
pass=0
consecutive_failures=0
total_successes=0

while true; do
    elapsed=$(( $(date +%s) - START_EPOCH ))
    if [[ "$elapsed" -ge "$MAX_SECONDS" ]]; then
        log "Time budget exhausted (${MAX_HOURS}h). Stopping."
        break
    fi

    pass=$((pass + 1))

    remaining_min=$(( (MAX_SECONDS - elapsed) / 60 ))
    type_idx=$(( (pass - 1) % ${#TYPES[@]} ))
    analysis_type="${TYPES[$type_idx]}"

    log "───────────────────────────────────────────────────────"
    log "Pass ${pass} — ${analysis_type} (${remaining_min}m remaining)"

    SYNC_FLAG=""
    if [[ "$pass" -gt 1 || "$SKIP_SYNC" == "true" ]]; then
        SYNC_FLAG="--skip-sync"
    fi

    if bash "$SCRIPT_DIR/theories-v2.sh" \
        --type "$analysis_type" \
        --turns "$TURNS" \
        --budget 1 \
        --engine "$ENGINE" \
        --email "$EMAIL" \
        $SYNC_FLAG \
        2>&1 | tee -a "$OVERNIGHT_LOG"; then

        consecutive_failures=0
        total_successes=$((total_successes + 1))
        log "Pass ${pass} complete. (${total_successes} successful so far)"
        sleep 10
    else
        consecutive_failures=$((consecutive_failures + 1))
        log "Pass ${pass} failed. (${consecutive_failures} consecutive failures)"

        if [[ "$consecutive_failures" -ge "$MAX_CONSECUTIVE_FAILURES" ]]; then
            log "Hit ${MAX_CONSECUTIVE_FAILURES} consecutive failures — both engines likely rate-limited."

            # Check if we have time to wait and retry
            elapsed=$(( $(date +%s) - START_EPOCH ))
            remaining=$((MAX_SECONDS - elapsed))
            if [[ "$remaining" -gt "$RATE_LIMIT_WAIT" ]]; then
                log "Waiting $((RATE_LIMIT_WAIT / 60))m for rate limits to recover..."
                sleep "$RATE_LIMIT_WAIT"
                consecutive_failures=0
                log "Resuming after cooldown."
            else
                log "Not enough time remaining to wait. Stopping."
                break
            fi
        else
            sleep 30
        fi
    fi
done

elapsed=$(( $(date +%s) - START_EPOCH ))
log "═══════════════════════════════════════════════════════════"
log "Overnight run complete"
log "  Passes attempted: ${pass}"
log "  Successful: ${total_successes}"
log "  Runtime: $((elapsed / 60))m"
log "  Log: ${OVERNIGHT_LOG}"
log "═══════════════════════════════════════════════════════════"
