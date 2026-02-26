# Gaze Tracking Troubleshooting

This guide is for cases where camera preview is visible but gaze focus feels wrong or does not trigger.

## Quick Checks

1. Open `Settings -> Vision`.
2. Turn on `Eye Tracking`.
   - If camera access is blocked, the app now prompts to open Camera Privacy settings.
3. Turn on `Debug Overlay Window`.
4. (Optional) Turn on `Screen Gaze Overlay` to project the pink gaze marker over the full desktop.
5. Check `Tracking Health` in Vision settings.

## How To Read Tracking Health

- `Age`: time since the last gaze sample.
  - Good: under ~300ms.
  - Bad: above 1200ms means stale stream.
- `FPS`: observed sample rate.
  - Target: ~15fps.
  - Below ~10fps can degrade dwell behavior.
- `Conf`: average confidence.
  - < 0.60 means unstable eye geometry.
  - < 0.40 is usually too low to trust.
- `Landmarks`: frames where eye landmarks were detected.
  - < 80% means intermittent tracking.
  - < 50% means frequent landmark loss.
- `Mapped`: whether gaze is being mapped into screen coordinates.

## Common Failure Patterns

- Camera video is visible, but pipeline status is missing/idle:
  - The debug panel uses renderer `getUserMedia`, while tracking runs in the native helper process.
  - Video alone confirms renderer camera access, not that native gaze samples are flowing.
- Camera image visible, but `Age` keeps climbing and everything is `n/a`:
  - Native gaze pipeline is running without valid face/eye samples.
  - Move face fully into frame (both eyes visible, no heavy backlight).
- `FPS` low with normal confidence:
  - CPU pressure or camera contention.
  - Close extra camera-heavy apps.
- `Conf` and `Landmarks` both low:
  - Improve lighting, face camera directly, reduce strong side lighting.
- `Mapped: no` with decent confidence:
  - Re-run calibration and keep head in a natural working position.

## Recalibration Guidance

- Use `Recalibrate now` when:
  - display layout changed,
  - setup changed significantly (distance/seat/lighting),
  - or calibration is older than 8 hours.
- Use `Enable Drag Adjust` in Vision Preview for quick offset correction.
