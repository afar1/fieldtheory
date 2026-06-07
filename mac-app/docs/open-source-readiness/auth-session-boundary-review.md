# Auth Session Boundary Review

Date: May 31, 2026

This review documents the current token-bearing renderer boundary. It does not change behavior.

**Main finding**

`authAPI.getSession` returns a full Supabase session from Electron main to renderer code. That includes access and refresh tokens. This is an intentional current boundary because renderer code still uses Supabase realtime/profile flows that expect session-shaped data.

This should stay documented as a sensitive boundary until the app can replace full-session reads with narrower methods.

**Where the full session crosses**

The preload bridge exposes `authAPI.getSession` as `ipcRenderer.invoke('auth:getSession')`.

The main process handler returns `authManager.getSession()`.

Renderer callers found in the current code:

- `mac-app/src/hooks/useAuthSessionBridge.ts`: initializes renderer auth state from the main-process session and listens for session changes.
- `mac-app/src/components/Onboarding.tsx`: checks whether a user is already logged in and reads user metadata such as email and callsign.
- `mac-app/src/components/SettingsPanel.tsx`: refreshes the session after profile-name updates so the UI can show updated user metadata.

**Safer paths already exist**

`accountAPI` now uses `accountIpc.ts` for account status and capability mode. That is a safer account metadata path than asking the renderer for the full Supabase session.

The CLI-facing session mirror at `~/.fieldtheory/session.json` is also narrower. `authManager.ts` writes user id, email, display name, and expiry, but not access or refresh tokens.

**Why this is not narrowed in this pass**

Narrowing `authAPI.getSession` would touch active login, onboarding, settings, realtime, River, and profile behavior. That is too risky for a readability pass unless it is paired with product-level auth testing.

The better move for now is to document the boundary clearly, keep account metadata on narrower APIs where possible, and avoid introducing new full-session renderer callers.

**Follow-up refactor**

Replace broad session reads with narrower APIs where each caller only gets what it needs:

- `auth:getUserProfile` for user id, email, display name, callsign, and expiry;
- `auth:getRealtimeAuth` only if Supabase realtime truly needs an access token in renderer;
- event payloads that send account metadata for UI updates instead of full sessions;
- tests that prove login, sign-out, onboarding resume, profile update, River realtime, and account status still work.

Until that exists, security docs should treat `auth:getSession` and `auth:sessionChanged` as token-bearing IPC boundaries.
