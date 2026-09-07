# Voice production activation — September 7, 2026

The user explicitly authorized the remote Voice setup after installing `0.3.47-voice.2` and encountering an enable error. This activation applies only to Voice delivery. No public app release or unrelated backend migration was performed.

## Target and application

- Installed app: `/Applications/Field Theory.app`, version `0.3.47-voice.2`.
- The app's public runtime URL and the authenticated Supabase CLI project inventory both identified `https://cighxaroptskntwbrctl.supabase.co`, project **Field Theory**, region `us-west-1`, healthy.
- Live preflight confirmed the missing Voice objects/status RPC, all required transcript columns, Realtime RLS, compatible `realtime.send`, daily message partitions and their publication, and the deployment role's required permissions. There were no pre-existing Realtime message policies.
- Existing migration version `021` belonged to `newspaper_covers`. Voice was renamed to `20260907233700_voice_event_delivery.sql` without changing its SQL.
- Migration SHA-256: `b87cbf6f0be32662af9a07e333adab6b30c89c4e53144fc21cc9b310a25f107f`.
- Applied through `supabase db query --linked` from an isolated CLI workspace. The migration and ledger insert ran in one explicit transaction with a five-second lock timeout and 60-second statement timeout; PostgREST received a schema reload notification. No broad `db push` was used.
- Post-commit verification: four RLS-enabled tables, trigger enabled, all function search paths empty, expected authenticated/anonymous/internal grants, and zero settings/jobs before opt-in.

## Installed-app verification

After application, **Check again** changed the installed app's state to “Ready to enable voice requests.” Enabling succeeded and displayed **Ready / Listening for new voice requests**. The user's folder `/Users/afar/.fieldtheory/library/Inbox` was preserved. The previous `field-theory-voice-inbox` five-minute heartbeat was paused to prevent duplicate routing; its prompt, schedule, task association, and receipts remain intact.

A synthetic transcript was inserted using the app's existing signed-in user session and the normal project key. The verification process did not refresh credentials. The installed app itself performed all job claims and Codex execution; no development server or terminal worker was involved.

- Transcript ID: `voice-delivery-canary-47c62a4f-2975-44a1-9183-dff145a1c177`.
- Job ID: `6c854eb1-0613-46d5-b5c2-0c7ac234e0e2`.
- Codex task: **Personal - Voice delivery verification**, `01a07e3e-1c25-71e2-ac66-c33a50a37de0`.
- Turn ID: `01a07e3e-1f21-7900-95d2-cb4a5b43a0db`.
- Harmless request: mental arithmetic, `17 + 25`, with no tools or file changes.
- Observed private subscription and wake receipt, one attempt, actual completed Codex turn, durable completed receipt, and visible **Latest voice task · Done / 42** in Field Theory Settings.
- Database receipt timestamps: received `2026-09-07T23:39:54.455719Z`, completed `2026-09-07T23:40:01.052184Z`. These are database timings, not a measured phone-to-visible latency.

The controlled subscriber observed only `generation`, transport `id`, `job_id`, `schema_version`, and `wake_id` in application wakes. No transcript text or credential was included.

## Access and duplicate checks

- Anonymous status RPC denied.
- Anonymous join of the user's private Voice topic explicitly returned Unauthorized.
- The signed-in user joining a different UUID's private Voice topic explicitly returned Unauthorized; joining their own topic succeeded. A separate real second-account session was not used.
- Repeating the synthetic transcript's text with an updated sync timestamp retained exactly one completed job and one Codex attempt.
- A signed-in direct update of the job receipt was denied.
- A hosted transaction under `authenticated` with the owner's identity/topic was denied insertion into `realtime.messages` with SQLSTATE `42501`; the probe transaction was rolled back. This verifies the deployed database policy, not a separate user's login.
- The WebSocket publication probe timed out; REST Broadcast returned an empty HTTP 202. Neither is treated as an explicit transport-level denial. Full client-publish acceptance remains a separate controlled-observer check.

The renamed migration still passes all 20 local PGlite tests. These supplement the live evidence; they do not substitute for it.

## Physical phone request and output gap

The user then made a new physical phone recording asking for an extraordinary view from a mountain. Its synced transcript created job `59f8cdea-f74f-4c5e-9592-832ff9fe1640` from transcript `1788824482021-5DC8D88E`, with one attempt. Codex task **Personal - Extraordinary mountain view** (`01a07e3f-8d87-7a43-a7a5-f90f1b67d4d3`) completed one real image-generation call. The user observed its completion in Field Theory Settings and later confirmed the task appeared in normal Codex Recents/sidebar.

Verified output: `/Users/afar/.codex/generated_images/01a07e3f-8d87-7a43-a7a5-f90f1b67d4d3/exec-e715e35f-b261-42b4-aaea-02ec83a3a2c5.png`, 3,607,167 bytes. The image was visually inspected and matches the requested mountain panorama.

Observed timestamps in UTC:

- Supabase received the transcript/job: `2026-09-07T23:41:29.158969Z`.
- Codex turn started: `2026-09-07T23:41:30Z` (task API reports whole seconds).
- PNG filesystem creation/modification: `2026-09-07T23:42:10Z`.
- Completed backend receipt: `2026-09-07T23:42:16.849864Z`.

Execution began promptly after the database event. The first-sidebar-visible timestamp was not recorded, so the UI discovery delay is not measured and its cause is not proven by these timestamps.

A read-only review of the installed Codex app found that ordinary Recents does not exclude the `field-theory-voice` source. It uses a cached task list refreshed through task-list/store events; this integration's separate stdio app-server has no explicit handoff to refresh that desktop list. Later discovery on refresh is a plausible explanation, not a measured root cause. The user confirmed that the existing task eventually appeared; it was not recreated or pinned as a workaround.

The user's Library Inbox was physically empty, and the Library document search found no mountain result. This was not an indexing backlog. The selected Inbox is the Codex working directory; image generation saved into Codex's generated-image store. The runner retains only `agentMessage` completion items, discarding `imageGeneration.savedPath`, and the final structured response supplied prose without an artifact link. The Library scans Markdown documents; no Library note or output file was created. This is an output delivery gap despite successful execution. The user requested diagnosis, so the existing image/task were not recreated, moved, or copied, and no Inbox note was written.

## Remaining acceptance

The real phone-to-Supabase-to-installed-Mac execution path is verified, including a real image artifact and visible completion summary. Automatic artifact delivery into Library and a reliable artifact link in the Voice receipt remain unimplemented. The observed Mac tests ran unlocked; locked-screen operation, offline/reconnect recovery, crash-boundary recovery, and full two-account runtime isolation are still unverified. See the [backend runbook](VOICE_EVENT_BACKEND.md) for those cases.

The user also requested a future automatic Library Inbox default and a Library-specific folder picker, explicitly “make a note, don't start working on that yet.” That idea is recorded in the overview; no related UI implementation was started.
