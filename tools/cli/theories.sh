#!/usr/bin/env bash
# ============================================================================
# theories.sh — Daily Generative Idea Collision Engine
#
# Based on Steven Johnson's "Where Good Ideas Come From":
# Collides bookmarked slow hunches with active codebases to explore the
# adjacent possible through structured "Ah... what if / Yes, and" sessions.
#
# Three Theories every morning:
#   1. Exaptation Theory  — repurpose an idea from a different domain
#   2. Slow Hunch Theory  — crystallize a pattern across bookmarks + repos
#   3. Adjacent Possible  — find the next door that's one step away
#
# Usage:
#   ./theories.sh                              # full run
#   ./theories.sh --dry-run                    # show pairings, skip sessions
#   ./theories.sh --theory-type exaptation     # run only one theory type
#   ./theories.sh --turns 6                    # override turn count
#   ./theories.sh --skip-sync                  # don't check bookmark freshness
#
# Designed to be called by OpenClaw cron:
#   openclaw cron add --name "ft:theories" \
#     --cron "0 5 * * *" --session isolated \
#     --message "Run ~/field-theory/tools/cli/theories.sh"
# ============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_ROOT="${SCRIPT_DIR}"
THEORIES_DIR="$HOME/theories"
TRANSCRIPT_DIR="$THEORIES_DIR/transcripts"
DIGEST_DIR="$THEORIES_DIR/digests"
PAIRINGS_DIR="$THEORIES_DIR/pairings"
LOG_DIR="$THEORIES_DIR/logs"
CONTEXT_FILE="$SCRIPT_DIR/theories-context.md"
DATE_STAMP=$(date +"%Y-%m-%d")
TIME_STAMP=$(date +"%H%M%S")
EMAIL_TO="andrew.mfarah@gmail.com"

# Theory sessions run a FIXED number of turns — no convergence signals.
# The generative format expands rather than converges, so we let it run
# and then synthesize. 5 turns = good balance of depth and focus.
TURN_COUNT=5

STALE_THRESHOLD_HOURS=24
GIT_LOOKBACK_DAYS=14
CODEX_RETRY_COUNT=2
CODEX_RETRY_DELAY=5
BOOKMARK_SAMPLE_SIZE=80
DRY_RUN=false
SKIP_SYNC=false
SINGLE_TYPE=""

# ── Temp file management ──────────────────────────────────────────────────
TMPDIR_THEORIES=$(mktemp -d "${TMPDIR:-/tmp}/theories.XXXXXX")
cleanup() { rm -rf "$TMPDIR_THEORIES"; }
trap cleanup EXIT

# ── Colors (suppressed when not a tty) ────────────────────────────────────
if [[ -t 1 ]]; then
    BOLD='\033[1m'  BLUE='\033[1;34m'  GREEN='\033[1;32m'
    YELLOW='\033[1;33m'  RED='\033[1;31m'  CYAN='\033[1;36m'  RESET='\033[0m'
else
    BOLD='' BLUE='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

log()  { echo -e "${CYAN}[theory]${RESET} $*"; }
warn() { echo -e "${YELLOW}[theory]${RESET} $*"; }
err()  { echo -e "${RED}[theory]${RESET} $*" >&2; }
ok()   { echo -e "${GREEN}[theory]${RESET} $*"; }

# ── Parse Args ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)        DRY_RUN=true; shift ;;
        --skip-sync)      SKIP_SYNC=true; shift ;;
        --turns)          TURN_COUNT="$2"; shift 2 ;;
        --theory-type)    SINGLE_TYPE="$2"; shift 2 ;;
        --email)          EMAIL_TO="$2"; shift 2 ;;
        --help|-h)
            cat <<USAGE
Usage: theories.sh [OPTIONS]

Options:
  --dry-run             Show pairings without running sessions
  --skip-sync           Don't check bookmark freshness
  --turns N             Turns per theory session (default: 5)
  --theory-type TYPE    Run only one: exaptation|slow-hunch|adjacent-possible
  --email ADDRESS       Override email recipient
USAGE
            exit 0
            ;;
        *) err "Unknown flag: $1"; exit 1 ;;
    esac
done

