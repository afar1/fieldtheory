# ft — Browser Bookmark Backfill Plan

## Goal

Add a **browser-backed historical bookmark backfill** path to `ft` for recovering older bookmarks that the X API does not expose.

This is **not** the primary daily sync path.
It is a bounded, occasional recovery tool.

Primary ongoing sync remains:
- API-based user-context bookmark sync

Backfill exists to:
- recover older historical bookmarks
- merge them into the same local corpus
- avoid relying on X API completeness

---

## Product stance

### Daily maintenance
Use API sync:
- `ft bookmarks sync`

### Historical recovery
Use browser backfill:
- `ft bookmarks backfill`

This keeps the architecture:
- stable for maintenance
- flexible for archive completeness

---

## Safety / anti-risk principles

The browser path should be designed to look as much like normal personal usage as possible.

### Do
- use the real logged-in browser profile/session
- use the same machine / same IP
- run slowly
- keep sessions bounded
- stop when no new content appears
- dedupe locally
- run manually first

### Do not
- run continuously by default
- use proxies / anti-detect browsers / stealth stacks as a first move
- run large unattended headless loops by default
- click into unnecessary pages
- hammer the site with aggressive interactions

---

## Command design

### Primary command
```bash
ft bookmarks backfill
```

### Options
```bash
ft bookmarks backfill --target-adds 500
ft bookmarks backfill --max-scrolls 75
ft bookmarks backfill --max-minutes 10
ft bookmarks backfill --stale-rounds 5
ft bookmarks backfill --profile user
```

### Intended defaults
- `target-adds`: 250
- `max-scrolls`: 75
- `max-minutes`: 10
- `stale-rounds`: 5
- `profile`: `user`

---

## Runtime model

Use host browser automation against the logged-in user browser profile.

### Why
- uses the user’s existing session
- looks like normal browser usage
- lower auth friction
- lower implementation complexity than building a new auth stack for browser scraping

### Browser target
Prefer:
- host browser
- `profile="user"`

---

## Extraction flow

### 1. Open bookmarks page
Navigate to:
- `https://x.com/i/bookmarks`

### 2. Verify logged-in state
If login wall or session issue appears:
- abort
- ask user to log in manually in that browser profile

### 3. Extract visible bookmark cards
For each visible bookmark card, try to collect:
- tweet id
- URL
- text content
- author handle/name if visible
- visible links/media hints if available
- `ingested_via=browser`
- `syncedAt`

### 4. Merge locally
Merge into:
- `automation/sources/x-bookmarks.jsonl`

Dedupe by:
- tweet id first
- URL fallback if needed

### 5. Scroll gently
After extraction:
- scroll one viewport or modest chunk
- wait for new content
- repeat

### 6. Stop when one of the stop conditions hits

---

## Stop conditions

Stop the backfill when any of these occurs:

### A. Target additions reached
Example:
- `target-adds = 250`

### B. Max scrolls reached
Example:
- `max-scrolls = 75`

### C. Max runtime reached
Example:
- `max-minutes = 10`

### D. Stale rounds reached
Meaning:
- repeated extraction cycles produced no new bookmark ids
- example threshold: `5`

### E. Suspicious browser state
If the UI shows:
- auth challenge
- unusual error interstitial
- rate-limiting wall
- blocked/blank behavior

Abort safely.

---

## Data model additions

Add provenance to bookmark records.

Example:
```json
{
  "id": "1900000000000000000",
  "tweetId": "1900000000000000000",
  "url": "https://x.com/user/status/1900000000000000000",
  "text": "...",
  "authorHandle": "user",
  "authorName": "User",
  "bookmarkedAt": null,
  "syncedAt": "2026-03-28T10:00:00Z",
  "ingestedVia": "browser"
}
```

Possible values:
- `api`
- `browser`

This helps debugging and dedupe.

---

## Merge behavior

### Rule
The local corpus is canonical.

Browser backfill should:
- read existing JSONL
- skip any known ids
- append only genuinely new bookmark records
- rewrite corpus in stable sorted order

### Sorting
Prefer descending by:
- `bookmarkedAt`
- fallback to `syncedAt`

---

## Browser extraction heuristics

The extraction logic should be conservative and robust.

### Prefer
- tweet/status URLs
- visible card text
- visible author metadata

### Avoid depending on
- brittle CSS class names when possible
- deep nested absolute selectors
- non-essential UI details

### Better targets
- stable links containing `/status/`
- role/text-based container detection where possible
- DOM text extraction from nearby nodes

---

## Recommended implementation order

### Phase 1 — manual bounded backfill
- command exists
- opens bookmarks page in logged-in browser profile
- extracts visible items
- scrolls + repeats
- writes new bookmark records locally
- prints summary

### Phase 2 — better diagnostics
- report:
  - scrolls performed
  - bookmarks seen
  - bookmarks newly added
  - stale rounds
  - stop reason

### Phase 3 — polish
- better extraction quality
- optional screenshot/debug mode
- stronger stop heuristics

---

## Output summary example

```text
Backfill complete.
- bookmarks seen: 412
- new bookmarks added: 187
- scrolls: 61
- stale rounds: 5
- stop reason: no new bookmarks found
- cache: /Users/afar/dev/field/automation/sources/x-bookmarks.jsonl
```

This is much clearer than just reporting corpus size.

---

## Cron policy

### Do not cron browser backfill by default.

Reason:
- more brittle
- more likely to create account/session friction
- not needed for day-to-day freshness

### Recommended cron setup
- API sync daily
- bookmark analysis job daily or morning digest
- browser backfill manual / occasional only

If browser automation later proves extremely stable, reconsider — but not as the first policy.

---

## Recommended next implementation step

Implement:
- `ft bookmarks backfill`

with:
- host browser
- `profile=user`
- bounded scroll loop
- extraction + local merge
- stop conditions
- provenance tagging

This gives `ft`:
- API sync for freshness
- browser backfill for completeness
- one unified local bookmark corpus
