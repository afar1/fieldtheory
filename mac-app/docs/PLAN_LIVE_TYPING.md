# Plan: Live Typing for Standard Dictation (opt-in streaming insertion)

**Status:** approved plan, not yet implemented
**Scope:** mac-app only
**Deliverable for:** implementing model — this doc is self-contained; file/line anchors were verified on branch `codex/release-0.3.14-startup-library` (July 2026). Line numbers may drift; anchor by symbol name first.

## 1. What we're building

A new opt-in setting, **Live typing**: during a standard push-to-talk dictation, transcribed text is typed into the focused field of the target app *as the user speaks* (segment by segment, ~every 1–2s), instead of being pasted once at the end. The existing end-of-recording paste flow remains the default and is unchanged when the setting is off.

**UX contract (user-confirmed decisions):**
1. **Insertion = native keystroke typing.** A new Swift helper command posts CGEvent unicode keyboard events to the target app's pid. The clipboard is never touched for live segments (no Cmd+V spam, no clipboard-history noise, no terminal paste warnings).
2. **Live text is final.** No auto-improve, no rewriting of already-typed text. (Note: in the current realtime path the "final full-file pass" is already skipped when live chunks exist — see `transcriberManager.ts:1490-1504` — so the only real quality feature bypassed is auto-improve.)
3. **Lock to the starting app.** The frontmost app captured at recording start is the only target. If the user switches away mid-dictation, segments buffer; they flush when the app regains frontmost. Anything still buffered when recording stops is delivered through the existing end-of-recording forced-target path.
4. **Setting default off**, applies to the standard (push-to-talk) mode only. Hot Mic is out of scope.

## 2. How the current pipeline works (verified anchors)

All in `mac-app/electron/main/` unless noted.

**Standard dictation is already chunk-streaming internally.** The transcription hotkey is a toggle (press to start, press again to stop — registered via `registerHotkey` → `handleHotkeyPress`, `transcriberManager.ts:607-632`; no keys are held while speaking). During recording, the native Swift helper emits WAV chunks (`recordingChunkReady`); each chunk is ASR'd individually and accumulated:

- `transcriberManager.ts:1126` `onStandardChunkReady(wavPath)` — per-chunk: `transcribeWithEngineFallback` → `sanitizeTranscriptText` → `stripFigureReferences` → append to `standardLiveTranscript` (join with `' '`, lines 1141-1145) → push `{text, endMs}` to `standardLiveSegments` (1147) → `emit('standardLiveTranscript', …)` (1152) → Squares voice-command tail parsing (1154-1175).
- Chunks are processed strictly serially: `processStandardChunkQueue` (`transcriberManager.ts:1101`), queue capped at 8 with oldest-drop (`:1040-1051`, `STANDARD_MAX_CHUNK_QUEUE_DEPTH` at `:290`).
- Harvest cadence is managed by `setStandardRealtimeHarvestMode` (`:1093`) — 'dictation' (word-boundary) vs 'command' (aggressive) modes, switched under backpressure.

**Stop flow** — `stopRecordingAndTranscribe` (`transcriberManager.ts:1358`):
1. Snapshot the audio tail as one more chunk into the same queue (`:1395-1417`), stop recording (`:1427`), drain the chunk queue (`waitForStandardChunkDrain`, `:1432`).
2. Final text selection (`:1477-1524`): if live chunks produced a transcript and the tail file is silence-sized, **the live transcript IS the final text** (`finalTextSource = 'live-tail-*'`). Full-file ASR only runs when there were no live chunks.
3. Squares voice command on final text (`:1556-1565`), portable command detection → `[cmd:name.md]` refs (`:1567-1590`), inline `[Figure N]` refs (`:1593-1598`).
4. Store transcript in clipboard history as a `'transcript'` item and push to `currentStack` (`:1600-1618`).
5. Auto-improve (`improveTranscriptForPaste`, called at `:1666`, defined at `:365`).
6. Delivery via `pasteStack` (`:3815`): resolves target (Field Theory markdown editor / FT terminal / external app via `resolveStandardPasteTargetBundleId` `:3710`), external delivery via `typeIntoAppWithClipboardSync(forcedTargetBundleId, …)` with clipboard+Cmd+V fallback (`:3788-3806`), trailing space via `addFollowupTypingSpace` (`:3646`).

