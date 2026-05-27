# Field Theory Release Workflow

## Overview

Field Theory releases are published to a **separate public repository** (`afar1/field-releases`) to keep the source code private while allowing public distribution via GitHub Releases.
Experimental releases are published as prereleases on the private source repository (`afar1/oscar`) from its `experimental` branch.

## Repository Setup

- **Source code**: `afar1/oscar` (private)
- **Production releases**: `afar1/field-releases` (public) — only contains release assets, no source code
- **Experimental releases**: `afar1/oscar` (private) — prerelease assets targeted at the `experimental` branch

## Configuration

### `package.json` (build.publish section)
```json
"publish": {
  "provider": "github",
  "owner": "afar1",
  "repo": "field-releases"
}
```

### `electron/main/index.ts` (autoUpdater feed URL)
```typescript
autoUpdater.setFeedURL(autoUpdaterFeedOptionsForBuildChannel(fieldTheoryBuildChannel, token));
```

## Publishing a New Release

1. **Bump version** in `mac-app/package.json`
2. **Export GitHub token** with `Contents: Read and write` permission for `field-releases`:
   ```bash
   export GH_TOKEN=ghp_your_token_here
   ```
3. **Build and publish**:
   ```bash
   cd mac-app
   npm run package -- --publish always
   ```

This uploads:
- `Field.Theory-x.x.x-arm64-mac.zip`
- `Field.Theory-x.x.x-arm64.dmg`
- `latest-mac.yml` (used by auto-updater to detect new versions)

## Testing Auto-Updates

1. Build an older version locally (without publishing):
   ```bash
   # Set version to e.g., 0.1.14-test in package.json
   npm run package
   # Install the DMG from mac-app/release/
   ```

2. Publish a newer version to `field-releases`, or publish an experimental prerelease to `oscar` from the `experimental` branch

3. Run the installed app from terminal to see updater logs:
   ```bash
   /Applications/Field\ Theory.app/Contents/MacOS/Field\ Theory
   ```

4. Look for `[Updater]` logs confirming update detection

## GitHub Token Permissions

For fine-grained tokens on `field-releases`:
- **Contents**: Read and write (required for creating releases and uploading assets)

For classic tokens:
- `repo` scope (full control of private repositories)

## Troubleshooting

### "No published versions on GitHub"
The `field-releases` repo has no releases yet. Publish one first.

### "403 Forbidden - Resource not accessible by personal access token"
Your `GH_TOKEN` doesn't have write access to `field-releases`. Update token permissions.

### Auto-updater not checking
- Only runs in packaged builds with an enabled updater feed (not when `ELECTRON_START_URL` is set)
- Experimental builds need `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN` or local GitHub CLI auth at runtime so they can read private `afar1/oscar` release assets
- Checks on startup (5s delay) and every 30 minutes
- Use "Check for Updates…" in tray menu for manual check



