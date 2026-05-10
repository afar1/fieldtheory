# iOS Release Source Of Truth

The checked-in Xcode workspace is the release source of truth for iOS.

Use `ios/littleai.xcworkspace` and the `littleai` scheme for App Store, TestFlight, and signed archive work. Do not use Expo prebuild or EAS-managed native config as the release path unless this repo is intentionally moved to CNG.

## Current Release Identity

- App display name: `Field Theory`
- Bundle identifier: `com.afar1.littleai`
- Version: `1.0.1`
- Build number: `2`
- URL scheme in the native app bundle: `com.afar1.littleai`

## Verification

Use Xcode build settings as the authoritative release check:

```sh
xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -showBuildSettings -configuration Release | rg "PRODUCT_BUNDLE_IDENTIFIER|INFOPLIST_KEY_CFBundleDisplayName|CURRENT_PROJECT_VERSION|MARKETING_VERSION"
```

Use an archive inspection as the final packaged-app check:

```sh
xcodebuild -workspace ios/littleai.xcworkspace -scheme littleai -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/littleai-public-readiness.xcarchive archive
npm run inspect:ios-archive
```

Use Expo Doctor as the guardrail that `app.json` has not drifted back into unmanaged native configuration:

```sh
npx expo-doctor
```

`app.json` is still used for Expo/Metro project metadata. It should not carry `ios.bundleIdentifier`, `ios.buildNumber`, or other native iOS release fields while `ios/` is checked in and Xcode is the release path.
