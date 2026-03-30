# ft — Field Theory CLI

Local-first CLI for managing bookmarks, datasets, and daily generative idea sessions (Theories).

## Quick start

```bash
cd tools/cli
npm install
npm link          # makes `ft` available globally
```

## Data layout

All user data lives under `tools/cli/automation/` (gitignored):

```
tools/cli/
  automation/
    sources/                      # raw data + indexes
      x-bookmarks.jsonl           # bookmark cache (JSONL, one record per line)
      x-bookmarks.db              # FTS5 search index (SQLite, built from JSONL)
      x-bookmarks.meta.json       # sync metadata (timestamps, counts)
      x-bookmarks-media/          # downloaded media assets
      x-bookmarks-media-manifest.json
      x-oauth-token.json          # OAuth token (never committed)
    datasets/                     # dataset manifests (YAML)
    dataset-state/                # per-dataset artifacts and state
```

The Mac app stores its clipboard database separately at:
```
~/Library/Application Support/fieldtheory-mac/users/<user-id>/clipboard.db
```

## Commands

### Bookmarks

Sync and search your X/Twitter bookmarks locally.

```bash
# Full sync via Chrome session (needs Chrome logged into X)
ft bookmarks sync

# Build/rebuild the SQLite search index
ft bookmarks index

# Full-text search
ft bookmarks search "neural rendering"
ft bookmarks search "rust" --author elikiamerica --limit 5

# Visual dashboard
ft bookmarks viz

# One-step setup: sync + dataset init
ft bookmarks enable

# Show cache info
ft bookmarks status
ft bookmarks summary
ft bookmarks path
```

**Incremental sync** (for cron, uses OAuth v2 API instead of Chrome):
```bash
# Set X_API_KEY, X_API_SECRET, X_CLIENT_ID, X_CLIENT_SECRET in .env.local
ft bookmarks auth                      # one-time OAuth flow
ft bookmarks sync --incremental        # lightweight API sync
```

### Theories

Daily generative sessions that collide your bookmarks with active codebases, based on Steven Johnson's innovation framework.

```bash
# Full run (3 theories: exaptation, slow-hunch, adjacent-possible)
./theories.sh

# Single theory type
./theories.sh --theory-type exaptation

# Fewer turns per session
./theories.sh --theory-type slow-hunch --turns 3

# Preview pairings without running sessions
./theories.sh --dry-run

# Skip bookmark freshness check
./theories.sh --skip-sync
```

Requires `codex` CLI. Output goes to `~/theories/`:
```
~/theories/
  transcripts/    # full session transcripts (markdown)
  digests/        # daily digest summaries
  pairings/       # theory pairing JSON from matching phase
  logs/           # run logs
```

### Datasets

Register local repos or file collections for recurring AI review via OpenClaw.

```bash
ft dataset add-repo --id my-project --path ~/dev/my-project
ft dataset add-files --id notes --path ~/notes
ft dataset add-bookmarks --id x-bookmarks
ft dataset list
ft dataset show --id my-project
```

### Jobs

Schedule recurring dataset reviews.

```bash
ft job enable --id my-project --cron "0 7 * * *"
ft job list
ft job status --id my-project
ft job run --id my-project
```

## Development

```bash
npm run dev -- bookmarks search "test"   # run via tsx (no build needed)
npm run build                            # compile to dist/
npm run test                             # run tests
```

## Prerequisites

| Tool | Required for |
|------|-------------|
| Node.js 20+ | Everything |
| Google Chrome | `ft bookmarks sync` (reads session cookies) |
| `codex` CLI | `theories.sh` |
| `jq` | `theories.sh` |
