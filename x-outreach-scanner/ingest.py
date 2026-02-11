#!/usr/bin/env python3
"""
Ingest search results into the outreach scanner database.

Usage:
  # Bulk ingest from JSON
  python3 ingest.py '[{"url":"...","author":"...","summary":"..."}]'
  
  # Ingest from a file
  python3 ingest.py --file results.json
  
  # Add a single URL
  python3 ingest.py --add "https://x.com/..." "author_name" "summary text"
  
  # Pipe from stdin
  echo '[{...}]' | python3 ingest.py --stdin
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
SEEN_FILE = DATA_DIR / "seen.json"

def load_seen():
    if SEEN_FILE.exists():
        with open(SEEN_FILE) as f:
            return json.load(f)
    return {"urls": {}, "last_scan": None}

def save_seen(data):
    DATA_DIR.mkdir(exist_ok=True)
    with open(SEEN_FILE, "w") as f:
        json.dump(data, f, indent=2)

def ingest(results):
    """Ingest a list of {url, author, summary, query?} dicts."""
    from datetime import datetime
    seen = load_seen()
    new_count = 0
    dupes = 0
    
    for r in results:
        url = r.get("url", "").strip()
        if not url:
            continue
        if url in seen["urls"]:
            dupes += 1
            continue
        seen["urls"][url] = {
            "author": r.get("author", ""),
            "summary": r.get("summary", ""),
            "query": r.get("query", ""),
            "found": datetime.now().isoformat(),
            "visited": False
        }
        new_count += 1
    
    seen["last_scan"] = datetime.now().isoformat()
    save_seen(seen)
    
    print(f"  ✓ Ingested {new_count} new URLs ({dupes} duplicates skipped)")
    print(f"  Total in database: {len(seen['urls'])}")
    return new_count

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    if sys.argv[1] == "--add" and len(sys.argv) >= 4:
        url = sys.argv[2]
        author = sys.argv[3] if len(sys.argv) > 3 else ""
        summary = sys.argv[4] if len(sys.argv) > 4 else ""
        query = sys.argv[5] if len(sys.argv) > 5 else ""
        ingest([{"url": url, "author": author, "summary": summary, "query": query}])
    
    elif sys.argv[1] == "--file" and len(sys.argv) >= 3:
        with open(sys.argv[2]) as f:
            data = json.load(f)
        ingest(data if isinstance(data, list) else [data])
    
    elif sys.argv[1] == "--stdin":
        data = json.load(sys.stdin)
        ingest(data if isinstance(data, list) else [data])
    
    else:
        # Try to parse first arg as JSON
        try:
            data = json.loads(sys.argv[1])
            ingest(data if isinstance(data, list) else [data])
        except json.JSONDecodeError:
            print(f"  Error: Could not parse JSON from argument.")
            print(f"  Usage: python3 ingest.py '<json array>'")
            sys.exit(1)
