#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:-/tmp/littleai-public-readiness.xcarchive}"
APP_PATH="$ARCHIVE_PATH/Products/Applications/littleai.app"
INFO_PLIST="$APP_PATH/Info.plist"
JS_BUNDLE="$APP_PATH/main.jsbundle"
SECRET_PATTERN='ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS|X_CONSUMER|X_SECRET|GH_TOKEN|APPLE_APP_SPECIFIC_PASSWORD'

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found at $APP_PATH" >&2
  exit 1
fi

echo "Archive: $ARCHIVE_PATH"
for key in CFBundleDisplayName CFBundleIdentifier CFBundleShortVersionString CFBundleVersion; do
  value=$(/usr/libexec/PlistBuddy -c "Print :$key" "$INFO_PLIST")
  echo "$key: $value"
done

embedded_keyboard_matches=$(find "$APP_PATH" -maxdepth 3 \( -name '*Keyboard*' -o -name PlugIns \) -print)
if [[ -n "$embedded_keyboard_matches" ]]; then
  echo "Unexpected embedded keyboard or PlugIns path found:" >&2
  echo "$embedded_keyboard_matches" >&2
  exit 1
fi

codesign --verify --strict --deep --verbose=2 "$APP_PATH"

privacy_manifests=$(find "$ARCHIVE_PATH" -name PrivacyInfo.xcprivacy -print)
if [[ -z "$privacy_manifests" ]]; then
  echo "No PrivacyInfo.xcprivacy files found in archive." >&2
  exit 1
fi
echo "$privacy_manifests"

if [[ ! -f "$JS_BUNDLE" ]]; then
  echo "JS bundle not found at $JS_BUNDLE" >&2
  exit 1
fi

if rg -a -n "$SECRET_PATTERN" "$JS_BUNDLE"; then
  echo "Potential secret environment variable name found in JS bundle." >&2
  exit 1
fi

du -sh "$ARCHIVE_PATH" "$APP_PATH" "$JS_BUNDLE"
echo "Archive inspection passed."
