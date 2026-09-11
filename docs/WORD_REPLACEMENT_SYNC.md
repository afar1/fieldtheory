# Field Theory - Shared word replacements

Prepared locally for Mac 0.3.66 and the native iPhone app. The database migration was applied to the Field Theory project (cighxaroptskntwbrctl) on September 11, 2026 after explicit approval. Mac 0.3.66 is now packaged, signed, Apple-notarized, and verified as a local-only DMG. It has not been installed or published. The iPhone build is still deferred; cross-device runtime verification remains outstanding.

## Behavior

- Mac settings and iPhone Settings → Word replacements edit the same account list.
- Existing Mac replacements migrate on the first successful sync. Local copies remain usable offline.
- Clients send only edits relative to their last acknowledged list. Independent word edits merge; for competing edits to the same source word, the last server-applied edit wins. Deleting all rules sends explicit deletions rather than treating an empty list as missing data.
- Rules retain their order. Source strings identify rules; changing a source removes the old rule and adds the new one. Matching is case-insensitive and uses whole-word regex boundaries, preserving the existing Mac behavior.
- New iPhone transcriptions apply replacements before persistence, routing, and automatic copy, including recordings waiting for the speech model. Existing transcripts are unchanged.
- Cached iPhone lists are keyed by account. Late sync responses cannot replace edits made during a request or populate a different active account.
- Mac settings show sync availability. The phone reports replacement sync failures separately from voice upload failures.

## Source preservation

The supplied root checkout was older than the installed Mac application. This worktree uses commit `200d94856` plus an isolated copy of the existing local 0.3.65 changes from `/Users/afar/dev/fieldtheory-parakeet-pip-user`. That original worktree and the root's unrelated editor changes were not modified.

The final branch is `codex/word-substitution-sync-current`. Source changes are preserved locally on that branch, including the copied 0.3.65 baseline. The earlier Git-index permission restriction was lifted. `word-replacement-sync.patch` contains only this feature's delta against the copied 0.3.65 source, excluding inherited changes.

## Verification

- Mac renderer and Electron TypeScript checks passed.
- 255 Mac tests passed across substitutions, preferences, transcription, and hot mic.
- The SQL migration ran in local PGlite tests: merges, edits, explicit null deletion, empty text replacement, malformed input rejection, account isolation, and anonymous access denial passed.
- Changed Swift files passed syntax parsing. Four host-side checks of the extracted Swift replacement logic passed, including Maine → main, literal replacement text, empty replacements, and explicit JSON null encoding. This harness excluded the Observation macro; it is not an iPhone application build.
- Native XCTest coverage was added for replacement behavior and deletion encoding. Existing voice test fixtures use an injected replacement transport so they cannot contact the live service. The iPhone build and native test run remain deferred at the user's request.

## Activation and builds

1. Applied `supabase/migrations/20260911100000_word_substitutions.sql` to Field Theory (cighxaroptskntwbrctl), including migration history, in one transaction. Verified RLS, the authenticated account policy, invoker security, authenticated execution, and anonymous execution denial. Live transactional checks passed for merging independent edits, explicit deletion, malformed input rejection, and account-filtered reads. All test writes rolled back; zero test rows remained. Transcript data was not altered.
2. Completed the local packaging workflow using the preapproved 0.3.66 notes, real local dependencies, `FIELD_THEORY_RELEASE_BRANCH_OVERRIDE=true`, and `--publish never`. No GitHub token was passed to the build.
3. After permissions were updated, signing identities and notarization credentials became available. Both app and final DMG pass signature, stapling, and Gatekeeper checks. Apple accepted the DMG request `d3715f03-a63d-4cbd-ac02-61eb95dd6b1e`. Disk integrity passed; the mounted DMG contains version 0.3.66 with an identical app archive and passing packaged SQLite/terminal probes. The verification mount was detached. The installed application remains 0.3.65.
4. When the phone is available, follow the project's normal iOS local-device build process. Verify Mac → phone and phone → Mac edits, offline edits followed by reconnection, deletion propagation, and Maine → main in an actual new recording.

The database migration and the two installed clients must all be present before cross-device sync can be claimed as working.

## Local artifact

- DMG: [Field-Theory-0.3.66-arm64-local.dmg](../mac-app/release/Field-Theory-0.3.66-arm64-local.dmg)
- SHA-256: `d581e5c74a32d85248108c88bac2d4fd024e4a7c7e5097c5399f7a4a7332f171`
- Receipt: `mac-app/release/local-verification-0.3.66.json`
