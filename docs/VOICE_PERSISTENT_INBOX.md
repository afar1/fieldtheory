# Persistent Field Theory Voice inbox

## Implementation

The push worker now supplies one account-scoped, durable `inboxThreadId` to the router. It saves the ID before the first inbox turn and resumes it for subsequent recordings. New users get one `Field Theory - Voice inbox` conversation. The runner resolves the existing Pinned section through `threadSection/list` and moves the inbox only if it is not already there, preserving its position on ordinary receipts. It does not edit Codex databases or create public share links.

Routing first gathers a bounded catalog and investigates selected conversations: up to three full-text queries, ten hits per query, five candidate conversations, six recent turns per candidate, 12,000 characters per conversation and 2,000 characters per matching excerpt. It keeps recent messages when truncating and excludes tool output and image payloads. The inbox's recent history helps select evidence; the resumed inbox retains its conversational context for the final routing decision. Imported history and search excerpts are evidence, not new permission.

The persistent inbox acknowledges the original recording and explains its proposed destination in plain English. A private, tool-disabled extraction turn converts that decision into the existing validated routing contract. Supplied catalog IDs are the only permitted destinations; transcript revisions retain their durable owner, while a new hold-off revision can still remain context. Ambiguous requests ask for clarification. Substantive work never runs in the routing inbox.

The worker records started/completed/needs-user/failed events with actual task links. Receipt keys are stable across retries; an existing completed receipt is recovered rather than appended again. Interrupted or ambiguous receipt turns require review. The per-attempt outbox persists delivery failures and retries on a bounded recovery wake without replaying substantive work. Sign-out aborts pending receipt delivery and removes inbox access. Settings exposes an Open voice inbox button independently of the most recent task.

Actual work is told that creating or selecting its destination conversation has already happened. This prevents a spoken "create a new task and do X" from recursively asking for another copy of the task. Completion still requires evidence that X finished.

The existing Realtime wakeups, backend capture eligibility, leases, dispatch keys, work recovery and permission restrictions remain in place. No five-minute scheduler or historical backlog execution was added. The model may retain earlier preferences through the persistent thread; this is bounded retrieval, not a guarantee of exhaustive recall of every old conversation.

## Verification — September 8, 2026

- Renderer and Electron: `npm run typecheck` passed.
- 132 tests passed across Voice router, routing flow, runner, worker and Settings. Coverage includes history truncation, verified candidates, durable-owner preservation, hold-off revisions, persistent-thread reuse, receipt replay recovery, pin-order preservation, outbox retry without duplicate work, and sign-out cancellation.
- Installed Codex accepted a setup turn in existing inbox `01a0795a-a845-7ef2-a60b-91a2ff036a45`. Repeating its receipt key returned the same completed response without another turn.
- Live full-text search for penguin returned matching historical conversations and bounded actual messages through the installed Codex protocol.
- Live routing of an explicit just-context/hold-off recording returned `context`; no substantive task was dispatched.
- The initial live work canary exposed the already-created-task handoff ambiguity. That result was retained as failed, and the instruction boundary was corrected instead of claiming success.
- The corrected `Personal - Voice handoff check` task (`01a08339-a1f9-7861-9d7f-e82eb911c520`) completed `17 + 25 = 42` without tools or file changes. Its result was linked from the pinned inbox, verified by reading actual turns. Codex's normal Recent listing returned the task unpinned. The existing inbox retained pinned position 13.
- Local canary receipts: `/tmp/fieldtheory-orchestrator-work-2026-09-08.json` and `/tmp/fieldtheory-orchestrator-handoff-2026-09-08.json`. No authentication files were inspected.

These are source and installed-Codex protocol checks. They do not claim a new Field Theory package, a replaced installed app, unread-badge behavior, physical-phone delivery through this new code, or locked/asleep operation.

## Local update handoff

Source worktree: `/Users/afar/dev/fieldtheory-voice-orchestrator`, rebased onto the installed 0.3.51 source `767bc2bbe` for the approved 0.3.52 package. The original checkout and other worktrees were preserved. Source checks initially used borrowed dependencies. The local package uses its own `npm ci` installation; the lockfile change only bumps the app version to 0.3.52. The previous 0.3.51 River teams source is retained.

Andrew's existing inbox is `Field Theory inbox`, `01a0795a-a845-7ef2-a60b-91a2ff036a45`; reuse it rather than creating a second primary inbox. The approved 0.3.52 update accepts a separate, account-scoped `voice-work/<owner>.inbox.json` adoption file containing that owner and the verified thread ID. This is consumed only when the existing worker snapshot does not already have an inbox ID. It preserves owner, worker ID, enabled state, attempts, capture settings and generation. Preparing this companion file does not edit the running app's snapshot; the previous installed version ignores it. The next update can therefore resume the existing primary without creating another one. Normal new-user setup saves its newly created inbox ID automatically.

The old `field-theory-voice-inbox` heartbeat was verified PAUSED and remains paused. Do not re-enable it alongside the push worker. The legacy cutoff `1788739104000` must never move backwards or permit historical backlog execution.

Release notes were approved on September 8. The signed/notarized local-only 0.3.52 DMG has been delivered; Andrew installs the preview. Verify the actual installed mobile-to-inbox-to-task path before treating activation as complete.

## Approved update notes — September 8, 2026

- Voice requests now arrive in one pinned Codex inbox, with routing updates and links to their tasks.
- Follow-ups can use past conversation content to find the right task, while context-only recordings stay as notes.

## Delivered local package — September 8, 2026

- Artifact: `mac-app/release/Field-Theory-0.3.52-arm64-local.dmg` (159,869,514 bytes).
- SHA-256: `413e3c3ffda3012337f2ac24185c263678c77eca592e66fc62b46869ba45eec0`.
- Source build: `59c8ab33e`, retaining the installed 0.3.51 River teams changes.
- App and DMG signatures, stapled notarization tickets, Gatekeeper assessment and DMG checksum verification passed. DMG notarization request: `304a5942-4aa4-4f40-963f-f6c8fe0ed12f` (Accepted).
- Before signing: 9,354 file hashes and 179 JavaScript syntax checks passed. After signing: all 8,844 packed hashes and 433 compiled Electron/renderer files matched; unpacked resources are covered by the verified bundle signature. Signing intentionally changes unpacked Mach-O bytes, so the before-signing ASAR metadata checker is not an after-signing checksum for those binaries.
- Packaged Electron 31.7.7, ABI 125: SQLite and terminal runtime checks passed. Production updater configuration is present. Full verification receipt: `mac-app/release/voice-package-verification-0.3.52.json`.
- The current account's separate inbox-adoption file was staged for the verified primary inbox. The running worker snapshot was not edited. It takes effect in the new version on launch.
- No GitHub upload, push or publishing; no DMG mounting, app replacement, or candidate UI launch. The installed app remained 0.3.51. Real mobile-to-inbox delivery in the newly installed build remains the final acceptance check.
