#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/fieldtheory-voice-sampler"
MODULE_CACHE_DIR="$BUILD_DIR/module-cache"
APP_BIN="$BUILD_DIR/voice-sampler"

mkdir -p "$BUILD_DIR" "$MODULE_CACHE_DIR"

xcrun swiftc \
  -parse-as-library \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -framework SwiftUI \
  -framework AVFAudio \
  -framework AppKit \
  "$ROOT_DIR/VoiceSampler.swift" \
  -o "$APP_BIN"

exec "$APP_BIN"
