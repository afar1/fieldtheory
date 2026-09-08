# Field Theory Voice combined preview scope

This audit records the user-authorized minimal Inbox iteration after the installed `0.3.47-voice.2` phone-to-Codex activation. It describes candidate source, not a shipped or newly installed build. The earlier [production activation receipt](VOICE_PRODUCTION_ACTIVATION.md) is preserved as historical evidence.

## Source provenance

| Source | Commit | Scope |
| --- | --- | --- |
| Configured Launcher carousel | `cc4917ca4` | First enabled section on open; ordered Tab/Shift-Tab wrapping across search, selection, folders, and sources |
| Library Settings picker | `e78e8c9c242b032292bcf70da15ffcd177b7f031` | Explicit Library choice, user-facing explanation, and stale picker-response tests |
| Readable Codex runner | `c7d17afa9f900d688a374ca5a63ce3c619e2054d` | Plaintext/Markdown primary conversation; separate bounded ephemeral outcome classification; recovery compatibility |
| Inbox store and sync | `33e00e13c8cef14fe60c6b5ba599d333167a8044` | Core transcript notes, confirmed task links, folder persistence, edit guards, authenticated history/push reconciliation |
| Account-safe Launcher preferences | `0ce9c9147` | Queued owner-fenced updates preserve configured order and unrelated settings |
| Bounded Library folder discovery | `462b3d3e5` | Async writable-folder enumeration within registered roots |
| Combined manager/index/router/link integration | `8fefd6aca` | Actual destinations and confirmed task links; Library sync/picker/rename and account-safe Launcher settings |
| Scope/evidence documentation | `903c639e8`, `dff63ed75` | Candidate flow, historical activation distinction, bounded runtime canaries |

The branch is `codex/voice-event-delivery`. It retains the released 0.3.46 source and the installed `.voice.2` repair history. Unrelated original-checkout changes were not part of the Inbox implementation. The package version and final new artifact identity must come from the completed packaging receipt, not from either historical DMG.

## Requirement and implementation audit

| Approved requirement | Candidate implementation and boundary | Verification |
| --- | --- | --- |
| Library is the central record of synced mobile transcripts | One stable Markdown note per account/transcript identity; includes historical and context-only recordings | Inbox service/history tests |
| Default Inbox without losing an existing choice | Create/reuse `Inbox` for a new account; preserve prior choices, including legacy folders outside Library; missing prior folders require explicit reselection | Default/reuse, legacy, missing-path/restart tests |
| Rename or choose another Library folder | Follow folder identity on startup, readiness checks, execution, and built-in/external Library rename events; new choices stay within registered roots | Folder, picker, and manager tests pass; installed rename UI pending |
| Configured Launcher carousel | Preserve enabled order including Inbox, Recents, Clipboard, River with Bookmarks disabled; first enabled section on open; Tab/Shift-Tab wrap; Enter enters folders/sources | 27 integration, 165 utility, and 4 Settings tests |
| Minimal receipt | Core transcript plus sent indication and actual task link; no copied images, artifacts, answers, or ongoing progress dashboard | Receipt-content and user-edit tests |
| Truthful sent state | Actual `turn/started` callback, or historical real `thread_id` with `result.turn_id`/completed status; begin-dispatch alone is insufficient | Missing-evidence rejection and historical confirmation tests |
| Existing mountain stays the existing task | Historical receipt can link `01a07e3f-8d87-7a43-a7a5-f90f1b67d4d3`; import never regenerates or moves its image | Historical task is proven by activation receipt; actual candidate note/link acceptance pending user installation |
| Preserve user edits | Managed-section hashes and current document SHA conflict guard; preserve manual text/footer changes, renamed notes, and user-deleted notes | Direct edit, conflict race, rename/deletion tests |
| Backfill without replay | History service has no claim/configure/dispatch calls; execution remains under deployed cutoff, baseline, revision deduplication, generation and leases | History fixture tests plus existing backend/manager checks |
| No transcript polling | Subscribe before snapshot; full paged startup/reconnect reconciliation; ordinary events use durable timestamp/ID cursors; existing job wakes refresh destination receipts | Subscription ordering, ties, older late commits, coalescing/no-loop tests |
| Account isolation | Signed-in session, owner query/event filters, existing RLS, epoch checks before async read results write locally; separate per-owner state/cursors | Account-switch and pending-read cancellation tests; installed two-account test still pending |
| Codex chooses an appropriate destination | Bounded actual project/recent-task catalog; direct recorded-task lookup for revisions; reject unknown IDs/paths; clarify unresolved intent | Router source/fixtures; new installed routing acceptance pending |
| Normal visible conversation | Primary task receives ordinary transcript text and has no forced output schema; actual answer/media stay in Codex | Runner protocol tests; new visible conversation acceptance pending |
| Internal bookkeeping stays internal | Ephemeral routing/classification, work capabilities and MCP disabled, bounded inputs/timeouts, unexpected work rejected | Runner protocol tests; actual runtime internal tasks absent from native task list |
| Open the actual task | Canonical `codex://threads/<UUID>` links, strict URL validation, actual recorded task IDs in Settings/Markdown | Link/renderer/IPC checks in final integration; installed Copy Task Link format was inspected; new click-through acceptance pending |

The Library folder is transcript intake. An actionable request may belong to another real Codex project/task; it is not automatically assigned to Inbox as its project. Catalog inspection is bounded to at most 150 projects and 150 recent tasks with usable local folders. This does not promise exhaustive older-task discovery. Existing active-task and permission restrictions remain in force.