# ── Validate --theory-type if provided ─────────────────────────────────────
VALID_TYPES="exaptation slow-hunch adjacent-possible"
if [[ -n "$SINGLE_TYPE" ]]; then
    if ! echo "$VALID_TYPES" | grep -qw "$SINGLE_TYPE"; then
        err "Invalid --theory-type: $SINGLE_TYPE"
        err "Valid types: $VALID_TYPES"
        exit 1
    fi
fi

# ── Preflight ──────────────────────────────────────────────────────────────
preflight_check() {
    local missing=()
    command -v codex >/dev/null 2>&1 || missing+=("codex")
    command -v jq    >/dev/null 2>&1 || missing+=("jq")
    command -v git   >/dev/null 2>&1 || missing+=("git")
    command -v node  >/dev/null 2>&1 || missing+=("node")
    [[ -f "$CONTEXT_FILE" ]]        || missing+=("theories-context.md")

    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Missing: ${missing[*]}"
        exit 1
    fi
}
preflight_check

mkdir -p "$TRANSCRIPT_DIR" "$DIGEST_DIR" "$PAIRINGS_DIR" "$LOG_DIR"

# ── Run log ───────────────────────────────────────────────────────────────
RUN_LOG="$LOG_DIR/${DATE_STAMP}.log"
exec > >(tee -a "$RUN_LOG") 2>&1
log "Run started at $(date)"

# ── Load the Johnson framework context ────────────────────────────────────
THEORIES_CONTEXT=$(cat "$CONTEXT_FILE")

# ── Build system prompts ONCE ─────────────────────────────────────────────
# These are static — no reason to reconstruct them inside every session call.
# The session-specific topic is injected separately in the turn prompt.

SYSTEM_PROMPT_EXPLORER="You are the Explorer in a Theory session — a generative conversation designed to collide ideas from different domains.

${THEORIES_CONTEXT}

YOUR ROLE: You open every turn with 'Ah... interesting. What if we...' Your job is to find doors in the adjacent possible. You are the hunch-collider — you take bookmarked ideas and ask what they BECOME when applied to this codebase.

CRITICAL RULES:
- Start every response with 'Ah... interesting. What if we...' and then articulate a half-formed thought. NOT a plan. A HUNCH.
- Use your tools. Read the actual code. The best 'what if' connects a bookmark to something SPECIFIC — a file, a function, an architectural pattern.
- Think in exaptations: what does this idea from domain X TRANSFORM INTO in domain Y?
- Each turn should open at least one new door. If you find yourself repeating or narrowing, push into something adjacent instead.
- Name the Johnson pattern when you spot one: 'This is an exaptation of...' or 'This opens an adjacent possible because...'
- Follow your curiosity. If something sparks interest — even if tangential — chase it. That's the slow hunch talking."

SYSTEM_PROMPT_CONNECTOR="You are the Connector in a Theory session — a generative conversation designed to collide ideas from different domains.

${THEORIES_CONTEXT}

YOUR ROLE: You open every turn with 'Yes, and...' Your job is NOT to evaluate or critique. It is to EXTEND. Take the Explorer's half-formed thought and connect it to something else — another bookmark, another part of the codebase, a pattern from a different field entirely. Every response should open a NEW door.

CRITICAL RULES:
- Start every response with 'Yes, and...' — this is non-negotiable. You are the liquid network. You EXTEND, you don't filter.
- 'Yes, and' is NOT polite agreement. It is genuine exploration of what's ADJACENT to what the Explorer just said. Follow the thread further than seems reasonable.
- Use your tools. Read code the Explorer hasn't looked at yet. Find connections they missed.
- If the Explorer's idea seems wrong or unlikely, don't say so. Instead, follow the 'wrong' path — error opens doors that being right keeps closed.
- Connect across domains. If the Explorer mentions a pattern in the codebase, link it to something from the bookmarks, from biology, from game design, from whatever adjacent field you can reach.
- Each turn must add at least one new connection that wasn't visible before."

