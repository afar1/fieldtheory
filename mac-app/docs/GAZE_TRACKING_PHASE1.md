# Gaze Tracking Phase 1

This document describes the current `v1` Phase 1 implementation:

- Capture layer
- Vision inference layer
- Normalization layer

Calibration and Vision settings are documented in `docs/GAZE_TRACKING_PHASE2_CALIBRATION.md`.
Dwell/window focus behavior is documented in `docs/GAZE_TRACKING_PHASE3_DWELL_WINDOW_FOCUS.md`.
Floating debug overlay behavior is documented in `docs/GAZE_TRACKING_PHASE4_DEBUG_OVERLAY.md`.

## Scope

Phase 1 is implemented in:

- `electron/main/gaze/gazeTrackingManager.ts`
- `electron/main/types/gaze.ts`
- `electron/main/nativeHelper.ts`
- `electron/main/types/audio.ts`
- `electron/native/Sources/FieldTheoryHelper/GazeTrackingHelper.swift`

## Runtime Flow

1. Renderer (or internal caller) toggles `gaze:setEnabled`.
2. `GazeTrackingManager` starts/stops native tracking through `NativeHelper`.
3. Swift helper runs camera capture + Vision on dedicated queues.
4. Swift emits:
   - `gazeTrackingStatus`
   - `gazeSample` (normalized sample stream)
5. Main process rebroadcasts:
   - `gaze:statusChanged`
   - `gaze:sample`

Manager lifecycle guarantees:

- `init()` is retry-safe if helper status hydration fails.
- `setEnabled(...)` is idempotent when called with the current state.
- Emitted samples are cloned so listener mutation cannot corrupt manager state.

## Threading Model (Phase 1)

Main process:

- Uses manager lifecycle in `GazeTrackingManager`.
- Event rebroadcast to renderer occurs on main process event loop (same pattern as other managers).

Swift helper:

- Capture session queue: `fieldtheory.gaze.capture`
- Vision processing queue: `fieldtheory.gaze.vision`
- JSON output serialization: main queue via `sendJSON(...)` to avoid stdout interleaving

## Privacy and Data Handling

- Frames are processed in memory only.
- No raw frames are written to disk.
- No network behavior in this subsystem.
- Camera permission gates startup. If denied/restricted, tracking remains disabled and status reason is returned.

## Normalization Output

Each `gazeSample` currently includes:

- `leftEye`, `rightEye`, `combinedEye` (normalized `[0,1]`)
- `headPose` (yaw/pitch/roll)
- `gazeVector` (head-pose-compensated 3D vector)
- `faceBounds` + `faceSize`
- `distanceScale` (relative to reference face size)
- `confidence`

## Preference and Packaging

- Preference key: `gazeTrackingEnabled` (default `false`)
- Camera usage string added to packaging metadata:
  - `NSCameraUsageDescription`

## Current Tests

- `electron/main/gaze/gazeTrackingManager.test.ts`
  - disabled startup behavior
  - enable + persistence behavior
  - sample stream propagation
  - deep clone safety for returned samples
  - clone safety against event-listener mutation
  - idempotent `setEnabled` behavior
  - init retry after helper status fetch failure
  - preference reload start/stop transitions

## Next Phases

Planned remaining layers:

1. Continuous implicit recalibration via click correlation
