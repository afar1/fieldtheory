# Field - Product Overview

> A comprehensive technical and product analysis for monetization strategy exploration.

---

## Executive Summary

**Field** is a voice-first productivity platform for AI-enabled IDE users (particularly Cursor users). It transforms spoken thoughts into structured prompts, captures screenshots with AI-generated descriptions, and synchronizes everything across Mac and iOS into a unified clipboard history.

**Core Value Proposition**: Eliminate the friction between thinking and prompting. Users speak naturally, and Field converts that into well-structured AI prompts ready to paste into Cursor or any LLM interface.

**Primary Users**: Software engineers, technical writers, and knowledge workers who heavily use AI-assisted coding tools like Cursor, Copilot, or direct LLM interfaces.

---

## Platform Overview

### Mac Application (Electron + React)

The Mac app is the primary workhorse, running as a background utility with a system tray icon. It provides:

- **Push-to-talk voice transcription** via global hotkey (Option+Space)
- **Alfred-style clipboard history** popup (Control+Alt+Space)
- **Screenshot capture** with AI-generated descriptions
- **Prompt engineering** - refines raw voice/text into structured prompts
- **Mobile sync** - pulls iOS transcriptions into the Mac timeline
- **Priority microphone selection** - lock to a specific mic device

### iOS Application (React Native + Expo)

The iOS app is a mobile companion for capturing voice notes and transcriptions on the go:

- **Voice recording** with on-device Whisper transcription
- **Transcript stacking** - combine multiple recordings
- **Task/observation extraction** - LLM-powered parsing of transcriptions
- **Cursor browser integration** - paste directly into Cursor's agent dashboard
- **Supabase sync** - all transcriptions sync to the cloud for Mac retrieval

---

## Technical Architecture

### Local AI Models (Zero Cloud Cost)

Field uses on-device AI models for core functionality, meaning no per-use cloud costs:

| Model | Purpose | Technology | Location |
|-------|---------|------------|----------|
| **Whisper** | Speech-to-text transcription | whisper.cpp (C++) | Mac native binary |
| **Whisper.rn** | Speech-to-text transcription | whisper.rn (React Native binding) | iOS on-device |
| **MLX Vision** | Screenshot/image captioning | MLX (Apple Silicon optimized) | Mac Python subprocess |

**Model sizes available for Whisper:**
- Base (~142 MB, faster)
- Small (~466 MB)
- Medium (~1.5 GB)
- Large (~2.9 GB, most accurate)

**Vision model:**
- Nano (lightweight, fast image captioning)

### Cloud Services (Infrastructure Costs)

| Service | Purpose | Cost Model |
|---------|---------|------------|
| **Supabase** | User auth, transcript sync | Per-request/storage |
| **Anthropic Claude** | Prompt engineering (optional) | Per-token API calls |
| **GitHub Releases** | Auto-updates | Free for public repos |

### Native Components (Mac)

The Mac app includes a **Swift native helper** (`LittleOneHelper`) that provides:

- CoreAudio device enumeration and default input management
- System permission checks (Accessibility, Input Monitoring, Microphone)
- Low-latency audio recording to WAV files
- Real-time audio level metering for UI feedback

### Data Storage

**Mac:**
- SQLite database (`clipboard.db`) for clipboard history
- JSON preferences file for settings
- Secure API key storage via macOS Keychain (`safeStorage`)

**iOS:**
- AsyncStorage for local data
- Supabase for cloud sync

---

## Feature Deep Dive

### 1. Push-to-Talk Transcription (Mac)

**How it works:**
1. User presses global hotkey (default: `Option+Space`)
2. Recording overlay appears (shows audio level visualization)
3. User speaks their prompt/thought
4. Press hotkey again to stop recording
5. Audio is transcribed locally via whisper-cli
6. Text is automatically pasted into the active application
7. Transcription is stored in clipboard history

**Technical details:**
- WAV recording at 16kHz mono
- Whisper inference runs in separate process
- Results cached in SQLite with full-text search
- Escape key cancels recording without transcribing

**Stacking Mode** (Cmd + Option+Space):
- Captures the frontmost app as "target"
- All subsequent transcriptions + screenshots are tagged with a stack ID
- Content automatically pastes to the target app
- Used for building up complex prompts with multiple inputs

