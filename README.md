# Field Theory

Field Theory is a local-first macOS application for human and agentic reading and writing. It is designed to make context management fast, local, and portable between model providers, with local voice transcription, clipboard management, portable Markdown commands and skills, and extraction, storage, and local retrieval of X bookmarks.

The Mac app DMG can be downloaded and used for free at [fieldtheory.dev](https://fieldtheory.dev). All accounts are free.

## Project Status

This is the Field Theory app source repository, seeded from the cleaned Field Theory development history and developed by Andrew Farah (`afar1`).

The Field Theory repository family uses AGPL-3.0-or-later and MIT licenses unless a file or directory says otherwise.

- AGPL: open source, including for commercial purposes. You may use, run, fork, modify, and redistribute the code, including commercially, under the license terms. If you modify Field Theory and offer it as a network service, AGPL requires you to provide the corresponding source for those modifications to users of that service.
- MIT: permissive open source.

## Repository Family

Field Theory is split across sibling repositories:

- [`afar1/fieldtheory`](https://github.com/afar1/fieldtheory): Mac app source repository, licensed under AGPL-3.0-or-later.
- [`afar1/fieldtheory-cli`](https://github.com/afar1/fieldtheory-cli): public CLI repo, licensed under MIT.
- [`afar1/fieldtheory-plugin`](https://github.com/afar1/fieldtheory-plugin): plugin ecosystem repo, licensed under MIT.
- [`afar1/field-releases`](https://github.com/afar1/field-releases): public binary release feed.

This repo is the public-facing app source repository. It is not the full private history archive.

**Screens**
Native editor (file over app)
![Image](<docs/readme-assets/sha256-134f1a235aac54706082cd537335af0bfca3a439823745eb645b809d5c5f25fa.png>)
Local X bookmark storage and viewer
![Image](<docs/readme-assets/sha256-4557fa112d2d6257a2b14d644b9a6b6cecd0668735e9a6f3b100924066ac91ad.png>)
Integrated terminal for collaborative writing with  Codex, Claude, and local models like Gemma
![Image](<docs/readme-assets/sha256-455ba5eda3414c74f91fe713a02d6679b546fc35379a3caee18d5718bfa3118a.png>)
Multiple windows for comparative reaading
![Image](<docs/readme-assets/sha256-3188053d1ea25d09a31364e9c6728e48202a8347b89e908f006a389e86762d92.png>)
Context launcher (shift command k) allows you to deploy md docs, bookmarks, or clipboard items into any front most application
![Image](<docs/readme-assets/sha256-c22ac739d97525e4a6f97322bfd42fe405a035adbe9b17b0dea952f3b34b607a.png>)
Emojis in editor
![Image](<docs/readme-assets/sha256-a59a42ac0aa59420851b8afe13459c1e8d7b1fcbf12551a2ea27c7278be87bfd.png>)
Use any markdown file as custom local command
![Image](<docs/readme-assets/sha256-34fb41d3fab39267ba936fdd6f8d9810f72218589df2318f9c44a0495f6d8c11.png>)
Fast, offline local voice transcription and context stacking (screenshots taken while you transcribe paste with transcript)
![Image](<docs/readme-assets/sha256-25aee721e0dde1b9e1bb6e298ecdec4afdc58717dbd29809fcd3bd6b0c2ea119.png>)
Priority mic so your audio doesn't cut out when starting a transcription
![Image](<docs/readme-assets/sha256-9537226e901b46865d6d783cdf0d75004bf85308601ccc10089f1c0302ebff63.png>)
Full clipboard manager with gmail-style shortcuts (j/k/s = stack/ u = unstack). All local
![Image](<docs/readme-assets/sha256-600349c06e967f7f4ce8561eda3970ea4261ac70fe1ffdcbc2cbd8521d1e5b10.png>)


## History And Attribution

See [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and third-party notice tracking.

## Public Source Boundary

This repo is intended to contain app source, local development docs, public governance docs, and public-facing architecture material.

It intentionally excludes production backend internals:

- production Supabase schema;
- Supabase migrations;
- Supabase edge functions;
- billing and service internals;
- production Cloud configuration;
- private operational runbooks;
- hosted website/API route internals.

People can read, run, fork, modify, and self-host Field Theory under the AGPL terms.

This source release does not include the production Field Theory Cloud backend, Supabase production internals, billing infrastructure, deployment configuration, or service secrets. Field Theory Cloud remains the official hosted service operated by Field Theory.

## Where to Start

- [Mac app README](mac-app/README.md): local development setup for the active Mac app.
- [Mac app architecture](mac-app/docs/ARCHITECTURE.md): code-oriented map of the Electron app.
- [Mac release workflow](mac-app/docs/RELEASE_WORKFLOW.md): maintainer packaging and release process.
- [Privacy policy](mac-app/PRIVACY_POLICY.md): current Mac data-flow policy.
- [Security policy](SECURITY.md): security reporting and sensitive-surface guidance.
- [Third-party notices](THIRD_PARTY_NOTICES.md): dependency, model, and asset notice tracking.
- [Architecture sketch](arch.md): useful historical map, but verify against code when accuracy matters.

## Repository Shape

The active product center is `mac-app/`, an Electron + Vite + React macOS app.

Important Mac app areas:

- `mac-app/src`: renderer UI.
- `mac-app/electron/preload.ts`: renderer capability bridge.
- `mac-app/electron/main`: privileged main-process code, IPC handlers, local data access, auth, sync, River, updater, and OS integration.
- `mac-app/scripts`: development, build, native setup, packaging, and release helper scripts.
- `mac-app/resources` and `mac-app/public`: packaged resources and static assets.

The public repository keeps the Mac app and supporting project documents at the top level. Archived mobile experiments and vendored Whisper sources are intentionally excluded.

## Local Development

For the Mac app:

```bash
cd mac-app
npm ci
npm run dev
```

Local verification:

```bash
npm run typecheck
npm test
npm run build
```

See [mac-app/README.md](mac-app/README.md) for details.

## Local-First, Not Local-Only

Core Mac app workflows can run without login. The app also has account-backed surfaces, including auth, feedback, account/quota checks, metrics, public sharing, River shared documents, and internally gated sync features.

## License

Field Theory-owned app/source code in this repository is licensed under [AGPL-3.0-or-later](LICENSE).

You can use, run, fork, modify, and redistribute the code, including commercially, under the license terms. If someone modifies Field Theory and offers it as a network service, the AGPL requires them to provide the corresponding source for those modifications to users of that service.

The repo family uses a split-license model:

- [`afar1/fieldtheory`](https://github.com/afar1/fieldtheory): AGPL-3.0-or-later for Field Theory-owned app/source code.
- [`afar1/fieldtheory-cli`](https://github.com/afar1/fieldtheory-cli): MIT.
- [`afar1/fieldtheory-plugin`](https://github.com/afar1/fieldtheory-plugin): MIT.
- Examples and protocol docs: MIT unless they are tightly app-coupled.
- Brand assets: trademark protected.

The code license does not grant rights to the Field Theory name, logo, icon, brand, official Cloud service identity, or other trademarks. See [TRADEMARKS.md](TRADEMARKS.md).
