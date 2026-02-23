# Dynamic Island Transparent Corner Incident Notes

Date: February 21, 2026
Area: `electron/main/dynamicIslandManager.ts` + Dynamic Island renderer windows

## Symptom
- During focus transitions (especially dismissing the Field Theory window), Dynamic Island side-pill corners intermittently rendered as white or hard-edged slabs.
- In some states, transcript surfaces lost expected rounded corners.
- Renderer CSS continued to report transparent page backgrounds, so this was not a React/CSS state bug.

## Core Problem
The failure was in macOS/Electron window-surface compositing, not renderer styling.

Two patterns made the issue reproducible:
1. Runtime `setBackgroundColor(...)` writes on transparent side windows (`left`/`right`) during frequent refresh/reassert paths.
2. Unnecessary app-level hide on blur (`app.hide()` path) while focus had already moved to another app.

Those transitions could push transparent overlays into a corrupted backing state (white/opaque corner artifacts).

## Final Fix
1. Keep side windows constructor-transparent and avoid runtime color churn.
- Transparent side windows are created with transparent backing and are no longer repeatedly rewritten with `setBackgroundColor` at runtime.
- This preserves rounded outer corners and avoids compositor instability.

2. Keep left side transparent across modes.
- Left window no longer toggles between opaque/transparent backing modes.
- This prevents sticky hard-corner regressions after mode transitions.

3. Keep drawer transparent so transcript rounding is visible.
- Drawer transparency allows renderer clip/path corner shaping to remain visible for transcript UI.

4. Do not hide the whole app from blur-handler dismissal.
- Blur-driven dismissal now uses `hide(false, 'app-browser-window-blur')` to avoid unnecessary app-level compositor churn.

## Engineering Rule (Do Not Reintroduce)
- Do not add repeated runtime `setBackgroundColor` reassertions for transparent Dynamic Island side windows.
- If window shape/rounding needs to change, prefer renderer-level shape clipping in a transparent window rather than flipping transparent backing state at runtime.

## If This Reappears
1. Confirm renderer backgrounds are still transparent (`html/body/root`) to rule out CSS regressions.
2. Check whether any recent change reintroduced runtime background rewrites on transparent windows.
3. Check whether any blur/focus path reintroduced app-level hide calls during overlay transitions.
4. Validate side windows are still created transparent in constructor options.

## Tests / Verification Anchors
- `electron/main/dynamicIslandManager.test.ts`
  - transparent side backing remains untouched across refreshes
  - refresh behavior preserves intended transparent/opaque split by window role
