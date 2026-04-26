# Window Sizing and Command Palette UX Plan

## Goal

Make the main Field Theory window feel predictable across core workspaces, and make the portable command launcher clearer about what each result will do.

No product code changes are included in this plan.

## Current Read

The main window already uses a good underlying idea: named size profiles.

Today the profiles are:

- `fields`: default compact app surface
- `library`: reading and research surface
- `canvas`: wide visual surface
- `draw`: drawing surface

The main issue is that `fields` covers too many different jobs. Clipboard, Commands, Settings, Feedback, and other non-library tabs mostly share the same saved dimensions. That is technically simple, but it can feel arbitrary because resizing one workflow can affect another.

The command launcher has a separate and appropriate sizing model. It starts small, then grows with results up to a fixed max height. That fits a transient palette. The problem is not the resizing. The problem is mixed intent: some entries paste files into another app, some open Field Theory, some run built-in actions, and some manage windows.

## Plan

### 1. Clarify the Main Window Size Model

Change the product language and implementation model from "tab size" to "workspace size."

Proposed workspace profiles:

- `clipboard`: retrieval, paste, stack review
- `commands`: command reading and editing
- `library`: wiki, artifacts, bookmarks
- `draw`: drawing and visual annotation
- `settings`: utility configuration, likely fixed or compact
- `immersive`: temporary override, not a saved user profile

Verification:

- Switching between subviews inside the same workspace should not resize the window.
- Switching between different workspaces may resize the window.
- User resizing in one workspace should not surprise another unrelated workspace.

### 2. Split Commands Out of `fields`

Commands is a two-pane writing and editing workflow. It should not share the same size memory as clipboard history.

Proposed behavior:

- Add a `commands` size profile.
- Use it when entering the Commands tab.
- Keep Settings and Feedback on a compact profile unless they prove they need separate saved sizes.

Verification:

- Resize Commands, leave, return, and confirm it remembers the command editor size.
- Resize Clipboard, leave, return, and confirm it remembers the compact clipboard size.
- Confirm Commands resizing no longer changes Clipboard sizing.

### 3. Keep Librarian Stable

The current Librarian choice is good: wiki, artifacts, and bookmarks share the `library` profile.

Reason:

These are all reading and research surfaces. The user should be able to move around inside the library without the outer window jumping.

Verification:

- Move between wiki, artifacts, and bookmarks.
- Confirm there is no unnecessary resize animation.
- Confirm immersive mode still behaves as a temporary override.

### 4. Avoid Content-Measured Main Window Resizing

Do not make the main app resize based on exact content height.

Reason:

That creates jitter and makes layout feel unstable. It is better for a user to learn a few stable workspace sizes than to have the app constantly negotiate with content.

Verification:

- No main-window resize should be triggered by list count, search results, editor text length, or loading state.
- Resizing should be tied to explicit workspace changes only.

### 5. Rename the Launcher Concept

The launcher is no longer only "portable commands." It is closer to a command palette.

Proposed language:

- UI name: `Command Palette`
- Section name: `Portable Commands`
- Other sections: `Recent Handoffs`, `Field Theory`, `Window Actions`, `System Actions`

Verification:

- A new user can tell that portable commands are one category inside a broader palette.
- Existing portable command behavior remains unchanged.

### 6. Make Launcher Results Explain Their Consequence

Each launcher result should make clear what Enter will do.

Proposed result metadata:

- Type: Command, Handoff, Wiki, Artifact, Action, Window
- Destination: `Pastes into Cursor`, `Opens in Field Theory`, `Runs screenshot`, `Arranges windows`
- Optional target app line: `Target: Cursor`

Verification:

- Before pressing Enter, the user can predict whether the result will paste, open, toggle, capture, or arrange.
- Field Theory-active behavior is clear, especially when wiki/artifact results open internally.

### 7. Group Normal Launcher Results

Help mode should not be the only grouped experience.

Proposed default grouping:

- Best Matches
- Portable Commands
- Field Theory
- Recent Handoffs
- Window Actions

Verification:

- `?` help still works.
- Normal search results are easier to scan without adding extra keystrokes.
- Keyboard navigation remains simple.

### 8. Add Recency and Favorites Later

Once the result model is clearer, improve ranking.

Proposed ranking signals:

- Exact match
- Prefix match
- Recent use
- Pinned or favorite commands
- Current context, such as Field Theory active vs external app active

Verification:

- Commonly used commands rise naturally.
- Exact typed names still win.
- Ranking stays explainable.

### 9. Audit Built-In Launcher Actions

Some built-in actions are listed but may not be fully handled by the launcher invocation switch.

Actions to verify:

- Open Settings
- Take Screenshot
- Full Screen Screenshot
- Active Window Screenshot
- Start Recording
- Terminal Image Paste
- Open Clipboard History
- Toggle Theme
- Window management actions

Verification:

- Every visible action either works or is removed from results.
- Failed actions show an in-launcher error instead of silently doing nothing.

## Engineering Guardrails

- Keep the main window boring and predictable.
- Keep the launcher fast and expressive.
- Prefer explicit workspace profiles over clever content measurement.
- Do not add new abstractions until the `commands` profile and launcher action audit prove the need.
- Preserve existing shortcuts and file invocation behavior.

## Suggested First Implementation Slice

1. Add a `commands` size profile.
2. Route the Commands tab to that profile.
3. Add focused tests for size profile persistence.
4. Audit built-in launcher actions and remove or wire any dead entries.
5. Rename launcher-facing copy after behavior is correct.

## Review Notes

This plan is intentionally conservative.

The main tradeoff is that adding a `commands` profile creates one more saved window state. That is worth it because Commands is a distinct editor workspace, not a compact clipboard surface.

The larger launcher redesign should wait until the action audit is done. A prettier command palette that still contains dead or ambiguous actions would be the wrong order of work.
