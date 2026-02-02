Please notarize the application, if necessary for this application with Apple. Bump the version number. Make sure to run the slop command. Then package always and push to GitHub and make this release. The latest version with release notes, succinct release notes that you provide and write and publish. Um, unless I specify that I want it to be a draft.


## Release files (CRITICAL - auto-updater will break without these)

The auto-updater requires ALL of these files to be uploaded to the GitHub release:

### Required files checklist:
1. `Field.Theory-X.X.X-arm64.dmg` - DMG installer (rename from "Field Theory-..." to "Field.Theory-...")
2. `Field.Theory-X.X.X-arm64-mac.zip` - ZIP for auto-updates (rename similarly)
3. `latest-mac.yml` - Auto-update manifest (MUST be edited before upload)

### Steps for release files:
1. **Rename files** to use periods instead of spaces:
   ```bash
   mv "release/Field Theory-X.X.X-arm64.dmg" "release/Field.Theory-X.X.X-arm64.dmg"
   mv "release/Field Theory-X.X.X-arm64-mac.zip" "release/Field.Theory-X.X.X-arm64-mac.zip"
   ```

2. **Edit `latest-mac.yml`** - Change all `Field-Theory-` to `Field.Theory-` in the URLs:
   - `url: Field.Theory-X.X.X-arm64-mac.zip` (not Field-Theory-)
   - `url: Field.Theory-X.X.X-arm64.dmg` (not Field-Theory-)
   - `path: Field.Theory-X.X.X-arm64-mac.zip` (not Field-Theory-)

3. **Upload ALL three files** to the GitHub release:
   ```bash
   gh release upload vX.X.X --repo afar1/field-releases \
     "release/Field.Theory-X.X.X-arm64.dmg" \
     "release/Field.Theory-X.X.X-arm64-mac.zip" \
     "release/latest-mac.yml"
   ```

**Why this matters:** The auto-updater downloads `latest-mac.yml` first, then uses the URLs inside to download the update. If the yml is missing or has wrong filenames, updates will fail with a 404 error.

This application manages its releases in the field-releases repo.

You can find the credentials necessary for notarization and GitHub in my .env.local file in the root directory.

You make this mistake a lot by the way "⏺ I see - the variable is named
  APPLE_APP_SPECIFIC_PASSWORD, not APPLE_ID_PASSWORD.
  Let me use the correct variable names."

## In-app release notes

**Important:** Update `src/components/ReleaseNotesPopup.tsx` with release notes for each version. Add an entry to both:
- `RELEASE_NOTES` - array of 1-4 bullet points describing what's new
- `RELEASE_DATES` - the release date in format 'Jan 15 2026'

This shows the "What's new" popup to users after they update. If you skip this, users won't see any release notes in the app.

**Before packaging:** Draft the release notes and confirm them with me before building. I may want to make changes to the wording or add/remove items.