### 2. Clipboard History (Mac)

An Alfred-style floating window that shows:

- All text copied to clipboard
- All voice transcriptions
- All screenshots (with AI descriptions)
- Items synced from iOS

**Features:**
- Fuzzy search across all content
- Type filters (all, transcripts, screenshots)
- Source filters (all, Mac, iOS)
- Multi-select and batch operations
- Stack grouping (related items appear together)
- Keyboard navigation (j/k, Enter to paste)
- Undo delete (Cmd+Z)

**Technical details:**
- SQLite with FTS5 full-text search
- 30-day retention / 1000 item limit
- Password manager apps auto-excluded
- Images stored as PNG blobs with dimensions

### 3. Screenshot Capture with Vision (Mac)

**How it works:**
1. User presses screenshot hotkey (default: `Alt+1`)
2. macOS screencapture tool activates (drag to select region)
3. Screenshot saved to clipboard history
4. Background vision processor queues the image
5. MLX vision model generates a description
6. Description stored as content field (now searchable!)

**Continuous Context Mode** (Shift+Alt+1):
- Takes continuous screenshots without re-pressing hotkey
- Each screenshot adds to the same stack
- Hold Cmd to pause and interact with apps
- Press Escape to stop
- Great for capturing multiple code snippets or UI states

### 4. Prompt Engineer (Mac) - Cloud Feature

**How it works:**
1. User creates a "stack" of content (transcriptions + screenshots)
2. Clicks "Improve" button in clipboard history
3. All content sent to Claude Sonnet 4.5 with a system prompt
4. Claude transforms messy input into structured prompt with:
   - Goal
   - Context
   - Task (step-by-step)
   - Constraints
   - Output Format
   - Clarifying Questions (if needed)
5. Refined prompt appears in UI for review
6. User can paste the improved version

**Technical details:**
- Uses Anthropic Messages API
- Requires user-provided API key (stored in Keychain)
- System prompt loaded from markdown file (customizable)
- Image descriptions included as `[Screenshot/Image attached (WxH)]`

### 5. Mobile Sync (Mac ← iOS)

**How it works:**
1. User records transcription on iOS app
2. Transcription syncs to Supabase (`transcripts` table)
3. Mac app polls Supabase every 30 seconds
4. New transcripts inserted into local clipboard history
5. Items marked with `source='ios'` for filtering

**Technical details:**
- OTP-based authentication (email magic link)
- Preserves original iOS timestamp for proper timeline ordering
- Client ID deduplication prevents duplicate imports
- First sync limited to last 7 days to avoid huge backlog

### 6. Priority Microphone (Mac)

**Problem solved:** When you connect a USB mic, macOS sometimes switches back to built-in mic. When you have multiple inputs, the system picks unpredictably.

**How it works:**
1. User selects a "priority" microphone in settings
2. AudioManager monitors CoreAudio for device changes
3. When a non-priority device becomes default, we switch back
4. Priority enforced even after wake from sleep

**Technical details:**
- CoreAudio property listeners for device changes
- Debounced enforcement to avoid rapid switching
- Preference persisted across app restarts

### 7. Voice Recording (iOS)

**How it works:**
1. User taps record button or app auto-starts on open
2. Audio recorded using Expo Audio API
3. Recording saved as 16kHz mono WAV
4. whisper.rn transcribes on-device
5. Result stored locally and synced to Supabase

**Features:**
- Auto-copy transcription to clipboard after recording
- Auto-start recording on app open (optional)
- Headset controls support (start/stop via AirPods)
- Error boundary for crash recovery

### 8. Task/Observation Extraction (iOS) - Cloud Feature

**How it works:**
1. Transcription captured on iOS
2. Optional: Auto-separate enabled in settings
3. Transcription sent to Claude Sonnet
4. LLM returns a JSON diff:
   - Todos to create, update, delete
   - Observations to create
5. Local state updated and persisted

**Use case:** Stream-of-consciousness voice notes automatically become structured tasks and notes.

### 9. Cursor Browser Integration (iOS)

