#!/usr/bin/env python3
"""
Download all unique author profile images from your X bookmarks.
Run from the field-theory/tools/cli directory:
    python3 scripts/fetch-profile-images.py
"""
import json, os, hashlib, urllib.request, urllib.error, sys, time, concurrent.futures

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLI_DIR = os.path.dirname(SCRIPT_DIR)
JSONL = os.path.join(CLI_DIR, 'automation', 'sources', 'x-bookmarks.jsonl')
PROFILE_DIR = os.path.join(CLI_DIR, 'automation', 'sources', 'x-bookmarks-media', 'profiles')
os.makedirs(PROFILE_DIR, exist_ok=True)

# Collect unique profile URLs mapped to author handle
profiles = {}
with open(JSONL) as f:
    for line in f:
        r = json.loads(line)
        url = r.get('authorProfileImageUrl')
        handle = r.get('authorHandle', 'unknown')
        if url and url not in profiles:
            profiles[url] = handle

print(f"Found {len(profiles)} unique author profile images")

already = set(os.listdir(PROFILE_DIR))
print(f"Already downloaded: {len(already)}")

def download_one(item):
    url, handle = item
    hi_res_url = url.replace('_normal.', '_400x400.')
    url_hash = hashlib.sha256(hi_res_url.encode()).hexdigest()[:12]
    ext = 'jpg' if '.jpg' in url else 'png'
    filename = f"{handle}-{url_hash}.{ext}"
    filepath = os.path.join(PROFILE_DIR, filename)

    if filename in already:
        return 'skipped'

    for attempt_url in [hi_res_url, url]:
        try:
            req = urllib.request.Request(attempt_url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=15)
            data = resp.read()
            with open(filepath, 'wb') as out:
                out.write(data)
            return 'downloaded'
        except Exception:
            continue
    return 'error'

downloaded = skipped = errors = 0
items = list(profiles.items())

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    futures = {pool.submit(download_one, item): item for item in items}
    for i, future in enumerate(concurrent.futures.as_completed(futures)):
        result = future.result()
        if result == 'downloaded': downloaded += 1
        elif result == 'skipped': skipped += 1
        else: errors += 1
        if (i + 1) % 200 == 0 or (i + 1) == len(items):
            print(f"  {i+1}/{len(items)} — downloaded: {downloaded}, skipped: {skipped}, errors: {errors}")

total_files = len(os.listdir(PROFILE_DIR))
total_size = sum(os.path.getsize(os.path.join(PROFILE_DIR, f)) for f in os.listdir(PROFILE_DIR))
print(f"\nDone! {total_files} profile images ({total_size / 1024 / 1024:.1f} MB)")
