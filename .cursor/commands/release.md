# Package and Release

  Notarize the application with Apple (if necessary). Bump the version number.
  Run the slop command. Package and push to GitHub releases with succinct
  release notes that you write. Publish unless I specify "draft".

  ## Credentials

  You can find the credentials for notarization and GitHub in the `.env.local`
  file in the project root.

  **Important:** The password variable is `APPLE_APP_SPECIFIC_PASSWORD`, not
  `APPLE_ID_PASSWORD`.

  ## Steps

  1. **Run the slop command** to clean up any AI-generated code artifacts
  2. **Bump the version** in `package.json`
  3. **Update in-app release notes** (see section below)
  4. **Draft release notes** and confirm with me before building - I may want
  changes
  5. **Source credentials**: `source .env.local`
  6. **Build and package**: `npm run package`
  7. **Rename and upload release files** (see section below)
  8. **Create GitHub release** with the release notes

  ## In-app release notes

  **Important:** Update the release notes file with notes for each version. Add
  an entry to both:
  - `RELEASE_NOTES` - array of 1-4 bullet points describing what's new
  - `RELEASE_DATES` - the release date in format 'Jan 15 2026'

  This shows the "What's new" popup to users after they update. If you skip
  this, users won't see any release notes in the app.

  **Before packaging:** Draft the release notes and confirm them with me before
  building. I may want to make changes to the wording or add/remove items.

  ## Release files (CRITICAL - auto-updater will break without these)

  The auto-updater requires ALL of these files to be uploaded to the GitHub
  release:

  ### Required files checklist:
  1. `AppName-X.X.X-arm64.dmg` - DMG installer
  2. `AppName-X.X.X-arm64-mac.zip` - ZIP for auto-updates
  3. `latest-mac.yml` - Auto-update manifest (MUST be edited before upload)

  ### Steps for release files:
  1. **Rename files** to use periods instead of spaces:
     ```bash
     mv "release/App Name-X.X.X-arm64.dmg" "release/App.Name-X.X.X-arm64.dmg"
     mv "release/App Name-X.X.X-arm64-mac.zip"
  "release/App.Name-X.X.X-arm64-mac.zip"

  2. Edit latest-mac.yml - Change all spaces/dashes to match the renamed files:
    - url: must match the renamed zip filename
    - path: must match the renamed zip filename
    - DMG url must also match
  3. Upload ALL three files to the GitHub release:
  gh release upload vX.X.X \
    "release/App.Name-X.X.X-arm64.dmg" \
    "release/App.Name-X.X.X-arm64-mac.zip" \
    "release/latest-mac.yml"

  Why this matters: The auto-updater downloads latest-mac.yml first, then uses
  the URLs inside to download the update. If the yml is missing or has wrong
  filenames, updates will fail with a 404 error.

  Draft vs Published

  Unless I specify "draft", create a published release. Use --draft flag for
  draft releases.
  ```