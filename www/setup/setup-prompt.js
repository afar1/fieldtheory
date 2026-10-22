(function (root) {
  function setupPrompt(
    _host,
    status,
    setupBase = "https://onboard-assisted-setup-afar1.vercel.app",
  ) {
    return `Help me get this Mac ready to work with an AI assistant and use Field Theory during support calls. Meet me where I am: I may have nothing installed, be partly set up, be returning after an interruption, or already have everything working.

First check what you can actually do in this session and what is already ready on my Mac. Don't give me a questionnaire or a long checklist. Inspect what you can; ask only what you cannot determine, one short question or action at a time. Explain where to click in plain English. Do the work yourself wherever your available tools allow it.

If you cannot access my Mac yet, keep guiding me here. Identify the assistant and session I'm using, then help me open a supported local session and enable computer use. A cloud sandbox is not my Mac. For preview setup, download the plugin from https://github.com/afar1/field-releases/releases/download/v0.3.78-onboarding.1/field-theory-plugin.zip. Claude Desktop: Customize → Plugins → Add → Upload plugin, then Code → This computer. Codex Desktop: unzip, follow the included README and install.sh, then restart and enable the plugin. Ordinary ChatGPT or Claude chat can guide these steps even when local tools are unavailable. Check current host instructions if its interface differs. The Apple silicon Field Theory preview is https://github.com/afar1/field-releases/releases/download/v0.3.78-onboarding.1/Field.Theory-0.3.78-onboarding.1-arm64.dmg; check compatibility before installing. Don't invent buttons, assume a paid feature is available, or claim an official marketplace listing exists. If something is unsupported, explain the real requirement and help me choose an available path.

Check before changing anything. Reuse existing apps, sign-in, permissions, models and shortcuts. If Field Theory's get_setup_status and setup_action tools are available, use them; otherwise guide me through the app. Unknown is not ready. Resume interrupted work without resetting it or running competing installers.

Complete only missing essentials: Field Theory, verified account sign-in, local Parakeet transcription, recording access, and the assistant's own computer use. Guide email verification in the trusted app or sign-in page; never ask me to paste passwords, codes or tokens here. Let me approve required system permissions. Preserve my recording source; if one must be chosen, ask whether I want the other person's call audio or both voices. Install dependencies only when needed.

Prove it works: use your actual computer-use tools for a harmless action I approve. Help me use the recording shortcut during a call, stop, inspect the transcript and paste it here. For both voices, test both. Never start recording silently. If I'm already set up, skip installation and go straight to any unverified test. If these tests already passed in this conversation and nothing relevant changed, don't repeat them. Call setup complete only when computer use and the recording-to-transcript handoff actually work; explain any remaining blocker honestly.

After essentials work, offer optional tools for building from ${setupBase}/builder.onboard. Explain the plan and install through Onboard only if I choose them. If we stop, leave a short note of what works and the next step so we can resume.${status ? "\n\nOnboard observed this local snapshot; recheck anything that may have changed:\n" + JSON.stringify(status, null, 2) : ""}`;
  }
  if (typeof module !== "undefined" && module.exports)
    module.exports = { setupPrompt };
  else root.setupPrompt = setupPrompt;
})(typeof globalThis !== "undefined" ? globalThis : this);
