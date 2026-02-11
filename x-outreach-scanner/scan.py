#!/usr/bin/env python3
"""
Field Theory — X/Twitter Outreach Scanner
==========================================

Interactive CLI for finding competitor voice app discussions on X/Twitter.
Designed to run inside Claude Code with web search enabled.

State is persisted in data/ so results carry across sessions.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
TERMS_FILE = DATA_DIR / "terms.json"
SEEN_FILE = DATA_DIR / "seen.json"
CONFIG_FILE = DATA_DIR / "config.json"

# ── Persistence ───────────────────────────────────────────────────────────────

def load_json(path, default=None):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return default if default is not None else {}

def save_json(path, data):
    DATA_DIR.mkdir(exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_TERMS = {
    "competitors": [
        "superwhisper",
        "wispr flow",
        "wisprflow",
        "macwhisper",
        "mac whisper",
        "whisper flow",
        "aqua voice",
        "willow voice"
    ],
    "pain_points": [
        "voice dictation mac",
        "voice to text developer",
        "dictation app subscription expensive",
        "voice coding cursor",
        "local voice transcription",
        "offline dictation mac",
        "speech to text privacy",
        "vibe coding voice"
    ],
    "intent_signals": [
        "looking for",
        "anyone know",
        "best voice app",
        "alternative to",
        "switched from",
        "stopped working",
        "which should I use",
        "recommend voice"
    ],
    "custom": []
}

DEFAULT_CONFIG = {
    "lookback_days": 90,
    "product": {
        "name": "Field Theory",
        "url": "fieldtheory.dev",
        "features": [
            "Local voice transcription",
            "Portable commands",
            "Screenshot annotation",
            "Priority Mic",
            "No subscription"
        ]
    }
}

# ── Init ──────────────────────────────────────────────────────────────────────

def init():
    DATA_DIR.mkdir(exist_ok=True)
    if not TERMS_FILE.exists():
        save_json(TERMS_FILE, DEFAULT_TERMS)
    if not SEEN_FILE.exists():
        save_json(SEEN_FILE, {"urls": {}, "last_scan": None})
    if not CONFIG_FILE.exists():
        save_json(CONFIG_FILE, DEFAULT_CONFIG)

# ── Term Management ───────────────────────────────────────────────────────────

def get_terms():
    return load_json(TERMS_FILE, DEFAULT_TERMS)

def add_terms(new_terms, category="custom"):
    terms = get_terms()
    if category not in terms:
        terms[category] = []
    added = []
    for t in new_terms:
        t = t.strip().lower()
        if t and t not in terms[category]:
            terms[category].append(t)
            added.append(t)
    save_json(TERMS_FILE, terms)
    return added

def remove_terms(terms_to_remove, category="custom"):
    terms = get_terms()
    if category not in terms:
        return []
    removed = []
    for t in terms_to_remove:
        t = t.strip().lower()
        if t in terms[category]:
            terms[category].remove(t)
            removed.append(t)
    save_json(TERMS_FILE, terms)
    return removed

# ── URL Tracking ──────────────────────────────────────────────────────────────

def get_seen():
    return load_json(SEEN_FILE, {"urls": {}, "last_scan": None})

def add_found_urls(results):
    """Add newly found URLs. results = list of {url, author, summary, query}"""
    seen = get_seen()
    new_count = 0
    for r in results:
        url = r["url"]
        if url not in seen["urls"]:
            seen["urls"][url] = {
                "author": r.get("author", ""),
                "summary": r.get("summary", ""),
                "query": r.get("query", ""),
                "found": datetime.now().isoformat(),
                "visited": False
            }
            new_count += 1
    seen["last_scan"] = datetime.now().isoformat()
    save_json(SEEN_FILE, seen)
    return new_count

def mark_visited(indices):
    """Mark URL(s) by display index as visited."""
    seen = get_seen()
    entries = get_unvisited_entries(seen)
    marked = []
    for n in indices:
        if 1 <= n <= len(entries):
            url = entries[n - 1][0]
            seen["urls"][url]["visited"] = True
            seen["urls"][url]["visited_at"] = datetime.now().isoformat()
            marked.append(url)
    save_json(SEEN_FILE, seen)
    return marked

def get_unvisited_entries(seen=None):
    if seen is None:
        seen = get_seen()
    entries = [(url, meta) for url, meta in seen["urls"].items()
               if not meta.get("visited", False)]
    entries.sort(key=lambda x: x[1].get("found", ""), reverse=True)
    return entries

def get_all_entries():
    seen = get_seen()
    entries = list(seen["urls"].items())
    entries.sort(key=lambda x: x[1].get("found", ""), reverse=True)
    return entries

# ── Query Builder ─────────────────────────────────────────────────────────────

def build_queries():
    terms = get_terms()
    config = load_json(CONFIG_FILE, DEFAULT_CONFIG)
    queries = []

    for comp in terms.get("competitors", []):
        queries.append(f'{comp} site:x.com')

    for comp in terms.get("competitors", [])[:4]:
        for pain in terms.get("pain_points", [])[:3]:
            queries.append(f'"{comp}" {pain} site:x.com')

    for signal in terms.get("intent_signals", [])[:4]:
        for comp in terms.get("competitors", [])[:3]:
            queries.append(f'"{signal}" {comp} site:x.com')

    for custom in terms.get("custom", []):
        queries.append(f'{custom} site:x.com')
        for comp in terms.get("competitors", [])[:2]:
            queries.append(f'{custom} {comp} site:x.com')

    seen_q = set()
    unique = []
    for q in queries:
        if q not in seen_q:
            seen_q.add(q)
            unique.append(q)
    return unique

# ── Display ───────────────────────────────────────────────────────────────────

def show_header():
    print()
    print("━" * 60)
    print("  Field Theory — X Outreach Scanner")
    print("━" * 60)

def show_stats():
    seen = get_seen()
    terms = get_terms()
    config = load_json(CONFIG_FILE, DEFAULT_CONFIG)
    total = len(seen.get("urls", {}))
    visited = sum(1 for v in seen.get("urls", {}).values() if v.get("visited"))
    unvisited = total - visited
    n_terms = sum(len(v) for v in terms.values())
    print(f"\n  Found: {total} total, {unvisited} unvisited, {visited} replied")
    print(f"  Terms: {n_terms} across {len(terms)} categories")
    print(f"  Lookback: {config.get('lookback_days', 90)} days")
    last = seen.get("last_scan")
    if last:
        print(f"  Last scan: {last[:16]}")
    print()

def show_urls(only_unvisited=True):
    entries = get_unvisited_entries() if only_unvisited else get_all_entries()
    label = "Unvisited" if only_unvisited else "All"
    if not entries:
        print(f"\n  No {label.lower()} URLs. Run 'scan' to find threads.\n")
        return
    print(f"\n  {label} threads ({len(entries)}):\n")
    for i, (url, meta) in enumerate(entries, 1):
        author = meta.get("author", "?")
        summary = meta.get("summary", "")
        if len(summary) > 75:
            summary = summary[:72] + "..."
        visited_mark = " ✓" if meta.get("visited") else ""
        print(f"  {i:3d}. [{author}]{visited_mark}")
        print(f"       {summary}")
        print(f"       {url}")
        print()

def show_terms():
    terms = get_terms()
    for cat, tlist in terms.items():
        print(f"\n  [{cat}] ({len(tlist)})")
        for t in tlist:
            print(f"    • {t}")
    print()

def show_queries():
    queries = build_queries()
    print(f"\n  {len(queries)} queries built from your terms:\n")
    for i, q in enumerate(queries[:25], 1):
        print(f"  {i:3d}. {q}")
    if len(queries) > 25:
        print(f"\n  ... +{len(queries) - 25} more")
    print()

def show_help():
    print("""
  Commands:
    scan             Search X for new threads (needs Claude web search)
    urls             Show unvisited threads with clickable links
    all              Show all threads (including visited)
    visited <n>      Mark thread #n as visited/replied
    visited <n,m,p>  Mark multiple as visited
    add <term>       Add a custom search term
    remove <term>    Remove a custom search term
    terms            Show all search terms
    queries          Preview generated search queries
    lookback <days>  Set how far back to search
    stats            Show statistics
    export           Plain-text export of unvisited URLs
    reset            Clear all found URLs (fresh start)
    help             This message
    quit             Exit
