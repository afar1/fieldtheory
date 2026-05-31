# Contributing to Field Theory Mac

Field Theory Mac is being prepared for open source. This guide covers ordinary local development. It does not grant release access, signing access, production Supabase access, or private updater access.

## Local Setup

```bash
cd mac-app
cp .env.example .env.local
npm ci
npm run dev
```

Core local workflows should run without Supabase credentials. Add Supabase public config only when testing authenticated or account-backed features.

## Verification

Run the checks that match your change:

```bash
npm run typecheck
npm test
npm run build
```

For package-safety checks:

```bash
npm run guard:package-safety
npm run guard:package-safety:experimental
npm run guard:electron-dist-requires
```

Do not expect release-channel guards or package commands to pass from feature branches.

## Scope Guidelines

- Keep changes narrow and behavior-preserving unless the issue asks for behavior changes.
- Treat the current code path as source of truth when docs disagree with code.
- Do not sync clipboard history.
- Do not broaden local file write access casually.
- Be careful with IPC handlers that touch files, auth/session data, Supabase, OS permissions, child processes, updater behavior, or local command execution.
- Avoid touching maintainer-only release infrastructure unless the task is explicitly about release infrastructure.

## Local Data Caution

Development runs can mutate real data in `~/.fieldtheory` and Electron `userData`.

Use dedicated test accounts, temporary paths, or small fixtures when testing destructive Library, command, River, sync, clipboard, or account flows.

## Issues And Security

After the repository is public, normal issues are appropriate for bugs, docs, setup problems, and contribution discussions.

Do not open public issues for suspected vulnerabilities, exposed credentials, auth bypasses, private data exposure, updater issues, signing/notarization problems, or release credential mistakes. Use the private security contact described in `SECURITY.md` until a formal public advisory process exists.

## Pull Request Expectations

Before a PR is considered ready:

- public-facing docs should match current behavior;
- tests should cover behavior changes where practical;
- package and release docs should distinguish contributor workflows from maintainer workflows;
- security-sensitive changes should mention the IPC/data-flow impact;
- asset or dependency additions should include license/provenance notes.
