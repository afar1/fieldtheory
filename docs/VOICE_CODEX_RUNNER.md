# Field Theory Voice Codex runner

The Mac runner starts the executable bundled with the installed Codex or ChatGPT desktop app using `app-server --listen stdio://`. It does not require a shell startup file, npm, Python, or a developer checkout. `account/read` checks for the user's existing ChatGPT sign-in; Field Theory does not inspect credential files or retain account identity and diagnostics.

The next combined preview changes the visible response and adds internal routing/classification. It is source-verified, not yet verified in a newly installed package. Exact candidate commits and acceptance boundaries are in the [combined scope audit](VOICE_COMBINED_PREVIEW_SCOPE.md); the live receipts below belong to the earlier runner.

`runVoiceRequest` creates or resumes one durable task, awaits the caller's thread receipt, then awaits the caller's dispatch receipt before sending one primary `turn/start`. The stable dispatch key is sent as `clientUserMessageId`. `onStarted` fires only after `turn/started`; a start response or task creation alone does not count as execution. The primary turn has no forced output schema: it receives normal transcript text and shows the useful answer, question, or requested media in plain language or Markdown.

After a terminal primary result, a separate internal ephemeral turn classifies outcome metadata for Settings and the backend. It receives the recording, a bounded copy of the readable response, and limited activity evidence. It does not receive image bytes or arbitrary tool output. Failure to classify preserves the readable response and does not replay the work. Library stores only the transcript and confirmed actual task link; answers and artifacts are not copied there.

The task's inherited permission response is inspected before turn permissions are narrowed. The runner defaults to read-only. The candidate manager requests workspace writes for actionable work in the selected actual project/task, subject to both task and current configuration permission limits and the user's instruction. A routing clarification stays read-only. Network and temporary write roots are disabled. More restrictive approval settings survive continuation, and approval or clarification requests are declined and surfaced to the user. Custom permission profiles are left intact and require continuation in Codex because their deny rules cannot safely be reconstructed from the legacy sandbox response.

`recoverVoiceRequest` reads the recorded task without resuming its writer or appending another work turn. Exactly one user-message dispatch key must match, and any saved turn id must agree. Existing structured receipts remain readable. A recovered plaintext completion may use a separate internal ephemeral classification turn; it never repeats the original request in the user task. `recoveryUncertain: true` tells the caller to hold newer revisions while a turn is active, the receipt cannot be matched, recovery failed, or interruption was not confirmed. A completed clarification has no uncertainty flag and may receive a user reply. Authentication failures report `sign_in_required` so the worker can pause.

## Bounded internal decisions

`voiceCodexRouter` reads at most three pages of 50 projects and three pages of 50 recent unarchived tasks. It excludes ephemeral and ambient-suggestion tasks and unavailable local folders. Catalog names are untrusted labels. Returned IDs must match the supplied catalog; paths come from verified catalog entries, never model output. A prior transcript task is read directly by its recorded ID. An unresolved destination asks a question; context or hold-off remains a note without creating a primary work task.

Routing and outcome classification share `runVoiceInternalTurn`: it requires an ephemeral thread response, disables configured MCP servers, web search, and work capabilities, clears dynamic tools and capability roots, and narrows to read-only under existing permission restrictions. Tool/approval requests and unexpected work items fail the decision. Cancellation and a bounded timeout stop internal work. These source checks do not prove how a future installed app will display ephemeral tasks; visible acceptance remains pending.

## Earlier runner verification

- On 2026-09-07, protocol bindings were generated from the installed `codex-cli 0.153.4` executable. The checked contracts include account types, thread permission responses, dispatch identity, turn events, approval replies, and terminal authentication errors. Official protocol documentation: [Codex App Server](https://learn.chatgpt.com/docs/app-server); profile semantics: [Permissions](https://learn.chatgpt.com/docs/permissions).
- `npm test -- --run electron/main/voiceCodexRunner.test.ts`: 53 tests passed. Coverage includes durable dispatch ordering, actual start notifications, superseded transcript context, strict continuation permissions, declined interactions, cancellation races, uncertain stops, UTF-8 framing, authentication, exact recovery matching, contradictory identifiers, and no replay.
- `./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit`: passed.
- The earlier live adapter smoke receipt was inspected, without running another prompt. Synthetic task `01a07df6-0478-7421-b6dc-df19f216292f` recorded `2 + 2 = 4`, an explicit continuation `4 × 3 = 12`, and read-only recovery of that continuation. That receipt predates this review's hardening changes; it is evidence for the baseline adapter, not physical-phone, push-delivery, or final packaged-build acceptance.

## Earlier live runner receipt (before the combined Inbox candidate)

One synthetic arithmetic turn ran against that iteration's final runner source on 2026-09-07. A preceding preflight was rejected before task creation or dispatch because the adapter had not negotiated the experimental protocol fields it used. The adapter now advertises `experimentalApi: true` for `runtimeWorkspaceRoots` and permission-profile provenance; this does not grant permissions. After that fix, the only dispatched turn completed successfully.

| Evidence | Observed value |
| --- | --- |
| Installed executable | `/Applications/ChatGPT.app/Contents/Resources/codex` |
| Executable version | `codex-cli 0.153.4` |
| Runner source SHA-256 | `812cbc64ab1647b6940061dcecf4f2098f961df39f052e50e58dd74893cca806` |
| Task | `01a07e05-f273-7a42-ae37-9e0df1d07093` |
| Turn | `01a07e05-f523-7270-b5cb-092a8f6507ec` |
| Dispatch key | `fieldtheory-voice-final-smoke-Bohu1D` |
| Durable thread receipt | `2026-09-07T22:38:34.303Z` |
| Durable dispatch receipt | `2026-09-07T22:38:34.778Z` |
| Actual `turn/started` | `2026-09-07T22:38:34.804Z`, exactly once |
| Completed result | `17 + 25 = 42` |
| Final receipt timestamp | `2026-09-07T22:38:40.540Z` |
| Lock state before | `2026-09-07T22:38:33.982Z`: `IOConsoleLocked=false` |
| Lock state after | `2026-09-07T22:38:40.540Z`: `IOConsoleLocked=false` |

Both receipt callbacks used synchronous writes and `fsync` before dispatch. The synthetic request asked for mental arithmetic without tools and used a temporary read-only workspace. Lock inspection read the Root I/O Registry plist and retained only `IOConsoleLocked` / `CGSSessionScreenIsLocked` boolean values; only `IOConsoleLocked` was present. The Mac was unlocked for this test. This verifies the installed signed-in runtime integration, actual execution notification, and structured terminal result. It does not verify a locked-screen session, native push delivery, a physical phone, or the final packaged worker.

Local raw receipt: `/private/var/folders/h6/y26j8j4x2gb_w6c6l7fc15s00000gn/T/fieldtheory-voice-final-smoke-Bohu1D/receipt.json`. The source was compiled into that temporary directory for the verification; no credential files, existing user inbox data, or UI state were modified.