""")

def export_urls():
    entries = get_unvisited_entries()
    if not entries:
        print("  Nothing to export.\n")
        return
    print(f"\n--- {len(entries)} unvisited threads ---\n")
    for url, meta in entries:
        author = meta.get("author", "?")
        summary = meta.get("summary", "")
        print(f"[{author}] {summary}")
        print(url)
        print()
    print("--- end ---\n")

# ── Scan Output (for Claude Code to execute) ──────────────────────────────────

def show_scan_prompt():
    """Output instructions for Claude Code to run web searches."""
    queries = build_queries()
    seen = get_seen()
    seen_urls = set(seen.get("urls", {}).keys())
    config = load_json(CONFIG_FILE, DEFAULT_CONFIG)
    lookback = config.get("lookback_days", 90)

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  SCAN: Execute these web searches and collect X/Twitter     ║
║  posts. For each result, I need: url, author, summary.      ║
║                                                              ║
║  Lookback: {lookback} days                                       ║
║  Already known: {len(seen_urls)} URLs (skip these)                   ║
╚══════════════════════════════════════════════════════════════╝

SEARCHES TO RUN:
""")
    for i, q in enumerate(queries, 1):
        print(f"  {i:3d}. {q}")

    if seen_urls:
        print(f"\nSKIP THESE KNOWN URLs ({len(seen_urls)}):")
        for u in sorted(seen_urls):
            print(f"  {u}")

    print(f"""
────────────────────────────────────────────────────────────────
AFTER SEARCHING: Save new results by running:

  python3 {Path(__file__).parent}/ingest.py '<JSON array>'

Where JSON array = [{{"url":"...","author":"...","summary":"..."}}]

Or add them one at a time:
  python3 {Path(__file__).parent}/ingest.py --add '<url>' '<author>' '<summary>'
────────────────────────────────────────────────────────────────
""")

