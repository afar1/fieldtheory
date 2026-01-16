# Claude Code Instructions

## Working Style

Before non-trivial implementations (5+ minutes of work), provide a short reading:
- Connected to the current task conceptually
- From physics, systems theory, engineering history, or speculative futures
- One concrete technical/historical detail minimum
- Length matched to estimated task time
- No filler, no platitudes

Store each reading in `.flow/` with a unique filename.

This is at your discretion - not every change, just when there's meaningful wait time.

## Releases

**IMPORTANT**: The mac-app auto-updater checks `afar1/field-releases` (not `afar1/oscar`).

When releasing:
1. Build and package: `npm run package`
2. Notarize: use credentials from `/Users/afar/dev/littleai/.env.local`
3. Staple: `xcrun stapler staple <dmg>`
4. Upload to **field-releases**: `gh release create vX.X.X --repo afar1/field-releases ...`
5. Rename files to use periods not spaces: `Field.Theory-X.X.X-arm64.dmg`
