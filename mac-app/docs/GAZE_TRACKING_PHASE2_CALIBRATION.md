# Gaze Tracking Phase 2 (Calibration + Vision Settings)

This document describes the Phase 2 additions on top of Phase 1 gaze capture/inference:

- Personal offset calibration engine
- Recalibration prompt signals
- Calibration IPC API surface
- Vision settings UI (including matrix preview + drag correction)

Phase 3 dwell/window-focus behavior is documented separately in:

- `docs/GAZE_TRACKING_PHASE3_DWELL_WINDOW_FOCUS.md`

Phase 4 floating debug overlay behavior is documented separately in:

- `docs/GAZE_TRACKING_PHASE4_DEBUG_OVERLAY.md`

## Implemented Components

Main process:

- `electron/main/gaze/gazeCalibrationEngine.ts`
- `electron/main/gaze/gazeTrackingManager.ts`
- `electron/main/index.ts`
- `electron/main/types/gaze.ts`
- `electron/main/preferences.ts`

Renderer:

- `src/components/VisionSettings.tsx`
- `src/components/SettingsPanel.tsx`
- `electron/preload.ts`
- `src/types/window.d.ts`

## Calibration Flow

### Point sequence

The engine runs a fixed 5-point sequence:

1. center
2. top-left
3. top-right
4. bottom-left
5. bottom-right

### Stability-based capture

For the active point, the engine collects a rolling sample window and computes variance.

- Window size: `900ms`
- Stable duration requirement: `600ms`
- Variance threshold: `0.0008`
- Minimum frames in stable window: `6`

When the gaze window is stable long enough, the point sample is captured automatically and the flow advances.

### Offset fitting

After 5 points complete, the engine computes and stores:

- `horizontalOffset`
- `verticalOffset`
- `eyeDominance` (left-eye reliability weight)
- `referenceFaceSize`

It also computes an accuracy summary:

- label: `good` / `fair` / `poor`
- normalized mean error
- estimated pixel error (for user-facing messaging)

### Persistence

Calibration data is stored in preferences:

- `gazePersonalOffsets`
- `gazeLastCalibratedAtMs`

## Recalibration Prompt Signals

Implemented prompt triggers:

- Display configuration change (Electron display listeners call `noteScreenParametersChanged()`)
- Calibration age older than 8 hours at manager load/reload

Prompt state is exposed via calibration state:

- `needsRecalibrationPrompt`
- `recalibrationReason`

## Gaze IPC Additions

New channels:

- `gaze:getCalibrationState`
- `gaze:startCalibration`
- `gaze:cancelCalibration`
- `gaze:resetEyeTrackingData`
- `gaze:applyManualCorrection`
- event: `gaze:calibrationChanged`

## Vision Settings UI

A dedicated **Vision** section is added to `SettingsPanel`.

It includes:

- Eye tracking enable/disable toggle
- Recalibrate / cancel calibration actions
- Reset eye tracking data action
- Calibration progress and accuracy messaging
- Recalibration recommendation banner
- Toggleable matrix preview canvas
- Drag-to-correct peak mode (manual mini-game)

### Matrix preview

The preview in `VisionSettings.tsx` renders a structured particle grid and animated focus peak:

- Uses calibrated gaze when available (`calibratedCombinedEye`)
- Smooth interpolation to create quick transitional motion
- 30fps throttled canvas rendering
- Concentric rings + crosshair to show current focus center

### Drag correction mini-game

When drag-adjust mode is enabled, users can drag the preview peak to where they are actually looking.

On pointer release:

1. Renderer sends normalized target point via `gaze:applyManualCorrection`.
2. Main process applies a bounded incremental correction to personal offsets.
3. Offsets are persisted to preferences.
4. Updated calibration state and sample are re-emitted.

Calibration state now includes `manualCorrectionCount` so users can see how many manual refinements were applied in-session.

## Tests

- `electron/main/gaze/gazeCalibrationEngine.test.ts`
  - payload sanitization
  - 5-point completion and offset fitting
  - weighted calibrated output
  - recalibration prompt state
  - manual correction convergence + correction count
- `electron/main/gaze/gazeTrackingManager.test.ts`
  - calibration run + persistence assertions
  - display-change recalibration prompt assertions
  - manual correction persistence assertions
  - existing lifecycle/status/sample tests
