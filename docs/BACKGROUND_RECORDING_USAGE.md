# Background Recording Implementation - Usage Guide

## Overview

This branch enables **background recording** and **instant tab switching**. Recording continues even when:
- The screen is locked
- The app is in the background
- You switch to another app

## Key Changes

### 1. Background Audio Mode Enabled
```
┌─────────────────────────────────────────────────────────┐
│ iOS Configuration Changes:                              │
├─────────────────────────────────────────────────────────┤
│ • Info.plist: Added UIBackgroundModes = ["audio"]       │
│ • app.json: Added UIBackgroundModes = ["audio"]         │
│ • Audio session: staysActiveInBackground = true         │
└─────────────────────────────────────────────────────────┘
```

### 2. Visual Recording Indicator
```
┌─────────────────────────────────────────────────────────┐
│  🔴 Recording...                                         │
│  (Orange dot + text at top of screen)                   │
│  (Visible on all tabs, even when app is backgrounded)   │
└─────────────────────────────────────────────────────────┘
```

### 3. Instant Tab Switching
```
┌─────────────────────────────────────────────────────────┐
│ Before: Tab switches with animation (slow)              │
│ After:  Tab switches instantly (setPageWithoutAnimation)│
│                                                         │
│ Benefits:                                               │
│ • Faster navigation                                     │
│ • No animation conflicts with WebView                   │
│ • Better UX when recording                             │
└─────────────────────────────────────────────────────────┘
```

## How to Use

### Starting Background Recording

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Tap the Record button (center of bottom bar)       │
│                                                         │
│     ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│     │ Stacks  │  │ Cursor  │  │  Tasks  │              │
│     └─────────┘  └─────────┘  └─────────┘              │
│                                                         │
│              ┌──────────────┐                          │
│              │    🎤 REC    │  ← Tap here              │
│              └──────────────┘                          │
│                                                         │
│  2. Recording starts - orange indicator appears:       │
│                                                         │
│     ┌─────────────────────────────────────┐            │
│     │  🔴 Recording...                      │            │
│     └─────────────────────────────────────┘            │
│                                                         │
│  3. You can now:                                        │
│     • Lock your phone screen                            │
│     • Switch to another app                             │
│     • Navigate between tabs                             │
│     • Recording continues!                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Recording Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  USER ACTION: Tap Record Button                        │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ Audio Session Configured            │               │
│  │ • staysActiveInBackground = true    │               │
│  │ • allowsRecordingIOS = true         │               │
│  └─────────────────────────────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ Recording Starts                     │               │
│  │ • Orange indicator appears           │               │
│  │ • Audio capture begins              │               │
│  └─────────────────────────────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ User can:                            │               │
│  │ • Lock screen ✓                      │               │
│  │ • Switch apps ✓                     │               │
│  │ • Navigate tabs ✓                   │               │
│  │ Recording continues in background   │               │
│  └─────────────────────────────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ USER ACTION: Tap Stop Button        │               │
│  └─────────────────────────────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ Recording Stops                      │               │
│  │ • Audio file saved                   │               │
│  │ • Transcription begins               │               │
│  └─────────────────────────────────────┘               │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────┐               │
│  │ Transcription Complete              │               │
│  │ • Text appears in Transcripts tab     │               │
│  │ • Auto-copied to clipboard          │               │
│  └─────────────────────────────────────┘               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Tab Navigation (Instant Switching)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Bottom Tab Bar Navigation:                            │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Stacks  │ │ Cursor  │ │  Tasks  │ │  Notes  │   │
│  │          │ │         │ │         │ │         │   │
│  │  [layers]│ │[terminal]│ │[check] │ │  [eye]  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  • Tapping any tab switches INSTANTLY (no animation)   │
│  • No swipe gestures (disabled to avoid WebView       │
│    conflicts)                                          │
│  • Recording indicator stays visible on all tabs       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Technical Implementation Details

