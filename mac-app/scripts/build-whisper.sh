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

# Configure with Metal enabled
cmake -B "$BUILD_DIR" \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DCMAKE_BUILD_TYPE=Release

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

