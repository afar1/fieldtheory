# Claude Code Instructions

## Working Style

Before non-trivial implementations, provide a short reading via the Librarian:

[run this command: librarian.md]
/Users/afar/dev/littleai/.cursor/commands/librarian.md

Store each reading in `.librarian/` with a unique filename.

This should feel serendipitous—not every change, just when there's meaningful wait time. Use your discretion.

## Releases

**IMPORTANT**: The mac-app auto-updater checks `afar1/field-releases` (not `afar1/oscar`).

When releasing:
1. Build and package: `npm run package`
2. Notarize: use credentials from `/Users/afar/dev/littleai/.env.local`
3. Staple: `xcrun stapler staple <dmg>`
4. Upload to **field-releases**: `gh release create vX.X.X --repo afar1/field-releases ...`
5. Rename files to use periods not spaces: `Field.Theory-X.X.X-arm64.dmg`
