# Assisted setup preview

Start at [Onboard](https://onboard-assisted-setup-afar1.vercel.app) or [Field Theory setup](https://fieldtheory-assisted-setup-afar1.vercel.app/setup/). Vercel preview access may require the project owner’s login. App and plugin downloads are public preview assets; neither website is deployed to production.

## Try it

1. Choose ChatGPT or Claude. Install the preview plugin using the instructions shown. Official directory listings are not published. Local Codex and Claude Code tool invocation have been tested; Claude Desktop accepts the ZIP and asks for local-server permission.
2. Install the Field Theory preview when the assistant reports an older app. Existing recording settings and local models are reused.
3. Copy the setup prompt into a supported local assistant conversation. It checks the app, account, permissions, recording source, shortcut and local Parakeet separately.
4. Complete email verification in Field Theory’s native screen if needed. Never paste a verification code into the assistant.
5. Record a short instruction from the other person on a call using the configured shortcut. Stop, inspect the transcript, and paste it into the assistant. Then ask the assistant to perform a harmless computer action. These are required acceptance steps, not inferred from installed software.
6. Optionally choose Builder after the essentials work. Onboard shows and runs its existing dependency plan.

## Evidence and remaining gates

- Onboard: signed, notarized, Gatekeeper accepted; anonymous artifact download matches the local build. Website copy/assistant switching and native readiness display checked.
- Field Theory: authenticated local status/actions, native navigation, deduplicated Parakeet setup and packaged account-configuration guard. TypeScript, 210 focused native tests and 12 package archive checks pass.
- Plugin: actual installed MCP and Claude Code calls recognized the running preview, preserved the existing mixed-audio source and shortcut, and reported verified Parakeet models. Missing account access stays unfinished.
- Claude Desktop: ZIP accepted; its local-server permission requires user confirmation before tool testing.
- Remaining acceptance: corrected packaged account screen, native sign-in if needed, real call capture/transcript handoff, clean-Mac installation, and Claude Desktop local tool use. Official marketplace publication requires separate platform review.

This branch is stacked on the existing 0.3.77 call-audio changes at `59178a087`. Its private base branch is `codex/onboarding-audio-base`. Preview auto-updates are disabled; no production updater metadata is published.
