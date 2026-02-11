# Field Theory — Daily Thread Finder

Run this shortcut on-demand to find fresh threads to engage with.

## Prompt (copy into Cowork or Claude)

```
Search for threads posted in the last 48 hours across Hacker News, Reddit, and Twitter/X that are relevant to Field Theory — a voice-first context stacking tool for developers who use AI coding assistants (Cursor, Claude Code, ChatGPT).

Field Theory's key features:
- Push-to-talk transcription (Option+Space) via local Whisper (whisper.cpp)
- Context stacking: combine voice + screenshots + commands into unified prompts
- Priority microphone lock on macOS
- Auto-improve: Claude refines rambling into structured prompts
- Portable .cursor/commands that work anywhere
- Verbal commands mid-transcription
- Cross-device sync (iPhone → Mac)
- The Librarian: surfaces patterns in engineering work
- 100% local transcription, privacy-first

Search these topics (do at least 10 web searches):
1. "voice coding" OR "voice input coding" — people discussing voice for dev workflows
2. "cursor voice" OR "cursor dictation" — Cursor users wanting voice input
3. "claude code" — Claude Code discussions and workflows
4. "whisper transcription" OR "local transcription" — transcription tool discussions
5. "superwhisper" OR "wispr flow" OR "macwhisper" — competitor mentions
6. "vibe coding" — the voice + AI coding workflow trend
7. "AI prompt workflow" OR "context engineering" — prompt/context building discussions
8. "macOS microphone" problems — people frustrated with mic switching
9. Reddit: r/cursor, r/ClaudeAI, r/LocalLLaMA, r/macapps new posts
10. Hacker News: "Show HN" voice/transcription/coding tools

Use hn.algolia.com API for Hacker News searches:
- https://hn.algolia.com/api/v1/search_by_date?query=voice+coding&tags=story
- https://hn.algolia.com/api/v1/search_by_date?query=cursor&tags=story
- https://hn.algolia.com/api/v1/search_by_date?query=whisper+transcription&tags=story

For each thread found, provide:
- Title and URL
- Platform (HN / Reddit / Twitter)
- Date posted
- Why it's relevant to Field Theory
- Suggested engagement angle (value-first, don't pitch directly)
- Priority: HIGH (direct match) / MEDIUM (adjacent topic) / LOW (ecosystem)

Organize results by priority. Only include threads from the last 48 hours. If a thread has fewer than 3 comments, note it as "early — good time to be first commenter."

Save the results as a markdown file.
```

## How to Use

1. Open Cowork (or any Claude interface)
2. Paste the prompt above
3. Review the results and pick 2-3 threads to engage with today
4. Follow the engagement principles from field-theory-engagement-threads.md
