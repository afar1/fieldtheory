#!/bin/bash
# Build whisper-cli with Metal acceleration for macOS
# Outputs to: build-whisper/bin/whisper-cli

set -e

# Get the repo root (two levels up from this script)
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Building whisper-cli with Metal acceleration..."
echo "Repo root: $REPO_ROOT"

# Build directory
BUILD_DIR="build-whisper"

# macOS deployment target - set to 13.0 (Ventura) for broad compatibility
# while still supporting modern Metal features on Apple Silicon.
# This prevents the binary from requiring newer Metal APIs that don't exist
# on older macOS versions (e.g., MTLResidencySetDescriptor requires macOS 15+).
MACOS_MIN_VERSION="13.0"

# Configure with Metal enabled and static linking
cmake -B "$BUILD_DIR" \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN_VERSION" \
  -DGGML_METAL_MACOSX_VERSION_MIN="$MACOS_MIN_VERSION"

# Build only the whisper-cli target
cmake --build "$BUILD_DIR" --target whisper-cli -j

# Verify the binary exists
BINARY_PATH="$BUILD_DIR/bin/whisper-cli"
if [ -f "$BINARY_PATH" ]; then
  echo "✓ Built successfully: $BINARY_PATH"
  # Show binary info
  file "$BINARY_PATH"
else
  echo "✗ Build failed - binary not found at $BINARY_PATH"
  exit 1
fi

