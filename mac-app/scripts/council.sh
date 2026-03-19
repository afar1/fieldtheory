#!/usr/bin/env bash
# ============================================================================
# council.sh — Model Council Orchestrator
#
# Runs an open-ended structured debate between Claude Code (Opus 4.6) and
# Codex (GPT-5.3) using their non-interactive CLI modes. Models debate until
# they converge on a plan, request human input, or hit safety limits.
#
# Usage:
#   ./council.sh "What's the best architecture for a real-time SMS bot?"
#   ./council.sh --repo ./my-project "Review this codebase and propose improvements"
#   ./council.sh --max-turns 20 "Debate: monorepo vs polyrepo"
#   ./council.sh --supervised "How should we refactor the auth layer?"
#
# Requirements:
#   - claude CLI authenticated (Max plan)
#   - codex CLI authenticated (Pro plan)
# ============================================================================

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
MAX_TURNS=20
REPO_PATH=""
TOPIC=""
TRANSCRIPT_DIR="$HOME/council-transcripts"
MATCHUP="opus-vs-codex"
CLAUDE_MODEL=""
CODEX_MODEL=""
SUPERVISED=false
CALL_TIMEOUT=300  # seconds per model call
JSON_EVENTS=false
OPUS_VS_OPUS=false
TURN_HEARTBEAT_INTERVAL="${COUNCIL_TURN_HEARTBEAT_INTERVAL:-8}"
TURN_EMPTY_RETRY_LIMIT="${COUNCIL_TURN_EMPTY_RETRY_LIMIT:-1}"
STATE_FILE_PATH=""
RESUME_STATE_PATH=""
HUMAN_INPUT=""
HUMAN_INPUT_FILE=""
RESUMING=false
PAUSE_EXIT_CODE=42
START_SIDE="a"

# ── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
BLUE='\033[1;34m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
MAGENTA='\033[1;35m'
CYAN='\033[1;36m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ─────────────────────────────────────────────────────────────────
die() { echo -e "${RED}Error: $1${RESET}" >&2; exit 1; }

# ── JSON event streaming ───────────────────────────────────────────────────
emit_event() {
    [[ "$JSON_EVENTS" == "true" ]] || return 0
    local type="$1"; shift
    python3 -c "
import json, sys
d = {'type': sys.argv[1]}
i = 2
while i < len(sys.argv) - 1:
    d[sys.argv[i]] = sys.argv[i+1]
    i += 2
print(json.dumps(d), flush=True)
" "$type" "$@"
}

# Suppress terminal decoration in JSON mode
term_echo() { [[ "$JSON_EVENTS" != "true" ]] && echo -e "$@" || true; }

# ── Parse Args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --max-turns)     MAX_TURNS="$2"; shift 2 ;;
        --rounds)
            echo -e "${YELLOW}Warning: --rounds is deprecated, use --max-turns instead${RESET}" >&2
            MAX_TURNS="$2"; shift 2 ;;
        --matchup)       MATCHUP="$2"; shift 2 ;;
        --repo)          REPO_PATH="$2"; shift 2 ;;
        --model-claude)  CLAUDE_MODEL="$2"; shift 2 ;;
        --model-codex)   CODEX_MODEL="$2"; shift 2 ;;
        --supervised)    SUPERVISED=true; shift ;;
        --interactive|-i)
            SUPERVISED=true; shift ;;
        --timeout)       CALL_TIMEOUT="$2"; shift 2 ;;
        --json-events)   JSON_EVENTS=true; shift ;;
        --transcript-dir) TRANSCRIPT_DIR="$2"; shift 2 ;;
        --state-file)    STATE_FILE_PATH="$2"; shift 2 ;;
        --resume-state)  RESUME_STATE_PATH="$2"; RESUMING=true; shift 2 ;;
        --human-input)   HUMAN_INPUT="$2"; shift 2 ;;
        --human-input-file) HUMAN_INPUT_FILE="$2"; shift 2 ;;
        --start-side)    START_SIDE="$2"; shift 2 ;;
        --opus-vs-opus)  OPUS_VS_OPUS=true; shift ;;
        --help|-h)
            echo "Usage: council.sh [OPTIONS] \"Your topic or question\""
            echo ""
            echo "Options:"
            echo "  --max-turns N     Safety ceiling for debate turns (default: 20)"
            echo "  --matchup NAME    Debate matchup (default: opus-vs-codex)"
            echo "  --repo PATH       Point both models at a repo for context"
            echo "  --model-claude M  Claude model override for any Claude side"
            echo "  --model-codex M   Codex model override"
            echo "  --supervised      Pause between rounds for human guidance"
            echo "  -i, --interactive Alias for --supervised"
            echo "  --timeout N       Per-call timeout in seconds (default: 300)"
            echo "  --rounds N        Deprecated alias for --max-turns"
            echo "  --json-events     Emit NDJSON events to stdout (for programmatic use)"
            echo "  --transcript-dir  Override transcript output directory"
            echo "  --state-file P    Write resumable debate state to this file when pausing"
            echo "  --resume-state P  Resume a paused debate from a saved state file"
            echo "  --human-input T   Inject this human guidance before resuming"
            echo "  --human-input-file P Read human guidance from a file before resuming"
            echo "  --start-side a|b Choose which side opens a fresh run (default: a)"
            echo "  --opus-vs-opus    Use Claude for both sides (no codex CLI needed)"
            exit 0
            ;;
        --*)  die "Unknown flag: $1" ;;
        *)    TOPIC="$1"; shift ;;
    esac
done

if [[ "$OPUS_VS_OPUS" == "true" && "$MATCHUP" == "opus-vs-codex" ]]; then
    MATCHUP="opus-vs-opus"
fi

if [[ -n "$HUMAN_INPUT" && -n "$HUMAN_INPUT_FILE" ]]; then
    die "Use only one of --human-input or --human-input-file."
fi

if [[ -n "$HUMAN_INPUT_FILE" ]]; then
    [[ -f "$HUMAN_INPUT_FILE" ]] || die "Human input file does not exist: $HUMAN_INPUT_FILE"
    HUMAN_INPUT=$(cat "$HUMAN_INPUT_FILE")
fi

if [[ "$START_SIDE" != "a" && "$START_SIDE" != "b" ]]; then
    die "--start-side must be either 'a' or 'b'."
fi

matchup_needs_claude() {
    local matchup="$1"
    [[ "$matchup" == *opus* || "$matchup" == *sonnet* ]]
}

matchup_needs_codex() {
    local matchup="$1"
    [[ "$matchup" == *codex* ]]
}

side_short_name() {
    local provider="$1"
    local model="$2"
    if [[ "$provider" == "claude" ]]; then
        case "$model" in
            opus) printf 'Opus' ;;
            sonnet) printf 'Sonnet' ;;
            *) printf 'Claude' ;;
        esac
    else
        printf 'Codex'
    fi
}

side_model_label() {
    local provider="$1"
    local model="$2"
    if [[ "$provider" == "claude" ]]; then
        case "$model" in
            opus) printf 'Claude Opus 4.6' ;;
            sonnet) printf 'Claude Sonnet' ;;
            *) printf 'Claude %s' "${model:-default}" ;;
        esac
    else
        if [[ -n "$model" ]]; then
            printf 'Codex %s' "$model"
        else
            printf 'Codex'
        fi
    fi
}

resolve_matchup() {
    case "$MATCHUP" in
        opus-vs-opus)
            PROVIDER_A="claude"; MODEL_A="${CLAUDE_MODEL:-opus}"
            PROVIDER_B="claude"; MODEL_B="${CLAUDE_MODEL:-opus}"
            ;;
        opus-vs-sonnet)
            PROVIDER_A="claude"; MODEL_A="${CLAUDE_MODEL:-opus}"
            PROVIDER_B="claude"; MODEL_B="sonnet"
            ;;
        opus-vs-codex)
            PROVIDER_A="claude"; MODEL_A="${CLAUDE_MODEL:-opus}"
            PROVIDER_B="codex"; MODEL_B="$CODEX_MODEL"
            ;;
        sonnet-vs-opus)
            PROVIDER_A="claude"; MODEL_A="sonnet"
            PROVIDER_B="claude"; MODEL_B="${CLAUDE_MODEL:-opus}"
            ;;
        sonnet-vs-sonnet)
            PROVIDER_A="claude"; MODEL_A="sonnet"
            PROVIDER_B="claude"; MODEL_B="sonnet"
            ;;
        sonnet-vs-codex)
            PROVIDER_A="claude"; MODEL_A="sonnet"
            PROVIDER_B="codex"; MODEL_B="$CODEX_MODEL"
            ;;
        codex-vs-opus)
            PROVIDER_A="codex"; MODEL_A="$CODEX_MODEL"
            PROVIDER_B="claude"; MODEL_B="${CLAUDE_MODEL:-opus}"
            ;;
        codex-vs-sonnet)
            PROVIDER_A="codex"; MODEL_A="$CODEX_MODEL"
            PROVIDER_B="claude"; MODEL_B="sonnet"
            ;;
        codex-vs-codex)
            PROVIDER_A="codex"; MODEL_A="$CODEX_MODEL"
            PROVIDER_B="codex"; MODEL_B="$CODEX_MODEL"
            ;;
        *)
            die "Unsupported matchup: $MATCHUP"
            ;;
    esac

    local base_a base_b
    base_a=$(side_short_name "$PROVIDER_A" "$MODEL_A")
    base_b=$(side_short_name "$PROVIDER_B" "$MODEL_B")
    if [[ "$base_a" == "$base_b" ]]; then
        SPEAKER_A="${base_a} A"
        SPEAKER_B="${base_b} B"
    else
        SPEAKER_A="$base_a"
        SPEAKER_B="$base_b"
    fi

    MODEL_A_LABEL=$(side_model_label "$PROVIDER_A" "$MODEL_A")
    MODEL_B_LABEL=$(side_model_label "$PROVIDER_B" "$MODEL_B")
}

