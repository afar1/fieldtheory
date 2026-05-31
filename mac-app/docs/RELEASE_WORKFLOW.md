# Field Theory Release Workflow

This document describes maintainer packaging. It is not required for normal local development.

Public contributors should use the development path in `mac-app/README.md` and `mac-app/CONTRIBUTING.md`. Packaging, signing, notarization, GitHub release publishing, and updater feeds require maintainer-controlled credentials and release repositories.

## Local development versus release packaging

Use these commands for normal development:

```bash
npm run dev
npm run build
npm test
```

Use release packaging only when preparing a signed maintainer build:

```bash
npm run package
npm run package:experimental
```

The package commands run release-channel guards, package-safety checks, native/helper builds, Whisper builds, Electron/Vite builds, Electron Builder, and signing/notarization hooks. They are intentionally stricter than contributor development.

## Release channels

Production builds use the production build channel and the production updater feed configured in `mac-app/package.json`.

Experimental builds use the experimental build channel and `mac-app/electron-builder.experimental.json`. Experimental updater access may require maintainer GitHub authentication or `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`. That token is maintainer-only and must not be committed or documented as contributor setup.

The release-channel behavior is implemented in:

- `mac-app/electron/main/buildChannel.ts`
- `mac-app/scripts/check-release-channel.mjs`
- `mac-app/scripts/check-package-safety.mjs`
- `mac-app/electron-builder.experimental.json`

## Publishing a maintainer release

1. Confirm the intended release channel and version.
2. Run the public safety checks.
3. Build/package from `mac-app`.
4. Publish the generated `.dmg`, `.zip`, and updater metadata to the appropriate maintainer release feed.
5. Verify updater behavior from an installed packaged build.

Exact credential locations and maintainer release tokens are intentionally not stored in this repository.

## Troubleshooting

### Packaging fails on a feature branch

The release-channel guard may intentionally block packaging from the wrong branch. This is a release safety check, not a contributor setup failure.

### Auto-updater does not check in development

The updater is for packaged builds. It is not expected to run from normal Vite/Electron development sessions.

### Experimental updater cannot read releases

Experimental builds may require maintainer GitHub authentication. Do not use broad classic personal access tokens for normal development. Prefer maintainer-scoped, least-privilege credentials outside the repository.