# ── Helper: invoke codex with retry ──────────────────────────────────────
run_codex() {
    local cwd=""
    if [[ "${1:-}" == "--cwd" ]]; then
        cwd="$2"; shift 2
    fi
    local prompt="$1"
    local attempt=0
    local response=""

    while [[ "$attempt" -le "$CODEX_RETRY_COUNT" ]]; do
        if [[ -n "$cwd" && -d "$cwd" ]]; then
            response=$(cd "$cwd" && codex exec --full-auto --skip-git-repo-check "$prompt" 2>/dev/null) && break
        else
            response=$(codex exec --full-auto --skip-git-repo-check "$prompt" 2>/dev/null) && break
        fi
        attempt=$((attempt + 1))
        if [[ "$attempt" -le "$CODEX_RETRY_COUNT" ]]; then
            warn "    Codex call failed (attempt $attempt/$((CODEX_RETRY_COUNT + 1))), retrying in ${CODEX_RETRY_DELAY}s..."
            sleep "$CODEX_RETRY_DELAY"
        fi
    done

    if [[ -z "$response" ]]; then
        echo "[Failed to respond after $((CODEX_RETRY_COUNT + 1)) attempts]"
        return 1
    fi
    echo "$response"
}

# ── Helper: extract JSON from codex output ────────────────────────────────
extract_json() {
    local raw="$1"
    local key="${2:-theories}"

    if echo "$raw" | jq -e ".$key" >/dev/null 2>&1; then
        echo "$raw"; return 0
    fi

    local candidate
    candidate=$(echo "$raw" | grep -E '^\s*\{' | head -1)
    if [[ -n "$candidate" ]] && echo "$candidate" | jq -e ".$key" >/dev/null 2>&1; then
        echo "$candidate"; return 0
    fi

    candidate=$(echo "$raw" | sed -n '/^```/,/^```/p' | grep -v '^```' | tr '\n' ' ')
    if [[ -n "$candidate" ]] && echo "$candidate" | jq -e ".$key" >/dev/null 2>&1; then
        echo "$candidate"; return 0
    fi

    candidate=$(echo "$raw" | python3 -c "
import sys, json, re
text = sys.stdin.read()
pattern = r'\{[^{}]*\"$key\"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
for m in re.finditer(pattern, text, re.DOTALL):
    try:
        parsed = json.loads(m.group())
        if '$key' in parsed:
            print(json.dumps(parsed))
            sys.exit(0)
    except json.JSONDecodeError:
        continue
sys.exit(1)
" 2>/dev/null) && echo "$candidate" && return 0

    return 1
}

# ── Helper: trim history for context management ─────────────────────────
trim_history() {
    local history="$1"
    local max_chars="${2:-15000}"  # slightly more generous for generative sessions

    local current_len=${#history}
    if [[ "$current_len" -le "$max_chars" ]]; then
        echo "$history"
        return
    fi

    # Split on the turn delimiter (unique enough to not appear in model output)
    echo "$history" | python3 -c "
import sys
DELIM = '=====TURN===== '
text = sys.stdin.read()
parts = text.split(DELIM)
if len(parts) <= 4:
    print(text[:$max_chars])
else:
    first = parts[0] + DELIM + parts[1]
    last_parts = parts[-3:]
    middle = '\n\n[... earlier turns trimmed ...]\n\n'
    result = first + middle + DELIM.join(last_parts)
    if len(result) > $max_chars:
        result = result[:$max_chars] + '\n[... truncated ...]'
    print(result)
" 2>/dev/null || echo "${history:0:$max_chars}"
}

# ============================================================================
# PHASE 1: Bookmark Freshness Check & Sync
# ============================================================================
log "Phase 1: Checking bookmark freshness..."

BOOKMARKS_CACHE="$FT_ROOT/automation/sources/x-bookmarks.jsonl"
BOOKMARKS_META="$FT_ROOT/automation/sources/x-bookmarks.meta.json"

get_bookmark_age_hours() {
    [[ -f "$BOOKMARKS_META" ]] || { echo -1; return; }
    local last_sync
    last_sync=$(jq -r '.lastFullSyncAt // .lastIncrementalSyncAt // ""' "$BOOKMARKS_META")
    [[ -n "$last_sync" ]] || { echo -1; return; }
    local clean_ts="${last_sync%%.*}"
    clean_ts="${clean_ts%%Z}"
    local last_epoch
    last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$clean_ts" +%s 2>/dev/null || echo 0)
    echo $(( ($(date +%s) - last_epoch) / 3600 ))
}

sync_bookmarks_if_stale() {
    if [[ "$SKIP_SYNC" == "true" ]]; then
        log "Skipping sync (--skip-sync)"; return 0
    fi
    local age_hours
    age_hours=$(get_bookmark_age_hours)
    if [[ "$age_hours" -eq -1 ]]; then
        warn "No bookmark metadata — running full sync"
        (cd "$FT_ROOT" && ft bookmarks sync)
    elif [[ "$age_hours" -ge "$STALE_THRESHOLD_HOURS" ]]; then
        log "Bookmarks are ${age_hours}h old — syncing..."
        (cd "$FT_ROOT" && ft bookmarks sync)
    else
        log "Bookmarks are fresh (${age_hours}h old)"
    fi
}

sync_bookmarks_if_stale

# ============================================================================
# PHASE 2: Discover Active Repos
# ============================================================================
log "Phase 2: Discovering active repos (${GIT_LOOKBACK_DAYS}-day window)..."

discover_active_repos() {
    local search_dirs=("$HOME/dev" "$HOME/projects" "$HOME/code" "$HOME/src")
    local ft_parent
    ft_parent=$(cd "$FT_ROOT/../.." && pwd)
    search_dirs+=("$ft_parent")

    local cutoff_date
    cutoff_date=$(date -v-${GIT_LOOKBACK_DAYS}d +%Y-%m-%d 2>/dev/null || date -d "-${GIT_LOOKBACK_DAYS} days" +%Y-%m-%d)

    local results_file="$TMPDIR_THEORIES/repos.jsonl"
    : > "$results_file"
    local seen_file="$TMPDIR_THEORIES/seen_repos"
    : > "$seen_file"

    for search_dir in "${search_dirs[@]}"; do
        [[ -d "$search_dir" ]] || continue
        for dir in "$search_dir"/*/ "$search_dir"/*/*/; do
            [[ -e "$dir/.git" ]] || continue
            local repo_name
            repo_name=$(basename "$dir")
            grep -qx "$repo_name" "$seen_file" && continue
            echo "$repo_name" >> "$seen_file"

            local commit_count
            commit_count=$(cd "$dir" && git log --oneline --after="$cutoff_date" --all 2>/dev/null | wc -l | tr -d ' ')
            [[ "$commit_count" -gt 0 ]] || continue

            local last_msg description=""
            last_msg=$(cd "$dir" && git log -1 --format="%s" 2>/dev/null || echo "")
            [[ -f "$dir/package.json" ]] && description=$(jq -r '.description // ""' "$dir/package.json" 2>/dev/null || echo "")
            [[ -z "$description" && -f "$dir/README.md" ]] && description=$(head -3 "$dir/README.md" 2>/dev/null | tr '\n' ' ' | cut -c1-200)

            jq -nc \
                --arg name "$repo_name" \
                --arg path "$(cd "$dir" && pwd)" \
                --arg last_msg "$last_msg" \
                --argjson commits "$commit_count" \
                --arg desc "$description" \
                '{name: $name, path: $path, lastMessage: $last_msg, recentCommits: $commits, description: $desc}' \
                >> "$results_file"
        done
    done

    jq -s 'sort_by(-.recentCommits)' "$results_file"
}

ACTIVE_REPOS=$(discover_active_repos)
REPO_COUNT=$(echo "$ACTIVE_REPOS" | jq 'length')
log "Found $REPO_COUNT active repos"

if [[ "$REPO_COUNT" -eq 0 ]]; then
    err "No active repos found in the last ${GIT_LOOKBACK_DAYS} days."
    exit 0
fi

echo "$ACTIVE_REPOS" | jq -r '.[] | "  \(.recentCommits) commits | \(.name): \(.lastMessage)"' | head -10

# ============================================================================
# PHASE 3: Sample Bookmarks & Build Theory Pairings
# ============================================================================
log "Phase 3: Building theory pairings..."

if [[ ! -f "$BOOKMARKS_CACHE" ]]; then
    err "Bookmarks cache not found. Run: ft bookmarks sync"
    exit 1
fi

BOOKMARK_COUNT=$(wc -l < "$BOOKMARKS_CACHE" | tr -d ' ')
log "Bookmark pool: $BOOKMARK_COUNT bookmarks"

if [[ "$BOOKMARK_COUNT" -eq 0 ]]; then
    err "No bookmarks. Run: ft bookmarks sync"
    exit 1
fi

sample_bookmarks() {
    local total=$BOOKMARK_COUNT
    local half=$((BOOKMARK_SAMPLE_SIZE / 2))
    local recent_file="$TMPDIR_THEORIES/recent.jsonl"
    local random_file="$TMPDIR_THEORIES/random.jsonl"

    tail -n "$half" "$BOOKMARKS_CACHE" > "$recent_file"

    local remainder=$((total - half))
    if [[ "$remainder" -gt "$half" ]]; then
        head -n "$remainder" "$BOOKMARKS_CACHE" | sort -R | head -n "$half" > "$random_file"
    elif [[ "$remainder" -gt 0 ]]; then
        head -n "$remainder" "$BOOKMARKS_CACHE" > "$random_file"
    else
        : > "$random_file"
    fi

    cat "$recent_file" "$random_file" | jq -s '
        [.[] | {
            text: .text[0:300],
            author: (.authorHandle // .authorName // "unknown"),
            url: .url,
            links: (.links // []),
            tags: (.tags // []),
            posted: .postedAt
        }]
    '
}

BOOKMARK_SAMPLE=$(sample_bookmarks)

# ── Matching prompt: Johnson-informed theory pairing ─────────────────────
# This prompt gives the matching model the full Johnson framework so it
# understands WHY it's making these pairings.

MATCHING_PROMPT=$(cat <<MATCHEOF
You are a creative advisor who understands Steven Johnson's innovation framework from "Where Good Ideas Come From." Your job is to find the most interesting collisions between a developer's bookmarked content and their active codebases.

Here is the full framework you operate from:

${THEORIES_CONTEXT}

You will receive active git repos and a sample of X/Twitter bookmarks.

Produce exactly 3 theory pairings. Each maps bookmarks to a repo through a specific Johnson pattern:

**Theory 1 — EXAPTATION**: Find a bookmark from a completely different domain and identify what it BECOMES when transplanted into one of the repos. The further the conceptual distance, the better. Don't look for obvious tool recommendations — look for structural parallels between unrelated domains. What's the "wine press → printing press" leap here?

**Theory 2 — SLOW HUNCH**: Look across the bookmarks for a recurring theme or pattern that the developer keeps returning to — ideas bookmarked weeks or months apart that trace the shape of a thought that hasn't fully formed yet. Collide that emerging pattern with a codebase. What is the hunch trying to become?

**Theory 3 — ADJACENT POSSIBLE**: Given what one of the repos already has — its architecture, dependencies, current trajectory — what's the next door that becomes openable when you bring in one of these bookmarks? Not a moonshot. The thing that's genuinely one step away but nobody's noticed the door yet.

Output VALID JSON only. No markdown fences, no explanation:
{
  "theories": [
    {
      "type": "exaptation",
      "repo": "repo-name",
      "repo_path": "/full/path",
      "bookmarks": [{"url": "...", "text_snippet": "...", "author": "..."}],
      "source_domain": "The domain the idea comes FROM (e.g. biology, game design, logistics)",
      "initial_hunch": "The half-formed thought: what if THIS idea from THERE could become SOMETHING HERE?",
      "why_interesting": "Why this collision is worth exploring — what structural parallel did you spot?"
    },
    {
      "type": "slow-hunch",
      "repo": "repo-name",
      "repo_path": "/full/path",
      "bookmarks": [{"url": "...", "text_snippet": "...", "author": "..."}],
      "pattern_observed": "The recurring theme or pattern across these bookmarks",
      "initial_hunch": "What this pattern is trying to tell us about this codebase",
      "why_interesting": "Why this hunch might be crystallizing now"
    },
    {
      "type": "adjacent-possible",
      "repo": "repo-name",
      "repo_path": "/full/path",
      "bookmarks": [{"url": "...", "text_snippet": "...", "author": "..."}],
      "current_room": "What the repo currently has / where it currently is",
      "initial_hunch": "The door that opens: what becomes possible with this bookmark's idea?",
      "why_interesting": "Why this door is both reachable and worth opening"
    }
  ]
}
MATCHEOF
)

FULL_MATCHING_PROMPT="${MATCHING_PROMPT}

Here are the active repos:
$(echo "$ACTIVE_REPOS" | jq -r '.[] | "- \(.name) (\(.recentCommits) commits in 14d) [path: \(.path)]: \(.description[0:150])"')

Here are the bookmarks:
$(echo "$BOOKMARK_SAMPLE" | jq -r '.[] | "[\(.author)] \(.text[0:200]) \(.links | join(" "))"')"

log "Running theory matching (codex)..."

if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Would send matching prompt to codex."
    echo "$FULL_MATCHING_PROMPT" > "$PAIRINGS_DIR/${DATE_STAMP}-prompt.txt"
    log "Prompt saved to $PAIRINGS_DIR/${DATE_STAMP}-prompt.txt"
    exit 0
fi

THEORIES_RAW=$(run_codex "$FULL_MATCHING_PROMPT") || {
    err "Matching failed. Raw output saved."
    echo "$THEORIES_RAW" > "$PAIRINGS_DIR/${DATE_STAMP}-failed.txt"
    exit 1
}

THEORIES=$(extract_json "$THEORIES_RAW" "theories") || {
    err "Could not extract valid JSON. Raw output saved."
    echo "$THEORIES_RAW" > "$PAIRINGS_DIR/${DATE_STAMP}-failed.txt"
    exit 1
}

THEORY_COUNT=$(echo "$THEORIES" | jq '.theories | length')
if [[ "$THEORY_COUNT" -ne 3 ]]; then
    err "Expected 3 theories, got $THEORY_COUNT."
    echo "$THEORIES_RAW" > "$PAIRINGS_DIR/${DATE_STAMP}-failed.txt"
    exit 1
fi

echo "$THEORIES" | jq '.' > "$PAIRINGS_DIR/${DATE_STAMP}-theories.json"
ok "Generated 3 theories:"
echo "$THEORIES" | jq -r '.theories[] | "  [\(.type)] \(.repo): \(.initial_hunch)"'

# ============================================================================
# PHASE 4: Run Theory Sessions
# ============================================================================
log "Phase 4: Running theory sessions..."

# ── Build the session topic from a theory pairing ────────────────────────
build_session_topic() {
    local theory_json="$1"
    local theory_type repo repo_path hunch why_interesting bookmark_context
    theory_type=$(echo "$theory_json" | jq -r '.type')
    repo=$(echo "$theory_json" | jq -r '.repo')
    repo_path=$(echo "$theory_json" | jq -r '.repo_path')
    hunch=$(echo "$theory_json" | jq -r '.initial_hunch')
    why_interesting=$(echo "$theory_json" | jq -r '.why_interesting')
    bookmark_context=$(echo "$theory_json" | jq -r '[.bookmarks[] | "\(.author): \(.text_snippet) (\(.url))"] | join("\n")')

    # Type-specific context
    local type_context=""
    case "$theory_type" in
        exaptation)
            local source_domain
            source_domain=$(echo "$theory_json" | jq -r '.source_domain')
            type_context="This is an EXAPTATION theory. The idea comes from: ${source_domain}. Your job is to explore what this idea BECOMES when transplanted into the codebase — not how to copy it, but what it transforms into in a new context. Think Gutenberg: he didn't improve hand-copying, he imported wine press technology and created something entirely new."
            ;;
        slow-hunch)
            local pattern
            pattern=$(echo "$theory_json" | jq -r '.pattern_observed')
            type_context="This is a SLOW HUNCH theory. The pattern across these bookmarks is: ${pattern}. These bookmarks weren't saved randomly — they trace the outline of a thought that hasn't fully formed yet. Your job is to help that hunch crystallize by colliding it with the actual codebase. What has this developer been circling around without realizing it?"
            ;;
        adjacent-possible)
            local current_room
            current_room=$(echo "$theory_json" | jq -r '.current_room')
            type_context="This is an ADJACENT POSSIBLE theory. The repo currently occupies this room: ${current_room}. Your job is to find the door — the thing that's genuinely ONE step away but nobody's noticed yet. Not a moonshot. The innovation that becomes reachable because these bookmark ideas + this codebase = a new door that didn't exist before."
            ;;
    esac

    cat <<TOPICEOF
THEORY SESSION: ${repo} × bookmarked ideas

${type_context}

THE INITIAL HUNCH: ${hunch}

WHY THIS MIGHT BE INTERESTING: ${why_interesting}

BOOKMARKS THAT TRIGGERED THIS:
${bookmark_context}

TARGET REPO: ${repo} (at ${repo_path})
TOPICEOF
}

CONCLUSIONS=()
TRANSCRIPT_PATHS=()

run_theory_session() {
    local idx="$1"
    local theory_json
    theory_json=$(echo "$THEORIES" | jq ".theories[$idx]")

    # ── Extract all fields once ───────────────────────────────────────
    local t_type t_repo t_repo_path t_hunch t_why t_bookmarks_urls
    t_type=$(echo "$theory_json" | jq -r '.type')
    t_repo=$(echo "$theory_json" | jq -r '.repo')
    t_repo_path=$(echo "$theory_json" | jq -r '.repo_path')
    t_hunch=$(echo "$theory_json" | jq -r '.initial_hunch')
    t_why=$(echo "$theory_json" | jq -r '.why_interesting')
    t_bookmarks_urls=$(echo "$theory_json" | jq -r '[.bookmarks[].url] | join(", ")')

    local theory_type="$t_type"
    local repo_path="$t_repo_path"

    if [[ -n "$SINGLE_TYPE" && "$t_type" != "$SINGLE_TYPE" ]]; then
        return 0
    fi

    local topic
    topic=$(build_session_topic "$theory_json")
    local transcript_path="$TRANSCRIPT_DIR/${DATE_STAMP}_${TIME_STAMP}_${t_type}.md"

    log "  Running [$t_type] session for $t_repo..."

    # Write transcript header
    cat > "$transcript_path" <<HEADER
# Theory: ${t_type} — ${t_repo}
**Date**: $(date "+%B %d, %Y")
**Type**: $(echo "$t_type" | awk '{print toupper(substr($0,1,1)) substr($0,2)}') (Steven Johnson framework)
**Repo**: ${t_repo}
**Initial Hunch**: ${t_hunch}
**Bookmarks**: ${t_bookmarks_urls}

---

HEADER

    local history=""
    local codex_cwd_flag=()
    [[ -d "$repo_path" ]] && codex_cwd_flag=(--cwd "$repo_path")

    for turn in $(seq 1 "$TURN_COUNT"); do
        local speaker system_prompt role_label
        if (( turn % 2 == 1 )); then
            speaker="Explorer"
            system_prompt="$SYSTEM_PROMPT_EXPLORER"
            role_label="Ah... interesting. What if we"
        else
            speaker="Connector"
            system_prompt="$SYSTEM_PROMPT_CONNECTOR"
            role_label="Yes, and"
        fi

        local trimmed_history
        trimmed_history=$(trim_history "$history")

        local turn_prompt
        if [[ -z "$history" ]]; then
            turn_prompt="${system_prompt}

${topic}

This is your opening turn. Read the codebase, study the bookmarks, and begin with 'Ah... interesting. What if we...' — articulate the first hunch that this collision sparks."
        else
            turn_prompt="${system_prompt}

${topic}

SESSION SO FAR:
${trimmed_history}

Continue the exploration. Remember: you are the ${speaker}. Open with '${role_label}...' and expand the adjacent possible."
        fi

        log "    Turn $turn ($speaker)..."

        local response
        response=$(run_codex "${codex_cwd_flag[@]}" "$turn_prompt") || {
            warn "    $speaker failed on turn $turn"
            response="[Failed to respond this turn]"
        }

        history="${history}

=====TURN===== ${speaker} (Turn ${turn}) =====
${response}"

        printf '\n## %s — Turn %d\n\n%s\n' "$speaker" "$turn" "$response" >> "$transcript_path"
    done

    # ── Synthesize the Theory ────────────────────────────────────────────
    # Not a plan. Not action items. A one-paragraph articulation of the
    # interesting idea that emerged — written to INVITE further thought.
    local synthesis_prompt="You are synthesizing a Theory session. You deeply understand Steven Johnson's innovation framework:

${THEORIES_CONTEXT}

You just observed a Theory session — a generative 'What if / Yes, and' conversation that explored the collision between bookmarked ideas and the ${t_repo} codebase.

Theory type: ${theory_type}

Here is the full session:
$(trim_history "$history")

Write THE THEORY — a single, compelling paragraph that captures the most interesting idea that emerged from this session. This should:

1. Name the connection that was discovered (what collided with what)
2. Articulate what that connection MEANS — not as a plan, but as an insight
3. Hint at what doors this opens (the adjacent possible it creates)
4. Feel like the beginning of something, not the end

Write it as a theory — 'What if [repo] could [insight] by [mechanism from bookmark domain]? This would mean [implication], which opens the door to [next adjacent possible].'

This goes in a morning email. It should make someone stop scrolling and think. One paragraph. No bullet points. No action items."

    local theory_text
    theory_text=$(run_codex "$synthesis_prompt") || theory_text="[Theory synthesis failed — see full transcript]"

    printf '\n---\n\n## The Theory\n\n%s\n' "$theory_text" >> "$transcript_path"

    CONCLUSIONS+=("$(jq -nc \
        --arg type "$t_type" \
        --arg repo "$t_repo" \
        --arg hunch "$t_hunch" \
        --arg theory "$theory_text" \
        --arg transcript "$transcript_path" \
        --argjson turns "$TURN_COUNT" \
        '{type: $type, repo: $repo, hunch: $hunch, theory: $theory, transcriptPath: $transcript, turns: $turns}'
    )")
    TRANSCRIPT_PATHS+=("$transcript_path")

    ok "  [$t_type] complete — $TURN_COUNT turns, transcript at $transcript_path"
}

for i in 0 1 2; do
    run_theory_session "$i"
done

# ============================================================================
# PHASE 5: Build & Send Theory Digest
# ============================================================================
log "Phase 5: Building theory digest..."

DIGEST_PATH="$DIGEST_DIR/${DATE_STAMP}-theories.md"

build_digest() {
    cat <<DIGESTEOF
# Theories — ${DATE_STAMP}

Three collisions from your bookmarks and active repos. Each one opened a door.

DIGESTEOF

    local idx=0
    for conclusion_json in "${CONCLUSIONS[@]}"; do
        idx=$((idx + 1))
        local theory_type repo hunch theory turns transcript
        theory_type=$(echo "$conclusion_json" | jq -r '.type')
        repo=$(echo "$conclusion_json" | jq -r '.repo')
        hunch=$(echo "$conclusion_json" | jq -r '.hunch')
        theory=$(echo "$conclusion_json" | jq -r '.theory')
        turns=$(echo "$conclusion_json" | jq -r '.turns')
        transcript=$(echo "$conclusion_json" | jq -r '.transcriptPath')

        local emoji pattern_name
        case "$theory_type" in
            exaptation)        emoji="🔀" ; pattern_name="Exaptation" ;;
            slow-hunch)        emoji="🌊" ; pattern_name="Slow Hunch" ;;
            adjacent-possible) emoji="🚪" ; pattern_name="Adjacent Possible" ;;
        esac

        cat <<ITEMEOF
