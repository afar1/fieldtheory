# Field Theory 0.3.58 — Voice follow-ups in open Codex conversations

September 9, 2026. Local production app for manual installation; no public release.

## Problem and change

A conversation can be idle while a Codex process still owns its writer lease. Field Theory's separate app-server could not resume such a conversation and rejected the follow-up before starting a user turn. This failure is independent of screen lock and folder renaming.

Voice continuations use Codex's cross-process queue when appropriate. Queue acceptance is distinct from execution: Field Theory retains the request identity, correlates the actual Codex turn, and reconciles completion without resending an accepted request. New direct tasks retain the existing Voice execution restrictions.

Existing conversations execute with their owner's Codex permissions and approval handling. Voice settings disclose this behavior. Queue submission does not change conversation settings or permission profiles. The local protocol accepts only thread ID, client message ID, and input for queue/add; it provides no permission overrides or read-only thread-settings endpoint.

## Evidence

Prior mechanism investigation is preserved in `docs/VOICE_ACTIVE_WRITER_INVESTIGATION.md`. It reproduced the active-writer boundary and verified cross-process queue delivery with disposable arithmetic tasks. These mechanism checks are distinct from final integrated implementation verification.

All 256 tests across 14 focused suites passed, along with renderer/Electron typechecks. Coverage includes queue intent/acceptance persistence, uncertain acknowledgement recovery, exact client-ID/turn correlation, pending rather than false terminal outcomes, duplicate suppression, observer approval isolation, and private routing fallback when the intake conversation is already owned.

`mac-app/release/voice-owner-queue-live-evidence.json` records integrated synthetic execution with the real installed Codex binary. The owner held a task that previously answered `42`; another client queued a follow-up, the owner started the exact client-ID-correlated turn, and it completed with `43`. Screen-lock state was true before and after. Queue acceptance, actual turn start, and completion were observed separately. This used disposable test content; the user's failed request was not replayed. It is not an installed Field Theory phone-to-app acceptance test.

Source commit and signed local artifact receipt pending.

No installation, user request replay, or public distribution is part of packaging.
