# Tier 2 Audit

Tier 2 is the architecture and boundary pass. Its job is to make the current Mac app understandable enough that the project docs can be honest. It does not require rewriting the app.

## Completed in this pass

- Added an IPC capability map for every main `contextBridge.exposeInMainWorld` global in `mac-app/electron/preload.ts`.
- Added secondary preload coverage for auxiliary windows such as toast, overlay, cursor status, dynamic island, and gaze overlays.
- Added a feature-state inventory that separates public local, account-backed public, internal-gated, disabled/stubbed, experimental, maintainer-only, and dev-only surfaces.
- Documented the token-bearing `authAPI.getSession` boundary as an explicit auth/session concern.
- Documented absolute-path markdown editing through `externalAPI` as a privileged main-process file surface.
- Documented local process and terminal surfaces as advanced behavior rather than required contributor setup.
- Documented disabled mobile transcript sync and shared clipboard behavior as intentionally inert, not broken setup.
- Documented the experimental updater and packaging paths as maintainer-only.
- Added dependency license summary automation during the release-readiness pass with `npm run license:summary`.
- Extracted the shell IPC handler family into `mac-app/electron/main/shellIpc.ts` with focused coverage for all three public `shell:*` channels.
- Extracted the account status IPC handler family into `mac-app/electron/main/accountIpc.ts` with focused coverage for both public `account:*` invoke channels.
- Extracted the Field Theory sync IPC handler family into `mac-app/electron/main/fieldTheorySyncIpc.ts` with focused coverage for both public `fieldTheorySync:*` invoke channels.
- Extracted the metrics IPC handler family into `mac-app/electron/main/metricsIpc.ts` with focused coverage for local metrics reads and Supabase sync/fetch invocations.
- Extracted the quota IPC handler family into `mac-app/electron/main/quotaIpc.ts` with focused coverage for quota reads, feature-name mapping, tier refresh, and renderer broadcasts.

## Code observations

`mac-app/electron/main/index.ts` still owns too many unrelated IPC registrations. That is not automatically a release blocker, but it is the main contributor comprehension problem. The shell, account, Field Theory sync, metrics, and quota handler families have moved out, but a new contributor still has to scan one very large integration file to find auth, River, commands, clipboard settings, updater behavior, and agent surfaces.

`mac-app/electron/preload.ts` is the real public capability surface. It is large, but it is also useful because it gives one place to see what the renderer can request. The new IPC map should be treated as a bridge between current code and a future generated contract.

`releaseSyncPolicy.ts` is a good pattern. It gives internal sync a named policy boundary instead of hiding the decision in UI code. Other internal, experimental, disabled, and maintainer-only features should move toward this style.

`auth:getSession` returns the current Supabase session to renderer code. That may be required today, but it is exactly the kind of boundary project docs should call out. Future code should prefer smaller account metadata APIs when full token-bearing session data is not needed.

`clipboard:getSyncSession` still appears in `mac-app/electron/main/types/clipboard.ts`, but no active `ipcMain.handle('clipboard:getSyncSession', ...)` handler was found in `mac-app/electron/main/index.ts`. The active preload mobile transcript sync methods return inert values. The type definition should be cleaned up or marked legacy in a later code pass.

## Recommended Tier 2 code follow-up

Do these as narrow behavior-preserving PRs:

1. Move one IPC owner at a time out of `main/index.ts`.
2. Keep channel names unchanged.
3. Add or keep focused tests around the moved handler group.
4. Update `ipc-capability-map.md` in the same PR.

Continue with the remaining low-risk owner modules:

- `registerUpdaterIpc`, because contributor-versus-maintainer docs already separate it from local development.

Then move the higher-complexity owners:

- `registerExternalMarkdownIpc`
- `registerCommandLauncherIpc`
- `registerRiverIpc`
- `registerAuthIpc`
- `registerClipboardIpc`
- `registerAgentIpc`

## Remaining Tier 2 gaps

- Most main-process IPC registration is still physically concentrated in `main/index.ts`.
- Feature state is documented but not centralized in code.
- Auth/session access is documented but not narrowed.
- Contributor-safe development data paths are documented as a need, but no first-class path override was added.
- Release infrastructure is documented as maintainer-only, but production and experimental packaging code are still close together.
- The IPC map is manual. It should eventually be generated or checked against preload exports.

## Verification performed

- Checked `mac-app/electron/preload.ts` for current `contextBridge.exposeInMainWorld` globals.
- Checked preload comments for disabled mobile transcript sync, shared clipboard stubs, and experimental Tasks tab behavior.
- Checked `mac-app/electron/main/index.ts` for auth, River/shared files, team, metrics, commands, account, sync, updater, shell, agent, and clipboard handler families.
- Checked `mac-app/electron/main/shellIpc.ts` and `mac-app/electron/main/shellIpc.test.ts` for the extracted shell handler family.
- Checked `mac-app/electron/main/accountIpc.ts` and `mac-app/electron/main/accountIpc.test.ts` for the extracted account handler family.
- Checked `mac-app/electron/main/fieldTheorySyncIpc.ts` and `mac-app/electron/main/fieldTheorySyncIpc.test.ts` for the extracted sync handler family.
- Checked `mac-app/electron/main/metricsIpc.ts` and `mac-app/electron/main/metricsIpc.test.ts` for the extracted metrics handler family.
- Checked `mac-app/electron/main/quotaIpc.ts` and `mac-app/electron/main/quotaIpc.test.ts` for the extracted quota handler family.
- Checked `mac-app/electron/main/releaseSyncPolicy.ts` for internal sync gate names.
- Checked `mac-app/electron/main/preferences.ts` for Tasks tab preference state.

## Success condition

Tier 2 is successful when a contributor can answer three questions without reading the whole app:

What can renderer code ask main to do?

Which features are public, account-backed, internal, disabled, experimental, maintainer-only, or dev-only?

Which refactors would improve comprehension or safety without rewriting working product behavior?
