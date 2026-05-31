# Supabase Account Policy Review

Date: May 31, 2026

This review checks the public documentation language against the repo-visible Supabase and account code. It does not prove the live Supabase project is configured correctly.

**Main finding**

The current open-source docs are directionally accurate: Field Theory Mac is local-first, not local-only. Supabase-backed features are optional for ordinary local development, but auth, account state, quota or usage checks, feedback, River shared documents, public sharing, and internally gated sync can use Supabase when configured.

The docs should keep saying that the Supabase URL and publishable key are public client configuration, not service-role secrets. The security boundary is authentication, row-level security, Edge Functions, and server-side checks.

**Renderer and main-process boundary**

`mac-app/src/supabaseClient.ts` creates a nullable renderer Supabase client only when `VITE_SUPABASE_URL` plus `FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` exists. That client disables local auth persistence and token refresh. The code comment says renderer Supabase is used only for realtime subscriptions, while main owns auth.

`mac-app/electron/main/authManager.ts` is the main-process source of truth for Supabase auth. It persists the Supabase session to `supabase-session.json`, refreshes tokens, emits session changes, and writes a CLI-facing mirror at `~/.fieldtheory/session.json` with user id, email, display name, and expiry. The mirror intentionally avoids access and refresh tokens.

`mac-app/src/hooks/useAuthSessionBridge.ts` does request the current session from `window.authAPI.getSession()`. That means token-bearing session data can cross from main to renderer. This is already documented in the IPC capability map and should remain a named auth/session risk until narrowed.

**Account status and quota**

`mac-app/electron/main/accountStatusManager.ts` calls the `get-usage` Edge Function with the current bearer token. If no session is present, account status becomes `needs_login`. If the network is unavailable, it preserves the previous capability mode as an offline state.

`supabase/functions/get-usage/index.ts` verifies the bearer token with Supabase auth before reading profile and usage rows through a service-role client. It returns tier, trial state, app access mode, monthly usage, and limits.

This supports the public-doc wording that account-backed behavior may require a configured Supabase project and account, while core local workflows should keep working without login.

**Repo-visible database policy**

The repo includes migrations that enable row-level security and owner or participant policies for the main account-backed tables.

Examples:

- `supabase/migrations/003_rls_policies.sql` enables RLS for profiles, todos, observations, and transcripts, then restricts access with `auth.uid()`.
- `supabase/migrations/015_user_commands.sql` enables RLS for synced user commands and limits rows to the owner.
- `supabase/migrations/016_team_documents.sql` enables RLS for River team documents and gates reads/writes through `is_team_document_scope_participant`.
- `supabase/migrations/018_team_document_pins.sql` applies participant checks for River pins.
- `supabase/migrations/008_team_image_storage.sql` and `011_sketch_items.sql` add storage policies scoped to user folders.

This is enough to justify docs that explain the intended policy model. It is not enough to claim the live production database exactly matches the migrations.

**Edge Functions**

Repo-visible Edge Functions use service-role keys server-side and verify the caller before privileged work.

- `get-usage` verifies the bearer token, then reads the caller's profile and usage.
- `improve-text` and `process-transcription` verify the bearer token before server-side AI work and usage updates.
- `delete-account` verifies the bearer token, then uses admin privileges to cancel Stripe, remove known storage files, and delete the Supabase auth user.
- `stripe-webhook` is a server-side webhook path and should remain documented as infrastructure, not contributor setup.

The public docs should not instruct contributors to put service-role keys in `.env.local`.

**Account deletion language**

The current privacy docs are cautious in the right way. The repo-visible delete-account function handles remote account deletion and known remote storage cleanup. The Mac app signs out afterward. This does not prove local app-managed data, local Library files, local clipboard history, local indexes, or local caches are deleted.

Public language should continue to distinguish remote account deletion from local data cleanup.

**What remains unverified**

- Whether the live Supabase project has exactly these migrations and policies applied.
- Whether production Edge Function secrets are configured correctly.
- Whether public contributors should use production Supabase, a separate hosted dev project, local Supabase, or local-only mode.
- Whether the renderer still needs full Supabase session objects for realtime, or whether main can eventually pass narrower realtime credentials or account metadata.

**Documentation decision**

Keep the current public setup promise narrow:

- local-first core workflows should run without Supabase;
- account-backed features need explicit public Supabase configuration and an account;
- service-role keys, Stripe secrets, release credentials, and production project administration are maintainer-only;
- RLS and Edge Functions are the intended backend security model, but live project verification is a release gate.