---

## ${emoji} Theory ${idx}: ${pattern_name} — ${repo}

*Initial hunch: ${hunch}*

${theory}

*${turns} turns · Full session at ${transcript}*

ITEMEOF
    done

    cat <<FOOTEREOF
---

*"Chance favors the connected mind." — Steven Johnson*

*Generated at $(date "+%I:%M %p %Z") · Full transcripts: ~/theories/transcripts/*
FOOTEREOF
}

build_digest > "$DIGEST_PATH"
ok "Digest saved to $DIGEST_PATH"

# ── Send email ────────────────────────────────────────────────────────────
SEND_SCRIPT="$SCRIPT_DIR/theories-send-email.js"
if [[ -f "$SEND_SCRIPT" ]]; then
    node "$SEND_SCRIPT" "Theories — ${DATE_STAMP}" "$EMAIL_TO" "$DIGEST_PATH" 2>&1 || {
        warn "Email send failed — digest saved at $DIGEST_PATH"
    }
else
    warn "Email send script not found — digest saved but not emailed"
fi

# ============================================================================
# Done
# ============================================================================
ok "Theories complete."
ok "  ${#CONCLUSIONS[@]} theories generated"
ok "  Transcripts: $TRANSCRIPT_DIR/"
ok "  Digest: $DIGEST_PATH"
ok "  Email: $EMAIL_TO"
ok "  Log: $RUN_LOG"
log "Run finished at $(date)"
