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
CLAUDE_MODEL="opus"
CODEX_MODEL=""
SUPERVISED=false
CALL_TIMEOUT=300  # seconds per model call
JSON_EVENTS=false
OPUS_VS_OPUS=false

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
        --repo)          REPO_PATH="$2"; shift 2 ;;
        --model-claude)  CLAUDE_MODEL="$2"; shift 2 ;;
        --model-codex)   CODEX_MODEL="$2"; shift 2 ;;
        --supervised)    SUPERVISED=true; shift ;;
        --interactive|-i)
            SUPERVISED=true; shift ;;
        --timeout)       CALL_TIMEOUT="$2"; shift 2 ;;
        --json-events)   JSON_EVENTS=true; shift ;;
        --transcript-dir) TRANSCRIPT_DIR="$2"; shift 2 ;;
        --opus-vs-opus)  OPUS_VS_OPUS=true; shift ;;
        --help|-h)
            echo "Usage: council.sh [OPTIONS] \"Your topic or question\""
            echo ""
            echo "Options:"
            echo "  --max-turns N     Safety ceiling for debate turns (default: 20)"
            echo "  --repo PATH       Point both models at a repo for context"
            echo "  --model-claude M  Claude model override (default: opus)"
            echo "  --model-codex M   Codex model override"
            echo "  --supervised      Pause between rounds for human guidance"
            echo "  -i, --interactive Alias for --supervised"
            echo "  --timeout N       Per-call timeout in seconds (default: 300)"
            echo "  --rounds N        Deprecated alias for --max-turns"
            echo "  --json-events     Emit NDJSON events to stdout (for programmatic use)"
            echo "  --transcript-dir  Override transcript output directory"
            echo "  --opus-vs-opus    Use Claude for both sides (no codex CLI needed)"
            exit 0
            ;;
        --*)  die "Unknown flag: $1" ;;
        *)    TOPIC="$1"; shift ;;
    esac
done

if [[ -z "$TOPIC" ]]; then
    if [[ "$JSON_EVENTS" == "true" ]]; then
        die "No topic provided (required in --json-events mode)."
    fi
    echo -e "${YELLOW}No topic provided. What should the council debate?${RESET}"
    read -r TOPIC
fi

[[ -z "$TOPIC" ]] && die "No topic provided."

# ── Preflight checks ───────────────────────────────────────────────────────
command -v claude >/dev/null 2>&1 || die "claude CLI not found. Install it and authenticate first."
if [[ "$OPUS_VS_OPUS" != "true" ]]; then
    command -v codex >/dev/null 2>&1  || die "codex CLI not found. Install it and authenticate first."
fi

# Check for timeout command
TIMEOUT_CMD=""
if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD="gtimeout"
elif command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD="timeout"
fi

# ── Setup ───────────────────────────────────────────────────────────────────
mkdir -p "$TRANSCRIPT_DIR"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
SLUG=$(printf '%s' "$TOPIC" | tr '\n' ' ' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-40 | sed 's/-$//')
TRANSCRIPT="$TRANSCRIPT_DIR/${TIMESTAMP}_${SLUG}.md"

# Resolve repo path
if [[ -n "$REPO_PATH" ]]; then
    [[ -d "$REPO_PATH" ]] || die "Repo path does not exist: $REPO_PATH"
    REPO_PATH=$(cd "$REPO_PATH" && pwd)
fi

# ── Turn delimiter ──────────────────────────────────────────────────────────
TURN_DELIM="<<<COUNCIL_TURN>>>"

# ── Signal sentinels ────────────────────────────────────────────────────────
SIGNAL_BEGIN="<<<COUNCIL_SIGNAL>>>"
SIGNAL_END="<<<END_SIGNAL>>>"

# Sanitize user input to prevent signal injection
sanitize_input() {
    printf '%s\n' "$1" | sed 's/<<<COUNCIL_/<<< COUNCIL_/g' | sed 's/<<<END_SIGNAL/<<< END_SIGNAL/g'
}

