# Local Voice package verification

This records the Voice event-delivery candidate audit and bounded harness work
based on `mac-app/package.json` version `0.3.45`. No production profile, installed
app, authentication state, release, or cloud resources were changed by this work.

## Current result: runtime verification blocked

The user reported repeated macOS malware-blocked notifications while this work
was in progress. The causal link to these attempts is unconfirmed. All direct
developer Electron launches and download retries have stopped. Do not disable
macOS security, remove quarantine, or retry developer Electron to obtain a pass.

The initial harness compilation and fixture ASAR creation succeeded. Execution
did not produce runtime evidence. That source snapshot predates the final runner
protocol fix; it does not verify the final source or a distributable app.

Exact attempts on 2026-09-07:

1. Ran `node node_modules/electron/install.js` with the developer-runtime override
   and skip-download variables removed. It returned zero and `Electron.app`
   appeared under this worktree's dependencies.
2. Ran the harness driver at `22:36:41Z`. It compiled Voice sources, wrote
   `voice-worker-fixture.asar`, and attempted to launch dependency Electron in
   `ELECTRON_RUN_AS_NODE` mode with an empty PATH. There was no runtime stdout or
   stderr; the driver failed. The app was absent on the next inspection. The
   initial driver did not retain the child's signal, so none is claimed for this
   attempt.
3. One controlled repair diagnostic repeated `install.js`, which returned zero.
   `codesign --verify --deep --strict` then failed with `code has no resources but
   signature indicates they must be present`. The diagnostic attempted one
   `ELECTRON_RUN_AS_NODE` versions probe; it ended with `SIGKILL`, no output, and
   the executable was absent immediately afterward. No security bypass was used.
4. A final read-only cache inspection found both cached Electron 31.7.7 arm64 ZIPs
   matched the package's SHA-256 checksum. This does not prove a safe executable
   or explain the runtime disappearance.

The harness session `10840` finished with exit 1; diagnostic session `90723`
finished with exit 0 after recording its failed child probe. No sessions from
these attempts remain running. Evidence is under
`tools/voice-package-verification/output/2026-09-07T22-36-41-646Z/` and
`tools/voice-package-verification/output/electron-repair-diagnostic.json`.

The harness now requires an explicit `--packaged-app` argument selecting a
packaged Field Theory app. Before any launch it verifies the bundle identity,
contained executable path, full signature, stapled notarization ticket, and
Gatekeeper's `Notarized Developer ID` result. It cannot use `node_modules`
Electron and has no repair/download fallback. This revised harness has not been
executed. Root is following the user's newly authorized Field Theory local
install command; its release-note approval requirement precedes build work.

## Safe scope

Use the approved Field Theory packaging/install workflow for an actual app.
Only after its required approval and verified notarization may a separately
authorized harness run use that explicitly selected app's executable. The
fixture ASAR is not a distributable app. Do not launch the full app as the
current macOS user merely to obtain isolated signed-in evidence.

Full-app profile isolation is incomplete in the current source:

- `electron/main/index.ts` pins both production and experimental builds to
  `~/Library/Application Support/Field Theory`. The supported benchmark override
  is `FIELD_THEORY_STARTUP_BENCH_USER_DATA_DIR`; an experimental app name alone
  does not isolate data.
- `electron/main/authManager.ts` writes and removes the CLI session mirror at
  `~/.fieldtheory/session.json`, independently of that override.
- `electron/main/userDataManager.ts` also uses `~/.fieldtheory/users`, and
  `electron/main/fieldTheoryPaths.ts` has several home-directory paths without
  complete environment overrides.
- A packaged production app can register the normal URL protocol. The parallel
  instance override only applies to unpackaged development instances.
- `verify:release` ends with `quality:baseline --strict`, which can launch the
  full app. Its benchmark profile override is not proof of full home isolation.

Use a separate macOS test account or VM for a full signed-in package test. That
account should have its own Field Theory test account, Codex sign-in, workspace,
and local/test Supabase deployment. Do not copy production session files into
the test profile. Until that exists, label packaged harness evidence separately
from signed-in app and end-to-end phone evidence.

## Build facts from source

The inspected worktree has independent `node_modules`, but at audit time its
`mac-app/node_modules/electron/dist` contains licenses and `version` with no
`Electron.app`. Both native helper build directories were also absent at audit
time. Direct developer-runtime repair attempts subsequently failed as recorded
above and must not be repeated.

New Voice source files must be explicitly staged before packaging. The existing
`guard:tracked-sources` and `beforeBuild` hook correctly reject untracked source
and symlinked `node_modules`; do not disable those guards.

First run the focused tests and compilation after all changes are ready:

```sh
npm test -- electron/main/voiceWorkManager.test.ts electron/main/voiceCodexRunner.test.ts src/components/__tests__/VoiceWorkSettings.test.tsx
npm run typecheck
```

Use the local/test Supabase URL and publishable key supplied by the backend
verification run as explicit environment values for the build. The generator
otherwise reads this checkout's `.env.local`. It writes only public auth
configuration to `electron-dist/main/public-runtime-config.json`, and the
production package guard requires both fields. Do not create an apparently
working candidate by silently embedding production configuration or dummy
credentials. Vite and the main-process config must point at the same test backend.

