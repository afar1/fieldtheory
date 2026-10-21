# Field Theory phone build 83

Device source is an isolated snapshot of `/Users/afar/dev/fieldtheory-ios-local`
HEAD `1905a711d` plus its existing working changes. That checkout produced the
installed Focus build 82 (`1905a711d-audio-startup-diagnostics-local`).

The conversation sources and store regression tests come from `4258f5eeb`.
Integration preserves the current Voice-only product surface and adds Agent
as a second native tab. Existing recording, privacy and Reviewer Demo behavior
remain from the device baseline; Reviewer Demo does not expose Agent. Selected
Voice text can be reviewed in Agent before sending. Existing legacy transcript
Send to Agent routing is preserved.

Relay schema/Mac runner dependency remains `7eef1438b` from the companion
orchestration task. On October 20, 2026, after explicit user authorization, migration
`20261021030000` was applied to Field Theory project `cighxaroptskntwbrctl`
through the Supabase CLI in one transaction, including migration history.
Remote source MD5 `7eb1c0113b79e09a27ff2f45444d8041` matches the reviewed file.
Verified all four tables have RLS, anonymous reads are denied, authenticated
roles can select, and runner RPCs require authentication. PostgREST denies
anonymous access with HTTP 401 / code 42501, confirming the table is exposed
with its access policy. No Mac runner deployment was performed in this chat.

Build 83 was installed and launched on Focus; installed version readback
confirmed 83. Thirteen conversation, recording-signout and Reviewer Access
simulator tests passed. Full physical phone-to-provider execution remains
unverified pending the updated Mac runner.
