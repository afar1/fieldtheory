# Gaze Tracking Phase 4 (Floating Debug Overlay)

This document describes the Phase 4 debug overlay additions:

- Dedicated floating overlay window lifecycle manager
- Mirrored camera feed + lightweight landmark rendering
- 15fps-throttled telemetry updates
- Settings toggle and persisted overlay bounds

## Implemented Components

Main process:

- `electron/main/gaze/gazeDebugOverlayManager.ts`
- `electron/main/index.ts`
- `electron/main/preferences.ts`
- `electron/main/types/gaze.ts`

Native helper integration:

- `electron/main/types/audio.ts`
- `electron/main/nativeHelper.ts`
- `electron/native/Sources/FieldTheoryHelper/GazeTrackingHelper.swift`
- `electron/native/Sources/FieldTheoryHelper/main.swift`

Overlay renderer:

- `electron/gaze-debug-overlay-preload.ts`
- `gaze-debug-overlay.html`
- `src/gaze-debug-overlay.tsx`
- `src/components/GazeDebugOverlay.tsx`

Settings wiring:

- `electron/preload.ts`
- `src/types/window.d.ts`
- `src/components/VisionSettings.tsx`
- `electron/main/gaze/gazeScreenOverlayManager.ts`
- `electron/gaze-screen-overlay-preload.ts`
- `gaze-screen-overlay.html`
- `src/gaze-screen-overlay.tsx`
- `src/components/GazeScreenOverlay.tsx`

## Behavior

- Toggle path: Vision settings -> `gaze:setDebugOverlayEnabled`.
- Default state: off.
- Overlay window:
  - always on top
  - resizable + repositionable
  - skip taskbar
  - remembers bounds in preferences
- Closing the overlay does **not** stop gaze processing.
- Optional `Screen Gaze Overlay` toggle shows a transparent, click-through full-screen pink marker at mapped gaze position.

## Data Feed

Overlay snapshot payload includes:

- gaze status
- calibration state
- latest sample

Sample now includes optional geometry fields used by overlay rendering:

- `landmarks.leftEye/rightEye`
  - `medialCanthus`
  - `lateralCanthus`
  - `irisCenter`
- `activeDisplayId` (coarse mapped display from focus manager)
- `mappedScreenPoint` (mapped unified-coordinate gaze point)

## Rendering

The overlay UI uses:

- mirrored `<video>` stream (`getUserMedia`) for camera preview
- `<canvas>` overlays for:
  - face bounds
  - eye corner dots
  - iris center crosshairs
  - gaze direction arrow
  - calibrated gaze crosshair
- status text:
  - confidence
  - distance estimate
  - active screen
  - calibration age
  - refinement count
  - yaw/pitch/roll

Overlay update emission from main process is throttled to 15fps.

## Tracking Health Signals

Vision settings now computes a lightweight health summary from recent samples:

- sample age (ms since last sample)
- observed sample rate (fps over the last ~5s)
- average confidence
- landmark availability rate
- mapped-point availability

Health is bucketed into `ok`, `warning`, or `error` with explicit reasons. This helps debug cases where camera preview is visible but gaze samples are missing or unstable.

Overlay status text also includes:

- pipeline state (disabled/running/stopped with reason)
- camera authorization state
- last-sample age

Operational guide: see `docs/GAZE_TRACKING_TROUBLESHOOTING.md`.

## Active Space Hook

Native helper now emits `activeSpaceChanged` on:

- `NSWorkspace.activeSpaceDidChangeNotification`

Main process consumes this event to refresh window mapping state immediately.

## Tests

- `electron/main/gaze/gazeDebugOverlayManager.test.ts`
  - enable -> create/show window
  - user-close -> disable/persist
  - sample updates -> snapshot send
- Existing gaze tests still pass after Phase 4 additions.
