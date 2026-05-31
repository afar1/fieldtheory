# Field Theory Mac Open Source Readiness

This directory is a fresh, code-derived documentation foundation for preparing the Field Theory Mac app for a public repository. It does not treat the existing README, privacy policy, architecture notes, release checklist, or changelog as current truth. Those older documents are useful historical clues, but the source of truth for this pass is the current code.

The immediate purpose is to make the app legible before making Tier 1 public decisions about security documentation, privacy language, setup promises, licensing, and release policy. The app already works, so this pass is not a rewrite plan. Refactors should be justified by public comprehension, safety, contributor risk, or release risk.

## Documents in this set

- [Repo map](./repo-map.md): where the Mac app lives, which areas are current product surfaces, and which docs or assets need caution.
- [Mac development setup](./mac-development-setup.md): the practical contributor path for installing, running, testing, and building the Mac app locally.
- [Architecture overview](./architecture-overview.md): how the renderer, Electron main process, preload bridge, local Library, command launcher, auth, sync, River, and release pieces fit together.
- [Privacy and security data flow](./privacy-security-data-flow.md): what the app stores locally, what reaches Supabase, which IPC surfaces are privileged, and what should be documented carefully.
- [Contributor versus maintainer workflows](./contributor-maintainer-workflows.md): which commands are safe for normal development and which require signing, release credentials, private updater access, or release branches.
- [Refactor decision list](./refactor-decision-list.md): the code and documentation boundaries that should be cleaned up before a public release, grouped by priority.
- [IPC capability map](./ipc-capability-map.md): every renderer global exposed by preload, grouped by capability class and contributor risk.
- [Feature state inventory](./feature-state-inventory.md): which surfaces are public local, account-backed, internal-gated, disabled, experimental, maintainer-only, or dev-only.
- [Asset provenance inventory](./asset-provenance-inventory.md): bundled media/icon/reference voice assets that need source and redistribution confirmation.
- [Tier 1 audit](./tier-1-audit.md): what the first public-readiness pass completed and which public-release gates still require explicit decisions.
- [Tier 2 audit](./tier-2-audit.md): what the architecture and boundary pass completed and which code boundaries still need cleanup.
- [Tier 2 progress](./tier-2-progress.md): current plain-English checklist for the active Tier 2 code slice.

## Current public-readiness position

Field Theory Mac is local-first, but not local-only. The core Library, editor, clipboard history, command launcher, transcription, bookmarks, and many settings operate on local files and local app data. Login unlocks account-backed features such as feedback, account status, quota or usage checks, public sharing, River shared documents, and any internally enabled sync features.

The main public documentation problem is not that the app lacks code. It is that the public story is stale or contradictory. The root README and LICENSE currently describe the project as proprietary, while `mac-app/PRIVACY_POLICY.md` already uses open-source language. `mac-app/README.md` points at a missing `.env.example`. Release docs still describe a private source repository and separate public release repository. Those documents should be replaced or rewritten from this foundation before the repo is presented publicly.

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
