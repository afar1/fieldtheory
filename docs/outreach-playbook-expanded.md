# Field Theory — Expanded Outreach Playbook (Part 2)
## 20 More Real Posts to Reply To

Same strategy as before: show up where people are frustrated, be helpful, mention Field Theory naturally.

**🆕 Updated today (Feb 6, 2026):** Checked for fresh threads — several new ones found on GitHub and Cursor Forum.

---

## 🎙️ VOICE / DICTATION THREADS (continued)

### 11. Cursor Forum: "Any good Speech to text?"
**URL:** https://forum.cursor.com/t/any-good-speech-to-text/98319
**Context:** Developer is "so tired of writing letters using AI" and wants good voice-to-text that won't drive them crazy. Active discussion thread.

**Draft reply:**
> I got tired of the same thing and built Field Theory — local Whisper transcription, works in Cursor and any other text field. No cloud, no lag. Hit a shortcut, talk, it pastes.
>
> The auto-improve feature cleans up your spoken words so they read like typed prompts — removes the "uh"s and tightens everything up before it hits the input field.
>
> Free to try: https://fieldtheory.dev

---

### 12. Cursor Forum: "Voice Input broke in recent update"
**URL:** https://forum.cursor.com/t/voice-input-broke-in-recent-update/146605
**Context:** Dec 2025 — user's voice input was working fine until a Cursor update broke it. Same issue on Linux and Mac.

**Draft reply:**
> This is the downside of relying on the IDE's built-in voice — when they update, it can break. I built Field Theory specifically to avoid this: it runs external Whisper transcription that works in any text field. Since it doesn't depend on Cursor's audio implementation at all, IDE updates can't touch it.
>
> https://fieldtheory.dev (free tier, Mac/Apple Silicon)

---

### 13. Cursor Forum: "Voice mode - doesn't work"
**URL:** https://forum.cursor.com/t/voice-mode-doesnt-work/139506
**Context:** Oct 2025 — Windows user reporting voice mode toggle is completely broken.

**Draft reply:**
> Mac-only solution, but if you're on macOS: Field Theory does external Whisper-based transcription that works in Cursor and everywhere else. Doesn't depend on Cursor's built-in voice at all, so it never breaks on updates. https://fieldtheory.dev

---

### 14. Cursor Forum: "Voice mode - cannot submit"
**URL:** https://forum.cursor.com/t/voice-mode-cannot-submit/138974
**Context:** Oct 2025 — User can talk and see the "jiggling" indicator but has no way to submit the message. Calls the experience "very underwhelming."

**Draft reply:**
> Yeah the UX of Cursor's built-in voice feels unfinished. I built Field Theory to work differently: hold a shortcut, speak, release — text appears immediately in whatever input field you're in. No submit button, no jiggling thing. Just transcribed text ready to send.
>
> Also does auto-improve to clean up your spoken words before pasting. https://fieldtheory.dev

---

### 15. Cursor Forum: "Feature Request: Voice Input for Coding and Comments"
**URL:** https://forum.cursor.com/t/feature-request-voice-input-for-coding-and-comments/136140
**Context:** Oct 2025 — Detailed feature request for voice input with a buffer mechanism.

**Draft reply:**
> I built something that covers most of this. Field Theory does local Whisper transcription, works in any text field (Cursor included), and has an auto-improve mode that acts as a natural buffer — it cleans up your spoken input before pasting.
>
> The key advantage: it's IDE-independent, so your voice workflow works the same in Cursor, Claude, ChatGPT, or a terminal. https://fieldtheory.dev

---

### 16. 🆕 GitHub Issue: "Claude Code hangs/freezes when using voice dictation input"
**URL:** https://github.com/anthropics/claude-code/issues/20476
**Context:** Jan 23, 2026 (2 weeks ago!) — Claude Code becomes unresponsive when using macOS dictation. User had to ctrl-c to recover.

**Draft reply:**
> I ran into similar issues with macOS dictation and Claude Code. Built Field Theory partly because of this — it does its own Whisper transcription externally and pastes the finished text, so Claude Code just sees normal keyboard input. No special characters or Unicode weirdness that causes hangs.
>
> https://fieldtheory.dev (free tier)

---

### 17. 🆕 GitHub Issue: "Voice input software (AquaVoice) stopped working with Claude Code on Windows"
**URL:** https://github.com/anthropics/claude-code/issues/20570
**Context:** Jan 24, 2026 (2 weeks ago!) — AquaVoice can't inject text into Claude Code's terminal in Cursor. Works fine in standalone PowerShell.