Embedded WebView showing Cursor's agent dashboard:
- User can paste transcriptions directly into Cursor's input
- "Send to Cursor" button on each transcript
- WebView persists session across app launches

---

## User Workflows

### Workflow 1: Quick Voice-to-Code Prompt
1. Working in Cursor, hit Option+Space
2. Say: "Write a React component that shows a list of users with pagination, use TypeScript and Tailwind"
3. Hit Option+Space again
4. Prompt pasted directly into Cursor's chat

### Workflow 2: Multi-Modal Context Building
1. Hit Cmd+Option+Space to enter stacking mode (targets Cursor)
2. Hit Alt+1 to screenshot an error message
3. Hit Option+Space, say: "Fix this TypeScript error, the problem is with the generic types"
4. Hit Alt+1 to screenshot the relevant code
5. Hit Cmd+Option+Space to exit stacking mode
6. All three items form one context, pasted in sequence

### Workflow 3: Continuous Documentation Capture
1. Hit Shift+Alt+1 to start continuous context mode
2. Navigate through an app, taking screenshots of each screen
3. Press Escape when done
4. All screenshots in one stack, vision-described, ready to share

### Workflow 4: Mobile Capture → Desktop Use
1. On iPhone, record voice note about a bug to investigate
2. Later at Mac, open clipboard history
3. iOS transcription appears in timeline
4. Click to paste into bug tracker or Cursor

### Workflow 5: Prompt Refinement
1. Ramble into the mic: "Okay so I need to like, um, refactor this database stuff, the queries are slow, maybe add indexes? Also caching could help..."
2. Open clipboard history, select the transcription
3. Click "Improve" 
4. Claude returns structured prompt with Goal, Context, Task sections
5. Paste refined version into AI assistant

---

## What Makes Field Unique

### 1. Local-First AI
Most voice transcription tools require cloud APIs. Field runs Whisper locally, meaning:
- No per-transcription costs
- Works offline
- No privacy concerns about voice data
- Instant transcription (no network latency)

### 2. Purpose-Built for AI IDE Users
Not a general transcription app - specifically designed for the workflow of:
- Building prompts incrementally
- Mixing voice and visual context
- Quick iteration with AI assistants

### 3. Unified Clipboard Timeline
Everything in one place:
- Copy/paste from any app
- Voice transcriptions
- Screenshots with descriptions
- Mobile captures
All searchable, stackable, and organized by time.

### 4. Vision + Voice Fusion
Screenshots aren't just images - they have AI-generated descriptions:
- Searchable by content ("find my screenshot of the login form")
- Included in prompt refinement
- Provides LLM-readable context

### 5. Cross-Device Continuity
Start a thought on your phone, finish it on your Mac. The iOS app acts as a capture device that feeds into the Mac's main workflow.

---

## Cost Structure Analysis

### Zero Marginal Cost Features (Local Models)
- Voice transcription (Whisper)
- Image captioning (MLX Vision)
- Clipboard history and search
- Screenshot capture
- Priority microphone management
- Stacking and organization

### Variable Cost Features (Cloud APIs)
- **Prompt Engineering**: ~$0.003-0.01 per refinement (Claude Sonnet API)
- **Task Extraction (iOS)**: ~$0.001-0.005 per transcription

### Fixed Infrastructure Costs
- **Supabase**: Auth + database for sync
  - Free tier: 500MB database, 50K auth users
  - Pro tier: $25/month for more capacity
- **GitHub Releases**: Free for auto-updates
- **Apple Developer**: $99/year for iOS distribution
- **Code signing**: Included in Apple Developer account

---

## Potential Monetization Angles

### Angle 1: Core Free, Cloud Features Paid
- **Free**: All local features (transcription, clipboard, screenshots, vision)
- **Paid**: Prompt engineering, mobile sync, cloud backup
- **Rationale**: Heavy users who need refinement pay; casual users get value free

### Angle 2: One-Time Purchase
- **Model**: Traditional Mac app pricing ($29-49)
- **Includes**: Everything except API costs
- **Cloud features**: BYOK (Bring Your Own Key) for Anthropic
- **Rationale**: No ongoing relationship/billing complexity

