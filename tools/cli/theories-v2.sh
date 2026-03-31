#!/usr/bin/env bash
# ============================================================================
# theories-v2.sh — Overnight analysis engine
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_ROOT="${SCRIPT_DIR}"
THEORIES_DIR="$HOME/theories"
TRANSCRIPT_DIR="$THEORIES_DIR/transcripts"
DIGEST_DIR="$THEORIES_DIR/digests"
LOG_DIR="$THEORIES_DIR/logs"
DATE_STAMP=$(date +"%Y-%m-%d")
TIME_STAMP=$(date +"%H%M%S")
EMAIL_TO="${FT_THEORIES_EMAIL:-}"

TURN_COUNT=4
STALE_THRESHOLD_HOURS=24
GIT_LOOKBACK_DAYS=14
CODEX_RETRY_COUNT=2
CODEX_RETRY_DELAY=5
DRY_RUN=false
SKIP_SYNC=false
SINGLE_TYPE=""
BUDGET=4
ENGINE="${FT_THEORIES_ENGINE:-auto}"

# ── Temp files ────────────────────────────────────────────────────────────
TMPDIR_THEORIES=$(mktemp -d "${TMPDIR:-/tmp}/theories.XXXXXX")
cleanup() { rm -rf "$TMPDIR_THEORIES"; }
trap cleanup EXIT

# ── Colors ────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    BOLD='\033[1m'  BLUE='\033[1;34m'  GREEN='\033[1;32m'
    YELLOW='\033[1;33m'  RED='\033[1;31m'  CYAN='\033[1;36m'  RESET='\033[0m'
else
    BOLD='' BLUE='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

log()  { echo -e "${CYAN}[theories]${RESET} $*"; }
warn() { echo -e "${YELLOW}[theories]${RESET} $*"; }
err()  { echo -e "${RED}[theories]${RESET} $*" >&2; }
ok()   { echo -e "${GREEN}[theories]${RESET} $*"; }

HAS_CODEX=false
HAS_CLAUDE=false

# ── Parse args ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)     DRY_RUN=true; shift ;;
        --skip-sync)   SKIP_SYNC=true; shift ;;
        --turns)       TURN_COUNT="$2"; shift 2 ;;
        --type)        SINGLE_TYPE="$2"; shift 2 ;;
        --budget)      BUDGET="$2"; shift 2 ;;
        --engine)      ENGINE="$2"; FT_THEORIES_ENGINE="$2"; export FT_THEORIES_ENGINE; shift 2 ;;
        --email)       EMAIL_TO="$2"; shift 2 ;;
        --help|-h)
            cat <<USAGE
Usage: theories-v2.sh [OPTIONS]

Options:
  --dry-run           Show matching without running sessions
  --skip-sync         Don't check bookmark freshness
  --turns N           Turns per session (default: 4)
  --type TYPE         Run only: scan|adopt|pattern|explore
  --budget N          Max analyses to run (default: 4)
  --email ADDRESS     Override email recipient
USAGE
            exit 0
            ;;
        *) err "Unknown flag: $1"; exit 1 ;;
    esac
done

# ── Read config file ──────────────────────────────────────────────────────
THEORIES_CONFIG="$HOME/.fieldtheory/theories.json"
CUSTOM_INSTRUCTIONS=""
INCLUDE_TWEET_URLS="true"
SYSTEM_PROMPT_APPEND=""

if [[ -f "$THEORIES_CONFIG" ]] && command -v jq >/dev/null 2>&1; then
    [[ -z "$EMAIL_TO" ]] && EMAIL_TO=$(jq -r '.runtime.email // ""' "$THEORIES_CONFIG")
    [[ "$ENGINE" == "auto" && -z "${FT_THEORIES_ENGINE:-}" ]] && \
        ENGINE=$(jq -r '.runtime.engine // "auto"' "$THEORIES_CONFIG")
    [[ "$TURN_COUNT" -eq 4 ]] && \
        TURN_COUNT=$(jq -r '.runtime.turns // 4' "$THEORIES_CONFIG")
    [[ "$BUDGET" -eq 4 ]] && \
        BUDGET=$(jq -r '.runtime.budget // 4' "$THEORIES_CONFIG")

    CUSTOM_INSTRUCTIONS=$(jq -r '(.prompts.custom_instructions // []) | join("\n- ")' "$THEORIES_CONFIG")
    INCLUDE_TWEET_URLS=$(jq -r '.prompts.include_tweet_urls // true' "$THEORIES_CONFIG")
    SYSTEM_PROMPT_APPEND=$(jq -r '.prompts.system_prompt_append // ""' "$THEORIES_CONFIG")