build_side_prompt() {
    local speaker="$1"
    local model_label="$2"
    local provider="$3"
    local opponent="$4"
    local opponent_label="$5"
    local toolchain="Codex"
    if [[ "$provider" == "claude" ]]; then
        toolchain="Claude Code"
    fi

    cat <<EOF
${DEBATE_CONTEXT}

You are ${speaker} (${model_label}), debating with ${opponent} (${opponent_label}). You have your full ${toolchain} toolchain available — use it. Read files, search the codebase, and run commands if it helps you make better arguments.
EOF
}

# Sanitize user input to prevent signal injection
sanitize_input() {
    printf '%s\n' "$1" | sed 's/<<<COUNCIL_/<<< COUNCIL_/g' | sed 's/<<<END_SIGNAL/<<< END_SIGNAL/g'
}

ensure_state_file_path() {
    if [[ -n "$STATE_FILE_PATH" ]]; then
        return
    fi
    if [[ -z "$TRANSCRIPT" ]]; then
        die "Cannot determine state file path without an existing transcript path."
    fi
    STATE_FILE_PATH="${TRANSCRIPT%.md}.state.json"
}

write_resume_state() {
    local pause_reason="$1"
    ensure_state_file_path
    mkdir -p "$(dirname "$STATE_FILE_PATH")"

    local history_path
    history_path=$(mktemp "${TMPDIR:-/tmp}/council-history.XXXXXX")
    printf '%s' "$HISTORY" > "$history_path"

    STATE_FILE_PATH_ENV="$STATE_FILE_PATH" \
    PAUSE_REASON="$pause_reason" \
    TOPIC="$TOPIC" \
    MATCHUP="$MATCHUP" \
    REPO_PATH="$REPO_PATH" \
    MAX_TURNS="$MAX_TURNS" \
    CLAUDE_MODEL="$CLAUDE_MODEL" \
    CODEX_MODEL="$CODEX_MODEL" \
    TRANSCRIPT="$TRANSCRIPT" \
    CONSENSUS_FILE="$CONSENSUS_FILE" \
    ROUND="$ROUND" \
    FAIL_COUNT_CLAUDE="$FAIL_COUNT_CLAUDE" \
    FAIL_COUNT_CODEX="$FAIL_COUNT_CODEX" \
    CONSECUTIVE_FAIL_CLAUDE="$CONSECUTIVE_FAIL_CLAUDE" \
    CONSECUTIVE_FAIL_CODEX="$CONSECUTIVE_FAIL_CODEX" \
    LOW_CONVERGENCE_STREAK="$LOW_CONVERGENCE_STREAK" \
    TOTAL_INPUT_TOKENS="$TOTAL_INPUT_TOKENS" \
    TOTAL_OUTPUT_TOKENS="$TOTAL_OUTPUT_TOKENS" \
    TOTAL_TOKENS="$TOTAL_TOKENS" \
    TOKEN_USAGE_TURNS="$TOKEN_USAGE_TURNS" \
    python3 - "$history_path" <<'PY'
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

history = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")

def int_or_zero(name: str) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else 0

data = {
    "schema_version": 1,
    "saved_at": datetime.now(timezone.utc).isoformat(),
    "state": "PAUSED",
    "pause_reason": os.environ.get("PAUSE_REASON", ""),
    "topic": os.environ.get("TOPIC", ""),
    "matchup": os.environ.get("MATCHUP", ""),
    "repo_path": os.environ.get("REPO_PATH", ""),
    "max_turns": int_or_zero("MAX_TURNS"),
    "claude_model": os.environ.get("CLAUDE_MODEL", ""),
    "codex_model": os.environ.get("CODEX_MODEL", ""),
    "transcript": os.environ.get("TRANSCRIPT", ""),
    "consensus_file": os.environ.get("CONSENSUS_FILE", ""),
    "state_file_path": os.environ.get("STATE_FILE_PATH_ENV", ""),
    "round": int_or_zero("ROUND"),
    "history": history,
    "fail_count_claude": int_or_zero("FAIL_COUNT_CLAUDE"),
    "fail_count_codex": int_or_zero("FAIL_COUNT_CODEX"),
    "consecutive_fail_claude": int_or_zero("CONSECUTIVE_FAIL_CLAUDE"),
    "consecutive_fail_codex": int_or_zero("CONSECUTIVE_FAIL_CODEX"),
    "low_convergence_streak": int_or_zero("LOW_CONVERGENCE_STREAK"),
    "total_input_tokens": int_or_zero("TOTAL_INPUT_TOKENS"),
    "total_output_tokens": int_or_zero("TOTAL_OUTPUT_TOKENS"),
    "total_tokens": int_or_zero("TOTAL_TOKENS"),
    "token_usage_turns": int_or_zero("TOKEN_USAGE_TURNS"),
}

path = pathlib.Path(os.environ["STATE_FILE_PATH_ENV"])
path.write_text(json.dumps(data, indent=2), encoding="utf-8")
PY

    rm -f "$history_path"
}

load_resume_state() {
    local state_path="$1"
    [[ -f "$state_path" ]] || die "Resume state file does not exist: $state_path"

    eval "$(
        python3 - "$state_path" <<'PY'
import json
import shlex
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
mapping = {
    "TOPIC": data.get("topic", ""),
    "MATCHUP": data.get("matchup", ""),
    "REPO_PATH": data.get("repo_path", ""),
    "MAX_TURNS": data.get("max_turns", 0),
    "CLAUDE_MODEL": data.get("claude_model", ""),
    "CODEX_MODEL": data.get("codex_model", ""),
    "TRANSCRIPT": data.get("transcript", ""),
    "CONSENSUS_FILE": data.get("consensus_file", ""),
    "STATE_FILE_PATH": data.get("state_file_path", "") or sys.argv[1],
    "ROUND": data.get("round", 0),
    "HISTORY": data.get("history", ""),
    "FAIL_COUNT_CLAUDE": data.get("fail_count_claude", 0),
    "FAIL_COUNT_CODEX": data.get("fail_count_codex", 0),
    "CONSECUTIVE_FAIL_CLAUDE": data.get("consecutive_fail_claude", 0),
    "CONSECUTIVE_FAIL_CODEX": data.get("consecutive_fail_codex", 0),
    "LOW_CONVERGENCE_STREAK": data.get("low_convergence_streak", 0),
    "TOTAL_INPUT_TOKENS": data.get("total_input_tokens", 0),
    "TOTAL_OUTPUT_TOKENS": data.get("total_output_tokens", 0),
    "TOTAL_TOKENS": data.get("total_tokens", 0),
    "TOKEN_USAGE_TURNS": data.get("token_usage_turns", 0),
}

for key, value in mapping.items():
    print(f"{key}={shlex.quote(str(value))}")
PY
    )"

    [[ -n "$TRANSCRIPT" ]] || die "Resume state file is missing transcript path."
    if [[ -z "$CONSENSUS_FILE" ]]; then
        CONSENSUS_FILE="${TRANSCRIPT%.md}_consensus.md"
    fi

    RESUME_STATE_PATH="$state_path"
    RESUMING=true
}

# ── Preflight checks ───────────────────────────────────────────────────────
if [[ "$RESUMING" == "true" ]]; then
    load_resume_state "$RESUME_STATE_PATH"
fi

if [[ -z "$TOPIC" ]]; then
    if [[ "$JSON_EVENTS" == "true" ]]; then
        die "No topic provided (required in --json-events mode unless --resume-state is used)."
    fi
    echo -e "${YELLOW}No topic provided. What should the council debate?${RESET}"
    read -r TOPIC
fi

[[ -z "$TOPIC" ]] && die "No topic provided."

