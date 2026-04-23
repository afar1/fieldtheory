# package

Create a local experimental Field Theory Mac build for sharing with a friend.

Do not create a GitHub release, upload release artifacts, push commits, open a PR, or bump the version unless the user explicitly asks for that in the same turn.

## Before packaging

1. Review `git status --short`. If unrelated dirty files are present, say what they are and do not include them in a commit.
2. Run focused tests for touched areas when reasonable.
3. Run `npm run build`.
4. Run the refactor command if it has not already been run for the current work.

## Build

Run `npm run package:experimental`.

This uses `electron-builder.experimental.json`, creates a separate app id (`com.fieldtheory.experimental`), product name (`Field Theory Experimental`), and writes artifacts to `release-experimental/`.

## Share

Give the user the paths to the generated `.dmg` and `.zip` files in `release-experimental/`.

Tell them this is an experimental local build, not an official release. The friend may need to right-click Open the app or approve macOS permissions because this path does not publish a GitHub release or update channel.

## Never do in this command

- Do not run `gh release create`, `gh release upload`, or any GitHub release command.
- Do not run `git push`.
- Do not create a PR.
- Do not publish update manifests.
- Do not edit `latest-mac.yml` for this local friend build.
- Do not bump `package.json` version unless the user explicitly asks.
