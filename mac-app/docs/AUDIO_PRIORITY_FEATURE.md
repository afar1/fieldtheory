# Audio Input Priority Control for Little One

This document describes the implementation of the audio input priority control feature for the Little One wireless mic device.

## Overview

The feature allows macOS users to "lock" their system's default audio input to the Little One device, ensuring it remains the preferred microphone even when other devices (like headphones) connect or disconnect.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌──────────────────┐                   │
│  │   TrayManager   │────▶│   AudioManager   │                   │
│  │   (Menu Bar)    │     │   (State/Policy) │                   │
│  └─────────────────┘     └────────┬─────────┘                   │
│           │                       │                              │
│           │                       │ IPC                          │
│           ▼                       ▼                              │
│  ┌─────────────────┐     ┌──────────────────┐                   │
│  │  Context Menu   │     │  NativeHelper    │                   │
│  │  (User Control) │     │  (Process Mgmt)  │                   │
│  └─────────────────┘     └────────┬─────────┘                   │
│                                   │                              │
│                                   │ JSON over stdin/stdout       │
│                                   ▼                              │
│                          ┌──────────────────┐                   │
│                          │ LittleOneHelper  │                   │
│                          │ (Swift CLI)      │                   │
│                          └────────┬─────────┘                   │
│                                   │                              │
│                                   │ CoreAudio API                │
│                                   ▼                              │
│                          ┌──────────────────┐                   │
│                          │  macOS Audio     │                   │
│                          │  Subsystem       │                   │
│                          └──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Swift Native Helper (`electron/native/Sources/LittleOneHelper/`)

A command-line tool that interfaces with CoreAudio to:
- Enumerate audio devices
- Get/set the default input device
- Monitor for device and default input changes

**Building:**
```bash
cd electron/native
swift build -c release
```

### 2. NativeHelper (`electron/main/nativeHelper.ts`)

Electron wrapper that:
- Spawns and manages the Swift helper process
- Handles JSON message serialization/deserialization
- Implements debouncing to prevent event flapping
- Auto-restarts on crashes

### 3. AudioManager (`electron/main/audioManager.ts`)

Core state management that:
- Maintains the single source of truth for audio state
- Implements the priority policy (see below)
- Handles device identification (Little One detection)
- Emits state changes to subscribers

### 4. TrayManager (`electron/main/trayManager.ts`)

Menu bar integration that:
- Shows connection/lock status via icon
- Provides a context menu for control
- Updates reactively to state changes

### 5. AudioSettingsPanel (`src/components/AudioSettingsPanel.tsx`)

Optional in-app settings UI that:
- Displays current audio state
- Provides lock toggle control
- Shows connected devices list

## Priority Policy

The priority policy is implemented in `AudioManager` with these rules:

### 1. Device Preference
When multiple Little One devices are present (e.g., both USB dongle and Bluetooth):
- USB dongle is preferred for stability and lower latency
- Falls back to Bluetooth if only that is available

### 2. When Priority Mode is ON
- If Little One is present and not currently default: Set it as default
- If user manually changes to another device: Record as "user override"
- User override is respected until explicitly cleared or priority toggled

### 3. When Priority Mode is OFF
- No intervention in macOS audio behavior
- State is kept in sync for display purposes only

### 4. User Overrides
A user override is detected when:
- Priority mode is ON
- Default input changes to a non-Little-One device
- The change wasn't initiated by AudioManager itself

Override is cleared when:
- User clicks "Reset to Little One"
- Priority mode is toggled off then on
- User enables priority mode fresh

## State Model

```typescript
interface AudioState {
  devices: AudioDevice[];           // All audio devices
  defaultInputId: string | null;    // Current default input
  priorityMode: boolean;            // Lock enabled?
  userOverrideId: string | null;    // User's explicit choice
  littleOnePresent: boolean;        // Is Little One connected?
  preferredLittleOneId: string | null; // Which Little One to use
}
```

## IPC Protocol

### Electron Main ↔ Renderer

| Channel | Direction | Description |
|---------|-----------|-------------|
| `audio:getState` | R → M | Request current state |
| `audio:setPriorityMode` | R → M | Enable/disable lock |
| `audio:resetOverride` | R → M | Clear user override |
| `audio:stateChanged` | M → R | Broadcast state updates |

### Electron ↔ Native Helper

**Helper → Electron:**
```json
{ "type": "devicesChanged", "devices": [...] }
{ "type": "defaultInputChanged", "deviceId": "..." }
{ "type": "error", "message": "..." }
{ "type": "log", "level": "info", "message": "..." }
```