**Draft reply:**
> Mac-only, but for macOS users hitting similar issues: Field Theory transcribes locally and pastes as plain text into any input, including terminals. Since it uses standard text injection rather than relying on accessibility APIs that terminals can block, it works reliably across contexts.
>
> https://fieldtheory.dev

---

### 18. 🆕 GitHub Issue: "Chat → Code session handoff (voice brainstorm to repo execution)"
**URL:** https://github.com/anthropics/claude-code/issues/21128
**Context:** Jan 27, 2026 (10 days ago!) — User brainstorms via Claude iOS voice then wants to execute in Claude Code. No bridge exists.

**Draft reply:**
> Interesting workflow. On the Mac side, Field Theory's screenshot stacking might help bridge this — you can screenshot your Claude chat brainstorm, draw annotations highlighting the key decisions, then paste the annotated context into Claude Code. Not a true session handoff, but gets the visual context across.
>
> The voice transcription also works in both contexts (Claude web and terminal), so at least the input method is consistent. https://fieldtheory.dev

---

### 19. 🆕 GitHub Issue: "Allow remapping ESC keybinding" (for push-to-talk)
**URL:** https://github.com/anthropics/claude-code/issues/16176
**Context:** Jan 3, 2026 — ESC keybinding conflicts with push-to-talk voice input tools.

**Draft reply:**
> This bit me too. Field Theory uses a configurable keyboard shortcut for push-to-talk that avoids ESC entirely — no conflicts with Claude Code's rewind. Hold your shortcut, speak, release, text appears. https://fieldtheory.dev

---

### 20. 🆕 GitHub Issue: "Claude Code flag to signal accessibility features"
**URL:** https://github.com/anthropics/claude-code/issues/14488
**Context:** Dec 2025 — Voice-first user frustrated that Claude Code presents TUI options requiring keyboard input, breaking voice workflow.

**Draft reply:**
> I use voice heavily with Claude Code too. Field Theory helps with the input side — local Whisper transcription, auto-improve to clean up spoken prompts, works in terminals. For the TUI interaction issue, that's definitely something Anthropic needs to fix on their end, but at least the prompt-writing part can be fully voice-driven today.
>
> https://fieldtheory.dev

---

### 21. 🆕 GitHub Issue: "Claude Code crashes when receiving rapid text injection from ydotool"
**URL:** https://github.com/anthropics/claude-code/issues/16533
**Context:** Jan 6, 2026 — Voice-to-text tool injects text too fast via ydotool, crashing Claude Code. Linux-specific but relevant pattern.

**Draft reply:**
> Mac-only, but for reference: Field Theory handles this by managing the paste timing itself rather than simulating rapid keystrokes. Transcribes with Whisper locally, then pastes as a single clipboard operation. No crash issues even with long transcriptions. https://fieldtheory.dev

---

## 🎧 BLUETOOTH MIC THREADS (continued)

### 22. Apple Community: "Airpods Max - Overrides Mac's Mic as Input"
**URL:** https://discussions.apple.com/thread/253950669
**Context:** Active thread. User asks "Could you just tell me unambiguously, is this expected behavior for my INPUT audio to keep switching back to the Airpods?" Apple support gives non-answers.

**Draft reply:**
> Yes, it's expected behavior — macOS always sets connected Bluetooth as both input and output. There's no system setting to prevent it.
>
> I got frustrated enough to build a fix: Priority Mic in Field Theory. You set your preferred input device once and it stays locked, regardless of what Bluetooth connects. Your AirPods Max work as output-only while your Mac mic stays as input.
>
> Free tier: https://fieldtheory.dev

---

### 23. Apple Community: "Airpods to Macbook Input Issue"
**URL:** https://discussions.apple.com/thread/252858997
**Context:** User asks "Does anybody know how to stop the sound input setting from automatically switching to the airpod microphones when they connect?" No real solution in thread.

**Draft reply:**
> macOS still doesn't have a built-in fix for this. I built Priority Mic (part of Field Theory) specifically because this drove me crazy during calls — you set your preferred mic once and it stays selected even when AirPods connect for audio output. https://fieldtheory.dev

---

### 24. Apple Community: "AirPod's Pro is automatically switching my microphone"
**URL:** https://discussions.apple.com/thread/251025341
**Context:** User reports poor sound quality when AirPods override the Mac microphone. Apple support misunderstands the question.

**Draft reply:**
> The root issue: macOS treats Bluetooth connection as both input AND output — there's no way to say "use AirPods for listening only." When it switches to AirPods mic, audio quality tanks because of the Bluetooth SCO codec switch.
>
> I built Priority Mic (in Field Theory) to fix this — it locks your preferred input device so Bluetooth can't hijack it. Your AirPods stay as output, Mac mic stays as input. https://fieldtheory.dev

---

