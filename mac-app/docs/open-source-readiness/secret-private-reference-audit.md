# Secret And Private Reference Audit

Date: May 31, 2026

This audit records current working-tree findings for open-source readiness. It is not a full history-aware secret scan.

## Current working-tree results

A tracked-file grep pass did not find obvious live plaintext secrets. The hits were mostly environment variable names, placeholders, code that reads secrets from environment variables, and maintainer-only release references.

No `gitleaks`, `trufflehog`, or `detect-secrets` binary was available in the current shell, so this pass cannot prove repository history is clean.

## Fixed in this readiness pass

- Rewrote `mac-app/docs/RELEASE_WORKFLOW.md` so it no longer describes a private-source/public-release split.
- Removed obviously private Cursor operational command docs for unrelated deploy, droplet, environment, dashboard, and release workflows.
- Replaced the contributor-facing release credential path in `CLAUDE.md` with maintainer-controlled credential language.
- Removed the hardcoded maintainer local env path `/Users/afar/dev/fieldtheory/.env.local` from Electron main env lookup.
- Replaced the experimental updater error string that named private release infrastructure with generic maintainer GitHub access language.

## Remaining tracked-file risks

Some older non-Mac or agent-support docs still contain private paths, internal product history, or maintainer assumptions. They should be reviewed before publication:

- `.cursor` command, flow, and plan documents not removed in this pass;
- `.claude` hook/settings files;
- root `CLAUDE.md`;
- older iOS build docs under `docs/`;
- experimental updater configuration in `mac-app/electron-builder.experimental.json`;
- maintainer release channel constants in `mac-app/electron/main/buildChannel.ts`.

The experimental updater configuration may remain public if it is clearly documented as maintainer-only and contains no secrets. The release token itself must never be committed.

## History-aware audit still required

Before publication, run a history-aware scanner from the final public candidate:

```bash
gitleaks detect --source . --redact --no-banner
trufflehog git file://$PWD --only-verified --fail
git log --all -S'GH_TOKEN' -S'FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN' -S'APPLE_APP_SPECIFIC_PASSWORD' -- .
git log --all -G'(ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,}|BEGIN .*PRIVATE KEY|/Users/afar/dev/fieldtheory/.env.local)' -- .
git log --all --name-only -- .env .env.local '*.pem' '*.p8' '*.p12' '*.mobileprovision'
```

If any real credentials appear in history, rotate them before publication. Do not rely on deletion from the current tree as sufficient remediation.

## Commands used

Representative commands used during this pass:

```bash
git grep -n -I -E '(OPENAI_API_KEY|ANTHROPIC_API_KEY|GH_TOKEN|FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN|APPLE_APP_SPECIFIC_PASSWORD)' -- .
git grep -n -I -E '(private source|afar1/oscar|field-releases|/Users/afar|/Users/benjmarston|~/.ssh|hatchery|routines)' -- .
command -v gitleaks || true
command -v trufflehog || true
command -v detect-secrets || true
git remote -v
```
