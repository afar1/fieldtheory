# Voice continuation rejection: active Codex writer

September 9, 2026. Investigation of installed Field Theory 0.3.57; no production code, installation, or user request replay.

## Finding

The latest Navier–Stokes image request uploaded successfully and reached the Mac. A separate Field Theory app-server process could not resume the conversation because another Codex process already owned its writer lease. A connection-only resume check of the actual conversation returned JSON-RPC -32600: `thread 01a08456-3cd8-74e1-8856-c22280bb79ee already has an active writer`. No user turn was started by the check. The original rejection details were discarded, so this is an exact current reproduction of its failure boundary, rather than recovery of the original error payload.

An idle conversation can still have an active writer. This is process ownership, not evidence of an active model turn or a sleeping Mac.

## Observed timeline (Pacific)

- 14:07:31: display off; macOS records Field Theory holding its idle-sleep prevention assertion.
- 14:07:58: iOS image request uploaded with actionPolicy=send; durable job created.
- 14:08:11: display on.
- 14:08:25: job failed with request_rejected, before onThreadStarted or dispatch_started_at. Local saved route points to the correct conversation and current Voice Inbox.
- Current read-only initialize, account/read, config/read, and thread/read checks succeed.
- The prior folder-rename request completed at 13:49:35 on the same conversation after installation of 0.3.57.

Relevant job: 22f6e8fe-0468-4e33-92f9-6b80645ea855. Transcript client ID: 1788988071077-76FF3CC3.

## Verified engineering path

1. Preserve a bounded classification of RPC method, numeric code, and recognized active-writer reason. Do not store arbitrary server messages or request payloads. Do not terminally fail a saved request merely because another process owns its destination.
2. For existing owned conversations, use `thread/queue/add` with the existing deterministic dispatch key as clientUserMessageId. Field Theory Ambient already uses this operation in electron/main/codexAppServerClient.ts. Do not force takeover or call external `thread/queue/start`: the latter requires resuming the task and reproduces the ownership problem.
3. Persist queue acceptance separately from actual task start. On recovery, inspect `thread/queue/list` for the client ID and then reconcile the actual user-message clientId and turn ID. The current recoverVoiceRequest examines turns only, so it must not treat a still-queued request as a missing/uncertain execution.
4. Only report working after confirmed start and completed after the actual terminal turn. Preserve existing account fencing, lease handling, and duplicate-execution protections. Queue submission is NOT idempotent by clientUserMessageId: two immediate synthetic submissions with the same ID produced two completed turns; a third submission after completion queued again. Persist a pre-send marker and acknowledged queuedSubmissionId. After an ambiguous response, inspect both pending queue and turn history; never blindly resend. If delivery cannot be established, keep it explicitly uncertain rather than risking duplicate execution.
5. The queue API accepts no cwd, sandbox, or approval overrides. Its owner's settings apply. Existing Voice applies additional restrictions in boundedPermissions and cancels approval requests; queueing does not automatically reproduce those restrictions. An implementation must explicitly validate the intended permission/interaction contract before selecting queue delivery, and must not silently widen it. Do not solve ownership by changing another process's settings.
6. Keep direct task creation for unowned new tasks. Treat failures before a task's first persisted turn separately: an isolated newly allocated task can have no resumable rollout yet.

## Synthetic evidence

An isolated completed conversation was held open by one real installed-Codex app-server process. A second process using the current Voice runner failed at thread/resume with the same active-writer rejection and no start callback. A second sender then used queue/add; queue/list showed its pending client ID and the owner later completed the arithmetic request with answer 5. thread/turns/list confirmed the exact client ID in the actual turn. This establishes cross-process queue delivery without user-work replay.

A separate add-only test, without any queue/start call, automatically started after about ten seconds and completed with answer 6. Evidence files: `/var/folders/h6/y26j8j4x2gb_w6c6l7fc15s00000gn/T/fieldtheory-held-resume-mFIybW/{evidence,queue-evidence,queue-add-only-evidence,queue-dedup-evidence}.json`. These are mechanism tests; a complete integrated Voice implementation and locked-phone acceptance test have not been performed.

## Scope

No new iOS build is required to address this delivery failure. The pending implementation is in the Mac Voice runner and its receipt/recovery path. The original image request remains failed and has not been resent. No new DMG is produced by this investigation.
