# Field Theory for iPhone and iPad

A native SwiftUI Voice app for iOS 26. Record thoughts, transcribe them on
device with NVIDIA Parakeet through FluidAudio, and edit, stack, copy, or sync Voice transcripts.
The same workspace adapts to iPhone and iPad.

Library, River, and Goals implementation types remain in the source tree for
future product work, but this iOS build has no public navigation or launch route
to them.

## Build

```bash
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

The Voice-only sync cycle handles locally created or edited transcript rows and
tombstones. It does not query, upload, or download Library or River documents,
and it does not download transcripts created by another client into this app.

## Simulator preview

`simctl launch <sim> com.afar1.fieldtheory ft-preview` opens an isolated,
fictional Voice workspace without authentication. It is compiled only for the
simulator.
