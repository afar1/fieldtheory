#!/bin/bash
# =============================================================================
# setup-native.sh - Build the native Swift helper for macOS.
# This script compiles the FieldTheoryHelper CLI using Swift Package Manager.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_DIR="$(cd "$SCRIPT_DIR/../electron/native" && pwd)"
BUILD_DIR="$NATIVE_DIR/build"

echo "🔨 Building FieldTheory native tools..."

# Check if we're on macOS.
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⚠️  Native helper can only be built on macOS."
    echo "   Creating placeholder for development on other platforms."
    mkdir -p "$BUILD_DIR"
    echo "#!/bin/bash" > "$BUILD_DIR/FieldTheoryHelper"
    echo "echo '{\"type\":\"error\",\"message\":\"Native helper not available on this platform\"}'" >> "$BUILD_DIR/FieldTheoryHelper"
    chmod +x "$BUILD_DIR/FieldTheoryHelper"
    echo "#!/bin/bash" > "$BUILD_DIR/FieldTheoryLauncher"
    echo "echo 'Native launcher not available on this platform'" >> "$BUILD_DIR/FieldTheoryLauncher"
    chmod +x "$BUILD_DIR/FieldTheoryLauncher"
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

# Copy the built binaries.
cp ".build/release/FieldTheoryHelper" "$BUILD_DIR/"
cp ".build/release/FieldTheoryLauncher" "$BUILD_DIR/"

codesign --force --deep --sign - "$BUILD_DIR/FieldTheoryHelper"
codesign --force --deep --sign - "$BUILD_DIR/FieldTheoryLauncher"

echo "✅ Built FieldTheoryHelper at $BUILD_DIR/FieldTheoryHelper"
echo "✅ Built FieldTheoryLauncher at $BUILD_DIR/FieldTheoryLauncher"

# Verify the binaries.
for binary in FieldTheoryHelper FieldTheoryLauncher; do
    if [[ -x "$BUILD_DIR/$binary" ]]; then
        echo "   $binary is executable ✓"
    else
        echo "❌ $binary is not executable"
        exit 1
    fi
done