SAFE_TOPIC=$(sanitize_input "$TOPIC")

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

# Last parsed signals
CLAUDE_CONVERGENCE=""
CLAUDE_ACTION=""
CODEX_CONVERGENCE=""
CODEX_ACTION=""

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

if [[ "$OPUS_VS_OPUS" == "true" ]]; then
    SPEAKER_A="Claude A"
    SPEAKER_B="Claude B"
    SYSTEM_PROMPT_CLAUDE="${DEBATE_CONTEXT}

You are Claude A (Opus 4.6), debating with Claude B (another instance of yourself). You have your full Claude Code toolchain available — use it. Read files, grep, run commands if it helps you make better arguments. Despite being the same model, take distinct positions and challenge each other's reasoning."

    CODEX_PREAMBLE="${DEBATE_CONTEXT}

You are Claude B (Opus 4.6), debating with Claude A (another instance of yourself). You have your full Claude Code toolchain available — use it. Read files, search the codebase, run commands if it helps you make better arguments. Despite being the same model, take distinct positions and challenge Claude A's reasoning."
else
    SPEAKER_A="Claude"
    SPEAKER_B="Codex"
    SYSTEM_PROMPT_CLAUDE="${DEBATE_CONTEXT}

You are Claude (Opus 4.6), debating with GPT-5.3 (Codex). You have your full Claude Code toolchain available — use it. Read files, grep, run commands if it helps you make better arguments."

    CODEX_PREAMBLE="${DEBATE_CONTEXT}

You are GPT-5.3 (Codex), debating with Claude (Opus 4.6). You have your full Codex toolchain available — use it. Read files, search the codebase, run commands if it helps you make better arguments."
fi

PLAN_PROMPT="The debate is complete and both sides have converged. Produce a FINAL PLAN as a self-contained, copy-pasteable prompt that a human can give to another AI coding assistant to execute the work.

The plan must include:
1. **Context summary**: What was debated and why
2. **Decisions made**: Every design choice with rationale
3. **Specific files to change**: Paths and what changes in each
4. **Implementation steps**: Ordered, concrete, actionable
5. **Open items**: Anything the human should decide before or during execution

Be specific and practical. This is the deliverable — it should be immediately actionable."

# ── Transcript header ───────────────────────────────────────────────────────
cat > "$TRANSCRIPT" << EOF
# Council Debate
**Topic**: $TOPIC
**Date**: $(date "+%B %d, %Y at %I:%M %p")
**Mode**: Open-ended (max $MAX_TURNS turns)
**Models**: $SPEAKER_A vs $SPEAKER_B
$(if [[ -n "$REPO_PATH" ]]; then echo "**Repo**: $REPO_PATH"; fi)

---

EOF

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
        local stderr_log
        stderr_log=$(mktemp)
        ${timeout_prefix[@]+"${timeout_prefix[@]}"} "$@" 2>"$stderr_log" | while IFS= read -r line; do
            printf '%s\n' "$line" >> "$capture_file"
            emit_event "turn_chunk" "speaker" "$CURRENT_SPEAKER" "content" "$line"
        done
        local exit_code=${PIPESTATUS[0]}
        if [[ -s "$stderr_log" ]]; then
            emit_event "stderr" "speaker" "$CURRENT_SPEAKER" "content" "$(cat "$stderr_log")"
        fi
        rm -f "$stderr_log"
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
        if ! { ${timeout_prefix[@]+"${timeout_prefix[@]}"} "$@" 2>&3 | tee "$capture_file" | filter_terminal_output; } 3>&2; then
            local exit_code=$?
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

# ── Helper: call Claude ─────────────────────────────────────────────────────
call_claude() {
    local prompt="$1"
    local capture_file="$2"
    local -a cmd=(env -u CLAUDECODE claude -p --verbose --model "$CLAUDE_MODEL" --append-system-prompt "$SYSTEM_PROMPT_CLAUDE")
    cmd+=("$prompt")

    if [[ -n "$REPO_PATH" ]]; then
        (cd "$REPO_PATH" && stream_and_capture "$capture_file" "${cmd[@]}") || return 1
    else
        stream_and_capture "$capture_file" "${cmd[@]}" || return 1
    fi
}

