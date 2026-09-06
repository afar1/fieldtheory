# Field Theory for iPhone and iPad

Fully native SwiftUI app (iOS 26). Four sections: **Library** (synced
markdown with a rendered reader and a live-styled TextKit 2 editor), **River**
(team-shared documents as cards with Mailbox-style read/unread swipes), and
**Voice** (fully offline whisper.cpp transcription with stackable items), plus
**Goals** (a local feedback feed for evaluating product directions).

The same target runs on iPhone and iPad. Compact windows retain the phone tab
bar and stacked navigation. Regular-width iPad windows use an adaptive top tab
bar/sidebar and persistent master-detail layouts. All iPad orientations are
supported, including Split View and Stage Manager window sizes.

## Build

```bash
# one-time: build the whisper xcframework from the repo's whisper.cpp
./ios-native/scripts/build-whisper-ios.sh   # run from repo root

cd ios-native
xcodegen generate
xcodebuild -project FieldTheory.xcodeproj -scheme FieldTheory \
  -configuration Debug -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates build
```

Install on an iPhone or iPad (device id from `xcrun devicectl list devices`):

```bash
xcrun devicectl device install app --device <UDID> \
  ~/Library/Developer/Xcode/DerivedData/FieldTheory-*/Build/Products/Debug-iphoneos/FieldTheory.app
```

## Sync

Speaks the same Supabase dialects as the Mac app and the previous mobile app:

- `library_documents` — private library; `client_id = "library-" + sha256(source_path)[0..<32]`,
  sha256 content hashes, tombstones are emptied rows with `deleted_at`,
  conflict copies as `*.sync-conflict-<ms>.md`. The device holds a **selected
  subset** of folders and never treats absence as deletion.
- `team_documents` — River, scoped by `team_scope_user_id` resolved from team
  `contacts`. Read state is local, keyed by `(id, revision)`.
- `transcripts` — Voice items, last-write-wins on `client_updated_at_ms`,
  stack segments in `metadata.stackSegments` (camelCase, matching the old app).

## Simulator preview

`simctl launch <sim> com.afar1.fieldtheory ft-preview` seeds fixture data and
skips auth (simulator builds only). Additional tokens: `ft-tab-river`,
`ft-tab-voice`, `ft-open-doc`, `ft-edit-doc`, `ft-open-river`, and
`ft-test-whisper` (transcribes /tmp/ft-test.wav from the host and prints the
result).