SAFE_TOPIC=$(sanitize_input "$TOPIC")

resolve_matchup
if matchup_needs_claude "$MATCHUP"; then
    command -v claude >/dev/null 2>&1 || die "claude CLI not found. Install it and authenticate first."
fi
if matchup_needs_codex "$MATCHUP"; then
    command -v codex >/dev/null 2>&1  || die "codex CLI not found. Install it and authenticate first."
fi

# Check for timeout command
TIMEOUT_CMD=""
if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD="gtimeout"
elif command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD="timeout"
fi

# Resolve repo path
if [[ -n "$REPO_PATH" ]]; then
    [[ -d "$REPO_PATH" ]] || die "Repo path does not exist: $REPO_PATH"
    REPO_PATH=$(cd "$REPO_PATH" && pwd)
fi

# ── Setup ───────────────────────────────────────────────────────────────────
if [[ "$RESUMING" == "true" ]]; then
    TRANSCRIPT_DIR=$(dirname "$TRANSCRIPT")
    mkdir -p "$TRANSCRIPT_DIR"
else
    mkdir -p "$TRANSCRIPT_DIR"
    TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
    SLUG=$(printf '%s' "$TOPIC" | tr '\n' ' ' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-40 | sed 's/-$//')
    TRANSCRIPT="$TRANSCRIPT_DIR/${TIMESTAMP}_${SLUG}.md"
    CONSENSUS_FILE="$TRANSCRIPT_DIR/${TIMESTAMP}_${SLUG}_consensus.md"
fi
ensure_state_file_path

# ── Turn delimiter ──────────────────────────────────────────────────────────
TURN_DELIM="<<<COUNCIL_TURN>>>"

# ── Signal sentinels ────────────────────────────────────────────────────────
SIGNAL_BEGIN="<<<COUNCIL_SIGNAL>>>"
SIGNAL_END="<<<END_SIGNAL>>>"

# ── State ───────────────────────────────────────────────────────────────────
STATE="DEBATING"       # DEBATING | PAUSED | FINALIZING | DONE
ROUND=0
INTERRUPTED=0
FAIL_COUNT_CLAUDE=0
FAIL_COUNT_CODEX=0
CONSECUTIVE_FAIL_CLAUDE=0
CONSECUTIVE_FAIL_CODEX=0
LOW_CONVERGENCE_STREAK=0
NO_PROGRESS_THRESHOLD=5
FAIL_STREAK_THRESHOLD=3
TOTAL_INPUT_TOKENS=0
TOTAL_OUTPUT_TOKENS=0
TOTAL_TOKENS=0
TOKEN_USAGE_TURNS=0

# Last parsed signals
CLAUDE_CONVERGENCE=""
CLAUDE_ACTION=""
CODEX_CONVERGENCE=""
CODEX_ACTION=""
LAST_OUTPUT_A=""
LAST_OUTPUT_B=""
PARSED_INPUT_TOKENS=""
PARSED_OUTPUT_TOKENS=""
PARSED_TOTAL_TOKENS=""

# ── System prompts ──────────────────────────────────────────────────────────
SIGNAL_INSTRUCTIONS="

IMPORTANT: You MUST end every response with a signal block on its own lines. This is how the system detects convergence and manages the debate flow. The signal block must be the VERY LAST thing in your response (no text after it).

Format (use exactly these sentinels):
${SIGNAL_BEGIN}
convergence: high|medium|low
action: continue|pause|finalize
${SIGNAL_END}

- convergence: how close you think both sides are to agreement
  - low: significant disagreements remain
  - medium: mostly aligned but details to work out
  - high: we agree on the key points
- action: what should happen next
  - continue: keep debating
  - pause: we need human input to proceed (only if you genuinely believe the debate cannot progress without it, AND the other model has also indicated this)
  - finalize: we've converged, produce the final plan"

DEBATE_CONTEXT="You are participating in a structured council debate with another state-of-the-art AI model. Your goal is intellectual honesty and reaching the best possible answer together.

Rules:
- Present clear, well-reasoned arguments
- Directly engage with the other model's points — don't just present your own in isolation
- Concede when the other model makes a stronger argument
- Challenge weak reasoning respectfully but firmly
- Build on good ideas from either side
- Be specific and concrete, not vague
- If discussing code or architecture, USE YOUR TOOLS — read files, grep the codebase, explore the repo. Ground your arguments in the actual code, not hypotheticals.
- Keep responses focused — aim for 3-5 paragraphs per turn. Do not be sycophantic.
- When you believe you and the other model have genuinely converged, signal finalize. Don't keep debating for the sake of it.
- If you need human input on something fundamental, note it in your response and consider signaling pause — but only if you've genuinely exhausted what you can debate without it.${SIGNAL_INSTRUCTIONS}"

SYSTEM_PROMPT_A=$(build_side_prompt "$SPEAKER_A" "$MODEL_A_LABEL" "$PROVIDER_A" "$SPEAKER_B" "$MODEL_B_LABEL")
SYSTEM_PROMPT_B=$(build_side_prompt "$SPEAKER_B" "$MODEL_B_LABEL" "$PROVIDER_B" "$SPEAKER_A" "$MODEL_A_LABEL")

PLAN_PROMPT="The debate is complete and both sides have converged. Produce a FINAL PLAN as a self-contained, copy-pasteable prompt that a human can give to another AI coding assistant to execute the work.

The plan must include:
1. **Context summary**: What was debated and why
2. **Decisions made**: Every design choice with rationale
3. **Specific files to change**: Paths and what changes in each
4. **Implementation steps**: Ordered, concrete, actionable
5. **Open items**: Anything the human should decide before or during execution

Be specific and practical. This is the deliverable — it should be immediately actionable."

CONSENSUS_PROMPT="The debate is complete. Produce a FINAL CONCLUSION for the original user in markdown.

Do not force false agreement. Extract the strongest useful ideas from both sides, reconcile them where possible, and clearly label any unresolved tradeoffs.

Requirements:
1. Start with a concise title.
2. Include a short summary of the best overall conclusion.
3. Include a bullet list of the strongest ideas or decisions worth carrying forward.
4. Include a bullet list of unresolved questions or tradeoffs that still need human judgment.
5. End with a short recommended next step for the original session.

Write it as something that can be pasted directly back into the original AI session."

# ── Transcript header ───────────────────────────────────────────────────────
if [[ "$RESUMING" != "true" ]]; then
cat > "$TRANSCRIPT" << EOF
# Council Debate
**Topic**: $TOPIC
**Date**: $(date "+%B %d, %Y at %I:%M %p")
**Mode**: Open-ended (max $MAX_TURNS turns)
**Matchup**: $MATCHUP
**Models**: $SPEAKER_A vs $SPEAKER_B
$(if [[ -n "$REPO_PATH" ]]; then echo "**Repo**: $REPO_PATH"; fi)

---

EOF
fi

# ── Interrupt handling ──────────────────────────────────────────────────────
handle_interrupt() {
    if [[ "$STATE" == "FINALIZING" ]]; then
        if [[ "$INTERRUPTED" -ge 1 ]]; then
            term_echo "\n${RED}${BOLD}Hard abort. Saving partial transcript.${RESET}"
            printf '%s\n' "" "---" "*[HARD ABORT by human during finalization]*" >> "$TRANSCRIPT"
            exit 1
        fi
        INTERRUPTED=1
        term_echo "\n${YELLOW}Finishing current call, then stopping...${RESET}"
    else
        INTERRUPTED=1
        term_echo "\n${YELLOW}Interrupted — will pause after current turn.${RESET}"
    fi
}
trap handle_interrupt INT

# ── Helper: filter terminal output for readability ───────────────────────
# Shows compact one-liners for thinking/exec, strips the duplicate final
# response that codex prints after "tokens used".
# Full raw output still goes to capture file for history.
filter_terminal_output() {
    awk -v dim="\033[2m" -v reset="\033[0m" '
    # Codex "thinking" block — show the summary line only
    /^thinking$/ { in_thinking=1; next }
    in_thinking && /^\*\*.*\*\*$/ {
        gsub(/^\*\*/, "", $0); gsub(/\*\*$/, "", $0)
        printf "%s  %s%s\n", dim, $0, reset
        in_thinking=0
        next
    }
    in_thinking && /^$/ { in_thinking=0; next }
    in_thinking { next }

    # Codex "exec" block — show truncated command, skip results
    /^exec$/ { in_exec=1; next }
    in_exec && !got_cmd && /\// {
        cmd = $0
        if (length(cmd) > 80) cmd = substr(cmd, 1, 77) "..."
        printf "%s  > %s%s\n", dim, cmd, reset
        got_cmd=1
        next
    }
    in_exec && /^$/ { in_exec=0; got_cmd=0; next }
    in_exec { next }

    # "tokens used" marks the start of codex re-printing its final answer — skip the rest
    /^tokens used$/ { in_dup=1; next }
    in_dup { next }

    # Everything else passes through
    { print; fflush() }
    '
}

