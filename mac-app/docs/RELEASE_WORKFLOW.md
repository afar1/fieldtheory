# Oscar Release Workflow

## Overview

Oscar releases are published to a **separate public repository** (`afar1/field-releases`) to keep the source code private while allowing public distribution via GitHub Releases.

## Repository Setup

- **Source code**: `afar1/littleai` (private) or `afar1/oscar` (private)
- **Releases**: `afar1/field-releases` (public) — only contains release assets, no source code

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
autoUpdater.setFeedURL({ 
  provider: 'github', 
  owner: 'afar1', 
  repo: 'field-releases' 
});
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
- `Oscar-x.x.x-arm64-mac.zip`
- `Oscar-x.x.x-arm64.dmg`
- `latest-mac.yml` (used by auto-updater to detect new versions)

## Testing Auto-Updates

1. Build an older version locally (without publishing):
   ```bash
   # Set version to e.g., 0.1.14-test in package.json
   npm run package
   # Install the DMG from mac-app/release/
   ```

2. Publish a newer version to `field-releases`

3. Run the installed app from terminal to see updater logs:
   ```bash
   /Applications/Oscar.app/Contents/MacOS/Oscar
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
- Only runs in production builds (not when `ELECTRON_START_URL` is set)
- Checks on startup (5s delay) and every 30 minutes
- Use "Check for Updates…" in tray menu for manual check