# ── Interactive Loop ──────────────────────────────────────────────────────────

def interactive():
    init()
    show_header()
    show_stats()
    show_help()

    while True:
        try:
            raw = input("  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  Bye!\n")
            break

        if not raw:
            continue

        parts = raw.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd in ("quit", "exit", "q"):
            print("  Bye!\n")
            break
        elif cmd == "help":
            show_help()
        elif cmd == "stats":
            show_stats()
        elif cmd == "urls":
            show_urls(only_unvisited=True)
        elif cmd == "all":
            show_urls(only_unvisited=False)
        elif cmd == "terms":
            show_terms()
        elif cmd == "queries":
            show_queries()
        elif cmd == "scan":
            show_scan_prompt()
        elif cmd == "export":
            export_urls()
        elif cmd == "add" and arg:
            added = add_terms([arg])
            print(f"  ✓ Added: {arg}" if added else "  Already exists.")
        elif cmd == "remove" and arg:
            removed = remove_terms([arg])
            print(f"  ✓ Removed: {arg}" if removed else "  Not found in custom terms.")
        elif cmd == "lookback" and arg:
            try:
                days = int(arg)
                config = load_json(CONFIG_FILE, DEFAULT_CONFIG)
                config["lookback_days"] = days
                save_json(CONFIG_FILE, config)
                print(f"  ✓ Lookback: {days} days")
            except ValueError:
                print("  Usage: lookback <number>")
        elif cmd == "visited" and arg:
            try:
                indices = [int(x.strip()) for x in arg.split(",")]
                marked = mark_visited(indices)
                for u in marked:
                    print(f"  ✓ {u}")
                if not marked:
                    print("  No valid indices.")
            except ValueError:
                print("  Usage: visited <n> or visited <n,m,p>")
        elif cmd == "reset":
            save_json(SEEN_FILE, {"urls": {}, "last_scan": None})
            print("  ✓ Reset. All URLs cleared.")
        else:
            print(f"  Unknown: {raw}  (type 'help')")

# ── CLI flags ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init()
    if len(sys.argv) > 1:
        flag = sys.argv[1]
        if flag == "--scan":     show_scan_prompt()
        elif flag == "--urls":   show_urls(True)
        elif flag == "--all":    show_urls(False)
        elif flag == "--terms":  show_terms()
        elif flag == "--queries":show_queries()
        elif flag == "--stats":  show_stats()
        elif flag == "--export": export_urls()
        elif flag == "--add":    
            added = add_terms(sys.argv[2:])
            print(f"Added: {', '.join(added)}" if added else "Already exists.")
        elif flag == "--interactive" or flag == "-i":
            interactive()
        else:
            print(f"Unknown: {flag}")
            print("Flags: --scan --urls --all --terms --queries --stats --export --add <t> -i")
    else:
        interactive()