# ── Helper: stream a command to terminal while capturing to a file ──────────
stream_and_capture() {
    local capture_file="$1"
    shift
    local -a timeout_prefix=()
    if [[ -n "$TIMEOUT_CMD" && "$CALL_TIMEOUT" -gt 0 ]]; then
        timeout_prefix=("$TIMEOUT_CMD" "$CALL_TIMEOUT")
    fi

    if [[ "$JSON_EVENTS" == "true" ]]; then
        # JSON mode: emit turn_chunk events instead of terminal output
        > "$capture_file"
        local stderr_reader_pid stderr_path heartbeat_pid
        stderr_path=$(mktemp "${TMPDIR:-/tmp}/council-stderr.XXXXXX")
        rm -f "$stderr_path"
        mkfifo "$stderr_path"
        while IFS= read -r line; do
            [[ -n "$line" ]] && emit_event "stderr" "speaker" "$CURRENT_SPEAKER" "content" "$line"
        done < "$stderr_path" &
        stderr_reader_pid=$!
        (
            local elapsed=0
            while true; do
                sleep 1 || exit 0
                elapsed=$((elapsed + 1))
                if (( elapsed % TURN_HEARTBEAT_INTERVAL != 0 )); then
                    continue
                fi
                if [[ -s "$capture_file" ]]; then
                    emit_turn_status "streaming" "Process is still active. Visible output started ${elapsed}s into this attempt."
                else
                    emit_turn_status "waiting" "Process is still active and working, but has not produced visible output yet (${elapsed}s)."
                fi
            done
        ) &
        heartbeat_pid=$!
        local in_signal_block=0
        ${timeout_prefix[@]+"${timeout_prefix[@]}"} "$@" 2> "$stderr_path" | while IFS= read -r line; do
            printf '%s\n' "$line" >> "$capture_file"
            if [[ "$line" == "$SIGNAL_BEGIN" ]]; then
                in_signal_block=1
                continue
            fi
            if [[ "$in_signal_block" -eq 1 ]]; then
                if [[ "$line" == "$SIGNAL_END" ]]; then
                    in_signal_block=0
                fi
                continue
            fi
            emit_event "turn_chunk" "speaker" "$CURRENT_SPEAKER" "content" "$line"
        done
        local exit_code=${PIPESTATUS[0]}
        kill "$heartbeat_pid" 2>/dev/null || true
        wait "$stderr_reader_pid" 2>/dev/null || true
        rm -f "$stderr_path"
        if [[ "$exit_code" -ne 0 ]]; then
            if [[ "$exit_code" -eq 124 ]]; then
                emit_event "error" "speaker" "$CURRENT_SPEAKER" "message" "Timed out after ${CALL_TIMEOUT}s"
                echo "[Timed out after ${CALL_TIMEOUT}s]" > "$capture_file"
            else
                emit_event "error" "speaker" "$CURRENT_SPEAKER" "message" "Command failed"
                echo "[Failed to respond this turn]" > "$capture_file"
            fi
            return 1
        fi
    else
        # Terminal mode: full output via tee with filtered display
        # Stderr goes to terminal (via fd 3) but stays out of capture.
        local exit_code=0
        set +e
        { ${timeout_prefix[@]+"${timeout_prefix[@]}"} "$@" 2>&3 | tee "$capture_file" | filter_terminal_output; } 3>&2
        exit_code=${PIPESTATUS[0]}
        set -e
        if [[ "$exit_code" -ne 0 ]]; then
            if [[ "$exit_code" -eq 124 ]]; then
                echo -e "${RED}  Call timed out after ${CALL_TIMEOUT}s${RESET}" >&2
                echo "[Timed out after ${CALL_TIMEOUT}s]" > "$capture_file"
            else
                echo -e "${RED}  Command failed${RESET}" >&2
                echo "[Failed to respond this turn]" > "$capture_file"
            fi
            return 1
        fi
    fi
}

call_provider() {
    local provider="$1"
    local model="$2"
    local system_prompt="$3"
    local prompt="$4"
    local capture_file="$5"
    local -a cmd=()

    if [[ "$provider" == "claude" ]]; then
        cmd=(env -u CLAUDECODE claude -p --verbose --model "${model:-opus}" --append-system-prompt "$system_prompt")
        cmd+=("$prompt")
    else
        cmd=(codex exec --full-auto --skip-git-repo-check)
        if [[ -n "$model" ]]; then
            cmd+=(-m "$model")
        fi
        cmd+=("${system_prompt}

${prompt}")
    fi

    if [[ -n "$REPO_PATH" ]]; then
        (cd "$REPO_PATH" && stream_and_capture "$capture_file" "${cmd[@]}") || return 1
    else
        stream_and_capture "$capture_file" "${cmd[@]}" || return 1
    fi
}

call_speaker_a() {
    local prompt="$1"
    local capture_file="$2"
    call_provider "$PROVIDER_A" "$MODEL_A" "$SYSTEM_PROMPT_A" "$prompt" "$capture_file"
}

call_speaker_b() {
    local prompt="$1"
    local capture_file="$2"
    call_provider "$PROVIDER_B" "$MODEL_B" "$SYSTEM_PROMPT_B" "$prompt" "$capture_file"
}

# ── Helper: print header ──────────────────────────────────────────────────
print_header() {
    local speaker="$1"
    local round="$2"

    if [[ "$speaker" == "$SPEAKER_A" ]]; then
        term_echo "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        term_echo "${BLUE}${BOLD}  ${SPEAKER_A} — Turn $round${RESET}"
        term_echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
    else
        term_echo "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        term_echo "${GREEN}${BOLD}  ${SPEAKER_B} — Turn $round${RESET}"
        term_echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
    fi
}

# ── Helper: write turn to transcript ──────────────────────────────────────
log_to_transcript() {
    local speaker="$1"
    local round="$2"
    local content="$3"
    local usage_summary="${4:-}"

    printf '%s\n\n' "## $speaker — Turn $round" >> "$TRANSCRIPT"
    if [[ -n "$usage_summary" ]]; then
        printf '%s\n\n' "*Tokens*: $usage_summary" >> "$TRANSCRIPT"
    fi
    printf '%s\n\n' "$content" >> "$TRANSCRIPT"
}

# ── Helper: append a turn to history with safe delimiter ──────────────────
append_history() {
    local speaker="$1"
    local round="$2"
    local content="$3"
    if [[ -z "$HISTORY" ]]; then
        HISTORY="${TURN_DELIM}${speaker}|${round}|${content}"
    else
        HISTORY="${HISTORY}
${TURN_DELIM}${speaker}|${round}|${content}"
    fi
}

# ── Helper: format history as readable text for prompts ───────────────────
format_history() {
    local raw="$1"
    printf '%s\n' "$raw" | awk -v delim="$TURN_DELIM" '
    {
        idx = index($0, delim)
        if (idx > 0) {
            rest = substr($0, idx + length(delim))
            split_idx1 = index(rest, "|")
            speaker = substr(rest, 1, split_idx1 - 1)
            rest2 = substr(rest, split_idx1 + 1)
            split_idx2 = index(rest2, "|")
            round = substr(rest2, 1, split_idx2 - 1)
            content = substr(rest2, split_idx2 + 1)
            printf "[%s, turn %s]: %s\n", speaker, round, content
        } else {
            print
        }
    }'
}

# ── Helper: trim to last N turns ──────────────────────────────────────────
MAX_HISTORY_TURNS=8

trim_history() {
    local raw="$1"
    local turn_count
    turn_count=$(printf '%s\n' "$raw" | grep -cF "$TURN_DELIM" || true)
    if [[ "$turn_count" -le "$MAX_HISTORY_TURNS" ]]; then
        format_history "$raw"
        return
    fi
    local skip=$((turn_count - MAX_HISTORY_TURNS))
    printf '%s\n' "$raw" | awk -v delim="$TURN_DELIM" -v skip="$skip" '
    {
        if (index($0, delim) > 0) { block++ }
        if (block > skip) { print }
    }' | {
        local piped
        piped=$(cat)
        format_history "$piped"
    }
}