fi

# ── Preflight ─────────────────────────────────────────────────────────────
preflight_check() {
    local missing=()
    command -v jq    >/dev/null 2>&1 || missing+=("jq")
    command -v node  >/dev/null 2>&1 || missing+=("node")
    if [[ ${#missing[@]} -gt 0 ]]; then err "Missing: ${missing[*]}"; exit 1; fi

    command -v codex >/dev/null 2>&1 && HAS_CODEX=true
    command -v claude >/dev/null 2>&1 && HAS_CLAUDE=true

    if ! $HAS_CODEX && ! $HAS_CLAUDE; then
        err "Missing: codex or claude"
        exit 1
    fi
}
preflight_check

mkdir -p "$TRANSCRIPT_DIR" "$DIGEST_DIR" "$LOG_DIR"

RUN_LOG="$LOG_DIR/${DATE_STAMP}-v2.log"
log "Run started at $(date)"

# ── Engine selection ──────────────────────────────────────────────────────
# ENGINE can be "codex", "claude", or "auto" (alternates to spread load).
ENGINE_CALL_COUNT=0

# Invoke a single engine. Returns 0 on success, 1 on failure.
_invoke() {
    local engine="$1" cwd="$2" prompt="$3"
    if [[ "$engine" == "claude" ]]; then
        if [[ -n "$cwd" ]]; then
            (cd "$cwd" && claude -p --permission-mode auto "$prompt" 2>/dev/null)
        else
            claude -p --permission-mode auto "$prompt" 2>/dev/null
        fi
    else
        if [[ -n "$cwd" ]]; then
            (cd "$cwd" && codex exec --full-auto --skip-git-repo-check "$prompt" 2>/dev/null)
        else
            codex exec --full-auto --skip-git-repo-check "$prompt" 2>/dev/null
        fi
    fi
}

pick_engine() {
    case "$ENGINE" in
        auto)
            if $HAS_CODEX && $HAS_CLAUDE; then
                if (( ENGINE_CALL_COUNT % 2 == 1 )); then
                    echo "codex"
                else
                    echo "claude"
                fi
            elif $HAS_CODEX; then
                echo "codex"
            else
                echo "claude"
            fi
            ;;
        codex)
            if $HAS_CODEX; then
                echo "codex"
            elif $HAS_CLAUDE; then
                echo "claude"
            fi
            ;;
        claude)
            if $HAS_CLAUDE; then
                echo "claude"
            elif $HAS_CODEX; then
                echo "codex"
            fi
            ;;
    esac
}

fallback_engine() {
    local primary="$1"
    case "$primary" in
        codex)
            $HAS_CLAUDE && echo "claude"
            ;;
        claude)
            $HAS_CODEX && echo "codex"
            ;;
    esac
}

run_engine() {
    local cwd=""
    if [[ "${1:-}" == "--cwd" ]]; then cwd="$2"; shift 2; fi
    local prompt="$1" attempt=0 response=""
    ENGINE_CALL_COUNT=$((ENGINE_CALL_COUNT + 1))

    local use_engine fallback
    use_engine=$(pick_engine)
    fallback=$(fallback_engine "$use_engine")

    # Try primary engine with retries
    while [[ "$attempt" -le "$CODEX_RETRY_COUNT" ]]; do
        response=$(_invoke "$use_engine" "$cwd" "$prompt") && break
        response=""
        attempt=$((attempt + 1))
        if [[ "$attempt" -le "$CODEX_RETRY_COUNT" ]]; then
            warn "    ${use_engine} failed (attempt $attempt), retrying in ${CODEX_RETRY_DELAY}s..."
            sleep "$CODEX_RETRY_DELAY"
        fi
    done

    if [[ -z "$response" && -n "$fallback" ]]; then
        warn "    ${use_engine} exhausted — falling back to ${fallback}"
        response=$(_invoke "$fallback" "$cwd" "$prompt") || true
    fi

    if [[ -z "$response" ]]; then
        echo "[Both engines failed after retries]"
        return 1
    fi
    echo "$response"
}

