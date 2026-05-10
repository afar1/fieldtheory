# iOS Public Readiness Review

Date: 2026-05-10

Scope: the React Native/Expo iOS app, checked-in native iOS project, Supabase mobile functions, local storage, sync, recording, and public release posture.

Status: much healthier, not public-release green yet. The automated checks now pass, a local signed archive succeeds, a repeatable archive inspection passes, the keyboard extension is excluded from the first public app bundle, and the iOS release identity source of truth is documented. Server deployment, App Store privacy/export validation, and a few data/performance gaps still need deliberate decisions before App Store/TestFlight public rollout.

Release runbook: `docs/IOS_PUBLIC_RELEASE_RUNBOOK.md` has the copyable checklist for the remaining manual gates.

## Prompt-To-Artifact Checklist

| Request | Evidence | Status |
| --- | --- | --- |
| Do the equivalent of React Doctor for the iOS app | `npx expo-doctor` passes 17/17; typecheck, audit, plist lint, Deno check, native simulator build all pass | Done for automated health checks |
| Full app refactor review | App hot paths were split into `hooks/useScopedAppData.ts` and `hooks/useSyncCoordinator.ts`; remaining refactor risks are listed below | Done as review, not fully remediated |
| Prioritized list with brief reasons | See priority list below | Done |
| Public/pristine readiness | Client secrets, deprecated audio dependency, keyboard extension embedding, privacy manifest, sketch dead surface, user-scoped storage, command cache, and several sync issues were addressed | Partially done |
| Responsiveness, latency, load time, animation smoothness, snappiness | Startup hydration, pager, pull-to-create, transcript-display, Library typing, first background sync, and first-run model validation were improved; device timing still needs validation | Partially done |
| Local data storage and core functionality | Storage is user-scoped, signed-out storage is local-only, and row sync now has client edit clocks plus soft-delete support, pending Supabase Cloud migration application and device testing | Partially done |
| Orchestrate subagents | Performance, data/sync, and native/release read-only audits were delegated and folded into this artifact | Done |

## Completed In This Pass

