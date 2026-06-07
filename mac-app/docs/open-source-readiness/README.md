# Field Theory Mac Project Notes

This directory is a code-derived documentation foundation for the Field Theory Mac app. It does not treat older README drafts, privacy-policy notes, architecture notes, release checklists, or changelogs as current truth. Those documents can be useful historical clues, but the source of truth here is the current code.

The purpose is to make the app legible for developers working on Field Theory. The app already works, so these notes are not a rewrite plan. Refactors should be justified by comprehension, safety, contributor risk, or release risk.

## Documents in this set

- [Repo map](./repo-map.md): where the Mac app lives, which areas are current product surfaces, and which docs or assets need caution.
- [Mac development setup](./mac-development-setup.md): the practical contributor path for installing, running, testing, and building the Mac app locally.
- [Local data paths](./local-data-paths.md): which development runs can touch real local data and what contributors should do before destructive tests.
- [Architecture overview](./architecture-overview.md): how the renderer, Electron main process, preload bridge, local Library, command launcher, auth, sync, River, and release pieces fit together.
- [Architecture diagrams](./architecture-diagrams.md): compact diagrams for renderer/main, local data, account-backed services, and release infrastructure.
- [Privacy and security data flow](./privacy-security-data-flow.md): what the app stores locally, what reaches Supabase, which IPC surfaces are privileged, and what should be documented carefully.
- [Auth session boundary review](./auth-session-boundary-review.md): where full Supabase sessions cross into renderer code and what narrower APIs should replace them later.
- [Supabase account policy review](./supabase-account-policy-review.md): repo-visible evidence for account-backed wording, RLS assumptions, Edge Functions, and remaining live-project verification.
- [Contributor versus maintainer workflows](./contributor-maintainer-workflows.md): which commands are safe for normal development and which require signing, release credentials, private updater access, or release branches.
- [Release infrastructure boundary](./release-infrastructure-boundary.md): why packaging, updater feeds, signing, notarization, and release repositories remain maintainer-only.
- [Refactor decision list](./refactor-decision-list.md): the code and documentation boundaries that are worth cleaning up, grouped by priority.
- [IPC capability map](./ipc-capability-map.md): every renderer global exposed by preload, grouped by capability class and contributor risk.
- [Feature state inventory](./feature-state-inventory.md): which surfaces are public local, account-backed, internal-gated, disabled, experimental, maintainer-only, or dev-only.
- [Asset provenance inventory](./asset-provenance-inventory.md): bundled media/icon/reference voice assets that need source and redistribution confirmation.
- [Secret and private reference audit](./secret-private-reference-audit.md): tracked-file findings and history-aware audit guidance for release review.
- [Dependency and asset follow-up](./dependency-asset-followup.md): remaining provenance, notice, model, and audit follow-up that does not depend on choosing a license.
- [Remaining release decisions](./remaining-publication-decisions.md): human or external release gates that should not be guessed in code.
- [Tier 1 audit](./tier-1-audit.md): what the first readiness pass completed and which release gates require explicit decisions.
- [Tier 2 audit](./tier-2-audit.md): what the architecture and boundary pass completed and which code boundaries are worth further cleanup.
- [Readiness progress](./open-source-readiness-progress.md): current plain-English checklist for non-license readiness work.

## Current Position

Field Theory Mac is local-first, but not local-only. The core Library, editor, clipboard history, command launcher, transcription, bookmarks, and many settings operate on local files and local app data. Login unlocks account-backed features such as feedback, account status, quota or usage checks, public sharing, River shared documents, and any internally enabled sync features.

The important documentation boundary is that Field Theory Cloud, production Supabase internals, billing, deployment config, service secrets, and hosted-service infrastructure are not part of this repository. Maintainer packaging docs are separate from contributor setup because releases depend on signing, notarization, updater feeds, and private maintainer credentials.

## Success Criteria

A new developer should be able to understand:

- what the Mac app does locally;
- where user-authored data and app-managed data live;
- what the renderer can ask Electron main to do;
- which paths touch Supabase;
- which features are local, account-backed, internal, disabled, or experimental;
- how to run and test the app locally;
- why packaging and releases are maintainer-only;
- which cleanup items matter for maintainability and contributor safety.

These notes are useful when those facts are documented from code inspection and follow-up work is concrete rather than a vague wish to make the codebase prettier.