**Electron → Helper:**
```json
{ "type": "getDevices" }
{ "type": "getDefaultInput" }
{ "type": "setDefaultInput", "deviceId": "..." }
{ "type": "startMonitoring" }
```

## Tray Menu Structure

```
┌─────────────────────────────────────────┐
│ Little One: Locked as input             │  (status, disabled)
│ Current mic: MacBook Pro Microphone     │  (status, disabled)
├─────────────────────────────────────────┤
│ ☑ Lock input to Little One              │  (checkbox)
│ When locked, Little One stays your mic  │  (explanation, disabled)
├─────────────────────────────────────────┤
│ Open Little One App…                    │  (action)
│ Quit Little One                         │  (action)
└─────────────────────────────────────────┘
```

## File Structure

```
mac-app/
├── electron/
│   ├── main/
│   │   ├── index.ts          # Main entry point
│   │   ├── audioManager.ts   # State & policy
│   │   ├── trayManager.ts    # Menu bar UI
│   │   ├── nativeHelper.ts   # Swift bridge
│   │   └── types/
│   │       └── audio.ts      # Type definitions
│   ├── preload.ts            # IPC bridge
│   ├── assets/
│   │   └── README.md         # Icon instructions
│   └── native/
│       ├── Package.swift
│       └── Sources/
│           └── LittleOneHelper/
│               └── main.swift
├── src/
│   ├── components/
│   │   └── AudioSettingsPanel.tsx
│   └── types/
│       └── window.d.ts
├── scripts/
│   ├── generate-icons.sh     # Create tray icons
│   └── setup-native.sh       # Build Swift helper
└── docs/
    └── AUDIO_PRIORITY_FEATURE.md
```

## Development Setup

### Prerequisites
- macOS (for full functionality)
- Xcode or Xcode Command Line Tools (for Swift)
- Node.js 18+

### Build Commands

```bash
# Install dependencies
npm install

# Build Swift helper (macOS only)
npm run build:native

# Build Electron TypeScript
npm run build:electron

# Build React/Vite frontend
npm run build:vite

# Build everything
npm run build:all

# Run in development
npm run dev

# Package for distribution
npm run package
```

### Generating Tray Icons

```bash
./scripts/generate-icons.sh
```

Note: This creates placeholder icons. For production, design proper 16x16 and 32x32 (Retina) template images.

## Customization

### Changing Little One Device Detection

Edit the `LITTLE_ONE_NAME_PATTERNS` array in `audioManager.ts`:

```typescript
const LITTLE_ONE_NAME_PATTERNS = [
  'Little One',
  'LittleOne',
  'Your Custom Device Name',
];
```

### Adjusting Debounce Timing

Edit `DEBOUNCE_DELAY_MS` in `nativeHelper.ts`:

```typescript
const DEBOUNCE_DELAY_MS = 200; // Default: 200ms
```

## Testing

### Manual Testing Checklist

1. **Connection Detection**
   - [ ] Connect Little One via USB - detected as "connected"
   - [ ] Connect Little One via Bluetooth - detected as "connected"
   - [ ] Disconnect all - shows "not connected"

2. **Priority Lock**
   - [ ] Enable lock with Little One connected - becomes default input
   - [ ] Connect headphones while locked - Little One remains default
   - [ ] Disconnect Little One while locked - graceful fallback

3. **User Override**
   - [ ] With lock ON, manually change mic in System Preferences
   - [ ] Override should be detected and respected
   - [ ] "Reset to Little One" should clear override

4. **Tray Menu**
   - [ ] Icon updates with connection state
   - [ ] Checkbox reflects priority mode
   - [ ] Menu items enable/disable appropriately

## Known Limitations

1. **macOS Only** - The native helper uses CoreAudio, which is macOS-specific.

2. **Requires Swift Build** - The helper must be built on macOS with Swift toolchain.

3. **Aggregate Devices** - If Little One is part of an aggregate device, detection may not work.

4. **System Preferences Override** - If the user changes input in System Preferences while the app is setting it, there may be a brief conflict (handled by debouncing).

## Troubleshooting

### Helper Not Starting

Check the Electron console for errors:
```
[NativeHelper] Failed to spawn helper: ...
```

Ensure the helper binary is at the expected path:
- Development: `electron/native/build/LittleOneHelper`
- Production: `<app>/Resources/LittleOneHelper`

### Device Not Detected as Little One

The device name must match one of the patterns in `LITTLE_ONE_NAME_PATTERNS`. Check the actual device name in Audio MIDI Setup.app.

### State Not Syncing

1. Check that `startMonitoring` was called
2. Verify the helper process is running
3. Check for debounce delays (200ms default)