The package script invokes channel/package/source/auth guards, rebuilds both
Swift tools, compiles Electron and Vite, checks emitted imports, then packages
and verifies the ASAR. A local build must use explicit `--publish never`. The
earlier unsigned candidate recipe has been withdrawn following the user's
macOS warning report; follow the approved local-install command instead.

`build:native` uses Swift and Xcode at build time. It builds and ad-hoc signs
`FieldTheoryHelper` and `FieldTheoryDiarizer`; electron-builder includes both as
resources, along with diarizer/FluidAudio licenses. `ensure:native` only checks
whether binaries exist and is insufficient to prove freshness after changes.
Native Node modules require the Electron ABI; the normal rebuild recipe uses
developer Python for `better-sqlite3` and `node-pty`. That is a build-machine
requirement, not a Voice worker installation requirement.

## Verify actual bundle bytes and runtime dependencies

Resolve the bundle under `mac-app/release/mac-arm64` from the completed build,
rather than assuming a previous artifact is current. Record Git revision, dirty
source diff, package version, artifact path, and SHA-256 of the ZIP and ASAR.

```sh
node scripts/verify-packaged-archive.cjs 'release/mac-arm64/Field Theory.app/Contents/Resources/app.asar'
```

This verifies every archived file's SHA-256 and parses packaged main-process
JavaScript. Additionally require these actual archive entries:

- `electron-dist/main/voiceWorkManager.js`
- `electron-dist/main/voiceCodexRunner.js`
- `electron-dist/shared/voiceWork.js`
- `electron-dist/preload.js`, including `voiceWorkAPI`
- The renderer asset containing the Voice requests settings component
- The intended local/test `public-runtime-config.json`

The revised harness requires an explicitly selected notarized packaged app;
it performs signature/notarization checks before invoking the executable:

```sh
node tools/voice-package-verification/run.mjs \
  --packaged-app '/absolute/path/to/notarized/Field Theory.app'
```

The harness is implemented under `tools/voice-package-verification`, but its
runtime checks remain unverified. It compiles the production Voice sources using
the app's TypeScript configuration into an explicitly marked fixture ASAR and
loads only those modules without importing `index.js` or `AuthManager`. It uses
a temporary `stateDirectory`, injected test auth/Supabase client, and controlled
runner transport. Workspace files are fixtures only. It covers disabled startup, missing Codex,
signed-out status, private push subscription/catch-up, receipt persistence,
duplicate events, completed outcome readback, and disable/restart recovery.
The existing manager test harness gives the current RPC and job shape.

For runner transport verification without account access, inject `spawnFn` with
a controlled app-server fixture. Record that it was invoked with an absolute
executable path, `['app-server', '--listen', 'stdio://']`, `shell: false`, and
piped standard streams. The source supplies these directly. Do not substitute
an unmarked fake account result for real signed-in evidence.

The harness runtime PATH is an empty fixture directory; npm/Homebrew and user
Python/Node installations cannot be discovered there. Record `process.execPath` and
`process.versions` to prove the harness is executing the package's Electron and
its embedded Node runtime. Verify native `.node` modules load under that runtime
where the full app needs them. `otool -L` on the helper, diarizer, and native
modules should show no required `/opt/homebrew` or `/usr/local` dylibs.

## Codex and end-to-end acceptance

The worker intentionally depends on a normal signed-in Codex desktop install.
`discoverVoiceCodexBinary` checks `~/Applications` and `/Applications` for
`Codex.app` and `ChatGPT.app` before looking for an absolute executable in PATH.
On the inspected host `/Applications/ChatGPT.app/Contents/Resources/codex` is a
native arm64 executable. No user-installed Node, Python, Homebrew package, HTTP
listener, or tunnel is required by the worker-to-Codex transport. Optional
unrelated Parakeet/Gemma app features still package Python/setup scripts; do not
broaden the claim to every Field Theory feature.

`inspectVoiceCodexRuntime` starts an app-server and calls
`account/read { refreshToken: false }`. It does not intentionally refresh auth,
but a normal Codex process inherits the current account's profile and may write
logs/state. Its `homeDir` option changes discovery and working directory; it is
not a profile override. Run this live check only in the isolated test account.

Before claiming end-to-end completion, verify in that account with the packaged
app and real test backend:

1. Enable requires both sign-ins and an explicit allowed folder; new settings
   persist after relaunch. Old phone backlog remains ineligible.
2. A newly synced test recording creates one task and returns its confirmed
   outcome to Settings. Task creation alone never appears as completed work.
3. Duplicate push/reconnect/relaunch does not dispatch the same request again;
   an interrupted delivery recovers the existing task or asks for attention.
4. “Just context”, quoted instructions, and “hold off” remain non-executing;
   clarification follows its associated task.
5. Account switch/sign-out/disable stops work and hides the previous account's
   task. Missing/expired auth does not enter a background retry loop.
6. The process stays idle between push events. Timers for an active lease or
   server-directed wake are distinct from periodic transcript polling.
7. Verify the full response, final status, and Open task link in the packaged UI.
   Record phone-to-visible outcome timing separately from synthetic harness time.

A signed/notarized release later needs independent app and container signature,
notarization/stapler, Gatekeeper, and read-only mounted-content verification. That
release work and installation are outside this local candidate verification.
