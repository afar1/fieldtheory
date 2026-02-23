# Hot Mic

Hot Mic is Field Theory's always-on voice layer for command-first, hands-free workflows.

If push-to-talk is for intentional capture, Hot Mic is for continuous flow: speak naturally, then trigger submit/paste/actions with short phrases.

## What Hot Mic Does

- Listens continuously while enabled.
- Buffers dictated text until you trigger a submit or paste phrase.
- Can run voice commands for windows, apps, media/system controls, and command files.
- Uses local transcription and local command execution.

Hot Mic is still an experimental feature and actively improving.

## Requirements

- macOS 14+
- Apple Silicon (M1 or later)
- Qwen transcription engine selected in Field Theory
- Qwen voice model installed (open source, runs fully offline)
- Standard mic/accessibility permissions granted

## Quick Start (Under 1 Minute)

1. Open `Settings -> Audio & Transcription` and select `Qwen`.
2. Install Qwen if prompted.
3. Open `Settings -> Hot Mic` and enable Hot Mic.
4. Speak naturally.
5. End with a submit phrase (for example, `go ahead`) to send.

## Default Voice Commands (Editable)

All phrases below are defaults and can be changed in settings.

### 1) Dictation Control

- Submit buffered text: `go ahead`, `send it`, `submit`, `do it`
- Paste buffered text without submit: `paste`, `paste it`, `transcribe`
- Cancel/interrupt (clears buffer): `stop`, `abort`

### 2) Window and Terminal Workflow

- Next window: `next window`, `switch`
- Previous window: `previous window`
- New window: `new window`
- Close window: `close window`, `close the window`, `close this window`
- Minimize current window/app: `minimize`, `minimize window`, `minimize the window`
- Hide current app: `hide`, `hide app`, `hide this app`, `hide the app`
- Quit current app shortcut: `quit app`, `quit this app`
- Start Claude: `start claude`, `start cloud`, `run claude`, `start clod`
- Start Codex: `start codex`, `run codex`
- Restart server: `restart server`, `restart dev`, `restart dev server`

`restart server` requires a configured command in settings (for example: `npm run dev`).

### 3) Media and System Controls

- Play/pause: `play`, `pause`, `play pause`, `play music`, `pause music`
- Next track: `next track`, `next song`, `skip song`
- Previous track: `previous track`, `previous song`, `go back a song`, `last song`
- Volume up: `louder`, `volume up`, `turn it up`
- Volume down: `softer`, `quieter`, `volume down`, `turn it down`
- Mute: `mute`, `mute audio`
- Unmute: `unmute`, `unmute audio`
- Sleep Mac: `go to sleep`, `sleep computer`
- Lock screen: `lock screen`, `lock computer`

### 4) App Switching and App Quit by Name

Hot Mic supports phrase prefixes plus app names/aliases.

- Open/switch prefixes: `open`, `switch to`, `go to`
- Hide-by-name prefix: `hide`
- Quit prefixes: `quit`, `close`, `kill`

Examples:

- `open chrome`
- `switch to terminal`
- `go to cursor`
- `hide slack`
- `quit slack`
- `close spotify`

### 5) Window Layout Commands (Squares)

- Grid/tile: `grid`, `tile`, `tile all`, `grid all`
- Show windows: `show all`, `show all windows`, `show windows`
- Focus mode: `focus`, `focus mode`, `center focus`, `hide others`, `hide other windows`
- Layouts: `horizontal`, `spread horizontal`, `side by side`, `vertical`, `spread vertical`, `stack windows`, `cascade`, `cascade windows`
- Position: `snap left`, `snap right`
- Corners: `top left corner`, `top right corner`, `bottom left corner`, `bottom right corner`
- Screen/restore: `maximize`, `full screen`, `fullscreen`, `enter full screen`, `exit full screen`, `leave full screen`, `center`, `center window`, `restore`

### 6) Portable Command Files

- Single command file: `use the <name> command`
- Multiple files: `use the commands <a>, <b>, and <c>`

These names map to markdown command files in your watched command directories.

### 7) Fast Reply Shortcuts

- `first option` -> `1`
- `second option` -> `2`
- `third option` -> `3`
- `fourth option` -> `4`
- `allow` or `approve` -> `y`
- `always` -> `a`
- `deny` -> `n`

## How Command Safety Works

Hot Mic uses guardrails to reduce accidental actions:

- Voice commands are matched at the end of utterances.
- If buffered text exists and you trigger a command, text is flushed first.
- Cancel phrases are treated differently: buffered text is intentionally discarded.
- Background voice filtering is available when nearby speech is causing false triggers.

## Recovery and Transcript History

If a command fired when you did not want it to:

- Open Dynamic Island transcript history.
- Copy the relevant transcript back out.
- History keeps recent entries (up to 25).

Note: very short fragments are filtered from history, so transcript storage focuses on meaningful utterances.

## Voice Tuning (Background Voice Filter)

Available in `Settings -> Hot Mic`:

- Toggle `Background Voice Filter`
- Adjust strictness (0-100)

Recommended tuning flow:

1. Turn filtering on.
2. Speak while ambient voices are present.
3. Raise strictness until nearby/background voices stop triggering.
4. Lower strictness if your own voice starts being rejected.

Default strictness is low (`4`) and filtering is off by default.

## Customize Hot Mic for Reliability

Open `Settings -> Hot Mic` and tune phrase groups:

- Submit/Paste/Cancel phrases
- Window and app phrases
- App open/quit prefixes
- Run Claude/Codex phrases
- Restart-server phrase + command
- System command phrase sets
- App voice aliases

Best practices:

- Prefer multi-word phrases (`next window` > `next`).
- Keep command phrases distinct from your normal dictation style.
- Keep submit phrases separate from how you end normal sentences.
- Revisit tuning when your environment changes.

## Reset to Defaults

If your command profile drifts or conflicts:

1. Open `Settings -> Hot Mic`
2. Click `Reset Voice Defaults`

This restores the default command phrase sets.

## Hot Mic vs Push-To-Talk

Both share the same transcription pipeline, but interaction style differs:

- Hot Mic: ambient, command-driven, continuous buffering.
- Push-to-talk: intentional, bounded by hotkey press/release.

Use Hot Mic for flow-state command control, and push-to-talk when precision and intentionality matter more.

## Privacy

Hot Mic command detection and local transcription behavior are local-first. Auto-improve is not available in Hot Mic mode.
