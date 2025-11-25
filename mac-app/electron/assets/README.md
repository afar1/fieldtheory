# Tray Icon Assets

This directory contains the macOS menu bar (tray) icons for Little One.

## Required Files

- `littleone-disconnectedTemplate.png` - Shown when Little One is not connected
- `littleone-connectedTemplate.png` - Shown when Little One is connected but not locked
- `littleone-activeTemplate.png` - Shown when Little One is connected AND locked as input

## Icon Requirements

### Template Images
macOS uses "template images" for menu bar icons. These automatically adapt to the
system's light/dark mode and menu bar appearance.

Requirements:
- Use the `Template.png` suffix in the filename
- Images should be **black with alpha transparency** only
- macOS will automatically colorize them appropriately
- Avoid using colors or gradients

### Dimensions
- Standard: 16x16 pixels (required)
- Retina: 32x32 pixels as `*Template@2x.png` (optional but recommended)

### Example Creation (macOS)
```bash
# Using ImageMagick to create placeholder icons
convert -size 16x16 xc:transparent -fill black -draw "circle 8,8 8,2" littleone-disconnectedTemplate.png
convert -size 16x16 xc:transparent -fill black -draw "circle 8,8 8,2" littleone-connectedTemplate.png
convert -size 16x16 xc:transparent -fill black -draw "circle 8,8 8,2" littleone-activeTemplate.png
```

### Production Icons
For production, create proper icons that convey:
- **Disconnected**: Hollow/outlined microphone or badge shape
- **Connected**: Filled microphone or badge shape
- **Active/Locked**: Filled shape with a lock indicator or highlight
