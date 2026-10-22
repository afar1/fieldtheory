# Field Theory plugin — assisted setup preview

Set up a Mac for a working support call from one conversation, then use Field Theory Library notes and context. This is a local preview, not an official ChatGPT or Claude marketplace listing.

## Try the preview

Use a local Mac session with Node.js 18 or later. Setup status does **not** require `ft`, Homebrew or Builder. Library tools still use the existing `ft` CLI.

From the repository or extracted preview ZIP:

```sh
./install.sh --check
./install.sh
```

Restart Codex, enable Field Theory under Personal plugins, and start a new chat. The installer changes only Field Theory's personal plugin and its enabled flag. It preserves other config, backs up any replaced version/config, and supports `CODEX_HOME` for isolated testing. It does not publish or install into ChatGPT's official directory.

For an isolated Claude Code session, run `./install.sh --claude` and use the printed `claude --plugin-dir` command. This loads the same skills and local MCP server with Claude's manifest. For Claude Cowork, use Customize → Plugins → Add → Upload plugin with the preview ZIP, then start a supported **local** session. The package matches the documented upload layout and limits; the Cowork runtime still requires an actual host test. Ordinary Claude Chat ignores local MCP tools. Commands in an ordinary cloud VM do not configure the user's Mac.

If preflight reports missing Node, install the current LTS from [nodejs.org](https://nodejs.org/en/download), then restart the assistant. No silent runtime download occurs. The plugin launcher checks PATH, the user's local bin, an existing Codex dependency runtime, and standard Homebrew locations. It validates the runtime version before use; a bundled runtime is optional and is never assumed to exist. A fresh Mac still needs this prerequisite; the preview does not claim to be dependency-free.

## Start setup

Send **Set up my Mac with Field Theory** or use the complete prompt supplied by the Onboard/Field Theory preview website. The `setup` skill follows this order:

1. Check the actual host and current setup. Skip what is already working.
2. Install missing essentials through Onboard, and connect the Field Theory account through native sign-in. Verification codes stay out of chat.
3. Prepare local Parakeet and guide only missing permissions. Preserve recording preferences; change the source only after the user chooses.
4. Test the real recording shortcut, the helper's call audio, local transcription and paste handoff, then perform a harmless computer-use action through the host's tools.
5. Offer Builder only after essentials work and the user chooses it.

The tools are `get_setup_status` and `setup_action`. Status reads the app's authenticated loopback helper, without user content, emails or tokens. It reports installed, configured and unknown separately. `computerUse: host-must-verify` and the recording/handoff tests cannot be inferred from app installation or permissions.

The preview Mac app must expose `/native/onboarding/status`. An older running app reports `app-update-required`; an offline helper reports unavailable. Neither is treated as ready. The app source owns this endpoint and all native actions; this plugin never reads authentication databases or recording files.

## Distribution boundaries

- [OpenAI local MCP plugins](https://developers.openai.com/plugins/deploy/desktop-only) require partner approval and an allowlisted submitting organization. Local Codex installation does not establish ChatGPT directory eligibility.
- [Claude plugins](https://code.claude.com/docs/en/plugins-reference) use `.claude-plugin/plugin.json` and their own local server paths. Installing a plugin does not itself enable computer use.
- A copied prompt does not silently install a plugin or approve Mac permissions. The assistant explains the supported next step when access is unavailable.
- Both official marketplace review and clean-machine host acceptance remain required before a public launch.

## Verify and package

```sh
node --test 0.1.0+codex.20260528062418/scripts/setup.test.js
claude plugin validate 0.1.0+codex.20260528062418
./package.sh /absolute/path/field-theory-plugin.zip
```

The setup tests exercise real MCP requests with missing `ft`, private-data projection, authenticated loopback status/actions, old-app handling and targeted repeat installation. The existing `scripts/smoke-test.js` checks Library tools using a real local `ft` installation; write tests remain opt-in.

## Repository family

[Mac app](https://github.com/afar1/fieldtheory) · [CLI](https://github.com/afar1/fieldtheory-cli) · [Plugin](https://github.com/afar1/fieldtheory-plugin) · [App releases](https://github.com/afar1/field-releases)

This repository contains no Field Theory Library data, credentials or cloud infrastructure. MIT; see LICENSE.
