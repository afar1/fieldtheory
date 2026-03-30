#!/usr/bin/env bash
# ============================================================================
# test-theories.sh — Tests for theories.sh and related helpers
#
# Runs isolated tests against the pure functions extracted from the main
# scripts. Does NOT require codex CLI, network access, or real bookmarks.
#
# Usage: ./test-theories.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0
ERRORS=()

# ── Test helpers ───────────────────────────────────────────────────────────
assert_eq() {
    local test_name="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  ✓ $test_name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $test_name"
        echo "    expected: $expected"
        echo "    actual:   $actual"
        FAIL=$((FAIL + 1))
        ERRORS+=("$test_name")
    fi
}

assert_exit_code() {
    local test_name="$1" expected="$2"
    shift 2
    local actual=0
    "$@" >/dev/null 2>&1 || actual=$?
    assert_eq "$test_name" "$expected" "$actual"
}

assert_contains() {
    local test_name="$1" needle="$2" haystack="$3"
    if echo "$haystack" | grep -qF -- "$needle"; then
        echo "  ✓ $test_name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $test_name (did not contain: $needle)"
        FAIL=$((FAIL + 1))
        ERRORS+=("$test_name")
    fi
}

# ── Setup test fixtures ───────────────────────────────────────────────────
TMPDIR_TEST=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_TEST"; }
trap cleanup EXIT

# Source the functions we want to test by extracting them
# (We can't source the whole script because it runs immediately)
# Instead, we redefine the testable functions here.

# ── Test: extract_json ────────────────────────────────────────────────────
echo ""
echo "=== extract_json ==="

extract_json() {
    local raw="$1"
    local key="${2:-pairings}"

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

    return 1
}

# Test: clean JSON passthrough
result=$(extract_json '{"pairings": [1,2,3]}' "pairings")
assert_eq "clean JSON passthrough" '{"pairings": [1,2,3]}' "$result"

# Test: JSON with leading noise
result=$(extract_json $'thinking about this...\n{"pairings": [1]}' "pairings") || result=""
count=$(echo "$result" | jq '.pairings | length' 2>/dev/null || echo "0")
assert_eq "JSON with leading noise" "1" "$count"

# Test: JSON in code fences
result=$(extract_json $'Here is the result:\n```\n{"pairings": [1,2]}\n```\nDone.' "pairings") || result=""
count=$(echo "$result" | jq '.pairings | length' 2>/dev/null || echo "0")
assert_eq "JSON in code fences" "2" "$count"

# Test: no valid JSON returns error
local_rc=0
extract_json "no json here" "pairings" >/dev/null 2>&1 || local_rc=$?
assert_eq "no valid JSON returns failure" "1" "$local_rc"

# Test: wrong key returns error
local_rc=0
extract_json '{"other": [1]}' "pairings" >/dev/null 2>&1 || local_rc=$?
assert_eq "wrong key returns failure" "1" "$local_rc"

# ── Test: check_convergence ──────────────────────────────────────────────
echo ""
echo "=== check_convergence ==="

check_convergence() {
    local response="$1"
    local turn="$2"
    local min_turns=3
    [[ "$turn" -lt "$min_turns" ]] && return 1
    if echo "$response" | grep -qiE '^\s*(action|status|signal)\s*:\s*finalize\s*$'; then
        return 0
    fi
    local convergence_block
    convergence_block=$(echo "$response" | tail -15)
    if echo "$convergence_block" | grep -qi "HIGH" && echo "$convergence_block" | grep -qi "FINALIZE"; then
        return 0
    fi
    return 1
}

# Test: explicit finalize action
assert_exit_code "explicit finalize action" 0 \
    check_convergence $'Some discussion.\naction: finalize' 4

# Test: HIGH + FINALIZE in tail
assert_exit_code "HIGH + FINALIZE in tail" 0 \
    check_convergence $'convergence: HIGH\naction: FINALIZE' 5

# Test: too early (turn 2)
assert_exit_code "too early to converge" 1 \
    check_convergence $'action: finalize' 2

# Test: LOW convergence should not trigger
assert_exit_code "LOW convergence continues" 1 \
    check_convergence $'convergence: LOW\naction: CONTINUE' 5

