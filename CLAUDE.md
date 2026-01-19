# Claude Code Instructions

## Working Style

Before non-trivial implementations, provide a short reading via the Librarian:

[run this command: librarian.md]
/Users/afar/dev/fieldtheory/.cursor/commands/librarian.md

Store each reading in `.librarian/` with a unique filename.

This should feel serendipitous—not every change, just when there's meaningful wait time. Use your discretion.

## Releases

**IMPORTANT**: The mac-app auto-updater checks `afar1/field-releases` (not `afar1/oscar`).

When releasing:
1. Build and package: `npm run package`
2. Notarize: use credentials from `/Users/afar/dev/fieldtheory/.env.local`
3. Staple: `xcrun stapler staple <dmg>`
4. Upload to **field-releases**: `gh release create vX.X.X --repo afar1/field-releases ...`
5. Rename files to use periods not spaces: `Field.Theory-X.X.X-arm64.dmg`

## Codebase Structure

### ClipboardHistory Component
**File**: `mac-app/src/components/ClipboardHistory.tsx` (~7000+ lines)

Key sections:
- **Lines 2988-3024**: Main component return, outer container (fills 100% of window)
- **Lines 5016-5065**: Individual item row rendering (`DraggableDroppableRow`)
- **Lines 5114-5171**: Content type icon grid (2x2 quad: transcript/image/path/text)
- **Lines 5173-5300**: Main content area with smart truncation
- **Lines 5579-5593**: Metadata display ("15 words transcribed in iTerm2 9 hrs ago")

Icon colors:
- Transcript (microphone): violet `#8b5cf6`
- Image: emerald `#10b981`
- Path/URL (folder): blue `#3b82f6`
- Plain text (T): amber `#f59e0b`
- Disabled: gray `#4b5563` (dark) / `#d1d5db` (light)

The component fills `width: 100%` - actual width is controlled by the Electron BrowserWindow.

### Electron Window Management
**File**: `mac-app/electron/main/index.ts` - Main process, window creation
**File**: `mac-app/electron/main/librarianManager.ts` - Librarian window management

Window sizing is typically configured in main process when creating BrowserWindows.
