# Field Theory 0.3.70 — Codex Voice compatibility

Local Mac installation on September 27, 2026. No source push or public release.

The current ChatGPT app bundles Codex at `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`. Field Theory 0.3.69 missed this path and selected an older Homebrew CLI that could sign in but rejected `project/list`, leaving Voice routing stuck. Version 0.3.70 prefers the nested app CLI and checks both `project/list` and `thread/list` before claiming or dispatching a request. An incompatible CLI now reports an actionable unavailable state without starting a Codex task.

Validation: 96 focused runner tests passed, both TypeScript checks passed, `git diff --check` passed, the local production package passed guards and archive/native checks, and the packaged app passed Developer ID signature verification, Apple notarization, stapling, and Gatekeeper. Installed `/Applications/Field Theory.app` reports 0.3.70. Previous app retained at `/Applications/.FieldTheory-backup-0.3.69-20260927T235022Z.app`.

The saved September 27 recording `1790537478371-A9D400FE` routed to the existing task `01a0e39c-81a1-7310-9d22-dcae07237f08` and received one accepted queue submission `01a0e547-7a0f-7822-a4c8-89728cd43c9e`. That task is this active conversation, so the queued turn cannot start until the current turn ends. Queue acceptance is verified; substantive work completion is not.
