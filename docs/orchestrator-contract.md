# Field Theory orchestrator contract v1

Mac/provider owner: codex/multi-provider-orchestration, based on e55570488 (existing Send to Agent runner). iOS owner: codex/ios-orchestrator-conversation. Existing Supabase auth owns credentials and refresh. Migration must be explicitly applied before remote use.

## Authenticated PostgREST

All tables are owner-scoped by `user_id = auth.uid()` and RLS. UUIDs are strings, timestamps ISO8601, cursor `seq` is a safe integer. No credentials appear in these records.

* `ft_agent_conversations`: `id uuid` (client-generated), `user_id uuid`, `title text`, `provider text` (`codex`, `claude`, future IDs), `model text nullable` (null = provider default), `status text` (`queued`, `running`, `completed`, `needs_user`, `failed`), `created_at`, `updated_at`. Client inserts these four identity/selection fields plus title. Provider/model remain fixed for the conversation.
* `ft_agent_commands`: `id uuid` (client generated idempotency key), `user_id uuid`, `conversation_id uuid`, `text text` (1..120000), `status text` (`queued`,`running`,`completed`,`failed`,`needs_user`), `created_at`, `updated_at`. Insert a command for the initial prompt or any reply. Retry the SAME UUID; do not blindly replace content on conflict. Replies queue behind active work. Initial creation is two inserts; a conversation with no commands is harmless. Local pending UUIDs survive app restart.
* `ft_agent_events`: `seq bigint generated identity`, `id uuid`, `user_id uuid`, `conversation_id uuid`, `command_id uuid nullable`, `kind text` (`user`,`assistant`,`status`,`delegation`,`error`), `text text`, `payload jsonb`, `created_at`. Query by conversation ordered `seq.asc`, `seq > lastCursor`, limit 200; page until fewer than 200. Never infer completion from silence. `payload` may contain `provider`, `model`, `thread_id`, `turn_id`, `parent_run_id`, `run_id`, `status`, `error_code`, `app_url`. Render unknown kinds as status. Full assistant messages are appended once; progress uses separate status events.
* `ft_agent_runners`: `user_id uuid`, `id text`, `capabilities jsonb`, `updated_at`; capabilities `{schema_version:1,providers:[{id,label,available,signed_in,models:[{id,label}],model_discovery,thread_integration,message}]}`. `signed_in` nullable = unknown. Only enable providers with available true and signed_in true; models reflect discovery, not guaranteed service access. Null model means use the provider catalog default when discovered (`default_model` capability), otherwise the configured provider default. Heartbeat older than 90 seconds means offline/stale, not failed work. Existing Mac Voice runner must be enabled and workspace configured.

List conversations newest updated first, limit 50. Load events only for selected conversation. Poll events and runner heartbeat while conversation is visible; stop when backgrounded. Unapplied migration is an explicit unavailable state, never an empty successful history.

## Runner lifecycle

RPCs claim a single queued command under a renewable lease and serialize per conversation. Persist provider session IDs and dispatch boundaries locally BEFORE continuing. An ambiguous interrupted run is marked needs_user; never replay a possibly executed command automatically. Status/results/events publish durably; network failure keeps a local outbox for retry. No external exactly-once guarantee. Mobile commands never choose filesystem paths or shell commands; the Mac's existing selected workspace is authoritative.

Delegation is bounded by runner limits (depth 1, at most 4 tasks per turn, timeout per task), uses discovered authenticated adapters, and returns outcomes to the selected orchestrator. Delegates have independent provider session IDs and events linked by parent/run IDs. Native application visibility is claimed only where the adapter verifies support. Claude CLI sessions are resumable in Claude Code; Claude consumer app visibility is unsupported. Grok/Muse remain unsupported until a supported authenticated integration exists.

## Locked Mac

Use main-process timers, authenticated RPC and noninteractive CLIs/app-server, never clipboard, keystrokes, or desktop automation. Screen lock is supported in principle while the user session and Mac remain awake and online. Existing AC-only prevent-app-suspension assertion allows display sleep/lock. Sleep, logout, quit, credential expiry and network loss are distinct unavailable states; persisted commands catch up when available. Do not alter global power/security settings. Actual locked-session acceptance requires an explicitly user-performed lock; source/build tests do not prove it.

## Verified implementation and limits (2026-10-20 Pacific)

