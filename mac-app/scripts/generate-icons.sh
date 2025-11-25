#!/bin/bash
# =============================================================================
# generate-icons.sh - Generate placeholder tray icons for development.
# In production, replace these with properly designed icons.
# =============================================================================

set -e

ASSETS_DIR="$(dirname "$0")/../electron/assets"
mkdir -p "$ASSETS_DIR"

# Check if we have ImageMagick available.
if ! command -v convert &> /dev/null; then
    echo "ImageMagick (convert) not found. Creating placeholder text files instead."
    echo "Install ImageMagick: brew install imagemagick"
    
    # Create placeholder files with instructions.
    echo "Replace with 16x16 or 22x22 PNG template image (black + alpha)" > "$ASSETS_DIR/littleone-disconnectedTemplate.png.txt"
    echo "Replace with 16x16 or 22x22 PNG template image (black + alpha)" > "$ASSETS_DIR/littleone-connectedTemplate.png.txt"
    echo "Replace with 16x16 or 22x22 PNG template image (black + alpha)" > "$ASSETS_DIR/littleone-activeTemplate.png.txt"
    
    exit 0
fi

# Create 16x16 template icons with different states.
# Note: These are very simple placeholders - replace with proper designs.

# Disconnected: Empty/hollow circle (outline only).
convert -size 16x16 xc:transparent \
    -fill none -stroke black -strokewidth 1.5 \
    -draw "circle 8,8 8,2" \
    "$ASSETS_DIR/littleone-disconnectedTemplate.png"

# Connected: Filled circle.
convert -size 16x16 xc:transparent \
    -fill black -stroke none \
    -draw "circle 8,8 8,3" \
    "$ASSETS_DIR/littleone-connectedTemplate.png"

# Active: Filled circle with inner highlight (darker fill).
convert -size 16x16 xc:transparent \
    -fill black -stroke none \
    -draw "circle 8,8 8,2" \
    "$ASSETS_DIR/littleone-activeTemplate.png"

# Also create @2x versions for Retina displays.
convert -size 32x32 xc:transparent \
    -fill none -stroke black -strokewidth 3 \
    -draw "circle 16,16 16,4" \
    "$ASSETS_DIR/littleone-disconnectedTemplate@2x.png"

convert -size 32x32 xc:transparent \
    -fill black -stroke none \
    -draw "circle 16,16 16,6" \
    "$ASSETS_DIR/littleone-connectedTemplate@2x.png"

convert -size 32x32 xc:transparent \
    -fill black -stroke none \
    -draw "circle 16,16 16,4" \
    "$ASSETS_DIR/littleone-activeTemplate@2x.png"

echo "✅ Generated placeholder tray icons in $ASSETS_DIR"
echo "Note: Replace these with properly designed icons for production."
