# Oscar Onboarding Flow Specification

> Detailed specification for the first-run experience, inspired by SuperWhisper's step-by-step wizard approach.

**Implementation Status**: Not Started  
**Priority**: P0 (Must-have for release)  
**Estimated Time**: 4-6 hours for basic flow, additional 2-3 hours for polish

---

## Design Principles

1. **One thing at a time**: Each screen focuses on exactly one permission or concept
2. **Explain the why**: Users should understand why each permission is needed
3. **Visual feedback**: Clear indication of progress and completion
4. **Escape hatch**: Power users can skip with a "Set up later" option
5. **Resumable**: If user closes mid-flow, resume where they left off

---

## Flow Overview

```
┌───────────────────────────────────────────────────────────────┐
│  Welcome → Microphone → Accessibility → Download → Complete   │
└───────────────────────────────────────────────────────────────┘
     (1)        (2)            (3)           (4)        (5)
```

---

## Screen 1: Welcome

**Goal**: Set expectations and build trust

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           🎙️                                   │
│                                                                 │
│                    Welcome to Oscar                             │
│                                                                 │
│         Fast, private voice transcription for Mac.              │
│                                                                 │
│    Your voice never leaves your computer. Oscar uses            │
│    Whisper, an open-source AI model that runs locally.          │
│                                                                 │
│                                                                 │
│                     [ Get Started ]                             │
│                                                                 │
│                                                                 │
│                   ○ ○ ○ ○ ○  (1 of 5)                          │
│                                                                 │
│            "Set up later" (skip to tray icon)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Copy Variants**:
- Headline: "Welcome to Oscar" / "Meet Oscar" / "Voice to Text, Instantly"
- Subhead: Emphasize privacy + local processing

---

## Screen 2: Microphone Permission

**Goal**: Grant microphone access

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           🎤                                    │
│                                                                 │
│               Microphone Access Required                        │
│                                                                 │
│     Oscar needs access to your microphone to capture            │
│     your voice for transcription.                               │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  🔒 Your audio is processed entirely on your Mac.   │     │
│     │     No recordings are sent to any server.           │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│                  [ Grant Microphone Access ]                    │
│                                                                 │
│                                                                 │
│                   ● ○ ○ ○ ○  (2 of 5)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Interaction**:
1. User clicks "Grant Microphone Access"
2. macOS permission dialog appears
3. If granted → advance to next screen
4. If denied → show explanation with link to System Preferences

**Denied State**:
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           ⚠️                                    │
│                                                                 │
│               Microphone Access Required                        │
│                                                                 │
│     Oscar can't transcribe without microphone access.           │
│                                                                 │
│     To enable:                                                  │
│     1. Open System Settings → Privacy & Security                │
│     2. Click Microphone                                         │
│     3. Toggle Oscar to ON                                       │
│                                                                 │
│               [ Open System Settings ]   [ Try Again ]          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Screen 3: Accessibility Permission

**Goal**: Grant accessibility access for paste functionality

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           ⌨️                                    │
│                                                                 │
│              Accessibility Access Required                      │
│                                                                 │
│     Oscar needs Accessibility permission to paste               │
│     transcribed text into your active application.              │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  This allows Oscar to:                               │     │
│     │  • Paste transcribed text where your cursor is       │     │
│     │  • Insert screenshots into supported apps            │     │
│     │  • Detect which app is active for smart pasting      │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│               [ Grant Accessibility Access ]                    │
│                                                                 │
│                   ● ● ○ ○ ○  (3 of 5)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Interaction**:
1. User clicks "Grant Accessibility Access"
2. Open System Preferences to Privacy → Accessibility
3. User manually enables Oscar
4. Poll for permission status (already implemented)
5. When granted → auto-advance to next screen

**Note**: Accessibility requires user to manually toggle in System Preferences (no automatic prompt).

---

## Screen 4: Download Transcription Model

