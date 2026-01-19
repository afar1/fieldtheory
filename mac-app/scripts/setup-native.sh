#!/bin/bash
# =============================================================================
# setup-native.sh - Build the native Swift helper for macOS.
# This script compiles the FieldTheoryHelper CLI using Swift Package Manager.
# =============================================================================

set -e

SCRIPT_DIR="$(dirname "$0")"
NATIVE_DIR="$SCRIPT_DIR/../electron/native"
BUILD_DIR="$NATIVE_DIR/build"

echo "🔨 Building FieldTheoryHelper..."

# Check if we're on macOS.
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⚠️  Native helper can only be built on macOS."
    echo "   Creating placeholder for development on other platforms."
    mkdir -p "$BUILD_DIR"
    echo "#!/bin/bash" > "$BUILD_DIR/FieldTheoryHelper"
    echo "echo '{\"type\":\"error\",\"message\":\"Native helper not available on this platform\"}'" >> "$BUILD_DIR/FieldTheoryHelper"
    chmod +x "$BUILD_DIR/FieldTheoryHelper"
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
cp ".build/release/FieldTheoryHelper" "$BUILD_DIR/"

echo "✅ Built FieldTheoryHelper at $BUILD_DIR/FieldTheoryHelper"

# Verify the binary.
if [[ -x "$BUILD_DIR/FieldTheoryHelper" ]]; then
    echo "   Binary is executable ✓"
else
    echo "❌ Binary is not executable"
    exit 1
fi
