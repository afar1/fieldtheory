# Field Theory Mac 0.3.70 public release

Published October 14, 2026: https://github.com/afar1/field-releases/releases/tag/v0.3.70
Website: https://fieldtheory.dev

The public binary was rebuilt from source commit `34f0d0dd8`, based on the September 27 local 0.3.70 runner compatibility release. It removes the unused node-llama-cpp dependency chain and upgrades Chokidar to 4.0.3, preserving Markdown, HTML, and CSS watcher notifications with literal directory watching and existing extension filters. The source is retained in this isolated checkout; no source-repository publication was part of this release.

Verification: 240 test files passed, 3,617 tests passed and three skipped; both Mac TypeScript checks passed; production dependency audit reported zero vulnerabilities; package/channel/source/public-auth guards passed. The packaged archive excludes braces, simple-git, @simple-git/argv-parser, and node-llama-cpp. Native helper/diarizer builds and packaged SQLite/terminal runtime checks passed. App and DMG signatures, notarization, stapling, Gatekeeper, disk-image integrity, and matching ZIP/DMG payloads were verified.

All five uploaded assets match GitHub SHA-256 digests and sizes. The latest public updater manifest matches the release metadata. Both live website buttons target the new DMG; the promoted website HTML matches the staged source. DMG and ZIP range downloads return HTTP 206.

Website source commit: `9e75b451c` in the isolated ft-0368-website checkout. Production deployment: `dpl_BH8GbYuuUcDJvBye5pTx32iPELUG`, https://fieldtheory-3377boob5-afar1.vercel.app.

Known limits: strict quality-baseline remains nonzero on historical launcher and recording-paste timing samples (launcher load 356.7 ms, hotkey-to-hidden 3,404 ms, filter 86.4 ms, clipboard result 1,259 ms, recording paste 625 ms p95). This release is not a fresh performance qualification or installed-app hotkey/recording acceptance. The previously installed local 0.3.70 was not replaced; it predates these dependency fixes and needs manual reinstall because its version is already 0.3.70.

DMG notarization: `256b490c-81a1-4b47-94a3-a9be5655da1c` — Accepted.

## Published SHA-256 checksums

```text
ba0a3ececbac46fe498c0ea3f4a488d3c83a3690ed1a3c5266a74a18380c202a  Field.Theory-0.3.70-arm64-mac.zip
40468d34c6af2aa9839b04f3ca728cf50d8ebfdd52d56875f89b977d23a525a6  Field.Theory-0.3.70-arm64-mac.zip.blockmap
28bf59fc9a38eb6b3d4ca16d1c9bbc414851ab88f27d501aacae8347fc58ad6c  Field.Theory-0.3.70-arm64.dmg
738a40e406fa70c655d50a53bd6201049267a7bb76aa0c0bfc0e15d9634a60fc  latest-mac.yml
```
