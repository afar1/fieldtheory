#!/bin/bash
# =============================================================================
# setup-native.sh - Build the native Swift helper for macOS.
# This script compiles the LittleOneHelper CLI using Swift Package Manager.
# =============================================================================

set -e

SCRIPT_DIR="$(dirname "$0")"
NATIVE_DIR="$SCRIPT_DIR/../electron/native"
BUILD_DIR="$NATIVE_DIR/build"

echo "🔨 Building LittleOneHelper..."

# Check if we're on macOS.
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⚠️  Native helper can only be built on macOS."
    echo "   Creating placeholder for development on other platforms."
    mkdir -p "$BUILD_DIR"
    echo "#!/bin/bash" > "$BUILD_DIR/LittleOneHelper"
    echo "echo '{\"type\":\"error\",\"message\":\"Native helper not available on this platform\"}'" >> "$BUILD_DIR/LittleOneHelper"
    chmod +x "$BUILD_DIR/LittleOneHelper"
    exit 0
fi

# Check if Swift is available.
if ! command -v swift &> /dev/null; then
    echo "❌ Swift not found. Please install Xcode or Xcode Command Line Tools."
    exit 1
fi

# Navigate to native directory.
cd "$NATIVE_DIR"

# Build in release mode for production.
echo "   Compiling Swift code..."
swift build -c release

# Create build output directory.
mkdir -p "$BUILD_DIR"

# Copy the built binary.
cp ".build/release/LittleOneHelper" "$BUILD_DIR/"

echo "✅ Built LittleOneHelper at $BUILD_DIR/LittleOneHelper"

# Verify the binary.
if [[ -x "$BUILD_DIR/LittleOneHelper" ]]; then
    echo "   Binary is executable ✓"
else
    echo "❌ Binary is not executable"
    exit 1
fi
