# iOS Public Release Runbook

Use this after the local public-readiness work is merged and before a public TestFlight or App Store rollout.

This is not a substitute for `docs/IOS_PUBLIC_READINESS_REVIEW.md`. It is the short checklist for the remaining manual gates.

## 1. Local Gates

Run the fast local gate:

```sh
npm run verify:ios-public-readiness
```

Archive and inspect the packaged app:

```sh
xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/littleai-public-readiness.xcarchive archive
npm run inspect:ios-archive
```

Pass means:

- typecheck passes
- focused mobile regressions pass
- Expo Doctor passes
- production audit has no high vulnerabilities
- Edge Function typecheck passes
- plist lint passes
- whitespace check passes
- archive display name is `Field Theory`
- bundle id is `com.afar1.littleai`
- no keyboard extension or `PlugIns` directory is embedded
- codesign verification passes
- privacy manifests are present
- the JS bundle does not contain obvious secret environment variable names

## 2. Supabase Cloud Gate

Apply the mobile sync migration to the production Supabase project before shipping this client.

If using the Supabase SQL editor, paste the exact contents of:

```text
supabase/migrations/021_mobile_row_soft_delete_timestamps.sql
```

Then verify the columns:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('todos', 'observations', 'transcripts')
  and column_name in ('client_updated_at_ms', 'deleted_at')
order by table_name, column_name;
```

Expected result:

- every table has `client_updated_at_ms`
- `client_updated_at_ms` is `bigint`
- `client_updated_at_ms` is not nullable
- every table has nullable `deleted_at`

Verify the indexes:

```sql
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_todos_user_deleted_client_updated',
    'idx_observations_user_deleted_client_updated',
    'idx_transcripts_user_deleted_client_updated'
  )
order by tablename, indexname;
```

Deploy the transcription Edge Function after confirming the project ref:

```sh
supabase functions deploy process-transcription --project-ref <project-ref>
```

Set the server-side Anthropic key in Supabase secrets. Do not put this value in `.env`, docs, logs, or git:

```sh
supabase secrets set ANTHROPIC_API_KEY=<value> --project-ref <project-ref>
```

Verify on a signed-in device:

- record or enter a transcript
- run manual Separate or the flow that invokes transcript processing
- confirm the client receives a structured todo/observation diff
- check Supabase function logs for a 200 response from `process-transcription`
- confirm logs do not print provider keys or full sensitive user content

## 3. Device QA Gate

Run these on a real iPhone build installed from the signed archive or TestFlight.

First-run speech model:

- clean install on normal network downloads the model and reaches ready state
- airplane-mode first launch shows a recoverable error instead of hanging
- interrupted download deletes the partial model and retries cleanly

Recording and transcript capture:

- start and stop a recording
- transcript appears immediately in the timeline
- command expansion patches the same transcript entry instead of creating a duplicate
- background recording still behaves according to the App Store privacy copy

Signed-out storage:

- sign out
- create todos, observations, transcripts, and library notes
- sign into a different account
- confirm signed-out local data is not silently attached to that account

Two-device sync:

- sign into the same account on two devices
- create, edit, complete, and delete todos while one device is offline
- create and delete observations while one device is offline
- create and delete transcripts while one device is offline
- reconnect both devices
- confirm deletes stay deleted and newer offline edits win over older later-syncing edits

Library editing:

- type continuously in a long note
- switch notes
- create a new note immediately after editing
- confirm unrelated synced notes are not lost and the edited note persists after relaunch

## 4. App Store Gate

Use Xcode Organizer on the archive that passed `npm run inspect:ios-archive`.

Required checks:

- `Validate App` succeeds
- upload/export validation succeeds
- App Store Connect processing succeeds
- privacy report is reviewed
- App Store Connect privacy labels match `ios/littleai/PrivacyInfo.xcprivacy`
- privacy copy explains local transcription, optional sync, and server-side LLM processing
- keyboard extension remains excluded unless rebuilt and re-reviewed

## 5. Ship Decision

Do not call the public release green until all of these are true:

- local verifier passes
- archive inspector passes
- Supabase migration is applied in Cloud
- `process-transcription` is deployed and tested with real auth
- two-device sync tests pass
- first-run model tests pass on device
- App Store validation and privacy review pass