- Moved transcription LLM processing behind a Supabase Edge Function so the mobile bundle no longer calls Anthropic directly: `services/llm.ts`, `supabase/functions/process-transcription/index.ts`.
- Removed direct client Anthropic settings and defaulted `autoSeparate` off.
- Migrated recording from `expo-av` to `expo-audio`; `expo-doctor` now passes.
- Added user-scoped AsyncStorage and backup-first legacy migration: `services/storage.ts`.
- Added an isolated signed-out local storage scope so local-only data is not silently claimed by the next signed-in account: `services/storage.ts`, `hooks/useScopedAppData.ts`.
- Added delete tombstones for tasks/transcripts/library and made sync filter pending row deletes before local upserts: `services/sync.ts`.
- Scoped command cache by user and clears the previous user's cache on sign-out or auth-session loss: `services/commands.ts`, `hooks/useScopedAppData.ts`.
- Added command-cache regression tests for per-user cache keys, signed-out empty reads, and clearing only the intended user plus the legacy key: `mac-app/src/__tests__/mobileCommands.test.ts`.
- Cleared mounted command UI state on user changes and scoped command favorites by user: `components/CommandsList.tsx`.
- Removed unreachable sketch UI/storage/sync code and its native deps.
- Excluded `LittleAIKeyboard.appex` from the containing app bundle for the first public release while keeping the target available for a future compliant rebuild.
- Removed the startup audio-session/headset hook; background recording mode is now configured only when recording starts.
- Removed `babel-plugin-inline-dotenv`; mobile JS now only references `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Set the Expo display name to `Field Theory` while keeping native iOS release identity in Xcode, documented in `docs/IOS_RELEASE_SOURCE_OF_TRUTH.md`.
- Fixed the packaged app display name in `ios/littleai/Info.plist` and verified the signed archive contains `CFBundleDisplayName = Field Theory`.
- Split app-level session/storage and sync orchestration out of `App.tsx`.
- Split startup hydration so todos, observations, settings, and transcripts unblock first render while Library documents hydrate after initial interactions: `hooks/useScopedAppData.ts`, `components/LibraryView.tsx`.
- Deferred the first background Library sync until after initial interactions settle: `hooks/useSyncCoordinator.ts`.
- Saved completed recordings to the transcript timeline before command expansion, then patch the same transcript entry when expanded command text is ready: `App.tsx`.
- Extracted transcript capture/patch helpers and added regressions so raw transcript save and later command expansion patch the same entry by id: `services/transcriptCapture.ts`, `mac-app/src/__tests__/mobileTranscriptCapture.test.ts`.
- Kept pager contents capped to the active page plus neighbors instead of accumulating every visited page: `App.tsx`.
- Kept Pull-to-create draft text local and only report `canSave` to the bottom bar, avoiding root rerenders on each draft character: `components/PullToCreate.tsx`.
- Lowered Pull-to-create scroll event cadence from 16 ms to 32 ms to reduce bridge work during list scrolling: `components/PullToCreate.tsx`.
- Kept Library editor text local while typing, emits single-document upserts/deletes instead of stale full-list replacements, and queues Library storage saves in order: `components/LibraryView.tsx`, `App.tsx`.
- Extracted Library parent-state merge/delete helpers and added regressions that a single document edit preserves unrelated documents synced into parent state: `services/libraryState.ts`, `mac-app/src/__tests__/mobileLibraryState.test.ts`.
- Added mobile row soft deletes and client edit timestamps for tasks, observations, and transcripts: `services/sync.ts`, `supabase/migrations/017_mobile_row_soft_delete_timestamps.sql`.
- Extracted the mobile row-delete conflict helpers into shared pure sync utilities and added regressions for pending deletes, remote soft deletes, and late server write times not beating newer offline edits: `services/syncUtils.ts`, `mac-app/src/__tests__/syncUtils.test.ts`.
- Added storage-scope regression tests for signed-out local storage, per-user isolation, backup-first legacy migration, and row tombstone dedupe: `mac-app/src/__tests__/mobileStorage.test.ts`.
- Pinned the Whisper model download to an immutable Hugging Face commit, validates exact size plus native MD5, deletes corrupt partial model files before retry, and surfaces model download progress in the UI: `services/modelService.ts`, `hooks/useWhisperRecording.ts`, `App.tsx`.
- Added `npm run typecheck` and narrowed `tsconfig.json` away from generated/native trees.
- Added `npm run verify:ios-public-readiness` as the fast local gate for typecheck, focused mobile regressions, Expo Doctor, production audit, Edge Function check, plist lint, and whitespace checks.
- Added `npm run inspect:ios-archive` as the packaged-app gate for release identity, extension embedding, code signing, privacy manifest presence, obvious secret-name leakage, and bundle sizes.
- Added `docs/IOS_PUBLIC_RELEASE_RUNBOOK.md` for the remaining manual Supabase, device QA, and App Store release gates.

## Priority List

### P0: Release Blockers

1. Supabase Edge Function deployment is not verified.

Why: the client now depends on `process-transcription`; Deno typecheck proves the function compiles, but not that production has the function deployed, `ANTHROPIC_API_KEY` set server-side, and auth invocation working.

Evidence: `services/llm.ts` invokes `process-transcription`; `supabase/functions/process-transcription/index.ts` reads `ANTHROPIC_API_KEY` from Deno env.

Do: deploy the function, set production secrets, then test signed-in manual Separate on device.

Verify: `supabase functions deploy process-transcription`, a real signed-in invocation, and a Supabase function log showing 200 without exposing secrets.

2. App Store privacy/export validation is still missing.

Why: Debug simulator builds, Release no-code-sign builds, and a local signed archive are useful, but public readiness still needs the App Store export/validation path and privacy report review.

Evidence: Debug simulator build passed; a clean Release device build with `CODE_SIGNING_ALLOWED=NO` passed and bundled JS; `xcodebuild ... archive` succeeded to `/tmp/littleai-public-readiness.xcarchive`; the archive app has `CFBundleDisplayName = Field Theory`, `CFBundleIdentifier = com.afar1.littleai`, version `1.0.1`, build `2`, no `PlugIns` directory or `LittleAIKeyboard.appex`, and bundled privacy manifests. No App Store export validation or generated privacy report is recorded here; this Xcode install did not expose a `privacyreport` command-line tool.

Do: run Xcode Organizer validation/export, generate or review the privacy report, and verify App Store Connect privacy answers.

Verify: Organizer "Validate App" / export validation succeeds, and Xcode privacy report review matches App Store Connect disclosures.

3. Keyboard extension must stay excluded until it is rebuilt for App Store rules.

Why: the first public bundle now avoids this risk by not embedding the extension. If re-enabled, it is still a custom keyboard that requests open access and tries to record audio inside the extension. Apple documents that custom keyboards do not have microphone/speaker access, and the current extension also lacks a visible next-keyboard path.

Evidence: the app target no longer embeds `LittleAIKeyboard.appex`; `ios/LittleAIKeyboard/Info.plist` still has `RequestsOpenAccess`; `ios/LittleAIKeyboard/KeyboardViewController.swift` still uses `AVAudioRecorder`; no `advanceToNextInputMode` match was found. The model folder is ignored in `.gitignore` while Xcode references it as a bundled resource.

Do: keep `LittleAIKeyboard` out of public app archives, or rebuild it as a non-recording keyboard with a next-keyboard button and a clean model/resource story.

Verify: built app has no `PlugIns/LittleAIKeyboard.appex`; before re-enabling, run `rg -n "advanceToNextInputMode|AVAudioRecorder|RequestsOpenAccess" ios/LittleAIKeyboard` and an App Store archive privacy/report pass.

4. The mobile row sync migration must be applied before shipping this build.

Why: the current client now reads and writes `client_updated_at_ms` and `deleted_at` on todos, observations, and transcripts. If the migration is not applied in Supabase Cloud first, sync can fail at runtime when those columns are missing.

Evidence: `services/sync.ts` selects `client_updated_at_ms, deleted_at` and writes those fields; `supabase/migrations/017_mobile_row_soft_delete_timestamps.sql` adds and backfills the columns.

Do: apply `supabase/migrations/017_mobile_row_soft_delete_timestamps.sql` through the Supabase migration path or manually in the Supabase SQL editor.

Verify: the cloud tables expose `client_updated_at_ms bigint not null` and `deleted_at timestamptz null`, then run a real signed-in sync.

### P1: Public Quality Before Wider TestFlight

5. Verify durable row deletes and client edit timestamps on two devices.

Why: the client implementation now soft-deletes remote rows and resolves row conflicts from client edit clocks, but typecheck and SQL syntax checks do not prove the cross-device behavior in production.

Evidence: `services/sync.ts` pushes row tombstones through `deleted_at`, filters remote deleted rows during sync-down, and only upserts active local rows when their `client_updated_at_ms` beats the remote clock.

Do: after applying the cloud migration, run two-device offline tests for todos, observations, and transcripts.

Verify: two-device offline tests for delete persistence and newer offline edit winning over older later sync.

6. Verify signed-out local data isolation on device.

Why: the client now writes signed-out data into a local-only scope, but this still deserves an on-device sign-out/sign-in check before wider TestFlight.

Evidence: `StorageService.setUserScope(null)` now uses the `local` scope, and `activateSession(null)` migrates old base keys to that local scope instead of leaving them for the next signed-in account.

Do: sign out, create local content, sign into a different user, and confirm the local-only content is not attached to that account.

Verify: sign out, create local content, sign into a different user, confirm it is not silently claimed.

### P2: Responsiveness And Polish

7. Verify first-run model setup on device.

Why: the app now pins and checks the first-run Whisper model download, but the public experience still depends on real network speed, backgrounding behavior, and low-storage cases on device.

Evidence: `services/modelService.ts` uses a pinned Hugging Face commit, exact size, and native MD5; `hooks/useWhisperRecording.ts` and `App.tsx` show download progress while the model initializes.

Do: run first launch on a clean device with normal network, airplane mode, and low-storage conditions.

Verify: normal first launch reaches ready state, offline first launch shows a useful retryable error, and a partial/corrupt model is deleted and re-downloaded.

8. Product privacy copy needs final pass.

Why: the privacy manifest now declares email, user ID, and user content, but App Store labels and user-facing copy must explain local transcription versus optional sync/LLM processing.

Evidence: `ios/littleai/PrivacyInfo.xcprivacy` declares collected data; `process-transcription` can send transcript/todo context to Anthropic server-side.

Do: generate the archive privacy report and update App Store Connect/privacy copy before public release.

## Verification Evidence

Passed in this review:

- `npm run typecheck`
- `npm run verify:ios-public-readiness`
- `npm run inspect:ios-archive`
- `npx expo-doctor` -> 17/17 checks passed
- `npm audit --omit=dev --audit-level=high` -> 0 vulnerabilities
- `npx deno check --no-lock supabase/functions/process-transcription/index.ts`
- `npm run test:mobile-regressions` -> 41 tests passed
- `plutil -lint ios/littleai/PrivacyInfo.xcprivacy ios/littleai/Info.plist ios/LittleAIKeyboard/Info.plist`
- `git diff --check`
- `supabase/migrations/017_mobile_row_soft_delete_timestamps.sql` was syntax-checked against a throwaway `postgres:17-alpine` Docker container.
- `xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`
- `xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /tmp/littleai-public-readiness-build CODE_SIGNING_ALLOWED=NO build`
- `xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/littleai-public-readiness.xcarchive archive`
- `npm run inspect:ios-archive` -> display name `Field Theory`, bundle id `com.afar1.littleai`, version `1.0.1`, build `2`, valid code signing, bundled privacy manifests, no embedded keyboard or `PlugIns`, no secret-name matches in `main.jsbundle`, archive `132M`, app `27M`, Hermes bundle `3.4M`

Additional audit commands used:

- `npx expo config --type introspect --json`
- `supabase db lint --local --fail-on error` could not run because the local Supabase database container is not running.
- `xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -showBuildSettings -configuration Release`
- `docs/IOS_RELEASE_SOURCE_OF_TRUTH.md` records Xcode as the release source of truth and keeps native iOS identity out of `app.json` so `expo-doctor` stays green.
- `xcodebuild -list -project ios/littleai.xcodeproj`
- `find /tmp/littleai-public-readiness-build/Build/Products/Release-iphoneos/littleai.app -maxdepth 3 \( -name '*Keyboard*' -o -name 'PlugIns' \) -print` -> no output
- `test ! -e /tmp/littleai-public-readiness-build/Build/Products/Release-iphoneos/littleai.app/PlugIns`
- `plutil -p /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app/Info.plist` -> `CFBundleDisplayName = Field Theory`, `CFBundleIdentifier = com.afar1.littleai`, version `1.0.1`, build `2`
- `/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app/Info.plist` -> `com.afar1.littleai`
- `find /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app -maxdepth 3 \( -name '*Keyboard*' -o -name 'PlugIns' \) -print` -> no output
- `codesign -dv --verbose=4 /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app` -> identifier `com.afar1.littleai`, team `3244UJ94D8`
- `codesign --verify --strict --deep --verbose=2 /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app` -> valid on disk and satisfies designated requirement
- `find /tmp/littleai-public-readiness.xcarchive -name 'PrivacyInfo.xcprivacy' -print`
- `xcrun --find privacyreport` -> no local command-line privacy report utility found
- `rg -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS|X_CONSUMER|X_SECRET|GH_TOKEN|APPLE_APP_SPECIFIC_PASSWORD" /tmp/littleai-public-readiness-build/Build/Products/Release-iphoneos/littleai.app/main.jsbundle` -> no matches
- `rg -a -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS|X_CONSUMER|X_SECRET|GH_TOKEN|APPLE_APP_SPECIFIC_PASSWORD" /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app/main.jsbundle` -> no matches
- `du -sh /tmp/littleai-public-readiness.xcarchive /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app /tmp/littleai-public-readiness.xcarchive/Products/Applications/littleai.app/main.jsbundle` -> archive `132M`, app `27M`, Hermes bundle `3.4M`
- `rg -n "advanceToNextInputMode|needsInputModeSwitchKey|AVAudioRecorder|RequestsOpenAccess" ios/LittleAIKeyboard`

## Source Notes

- Expo documents built-in `EXPO_PUBLIC_` environment variable support: https://docs.expo.dev/guides/environment-variables/
- Apple custom keyboard open access docs call out keyboard constraints including no microphone/speaker access: https://developer.apple.com/documentation/uikit/configuring-open-access-for-a-custom-keyboard
- Apple's custom keyboard guide includes the next-keyboard affordance pattern: https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html
