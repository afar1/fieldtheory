#!/usr/bin/env python3
"""Seed the scanner with URLs found in the current session."""

import json
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from ingest import ingest

seed_data = [
    {"url": "https://x.com/karpathy/status/1886192184808149383", "author": "Andrej Karpathy", "summary": "Coined 'vibe coding' — talks to Cursor via SuperWhisper, barely touches keyboard"},
    {"url": "https://x.com/karpathy/status/1889036923655860247", "author": "Andrej Karpathy", "summary": "Prefers fully offline apps, no data leaving machine. Wants to try MacWhisper for privacy"},
    {"url": "https://x.com/chrisalbon/status/1886192527491150256", "author": "Chris Albon", "summary": "Talking to Cursor with Superwhisper — rambled about CSS vibes and it worked"},
    {"url": "https://x.com/_skris/status/1960577768120574012", "author": "Sai Krishna", "summary": "Switched to superwhisper free tier. Complains about local model limits and $15/mo wisprflow pricing"},
    {"url": "https://x.com/jraad27/status/1944084687434969279", "author": "Jorge", "summary": "Superwhisper buggy after upgrading to Pro. Switched to Willow Voice for better speed/accuracy"},
    {"url": "https://x.com/nickgraynews/status/1995627585959497910", "author": "Nick Gray", "summary": "Switched from Wispr Flow to Superwhisper because of number-dictation bug in Flow"},
    {"url": "https://x.com/raw_works/status/1889063318989504662", "author": "Raymond Weitekamp", "summary": "Suggests Aqua Voice over superwhisper for hands-free vibe coding with Cursor"},
    {"url": "https://x.com/ayushtweetshere/status/1953429923869470838", "author": "Ayush", "summary": "Asks: Superwhisper or MacWhisper or WhisperFlow? Best voice dictation app for Mac? (8 replies)"},
    {"url": "https://x.com/nbashaw/status/1906221190429253840", "author": "Nathan Baschez", "summary": "Tips for vibe coding with superwhisper + push-to-talk shortcut + airpods setup"},
    {"url": "https://x.com/jspujji/status/1794008991963697616", "author": "Jesse Pujji", "summary": "Mac dictation sucks. Superwhisper is faster and rewrites speech to tight text"},
    {"url": "https://x.com/we4v3r/status/1952972581973442752", "author": "Joshua Weaver", "summary": "Tested Super Whisper as fix for Wispr not working with Termius. Prefers Wispr UI though"},
    {"url": "https://x.com/wesbos/status/2001673712588968424", "author": "Wes Bos", "summary": "Asks if Raycast launching dictation. MacOS dictation buggy, superwhisper has speed issues"},
    {"url": "https://x.com/superwhisperapp/status/1879623847047250029", "author": "Superwhisper (official)", "summary": "Leaving Setapp — frustrating for users, offering 33% discount for transition"},
    {"url": "https://x.com/superwhisperapp/status/1880320611920277815", "author": "Superwhisper (official)", "summary": "Ultra Cloud model issues — not returning results, needs app restart"},
    {"url": "https://x.com/bilawalsidhu/status/1940550340144775251", "author": "Bilawal Sidhu", "summary": "Wispr Flow amazing vs superwhisper. Asks: anything LOCAL that comes close to Flow UX?"},
    {"url": "https://x.com/deepfates/status/2009295329057702081", "author": "@deepfates", "summary": "Stop using subscription voice apps! Offline local models are better. Recommends Spokenly"},
    {"url": "https://x.com/alliekmiller/status/1969420607172292789", "author": "Allie K. Miller", "summary": "Voicepilled thread — lists Wispr Flow, Superwhisper, Otter as voice apps people use"},
    {"url": "https://x.com/TomFrankly/status/2006846830991282505", "author": "Thomas Frank", "summary": "Market crowded with voice apps. Need differentiation beyond Whisper wrappers"},
    {"url": "https://x.com/SnazzyLabs/status/1899935011635421381", "author": "Quinn Nelson (SnazzyLabs)", "summary": "Asks: MacWhisper or Superwhisper? Or something else? And why?"},
    {"url": "https://x.com/rowancheung/status/1971248376177107321", "author": "Rowan Cheung", "summary": "Voice-to-post workflow: Wispr Flow on phone → Claude → publish"},
    {"url": "https://x.com/WisprFlow/status/1962232071642050772", "author": "Steven Rouk (Wispr RT)", "summary": "Was a WisprFlow doubter, now converted. Likes custom terms, fn key, auto-punctuation"},
    {"url": "https://x.com/mattpocockuk/status/1972623915412308180", "author": "Matt Pocock", "summary": "Wispr Flow stopped working on Windows 11 — annual subscription wasted"},
    {"url": "https://x.com/zupbryy/status/1961788809517174896", "author": "bry", "summary": "Using Wispr Flow because Superwhisper had technical issues in their country (OpenAI geo issue)"},
    {"url": "https://x.com/heyandras/status/1951275099933323654", "author": "Andras Bacsai", "summary": "Tried Wispr Flow, built own local solution for offline + security"},
    {"url": "https://x.com/tayarndt/status/2008289631926714619", "author": "Taylor Arndt", "summary": "Building local system-wide dictation — MacWhisper for transcription but cloud. Wants on-device"},
    {"url": "https://x.com/WisprFlow/status/1899831678257820036", "author": "Wispr Flow (official)", "summary": "All new Wispr Flow announcement — 3.1M views, 116 replies. Mac and Windows"},
    {"url": "https://x.com/editblog/status/1900333225912000812", "author": "Scott Simmons", "summary": "Uses Wispr Flow daily, many times a day. Power user endorsement"},
    {"url": "https://x.com/lennysan/status/1991977985151537226", "author": "Lenny Rachitsky", "summary": "Free year of Wispr Flow Pro with newsletter subscription"},
    {"url": "https://x.com/jordibruin/status/1841138499119993204", "author": "Jordi Bruin", "summary": "MacWhisper 10.0 — Whisper Turbo, Ollama support, Groq support"},
    {"url": "https://x.com/jordibruin/status/1737456871882006579", "author": "Jordi Bruin", "summary": "MacWhisper Global mode — keyboard shortcut for system-wide transcription"},
    {"url": "https://x.com/forensico/status/1994090522495881712", "author": "Paolo Dal Checco", "summary": "MacWhisper Pro review — reliable, affordable, local transcription"},
    {"url": "https://x.com/jimmyjames_tech/status/1934972730308272221", "author": "@jimmyjames_tech", "summary": "MacStories: Tahoe speech-to-text outperforms MacWhisper V3 Turbo at comparable quality"},
    {"url": "https://x.com/IndianIdle/status/2000806236774936863", "author": "Ivan Mehta", "summary": "Wispr Flow now has localized Indian pricing — $3.5/mo vs $12/mo"},
    {"url": "https://x.com/WisprFlow/status/1912905904732979701", "author": "Wispr Flow (official)", "summary": "Students plan — cheaper + 3 months Pro free"},
    {"url": "https://x.com/oscarsuiza/status/1990845508458324063", "author": "Citizen Oscar", "summary": "MacWhisper brings Whisper locally — 99% accuracy, offline, privacy"},
    {"url": "https://x.com/WisprFlow/status/1889695960437244334", "author": "Wispr Flow (official)", "summary": "Flow + Warp integration for coding with voice"},
    {"url": "https://x.com/WisprFlow/status/1840757321615523893", "author": "Wispr Flow (official)", "summary": "Flow + Cursor combo video with McKay Wrigley"},
    {"url": "https://x.com/atulkumarzz/status/1899734482128928847", "author": "Atul Kumar", "summary": "Wispr Flow for Windows is LIVE — voice-first dictation and instant edits"},
    {"url": "https://x.com/superwhisperapp/status/1891671083788443952", "author": "Superwhisper (official)", "summary": "Announcing Superwhisper for Windows — signup rolling out"},
    {"url": "https://x.com/superwhisperapp/status/1867272449982943647", "author": "Superwhisper (official)", "summary": "v1.43 release — new Ultra Cloud model, Ultra V3 Turbo local, Medical model"},
    {"url": "https://x.com/superwhisperapp/status/1895714377854259570", "author": "Superwhisper (official)", "summary": "Hold shift to auto-send dictated message feature demo"},
    {"url": "https://x.com/superwhisperapp/status/1745211062176149624", "author": "Superwhisper (official)", "summary": "Superwhisper Raycast Extension launched"},
]

print(f"Seeding {len(seed_data)} URLs from today's research...\n")
ingest(seed_data)
