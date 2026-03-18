# Email Debate V1 Checklist

This checklist reflects the current product decisions for v1:

- Google Workspace remains the public inbound edge for `fieldtheory.dev`.
- `codex@fieldtheory.dev` and `opus@fieldtheory.dev` are the launch identities.
- Email is plain text only.
- The user sees live turn-by-turn emails, not summary digests.
- v1 runs on the local Mac and reuses `scripts/council.sh`.
- A reply later reopens the same thread as a fresh round with full prior context.

## Phase 1: Source Scaffold

- [x] Create a tracked implementation checklist.
- [x] Add source-level email debate types under `electron/main/emailDebate/`.
- [x] Add source-level thread storage under `electron/main/emailDebate/`.
- [x] Add initial tests for thread storage.
- [x] Add `emailDebate` barrel exports for the full module surface.
- [x] Add source-level transport helper modules for SMTP/IMAP and AgentMail.
- [x] Port the source-level email debate manager with multi-thread session support.
- [ ] Add missing runtime dependencies to `mac-app/package.json`.

## Phase 2: Local Outbound Email Mirror

- [x] Port the plain text transport layer from `electron-dist/main/emailDebate/transport.js`.
- [x] Port the AgentMail transport layer from `electron-dist/main/emailDebate/agentMailTransport.js`.
- [ ] Remove HTML-first formatting and replace it with plain-text email composition.
- [ ] Include stable model identity plus runtime version in each sent turn.
- [x] Create a local multi-session debate runner that is not limited to one active debate.
- [ ] Support terminal-triggered debates that stream turns to email without changing the UI.

## Phase 3: Pause / Resume Engine Work

- [ ] Extend `scripts/council.sh` JSON mode so dual-pause emits a paused event instead of auto-finalizing.
- [ ] Persist resumable debate state to disk.
- [ ] Add resume support that injects a human email reply as a new `Human` turn.
- [ ] Add tests covering paused JSON-mode behavior and resume flow.

## Phase 4: Email Reply Intake

- [ ] Port inbound reply polling into source.
- [ ] Replace single-active-debate assumptions with per-thread session tracking.
- [ ] Match replies to explicit thread/message IDs instead of heuristics.
- [ ] Reopen concluded threads as fresh rounds on the same email thread.
- [ ] Feed human replies back into the resumed council process.

## Phase 5: Google Edge Routing

- [ ] Configure Google Workspace routing for `codex@fieldtheory.dev`.
- [ ] Configure Google Workspace routing for `opus@fieldtheory.dev`.
- [ ] Preserve original recipient information for the hidden local router path.
- [ ] Validate the local polling/auth approach against Google account auth requirements.
- [ ] Confirm outbound SPF, DKIM, and DMARC alignment for third-party model sending.

## Phase 6: Ops and Hardening

- [ ] Add a local inspector for threads, send attempts, resume state, and failures.
- [ ] Add retry and recovery behavior for transient send/poll failures.
- [ ] Add smoke tests for multiple simultaneous debates.
- [ ] Add a path to move the runner from local Mac to a cloud service later.
