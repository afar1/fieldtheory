# X/Twitter Outreach Scanner — Claude Code Skill

## What This Does

Finds X/Twitter threads where developers discuss competitor voice transcription apps
(Superwhisper, Wispr Flow, MacWhisper, etc.) and presents clickable URLs for you to
reply with Field Theory mentions. Tracks what you've already seen so you never get repeats.

## How to Use

### Quick Start
```
python3 x-outreach-scanner/scan.py
```
This launches an interactive CLI. Type `help` to see commands.

### Core Workflow

1. **`scan`** — Generates a list of web searches to run. When you're in Claude Code,
   Claude will execute these searches using web search, find X/Twitter posts, and
   save new ones to the database via `ingest.py`.

2. **`urls`** — Shows unvisited threads with clickable links. Click to open in browser,
   reply on X, then come back and mark as visited.

3. **`visited 3`** — Marks thread #3 as replied to. Supports `visited 1,3,5` for bulk.

4. **`add "raycast dictation"`** — Adds a new search term. Next scan will include it.

5. **`terms`** — Shows all current search terms across categories.

### For Claude Code: Running a Scan

When the user says "scan" or "find new threads" or "search for mentions", do this:

1. Read the search terms: `python3 x-outreach-scanner/scan.py --queries`
2. Execute web searches for each query, focusing on x.com results
3. For each NEW post found (not already in data/seen.json), extract:
   - `url` — the x.com post URL  
   - `author` — who posted it
   - `summary` — 1-sentence description of the post
4. Save results: `python3 x-outreach-scanner/ingest.py --file results.json`
5. Show the user the new URLs: `python3 x-outreach-scanner/scan.py --urls`

### Key principle
- Skip any URLs already in `data/seen.json`
- Focus on posts where someone is asking questions, complaining, comparing, or looking for alternatives
- Prioritize posts with engagement (replies, views) over zero-engagement posts
- Prioritize recent posts (check config for lookback_days)

### File Structure
```
x-outreach-scanner/
  scan.py           — Main CLI (interactive + flags)
  ingest.py         — Save search results to database
  SKILL.md          — This file
  data/
    terms.json      — Search terms (editable, persists)
    seen.json       — Found URLs + visited status (persists)  
    config.json     — Settings (lookback days, product info)
```

### CLI Flags (non-interactive)
```
python3 scan.py --scan      # Print scan instructions
python3 scan.py --urls      # Show unvisited URLs
python3 scan.py --all       # Show all URLs
python3 scan.py --terms     # Show search terms
python3 scan.py --queries   # Show generated queries
python3 scan.py --stats     # Show statistics
python3 scan.py --export    # Plain-text URL export
python3 scan.py --add <t>   # Add search term
python3 scan.py -i          # Interactive mode
```

### Adding Search Terms

Terms are organized in categories in `data/terms.json`:
- **competitors** — App names to track (superwhisper, wispr flow, etc.)
- **pain_points** — Problem phrases (subscription expensive, voice coding, etc.)
- **intent_signals** — Phrases showing someone wants help (looking for, alternative to, etc.)
- **custom** — Your own terms added via the CLI

The scanner cross-multiplies these to generate search queries. Adding a competitor
automatically generates queries pairing it with existing pain points and signals.

### Lookback Window

Control how far back to search:
```
lookback 30     # Only last 30 days
lookback 180    # Last 6 months
```

### What Makes a Good Outreach Thread

Best opportunities (reply to these first):
- Someone asking "which voice app should I use?" 
- Someone frustrated with a competitor (bugs, pricing, cloud issues)
- Someone explicitly asking for a local/offline alternative
- Active threads with multiple replies (more visibility)

Avoid:
- Official competitor announcement posts (looks spammy)
- Threads older than ~3 months (too late)
- Zero-engagement posts from small accounts
