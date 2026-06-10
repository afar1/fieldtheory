---
title: Startup Hydration and Leftnav Continuity Plan
date: 2026-06-10
status: active
---

# Startup Hydration and Leftnav Continuity Plan

## Goal

Make Field Theory open to a truthful first frame: no false empty Library state, no false empty document state, and no leftnav opening visibly expanded when persisted or contextual state says it should start closed.

## Scope

In scope:

- Distinguish "not loaded yet" from "loaded and empty" for Library roots.
- Distinguish "restored document path" from "document loaded or missing" for the reader.
- Preserve existing bounded empty-root retry behavior.
- Separate persisted sidebar collapse from responsive auto-collapse.
- Add focused cold-start tests for delayed roots, delayed selected document, and collapsed sidebar startup.

Out of scope:

- Cached last-frame rendering from durable snapshots.
- Broad visual redesign of the loading state.
- Dev-server or manual app startup unless explicitly requested.
- PR merge or deploy.

## Work Checklist

- [x] U1. Sidebar roots: add explicit initial root/tree load state in `mac-app/src/components/WikiSidebar.tsx`.
  - Verify delayed `libraryAPI.getRoots()` does not show "No pages yet" before first load finishes.
  - Verify true first-load empty roots still show the empty state after load completes.
  - Verify bounded empty-root retry still preserves prior non-empty state.
  - Evidence: `npm run test -- --run src/components/__tests__/WikiSidebar.test.ts` passed 36 tests.

- [x] U2. Selected document: add explicit restored-document loading state in `mac-app/src/components/LibrarianView.tsx`.
  - Verify restored wiki selection with delayed `wikiAPI.getPage()` does not show "Select a file."
  - Verify missing restored document eventually clears to the existing empty selection behavior.
  - Keep the loading shell neutral and minimal.
  - Evidence: focused restored-selection tests passed; full file still has an existing aggregate timeout in the multi-selection archive test, which passes in isolation.

- [x] U3. Leftnav state ownership: separate persisted collapse from responsive effective collapse.
  - Verify persisted `librarian-sidebar-collapsed = 1` is closed on first rendered frame.
  - Verify responsive auto-collapse does not write `librarian-sidebar-collapsed`.
  - Keep user toggle behavior writing the preference.
  - Evidence: `npm run test -- src/__tests__/browserLibraryApp.test.tsx` passed 53 tests.

- [x] U4. Integration review and final verification.
  - Run focused tests for `WikiSidebar`, `LibrarianView`, and `browserLibraryApp`.
  - Run typecheck only if the focused tests or touched types suggest it is needed.
  - Run `ft state` before reporting completion.
  - Evidence: `npm run test -- src/components/__tests__/WikiSidebar.test.ts` passed 36 tests; `npm run test -- src/__tests__/browserLibraryApp.test.tsx` passed 53 tests; `npm run test -- src/components/__tests__/LibrarianView.test.tsx -t "restored wiki selection|missing restored wiki page|uses x and j to build a multi-selection before archiving selected files"` passed 3 targeted tests. `npm run typecheck` is blocked by existing unrelated errors in `src/__tests__/libraryView.test.ts` and missing root React Native dependencies in this fresh worktree.

## Subagent Boundaries

- Sidebar worker owns `mac-app/src/components/WikiSidebar.tsx` and `mac-app/src/components/__tests__/WikiSidebar.test.ts`.
- Document worker owns `mac-app/src/components/LibrarianView.tsx` and `mac-app/src/components/__tests__/LibrarianView.test.tsx`.
- Main orchestrator owns `mac-app/src/browser-library.tsx`, `mac-app/src/__tests__/browserLibraryApp.test.tsx`, integration, and final review.

## Risks

- `LibrarianView.tsx` is large and stateful, so changes must stay narrow.
- Startup loading states can accidentally hide real empty states if the load-complete flags are wrong.
- Responsive auto-collapse is visual state; persisted collapse is user preference. Mixing them again would recreate the bug.