**Native helper** (Swift, source in repo at `mac-app/electron/native/Sources/FieldTheoryHelper/main.swift`, ~2722 lines):
- Stdio JSON protocol; command enum at `:44`, message fields at `:65-69`, dispatch at `:2231`.
- `typeIntoApp` (`:2316`) = pasteboard write + **Cmd+V CGEvents posted to the target pid** (`postCommandVToPid` `:2539`, `postKeyEventToPid` `:2525`, event source at `:2402`). It already resolves pid from bundleId, checks frontmost, and AX-checks for a focused text input (result fields include `accessibilityTrusted`, `targetFrontmost`, `focusedTextInput` — result emission at `:247`).
- TS wrapper: `nativeHelper.ts:642-699` (`typeIntoApp`), response routing at `:670` / `:1047`. Helper spawn at `:129-140`, path at `getHelperPath()` `:919`.
- `nativeHelper` also emits `frontmostAppChanged` (consumed at `transcriberManager.ts:343`) and exposes a cached `getFrontmostApp()` (used at `transcriberManager.ts:3716`).

**Settings pattern** (follow `autoImprove` end-to-end): key in `Preferences` interface (`preferences.ts:170`ff), getter/setter on TranscriberManager, channel constants in `types/transcribe.ts:116-167`, `ipcMain.handle` in `index.ts`, preload bridge exposing `window.api.transcribe.*` (`electron/preload.ts`), toggle UI in `src/components/TranscriptionSettings.tsx` (tests in `src/components/__tests__/TranscriptionSettings.test.tsx`).

**Build/test:** `npm run build:native` (Swift helper via `scripts/setup-native.sh`), `npm run build:electron`, tests are colocated `*.test.ts` run with vitest (`npx vitest run <file>`).

## 3. Design

### 3.1 New Swift helper command: `insertTextSegment`

