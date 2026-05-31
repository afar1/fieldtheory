# Remaining Publication Decisions

Date: May 31, 2026

This note separates real remaining decisions from code cleanup. These should not be guessed by an agent.

**Deferred license decision**

The final license model is still deferred. That decision should cover code, docs, assets, generated sounds, packaged app resources, and any bundled notices.

**Dedicated secret scanner**

The repo has a current-tree audit and a targeted git-history grep audit. No `gitleaks`, `trufflehog`, or `detect-secrets` binary was available in this shell.

Before publication, run a dedicated history-aware scanner from the final public candidate and rotate anything real that appears in history.

**Brand and icon provenance**

The remaining app icons and logo PNGs need project ownership confirmation, replacement, or removal before publication. This is a source/provenance decision, not a code refactor.

Files:

- `mac-app/electron/assets/fieldtheory-iconTemplate.png`
- `mac-app/electron/assets/fieldtheory-iconTemplate@2x.png`
- `mac-app/electron/assets/icon.icns`
- `mac-app/public/field-theory-icon-black.png`
- `mac-app/public/fieldtheory-icon.png`
- `mac-app/public/fieldtheory-logo-black.png`
- `mac-app/public/fieldtheory-logo-white.png`

**Supabase project posture**

The repo-visible code and migrations support the docs' account-backed wording, but they do not prove live production state.

Before publication, decide whether public contributors should use:

- local-only mode by default;
- a hosted public dev Supabase project;
- local Supabase;
- production Supabase with restricted expectations.

**Local data dev profile**

The docs now explain that development runs can touch real `~/.fieldtheory` and Electron `userData` paths. A single safe dev profile that redirects every local path does not exist yet.

Adding one would be useful, but it is a separate code project because many modules still call `os.homedir()` directly.

**Public issue policy**

Public issues can be opened for normal bugs, docs, setup problems, and contribution discussions once the repository is public.

Security reports, exposed credentials, auth bypasses, private data exposure, updater issues, signing/notarization issues, and release credential problems should use the private security channel until a formal advisory process exists.
