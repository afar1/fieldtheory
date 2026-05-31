# Privacy and Security Data Flow

This note describes current behavior from code inspection. It is not a final privacy policy. The final public policy should be written after the license, account model, release model, and Supabase deployment posture are decided.

## Local-first, not local-only

Field Theory Mac can do substantial work without login. Local Library editing, markdown files, clipboard history, local command surfaces, transcription setup, and many settings are local app behavior.

The app is not purely local. Login and account-backed features can use Supabase for auth, account state, metrics, feedback, sharing, River, and optional sync.

## Local user-authored data

User-authored Field Theory content generally lives under `~/.fieldtheory`:

- `~/.fieldtheory/library`
- `~/.fieldtheory/library/Commands`
- `~/.fieldtheory/ideas`
- `~/.fieldtheory/bookmarks`
- `~/.fieldtheory/library/River (shared)`
- `~/.fieldtheory/library/Conflicts`

The app can create, modify, rename, delete, move, and index markdown files in these paths through Electron main-process managers.

## Local app-managed data

Electron app-managed data lives under `app.getPath("userData")`, with per-account data under `users/{userId}`.

Examples include:

- Supabase session file: `supabase-session.json`
- preferences: `preferences.json`
- clipboard database: `clipboard.db`
- local metrics: `user-metrics.json`
- Librarian settings and index files
- command settings
- tagged documents database
- generated figures

Important distinction: Supabase sessions are persisted as local files, not in macOS Keychain. The app also writes `~/.fieldtheory/session.json` as a CLI-facing mirror containing user id, email, display name, and expiry, but not access or refresh tokens.

## Clipboard data

Clipboard history is local and stored in SQLite. It should be documented as local-only. Public docs should also state that Field Theory must not sync clipboard history.

The clipboard surface is still sensitive because it can read clipboard history, write clipboard contents, capture screenshots, save pasted images/sketches, and automate paste into other apps.

## Supabase data flow

Current Mac code can touch Supabase for:

- authentication and profiles;
- account status and quota or usage checks;
- metrics;
- feedback;
- public shared readings;
- River shared documents;
- River pins and presence;
- team/contact membership;
- optional Library sync;
- optional command/mobile sync;
- gated todos;
- account deletion requests through a Supabase Edge Function.

The production Supabase URL and publishable key are public client configuration. Treat them like browser client config: not secret, but still security-relevant because the backend must enforce access through auth, row-level security, and server-side checks.

## River data flow

River stores shared markdown remotely in Supabase and keeps local managed cache files in `~/.fieldtheory/library/River (shared)`.

Remote River surfaces include shared document content, team document pins, team/contact membership, and presence. Local conflicts are written under `~/.fieldtheory/library/Conflicts`.

River should be described as account-backed sharing, not as default full-Library sync.

## Internal sync data flow

Full Library sync and command mobile sync are internally gated. The main gate is `fieldTheoryInternalSyncEnabled` or `FIELD_THEORY_INTERNAL_SYNC_ENABLED`.

When Library sync is enabled, markdown content from `~/.fieldtheory/library` and `~/.fieldtheory/librarian/artifacts` can be uploaded to Supabase `library_documents`, while River/shared paths are skipped. Deletes can become remote tombstones, and remote deletes can move local files to `~/.Trash`.

This is too important to leave implicit. Public docs should either omit these as default features or mark them clearly as internal or experimental until the product decision is final.

## Privileged renderer requests

The renderer cannot use Node directly, but preload-exposed APIs let it request privileged main-process actions.

Sensitive categories include:

- local Library and external markdown file mutation;
- image and asset copying into Library-relative locations;
- clipboard history, screenshot, sketch, and paste automation;
- external URL opening, system settings links, and file reveal;
- local command execution against active documents;
- agent launcher, Terminal launcher, and PTY shell sessions;
- transcription/model setup scripts;
- auth/session reads and account operations;
- Supabase sync, sharing, feedback, metrics, quota, and team operations;
- updater and experimental-update behavior.

Contributor docs should make this boundary explicit: renderer APIs are capability grants.

## Account deletion caution

The current account deletion path calls a Supabase Edge Function and then signs out. Do not claim that local user data is deleted unless the code path is changed or separately verified. A final privacy policy should distinguish remote account deletion from local app data cleanup.

## Public security documentation needed

Before a public release, write or update:

- privacy policy from the current Mac data flow;
- security policy and vulnerability reporting instructions;
- Supabase/RLS overview for public contributors;
- local data location and cleanup guide;
- account deletion behavior with exact local/remote scope;
- IPC capability boundary guide;
- third-party dependency and asset provenance notices;
- secret scanning and release credential handling notes.
