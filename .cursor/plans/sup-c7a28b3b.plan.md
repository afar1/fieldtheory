<!-- c7a28b3b-7e3f-4ae7-b1e5-db4f2641d7f6 d37ef168-19d9-4dcb-91c1-edd1e9d5e5cf -->
# Supabase Integration Plan

## 1. Baseline + Requirements Alignment

- Inventory what the React Native app currently stores (`services/storage.ts`, `components/TodoList.tsx`, `components/ObservationList.tsx`, `hooks/useWhisperRecording.ts`) to define the minimum synchronized entities (todos, observations, transcripts, settings).
- Capture Mac companion expectations (read-only vs. read/write, offline behavior) so the schema and APIs cover both surfaces without speculative features.

## 2. Supabase Project Wiring

- Document existing Supabase project credentials, generate service role + anon keys, and decide on environment variable layout for mobile (`app.json`/EAS), Mac, and any shared scripts.
- Add a tiny `services/supabaseClient.ts` wrapper (one well-named factory) to encapsulate URL/key usage and keep initialization centralized.

## 3. Data Model + Policy Design

- Translate `types/index.ts` into concrete Supabase tables (e.g., `todos`, `observations`, `transcripts`, `settings`) with UUID primary keys, per-user foreign keys, and timestamps.
- Define row-level security policies so users can seed and read only their own records while allowing a bootstrap/seed script for account initialization.
- Describe any needed RPC/functions (e.g., bulk upsert for “seed my device state”).

## 4. Mobile App Sync Flow

- Replace direct `AsyncStorage` entry points with a synchronization layer that: (a) writes to Supabase, (b) caches locally for offline use, (c) handles initial “seed” uploads for existing users.
- Keep the existing `StorageService` interface but route through Supabase when online, falling back to caches to preserve today’s behavior (preserve working code first, then extend).
- Add minimal error reporting/logging so failures are visible without over-engineering retries.

## 5. Companion Mac App Access

- Expose a shared TypeScript SDK (could live in `services/`) that both the mobile and Mac apps can import for querying Supabase with consistent types.
- On the Mac side, integrate the SDK, implement auth (supabase magic link or service key for dev), and verify it can list/save transcripts/tasks seeded from mobile.

## 6. Validation + Rollout

- Write lightweight integration scripts/tests that insert and fetch sample data to confirm schema + policies before shipping to clients.
- Document the seeding workflow so “others can seed their account” is a repeatable checklist (credentials needed, command to run, expected results).

### To-dos

- [ ] Review current storage usage and data requirements
- [ ] Design Supabase tables and RLS policies
- [ ] Plan mobile + Mac Supabase client wiring