# Lane's Hot Mic Voice Command Guide

Hot Mic is an always-on voice layer for Field Theory. This guide explains how it works, the default command set, how to customize it, and best practices for reliability.

This is experimental software. Thanks for your patience while we keep improving it.

## What Hot Mic Is (And Is Not)

- Hot Mic is always listening when enabled.
- You will see this state in the menu bar and Dynamic Island with the orange indicator.
- If you mute Hot Mic, it is not listening.
- Standard Field Theory push-to-talk recording still exists and works separately.
- Push-to-talk listens only between hotkey presses.
- Push-to-talk transcript status appears near your cursor, not in Dynamic Island.

## Before You Start

- Enable Hot Mic and confirm the orange indicator is visible.
- Use a quiet environment whenever possible.
- Avoid loud cafes or open office areas for best accuracy.
- Use a dedicated microphone if possible. It makes a real difference.

## Default Voice Commands

All commands below are editable in settings.

### 1) Dictation Control

- Submit buffered text: `go ahead`, `send it`, `submit`, `do it`
- Paste without submit: `paste`, `paste it`, `transcribe`
- Cancel/interrupt: `stop`, `abort`

### 2) Terminal and Window Workflow

- Next window: `next window`, `switch`
- Previous window: `previous window`
- New window: `new window`
- Close window: `close window`, `close the window`, `close this window`
- Minimize app/window: `minimize`, `minimize window`, `minimize the window`
- Hide app: `hide`, `hide app`, `hide this app`, `hide the app`
- Quit current app shortcut: `quit app`, `quit this app`
- Start Claude: `start claude`, `start cloud`, `run claude`, `start clod`
- Start Codex: `start codex`, `run codex`
- Restart server: `restart server`, `restart dev`, `restart dev server`

Restart server also requires a configured command (for example `npm run dev`).

### 3) System Media and OS Commands

- Play/pause: `play`, `pause`, `play pause`, `play music`, `pause music`
- Next track: `next track`, `next song`, `skip song`
- Previous track: `previous track`, `previous song`, `go back a song`, `last song`
- Volume up: `louder`, `volume up`, `turn it up`
- Volume down: `softer`, `quieter`, `volume down`, `turn it down`
- Mute: `mute audio`, `mute sound`
- Unmute: `unmute`, `unmute audio`
- Sleep Mac: `go to sleep`, `sleep computer`
- Lock screen: `lock screen`, `lock computer`

### 4) App Switching and App Quit Patterns

- Open/switch app prefixes: `open`, `switch to`, `go to`
- Quit app prefixes: `quit`, `close`, `kill`

Examples:

- `open chrome`
- `switch to terminal`
- `go to cursor`
- `quit slack`
- `close spotify`

Important: app switching is prefix-based. Bare app names are not used as direct triggers.

### 5) Windows Voice Commands (Squares)

- Grid/tile: `grid`, `tile`, `tile all`, `grid all`
- Show all windows: `show all`, `show all windows`, `show windows`
- Focus mode: `focus`, `focus mode`, `center focus`, `hide others`, `hide other windows`
- Layouts: `horizontal`, `spread horizontal`, `side by side`, `vertical`, `spread vertical`, `stack windows`, `cascade`, `cascade windows`
- Positioning: `snap left`, `snap right`
- Corners: `top left corner`, `top right corner`, `bottom left corner`, `bottom right corner`
- Screen and restore: `maximize`, `full screen`, `fullscreen`, `enter full screen`, `exit full screen`, `leave full screen`, `center`, `center window`, `restore`

### 6) Portable Command Files

- Single command file: `use the <name> command`
- Multiple command files: `use the commands <a>, <b>, and <c>`

These command names come from your watched command directories.

### 7) Fast Reply Shortcuts

- `first option` -> `1`
- `second option` -> `2`
- `third option` -> `3`
- `fourth option` -> `4`
- `allow` or `approve` -> `y`
- `always` -> `a`
- `deny` -> `n`

## Safety and Recovery Behavior

Hot Mic has guardrails for accidental command activation:

- If a command is detected at the end of speech, buffered dictation is preserved first.
- It flushes your text before running most commands.
- For cancel/abort flows, it intentionally discards buffered text.

If something still goes wrong, you can recover transcripts:

- Open the Dynamic Island panel (hamburger icon near top-left of the island).
- Copy transcript entries directly from history.
- History keeps the latest 25 transcript entries.

## Voice Tuning (Background Voice Filter)

Voice tuning is available from the Dynamic Island history panel:

- Open hamburger menu.
- Open `voice tuning` at the bottom.
- Enable/disable filtering.
- Use strictness slider to tune rejection of nearby/background voices.

Recommended workflow:

- Sit quietly while background voices are present.
- Watch incoming vs accepted levels.
- Increase strictness until background speech stops being accepted.
- Lower strictness if your own voice starts getting dropped.

Default strictness is set low (`4%`) and is intentionally conservative.

## How To Customize Commands

You can customize everything from settings:

- `Settings -> Hot Mic`
- `Settings -> Windows` (for window-management phrase sets)

Practical customization tips:

- Prefer multi-word phrases over single words.
- Use distinct phrases that you do not say in normal dictation.
- Keep app prefixes explicit (`open`, `switch to`, `go to`).
- Keep submit phrases separate from normal sentence endings.

## Reset to Defaults

If your command profile drifts or conflicts:

- Open `Settings -> Hot Mic`
- Click `Reset Voice Defaults`

This restores default phrase groups, system commands, app-prefix rules, and default window command phrases.

## Reliability Best Practices

- Quiet environment is best.
- Use a dedicated mic.
- Avoid single-word command phrases where possible.
- Keep command phrases semantically clear (`next window` is better than `next`).
- Revisit voice tuning if your environment changes.

## Final Notes

Hot Mic and push-to-talk share the same fast transcription pipeline, but they are different interaction models:

- Hot Mic is ambient and command-driven.
- Push-to-talk is intentional and bounded by hotkey press.

Use whichever model fits the moment.
