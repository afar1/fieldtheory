# Local Data Paths

Date: May 31, 2026

This note documents the local paths that matter for public contributors. It is written from code inspection, not from old setup docs.

**Main point**

Development runs can touch real local Field Theory data. The safest public setup promise is not "dev mode is sandboxed." The honest promise is: core local workflows use local files by default, and contributors should use a separate macOS user, VM, temporary Field Theory home, or test Library roots when they are testing destructive Library, command, sync, River, clipboard, or account behavior.

**App-managed data**

Electron app-managed data uses `app.getPath('userData')`.

That path stores data such as:

- `supabase-session.json`;
- `current-user.json`;
- per-user directories under `users/{callsign}`;
- preferences;
- `clipboard.db`;
- figures and copied images;
- local metrics and caches;
- model directories such as `models`.

`mac-app/electron/main/userDataManager.ts` organizes account-specific app data under `users/{callsign}` after login.

**Field Theory home data**

Many Field Theory product paths are rooted under `~/.fieldtheory`.

Important examples:

- `~/.fieldtheory/library`;
- `~/.fieldtheory/library/Commands`;
- `~/.fieldtheory/library/River (shared)`;
- `~/.fieldtheory/library/Conflicts`;
- `~/.fieldtheory/librarian`;
- `~/.fieldtheory/session.json`;
- `~/.fieldtheory/agents`;
- `~/.fieldtheory/debug`.

Some managers accept test options or environment variables in focused tests, but there is not one documented top-level environment variable that safely redirects every `~/.fieldtheory` path for the whole app.

**Contributor guidance**

For ordinary UI and build work, contributors can run the app normally.

For destructive or sync-adjacent testing, use one of these approaches:

- use a separate macOS user account or disposable machine profile;
- back up `~/.fieldtheory` before testing;
- create a small test Library root in Settings and avoid using a real personal Library;
- avoid enabling internal sync gates unless the test specifically covers sync;
- use dedicated Supabase test accounts, not personal production accounts;
- do not test account deletion against an account with data that has not been backed up.

**Code gap**

A first-class contributor-safe dev profile would be useful, but it is not implemented as one switch today. A future pass could add a documented environment variable or launch profile that redirects both Electron `userData` and Field Theory home paths to a temporary directory. That should be done carefully because many modules currently call `os.homedir()` directly.
