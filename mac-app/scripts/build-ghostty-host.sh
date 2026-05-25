#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
NODE_HEADERS="${ELECTRON_HEADERS_DIR:-$HOME/.electron-gyp/$ELECTRON_VERSION/include/node}"
GHOSTTY_SOURCE_DIR="${GHOSTTY_SOURCE_DIR:-$HOME/dev/ghostty}"
GHOSTTY_KIT_DIR="$GHOSTTY_SOURCE_DIR/macos/GhosttyKit.xcframework/macos-arm64_x86_64"
GHOSTTY_LIB_PATH="${GHOSTTY_LIB_PATH:-$GHOSTTY_KIT_DIR/libghostty.a}"
SOURCE="$APP_DIR/electron/native/Sources/GhosttyHost/ghostty_host.mm"
BUILD_DIR="$APP_DIR/electron/native/build"
OUTPUT="$BUILD_DIR/ghostty-host.node"

if [[ ! -f "$NODE_HEADERS/node_api.h" ]]; then
  echo "Missing Electron Node headers: $NODE_HEADERS/node_api.h" >&2
  echo "Run npm run rebuild first, or set ELECTRON_HEADERS_DIR." >&2
  exit 1
fi

if [[ ! -f "$GHOSTTY_KIT_DIR/Headers/ghostty.h" || ! -f "$GHOSTTY_LIB_PATH" ]]; then
  echo "Missing GhosttyKit artifacts in: $GHOSTTY_KIT_DIR" >&2
  echo "Missing Ghostty library: $GHOSTTY_LIB_PATH" >&2
  echo "Build Ghostty's macOS xcframework first or set GHOSTTY_SOURCE_DIR." >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

clang++ \
  -std=c++17 \
  -fobjc-arc \
  -I "$NODE_HEADERS" \
  -I "$GHOSTTY_KIT_DIR/Headers" \
  -bundle \
  -undefined dynamic_lookup \
  "$GHOSTTY_LIB_PATH" \
  -framework AppKit \
  -framework CoreGraphics \
  -framework CoreText \
  -framework CoreVideo \
  -framework IOSurface \
  -framework Metal \
  -framework QuartzCore \
  -framework Carbon \
  "$SOURCE" \
  -o "$OUTPUT"

codesign --force --sign - "$OUTPUT" >/dev/null
echo "Built Ghostty host bridge at $OUTPUT"