`main.swift` additions:
- `Command` enum: `case insertTextSegment` (`:44` region). Reuses existing message fields `bundleId` + `text` (`:65-67`) — no new fields needed.
- Result message `insertTextSegmentResult`: `{ success: Bool, reason: String?, accessibilityTrusted: Bool }` with `reason ∈ 'not-frontmost' | 'no-focused-text-input' | 'secure-input' | 'app-not-running' | 'post-failed'`. Follow the `typeIntoAppResult` emission pattern (`:247`).
- Implementation (mirror the pre-checks of `typeIntoApp` at `:2316`, minus pasteboard):
  1. Resolve running app by bundleId → pid; **fail `not-frontmost`** unless `NSWorkspace.shared.frontmostApplication` matches. (Do NOT type into a non-frontmost pid — the user may be interacting with another window of that app.)
  2. **Fail `secure-input`** if `IsSecureEventInputEnabled()` (Carbon) — never type into password fields.
  3. **Fail `no-focused-text-input`** using the same AX focused-element check `typeIntoApp` already performs for its `focusedTextInput` result field. (Critical: unicode keystrokes posted while no text field is focused become app keyboard shortcuts.)
  4. Type: split text into runs of **≤20 UTF-16 code units**; for each run create `CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)` + matching keyUp, call `keyboardSetUnicodeString(stringLength:unicodeString:)` on both, set **`event.flags = []` explicitly** (so physically held modifiers can't contaminate the events), post via the existing `postToPid` path (`postKeyEventToPid`-style, `:2525`). ~1-2ms spacing between runs (match the pacing constants used by `postCommandVToPid`).
- No new permissions: this uses the same CGEvent-post-to-pid + AX capabilities the helper already exercises for `typeIntoApp`.

### 3.2 New TS module: `electron/main/liveTypingCoordinator.ts` (+ colocated test)

Pure orchestration, dependency-injected so it's unit-testable without the helper:

```ts
type InsertResult = { success: boolean; reason?: string };
type LiveTypingDeps = {
  insertTextSegment: (bundleId: string, text: string) => Promise<InsertResult>;
  onTrace?: (event: string, data?: Record<string, unknown>) => void;
};

class LiveTypingCoordinator {
  start(targetBundleId: string): void;
  enqueueSegment(text: string): void;          // appends `text + ' '` to the typing queue
  notifyFrontmostChanged(bundleId: string | null): void;  // triggers buffered flush on regain
  finish(): Promise<{ typedSegmentCount: number }>;  // drain in-flight + final flush attempt, then report
  cancel(): void;                               // drop buffer, stop typing immediately
}
```

`finish()` reports **how many segments were fully typed**, not the leftover text. The manager owns remainder computation (§3.3) by reconciling against `standardLiveSegments` — this covers both the coordinator's untyped buffer AND any chunk whose ASR completes after `finish()` (the `waitForStandardChunkDrain` at `transcriberManager.ts:1116` breaks at a 1200ms deadline, so a late segment can be appended to `standardLiveSegments` without ever reaching the coordinator). After `finish()` or `cancel()`, the coordinator ignores further `enqueueSegment` calls.

Behavior rules:
- **Strict FIFO, one insert in flight.** Segments are typed in arrival order; never interleave.
- Each segment is typed as `segment + ' '` — this makes typed output equal `standardLiveTranscript` (which joins chunks with `' '`) plus a trailing space, matching the batch flow's `addFollowupTypingSpace` behavior.
- On insert failure with `not-frontmost` / `no-focused-text-input` / `secure-input`: move segment (and everything queued behind it) to the **buffer**; retry the buffer head when `notifyFrontmostChanged` reports the target back frontmost.
- On `post-failed` or transport error: retry once; after **3 consecutive hard failures, degrade for the session** — stop typing, buffer everything (it will be delivered by the existing paste path via `finish().remainderText`). Trace the degradation.
- `finish()` waits for the in-flight insert + attempts one final buffer flush (only if target frontmost), then resolves with what was actually typed vs. what remains.
- `cancel()` (recording abandoned): drop everything not yet typed; already-typed text stays in the field (we never un-type — simulated backspaces into state we can't observe are unsafe).

### 3.3 TranscriberManager integration

Session gating — in `startRecording` (`transcriberManager.ts:842`), set `this.liveTypingSession` when ALL hold:
- `getLiveTyping()` preference is true;
- recording source is `'microphone'` (`:1363` pattern);
- frontmost app at start is external — use cached `nativeHelper.getFrontmostApp()?.bundleId` (sync, `:3716` pattern), require non-null and `!isFieldTheoryBundleId(...)`.

Otherwise the session runs exactly as today (silent batch fallback). Capture `this.liveTypingTarget = bundleId` and `coordinator.start(bundleId)`.

Hook points (all guarded by `this.liveTypingSession`):
1. **`onStandardChunkReady`** — after the `emit('standardLiveTranscript', …)` at `:1152`: `coordinator.enqueueSegment(liveChunkText)`. **Skip the Squares tail-parsing block (`:1154-1175`)** for live sessions (command words would already be typed; holding chunks back to detect commands would defeat the latency point — documented tradeoff).
2. **`frontmostAppChanged` listener (`:343`)** — forward to `coordinator.notifyFrontmostChanged(...)`.
3. **Stop flow** (`stopRecordingAndTranscribe`), after chunk drain at `:1432`: `const { typedSegmentCount } = await coordinator.finish()`. Compute the remainder from the source of truth: `remainderText = this.standardLiveSegments.slice(typedSegmentCount).map(s => s.text).join(' ')`. This is valid because in live sessions every `standardLiveSegments` push has a 1:1, same-order `enqueueSegment` call (both happen serially inside `onStandardChunkReady`, and Squares tail truncation of the live transcript is disabled), and it also captures segments that arrived after the drain deadline and never reached the coordinator. Then, for live sessions:
   - Skip Squares final `handleVoiceCommand` (`:1556-1565`) and portable command detection/`[cmd:]` insertion (`:1567-1590`) — text is already delivered.
   - Skip `insertFigureReferences` (`:1593-1598`) — no inline refs in live mode; screenshots still land in the stack (below).
   - Still `storeText(cleanedText, 'transcript', …)` for clipboard history (`:1610`), still auto-stack with screenshots for history grouping.
   - **Skip auto-improve** — guard the call at `:1666`.
   - **Remainder delivery:** if `remainderText` non-empty, deliver via the existing forced-target path `typeIntoAppWithClipboardSync(this.liveTypingTarget, this.addFollowupTypingSpace(remainderText), …)` with its built-in clipboard+Cmd+V fallback (`:3788-3800`); if that fails, `clipboard.writeText(remainderText)` + `emitPasteFailureAndMaybeClear(...)` per the existing failure pattern so the user is notified text is on the clipboard.
   - **Delivery of the rest of the stack:** if the session produced no screenshots, **do not call `pasteStack` at all** (its pre-checks at `:3832-3845` can emit a spurious "Field Theory has focus" failure even when nothing would be pasted) — clear the stack state and go idle. If screenshots exist, track `this.liveTypedTranscriptItemId = itemId` and have `pasteStack` (`:3815`) skip text/transcript items with that id so only images paste (they arrive after the typed text; acceptable v1 ordering).
4. **Cancel paths** — `discardCancelledStandardSession` and `standardSessionCancelRequested` checks: call `coordinator.cancel()`.
5. **Traces** — use `appendTranscriberTrace` (already imported) for: session start (target bundleId), per-segment typed/buffered (chars, latency), degradation, finish summary (`typedChars`, `remainderChars`, `bufferedFlushes`). Follow existing `finish.*` event naming (`transcriberTrace.ts`).
6. **Reset** — clear `liveTypingSession`/target/itemId wherever `clearStandardLiveTranscript`-adjacent session state resets happen (`:1016-1029`, `:1598`).

### 3.4 nativeHelper.ts wrapper

`insertTextSegment(bundleId: string, text: string): Promise<InsertTextSegmentResult>` following the `typeIntoApp` wrapper (`:642-699`) and its response-correlation pattern (`:670`, `:1047`). Add the result type next to `TypeIntoAppResult`.

### 3.5 Setting plumbing (follow autoImprove end-to-end)

- `preferences.ts` — `liveTypingEnabled?: boolean` in `Preferences` (`:170`ff), default false.
- `transcriberManager.ts` — `getLiveTyping()` / `setLiveTyping(enabled)` mirroring `getAutoImprove` (`:365` region getters).
- `types/transcribe.ts` — `GET_LIVE_TYPING: 'transcribe:getLiveTyping'`, `SET_LIVE_TYPING: 'transcribe:setLiveTyping'` (`:116-167` block).
- `index.ts` — `ipcMain.handle` pair next to the auto-improve handlers.
- `preload.ts` — expose `window.api.transcribe.getLiveTyping/setLiveTyping`.
- `TranscriptionSettings.tsx` — toggle near auto-improve. Copy: **“Live typing (experimental)”** / “Types your words into the focused field as you speak instead of pasting when you stop. Live dictations skip auto-improve, voice window commands, and inline figure references.” When both this and auto-improve are enabled, show that note as the toggle's helper text (no blocking).

## 4. Edge-case matrix

| Situation | Behavior |
|---|---|
| Setting off | Exactly today's behavior (regression tests assert this) |
| FT app frontmost at start / system-audio source / no frontmost bundleId | Silent fallback to batch for that session |
| User switches app mid-dictation | Segments buffer; flush when target regains frontmost; leftovers delivered at stop via forced-target paste |
| No focused text field / secure input in target | Same as above — buffer, never post raw keystrokes |
| Chunk ASR failure or queue-depth drop (`:1040`) | Same exposure as today's realtime path (those words are lost from the live transcript); no new handling in v1 |
| Chunk ASR completes after drain deadline (`:1116`, 1200ms) | Segment lands in `standardLiveSegments` but never reaches the coordinator; remainder reconciliation (§3.3.3) delivers it via the stop-time paste |
| Repeated insert failures | Coordinator degrades session to batch-remainder; user still gets full text at stop |
| Recording abandoned/cancelled | Typed text stays (no un-typing); buffer dropped; trace it |
| Screenshots during recording | Images stack + paste at stop after typed text; no inline `[Figure N]` in live mode |
| Squares/window voice commands, portable `[cmd:]` phrases | Not detected in live sessions (words get typed); documented in setting copy |
| User types manually while dictating | Interleaving garbles — inherent limitation (same as OS dictation); document, don't guard |
| Hotkey with modifiers pressed near a segment | Injected events set `flags = []` explicitly, immune to held modifiers |

## 5. Implementation order (step → verify)

1. **Swift `insertTextSegment`** → `npm run build:native` compiles; drive helper binary over stdio with a JSON line targeting TextEdit; text appears, result message correct; failure reasons verified by (a) backgrounding TextEdit, (b) focusing its window chrome instead of the document.
2. **`nativeHelper.ts` wrapper** → extend `nativeHelper.test.ts` with the fake-child-process pattern used by existing command tests; assert request/response correlation and result shape.
3. **`liveTypingCoordinator.ts` + test** → vitest: FIFO ordering, `+ ' '` suffixing, buffer on each failure reason, flush on frontmost regain, degrade after 3 hard failures, `finish()` typed-count accuracy (in-flight + buffered + post-finish enqueue ignored), `cancel()` drops buffer. This file is pure logic — aim for the strongest coverage here.
4. **TranscriberManager wiring** → extend `transcriberManager.test.ts` (the existing harness already simulates chunk delivery — see the tests added in commit `dc0f842`): live session types segments and skips improve/squares/commands/figure-refs/paste-of-transcript; remainder reconciliation from `standardLiveSegments` (including a late-arriving segment); no-screenshot sessions never call `pasteStack`; eligibility fallbacks; setting-off regression (behavior byte-identical to today).
5. **Setting plumbing + UI** → preferences round-trip test (mirror `preferences.test.ts` patterns); extend `TranscriptionSettings.test.tsx` for the toggle; `npm run build:electron` + `npm run build:vite` clean.
6. **Manual QA** (dev build, `npm run dev`): dictate into — Notes, Slack, Chrome textarea, iTerm2, VS Code; mid-dictation Cmd+Tab away and back; stop while away (remainder paste into original app); password field (buffers); cancel mid-dictation; setting off sanity pass; auto-improve on + live typing on (improve skipped, helper text visible).

## 6. Explicitly out of scope (v1)

- Hot Mic mode integration.
- Live typing into Field Theory's own markdown editor/terminal (falls back to batch; natural fast-follow via `insertTextIntoFieldTheoryMarkdown` per segment).
- Revising already-typed text (interim-hypothesis correction, backspace-based fixes) — append-only by design.
- End-of-session "polished copy on clipboard" option (user chose live-is-final).
- Overlay/dynamic-island live transcript display for standard mode (the field itself is the feedback surface).

## 7. Risks & watch items

- **Per-app CGEvent quirks:** unicode events posted to pid behave well in AppKit/Chromium/terminal apps, but the QA matrix is the real test; the degrade-to-batch path is the safety net.
- **Typed vs. history divergence:** history stores `sanitizeTranscriptText(standardLiveTranscript)`; typed text is per-chunk-sanitized then joined. Sanitization is near-idempotent so divergence should be cosmetic at worst; if QA shows drift, store the coordinator's `typedText` instead.
- **Latency feel:** segment cadence is the existing chunk cadence (~1-2s). If it feels laggy, tune harvest mode for live sessions (`setStandardRealtimeHarvestMode` `:1093`) rather than adding a new pipeline.
- **AX focused-input check cost:** runs per segment (~every 1-2s); the helper already does this per `typeIntoApp` call — negligible, but keep it inside the helper (single roundtrip), not as a separate TS-side query.
