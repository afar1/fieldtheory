# Bundled bookmark sync CLI

`fieldtheory-1.3.23-local.1.tgz` is the local npm package produced from
`afar1/fieldtheory-cli` commit `12549ac253360d2b56a7c4b7596203a65373590c`.
Its SHA-256 is `e43d9f38702049507991620e996d43a4bf454763bf94da47d28cc0c1744acc6a`.
The package includes its MIT license. It has not been published to npm.

The application uses this pinned dependency for quick bookmark checks, so a
manual DMG installation does not require updating the global CLI. The CLI and its
JavaScript/WASM dependencies are unpacked beside the app archive so the worker
uses ordinary filesystem paths. Quick checks
have a three-page/15-second network budget and preserve a separate catchup queue.
Media and search indexing run as deferred, low-priority, time-bounded subprocesses.
Index maintenance still rebuilds the full local search database; it is not part
of the frequent freshness check.

To update, build and test the CLI, run `npm pack`, replace the archive, and run
`npm install --ignore-scripts ./vendor/fieldtheory-<version>.tgz` in `mac-app`.
Update this provenance record and commit the archive with its lockfile.

## App-only connection transport (local.2)

`fieldtheory-1.3.23-local.2.tgz` derives from local.1 above using the checked-in
`mac-app/scripts/vendor/patch-bookmark-stdin.cjs` patch. It adds bounded credential
input over stdin and structured authentication failures for the dedicated app X
session. The app requires this capability before syncing, never places session
cookies in command arguments, and never falls back to browser extraction.
`fetch-media --json` and `index --json` operate on cached bookmark records and
public asset URLs; neither resolves browser credentials. This package has not
been published to npm or the standalone CLI repository.

Local.2 SHA-256: `c651a97bc95b3c9f0609a9a104254fdd9fd46f5f6ba7e24640ab0a8e959cdf04`.
Run `node mac-app/scripts/vendor/verify-bookmark-stdin.cjs` to exercise the
extracted archive with credential subprocesses forbidden and fake HTTP 401.
