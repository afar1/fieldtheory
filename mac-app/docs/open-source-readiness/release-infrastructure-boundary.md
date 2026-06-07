# Release Infrastructure Boundary

Date: May 31, 2026

This note explains release and updater infrastructure without making it part of normal contributor setup.

**Main point**

Release infrastructure can stay in the public tree if it is clearly labeled as maintainer-only and contains no credentials. Contributors should not need signing certificates, Apple notarization credentials, GitHub release tokens, private updater tokens, production release branches, or release repository write access to build and test the app locally.

**Contributor commands**

Normal local development uses:

- `npm run dev`;
- `npm test`;
- `npm run build`;
- package safety guards such as `npm run guard:package-safety`.

These commands do not publish artifacts and should not require private credentials.

**Maintainer packaging commands**

`npm run package` and `npm run package:experimental` are maintainer packaging commands.

They run release-channel guards, package-safety checks, native/helper builds, Whisper builds, Electron/Vite builds, Electron Builder, signing hooks, notarization hooks, and updater metadata preparation.

If those commands fail on a feature branch, that is expected release protection. It is not a contributor setup failure.

**Production updater**

Production release metadata is configured for GitHub `afar1/field-releases`.

That repository is release infrastructure. A source repository can still use a separate release feed for packaged app artifacts. Contributors do not need write access to it.

**Experimental updater**

Experimental builds use `mac-app/electron-builder.experimental.json` and the experimental build channel.

The experimental feed is marked private in packaging config and can require maintainer GitHub authentication or `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`. That token is maintainer-only and must never be committed.

**Why `private: true` in package.json is okay**

`mac-app/package.json` has `"private": true` because the Mac app package is not intended to be published to npm.

**What remains a release gate**

During release review, maintainers should verify:

- package configs contain no credentials;
- release scripts read secrets only from environment variables or external credential stores;
- production and experimental package safety guards pass;
- updater docs explain why local development does not exercise updater behavior;
- packaged artifacts include the right third-party notices.
