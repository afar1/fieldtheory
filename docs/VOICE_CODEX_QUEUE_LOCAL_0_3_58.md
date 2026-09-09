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

Source commit: `28b3706a2ba50ab9caea90fb5f2665d9028cdaa7` on `codex/runner-remote-availability`.

## Verified local artifact

`/Users/afar/dev/fieldtheory-runner-remote-availability/mac-app/release/Field-Theory-0.3.58-arm64-local.dmg`

SHA-256: `9a7fb8665638114aff13a4e4356b03b5d6933fb9724721254cb7633e376491a1`

Outer DMG notarization: `f93e39ec-9aa3-4aed-801f-63430d0ba5e4` — Accepted.

App and DMG signatures, Apple notarization, stapling, Gatekeeper, and disk-image integrity passed. Production identity `com.fieldtheory.app`, version `0.3.58`, and updater configuration verified. Checked 8,850 post-sign packed hashes and 439 compiled files against the source build. Before signing, 9,356 file hashes and 182 JavaScript syntax checks passed. Packaged Electron 31.7.7 / ABI 125 / arm64 directly exercised SQLite and PTY with development fallback rejected.

Receipt: `mac-app/release/local-verification-0.3.58.json`. Standard production build used `--publish never`; the outer DMG was independently signed, notarized, and stapled. Earlier local DMGs were retained.

No installation, user request replay, or public distribution is part of packaging.
