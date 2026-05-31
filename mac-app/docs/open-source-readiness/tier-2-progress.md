# Tier 2 Progress

This page tracks the current open-source readiness code slice in plain English.

**Current slice**

Extract the shell IPC handler family from `mac-app/electron/main/index.ts` into a focused main-process module, without changing renderer APIs or IPC channel names.

**To do**

- [x] Confirm root and task worktree state before editing.
- [x] Fast-forward the task worktree to the saved root state.
- [x] Read the current Tier 2 readiness docs.
- [x] Inspect the current `shellAPI` preload surface and `shell:*` main handlers.
- [x] Move `shell:openExternal`, `shell:showItemInFolder`, and `shell:setRepresentedFilename` into a feature-owned IPC registration module.
- [x] Keep the existing public channel names unchanged.
- [x] Add focused tests for allowed external URLs, blocked external URLs, Finder reveal behavior, directory-open behavior, and represented filename behavior.
- [x] Update readiness docs so the owner map points to the new shell module.
- [x] Verify with `git diff --check`.
- [x] Package JSON verification was not needed because package files were not touched.
- [x] Run the focused shell IPC test.
- [x] Run one broader static check from `mac-app` if feasible.

**Status**

The shell IPC family now lives in `mac-app/electron/main/shellIpc.ts`. `mac-app/electron/main/index.ts` delegates to `registerShellIpc()`, so the public channel names and preload API stay unchanged. The focused test `npm test -- shellIpc.test.ts` passes with 8 tests. `npm run build` passes. `npm run typecheck` was attempted first, but it is still blocked by root/mobile TypeScript dependency gaps outside this shell slice.
