# Secret And Private Reference Audit

Date: May 31, 2026

This audit records current working-tree and git-history findings for release readiness. It is not a substitute for a dedicated secret scanner.

## Current working-tree results

A tracked-file grep pass did not find obvious live plaintext secrets. The current hits are expected environment variable names, placeholders, code that reads secrets from environment variables, Supabase Edge Functions, and maintainer-only release references.

No `gitleaks`, `trufflehog`, or `detect-secrets` binary was available in the current shell, so this pass cannot prove repository history is clean.

## Git history results

A git-history grep pass was run for credential-shaped strings, secret environment variable names, private key markers, and the removed maintainer-local env path.

Findings:

- No tracked `.env`, `.env.local`, `.pem`, `.p8`, `.p12`, or `.mobileprovision` file additions were found by the targeted history command.
- History contains the now-removed `mac-app/resources/chatterbox/reference-voice.wav` and `.m4a` files in older commits. Those files are not present in the current tree and should not be reintroduced without source, consent, attribution, license, and redistribution notes.
- History contains expected hits for environment variable names such as `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GH_TOKEN`, `FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN`, and `APPLE_APP_SPECIFIC_PASSWORD`.
- The current tree uses those names in server-side environment reads, package/release docs, tests, and release-readiness audit notes. The pass did not intentionally print or preserve secret values in this document.
- History contains the removed maintainer-local env path in older Electron main code and docs. The current working tree no longer uses that path as a runtime fallback.
- History contains upstream `whisper.cpp` example hits for private-key-related regexes in dependency/example code. Those are not Field Theory credentials.

This is meaningful evidence that obvious tracked credential files were not found by the targeted commands, but it is weaker than a dedicated scanner because it depends on the searched patterns.

## Fixed in this readiness pass

- Rewrote `mac-app/docs/RELEASE_WORKFLOW.md` so it no longer describes a split between source and release artifacts.
- Removed obviously private Cursor operational command docs for unrelated deploy, droplet, environment, dashboard, and release workflows.
- Cleaned remaining Cursor, Claude, and older iOS doc examples that referenced maintainer-local paths or unrelated projects.
- Replaced the contributor-facing release credential path in `CLAUDE.md` with maintainer-controlled credential language.
- Removed the hardcoded maintainer local env path `/Users/afar/dev/fieldtheory/.env.local` from Electron main env lookup.
- Replaced the experimental updater error string that named private release infrastructure with generic maintainer GitHub access language.
- Added maintainer-only release infrastructure docs so updater feeds, signing, notarization, release repos, and release tokens are not presented as contributor setup.

## Remaining tracked-file notes

Current tracked-file searches still find intentional references to:

- environment variable names used as placeholders or code-level configuration;
- `field-releases`, which is the current production release feed;
- absolute `~/.fieldtheory` examples in tests and docs;
- experimental updater configuration in `mac-app/electron-builder.experimental.json`;
- maintainer release channel constants in `mac-app/electron/main/buildChannel.ts`;
- release-readiness audit docs that intentionally include search patterns.

The experimental updater configuration may remain public if it is clearly documented as maintainer-only and contains no secrets. The release token itself must never be committed.

## Dedicated scanner still required

Run a dedicated history-aware scanner from the release candidate:

```bash
gitleaks detect --source . --redact --no-banner
trufflehog git file://$PWD --only-verified --fail
git log --all -S'GH_TOKEN' -S'FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN' -S'APPLE_APP_SPECIFIC_PASSWORD' -- .
git log --all -G'(ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,}|BEGIN .*PRIVATE KEY|/Users/afar/dev/fieldtheory/.env.local)' -- .
git log --all --name-only -- .env .env.local '*.pem' '*.p8' '*.p12' '*.mobileprovision'
```

If any real credentials appear in history, rotate them. Do not rely on deletion from the current tree as sufficient remediation.

## Commands used

Representative commands used during this pass:

```bash
git grep -I -l -E 'sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----|SUPABASE_SERVICE_ROLE|FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN|APPLE_ID_PASSWORD|CSC_LINK|CSC_KEY_PASSWORD|GH_TOKEN|GITHUB_TOKEN|SENTRY_AUTH_TOKEN|NPM_TOKEN|PRIVATE_KEY' -- ':!mac-app/package-lock.json' ':!package-lock.json'
git log --all --oneline -- 'mac-app/.env' '.env' '.env.local' 'mac-app/.env.local' 'mac-app/resources/chatterbox/reference-voice.wav' 'mac-app/resources/chatterbox/reference-voice.m4a'
command -v gitleaks || true
command -v trufflehog || true
command -v detect-secrets || true
git grep -n -I -E '(OPENAI_API_KEY|ANTHROPIC_API_KEY|GH_TOKEN|FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN|APPLE_APP_SPECIFIC_PASSWORD)' -- .
git grep -n -I -E '(private source|afar1/oscar|field-releases|/Users/afar|/Users/benjmarston|~/.ssh|hatchery|routines)' -- .
git log --all --format='%h %ad %s' --date=short -S'GH_TOKEN' -S'FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN' -S'APPLE_APP_SPECIFIC_PASSWORD' -- .
git log --all --format='%h %ad %s' --date=short -G'(ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,}|BEGIN .*PRIVATE KEY|/Users/afar/dev/fieldtheory/.env.local)' -- .
git log --all --format='%h %ad %s' --date=short --name-only -- .env .env.local '*.pem' '*.p8' '*.p12' '*.mobileprovision'
git log --all --format='%h %ad %s' --date=short -G'(OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_KEY|PRIVATE KEY|BEGIN RSA|BEGIN OPENSSH|AKIA[0-9A-Z]{16})' -- .
git remote -v
```
