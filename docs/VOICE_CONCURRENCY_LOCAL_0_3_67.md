# Field Theory 0.3.67 — concurrent Voice requests

Local-only Apple Silicon DMG. No GitHub distribution or installation is authorized.

## Behavior

The Mac worker owns up to 16 requests and executes up to four independent requests concurrently. Intake routes requests in order through the shared inbox, without waiting for substantive work to finish. Each owned request has separate cancellation and lease renewal. Settings lists active, waiting, queued, and working requests.

New projectless tasks receive stable private working directories under Inbox/.voice-workspaces, keyed by the dispatch identity. Tasks sharing an existing writable folder remain sequential; this version does not create Git worktrees automatically. Transcript revisions retain their existing completion-order fence.

Follow-ups to Field Theory-owned work are persisted as waiting on this Mac, then submitted after the earlier executor closes. They are not falsely labeled as accepted by Codex. The installed Codex desktop frontend explicitly starts queued messages; queue/add alone does not establish a durable draining executor. Existing externally owned Codex conversations retain the queue adapter. An accepted external queue observer releases execution capacity but retains conversation/workspace exclusion until observation ends. Later same-conversation follow-ups can therefore wait locally; unrelated work proceeds.

Cross-Mac ordering uses destination registration order, not recording creation time. A new Supabase gate prevents a later mapped request from selecting its runner mode until the earlier direct owner completes. Ambiguous dispatches hold the destination for reconciliation. Direct executions keep their app-server process and backend gate until completion; external queued acceptance can release the backend submission gate. Existing clients remain compatible and conservative.

## Verification

- 268 focused Mac tests across 12 suites passed, including a 15-recording burst, at most four concurrent executions, exactly one execution per request, local addendum waiting, six independent lease renewals, cancellation of active and waiting requests, preflight waiting without occupying execution capacity, duplicate delivery, and queued observer capacity.
- 36 SQL/PGlite tests passed, including destination ordering, stale leases, owner isolation, ambiguity, legacy clients, and side-effect-free preflight.
- Renderer and Electron TypeScript checks passed; native Swift helpers rebuilt successfully.
- Migration 20260913120000 applied to verified Field Theory Supabase project cighxaroptskntwbrctl through the CLI, transactionally with baseline-definition checks and migration history. Authenticated RPC access and denied anonymous/helper access verified afterward.
- Packaged artifact verification is recorded in mac-app/release/local-verification-0.3.67.json after notarization.

These checks do not establish installed-app, real phone burst, cross-Mac runtime, locked-screen, or sleep/reconnect acceptance. The user will install the delivered DMG. This release does not add a new stop/interrupt control or explicit iPhone reply-target UI.
