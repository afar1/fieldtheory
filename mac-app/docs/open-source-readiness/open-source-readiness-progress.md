# Release Readiness Progress

This page tracks Field Theory Mac release-readiness work that has not been deferred.

**Deferred**

- [ ] Choose and apply the final license model. This is a human product/legal decision and is intentionally deferred.

**Current status**

The root checkout `/Users/afar/dev/fieldtheory` is the local staging bench on `experimental`. The current shipped review branch is `codex/mac-oss-root-stabilization`, opened as PR 317 against `experimental`. The root still has preexisting `md` submodule dirt that this work should not touch.

The non-license readiness pass is complete as far as this worktree can take it without human release decisions or external secret-scanner tooling. Docs now describe the current Mac app from code inspection. The shell, account, Field Theory sync, metrics, and quota IPC families have focused modules and tests. Remaining release decisions are documented instead of guessed.

**Tier 1 release-readiness work**

- [x] Rewrite entry docs from the current codebase instead of stale README truth.
- [x] Add `mac-app/.env.example` with non-secret optional account-backed configuration.
- [x] Rewrite privacy and security docs from current local/cloud data flow.
- [x] Add contributor-facing setup and maintainer-only release separation.
- [x] Add dependency license summary automation.
- [x] Clean high/critical production dependency audit findings.
- [x] Remove unknown-provenance unused sounds, onboarding images, legacy tray icons, and reference voice assets.
- [x] Add a current tracked-file secret/private-reference audit note.
- [x] Run a history-aware git-log secret/private-reference audit.
- [x] Document the dedicated history-aware scanner gate that must run during release review.
- [x] Add dependency and asset follow-up note for remaining unknowns.
- [x] Replace third-party notices draft with a current notice/provenance index.
- [x] Resolve missing npm license metadata with documented overrides.
- [x] Document brand/icon asset provenance as a remaining human confirmation, replacement, or removal decision.
- [x] Rewrite Mac release workflow docs so they no longer describe a split between source and release artifacts.
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
- [x] Extract `quota:*` IPC handlers from `main/index.ts` into `quotaIpc.ts`.
- [x] Stop the current IPC extraction pass after shell, account, sync, metrics, and quota because the next families touch broader auth/River/updater behavior.
- [x] Review auth/session renderer boundary and document token-bearing paths that are not safe to narrow in this pass.
- [x] Make contributor-safe local data paths clearer in docs.
- [x] Document first-class dev/test local data overrides as a future code pass, not part of this readiness slice.
- [x] Reduce contributor confusion around release infrastructure.
- [x] Keep docs updated as code ownership changes in this pass.

**Tier 3 useful polish after the baseline is honest**

- [x] Add architecture diagrams after the text docs stabilized.
- [x] Document local-only fixture/dev-profile work as a future decision instead of inventing a partial fixture.
- [x] Add issue/contribution path notes without pretending the license is decided.

**Verification log**

- [x] `npm run typecheck` passed on the current Mac app.
- [x] `npm test` passed on the current Mac app: 151 test files, 2364 tests passed, 1 skipped.
- [x] `npm run build` passed on the current Mac app.
- [x] `npm run guard:release-channel:experimental`, `npm run guard:tracked-sources`, `npm run guard:package-safety:experimental`, and `npm run guard:electron-dist-requires` passed on `experimental`.
- [x] `FIELD_THEORY_RELEASE_BRANCH_OVERRIDE=true npm run guard:release-channel`, `npm run guard:tracked-sources`, `npm run guard:package-safety`, and `npm run guard:electron-dist-requires` passed for a local production-package guard smoke on `experimental`.
- [x] `npm run test:library-text` passed at the repository root: 57 tests.
- [x] `npm test -- shellIpc.test.ts` passed with 8 tests.
- [x] `npm test -- accountIpc.test.ts shellIpc.test.ts` passed with 12 tests.
- [x] `npm test -- fieldTheorySyncIpc.test.ts accountIpc.test.ts shellIpc.test.ts` passed with 16 tests.
- [x] `npm test -- metricsIpc.test.ts fieldTheorySyncIpc.test.ts accountIpc.test.ts shellIpc.test.ts` passed with 20 tests.
- [x] `npm test -- quotaIpc.test.ts metricsIpc.test.ts fieldTheorySyncIpc.test.ts accountIpc.test.ts shellIpc.test.ts` passed with 25 tests.
- [x] `npm run build` passed after the shell IPC extraction.
- [x] `npm run build` passed after the account IPC extraction.
- [x] `npm run build` passed after the Field Theory sync IPC extraction and private-reference cleanup.
- [x] `npm run license:summary` passed after documented overrides and reports 1204 package entries with zero missing-license entries.
- [x] `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities.
- [x] `npm run guard:package-safety` passed.
- [x] `npm run guard:package-safety:experimental` passed.
- [x] `git diff --check` passed after the shell IPC extraction.
- [x] Run updated focused tests for each new code boundary move.
- [x] `npm run build` passed after the metrics IPC extraction and audit documentation updates.
- [x] `npm run build` passed after the quota IPC extraction and remaining boundary docs.
- [x] `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities after the metrics IPC extraction and audit documentation updates.
- [x] `npm run guard:package-safety` passed after the metrics IPC extraction and audit documentation updates.
- [x] `npm run guard:package-safety:experimental` passed after the metrics IPC extraction and audit documentation updates.
- [x] Record checks and gates that cannot be fully completed in this shell or without human release decisions.
