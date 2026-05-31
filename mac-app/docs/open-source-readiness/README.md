# Field Theory Mac Open Source Readiness

This directory is a fresh, code-derived documentation foundation for preparing the Field Theory Mac app for a public repository. It does not treat the existing README, privacy policy, architecture notes, release checklist, or changelog as current truth. Those older documents are useful historical clues, but the source of truth for this pass is the current code.

The immediate purpose is to make the app legible before making Tier 1 public decisions about security documentation, privacy language, setup promises, licensing, and release policy. The app already works, so this pass is not a rewrite plan. Refactors should be justified by public comprehension, safety, contributor risk, or release risk.

## Documents in this set

- [Repo map](./repo-map.md): where the Mac app lives, which areas are current product surfaces, and which docs or assets need caution.
- [Mac development setup](./mac-development-setup.md): the practical contributor path for installing, running, testing, and building the Mac app locally.
- [Local data paths](./local-data-paths.md): which development runs can touch real local data and what contributors should do before destructive tests.
- [Architecture overview](./architecture-overview.md): how the renderer, Electron main process, preload bridge, local Library, command launcher, auth, sync, River, and release pieces fit together.
- [Privacy and security data flow](./privacy-security-data-flow.md): what the app stores locally, what reaches Supabase, which IPC surfaces are privileged, and what should be documented carefully.
- [Auth session boundary review](./auth-session-boundary-review.md): where full Supabase sessions cross into renderer code and what narrower APIs should replace them later.
- [Supabase account policy review](./supabase-account-policy-review.md): repo-visible evidence for account-backed wording, RLS assumptions, Edge Functions, and remaining live-project verification.
- [Contributor versus maintainer workflows](./contributor-maintainer-workflows.md): which commands are safe for normal development and which require signing, release credentials, private updater access, or release branches.
- [Release infrastructure boundary](./release-infrastructure-boundary.md): why packaging, updater feeds, signing, notarization, and release repositories remain maintainer-only.
- [Refactor decision list](./refactor-decision-list.md): the code and documentation boundaries that should be cleaned up before a public release, grouped by priority.
- [IPC capability map](./ipc-capability-map.md): every renderer global exposed by preload, grouped by capability class and contributor risk.
- [Feature state inventory](./feature-state-inventory.md): which surfaces are public local, account-backed, internal-gated, disabled, experimental, maintainer-only, or dev-only.
- [Asset provenance inventory](./asset-provenance-inventory.md): bundled media/icon/reference voice assets that need source and redistribution confirmation.
- [Secret and private reference audit](./secret-private-reference-audit.md): current tracked-file findings and required history-aware audit before publication.
- [Dependency and asset follow-up](./dependency-asset-followup.md): remaining provenance, notice, model, and audit follow-up that does not depend on choosing a license.
- [Tier 1 audit](./tier-1-audit.md): what the first public-readiness pass completed and which public-release gates still require explicit decisions.
- [Tier 2 audit](./tier-2-audit.md): what the architecture and boundary pass completed and which code boundaries still need cleanup.
- [Open source readiness progress](./open-source-readiness-progress.md): current plain-English checklist for the active non-license readiness work.

## Current public-readiness position

Field Theory Mac is local-first, but not local-only. The core Library, editor, clipboard history, command launcher, transcription, bookmarks, and many settings operate on local files and local app data. Login unlocks account-backed features such as feedback, account status, quota or usage checks, public sharing, River shared documents, and any internally enabled sync features.

The main remaining public documentation problem is not that the app lacks code. It is that the final license story is still deferred. The root README and Mac docs now describe the repository as an open-source candidate, but the root `LICENSE` remains proprietary until a human license decision is made. Maintainer packaging docs are separate from contributor setup because releases still depend on signing, notarization, updater feeds, and private maintainer credentials.

## Success criteria for this pass

A new developer should be able to understand:

- what the Mac app does locally;
- where user-authored data and app-managed data live;
- what the renderer can ask Electron main to do;
- which paths touch Supabase;
- which features are local, account-backed, internal, disabled, or experimental;
- how to run and test the app locally;
- why packaging and releases are maintainer-only today;
- which cleanup items matter before the repository becomes public.

This pass is complete when those facts are documented from code inspection and the remaining work is a concrete decision list rather than a vague wish to make the codebase prettier.