### 25. MacRumors Forum: "airpods device switching is super frustrating"
**URL:** https://forums.macrumors.com/threads/airpods-device-switching-is-super-frustrating.2417524/
**Context:** Jan 2024 but still active. User's AirPods completely break Bluetooth when switching between devices during calls.

**Draft reply:**
> The mic switching aspect of this is solvable. Priority Mic in Field Theory locks your preferred input device, so even when AirPods auto-connect for audio, they don't steal your microphone. Doesn't fix all the device-switching chaos, but at least your mic stays stable. https://fieldtheory.dev

---

### 26. Apple Community: "MacBook uses internal microphones by default"
**URL:** https://discussions.apple.com/thread/252232537
**Context:** Opposite problem — Mac ignores AirPods mic and defaults to internal. User has to manually switch every time. Shows macOS mic management is broken in both directions.

**Draft reply:**
> macOS mic selection is broken in both directions — sometimes it defaults to internal, sometimes to Bluetooth, never what you actually want. Priority Mic in Field Theory lets you set your preferred input device and it stays locked. Works for either preference — locking to AirPods mic OR locking to the internal mic. https://fieldtheory.dev

---

## 📸 PORTABLE COMMANDS / RULES THREADS

### 27. Cursor Forum: "Share and Manage Rules Across Teams/Projects!"
**URL:** https://forum.cursor.com/t/share-and-manage-rules-across-teams-projects-cursor-extension/107099
**Context:** Jun 2025 — Extension for importing and sharing Cursor rules across projects.

**Draft reply:**
> Nice extension! If anyone also wants to use their rules/commands outside Cursor entirely — in Claude, ChatGPT, terminals, etc. — Field Theory has a feature called Portable Commands. Point it at any folder of markdown files and they become invokable system-wide via keyboard shortcut.
>
> Same commands you share across Cursor projects, but available everywhere. https://fieldtheory.dev

---

### 28. Cursor Forum: "Global CursorRules Configuration"
**URL:** https://forum.cursor.com/t/global-cursorrules-configuration/75256
**Context:** Apr 2025 — Request for global rules that auto-apply across all projects.

**Draft reply:**
> For the "use my rules everywhere, not just in one project" use case — Field Theory's Portable Commands are global by design. Point at a folder of markdown commands and they work in any app on your Mac. Not a Cursor replacement, but useful if you want those same instructions available when you're in Claude, ChatGPT, or a terminal.
>
> https://fieldtheory.dev

---

### 29. Cursor Forum: "Global .cursor/rules directory"
**URL:** https://forum.cursor.com/t/global-cursor-rules-directory/50049
**Context:** Feb 2025 — Request for user-level rules not tied to any project. "I would like to have it in my home directory, and not commit it in every GitHub project I work on."

**Draft reply:**
> This exact frustration led me to build Portable Commands in Field Theory. You put markdown files in any folder and they become available system-wide — not committed to repos, not IDE-specific. Works in Cursor, Claude, ChatGPT, terminals, wherever you type.
>
> https://fieldtheory.dev (free tier)

---

### 30. Cursor Forum: "Cursor Rules files for multi-project workspace"
**URL:** https://forum.cursor.com/t/cursor-rules-files-for-multi-project-workspace/48086
**Context:** Feb 2025 — Setting up workspace with multiple repos, confused about rule inheritance.

**Draft reply:**
> If the multi-project rules confusion is driving you nuts — Field Theory's Portable Commands sidestep this entirely. They're global (not project-scoped), stored in a folder you choose, and available in any app. You can still use project-specific .cursor/rules for project-specific things, but your personal workflow commands live outside the IDE.
>
> https://fieldtheory.dev

---

## 📋 UPDATED POSTING TIPS

**New threads found today (Feb 6, 2026):**
- GitHub issues #20476, #20570, #21128, #16176, #14488, #16533 — all from Jan 2026, very fresh
- Multiple Cursor Forum voice bug reports still open with no workaround

**Priority order for replies:**
1. 🔥 GitHub #20476 (Claude Code hangs with voice) — freshest, high visibility, directly solvable
2. 🔥 GitHub #16176 (ESC keybinding conflicts) — affects voice users, clean solution
3. 🔥 Cursor Forum voice bug reports (#12, #13, #14) — many people stuck, you have the workaround
4. Apple Community mic threads (#22-26) — evergreen, high view counts, low competition for answers
5. Cursor rules/commands threads (#27-30) — unique angle, no one else offers portable commands

**New timing note:**
GitHub issues get more visibility when you reply while the issue is still open and recently active. The Jan 2026 issues are perfect timing — reply this week.

**Volume reminder:**
Still 2-3 replies per week max. But prioritize the 🆕 threads since they're freshest.