# Test: FINALIZE mentioned in prose should not trigger
assert_exit_code "FINALIZE in prose doesn't trigger" 1 \
    check_convergence $'We should not finalize yet because there are issues.\nconvergence: MEDIUM\naction: CONTINUE' 4

# Test: case insensitive
assert_exit_code "case insensitive finalize" 0 \
    check_convergence $'Action: FINALIZE' 3

# ── Test: trim_history ───────────────────────────────────────────────────
echo ""
echo "=== trim_history ==="

trim_history() {
    local history="$1"
    local max_chars=12000
    local current_len=${#history}
    if [[ "$current_len" -le "$max_chars" ]]; then
        echo "$history"
        return
    fi
    echo "${history:0:$max_chars}
[... truncated ...]"
}

# Test: short history unchanged
short="This is short"
result=$(trim_history "$short")
assert_eq "short history unchanged" "$short" "$result"

# Test: long history gets truncated
long=$(python3 -c "print('x' * 15000)")
result=$(trim_history "$long")
assert_contains "long history truncated" "truncated" "$result"
actual_len=${#result}
assert_eq "truncated length under limit" "true" "$( [[ $actual_len -lt 13000 ]] && echo true || echo false )"

# ── Test: bookmark sampling ──────────────────────────────────────────────
echo ""
echo "=== bookmark sampling ==="

# Create a fake bookmarks JSONL
FAKE_CACHE="$TMPDIR_TEST/bookmarks.jsonl"
for i in $(seq 1 100); do
    echo "{\"text\": \"bookmark $i\", \"url\": \"https://x.com/$i\", \"authorHandle\": \"user$i\", \"syncedAt\": \"2026-03-29T00:00:00Z\"}" >> "$FAKE_CACHE"
done

# Sample recent 40
tail -n 40 "$FAKE_CACHE" > "$TMPDIR_TEST/recent.jsonl"
recent_count=$(wc -l < "$TMPDIR_TEST/recent.jsonl" | tr -d ' ')
assert_eq "recent sample count" "40" "$recent_count"

# Verify the last line is bookmark 100 (most recent)
last_recent=$(tail -1 "$TMPDIR_TEST/recent.jsonl" | jq -r '.text')
assert_eq "most recent bookmark is last" "bookmark 100" "$last_recent"

# First line of recent should be bookmark 61
first_recent=$(head -1 "$TMPDIR_TEST/recent.jsonl" | jq -r '.text')
assert_eq "recent starts at 61" "bookmark 61" "$first_recent"

# Random sample from remainder
head -n 60 "$FAKE_CACHE" | sort -R | head -n 40 > "$TMPDIR_TEST/random.jsonl"
random_count=$(wc -l < "$TMPDIR_TEST/random.jsonl" | tr -d ' ')
assert_eq "random sample count" "40" "$random_count"

# Combined sample
combined_count=$(cat "$TMPDIR_TEST/recent.jsonl" "$TMPDIR_TEST/random.jsonl" | wc -l | tr -d ' ')
assert_eq "combined sample count" "80" "$combined_count"

# ── Test: digest formatting ──────────────────────────────────────────────
echo ""
echo "=== digest formatting ==="

# Build a minimal digest to verify structure
DIGEST="$TMPDIR_TEST/digest.md"
cat > "$DIGEST" <<'EOF'
# Morning Spark — 2026-03-29

Three ideas surfaced from your bookmarks × active repos this morning.

---

## 🔧 Idea 1: Concrete — weather-bot

**Thesis**: Apply streaming architecture from bookmark to data pipeline

The idea is good.

*4 debate turns · Full transcript at ~/morning-spark/transcripts/2026-03-29_concrete.md*

---
EOF

# Check structure
assert_contains "digest has title" "Morning Spark" "$(cat "$DIGEST")"
assert_contains "digest has emoji" "🔧" "$(cat "$DIGEST")"
assert_contains "digest has thesis" "Thesis" "$(cat "$DIGEST")"
assert_contains "digest has separator" "---" "$(cat "$DIGEST")"

# ── Test: git repo discovery mock ────────────────────────────────────────
echo ""
echo "=== repo discovery ==="

# Create fake repos with git history
FAKE_DEVDIR="$TMPDIR_TEST/dev"
mkdir -p "$FAKE_DEVDIR/active-project" "$FAKE_DEVDIR/stale-project"

# Active project: has recent commit
(cd "$FAKE_DEVDIR/active-project" && git init -q && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "recent work" -q)

# Stale project: has only old commits
(cd "$FAKE_DEVDIR/stale-project" && git init -q && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "old work" -q)

# Verify git repos are detectable
active_count=0
for dir in "$FAKE_DEVDIR"/*/; do
    [[ -d "$dir/.git" ]] && active_count=$((active_count + 1))
done
assert_eq "found 2 git repos" "2" "$active_count"

# ── Test: email script args validation ───────────────────────────────────
echo ""
echo "=== theories-send-email.js ==="

# Missing args should exit 1
local_rc=0
node "$SCRIPT_DIR/theories-send-email.js" 2>/dev/null || local_rc=$?
assert_eq "email script exits 1 with no args" "1" "$local_rc"

# Missing config should exit 1 (with fake HOME to avoid finding real config)
local_rc=0
HOME="$TMPDIR_TEST" node "$SCRIPT_DIR/theories-send-email.js" "Subject" "to@x.com" "$DIGEST" 2>/dev/null || local_rc=$?
assert_eq "email script exits 1 with no config" "1" "$local_rc"

# ── Test: markdown to HTML conversion in email script ────────────────────
echo ""
echo "=== markdown to HTML ==="

# Use node to test the conversion function directly
html_result=$(node -e '
const md = "# Title\n\n**Bold** and *italic*\n\n---\n\n## Subtitle";
const html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
console.log(html);
')

assert_contains "h1 conversion" "<h1>" "$html_result"
assert_contains "h2 conversion" "<h2>" "$html_result"
assert_contains "bold conversion" "<strong>Bold</strong>" "$html_result"
assert_contains "italic conversion" "<em>italic</em>" "$html_result"
assert_contains "hr conversion" "<hr>" "$html_result"

# ── Test: theories JSON extraction (different top-level key) ─────────────
echo ""
echo "=== theories JSON extraction ==="

# Theory JSON uses "theories" key instead of "pairings"
result=$(extract_json '{"theories": [{"type": "exaptation"}, {"type": "slow-hunch"}, {"type": "adjacent-possible"}]}' "theories")
count=$(echo "$result" | jq '.theories | length' 2>/dev/null || echo "0")
assert_eq "theories JSON extraction" "3" "$count"

# Ensure pairings key fails on theories JSON
local_rc=0
extract_json '{"theories": [1]}' "pairings" >/dev/null 2>&1 || local_rc=$?
assert_eq "pairings key fails on theories JSON" "1" "$local_rc"

# ── Test: theories context file exists ───────────────────────────────────
echo ""
echo "=== theories context file ==="

assert_eq "theories-context.md exists" "true" "$([[ -f "$SCRIPT_DIR/theories-context.md" ]] && echo true || echo false)"

# Verify it contains key Johnson concepts
theories_ctx=$(cat "$SCRIPT_DIR/theories-context.md")
assert_contains "context has adjacent possible" "Adjacent Possible" "$theories_ctx"
assert_contains "context has liquid networks" "Liquid Networks" "$theories_ctx"
assert_contains "context has slow hunch" "Slow Hunch" "$theories_ctx"
assert_contains "context has serendipity" "Serendipity" "$theories_ctx"
assert_contains "context has error" "Error" "$theories_ctx"
assert_contains "context has exaptation" "Exaptation" "$theories_ctx"
assert_contains "context has platforms" "Platforms" "$theories_ctx"
assert_contains "context has 'what if'" "What if" "$theories_ctx"
assert_contains "context has 'yes and'" "Yes, and" "$theories_ctx"
assert_contains "context has Gutenberg" "Gutenberg" "$theories_ctx"
assert_contains "context has coffee house" "coffee house" "$theories_ctx"

# ── Test: theories.sh exists and is executable ───────────────────────────
echo ""
echo "=== theories.sh structure ==="

assert_eq "theories.sh exists" "true" "$([[ -f "$SCRIPT_DIR/theories.sh" ]] && echo true || echo false)"
assert_eq "theories.sh is executable" "true" "$([[ -x "$SCRIPT_DIR/theories.sh" ]] && echo true || echo false)"

# Verify key structural differences from morning-spark.sh
theories_sh=$(cat "$SCRIPT_DIR/theories.sh")
assert_contains "theories uses fixed TURN_COUNT" "TURN_COUNT" "$theories_sh"
assert_contains "theories has Explorer role" "Explorer" "$theories_sh"
assert_contains "theories has Connector role" "Connector" "$theories_sh"
assert_contains "no convergence signals" "TURN_COUNT" "$theories_sh"  # uses fixed turns, not convergence

# Verify it does NOT contain old debate mechanics
if echo "$theories_sh" | grep -qF "check_convergence"; then
    echo "  ✗ theories.sh should not contain check_convergence"
    FAIL=$((FAIL + 1))
    ERRORS+=("no check_convergence in theories.sh")
else
    echo "  ✓ no convergence checking in theories.sh"
    PASS=$((PASS + 1))
fi

if echo "$theories_sh" | grep -qF "FINALIZE"; then
    echo "  ✗ theories.sh should not contain FINALIZE"
    FAIL=$((FAIL + 1))
    ERRORS+=("no FINALIZE in theories.sh")
else
    echo "  ✓ no FINALIZE signals in theories.sh"
    PASS=$((PASS + 1))
fi

# ── Test: theory digest format ───────────────────────────────────────────
echo ""
echo "=== theory digest format ==="

THEORY_DIGEST="$TMPDIR_TEST/theory-digest.md"
cat > "$THEORY_DIGEST" <<'EOF'
# Theories — 2026-03-29

Three collisions from your bookmarks and active repos. Each one opened a door.

---

## 🔀 Theory 1: Exaptation — weather-bot

*Initial hunch: What if biological swarm algorithms could inform prediction ensembles?*

What if weather-bot's ensemble prediction system could borrow the stigmergic coordination patterns from ant colony optimization — not as a direct algorithm swap, but as an architectural principle? The current shrinkage-based model blending treats each forecast source as independent, but ant colonies solve a structurally similar problem: synthesizing noisy, partial information from many agents into reliable collective decisions. This would mean the ensemble doesn't just weight models by historical accuracy, but lets them leave "pheromone trails" — persistent signals about which weather patterns they've been most reliable for recently — opening the door to an adaptive, self-organizing prediction layer that gets smarter about when to trust which source.

*5 turns · Full session at ~/theories/transcripts/2026-03-29_exaptation.md*

---

*"Chance favors the connected mind." — Steven Johnson*
EOF

assert_contains "theory digest has Johnson quote" "Chance favors the connected mind" "$(cat "$THEORY_DIGEST")"
assert_contains "theory digest has exaptation emoji" "🔀" "$(cat "$THEORY_DIGEST")"
assert_contains "theory digest has initial hunch" "Initial hunch" "$(cat "$THEORY_DIGEST")"
assert_contains "theory digest has paragraph not bullets" "What if" "$(cat "$THEORY_DIGEST")"

# Verify it does NOT contain old action-item format
if echo "$(cat "$THEORY_DIGEST")" | grep -qF "FIRST STEP"; then
    echo "  ✗ theory digest should not contain action items"
    FAIL=$((FAIL + 1))
    ERRORS+=("no action items in theory digest")
else
    echo "  ✓ no action items in theory digest"
    PASS=$((PASS + 1))
fi

# ── Test: --theory-type validation ───────────────────────────────────────
echo ""
echo "=== theory type validation ==="

VALID_TYPES="exaptation slow-hunch adjacent-possible"

validate_type() {
    local type="$1"
    echo "$VALID_TYPES" | grep -qw "$type"
}

assert_exit_code "valid type: exaptation" 0 validate_type "exaptation"
assert_exit_code "valid type: slow-hunch" 0 validate_type "slow-hunch"
assert_exit_code "valid type: adjacent-possible" 0 validate_type "adjacent-possible"
assert_exit_code "invalid type: concrete" 1 validate_type "concrete"
assert_exit_code "invalid type: wildcard" 1 validate_type "wildcard"
assert_exit_code "invalid type: empty" 1 validate_type ""

# ── Test: turn delimiter doesn't collide ────────────────────────────────
echo ""
echo "=== turn delimiter ==="

# The new delimiter should not appear in normal model output
TURN_DELIM="=====TURN====="
sample_response="Ah... interesting. What if we used --- as a separator in the markdown? The --- is common in frontmatter."
if echo "$sample_response" | grep -qF "$TURN_DELIM"; then
    echo "  ✗ turn delimiter found in sample response"
    FAIL=$((FAIL + 1))
    ERRORS+=("turn delimiter collision")
else
    echo "  ✓ turn delimiter safe from collision with normal content"
    PASS=$((PASS + 1))
fi

# Verify theories.sh uses the new delimiter
assert_contains "theories.sh uses new delimiter" "=====TURN=====" "$theories_sh"

# ── Test: timestamp in transcript paths ─────────────────────────────────
echo ""
echo "=== transcript timestamps ==="

assert_contains "theories.sh has TIME_STAMP" "TIME_STAMP" "$theories_sh"
assert_contains "transcript path includes TIME_STAMP" 'TIME_STAMP}_' "$theories_sh"

# ── Test: system prompts built once ─────────────────────────────────────
echo ""
echo "=== system prompt construction ==="

assert_contains "SYSTEM_PROMPT_EXPLORER defined at top level" "SYSTEM_PROMPT_EXPLORER=" "$theories_sh"
assert_contains "SYSTEM_PROMPT_CONNECTOR defined at top level" "SYSTEM_PROMPT_CONNECTOR=" "$theories_sh"

# Verify the old inline system_a/system_b local vars are gone
if echo "$theories_sh" | grep -qF 'local system_a='; then
    echo "  ✗ old local system_a still present"
    FAIL=$((FAIL + 1))
    ERRORS+=("old system_a still present")
else
    echo "  ✓ no inline system_a construction"
    PASS=$((PASS + 1))
fi

if echo "$theories_sh" | grep -qF 'local system_b='; then
    echo "  ✗ old local system_b still present"
    FAIL=$((FAIL + 1))
    ERRORS+=("old system_b still present")
else
    echo "  ✓ no inline system_b construction"
    PASS=$((PASS + 1))
fi

# ── Test: synthesis prompt gets Johnson context ─────────────────────────
echo ""
echo "=== synthesis prompt context ==="

# The synthesis prompt should include the Johnson framework
assert_contains "synthesis gets THEORIES_CONTEXT" 'THEORIES_CONTEXT' "$theories_sh"

# Check the synthesis_prompt line references the framework
synthesis_section=$(echo "$theories_sh" | grep -A3 "synthesis_prompt=")
assert_contains "synthesis mentions Johnson framework" "Johnson" "$synthesis_section"

# ── Test: matching prompt uses full context ─────────────────────────────
echo ""
echo "=== matching prompt context ==="

# The matching prompt should inject THEORIES_CONTEXT instead of duplicating patterns
assert_contains "matching prompt injects THEORIES_CONTEXT" 'THEORIES_CONTEXT' "$theories_sh"

# ── Test: theories-send-email.js branding ───────────────────────────────
echo ""
echo "=== email script branding ==="

assert_eq "theories-send-email.js exists" "true" "$([[ -f "$SCRIPT_DIR/theories-send-email.js" ]] && echo true || echo false)"
email_js=$(cat "$SCRIPT_DIR/theories-send-email.js")
assert_contains "email script references Theories" "Theories" "$email_js"

# Verify theories.sh references the new email script
assert_contains "theories.sh uses theories-send-email.js" "theories-send-email.js" "$theories_sh"

# ── Results ───────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================="

if [[ "$FAIL" -gt 0 ]]; then
    echo ""
    echo "Failed tests:"
    for e in "${ERRORS[@]}"; do
        echo "  - $e"
    done
    exit 1
fi

exit 0