# ── Helper: trim history ─────────────────────────────────────────────────
trim_history() {
    local history="$1" max_chars="${2:-15000}"
    [[ ${#history} -le "$max_chars" ]] && { echo "$history"; return; }
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
    print(result[:$max_chars])
" 2>/dev/null || echo "${history:0:$max_chars}"
}

# ============================================================================
# PHASE 1: Bookmark freshness + index
# ============================================================================
log "Phase 1: Checking bookmarks..."

BOOKMARKS_META="$FT_ROOT/automation/sources/x-bookmarks.meta.json"

if [[ "$SKIP_SYNC" != "true" && -f "$BOOKMARKS_META" ]]; then
    age_hours=$(jq -r '.lastFullSyncAt // .lastIncrementalSyncAt // ""' "$BOOKMARKS_META" | \
        python3 -c "
import sys, datetime
ts = sys.stdin.read().strip()
if not ts: print(-1); sys.exit()
clean = ts.split('.')[0].rstrip('Z')
try:
    dt = datetime.datetime.fromisoformat(clean)
    print(int((datetime.datetime.now() - dt).total_seconds() / 3600))
except: print(-1)
" 2>/dev/null || echo -1)
    if [[ "$age_hours" -ge "$STALE_THRESHOLD_HOURS" ]]; then
        log "Bookmarks are ${age_hours}h old — syncing..."
        (cd "$FT_ROOT" && npx tsx src/cli.ts bookmarks sync 2>/dev/null) || warn "Sync failed, using existing cache"
    else
        log "Bookmarks fresh (${age_hours}h old)"
    fi
fi

# Ensure index has classifications (LLM for categories, then domains)
log "Classifying new bookmarks..."
(cd "$FT_ROOT" && npx tsx src/cli.ts bookmarks classify 2>/dev/null) || warn "Category classification failed"
(cd "$FT_ROOT" && npx tsx src/cli.ts bookmarks classify-domains 2>/dev/null) || warn "Domain classification failed"

# ============================================================================
# PHASE 2: Discover active repos
# ============================================================================
log "Phase 2: Discovering active repos..."

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
    # Dedup by remote URL — worktrees of the same repo share a remote.
    # Keep the one whose directory name matches the repo name (main checkout).
    local seen_remotes="$TMPDIR_THEORIES/seen_remotes"
    : > "$seen_remotes"

    for search_dir in "${search_dirs[@]}"; do
        [[ -d "$search_dir" ]] || continue
        while IFS= read -r dir; do
            [[ -e "$dir/.git" ]] || continue
            local repo_name
            repo_name=$(basename "$dir")
            grep -qx "$repo_name" "$seen_file" && continue
            echo "$repo_name" >> "$seen_file"

            # Dedup worktrees: skip if we've already seen this remote
            local remote_url
            remote_url=$(cd "$dir" && git remote get-url origin 2>/dev/null || echo "local:$dir")
            if grep -qx "$remote_url" "$seen_remotes" 2>/dev/null; then
                continue
            fi
            echo "$remote_url" >> "$seen_remotes"

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
        done < <(printf '%s\n' "$search_dir"/*/ "$search_dir"/*/*/ | awk '{print length, $0}' | sort -n | cut -d' ' -f2-)
    done

    jq -s 'sort_by(-.recentCommits)' "$results_file"
}

ACTIVE_REPOS=$(discover_active_repos)
REPO_COUNT=$(echo "$ACTIVE_REPOS" | jq 'length')
log "Found $REPO_COUNT active repos"

[[ "$REPO_COUNT" -eq 0 ]] && { err "No active repos found."; exit 0; }
echo "$ACTIVE_REPOS" | jq -r '.[] | "  \(.recentCommits) commits | \(.name): \(.lastMessage)"' | head -10

# Save repos for the matcher
REPOS_FILE="$TMPDIR_THEORIES/repos.json"
echo "$ACTIVE_REPOS" > "$REPOS_FILE"

# ============================================================================
# PHASE 3: Smart matching
# ============================================================================
log "Phase 3: Building analysis jobs..."

JOBS=$(cd "$FT_ROOT" && npx tsx src/theories-match.ts "$REPOS_FILE" --budget "$BUDGET" 2>/dev/null)
JOB_COUNT=$(echo "$JOBS" | jq 'length')
log "Created $JOB_COUNT analysis jobs"

echo "$JOBS" | jq -r '.[] | "  [\(.type)] \(.title) → \(.repo.name) (\(.bookmarks | length) bookmarks)"'

if [[ "$DRY_RUN" == "true" ]]; then
    echo "$JOBS" | jq '.' > "$DIGEST_DIR/${DATE_STAMP}-jobs.json"
    log "[DRY RUN] Jobs saved to $DIGEST_DIR/${DATE_STAMP}-jobs.json"
    exit 0
fi

# ============================================================================
# PHASE 4: Run analysis sessions
# ============================================================================
log "Phase 4: Running analysis sessions..."

# ── System prompts by type ────────────────────────────────────────────────

SYSTEM_PROMPT_ANALYST="You are analyzing a developer's bookmarks against their active codebase. Your job is to find things that are genuinely useful — not to impress, not to be comprehensive, just to surface what matters.

Rules:
- Use your tools. Read the actual code. Grep for dependencies. Check package.json, requirements.txt, Cargo.toml.
- Be specific. Name the file, the function, the line number. Vague observations are worthless.
- If nothing applies, say so. An honest 'nothing here' is more useful than a forced connection.
- Write like a colleague, not a consultant. No jargon inflation, no 'synergies', no 'leveraging'.
- When you find something real, explain what to do about it. Not 'consider adopting X' — rather 'X solves the problem in src/foo.ts:142 where you currently do Y. Here is what the change looks like.'
- Distinguish between things you're confident about and things you're speculating on. Mark speculation clearly.
- IMPORTANT: You are on the main branch. Do NOT commit to main. If you want to make code changes, create a feature branch first (git checkout -b theories/<descriptive-name>) and commit there."

SYSTEM_PROMPT_EXPLORER_V2="You are exploring connections between bookmarked ideas and a codebase. Your job is to find the interesting thing — the door that's one step away but nobody's noticed.

Rules:
- Read the code before you speculate. The best insight connects a bookmark to something SPECIFIC in the repo.
- Follow what's genuinely interesting, not what sounds impressive.
- If a bookmark reminds you of something in the code, chase that thread. Be concrete about what you find.
- You're looking for the adjacent possible: what becomes buildable because this idea exists AND this codebase exists?
- Name what you find honestly. If it's a stretch, say so. If it's obvious in hindsight, that's actually the best kind.
- Don't narrate your process. Just share what you found.
- IMPORTANT: You are on the main branch. Do NOT commit to main. If you want to make code changes, create a feature branch first (git checkout -b theories/<descriptive-name>) and commit there."

if [[ -n "$SYSTEM_PROMPT_APPEND" ]]; then
    SYSTEM_PROMPT_ANALYST="${SYSTEM_PROMPT_ANALYST}"$'\n\n'"${SYSTEM_PROMPT_APPEND}"
    SYSTEM_PROMPT_EXPLORER_V2="${SYSTEM_PROMPT_EXPLORER_V2}"$'\n\n'"${SYSTEM_PROMPT_APPEND}"
fi

FINDINGS=()
TRANSCRIPT_PATHS=()

run_analysis() {
    local job_json="$1"
    local job_type job_title repo_name repo_path prompt_hint bookmark_text
    job_type=$(echo "$job_json" | jq -r '.type')
    job_title=$(echo "$job_json" | jq -r '.title')
    repo_name=$(echo "$job_json" | jq -r '.repo.name')
    repo_path=$(echo "$job_json" | jq -r '.repo.path')
    prompt_hint=$(echo "$job_json" | jq -r '.prompt_hint')

    if [[ -n "$SINGLE_TYPE" && "$job_type" != "$SINGLE_TYPE" ]]; then return 0; fi

    # Format bookmarks for the prompt
    bookmark_text=$(echo "$job_json" | jq -r '.bookmarks[] | "- @\(.author): \(.text[0:250]) [\(.url)]\(if .github_urls then " (github: " + .github_urls + ")" else "" end)"')
    local bookmark_urls
    bookmark_urls=$(echo "$job_json" | jq -r '[.bookmarks[].url] | join("\n")')

    local transcript_path="$TRANSCRIPT_DIR/${DATE_STAMP}_${TIME_STAMP}_${job_type}.md"
    log "  Running [$job_type] $job_title → $repo_name..."

    # Choose system prompt based on job's system_prompt field
    local system_prompt_type
    system_prompt_type=$(echo "$job_json" | jq -r '.system_prompt // "analyst"')
    local system_prompt
    if [[ "$system_prompt_type" == "explorer" ]]; then
        system_prompt="$SYSTEM_PROMPT_EXPLORER_V2"
    else
        system_prompt="$SYSTEM_PROMPT_ANALYST"
    fi

    # Write transcript header
    cat > "$transcript_path" <<HEADER
# ${job_title} — ${repo_name}
**Date**: $(date "+%B %d, %Y")
**Type**: ${job_type}
**Repo**: ${repo_name} (${repo_path})
**Bookmarks**: ${bookmark_urls}

---

HEADER

    # Ensure repo is on its default branch (main/master) for analysis
    if [[ -d "$repo_path" ]]; then
        local default_branch
        default_branch=$(cd "$repo_path" && git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || echo "")
        if [[ -z "$default_branch" ]]; then
            default_branch=$(cd "$repo_path" && git branch -l main master 2>/dev/null | head -1 | tr -d '* ' || echo "main")
        fi
        if [[ -n "$default_branch" ]]; then
            (cd "$repo_path" && git checkout "$default_branch" 2>/dev/null) || true
        fi
    fi

    local history=""
    local codex_cwd_flag=()
    [[ -d "$repo_path" ]] && codex_cwd_flag=(--cwd "$repo_path")

    for turn in $(seq 1 "$TURN_COUNT"); do
        local turn_prompt
        if [[ -z "$history" ]]; then
            turn_prompt="${system_prompt}

ANALYSIS: ${job_title}
REPO: ${repo_name} (at ${repo_path})

${prompt_hint}

BOOKMARKS:
${bookmark_text}

Start by reading the repo structure and key files. Then go through the bookmarks and identify what's relevant."
        else
            local trimmed
            trimmed=$(trim_history "$history")
            turn_prompt="${system_prompt}

ANALYSIS: ${job_title}
REPO: ${repo_name} (at ${repo_path})

${prompt_hint}

BOOKMARKS:
${bookmark_text}

WORK SO FAR:
${trimmed}

Continue the analysis. Go deeper on what you've found. If you've covered enough ground, synthesize your findings into concrete recommendations."
        fi

        log "    Turn $turn..."
        local response
        response=$(run_engine "${codex_cwd_flag[@]}" "$turn_prompt") || {
            warn "    Turn $turn failed"
            response="[Failed this turn]"
        }

        history="${history}

=====TURN===== Turn ${turn} =====
${response}"

        printf '\n## Turn %d\n\n%s\n' "$turn" "$response" >> "$transcript_path"
    done

    # ── Assign finding ID ─────────────────────────────────────────────────
    STATE_FILE="$THEORIES_DIR/state.json"
    if [[ ! -f "$STATE_FILE" ]]; then
        echo '{"next_id":1}' > "$STATE_FILE"
    fi
    local next_id
    next_id=$(jq -r '.next_id // 1' "$STATE_FILE")

    # ── Synthesize ────────────────────────────────────────────────────────
    # Build finding template from config
    local bookmark_line
    if [[ "$INCLUDE_TWEET_URLS" == "true" ]]; then
        bookmark_line="BOOKMARKS: [The 1-3 bookmark URLs that led to this finding]"
    else
        bookmark_line="BOOKMARKS: [The 1-3 bookmark topics that led to this finding]"
    fi

    local custom_rules=""
    if [[ -n "$CUSTOM_INSTRUCTIONS" ]]; then
        custom_rules="
Additional instructions from the user:
- ${CUSTOM_INSTRUCTIONS}"
    fi

    local synthesis_prompt="You just did an analysis of a developer's bookmarks against their ${repo_name} codebase. Here's the full session:

$(trim_history "$history")

Now write the summary for their morning email. Include ALL findings, not just the most important one.

FINDING IDs: Number each finding sequentially starting from FT-${next_id}. These IDs are permanent and never reuse.

\$100 BUDGET: You have a hypothetical \$100 to allocate across ALL findings in this email. Assign each finding a dollar amount reflecting its relative importance — a critical security issue might get \$35, a nice-to-have suggestion \$5. The amounts must sum to \$100. Show the amount next to each finding's ID.

Use this format for EACH finding:

---

### FT-[N] — \$[amount]

**[Plain English: one sentence explaining what this means and why someone should care, written for a human who just woke up]**

${bookmark_line}

WHAT WE FOUND: [2-4 sentences. Be specific — name the file, the dependency, the line. What's the actual situation?]

WHAT TO DO: [1-2 sentences. Concrete next step. If you're unsure, say 'Worth investigating' not 'You should definitely'.]

CONFIDENCE: [High / Medium / Speculative]

---

Repeat this block for every distinct finding from the session. Don't merge unrelated findings into one block.

Rules:
- Start directly with the first finding block. No preamble.
- The bold sentence at the top of each finding is the most important line — it should make sense to someone scanning their inbox at 7am.
- No self-congratulation. No 'This is a fascinating discovery'. Just state what you found.
- If nothing useful was found, write: **Nothing actionable in this batch.** and stop.
- Write like a sharp colleague leaving a note, not like an AI generating a report.${custom_rules}"

    local finding
    finding=$(run_engine "$synthesis_prompt") || finding="FINDING: Synthesis failed — see full transcript at ${transcript_path}"

    # Count how many FT-NNN IDs were used and update the counter
    local ids_used
    ids_used=$(echo "$finding" | grep -c '### FT-' || true)
    if [[ "$ids_used" -gt 0 ]]; then
        local new_next_id=$((next_id + ids_used))
        jq --argjson n "$new_next_id" '.next_id = $n' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    fi

    printf '\n---\n\n## Summary\n\n%s\n' "$finding" >> "$transcript_path"

    FINDINGS+=("$(jq -nc \
        --arg type "$job_type" \
        --arg title "$job_title" \
        --arg repo "$repo_name" \
        --arg finding "$finding" \
        --arg transcript "$transcript_path" \
        --arg bookmark_urls "$bookmark_urls" \
        '{type: $type, title: $title, repo: $repo, finding: $finding, transcript: $transcript, bookmarkUrls: $bookmark_urls}'
    )")
    TRANSCRIPT_PATHS+=("$transcript_path")

    ok "  [$job_type] done — transcript at $transcript_path"
}

for i in $(seq 0 $((JOB_COUNT - 1))); do
    job=$(echo "$JOBS" | jq ".[$i]")
    run_analysis "$job"
done

# ============================================================================
# PHASE 5: Build digest
# ============================================================================
log "Phase 5: Building digest..."

DIGEST_PATH="$DIGEST_DIR/${DATE_STAMP}-theories.md"

build_digest() {
    echo "# Theories — ${DATE_STAMP}"
    echo ""

    local idx=0
    for finding_json in "${FINDINGS[@]}"; do
        idx=$((idx + 1))
        local f_type f_title f_repo f_finding f_transcript f_urls
        f_type=$(echo "$finding_json" | jq -r '.type')
        f_title=$(echo "$finding_json" | jq -r '.title')
        f_repo=$(echo "$finding_json" | jq -r '.repo')
        f_finding=$(echo "$finding_json" | jq -r '.finding')
        f_transcript=$(echo "$finding_json" | jq -r '.transcript')
        f_urls=$(echo "$finding_json" | jq -r '.bookmarkUrls')

        local icon
        case "$f_type" in
            scan)    icon="🔒" ;;
            adopt)   icon="🔧" ;;
            pattern) icon="📐" ;;
            explore) icon="🚪" ;;
            *)       icon="📌" ;;
        esac

        cat <<ITEM

---

## ${icon} ${f_title} — ${f_repo}

${f_finding}

*Full session: ${f_transcript}*

ITEM
    done

    cat <<FOOTER

---

*Generated $(date "+%I:%M %p %Z") · Transcripts: ~/theories/transcripts/*
FOOTER
}

build_digest > "$DIGEST_PATH"
ok "Digest saved to $DIGEST_PATH"

# ── Build subject line ────────────────────────────────────────────────────
EMAIL_SUBJECT="Theories"
if [[ ${#FINDINGS[@]} -gt 0 ]]; then
    local_repos=()
    local_topics=()
    for finding_json in "${FINDINGS[@]}"; do
        s_repo=$(echo "$finding_json" | jq -r '.repo')
        s_finding=$(echo "$finding_json" | jq -r '.finding')
        already=false
        for r in "${local_repos[@]+"${local_repos[@]}"}"; do
            [[ "$r" == "$s_repo" ]] && already=true
        done
        $already || local_repos+=("$s_repo")
        # Extract bold lines (the plain-English summaries), skip FT-NNN headers
        topic=$(echo "$s_finding" | sed -n 's/^\*\*\([^*]*\)\*\*.*/\1/p' | head -1 | cut -c1-60)
        [[ -z "$topic" ]] && topic=$(echo "$s_finding" | grep -v '### FT-' | head -1 | cut -c1-60)
        [[ -n "$topic" ]] && local_topics+=("$topic")
    done
    repo_part=$(IFS=', '; echo "${local_repos[*]}")
    topics_part=""
    for t in "${local_topics[@]+"${local_topics[@]}"}"; do
        if [[ -z "$topics_part" ]]; then
            topics_part="$t"
        elif [[ ${#topics_part} -lt 120 ]]; then
            topics_part="${topics_part}, ${t}"
        fi
    done
    if [[ -n "$topics_part" ]]; then
        EMAIL_SUBJECT="Theories (${repo_part}) — ${topics_part}"
    else
        EMAIL_SUBJECT="Theories (${repo_part})"
    fi
fi

# ── Send email ────────────────────────────────────────────────────────────
SEND_SCRIPT="$SCRIPT_DIR/theories-send-email.js"
if [[ -n "$EMAIL_TO" && -f "$SEND_SCRIPT" ]]; then
    node "$SEND_SCRIPT" "$EMAIL_SUBJECT" "$EMAIL_TO" "$DIGEST_PATH" 2>&1 || {
        warn "Email send failed — digest saved at $DIGEST_PATH"
    }
elif [[ -z "$EMAIL_TO" ]]; then
    log "No email configured. Set FT_THEORIES_EMAIL or pass --email"
fi

# ============================================================================
# Done
# ============================================================================
ok "Done."
ok "  ${#FINDINGS[@]} analyses completed"
ok "  Transcripts: $TRANSCRIPT_DIR/"
ok "  Digest: $DIGEST_PATH"
[[ -n "$EMAIL_TO" ]] && ok "  Email: $EMAIL_TO"
ok "  Log: $RUN_LOG"
log "Run finished at $(date)"
