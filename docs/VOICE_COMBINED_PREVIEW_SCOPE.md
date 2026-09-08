# Field Theory Voice combined preview scope

This audit records the user-authorized minimal Inbox iteration after the installed `0.3.47-voice.2` phone-to-Codex activation. It describes candidate source, not a shipped or newly installed build. The earlier [production activation receipt](VOICE_PRODUCTION_ACTIVATION.md) is preserved as historical evidence.

## Source provenance

| Source | Commit | Scope |
| --- | --- | --- |
| Library Settings picker | `e78e8c9c242b032292bcf70da15ffcd177b7f031` | Explicit Library choice, user-facing explanation, and stale picker-response tests |
| Readable Codex runner | `c7d17afa9f900d688a374ca5a63ce3c619e2054d` | Plaintext/Markdown primary conversation; separate bounded ephemeral outcome classification; recovery compatibility |
| Inbox store and sync | `33e00e13c8cef14fe60c6b5ba599d333167a8044` | Core transcript notes, confirmed task links, folder persistence, edit guards, authenticated history/push reconciliation |
| Combined manager/index/router/link integration | **Pending final root integration SHA** | Candidate working-tree integration; final commit and combined verification must be recorded before packaging |

The branch is `codex/voice-event-delivery`. It retains the released 0.3.46 source and the installed `.voice.2` repair history. Unrelated original-checkout changes were not part of the Inbox implementation. The package version and final new artifact identity must come from the completed packaging receipt, not from either historical DMG.

## Requirement and implementation audit

| Approved requirement | Candidate implementation and boundary | Verification |
| --- | --- | --- |
| Library is the central record of synced mobile transcripts | One stable Markdown note per account/transcript identity; includes historical and context-only recordings | Inbox service/history tests |
| Default Inbox without losing an existing choice | Create/reuse `Inbox` for a new account; preserve prior choices, including legacy folders outside Library; missing prior folders require explicit reselection | Default/reuse, legacy, missing-path/restart tests |
| Rename or choose another Library folder | Follow stored folder identity on rename; new selections constrained to registered Library roots; paused-settings picker fences stale results | Folder rename/root/symlink tests; picker tests; final live rename integration pending |
| Minimal receipt | Core transcript plus sent indication and actual task link; no copied images, artifacts, answers, or ongoing progress dashboard | Receipt-content and user-edit tests |
| Truthful sent state | Actual `turn/started` callback, or historical real `thread_id` with `result.turn_id`/completed status; begin-dispatch alone is insufficient | Missing-evidence rejection and historical confirmation tests |
| Existing mountain stays the existing task | Historical receipt can link `01a07e3f-8d87-7a43-a7a5-f90f1b67d4d3`; import never regenerates or moves its image | Historical task is proven by activation receipt; actual candidate note/link acceptance pending user installation |
| Preserve user edits | Managed-section hashes and current document SHA conflict guard; preserve manual text/footer changes, renamed notes, and user-deleted notes | Direct edit, conflict race, rename/deletion tests |
| Backfill without replay | History service has no claim/configure/dispatch calls; execution remains under deployed cutoff, baseline, revision deduplication, generation and leases | History fixture tests plus existing backend/manager checks |
| No transcript polling | Subscribe before snapshot; full paged startup/reconnect reconciliation; ordinary events use durable timestamp/ID cursors; existing job wakes refresh destination receipts | Subscription ordering, ties, older late commits, coalescing/no-loop tests |
| Account isolation | Signed-in session, owner query/event filters, existing RLS, epoch checks before async read results write locally; separate per-owner state/cursors | Account-switch and pending-read cancellation tests; installed two-account test still pending |
| Codex chooses an appropriate destination | Bounded actual project/recent-task catalog; direct recorded-task lookup for revisions; reject unknown IDs/paths; clarify unresolved intent | Router source/fixtures; new installed routing acceptance pending |
| Normal visible conversation | Primary task receives ordinary transcript text and has no forced output schema; actual answer/media stay in Codex | Runner protocol tests; new visible conversation acceptance pending |
| Internal bookkeeping stays internal | Ephemeral routing/classification, work capabilities and MCP disabled, bounded inputs/timeouts, unexpected work rejected | Runner protocol tests; installed ephemeral-task behavior pending |
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

**Final integration verification is pending.** Record its exact commit, focused-suite totals, typechecks, and any remaining failures here or in a linked completion receipt. Do not relabel previous runner arithmetic source hashes or `.voice.1`/`.voice.2` package checks as combined-candidate evidence.

## Release and physical acceptance still pending

No new candidate artifact, install, or device proof is claimed. Before calling the iteration delivered, record an approved signed/notarized package's source and artifact hashes and verify the new archive modules. The user installs the preview. Follow the [local install record/workflow](VOICE_LOCAL_INSTALL.md), without developer Electron launches or macOS security bypasses.

After that installation, visibly verify the Library folder default/picker, historical note materialization with no old work replay, the existing mountain's actual task link, a new actionable recording and its readable Codex conversation, context remaining an unsent note, and preserved edits/folder renames. The transcript note should remain minimal after work finishes; inspect the actual task for answers/media.

Locked-screen operation, sleep/offline reconnect, crash-boundary recovery, full second-account runtime isolation, and the remaining hosted transport-publish acceptance checks remain pending. Database timestamps and source tests are not phone-to-visible latency measurements. Preserve the limitations recorded in the [activation receipt](VOICE_PRODUCTION_ACTIVATION.md) and [backend runbook](VOICE_EVENT_BACKEND.md).
