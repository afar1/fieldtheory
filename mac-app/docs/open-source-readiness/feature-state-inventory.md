# Feature State Inventory

This inventory separates current product surfaces by public state. It is meant to reduce contributor confusion when the public repository contains working local features, account-backed features, internal gates, disabled compatibility APIs, and experimental surfaces at the same time.

The most important rule is simple: do not call something broken just because it is not a default public feature. Some code is intentionally inert, gated, or maintainer-only.

## State labels

| State | Meaning |
| --- | --- |
| Public local default | Should work in local development without login, signing credentials, private release access, or maintainer-only environment variables. |
| Account-backed public | Product surface that can exist in public code, but requires Supabase auth or public account configuration to be useful. |
| Internal-gated | Code exists, but is gated by an internal flag, maintainer policy, or account/server behavior. It should not be promised as a default public feature. |
| Disabled/stubbed | Exposed for compatibility or UI shape, but intentionally returns inert values. |
| Experimental | Present in code and possibly useful, but not ready to explain as a stable public feature. |
| Maintainer-only | Release, signing, updater, or packaging flow that public contributors do not need for normal development. |
| Dev-only | Debug, simulator, scenario, or diagnostics flow that should not be described as product behavior. |

## Current feature states

| Feature | Current state | Code pointers | Public documentation stance |
| --- | --- | --- | --- |
| Library and markdown editor | Public local default | `mac-app/src`, `mac-app/electron/main/fieldTheoryPaths.ts`, `mac-app/electron/main/index.ts`, `libraryAPI`, `wikiAPI`, `externalAPI` | Core local product surface. Document Library path behavior and write gates clearly. |
| Field Theory Library paths | Public local default | `mac-app/electron/main/fieldTheoryPaths.ts` | `~/.fieldtheory/library`, `Commands`, `bookmarks`, `ideas`, `River (shared)`, and `Conflicts` should be documented as current path truth. |
| External markdown files | Public local default with care | `externalAPI`, `external:*` handlers | Explain that absolute paths are handled by main and should remain guarded. |
| Markdown images and sketches | Public local default | `markdownImagesAPI`, Library/editor components | Local media behavior should be documented as file-backed Library behavior. |
| Local commands and command launcher | Public local default with care | `commandsAPI`, `commands:*` handlers, `mac-app/electron/main/types/commands.ts` | Core product surface. Explain that commands may mutate active documents and run local workflows through main-owned handlers. |
| Clipboard history | Public local default with permissions | `clipboardAPI`, `clipboardManager.ts`, `clipboard.db` | Works locally. Requires clear privacy language because it stores copied text/images and touches macOS clipboard/paste APIs. |
| Screenshots and Continuous Context | Public local default with permissions | `clipboardAPI`, `ClipboardIPCChannels` | Requires screen recording permission. Document as local capture and local clipboard/history behavior unless account-backed features are explicitly used. |
| Transcription and voice input | Public local default with permissions | `transcribeAPI`, `audioAPI`, transcription setup handlers | Requires microphone permission and local engine/model setup. Docs should distinguish app setup from optional model downloads. |
| Word substitutions and app voice aliases | Public local default | `clipboardAPI`, preferences | Local preferences. Safe to document as normal app configuration. |
| Bookmarks | Public local default | `bookmarksAPI`, Field Theory bookmark paths | Local bookmark data under `~/.fieldtheory/bookmarks`, with legacy fallback where applicable. |
| Possible and ideas | Public local/default advanced | `possibleAPI`, `~/.fieldtheory/ideas` | Present as an advanced local Field Theory surface, not as required app setup. |
| Tagged docs | Public local default | `taggedDocsAPI`, `tagged.db` | Local tagging/indexing surface. |
| Onboarding | Public local default | `onboardingAPI`, `onboardingWindow.ts`, preferences | First-run permission and setup flow. |
| Global hotkeys | Public local default with permissions | `hotkeyAPI`, clipboard preferences | Document as macOS integration that may require accessibility permissions depending on behavior. |
| Shell open/reveal behavior | Public local default with checks | `shellAPI`, `shellIpc.ts`, `shell:openExternal` | `openExternal` is scheme-limited to `http:`, `https:`, `mailto:`, and `x-apple.systempreferences:`. Other shell actions should stay explicit. |
| Auth | Account-backed public | `authAPI`, `authManager`, `supabase-session.json` | Public setup can run without login, but account-backed features need Supabase config and an account. |
| Account status | Account-backed public | `accountAPI`, `account:*` handlers | Safer account metadata surface than full session access. |
| Quotas and usage limits | Account-backed public | `quotaAPI`, `quota:*` handlers | Account-backed feature limits. Explain that local dev may not exercise these without Supabase. |
| Metrics sync | Account-backed public with privacy note | `metricsAPI`, `user-metrics.json`, `metrics:*` handlers | Local metrics exist; sync/fetch are cloud-backed. Privacy docs must state this clearly. |
| Feedback and social feedback | Account-backed public | `socialAPI`, Supabase feedback behavior | Cloud-backed. Keep privacy language explicit. |
| River shared documents | Account-backed public | `sharedFilesAPI`, `teamAPI`, `sharedSyncService.ts`, `sharedTeamService.ts` | Current public collaboration feature. Do not conflate with full private Library sync. |
| Full Library sync | Internal-gated | `fieldTheorySyncAPI`, `releaseSyncPolicy.ts`, `preferences.ts` | Code exists but should not be promised as default public behavior. Gate names include `FIELD_THEORY_INTERNAL_SYNC_ENABLED` and `FIELD_THEORY_INTERNAL_SYNC`. |
| Command/mobile sync | Internal-gated | command sync handlers, `releaseSyncPolicy.ts` | Treat as internal until public policy and docs exist. |
| Tasks tab and todos | Experimental/internal | `todoAPI`, `preferences.ts`, preload comments | The Tasks tab is hidden by default and marked experimental. Do not present as stable public setup. |
| Mobile transcript sync into clipboard history | Disabled/stubbed | `clipboardAPI` sync methods in `preload.ts` | Preload methods intentionally return inert values. `clipboard:getSyncSession` remains in old type definitions but no active handler was found in `main/index.ts`. |
| Shared clipboard | Disabled/stubbed | `sharedClipboardAPI` in `preload.ts` | Team clipboard item sync is hard-disabled and returns empty/null values. Do not document as available. |
| Agent kickoff | Experimental/advanced | `agentKickoffAPI`, `agent:*` handlers | Local agent workflow surface. Document as advanced, not required setup. |
| Agent improve | Experimental/advanced | `agentImproveAPI`, `agent-improve:*` handler | Local agent-assisted improvement flow. Needs process/file-boundary language before broad contribution. |
| Agent hooks | Dev/advanced | `agentHooksAPI`, `agent-hooks:*` handlers | Installs/uninstalls Claude/Codex hooks. Keep out of basic setup. |
| Codex terminal | Dev/advanced | `codexTerminalAPI`, `codexTerminalManager.ts` | PTY sessions, terminal input, history previews, clipboard access, and page context attach. Public docs should mark it advanced. |
| Claude and Cursor integrations | Dev/advanced | `claudeAPI`, `cursorAPI` | Local tooling integrations. Not required for normal app setup. |
| Hot Mic for Codex terminals | Experimental/advanced | `hotMicAPI` | Continuous voice input for Codex terminal workflows. |
| Gaze surfaces | Experimental | `gazeAPI`, gaze preload files | Present in code. Needs a separate readiness note before being advertised. |
| Squares | Experimental | `squaresAPI` | Present in preload. Product status should be clarified before public release. |
| Scenario and auth simulator | Dev-only | `scenarioAPI`, `authAPI.simulateState`, `authAPI.resetSimulator` | Useful for testing and demos. Do not describe as user-facing product behavior. |
| Diagnostics and debug logs | Dev-only with privacy caution | `diagnosticsAPI` | Good contributor support surface. Warn contributors not to paste logs containing local paths or document contents into public issues. |
| Production updater | Maintainer-only in packaged builds | `updaterAPI`, `buildChannel.ts`, `electron-updater` setup | Local development does not require updater behavior. |
| Experimental updater | Maintainer-only | `buildChannel.ts`, `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`, `electron-builder.experimental.json` | Requires GitHub auth or private token for `afar1/oscar` release assets. Do not include in contributor setup. |
| Packaging, signing, notarization | Maintainer-only | `mac-app/package.json`, `mac-app/scripts`, Electron Builder configs | Public contributors can build/test locally without signing or release credentials. |
| Stripe upgrade links | Account-backed public config | `stripeConfig` in `preload.ts` | Live links are public configuration. License/open-source docs should decide whether they stay in public builds. |

## Specific boundary notes

**Public local does not mean no permissions**

Clipboard history, screenshots, paste automation, transcription, audio devices, hotkeys, onboarding, and shell integration all work locally, but they touch macOS privacy or OS integration surfaces. Public docs should say which permissions unlock which workflows.

**Account-backed does not mean secret-backed**

Supabase publishable keys and Stripe links are public client configuration. They are not service-role secrets. The security boundary is auth, row-level security, Edge Functions, server-side checks, and release credentials.

**Internal-gated should become grep-able**

`releaseSyncPolicy.ts` is a good start for full Library sync. The same pattern should be used for other internal or experimental features so contributors can search for one policy name instead of reading scattered `if` checks.

**Disabled/stubbed APIs should be honest**

The public repository can keep inert APIs for renderer compatibility, but the docs should say they are intentionally disabled. Otherwise contributors will waste time trying to repair behavior that is deliberately off.

## Refactor recommendation

Add a small central feature-state module before making broad code moves. It should not change behavior. It should give stable names to product states:

- `publicLocal`
- `accountBacked`
- `internalGated`
- `disabled`
- `experimental`
- `maintainerOnly`
- `devOnly`

That module can start as metadata used by docs/tests. Later, feature owners can import it where runtime checks are currently scattered.
