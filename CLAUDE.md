# Claude Code Instructions

## Working Style

[run this command: flow.md]
/Users/afar/dev/littleai/.cursor/commands/flow.md

Store each reading in `.flow/` with a unique filename.

You should show this often but now every time. I want you to figure out a frequency that feels serendipitous in every discussion. I shouldn't have to ask for you to run [run this command: flow.md]
/Users/afar/dev/littleai/.cursor/commands/flow.md

## Releases

**IMPORTANT**: The mac-app auto-updater checks `afar1/field-releases` (not `afar1/oscar`).

When releasing:
1. Build and package: `npm run package`
2. Notarize: use credentials from `/Users/afar/dev/littleai/.env.local`
3. Staple: `xcrun stapler staple <dmg>`
4. Upload to **field-releases**: `gh release create vX.X.X --repo afar1/field-releases ...`
5. Rename files to use periods not spaces: `Field.Theory-X.X.X-arm64.dmg`
