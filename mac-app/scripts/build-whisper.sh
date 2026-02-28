#!/bin/bash
# Build whisper-cli and whisper-server with Metal acceleration for macOS.
# whisper-cli is the per-invocation binary (fallback).
# whisper-server is the persistent HTTP server that keeps the model loaded
# in memory for sub-100ms transcription latency on subsequent requests.
# Outputs to: build-whisper/bin/whisper-cli, build-whisper/bin/whisper-server

set -e

# Get the repo root (two levels up from this script)
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Building whisper-cli + whisper-server with Metal acceleration..."
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

# Build both whisper-cli (fallback) and whisper-server (persistent engine)
cmake --build "$BUILD_DIR" --target whisper-cli -j
cmake --build "$BUILD_DIR" --target whisper-server -j

# Verify the binaries exist
BINARY_PATH="$BUILD_DIR/bin/whisper-cli"
if [ -f "$BINARY_PATH" ]; then
  echo "✓ whisper-cli built successfully: $BINARY_PATH"
  file "$BINARY_PATH"
else
  echo "✗ whisper-cli build failed - binary not found at $BINARY_PATH"
  exit 1
fi

SERVER_PATH="$BUILD_DIR/bin/whisper-server"
if [ -f "$SERVER_PATH" ]; then
  echo "✓ whisper-server built successfully: $SERVER_PATH"
  file "$SERVER_PATH"
else
  echo "✗ whisper-server build failed - binary not found at $SERVER_PATH"
  exit 1
fi