### Files Modified

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Core Changes:                                          │
│                                                         │
│  1. App.tsx                                             │
│     • Added recording indicator UI                      │
│     • Changed setPage() → setPageWithoutAnimation()    │
│     • Added overdrag={false} to PagerView              │
│                                                         │
│  2. hooks/useWhisperRecording.ts                        │
│     • Added staysActiveInBackground: true              │
│     • Audio session configured for background          │
│                                                         │
│  3. hooks/useHeadsetControls.ts                        │
│     • Added staysActiveInBackground: true              │
│                                                         │
│  4. app.json                                            │
│     • Added UIBackgroundModes: ["audio"]               │
│                                                         │
│  5. ios/littleai/Info.plist                            │
│     • Added UIBackgroundModes array with "audio"       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Audio Configuration

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Audio Session Settings:                                │
│                                                         │
│  {                                                       │
│    allowsRecordingIOS: true,                            │
│    playsInSilentModeIOS: true,                          │
│    staysActiveInBackground: true,  ← KEY CHANGE         │
│    shouldDuckAndroid: true,                             │
│    playThroughEarpieceAndroid: false                    │
│  }                                                       │
│                                                         │
│  This allows:                                            │
│  • Recording when screen is locked                      │
│  • Recording when app is backgrounded                   │
│  • Recording when user switches apps                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Testing the Feature

### Test Scenario 1: Lock Screen Recording

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Start recording                                      │
│  2. Lock your iPhone                                    │
│  3. Wait 10 seconds                                     │
│  4. Unlock and stop recording                           │
│  5. Verify transcription captured audio                 │
│                                                         │
│  Expected: Recording continues, transcription works     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Test Scenario 2: App Switching

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Start recording                                      │
│  2. Press home button (go to home screen)               │
│  3. Open another app (e.g., Messages)                   │
│  4. Wait 10 seconds                                     │
│  5. Return to app                                       │
│  6. Stop recording                                       │
│  7. Verify transcription captured audio                 │
│                                                         │
│  Expected: Recording continues, transcription works     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Test Scenario 3: Tab Navigation During Recording

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Start recording                                      │
│  2. Navigate between tabs (Stacks → Cursor → Tasks)     │
│  3. Verify:                                              │
│     • Tab switching is instant (no animation)           │
│     • Recording indicator stays visible                 │
│     • Recording continues                               │
│  4. Stop recording                                       │
│  5. Verify transcription works                          │
│                                                         │
│  Expected: Smooth navigation, recording unaffected      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Visual Indicators

### Recording State Indicators

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  NOT RECORDING:                                         │
│                                                         │
│  ┌─────────────────────────────────────┐               │
│  │  [Normal app UI]                    │               │
│  │                                      │               │
│  │  No indicator                        │               │
│  └─────────────────────────────────────┘               │
│                                                         │
│  RECORDING:                                             │
│                                                         │
│  ┌─────────────────────────────────────┐               │
│  │  🔴 Recording...                      │  ← Orange    │
│  │  ─────────────────────────────────── │               │
│  │  [App content]                       │               │
│  └─────────────────────────────────────┘               │
│                                                         │
│  PROCESSING:                                            │
│                                                         │
│  ┌─────────────────────────────────────┐               │
│  │  [Spinner] Transcribing...           │               │
│  └─────────────────────────────────────┘               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Benefits

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ✓ Record hands-free (lock screen)                      │
│  ✓ Record while using other apps                        │
│  ✓ Instant tab navigation (better UX)                   │
│  ✓ Visual feedback always visible                      │
│  ✓ No animation conflicts with WebView                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Known Limitations

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  • iOS only (Android background recording requires      │
│    different implementation)                            │
│  • Battery usage increases when recording in            │
│    background (expected behavior)                        │
│  • Live Activities not yet implemented (see             │
│    LIVE_ACTIVITY_IMPLEMENTATION.md for future work)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Next Steps (Future Enhancements)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  See: docs/LIVE_ACTIVITY_IMPLEMENTATION.md              │
│                                                         │
│  Planned features:                                       │
│  • iOS Live Activities (lock screen widget)             │
│  • Dynamic Island integration (iPhone 14 Pro+)         │
│  • Lock screen controls (stop/pause buttons)            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
