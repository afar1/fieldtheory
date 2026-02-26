# Gaze Tracking Phase 3 (Dwell + Window Mapping + Focus Actions)

This document describes Phase 3 additions on top of Phase 1/2:

- Window list caching and gaze-to-window mapping
- Dwell engine with confidence/stability gating
- Configurable focus actions
- Renderer settings controls for dwell behavior

Phase 4 floating debug overlay behavior is documented separately in:

- `docs/GAZE_TRACKING_PHASE4_DEBUG_OVERLAY.md`

## Implemented Components

Main process:

- `electron/main/gaze/gazeWindowListCache.ts`
- `electron/main/gaze/gazeDwellEngine.ts`
- `electron/main/gaze/gazeWindowFocusManager.ts`
- `electron/main/gaze/gazeTrackingManager.ts`
- `electron/main/index.ts`
- `electron/main/preferences.ts`
- `electron/main/types/gaze.ts`

Renderer:

- `electron/preload.ts`
- `src/types/window.d.ts`
- `src/components/VisionSettings.tsx`

## Runtime Flow

1. Native helper emits normalized `gazeSample`.
2. `GazeTrackingManager` applies calibration offsets.
3. `GazeWindowFocusManager` maps calibrated gaze to unified screen coordinates.
4. `GazeWindowListCache` supplies recent visible windows (refreshed every `500ms`).
5. `GazeDwellEngine` evaluates:
   - continuous in-window gaze duration
   - confidence threshold
   - stability threshold
   - per-window cooldown
6. On trigger, manager emits internal dwell event and executes selected action:
   - `eventOnly`
   - `highlightBorder` (event for renderer overlay/highlight handling)
   - `bringToFront` (best effort via native helper window focus call)

## Window Cache

- Source: native helper `getWindowList()` (CGWindowList-backed data)
- Default refresh: `500ms`
- Additional refresh hooks:
  - screen parameter changes (`noteScreenParametersChanged`)
  - `NSWorkspace.activeSpaceDidChangeNotification` (native helper emits `activeSpaceChanged` -> manager `noteActiveSpaceChanged`)
- Filters out non-normal window candidates (invalid bounds/layer/non-visible sizes).

## Dwell Rules

- Dwell duration: `200ms` to `2000ms`
- Confidence threshold: `0.0` to `1.0`
- Dead zone: `40px` to `200px` from a window edge
- Cooldown: `500ms` to `6000ms` (default `1500ms`)
- Debounce behavior:
  - dwell timer resets if gaze leaves window
  - cooldown blocks immediate retrigger on same window

Stability is derived from recent gaze point variance and converted to a `0..1` score.

## Multi-Display Mapping (v1)

- Uses calibrated normalized gaze for base point.
- Applies coarse display selection from head yaw.
- Applies small yaw-based X correction when mapped display differs from the reference display.
- Works in unified display coordinate space (points, not physical pixels).

## New IPC Surface

- `gaze:getFocusConfig`
- `gaze:setFocusConfig`
- event: `gaze:dwellTriggered`
- event: `gaze:highlightWindow`

## Settings UI

Vision settings now includes dwell controls:

- Dwell duration slider
- Confidence threshold slider
- Dead zone slider
- Dwell action selector
- Last dwell event readout

## Preferences

Added preference key:

- `gazeWindowFocusConfig`

Default:

- `dwellDurationMs: 400`
- `confidenceThreshold: 0.6`
- `deadZonePx: 80`
- `cooldownMs: 1500`
- `dwellAction: eventOnly`

## Tests

- `electron/main/gaze/gazeDwellEngine.test.ts`
  - continuous dwell trigger
  - window-switch reset
  - cooldown enforcement
  - stability gating
- `electron/main/gaze/gazeWindowFocusManager.test.ts`
  - end-to-end dwell event emission
  - bring-to-front action dispatch
  - dead-zone suppression
  - yaw-based display selection
- `electron/main/gaze/gazeTrackingManager.test.ts`
  - focus config persistence via preferences