# ── Helper: parse signal block from model output ─────────────────────────
# Extracts convergence and action from an end-anchored signal block.
# Sets PARSED_CONVERGENCE and PARSED_ACTION. Returns 1 if missing/malformed.
parse_signal() {
    local content="$1"
    PARSED_CONVERGENCE=""
    PARSED_ACTION=""

    # Extract the last signal block (must be end-anchored: final non-whitespace)
    local signal_block
    signal_block=$(printf '%s\n' "$content" | awk -v begin="$SIGNAL_BEGIN" -v end="$SIGNAL_END" '
    BEGIN { in_block=0; block="" }
    index($0, begin) { in_block=1; block=""; next }
    in_block && index($0, end) { in_block=0; found=block; next }
    in_block { block = block $0 "\n" }
    !in_block && found != "" {
        if ($0 ~ /[^ \t]/) { found="" }
    }
    END { print found }
    ')

    if [[ -z "$signal_block" ]]; then
        PARSED_CONVERGENCE="low"
        PARSED_ACTION="continue"
        return 1
    fi

    # Parse fields with strict enum matching
    local conv act
    conv=$(printf '%s\n' "$signal_block" | grep -oE 'convergence: *(high|medium|low)' | head -1 | awk '{print $2}')
    act=$(printf '%s\n' "$signal_block" | grep -oE 'action: *(continue|pause|finalize)' | head -1 | awk '{print $2}')

    if [[ -z "$conv" || -z "$act" ]]; then
        PARSED_CONVERGENCE="low"
        PARSED_ACTION="continue"
        return 1
    fi

    PARSED_CONVERGENCE="$conv"
    PARSED_ACTION="$act"
    return 0
}

parse_usage_metrics() {
    local provider="$1"
    local content="$2"
    local parsed
    local content_path
    content_path=$(mktemp "${TMPDIR:-/tmp}/council-usage.XXXXXX")
    printf '%s' "$content" > "$content_path"

    parsed=$(python3 - "$provider" "$content_path" <<'PY'
import json
import pathlib
import re
import sys

provider = sys.argv[1]
text = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8", errors="ignore")

def find_metric(text: str, names: list[str]) -> int | None:
    for name in names:
        patterns = [
            rf"^\s*([0-9][0-9,]*)\s+{name}(?:\s+tokens?)?\s*$",
            rf"^\s*{name}(?:\s+tokens?)?\s*[:=-]?\s*([0-9][0-9,]*)\s*$",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                return int(match.group(1).replace(",", ""))
    return None

search_text = text
if provider == "codex":
    match = re.search(r"(?ims)^tokens used\s*(.*)$", text)
    if match:
        search_text = match.group(1)

input_tokens = find_metric(search_text, ["input", "prompt"])
output_tokens = find_metric(search_text, ["output", "completion"])
total_tokens = find_metric(search_text, ["total"])

if total_tokens is None and input_tokens is not None and output_tokens is not None:
    total_tokens = input_tokens + output_tokens

print(json.dumps({
    "input": input_tokens,
    "output": output_tokens,
    "total": total_tokens,
}))
PY
)
    rm -f "$content_path"

    PARSED_INPUT_TOKENS=$(printf '%s' "$parsed" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("" if data["input"] is None else data["input"])')
    PARSED_OUTPUT_TOKENS=$(printf '%s' "$parsed" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("" if data["output"] is None else data["output"])')
    PARSED_TOTAL_TOKENS=$(printf '%s' "$parsed" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("" if data["total"] is None else data["total"])')
}

record_usage_totals() {
    local input_tokens="$1"
    local output_tokens="$2"
    local total_tokens="$3"

    if [[ -n "$input_tokens" ]]; then
        TOTAL_INPUT_TOKENS=$((TOTAL_INPUT_TOKENS + input_tokens))
    fi
    if [[ -n "$output_tokens" ]]; then
        TOTAL_OUTPUT_TOKENS=$((TOTAL_OUTPUT_TOKENS + output_tokens))
    fi
    if [[ -n "$total_tokens" ]]; then
        TOTAL_TOKENS=$((TOTAL_TOKENS + total_tokens))
    fi
    if [[ -n "$input_tokens" || -n "$output_tokens" || -n "$total_tokens" ]]; then
        TOKEN_USAGE_TURNS=$((TOKEN_USAGE_TURNS + 1))
    fi
}

format_usage_summary() {
    local input_tokens="$1"
    local output_tokens="$2"
    local total_tokens="$3"
    local parts=()

    if [[ -n "$input_tokens" ]]; then
        parts+=("input $input_tokens")
    fi
    if [[ -n "$output_tokens" ]]; then
        parts+=("output $output_tokens")
    fi
    if [[ -n "$total_tokens" ]]; then
        parts+=("total $total_tokens")
    fi

    if [[ ${#parts[@]} -eq 0 ]]; then
        printf ''
        return
    fi

    local joined=""
    local part
    for part in "${parts[@]}"; do
        if [[ -n "$joined" ]]; then
            joined="$joined · "
        fi
        joined="$joined$part"
    done

    printf '%s' "$joined"
}

# ── Helper: strip signal block from content for transcript ────────────────
strip_signal() {
    local content="$1"
    printf '%s\n' "$content" | awk -v begin="$SIGNAL_BEGIN" -v end="$SIGNAL_END" '
    index($0, begin) { in_block=1; next }
    in_block && index($0, end) { in_block=0; next }
    in_block { next }
    { print }
    ' | awk '{ lines[NR]=$0 } /[^ \t]/ { last=NR } END { for(i=1;i<=last;i++) print lines[i] }'
}

has_meaningful_output() {
    local content="$1"
    local trimmed
    trimmed=$(printf '%s' "$content" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    [[ -n "$trimmed" ]] || return 1
    [[ "$trimmed" != \[* ]] || return 1
    [[ ${#trimmed} -ge 80 ]]
}

has_substantive_turn_output() {
    local content="$1"
    local trimmed
    trimmed=$(printf '%s' "$content" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    [[ -n "$trimmed" ]] || return 1
    [[ "$trimmed" != \[* ]] || return 1
    return 0
}

build_consensus_fallback() {
    cat <<EOF
# Council Conclusion

## Summary
The debate completed, but the automatic combined conclusion step did not return a reliable synthesis. Review the strongest final positions from each side below.

## Strongest ideas from ${SPEAKER_A}

${LAST_OUTPUT_A:-[Unavailable]}

## Strongest ideas from ${SPEAKER_B}

${LAST_OUTPUT_B:-[Unavailable]}

## Outstanding questions
- Review the transcript to resolve any remaining differences between the two positions.
- Re-run the debate if you want a fresh combined conclusion after fixing the finalization issue.

## Recommended next step
Use the strongest points above as the handoff back into the original session, then decide which unresolved tradeoffs need human judgment.
EOF
}

write_consensus_artifact() {
    local content="$1"
    printf '%s\n' "$content" > "$CONSENSUS_FILE"
    printf '%s\n\n%s\n\n' "## Council Conclusion" "$content" >> "$TRANSCRIPT"
    emit_event "consensus_written" "path" "$CONSENSUS_FILE"
}

generate_consensus_artifact() {
    local formatted_history="$1"
    local consensus_input
    local consensus_content=""

    consensus_input="Here is the full debate transcript:

$formatted_history

$CONSENSUS_PROMPT"

    CURRENT_SPEAKER="$SPEAKER_A"
    call_speaker_a "$consensus_input" "$TMPFILE" || true
    consensus_content=$(strip_signal "$(cat "$TMPFILE")")

    if ! has_meaningful_output "$consensus_content"; then
        CURRENT_SPEAKER="$SPEAKER_B"
        call_speaker_b "$consensus_input" "$TMPFILE" || true
        consensus_content=$(strip_signal "$(cat "$TMPFILE")")
    fi

    if ! has_meaningful_output "$consensus_content"; then
        consensus_content=$(build_consensus_fallback)
    fi

    write_consensus_artifact "$consensus_content"
}

# ── Helper: run one model's turn ──────────────────────────────────────────
# Usage: run_model_turn <speaker> <prompt>
# Sets: ${SPEAKER}_CONVERGENCE, ${SPEAKER}_ACTION (via PARSED_*)
# Updates: fail counters, HISTORY, transcript
CURRENT_SPEAKER=""
CURRENT_EVENT_ROUND=""
CURRENT_TURN_ATTEMPT=1

emit_turn_status() {
    local phase="$1"
    local detail="$2"
    [[ "$JSON_EVENTS" == "true" ]] || return 0

    local round_label="${CURRENT_EVENT_ROUND:-$ROUND}"
    emit_event \
        "turn_status" \
        "speaker" "$CURRENT_SPEAKER" \
        "round" "$round_label" \
        "phase" "$phase" \
        "attempt" "$CURRENT_TURN_ATTEMPT" \
        "detail" "$detail"
}

run_model_turn() {
    local speaker="$1"
    local prompt="$2"
    CURRENT_SPEAKER="$speaker"
    CURRENT_EVENT_ROUND="$ROUND"
    CURRENT_TURN_ATTEMPT=1

    emit_event "turn_start" "speaker" "$speaker" "round" "$CURRENT_EVENT_ROUND"
    print_header "$speaker" "$ROUND"

    local attempt=1
    local max_attempts=$((TURN_EMPTY_RETRY_LIMIT + 1))
    local attempt_prompt="$prompt"
    local call_ok=true
    local raw_output=""
    local clean_output=""
    local usage_summary=""
    local turn_input_tokens=""
    local turn_output_tokens=""
    local turn_total_tokens=""

    while [[ "$attempt" -le "$max_attempts" ]]; do
        CURRENT_TURN_ATTEMPT="$attempt"
        emit_turn_status "attempt_start" "Starting attempt $attempt for ${speaker}."

        call_ok=true
        if [[ "$speaker" == "$SPEAKER_A" ]]; then
            call_speaker_a "$attempt_prompt" "$TMPFILE" || call_ok=false
        else
            call_speaker_b "$attempt_prompt" "$TMPFILE" || call_ok=false
        fi

        raw_output=$(cat "$TMPFILE")
        clean_output=$(strip_signal "$raw_output")

        if [[ "$speaker" == "$SPEAKER_A" ]]; then
            parse_usage_metrics "$PROVIDER_A" "$raw_output"
        else
            parse_usage_metrics "$PROVIDER_B" "$raw_output"
        fi

        if [[ -n "$PARSED_INPUT_TOKENS" ]]; then
            turn_input_tokens=$(( ${turn_input_tokens:-0} + PARSED_INPUT_TOKENS ))
        fi
        if [[ -n "$PARSED_OUTPUT_TOKENS" ]]; then
            turn_output_tokens=$(( ${turn_output_tokens:-0} + PARSED_OUTPUT_TOKENS ))
        fi
        if [[ -n "$PARSED_TOTAL_TOKENS" ]]; then
            turn_total_tokens=$(( ${turn_total_tokens:-0} + PARSED_TOTAL_TOKENS ))
        fi

        if parse_signal "$raw_output"; then
            true
        else
            echo -e "${DIM}  (no valid signal from $speaker — defaulting to continue)${RESET}"
        fi

        if [[ "$call_ok" == "true" ]] && has_substantive_turn_output "$clean_output"; then
            break
        fi

        if [[ "$call_ok" != "true" ]]; then
            emit_event "error" "speaker" "$speaker" "message" "${speaker} failed to respond on attempt $attempt."
            PARSED_CONVERGENCE="low"
            PARSED_ACTION="continue"
            break
        fi

        emit_event "error" "speaker" "$speaker" "message" "${speaker} returned no substantive debate content on attempt $attempt."

        if [[ "$attempt" -lt "$max_attempts" ]]; then
            emit_turn_status "retrying" "${speaker} returned only control markers or empty content. Retrying with a stricter prompt."
            attempt_prompt="Your previous response did not contain any substantive debate content. You must produce a real response that directly addresses the other model's arguments before the required signal block.

$prompt"
            attempt=$((attempt + 1))
            continue
        fi

        call_ok=false
        clean_output="[Failed to produce a substantive response.]"
        PARSED_CONVERGENCE="low"
        PARSED_ACTION="continue"
        break
    done

    if [[ -n "$turn_input_tokens" || -n "$turn_output_tokens" || -n "$turn_total_tokens" ]]; then
        record_usage_totals "${turn_input_tokens:-}" "${turn_output_tokens:-}" "${turn_total_tokens:-}"
    fi

    if [[ "$call_ok" == "true" ]]; then
        if [[ "$speaker" == "$SPEAKER_A" ]]; then
            CONSECUTIVE_FAIL_CLAUDE=0
        else
            CONSECUTIVE_FAIL_CODEX=0
        fi
    else
        if [[ "$speaker" == "$SPEAKER_A" ]]; then
            FAIL_COUNT_CLAUDE=$((FAIL_COUNT_CLAUDE + 1))
            CONSECUTIVE_FAIL_CLAUDE=$((CONSECUTIVE_FAIL_CLAUDE + 1))
        else
            FAIL_COUNT_CODEX=$((FAIL_COUNT_CODEX + 1))
            CONSECUTIVE_FAIL_CODEX=$((CONSECUTIVE_FAIL_CODEX + 1))
        fi
    fi

    if [[ "$speaker" == "$SPEAKER_A" ]]; then
        CLAUDE_CONVERGENCE="$PARSED_CONVERGENCE"
        CLAUDE_ACTION="$PARSED_ACTION"
    else
        CODEX_CONVERGENCE="$PARSED_CONVERGENCE"
        CODEX_ACTION="$PARSED_ACTION"
    fi

    usage_summary=$(format_usage_summary "${turn_input_tokens:-}" "${turn_output_tokens:-}" "${turn_total_tokens:-}")
    log_to_transcript "$speaker" "$ROUND" "$clean_output" "$usage_summary"
    append_history "$speaker" "$ROUND" "$clean_output"

    if [[ "$speaker" == "$SPEAKER_A" ]]; then
        LAST_OUTPUT_A="$clean_output"
    else
        LAST_OUTPUT_B="$clean_output"
    fi

    emit_event "turn_end" "speaker" "$speaker" "round" "$ROUND" "convergence" "$PARSED_CONVERGENCE" "action" "$PARSED_ACTION" "inputTokens" "${turn_input_tokens:-}" "outputTokens" "${turn_output_tokens:-}" "totalTokens" "${turn_total_tokens:-}"

    # Export clean output for use in building the next prompt
    LAST_CLEAN_OUTPUT="$clean_output"
}

# ── Helper: build signal context note for prompts ─────────────────────────
# If the other model proposed pause/finalize, tell this model about it.
signal_context_note() {
    local other_model="$1"
    local other_action="$2"

    if [[ "$other_action" == "pause" ]]; then
        printf '\n\nNote: %s proposed pausing for human input. If you agree we need human input, signal pause. If you think there'\''s more ground to cover, say so and signal continue.' "$other_model"
    elif [[ "$other_action" == "finalize" ]]; then
        printf '\n\nNote: %s proposed finalizing — they believe we'\''ve converged. If you agree, signal finalize. If you think there are still unresolved points, say so and signal continue.' "$other_model"
    fi
}

# ── Helper: prompt for human input ────────────────────────────────────────
# Shared input handler for checkpoint and pause_menu.
# Returns: 0=continue, 1=quit, 2=finalize
prompt_human_input() {
    local context_label="$1"
    local round="$2"

    echo -e "${DIM}    [Enter]  Continue debate${RESET}"
    echo -e "${DIM}    [f]      Force finalize now${RESET}"
    echo -e "${DIM}    [q]      Quit and save transcript${RESET}"
    echo -e "${DIM}    Or type guidance for the models${RESET}"
    echo -ne "${YELLOW}  > ${RESET}"

    local input
    read -r input
    case "$input" in
        q|Q)
            echo -e "${DIM}Quitting...${RESET}"
            printf '\n%s\n' "*[Human quit at turn $round ($context_label)]*" >> "$TRANSCRIPT"
            STATE="DONE"
            return 1
            ;;
        f|F) return 2 ;;
        "")  return 0 ;;
        *)
            local safe_input
            safe_input=$(sanitize_input "$input")
            append_history "Human" "$round" "$safe_input"
            log_to_transcript "Human guidance" "$round" "$input"
            printf '\n%s\n\n' "*[Human guidance at turn $round ($context_label)]*" >> "$TRANSCRIPT"
            return 0
            ;;
    esac
}

# ── Helper: supervised checkpoint ────────────────────────────────────────
checkpoint() {
    local round="$1"
    if [[ "$SUPERVISED" == "true" ]]; then
        echo ""
        echo -e "${YELLOW}${BOLD}  Turn $round complete. Options:${RESET}"
        prompt_human_input "supervised" "$round"
        return $?
    fi
    return 0
}

# ── Helper: pause menu ───────────────────────────────────────────────────
pause_menu() {
    local reason="$1"

    echo -e "\n${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${YELLOW}${BOLD}║                      DEBATE PAUSED                          ║${RESET}"
    echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo -e "${DIM}Reason: $reason${RESET}"
    echo -e "${DIM}Turn: $ROUND | Transcript: $TRANSCRIPT${RESET}\n"

    echo -e "${YELLOW}${BOLD}Options:${RESET}"
    local result=0
    prompt_human_input "pause" "$ROUND" || result=$?

    case "$result" in
        0) STATE="DEBATING"; INTERRUPTED=0 ;;
        1) ;; # STATE already set to DONE by prompt_human_input
        2) STATE="FINALIZING" ;;
    esac
}

resume_debate_context() {
    [[ "$RESUMING" == "true" ]] || return 0

    if [[ -n "$HUMAN_INPUT" ]]; then
        local safe_input
        safe_input=$(sanitize_input "$HUMAN_INPUT")
        append_history "Human" "$ROUND" "$safe_input"
        log_to_transcript "Human guidance" "$ROUND" "$HUMAN_INPUT"
        printf '\n%s\n\n' "*[Human guidance received while resuming after turn $ROUND]*" >> "$TRANSCRIPT"
    else
        printf '\n%s\n\n' "*[Debate resumed after pause at turn $ROUND]*" >> "$TRANSCRIPT"
    fi

    CLAUDE_CONVERGENCE=""
    CLAUDE_ACTION=""
    CODEX_CONVERGENCE=""
    CODEX_ACTION=""
    INTERRUPTED=0
    STATE="DEBATING"

    emit_event "resume_started" "round" "$ROUND" "stateFilePath" "$STATE_FILE_PATH" "hasHumanInput" "$([[ -n "$HUMAN_INPUT" ]] && printf 'true' || printf 'false')"
    emit_event "state_change" "from" "PAUSED" "to" "DEBATING" "reason" "Resuming debate from saved state"
}

pause_and_exit_json_mode() {
    local reason="$1"

    STATE="PAUSED"
    printf '\n%s\n\n' "*[$reason at turn $ROUND — awaiting resume]*" >> "$TRANSCRIPT"
    write_resume_state "$reason"
    emit_event "state_change" "from" "DEBATING" "to" "PAUSED" "reason" "$reason"
    emit_event "pause_requested" "reason" "$reason" "round" "$ROUND" "stateFilePath" "$STATE_FILE_PATH"
    emit_event "transcript_written" "path" "$TRANSCRIPT"
    exit "$PAUSE_EXIT_CODE"
}

# ── Start ───────────────────────────────────────────────────────────────────
term_echo "\n${MAGENTA}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
term_echo "${MAGENTA}${BOLD}║                     MODEL COUNCIL                           ║${RESET}"
term_echo "${MAGENTA}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
term_echo "\n${DIM}Topic: ${RESET}${BOLD}$TOPIC${RESET}"
term_echo "${DIM}Mode: open-ended (max $MAX_TURNS turns) | Transcript: $TRANSCRIPT${RESET}"
if [[ "$SUPERVISED" == "true" ]]; then
    term_echo "${DIM}Supervision: on (pause between turns)${RESET}"
fi
term_echo ""

if [[ "$RESUMING" != "true" ]]; then
    HISTORY=""
fi
TMPFILE=$(mktemp)
LAST_CLEAN_OUTPUT=""
trap 'rm -f "$TMPFILE"; trap - INT' EXIT

if [[ "$RESUMING" == "true" ]]; then
    resume_debate_context
else
    emit_event "debate_start" "topic" "$TOPIC" "maxTurns" "$MAX_TURNS" "matchup" "$MATCHUP"
fi

# ── Main debate loop ────────────────────────────────────────────────────────
while [[ "$STATE" == "DEBATING" || "$STATE" == "PAUSED" ]]; do

    # ── Handle PAUSED state ──────────────────────────────────────────────
    if [[ "$STATE" == "PAUSED" ]]; then
        pause_menu "Models requested human input"
        continue
    fi

    # ── Check interrupt flag ─────────────────────────────────────────────
    if [[ "$INTERRUPTED" -eq 1 ]]; then
        STATE="PAUSED"
        printf '\n%s\n\n' "*[Human interrupted at turn $ROUND]*" >> "$TRANSCRIPT"
        pause_menu "Human interrupted"
        continue
    fi

    ROUND=$((ROUND + 1))

    # ── Check max-turns ceiling ──────────────────────────────────────────
    if [[ "$ROUND" -gt "$MAX_TURNS" ]]; then
        term_echo "\n${YELLOW}${BOLD}Max turns ($MAX_TURNS) reached. Moving to finalization.${RESET}"
        printf '\n%s\n\n' "*[Max turns ($MAX_TURNS) reached — forcing finalization]*" >> "$TRANSCRIPT"
        emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "Max turns reached"
        STATE="FINALIZING"
        break
    fi

    term_echo "\n${CYAN}${BOLD}▶ Turn $ROUND${RESET}"

    if [[ "$ROUND" -eq 1 && "$START_SIDE" == "b" ]]; then
        CODEX_PROMPT="Topic for debate: $SAFE_TOPIC

Present your opening position. Be specific and concrete."
        run_model_turn "$SPEAKER_B" "$CODEX_PROMPT"

        if [[ "$INTERRUPTED" -eq 1 ]]; then
            STATE="PAUSED"
            printf '\n%s\n\n' "*[Human interrupted at turn $ROUND]*" >> "$TRANSCRIPT"
            pause_menu "Human interrupted"
            if [[ "$STATE" != "DEBATING" ]]; then
                break
            fi
        fi

        CLAUDE_PROMPT="Topic for debate: $SAFE_TOPIC

Another AI ($SPEAKER_B) has presented this opening argument:

$LAST_CLEAN_OUTPUT

Now present your response. Engage directly with their points — agree where they're right, challenge where they're wrong, and add what they missed."
        run_model_turn "$SPEAKER_A" "$CLAUDE_PROMPT"
    else
        # ── Claude's turn ────────────────────────────────────────────────
        if [[ "$ROUND" -eq 1 ]]; then
            CLAUDE_PROMPT="Topic for debate: $SAFE_TOPIC

Present your opening position. Be specific and concrete."
        else
            RECENT=$(trim_history "$HISTORY")
            CLAUDE_PROMPT="Here is the debate so far:

$RECENT

Continue the debate. Respond directly to ${SPEAKER_B}'s latest points. Where do you agree? Where do you push back? What new considerations should be raised?"
            CLAUDE_PROMPT="${CLAUDE_PROMPT}$(signal_context_note "$SPEAKER_B" "$CODEX_ACTION")"
        fi

        run_model_turn "$SPEAKER_A" "$CLAUDE_PROMPT"

        # ── Check interrupt between model calls ──────────────────────────
        if [[ "$INTERRUPTED" -eq 1 ]]; then
            STATE="PAUSED"
            printf '\n%s\n\n' "*[Human interrupted at turn $ROUND]*" >> "$TRANSCRIPT"
            pause_menu "Human interrupted"
            if [[ "$STATE" != "DEBATING" ]]; then
                break
            fi
        fi

        # ── Codex's turn ─────────────────────────────────────────────────
        if [[ "$ROUND" -eq 1 ]]; then
            CODEX_PROMPT="Topic for debate: $SAFE_TOPIC

Another AI ($SPEAKER_A) has presented this opening argument:

$LAST_CLEAN_OUTPUT

Now present your response. Engage directly with their points — agree where they're right, challenge where they're wrong, and add what they missed."
        else
            RECENT=$(trim_history "$HISTORY")
            CODEX_PROMPT="Here is the debate so far:

$RECENT

Continue the debate. Respond directly to ${SPEAKER_A}'s latest points. Where do you agree? Where do you push back? What new considerations should be raised?"
            CODEX_PROMPT="${CODEX_PROMPT}$(signal_context_note "$SPEAKER_A" "$CLAUDE_ACTION")"
        fi

        run_model_turn "$SPEAKER_B" "$CODEX_PROMPT"
    fi

    # ── Log signals ──────────────────────────────────────────────────────
    term_echo "${DIM}  Signals — ${SPEAKER_A}: ${CLAUDE_CONVERGENCE}/${CLAUDE_ACTION} | ${SPEAKER_B}: ${CODEX_CONVERGENCE}/${CODEX_ACTION}${RESET}"

    # ── Check fail streaks ───────────────────────────────────────────────
    if [[ "$CONSECUTIVE_FAIL_CLAUDE" -ge "$FAIL_STREAK_THRESHOLD" ]]; then
        if [[ "$JSON_EVENTS" == "true" ]]; then
            emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "${SPEAKER_A} failed $CONSECUTIVE_FAIL_CLAUDE consecutive turns"
            printf '\n%s\n\n' "*[${SPEAKER_A} failed $CONSECUTIVE_FAIL_CLAUDE consecutive turns — auto-finalizing (JSON mode)]*" >> "$TRANSCRIPT"
            STATE="FINALIZING"
            break
        fi
        echo -e "\n${RED}${BOLD}${SPEAKER_A} has failed $CONSECUTIVE_FAIL_CLAUDE consecutive turns.${RESET}"
        STATE="PAUSED"
        printf '\n%s\n\n' "*[${SPEAKER_A} failed $CONSECUTIVE_FAIL_CLAUDE consecutive turns — pausing]*" >> "$TRANSCRIPT"
        pause_menu "${SPEAKER_A} failed $CONSECUTIVE_FAIL_CLAUDE consecutive turns"
        continue
    fi
    if [[ "$CONSECUTIVE_FAIL_CODEX" -ge "$FAIL_STREAK_THRESHOLD" ]]; then
        if [[ "$JSON_EVENTS" == "true" ]]; then
            emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "${SPEAKER_B} failed $CONSECUTIVE_FAIL_CODEX consecutive turns"
            printf '\n%s\n\n' "*[${SPEAKER_B} failed $CONSECUTIVE_FAIL_CODEX consecutive turns — auto-finalizing (JSON mode)]*" >> "$TRANSCRIPT"
            STATE="FINALIZING"
            break
        fi
        echo -e "\n${RED}${BOLD}${SPEAKER_B} has failed $CONSECUTIVE_FAIL_CODEX consecutive turns.${RESET}"
        STATE="PAUSED"
        printf '\n%s\n\n' "*[${SPEAKER_B} failed $CONSECUTIVE_FAIL_CODEX consecutive turns — pausing]*" >> "$TRANSCRIPT"
        pause_menu "${SPEAKER_B} failed $CONSECUTIVE_FAIL_CODEX consecutive turns"
        continue
    fi

    # ── Check convergence signals ────────────────────────────────────────
    if [[ "$CLAUDE_ACTION" == "finalize" && "$CODEX_ACTION" == "finalize" ]]; then
        term_echo "\n${MAGENTA}${BOLD}Both models signal convergence. Moving to finalization.${RESET}"
        printf '\n%s\n\n' "*[Both models signaled finalize at turn $ROUND]*" >> "$TRANSCRIPT"
        emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "Both models signaled finalize"
        STATE="FINALIZING"
        break
    fi

    if [[ "$CLAUDE_ACTION" == "pause" && "$CODEX_ACTION" == "pause" ]]; then
        if [[ "$JSON_EVENTS" == "true" ]]; then
            pause_and_exit_json_mode "Both models requested human input"
        fi
        echo -e "\n${YELLOW}${BOLD}Both models request human input.${RESET}"
        STATE="PAUSED"
        printf '\n%s\n\n' "*[Both models requested pause at turn $ROUND]*" >> "$TRANSCRIPT"
        pause_menu "Both models requested human input"
        continue
    fi

    # ── Check no-progress streak ─────────────────────────────────────────
    if [[ "$CLAUDE_CONVERGENCE" == "low" && "$CODEX_CONVERGENCE" == "low" && \
          "$CLAUDE_ACTION" == "continue" && "$CODEX_ACTION" == "continue" ]]; then
        LOW_CONVERGENCE_STREAK=$((LOW_CONVERGENCE_STREAK + 1))
    else
        LOW_CONVERGENCE_STREAK=0
    fi

    if [[ "$LOW_CONVERGENCE_STREAK" -ge "$NO_PROGRESS_THRESHOLD" ]]; then
        if [[ "$JSON_EVENTS" == "true" ]]; then
            emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "No progress — auto-finalizing in JSON mode"
            printf '\n%s\n\n' "*[No-progress breaker — auto-finalizing (JSON mode)]*" >> "$TRANSCRIPT"
            STATE="FINALIZING"
            break
        fi
        echo -e "\n${YELLOW}${BOLD}No progress detected ($NO_PROGRESS_THRESHOLD turns of low convergence).${RESET}"
        LOW_CONVERGENCE_STREAK=0
        STATE="PAUSED"
        printf '\n%s\n\n' "*[No-progress breaker fired at turn $ROUND]*" >> "$TRANSCRIPT"
        pause_menu "No progress — $NO_PROGRESS_THRESHOLD turns of low convergence"
        continue
    fi

    # ── Supervised checkpoint ────────────────────────────────────────────
    if [[ "$SUPERVISED" == "true" ]]; then
        cp_result=0
        checkpoint "$ROUND" || cp_result=$?
        if [[ "$cp_result" -eq 1 ]]; then
            break
        elif [[ "$cp_result" -eq 2 ]]; then
            STATE="FINALIZING"
            printf '\n%s\n\n' "*[Human forced finalization at turn $ROUND]*" >> "$TRANSCRIPT"
            break
        fi
    fi
done

# ── Finalization ─────────────────────────────────────────────────────────
if [[ "$STATE" == "FINALIZING" ]]; then
    emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "Producing conclusion and final plans"
    term_echo "\n${MAGENTA}${BOLD}▶ FINALIZATION${RESET}"
    term_echo "${DIM}  Generating the combined conclusion first...${RESET}"

    FULL_FORMATTED=$(format_history "$HISTORY")

    generate_consensus_artifact "$FULL_FORMATTED"

    term_echo "${DIM}  Both models producing their final plan...${RESET}"
    printf '%s\n\n' "## Final Plans" >> "$TRANSCRIPT"

    # Speaker A's plan
    CLAUDE_PLAN_PROMPT="Here is the full debate:

$FULL_FORMATTED

$PLAN_PROMPT"

    CURRENT_SPEAKER="$SPEAKER_A"
    emit_event "turn_start" "speaker" "$SPEAKER_A" "round" "final"
    term_echo "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    term_echo "${BLUE}${BOLD}  ${SPEAKER_A}'S FINAL PLAN${RESET}"
    term_echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
    call_speaker_a "$CLAUDE_PLAN_PROMPT" "$TMPFILE" || true
    CLAUDE_PLAN=$(strip_signal "$(cat "$TMPFILE")")

    printf '%s\n\n%s\n\n' "### ${SPEAKER_A}'s Plan" "$CLAUDE_PLAN" >> "$TRANSCRIPT"

    # Check for interrupt between plan calls
    if [[ "$INTERRUPTED" -ge 1 ]]; then
        term_echo "\n${YELLOW}Interrupted during finalization. ${SPEAKER_A}'s plan saved. Skipping ${SPEAKER_B}.${RESET}"
        printf '\n%s\n' "*[PARTIAL — interrupted after ${SPEAKER_A}'s plan, before ${SPEAKER_B}'s plan]*" >> "$TRANSCRIPT"
    else
        # Speaker B's plan
        CODEX_PLAN_PROMPT="Here is the full debate:

$FULL_FORMATTED

$PLAN_PROMPT"

        CURRENT_SPEAKER="$SPEAKER_B"
        emit_event "turn_start" "speaker" "$SPEAKER_B" "round" "final"
        term_echo "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        term_echo "${GREEN}${BOLD}  ${SPEAKER_B}'S FINAL PLAN${RESET}"
        term_echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
        call_speaker_b "$CODEX_PLAN_PROMPT" "$TMPFILE" || true
        CODEX_PLAN=$(strip_signal "$(cat "$TMPFILE")")

        printf '%s\n\n%s\n\n' "### ${SPEAKER_B}'s Plan" "$CODEX_PLAN" >> "$TRANSCRIPT"
    fi
fi

if [[ "$TOKEN_USAGE_TURNS" -gt 0 ]]; then
    {
        printf '%s\n\n' '## Token Summary'
        printf '%s\n' "- Turns with usage data: $TOKEN_USAGE_TURNS"
        if [[ "$TOTAL_INPUT_TOKENS" -gt 0 ]]; then
            printf '%s\n' "- Total input tokens: $TOTAL_INPUT_TOKENS"
        fi
        if [[ "$TOTAL_OUTPUT_TOKENS" -gt 0 ]]; then
            printf '%s\n' "- Total output tokens: $TOTAL_OUTPUT_TOKENS"
        fi
        if [[ "$TOTAL_TOKENS" -gt 0 ]]; then
            printf '%s\n' "- Total tokens: $TOTAL_TOKENS"
        fi
        printf '\n'
    } >> "$TRANSCRIPT"
fi

# ── Done ────────────────────────────────────────────────────────────────────
emit_event "transcript_written" "path" "$TRANSCRIPT"
emit_event "debate_complete" "totalRounds" "$ROUND" "outcome" "$STATE"

term_echo "\n${MAGENTA}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
term_echo "${MAGENTA}${BOLD}║                    COUNCIL COMPLETE                          ║${RESET}"
term_echo "${MAGENTA}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
TOTAL_FAILS=$((FAIL_COUNT_CLAUDE + FAIL_COUNT_CODEX))
if [[ "$TOTAL_FAILS" -gt 0 ]]; then
    term_echo "${YELLOW}  (${SPEAKER_A}: $FAIL_COUNT_CLAUDE failed | ${SPEAKER_B}: $FAIL_COUNT_CODEX failed)${RESET}"
fi
term_echo "${DIM}  Turns: $ROUND | State: $STATE${RESET}"
if [[ "$TOKEN_USAGE_TURNS" -gt 0 ]]; then
    local_usage_summary=$(format_usage_summary "$TOTAL_INPUT_TOKENS" "$TOTAL_OUTPUT_TOKENS" "$TOTAL_TOKENS")
    term_echo "${DIM}  Token usage: $local_usage_summary${RESET}"
fi
term_echo "\n${DIM}Full transcript saved to:${RESET}"
term_echo "${BOLD}$TRANSCRIPT${RESET}\n"