**Goal**: Download the Whisper model

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           📦                                    │
│                                                                 │
│               Download Transcription Model                      │
│                                                                 │
│     Oscar uses Whisper, an AI model for transcription.          │
│     We'll download the Base model to get you started.           │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  Base Model                                          │     │
│     │  • ~150 MB download                                  │     │
│     │  • Good accuracy for most use cases                  │     │
│     │  • Fast transcription speed                          │     │
│     │                                                      │     │
│     │  You can download larger models later in Settings.   │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│                    [ Download Base Model ]                      │
│                         or                                      │
│                  Skip and download later                        │
│                                                                 │
│                   ● ● ● ○ ○  (4 of 5)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Downloading State**:
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           📦                                    │
│                                                                 │
│                  Downloading Base Model...                      │
│                                                                 │
│     ███████████████████░░░░░░░░░░░░░░░░░░  67%                 │
│                                                                 │
│                     98 MB of 147 MB                             │
│                                                                 │
│     This runs once. The model is stored locally                 │
│     and works offline after download.                           │
│                                                                 │
│                   ● ● ● ○ ○  (4 of 5)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Screen 5: Complete

**Goal**: Confirm setup and teach first action

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                           ✅                                    │
│                                                                 │
│                      You're All Set!                            │
│                                                                 │
│     Oscar is ready. Here's how to start:                        │
│                                                                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │                                                      │     │
│     │  Press ⌥ Space to start recording                   │     │
│     │                                                      │     │
│     │  Speak naturally, then release to transcribe.        │     │
│     │  Text is automatically pasted where your cursor is.  │     │
│     │                                                      │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│     Oscar lives in your menu bar →  [🎙️]                       │
│     Right-click for settings and more options.                  │
│                                                                 │
│                     [ Start Using Oscar ]                       │
│                                                                 │
│                   ● ● ● ● ●  (Complete!)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### State Management

```typescript
interface OnboardingState {
  currentStep: 'welcome' | 'microphone' | 'accessibility' | 'download' | 'complete';
  microphoneGranted: boolean;
  accessibilityGranted: boolean;
  modelDownloaded: boolean;
  completedAt: number | null;
  skipped: boolean;
}

// Store in preferences
preferencesManager.save({ onboarding: state });
```

### Component Structure

```
src/components/
├── Onboarding/
│   ├── OnboardingWizard.tsx      # Main wrapper
│   ├── WelcomeStep.tsx
│   ├── MicrophoneStep.tsx
│   ├── AccessibilityStep.tsx
│   ├── DownloadStep.tsx
│   ├── CompleteStep.tsx
│   ├── ProgressIndicator.tsx
│   └── styles.ts
```

### Window Configuration

```typescript
// Onboarding should be a focused modal window
const onboardingWindow = new BrowserWindow({
  width: 540,
  height: 480,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  titleBarStyle: 'hidden',
  vibrancy: 'window',
  backgroundColor: '#00000000',
  alwaysOnTop: true,
});
```

---

## When to Show Onboarding

1. **First Launch**: Show immediately after app starts
2. **Permission Revoked**: Show targeted screen for revoked permission
3. **After Update** (optional): Show changelog or new feature intro

### Skip Logic

If user clicks "Set up later":
- Store `skipped: true` in preferences
- Hide onboarding window
- Show tray icon normally
- Show gentle reminder after 3 uses without proper setup

---

## Error States

### Network Error (Model Download)
```
Download failed. Please check your internet connection.
[ Retry ]  [ Skip for now ]
```

### Model Already Exists
Skip download step if model is already present.

### Permissions Already Granted
Auto-advance past already-granted permission screens.

---

## Accessibility Considerations

- All screens support keyboard navigation
- Focus management between steps
- VoiceOver labels for all interactive elements
- Reduced motion preference respected (no animated transitions)

---

## Testing Matrix

| Scenario | Expected Behavior |
|----------|------------------|
| Fresh install | Show full onboarding flow |
| Onboarding completed | Skip to normal app |
| Microphone denied | Show retry screen |
| Accessibility denied | Show manual enable instructions |
| Model download fails | Show retry with skip option |
| User skips setup | Hide onboarding, remember choice |
| Permission revoked later | Show targeted re-permission screen |
| Upgrade from previous version | Skip onboarding (data migrated) |

---

## Copy Guide

### Tone
- Friendly but professional
- Confident about privacy claims
- Helpful when errors occur
- Not apologetic or overly casual

### Key Messages
1. "Your voice never leaves your Mac"
2. "Works offline after setup"
3. "Private by design"

### Avoid
- Technical jargon (don't say "model weights" or "inference")
- Scary security warnings (positive framing)
- Marketing speak (keep it genuine)

---

*Implementation estimate: 4-6 hours for basic flow, additional 2-3 hours for polish and error states.*
