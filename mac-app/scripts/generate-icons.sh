#!/bin/bash
# =============================================================================
# generate-icons.sh - Generate placeholder Field Theory tray icons for development.
# In production, replace these with properly designed/provenanced icons.
# =============================================================================

set -e

ASSETS_DIR="$(dirname "$0")/../electron/assets"
mkdir -p "$ASSETS_DIR"

# Check if we have ImageMagick available.
if ! command -v convert &> /dev/null; then
    echo "ImageMagick (convert) not found. Creating placeholder text files instead."
    echo "Install ImageMagick: brew install imagemagick"
    echo "Replace with a 16x16 PNG template image (black + alpha)" > "$ASSETS_DIR/fieldtheory-iconTemplate.png.txt"
    echo "Replace with a 32x32 PNG template image (black + alpha)" > "$ASSETS_DIR/fieldtheory-iconTemplate@2x.png.txt"
    exit 0
fi

# Create the template icon used by TrayManager.
convert -size 16x16 xc:transparent \
    -fill black -stroke none \
    -draw "circle 8,8 8,2" \
    "$ASSETS_DIR/fieldtheory-iconTemplate.png"

convert -size 32x32 xc:transparent \
    -fill black -stroke none \
    -draw "circle 16,16 16,4" \
    "$ASSETS_DIR/fieldtheory-iconTemplate@2x.png"

echo "Generated placeholder Field Theory tray icons in $ASSETS_DIR"
echo "Replace these with properly designed/provenanced icons for production."
