# Open Source Readiness Progress

This page tracks the active push to finish Field Theory Mac open-source readiness work that has not been deferred.

**Deferred**

- [ ] Choose and apply the final license model. This is a human product/legal decision and is intentionally deferred.

**Current status**

The active worktree is `/Users/afar/dev/fieldtheory-mac-open-source-readiness` on `codex/mac-open-source-readiness`. The root checkout `/Users/afar/dev/fieldtheory` is the local staging bench on `experimental`. The root still has preexisting `md` submodule dirt that this work should not touch.

The first Tier 2 code slice is complete. The shell IPC family now lives in `mac-app/electron/main/shellIpc.ts`. `mac-app/electron/main/index.ts` delegates to `registerShellIpc()`, so the public channel names and preload API stay unchanged. The focused test `npm test -- shellIpc.test.ts` passes with 8 tests. `npm run build` passes. `npm run typecheck` was attempted first, but it is still blocked by root/mobile TypeScript dependency gaps outside the shell slice.

**Tier 1 public-readiness work**

- [x] Rewrite public entry docs from the current codebase instead of stale README truth.
- [x] Add `mac-app/.env.example` with non-secret optional account-backed configuration.
- [x] Rewrite privacy and security docs from current local/cloud data flow.
- [x] Add contributor-facing setup and maintainer-only release separation.
- [x] Add dependency license summary automation.
- [x] Clean high/critical production dependency audit findings.
- [x] Remove unknown-provenance unused sounds, onboarding images, legacy tray icons, and reference voice assets.
- [x] Add a current tracked-file secret/private-reference audit note.
- [x] Run a history-aware git-log secret/private-reference audit.
- [ ] Run a history-aware secret audit with a dedicated scanner before publication.
- [x] Add dependency and asset follow-up note for remaining unknowns.
- [x] Replace third-party notices draft with a current notice/provenance index.
- [x] Resolve missing npm license metadata with documented overrides.
- [ ] Resolve brand/icon asset provenance follow-up for remaining unknowns.
- [x] Rewrite Mac release workflow docs so they no longer describe a private-source/public-release split.
- [x] Remove obviously private Cursor operational command docs for unrelated deploy/droplet/env/release workflows.
- [x] Finish a broader pass over remaining Cursor, Claude, and iOS docs for private paths or maintainer-only assumptions.
- [x] Review Supabase policy/account-backed wording as far as repo code allows without changing production infrastructure.

**Tier 2 architecture and boundary work**

- [x] Add an IPC capability map.
- [x] Add a feature-state inventory.
- [x] Extract `shell:*` IPC handlers from `main/index.ts` into `shellIpc.ts`.
- [x] Extract `account:*` IPC handlers from `main/index.ts` into `accountIpc.ts`.
- [x] Extract `fieldTheorySync:*` IPC handlers from `main/index.ts` into `fieldTheorySyncIpc.ts`.
- [x] Extract `metrics:*` IPC handlers from `main/index.ts` into `metricsIpc.ts`.
- [ ] Extract the next low-risk IPC owner from `main/index.ts` if it clearly improves public comprehension.
- [ ] Review auth/session renderer boundary and document or narrow token-bearing paths where safe.
- [ ] Make contributor-safe local data paths clearer in docs and, if practical, add first-class dev/test overrides.
- [ ] Reduce public confusion around release infrastructure.
- [ ] Keep docs updated as code ownership changes.

**Tier 3 useful polish after the baseline is honest**

- [ ] Add architecture diagrams if the text docs stabilize.
- [ ] Add local-only contributor fixtures or a demo path if practical.
- [ ] Add public issue/contribution path notes if they can be done without pretending license is decided.

**Verification log**

- [x] `npm test -- shellIpc.test.ts` passed with 8 tests.
- [x] `npm test -- accountIpc.test.ts shellIpc.test.ts` passed with 12 tests.
- [x] `npm test -- fieldTheorySyncIpc.test.ts accountIpc.test.ts shellIpc.test.ts` passed with 16 tests.
- [x] `npm test -- metricsIpc.test.ts fieldTheorySyncIpc.test.ts accountIpc.test.ts shellIpc.test.ts` passed with 20 tests.
- [x] `npm run build` passed after the shell IPC extraction.
- [x] `npm run build` passed after the account IPC extraction.
- [x] `npm run build` passed after the Field Theory sync IPC extraction and private-reference cleanup.
- [x] `npm run license:summary` passed and still reports 1204 package entries with 2 missing-license entries.
- [x] `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities.
- [x] `npm run guard:package-safety` passed.
- [x] `npm run guard:package-safety:experimental` passed.
- [x] `git diff --check` passed after the shell IPC extraction.
- [ ] Run updated focused tests for each new code boundary move.
- [x] `npm run build` passed after the metrics IPC extraction and audit documentation updates.
- [x] `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities after the metrics IPC extraction and audit documentation updates.
- [x] `npm run guard:package-safety` passed after the metrics IPC extraction and audit documentation updates.
- [x] `npm run guard:package-safety:experimental` passed after the metrics IPC extraction and audit documentation updates.
- [ ] Record any checks that cannot pass because of known unrelated repo state.
