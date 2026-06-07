# Field Theory Privacy Policy

Last updated: May 31, 2026

This document describes the current Mac-app privacy model from code inspection. Keep it current when account-backed features, Supabase deployment behavior, or release behavior changes.

## Short Version

Field Theory Mac is local-first, not local-only.

Core local workflows can run without login. Account-backed features can use Supabase for auth, account state, quota or usage checks, metrics, feedback, public sharing, River shared documents, team presence, and internally gated sync features.

## Local User Content

User-authored Field Theory content generally lives under `~/.fieldtheory`, including:

- `~/.fieldtheory/library`
- `~/.fieldtheory/library/Commands`
- `~/.fieldtheory/ideas`
- `~/.fieldtheory/bookmarks`
- `~/.fieldtheory/library/River (shared)`
- `~/.fieldtheory/library/Conflicts`

The app can create, read, edit, rename, move, delete, index, and search markdown and related Library files through the Electron main process.

## Local App Data

Electron app-managed data lives under Electron `app.getPath("userData")`. Per-account state can live under `users/{userId}`.

Examples include:

- `supabase-session.json`
- `preferences.json`
- `clipboard.db`
- `user-metrics.json`
- Librarian settings and index files
- command settings
- tagged documents database
- generated figures

Supabase sessions are persisted as local files, not in macOS Keychain. Field Theory also writes a CLI-facing account mirror at `~/.fieldtheory/session.json` with user metadata and expiry; that mirror should not contain Supabase access or refresh tokens.

## Clipboard, Screenshots, and Transcription

Clipboard history is stored locally in SQLite. Field Theory must not sync clipboard history.

Clipboard and capture features are still sensitive because the app can read clipboard history, write clipboard contents, capture screenshots, save pasted images or sketches, and automate paste into other apps when the user enables the relevant macOS permissions.

Voice and transcription behavior depends on the selected local engine and setup. Public docs should not claim that every transcription path is cloud-free unless the exact engine path has been verified.

## Supabase and Account-Backed Features

Current Mac code can use Supabase for:

- authentication and profiles;
- account status and quota or usage checks;
- visible usage metrics;
- feedback;
- public shared readings;
- River shared documents;
- River pins and presence;
- team/contact membership;
- optional Library sync;
- optional command/mobile sync;
- gated todos;
- account deletion requests through a Supabase Edge Function.

The Supabase URL and publishable key are public client configuration. They are not service-role secrets. Access control must come from authentication, row-level security, Edge Functions, and server-side checks.

## River Shared Documents

River is the account-backed shared markdown feature.

River stores shared markdown remotely in Supabase and keeps a local managed cache in `~/.fieldtheory/library/River (shared)`. Conflicts can be written under `~/.fieldtheory/library/Conflicts`.

River should not be described as the same thing as full private Library sync.

## Internal Sync

Full Library sync and command mobile sync are internally gated. The main gate is `fieldTheoryInternalSyncEnabled` or `FIELD_THEORY_INTERNAL_SYNC_ENABLED`.

When Library sync is enabled, markdown content from `~/.fieldtheory/library` and `~/.fieldtheory/librarian/artifacts` can be uploaded to Supabase `library_documents`, while River/shared paths are skipped. Deletes can become remote tombstones, and remote deletes can move local files to `~/.Trash`.

These features should be documented as internal or experimental unless they are enabled as default user-facing behavior.

## Metrics

If an account is used, Field Theory can sync visible feature usage counts and account/quota state. Public docs should keep the promise narrow: count-style usage data, not clipboard contents, transcription audio, screenshots, or private document contents unless a specific sharing or sync feature explicitly sends that content.

## Third-Party Services

| Service | When used | Data involved |
| --- | --- | --- |
| Supabase | Auth, account state, quota/usage, metrics, feedback, public sharing, River, and optional/internal sync | Account metadata, usage counts, shared document data, feedback, and any explicitly synced content |
| GitHub | Release and updater infrastructure | Release metadata and update artifacts; experimental updater access may require maintainer GitHub auth |
| Apple | macOS permissions, signing, notarization, distribution, and system integrations | Standard Apple/macOS platform data |
| Local model and transcription providers | Optional local model/transcription setup | Depends on the selected local engine and downloaded model terms |

If a feature sends data to another third-party API, that feature needs its own current privacy note.

## Account Deletion

The current account deletion path calls a Supabase Edge Function and signs out. Do not assume that local app data is deleted unless the local deletion path is separately implemented and verified.

Public policy should distinguish:

- remote account deletion;
- synced/shared data deletion;
- local data remaining on the user's Mac;
- manual local cleanup steps.

## Security

Field Theory uses an Electron preload boundary: renderer code asks Electron main for privileged actions instead of using Node directly.

Sensitive capability areas include:

- local Library and external markdown file writes;
- clipboard history, screenshot, sketch, and paste automation;
- external URL opening and system settings links;
- local command execution against active documents;
- agent launcher, Terminal launcher, and PTY shell sessions;
- auth/session reads and account operations;
- Supabase sync, sharing, feedback, metrics, quota, and team operations;
- updater and experimental-update behavior.

See the root `SECURITY.md` before reporting or working on security-sensitive behavior.

## Contact

Security issues should not be filed publicly. Use the process in `SECURITY.md`.

For general privacy questions, use the contact path published at [fieldtheory.dev](https://fieldtheory.dev).