### Angle 3: Freemium with Usage Limits
- **Free**: 50 transcriptions/day, 10 screenshots/day
- **Pro ($5-10/month)**: Unlimited local features + prompt engineering credits
- **Rationale**: Light users stay free, power users pay

### Angle 4: Hardware Bundle
- **Field Mic**: Dedicated USB microphone optimized for voice-to-text
- **Software free with hardware purchase**
- **Rationale**: Physical product creates premium perception and one-time revenue

### Angle 5: Team/Enterprise Tier
- **Individual**: Free or cheap
- **Team ($10-20/seat/month)**: Shared clipboard history, team stacks, admin controls
- **Rationale**: B2B revenue from engineering teams using Cursor together

### Angle 6: IDE Plugin Model
- **Cursor plugin**: Deeper integration with Cursor's AI features
- **Revenue share or premium listing**
- **Rationale**: Leverage existing distribution channel

---

## Competitive Landscape

| Competitor | Focus | Pricing | Field Advantage |
|------------|-------|---------|-----------------|
| **Whisper Transcription** (OpenAI) | Cloud transcription API | $0.006/min | Local-first, no per-use cost |
| **MacWhisper** | Mac transcription app | $30 one-time | Multi-modal (vision + voice) |
| **Raycast** | Launcher with clipboard | $8/month | Voice-native, AI prompt focus |
| **Alfred** | Launcher with clipboard | $34 Powerpack | Purpose-built for AI IDEs |
| **Otter.ai** | Meeting transcription | $10-30/month | Not for IDE workflows |
| **Superwhisper** | Mac voice transcription | $10/month | Includes vision, stacking |

**Field's Unique Position**: The only tool specifically designed for AI IDE users that combines local voice transcription, vision, and prompt refinement in a unified clipboard-centric workflow.

---

## Technical Metrics

### Performance (Apple Silicon)
- Whisper base model: ~3-5x realtime (5 sec audio → 1-1.5 sec transcription)
- Vision captioning: ~2-4 seconds per image
- App memory: ~150-300 MB idle, ~500 MB during transcription

### Reliability
- SQLite corruption protection with WAL mode
- Graceful degradation if models unavailable
- Auto-recovery from transcription errors

### Privacy
- Voice data never leaves device (local Whisper)
- Screenshots only sent to Claude if user explicitly clicks "Improve"
- API keys stored in macOS Keychain
- No analytics or telemetry

---

## Appendix: File Structure

```
littleai/
├── mac-app/                    # Mac Electron application
│   ├── electron/
│   │   ├── main/               # Main process code
│   │   │   ├── index.ts        # App entry point
│   │   │   ├── audioManager.ts # Priority mic feature
│   │   │   ├── clipboardManager.ts # Clipboard history
│   │   │   ├── transcriberManager.ts # Voice transcription
│   │   │   ├── visionProcessor.ts # Image captioning
│   │   │   ├── promptEngineer.ts # Claude refinement
│   │   │   └── mobileSync.ts   # iOS sync
│   │   └── native/             # Swift native helper
│   └── src/                    # Renderer (React)
│       └── components/
│           ├── ClipboardHistory.tsx  # Main UI
│           └── SettingsPanel.tsx
├── App.tsx                     # iOS app entry point
├── hooks/
│   └── useWhisperRecording.ts  # iOS voice recording
├── services/
│   ├── llm.ts                  # Task extraction (iOS)
│   └── sync.ts                 # Supabase sync
└── build-whisper/              # Compiled whisper-cli binary
```

---

## Key Questions for Monetization Strategy

1. **Value perception**: Do users perceive enough value in local-only features to pay, or is the cloud enhancement (prompt engineering) the "magic" they'd pay for?

2. **Target user profile**: Are we targeting individual developers (price sensitive, prefer one-time) or teams (subscription acceptable, need collaboration)?

3. **Distribution strategy**: App Store (30% cut, trust signal) vs direct download (full margin, harder discovery)?

4. **Free tier sustainability**: Can we afford to give away the core product and monetize power users only?

5. **Hardware angle**: Is a "Field Mic" a real product opportunity or a distraction?

6. **API key model**: Should users bring their own Anthropic key, or should we absorb/resell API costs?

---

*Document generated for monetization strategy analysis. Last updated: December 2024.*

