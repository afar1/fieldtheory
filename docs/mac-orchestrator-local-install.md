# Field Theory 0.3.74 local runner installation

Installed to `/Applications/Field Theory.app` on October 20, 2026. The app is
Developer ID signed, notarized and stapled; Gatekeeper accepts it. Native
SQLite, terminal and directory-watcher probes passed in the packaged app.

The source preserves the current release checkout at `ac1cf6be5` and integrates
the orchestration relay from `7eef1438b`, with the current telemetry and graceful
shutdown lifecycle retained. Runtime fixes/version are in `065f8bc9d`.
All 108 focused orchestration, Codex, power and shutdown checks pass; Electron,
Vite, native helper and diarizer builds pass.

The prior 0.3.70 app remains recoverable at
`/Applications/.FieldTheory-backup-0.3.70-before-orchestrator.app`. An interim
0.3.73 installation also remains as a rollback copy. App data, existing auth,
runner enabled state and workspace selection are retained. No source push,
GitHub release, website deployment or public updater publication occurred.

The hosted Field Theory project `cighxaroptskntwbrctl` has migration
`20261021030000`, explicitly authorized in this chat. The installed app publishes
a fresh `ft_agent_runners` heartbeat with Codex and Claude Code authenticated;
Codex model discovery is live and resolves the current catalog default.

A real installed-app smoke check submitted through the hosted relay exposed a
completed plain-text answer being rejected as a malformed JSON plan. The
provider's actual final message was inspected. The corrected parser preserves
completed non-JSON text as a direct answer with zero delegated tasks, while
retaining validation of structured plans. It never replays the original
possibly-executed command. The first diagnostic request remains in history with
its truthful needs-user status.

The corrected app completed a new connection-check request through hosted
Supabase and returned `FIELD_THEORY_RUNNER_READY` as a durable assistant event.
A second queued follow-up returned `FIELD_THEORY_FOLLOWUP_READY`. Both commands
completed, with exactly one provider session ID across their durable events.
Phone build 83 is separately installed on Focus. Installed-runner relay evidence
is distinct from direct physical-phone interaction and a user-performed locked
Mac test; those device acceptance gates are not claimed here.