Context, “hold off,” and nonactionable recordings do not receive invented destinations. Older history import does not invoke routing or execution. A newly eligible recording can use internal routing to decide whether any primary task is needed. A necessary routing question is asked in a normal task without project work beginning.

## Verification recorded for this iteration

Inbox commit `33e00e13c` passed:

```sh
# From mac-app/
npx vitest run electron/main/voiceInboxService.test.ts electron/main/voiceInboxSync.test.ts
npx tsc -p tsconfig.electron.json --noEmit
```

Result: **22 passing tests** (14 service, 8 sync), plus successful Electron typecheck. The tests use real temporary filesystem notes and a controlled Supabase protocol fixture. They do not launch Electron, authenticate a live session, mutate production, or prove a physical device path.

Production read-only inspection confirmed `public.transcripts` is already in the `supabase_realtime` publication. No publication or other backend mutation was required for this candidate. The existing 20 backend PGlite tests and installed activation observations remain useful prior evidence; they are not a new combined-build canary.

### Bounded live Codex canaries

The coordinating implementation agents reported these additional observations for the candidate source:

- Readable primary task `01a07e63-8b41-7071-996c-2f085656e3d4` emitted its answer in 4.575 seconds and completed 0.024 seconds later. Internal outcome classification took 4.802 seconds after primary completion. Persisted user input is plaintext; the answer is exactly “23 + 19 is 42.” The native task list includes the primary and excludes the ephemeral classifier. These are runner stage timings, not phone-to-visible latency.
- Routing read 25 actual projects and 150 tasks, with 24 projects and 124 tasks eligible after local-folder/internal-task filtering. A request explicitly naming an existing task and its ID selected that task correctly. Total reported routing time was 7.697 seconds: 2.695 seconds for catalog reads and 4.842 seconds for the internal decision. The routing probe created no durable work task or work turn.
- The app-server catalog matched 23 of 25 desktop project roots. `robin` had a missing directory; `density-cli` was accessible on disk but absent from that catalog. Thus the route catalog is bounded and may omit a real desktop project. Only explicit title/ID continuation was tested; ambiguous natural-language routing accuracy is not established.
- Inbox receipt tests confirmed the sent link is added after actual turn-start confirmation, without waiting for final outcome classification.

These canaries verify the installed signed-in Codex runtime through the candidate adapters. They do not verify a new Field Theory package, Library UI, physical phone path, locked-screen operation, or sleep behavior. Receipts are `/private/tmp/fieldtheory-readable-voice.p07TlX/receipt.json` and `/private/tmp/fieldtheory-routing-canary.YcpSeR/receipt.json`; catalog coverage is recorded beside the latter in `verification.json`. Classification delay is measured; a causal explanation or first-visible measurement of the earlier sidebar delay is not established. Confirmed task links avoid depending on Recents discovery.

**Source verification passed for `8fefd6aca`.** One combined run passed 419 tests across 13 files: runner (69), router (3), manager (27), IPC trust (17), Inbox service/sync (22), shell IPC (8), preferences (26), Voice Settings (21), Markdown prose (30), and Launcher integration/utilities/Settings (196). Folder discovery separately passed 10 tests, for 429 relevant tests total. Full `npm run typecheck` passed for renderer and Electron; `git diff --check` passed. No test failure remains. Read-only review confirmed the account and startup/external-folder rename fixes, with no new polling or historical execution.

From `mac-app`, the verification commands were:

```sh
npm test -- electron/main/voiceCodexRunner.test.ts electron/main/voiceCodexRouter.test.ts electron/main/voiceWorkManager.test.ts electron/main/voiceWorkIpcTrust.test.ts electron/main/voiceInboxService.test.ts electron/main/voiceInboxSync.test.ts electron/main/shellIpc.test.ts electron/main/preferences.test.ts src/components/__tests__/VoiceWorkSettings.test.tsx src/components/__tests__/FieldTheoryProse.test.tsx src/__tests__/commandLauncher.integration.test.tsx src/__tests__/commandLauncherUtils.test.ts src/components/__tests__/LauncherSettings.test.tsx
npm test -- electron/main/voiceLibraryFolders.test.ts
npm run typecheck
```

The drawing task owns the final combined version, release notes, artifact, and package verification. Integrate all commits after baseline `50e94b021`, including this audit update, without copying dirty files. No Voice-only DMG is needed.

## Release and physical acceptance still pending

No new candidate artifact, install, or device proof is claimed. Before calling the iteration delivered, record an approved signed/notarized package's source and artifact hashes and verify the new archive modules. The user installs the preview. Follow the [local install record/workflow](VOICE_LOCAL_INSTALL.md), without developer Electron launches or macOS security bypasses.

After that installation, visibly verify the Library folder default/picker, historical note materialization with no old work replay, the existing mountain's actual task link, a new actionable recording and its readable Codex conversation, context remaining an unsent note, and preserved edits/folder renames. The transcript note should remain minimal after work finishes; inspect the actual task for answers/media.

Locked-screen operation, sleep/offline reconnect, crash-boundary recovery, full second-account runtime isolation, and the remaining hosted transport-publish acceptance checks remain pending. Database timestamps and source tests are not phone-to-visible latency measurements. Preserve the limitations recorded in the [activation receipt](VOICE_PRODUCTION_ACTIVATION.md) and [backend runbook](VOICE_EVENT_BACKEND.md).
