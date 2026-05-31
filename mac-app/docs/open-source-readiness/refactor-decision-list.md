# Refactor Decision List

This list is for preparing Field Theory Mac for open source. It is not an aesthetic cleanup list. Each item should protect public comprehension, safety, contributor experience, privacy accuracy, or release reliability while keeping the app working.

## Tier 1: should do before public release

### Replace contradictory public docs

Problem: root `README.md`, root `LICENSE`, `mac-app/README.md`, `mac-app/PRIVACY_POLICY.md`, `mac-app/docs/ARCHITECTURE.md`, and release docs tell conflicting stories about whether the project is proprietary, open source, local-only, iOS-sync-only, private-source, or public.

Decision: write clean replacements from the current code map. Do not patch the stale docs line by line.

Verification: a fresh reader can answer what the app is, how to run it, what data it stores, what uses Supabase, what is maintainer-only, and what the license is.

### Choose and apply a license model

Problem: the repository currently has a proprietary license while some app docs already say open source.

Decision: choose the license for source, docs, assets, bundled resources, and any separately licensed models or media. The app code license may not automatically cover sounds, images, icons, reference voices, or downloaded models.

Verification: root license and notices match the actual intended public terms.

### Add `.env.example`

Problem: `mac-app/README.md` references `.env.example`, but it is missing.

Decision: add a non-secret `mac-app/.env.example` that explains optional Supabase/account configuration and clearly separates public config from secrets.

Verification: following setup docs does not require guessing environment variable names.

### Rewrite privacy and security docs from current data flow

Problem: current privacy text is stale. Supabase is used by more than iOS sync, and Supabase sessions are file-backed rather than Keychain-backed.

Decision: document local data locations, clipboard history, Supabase behavior, River, internal sync gates, account deletion scope, and privileged IPC.

Verification: every claim in public privacy/security docs maps to current code or an explicit product decision.

### Audit secrets and public credentials

Problem: public release requires more than checking current tracked files. History, release scripts, docs, and config need a secret review.

Decision: run a tracked-file and history-aware secret audit before publishing. Treat Supabase publishable keys as public config, but verify no service role keys, Apple credentials, GitHub tokens, private updater tokens, signing materials, or personal secrets are present.

Verification: audit output is recorded, reviewed, and any findings are rotated or removed.

### Clarify account-backed versus local-only behavior

Problem: contributors will not know which features should work without login and which require Supabase/account access.

Decision: document local-first defaults and account-backed features. Make internal-gated sync, command mobile sync, and disabled shared clipboard explicit.

Verification: public setup docs do not imply that internal or disabled features are broken contributor setup.

### Third-party notices and asset provenance

Problem: assets and dependencies do not yet have a public notices story.

Decision: create third-party notices for npm dependencies, WebRTC VAD, native/helper dependencies, model terms, sounds, images, icons, logos, and reference voice assets.

Verification: every bundled non-original or separately licensed asset has a source and allowed use recorded.

### Address high and critical production dependency audit findings

Problem: `npm audit --omit=dev --audit-level=high` currently reports high and critical findings.

Decision: triage and fix or document each production audit finding before public release.

Verification: audit passes or there is an explicit accepted-risk note with rationale and mitigation.

## Tier 2: should do to make the public codebase understandable

### Split the main-process integration boundary

Problem: `mac-app/electron/main/index.ts` is very large and owns many unrelated concerns.

Decision: move toward clearer feature modules for IPC registration, auth/account, Library, River/sync, shell/OS, clipboard, commands, agents/terminal, updater, and windows. Do this incrementally, with tests around moved handlers.

Verification: a contributor can find the owner of a privileged IPC handler without reading the entire integration file.

### Generate or maintain an IPC capability map

Problem: `preload.ts` exposes many globals, and there is no concise public contract for what each renderer capability can do.

Decision: create a maintained IPC/capability map. It can start as documentation and later become generated from typed channel definitions.

Current state: the first documentation map exists in [IPC capability map](./ipc-capability-map.md). The remaining refactor is to keep it checked against preload exports or generate it from typed channel definitions.

Verification: every exposed API is categorized as local read, local write, OS integration, process execution, auth/session, cloud, updater, or disabled/internal.

### Separate public, internal, experimental, and disabled features

Problem: contributors will see shared clipboard, mobile transcript sync, internal sync, River, todos, social feedback, experimental updater, and agent features in the same codebase.

Decision: name feature states explicitly in code and docs. Prefer central feature flags or policy modules over scattered checks.

Current state: the first documentation inventory exists in [Feature state inventory](./feature-state-inventory.md). The remaining refactor is to centralize these names in code.

Verification: grep-able names explain whether a feature is public, internal, disabled, or experimental.

### Tighten auth/session boundaries

Problem: some IPC paths can return session material to the renderer. That may be intentional, but it deserves a clear boundary.

Decision: review every auth/session IPC path and document or narrow what crosses into renderer code.

Verification: token-bearing data has a known reason to cross the boundary, and non-token account metadata uses a separate safer path where possible.

### Make local data paths contributor-safe

Problem: development runs can mutate a real `~/.fieldtheory` Library and real Electron user data.

Decision: document and, if practical, add first-class dev/test path overrides for Library and userData.

Verification: contributors can run experiments without touching a maintainer's real Library.

### Reduce public confusion around release infrastructure

Problem: production release, experimental release, private updater access, public release feed, branch guards, and notarization are interleaved.

Decision: separate contributor build docs from maintainer release docs and consider moving release policy into a small dedicated module.

Verification: package failures on feature branches are understood as release guards, not setup failures.

### Add dependency/license automation

Problem: public readiness needs repeatable notice generation, not manual memory.

Decision: add a command or documented process that produces dependency license output and flags missing license metadata.

Verification: notices can be refreshed before each public release.

## Tier 3: nice to have after the public baseline is honest

### Break down the largest renderer components

Problem: files such as `LibrarianView.tsx` and `ClipboardHistory.tsx` are difficult to review.

Decision: split by behavior only when it improves testability or contributor comprehension.

Verification: no behavior changes, tests still cover the moved pieces, and the main user workflows remain fast.

### Improve architecture diagrams

Problem: new contributors will benefit from visuals once the text docs are stable.

Decision: add diagrams for renderer/main/preload, local data, Supabase/River, and packaging.

Verification: diagrams match code and are updated with the docs.

### Add contributor fixtures and local-only demo mode

Problem: contributors need safe sample data.

Decision: provide sample Library, sample Commands, and optional local-only startup paths.

Verification: a new contributor can explore the app without logging in or using personal data.

### Add public issue labels and contribution paths

Problem: public contributors need safe first issues and clear boundaries.

Decision: label docs-only, setup, tests, accessibility, and architecture-map issues separately from maintainer-only release work.

Verification: public issues do not invite work on credentials, private release feeds, or ambiguous product surfaces.

## Non-goals

- Do not rewrite working product code merely because it is large.
- Do not block open source on perfect component boundaries.
- Do not document aspirational privacy behavior as current behavior.
- Do not make packaging look contributor-required.
- Do not expose maintainer credentials, release tokens, private updater access, or signing assumptions as normal setup steps.
