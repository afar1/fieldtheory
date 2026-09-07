# Voice Settings readiness repair

Version `0.3.47-voice.2` fixes the local readiness failure in `0.3.47-voice.1`. It does not activate the hosted Voice delivery migration.

## Observed failure and cause

Computer use confirmed the running preview showed Voice requests as Unavailable, with both Enable and Choose folder disabled. The actual document was `clipboard-history.html?initialView=library` inside Field Theory's Library/Clipboard window. `SettingsPanel` is rendered by `ClipboardHistory.tsx`.

The initial Voice IPC guard instead trusted `mainWindow` at `index.html`. It rejected `getState` and `refreshStatus` before the worker could return any readiness state. Status broadcasts also targeted the wrong window, and the folder dialog would have used the wrong parent. Retrying or restarting could not change that mapping.

The fix consistently uses `clipboardHistoryWindow.getWindow()` for authorization, broadcasts, and dialog ownership. The production path is `dist/clipboard-history.html`; development uses the existing `devServerPageUrl` used by the window loader. Exact window identity, main-frame identity, document URL checks, and post-await checks remain in place. Unrelated app pages and remote or nested frames remain denied.

## Verification

- 50 focused worker, trust-boundary, and Settings tests passed; type checks passed.
- Trust tests now cover the observed Library URL and the Clipboard initial view, along with negative frame, window, and URL cases.
- A pure-function reproduction using the installed app's extracted guard accepted `index.html` and rejected the observed Library Settings URL. The repaired compiled guard accepted Library Settings and rejected the unrelated main page. This was not an application launch.
- The packaged main process, guard, and shared development URL helper match their compiled source bytes. Package and both bundle version fields are `0.3.47-voice.2`.
- Independent review found no remaining host, frame, or wiring mismatch.

The requested deliverable is a local signed/notarized DMG. No candidate installation, mounting, runtime launch, public distribution, or cloud activation is authorized. Visible post-fix behavior must be checked after the user installs the replacement; source and package checks do not substitute for that observation.

## Delivered replacement

`mac-app/release/Field-Theory-0.3.47-voice.2-arm64-local.dmg` (Apple Silicon, 186,468,419 bytes) passed signature verification, stapled-ticket validation, Gatekeeper assessment as Notarized Developer ID, and `hdiutil verify` without mounting. The app inside was independently signed/notarized/stapled and assessed before image creation. SHA-256: `dacd226ce252ac2357e7becd680adbb432d0e81ca9b874f4930634341b3fab2b`.

The source commit is `e91128e789a71504fc8241fd6029677f580eaf43`. Verification receipt: `mac-app/release/local-verification-0.3.47-voice.2.json`. This supersedes the `0.3.47-voice.1` preview for testing Voice Settings; the earlier artifact remains preserved.
