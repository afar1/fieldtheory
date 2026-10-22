(function(root) {
  function setupPrompt(host = 'chatgpt', status, setupBase = 'https://onboard-assisted-setup-afar1.vercel.app') {
    const assistant = host === 'claude' ? 'Claude' : 'ChatGPT';
    return `Help me set up this Mac for a support call using ${assistant} and Field Theory. Check what already works and only install or configure what is missing. Preserve my existing settings.

First check whether this session supports local tools and computer use. If not, explain how to open a supported desktop session and enable computer use. Never claim a plugin is installed or publicly listed without checking. Field Theory's official marketplace listings are not yet published; use the local preview plugin if supplied, or guide me through the Onboard app at ${setupBase}.

Use Field Theory's get_setup_status tool when available, and setup_action for its supported setup actions. Otherwise open Field Theory and check its native setup screens; unavailable automated checks remain unknown. Treat unavailable checks as unknown, not ready. Keep account status, installed apps, model readiness, microphone/call-audio permissions, and computer-use readiness separate. An installed app is not proof that recording or computer use works.

Install Field Theory and prepare local Parakeet transcription. Install Python only if required for transcription. Ask before changing my recording preferences. For a new setup, help me capture the other person's call audio, and my microphone if I want both voices. Guide required Mac approvals one at a time; never bypass privacy controls.

Sign me into Field Theory through its native sign-in screen or trusted website. Do not ask for passwords, email verification codes, tokens, or other authentication secrets in this conversation. Resume after I finish sign-in. Verify account access; do not imply that signing in grants access to somebody else's private River content.

Test the result: have me record a short instruction from my helper, stop recording, check the transcript, and paste it here. Then perform a harmless computer action with my approval. Report what is verified and what still needs attention. Do not call setup complete until the recording/transcription and computer-use tests actually pass.

Only after essentials work, offer the optional Builder setup from ${setupBase}/builder.onboard. Explain its install plan and wait for my choice before installing additional development tools. Reuse Onboard's installer and dependency checks; do not run competing installers. Keep progress clear so I can resume if interrupted.${status ? '\n\nOnboard observed this local snapshot (recheck anything that may have changed):\n' + JSON.stringify(status, null, 2) : ''}`;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { setupPrompt };
  else root.setupPrompt = setupPrompt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
