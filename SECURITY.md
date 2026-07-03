# Security Policy

This policy covers the Field Theory app source repository.

## Reporting Vulnerabilities

Do not open a public issue for suspected vulnerabilities, exposed credentials, auth bypasses, updater problems, private data exposure, or code execution issues.

Contact the maintainer privately with a minimal description first, then share technical details only after a private disclosure path is agreed.

## Sensitive Areas

Field Theory Mac is an Electron app. The renderer is not supposed to use Node directly; privileged work should happen through preload-exposed capabilities and Electron main-process IPC handlers.

Security-sensitive areas include:

- auth/session storage and IPC;
- Supabase auth, row-level security assumptions, Edge Functions, metrics, quota, feedback, River, and sync services;
- local Library and external markdown file mutation;
- `~/.fieldtheory` content and Electron `userData`;
- clipboard history, screenshots, sketches, and paste automation;
- macOS permissions for microphone, screen capture, accessibility, automation, camera, and login items;
- local command execution, agent launchers, Terminal launchers, PTY sessions, and setup scripts;
- updater behavior, production release feeds, experimental update feeds, and private updater access;
- signing, notarization, entitlements, and release artifacts;
- bundled assets, reference voice files, models, and native binaries.

## Secrets and Credentials

Do not commit:

- Supabase service-role keys;
- GitHub tokens;
- Apple Developer credentials;
- signing certificates or private keys;
- notarization credentials;
- private updater tokens;
- production `.env.local` files;
- private model or asset credentials;
- user data from `~/.fieldtheory` or Electron `userData`.

Supabase publishable keys are public client configuration, but they still require correct backend policy. Do not treat a publishable key as a substitute for row-level security or server-side authorization.

## Local Data Safety

Development runs can mutate real local Field Theory data. Be careful when testing:

- Library writes;
- command launcher document mutation;
- River shared files;
- internal sync;
- account deletion;
- clipboard history;
- screenshot or paste automation;
- agent and terminal surfaces.

Prefer temporary test paths or dedicated accounts when exercising destructive or sync-related behavior.

## Security Review Expectations

Before release changes are shipped:

- run a tracked-file secret scan;
- run a history-aware secret scan;
- audit Supabase policies and Edge Functions relevant to public clients;
- verify account deletion wording against actual local and remote behavior;
- keep production/runtime dependency audit clean and separately track dev/build toolchain advisories that require breaking Electron, Vite, or packaging upgrades;
- document third-party notices and asset provenance;
- review IPC paths that return auth/session material to the renderer;
- verify updater/release credentials are maintainer-only and not required for local development.