# ── Helper: call Codex (or Claude B in opus-vs-opus mode) ──────────────────
call_codex() {
    local prompt="$1"
    local capture_file="$2"

    if [[ "$OPUS_VS_OPUS" == "true" ]]; then
        # Use claude CLI with the B-side system prompt
        local -a cmd=(env -u CLAUDECODE claude -p --verbose --model "$CLAUDE_MODEL" --append-system-prompt "$CODEX_PREAMBLE")
        cmd+=("$prompt")
    else
        local -a cmd=(codex exec --full-auto --skip-git-repo-check)
        if [[ -n "$CODEX_MODEL" ]]; then
            cmd+=(-m "$CODEX_MODEL")
        fi
        cmd+=("$prompt")
    fi

    if [[ -n "$REPO_PATH" ]]; then
        (cd "$REPO_PATH" && stream_and_capture "$capture_file" "${cmd[@]}") || return 1
    else
        stream_and_capture "$capture_file" "${cmd[@]}" || return 1
    fi
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

    printf '%s\n\n%s\n\n' "## $speaker — Turn $round" "$content" >> "$TRANSCRIPT"
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

# ── Helper: run one model's turn ──────────────────────────────────────────
# Usage: run_model_turn <speaker> <prompt>
# Sets: ${SPEAKER}_CONVERGENCE, ${SPEAKER}_ACTION (via PARSED_*)
# Updates: fail counters, HISTORY, transcript
CURRENT_SPEAKER=""

run_model_turn() {
    local speaker="$1"
    local prompt="$2"
    CURRENT_SPEAKER="$speaker"

    emit_event "turn_start" "speaker" "$speaker" "round" "$ROUND"
    print_header "$speaker" "$ROUND"

    local call_ok=true
    if [[ "$speaker" == "$SPEAKER_A" ]]; then
        call_claude "$prompt" "$TMPFILE" || call_ok=false
    else
        call_codex "$prompt" "$TMPFILE" || call_ok=false
    fi

    # Update fail counters
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

    local raw_output
    raw_output=$(cat "$TMPFILE")

    # Parse signal
    if parse_signal "$raw_output"; then
        true  # PARSED_CONVERGENCE and PARSED_ACTION are set
    else
        echo -e "${DIM}  (no valid signal from $speaker — defaulting to continue)${RESET}"
    fi

    # Store per-model signals
    if [[ "$speaker" == "$SPEAKER_A" ]]; then
        CLAUDE_CONVERGENCE="$PARSED_CONVERGENCE"
        CLAUDE_ACTION="$PARSED_ACTION"
    else
        CODEX_CONVERGENCE="$PARSED_CONVERGENCE"
        CODEX_ACTION="$PARSED_ACTION"
    fi

    # Strip signal, log, and append to history
    local clean_output
    clean_output=$(strip_signal "$raw_output")
    log_to_transcript "$speaker" "$ROUND" "$clean_output"
    append_history "$speaker" "$ROUND" "$clean_output"

    emit_event "turn_end" "speaker" "$speaker" "round" "$ROUND" "convergence" "$PARSED_CONVERGENCE" "action" "$PARSED_ACTION"

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

HISTORY=""
TMPFILE=$(mktemp)
LAST_CLEAN_OUTPUT=""
trap 'rm -f "$TMPFILE"; trap - INT' EXIT

emit_event "debate_start" "topic" "$TOPIC" "maxTurns" "$MAX_TURNS"

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

    # ── Claude's turn ────────────────────────────────────────────────────
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

    # ── Check interrupt between model calls ──────────────────────────────
    if [[ "$INTERRUPTED" -eq 1 ]]; then
        STATE="PAUSED"
        printf '\n%s\n\n' "*[Human interrupted at turn $ROUND]*" >> "$TRANSCRIPT"
        pause_menu "Human interrupted"
        if [[ "$STATE" != "DEBATING" ]]; then
            break
        fi
    fi

    # ── Codex's turn ─────────────────────────────────────────────────────
    if [[ "$ROUND" -eq 1 ]]; then
        CODEX_PROMPT="$CODEX_PREAMBLE

Topic for debate: $SAFE_TOPIC

Another AI ($SPEAKER_A) has presented this opening argument:

$LAST_CLEAN_OUTPUT

Now present your response. Engage directly with their points — agree where they're right, challenge where they're wrong, and add what they missed."
    else
        RECENT=$(trim_history "$HISTORY")
        CODEX_PROMPT="$CODEX_PREAMBLE

Here is the debate so far:

$RECENT

Continue the debate. Respond directly to ${SPEAKER_A}'s latest points. Where do you agree? Where do you push back? What new considerations should be raised?"
        CODEX_PROMPT="${CODEX_PROMPT}$(signal_context_note "$SPEAKER_A" "$CLAUDE_ACTION")"
    fi

    run_model_turn "$SPEAKER_B" "$CODEX_PROMPT"

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
            emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "Both models requested pause — auto-finalizing in JSON mode"
            printf '\n%s\n\n' "*[Both models requested pause — auto-finalizing (JSON mode)]*" >> "$TRANSCRIPT"
            STATE="FINALIZING"
            break
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
    emit_event "state_change" "from" "DEBATING" "to" "FINALIZING" "reason" "Producing final plans"
    term_echo "\n${MAGENTA}${BOLD}▶ FINALIZATION${RESET}"
    term_echo "${DIM}  Both models producing their final plan...${RESET}"

    printf '%s\n\n' "## Final Plans" >> "$TRANSCRIPT"

    FULL_FORMATTED=$(format_history "$HISTORY")

    # Claude's plan
    CLAUDE_PLAN_PROMPT="Here is the full debate:

$FULL_FORMATTED

$PLAN_PROMPT"

    CURRENT_SPEAKER="$SPEAKER_A"
    emit_event "turn_start" "speaker" "$SPEAKER_A" "round" "final"
    term_echo "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    term_echo "${BLUE}${BOLD}  ${SPEAKER_A}'S FINAL PLAN${RESET}"
    term_echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
    call_claude "$CLAUDE_PLAN_PROMPT" "$TMPFILE" || true
    CLAUDE_PLAN=$(strip_signal "$(cat "$TMPFILE")")

    printf '%s\n\n%s\n\n' "### ${SPEAKER_A}'s Plan" "$CLAUDE_PLAN" >> "$TRANSCRIPT"

    # Check for interrupt between plan calls
    if [[ "$INTERRUPTED" -ge 1 ]]; then
        term_echo "\n${YELLOW}Interrupted during finalization. ${SPEAKER_A}'s plan saved. Skipping ${SPEAKER_B}.${RESET}"
        printf '\n%s\n' "*[PARTIAL — interrupted after ${SPEAKER_A}'s plan, before ${SPEAKER_B}'s plan]*" >> "$TRANSCRIPT"
    else
        # Codex's plan
        CODEX_PLAN_PROMPT="$CODEX_PREAMBLE

Here is the full debate:

$FULL_FORMATTED

$PLAN_PROMPT"

        CURRENT_SPEAKER="$SPEAKER_B"
        emit_event "turn_start" "speaker" "$SPEAKER_B" "round" "final"
        term_echo "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        term_echo "${GREEN}${BOLD}  ${SPEAKER_B}'S FINAL PLAN${RESET}"
        term_echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
        call_codex "$CODEX_PLAN_PROMPT" "$TMPFILE" || true
        CODEX_PLAN=$(strip_signal "$(cat "$TMPFILE")")

        printf '%s\n\n%s\n\n' "### ${SPEAKER_B}'s Plan" "$CODEX_PLAN" >> "$TRANSCRIPT"
    fi
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
term_echo "\n${DIM}Full transcript saved to:${RESET}"
term_echo "${BOLD}$TRANSCRIPT${RESET}\n"
