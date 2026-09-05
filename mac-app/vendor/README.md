# Bundled bookmark sync CLI

`fieldtheory-1.3.23-local.1.tgz` is the local npm package produced from
`afar1/fieldtheory-cli` commit `12549ac253360d2b56a7c4b7596203a65373590c`.
Its SHA-256 is `e43d9f38702049507991620e996d43a4bf454763bf94da47d28cc0c1744acc6a`.
The package includes its MIT license. It has not been published to npm.

The application uses this pinned dependency for quick bookmark checks, so a
manual DMG installation does not require updating the global CLI. Quick checks
have a three-page/15-second network budget and preserve a separate catchup queue.
Media and search indexing run as deferred, low-priority, time-bounded subprocesses.
Index maintenance still rebuilds the full local search database; it is not part
of the frequent freshness check.

To update, build and test the CLI, run `npm pack`, replace the archive, and run
`npm install --ignore-scripts ./vendor/fieldtheory-<version>.tgz` in `mac-app`.
Update this provenance record and commit the archive with its lockfile.