* Based on the existing local Voice runner branch `e55570488`, not main `ab3fbd256`. Main lacks current Send to Agent dispatch. Integrate the base dependency deliberately; native iOS sources are unchanged between those bases.
* Both installed providers authenticated when inspected outside the filesystem sandbox. A sandboxed auth probe falsely reported unavailable credentials. Credentials are never extracted or reused for a different service.
* Codex app-server `model/list` returned `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` in this runtime. Start/resume succeeded with `gpt-5.6-sol`; the inherited config default failed. The runner now resolves null selections to the catalog entry explicitly marked `isDefault` (`gpt-5.6-sol` in this runtime). Do not infer other model access from the Codex desktop model picker. Catalog IDs remain dynamic.
* Claude Code start/resume succeeded using its default. No authenticated model-list endpoint is implemented; named Opus selection is not claimed. Tool-free Claude tasks explicitly disable built-in tools, MCP servers and slash commands. Codex delegate tasks use the inherited permission boundary restricted to read-only. This slice supports reasoning and Codex read-only inspection, not autonomous file modifications.
* A real combined Codex → Claude → Codex flow is verified against local embedded PostgreSQL, not hosted Supabase or the installed Electron app. Unit checks cover bounded discovery/plan validation, delegated-result return, and outbox replay without provider re-execution. Existing Codex dispatch/recovery and power tests remain passing.
* Local PostgreSQL verification executes the actual migration and tests owner RLS/FK isolation, per-conversation serialization, queued replies, idempotent event writes and expired leases. Migration has not been applied remotely. The temporary embedded database uses a simulated `auth.uid()` claim; real hosted auth and PostgREST remain a separate acceptance gate.
* Session IDs are persisted locally before dispatch and mirrored remotely through lease-checked events. Codex app-server allocation and `codex://threads/...` link construction are verified; opening the tasks in the desktop sidebar remains manual. Claude sessions are resumable in Claude Code, without a consumer-app deep link.
* Events stream lifecycle transitions and final/delegate results, not every token or provider tool call. Delegate execution is serial, at most four per user command, five minutes each. Synthesis receives up to 16000 characters per delegate with a truncation flag. Cancelled/uncertain work requires review; it is never automatically repeated.

## Screen-lock acceptance

The existing `VoiceRunnerPower` assertion keeps the enabled runner reachable on AC using Electron `prevent-app-suspension`; it does not hold the display awake. No lock handler stops the worker. The orchestration manager uses main-process polling, CLI/app-server pipes, existing account refresh and a local atomic outbox. Actual system suspend aborts observation and leaves durable results/commands for reconciliation after wake. A restart with an unfinished local attempt emits `needs_user`; it never starts that command again. Launch-at-login settings and global power/security settings are unchanged. App quit/logout stops this app-owned runner; it is not a separate always-on daemon.

Manual acceptance after migration and an approved local package install:
1. Sign into Field Theory and provider CLIs, enable Voice runner, select its existing workspace, connect AC and verify a fresh runner heartbeat.
2. Start a read-only conversation from the phone, then lock the Mac yourself while leaving it awake/online. Verify new command receipt, provider session IDs, progress, result and a follow-up reply all arrive before unlocking.
3. Separately test network loss and restoration. Verify one durable command and one provider execution, eventual outbox delivery, and no duplicate result.
4. Separately test actual system sleep/resume and app quit/relaunch. Expect offline/stale heartbeat during unavailability, catch-up for queued commands, and `needs_user` for ambiguous interrupted execution.
5. Expire/sign out provider credentials separately. Expect provider unavailable/failed/needs_user, never a GUI prompt that silently waits behind the lock screen.

## Architecture references

The saved Cua announcement is [trycua, Oct 19](https://x.com/trycua/status/2112228154651881479), synced locally Oct 20; bookmark time is absent, so the save date cannot be proven. [Cua Spaces SDK](https://cua.ai/docs/cua-sdk/reference/spaces) and [source architecture](https://github.com/trycua/cua/blob/main/libs/cua/README.md) separate machine registry, remote process lifecycle and agent sessions. This informed keeping transport/runner identity distinct from provider sessions; no Cua dependency or code was copied.

[Codex app-server](https://learn.chatgpt.com/docs/app-server) supplies account/model discovery and durable thread/turn operations. [Claude programmatic CLI](https://code.claude.com/docs/en/headless) supplies print output and session resume. [Muse Code](https://dev.meta.ai/docs/muse-code) documents headless and MSP integration, but its CLI is absent here; a future authenticated adapter can implement that protocol. [Grok Bot](https://docs.x.ai/grok-bot/overview) describes native persistent bots; this implementation has not verified an authenticated API to create/manage those native conversations. Model inference APIs do not establish native-app session integration.
