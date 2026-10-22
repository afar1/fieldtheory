(function () {
  const prompt = document.getElementById('setup-prompt');
  const status = document.getElementById('copy-status');
  function render(host) {
    prompt.value = window.setupPrompt(host);
    status.textContent = '';
    document.getElementById('host-note').textContent = host === 'claude'
      ? 'Use Claude Desktop with a supported local session. Computer use currently requires Pro or Max.'
      : 'Use ChatGPT Desktop in Work or Codex. Computer use must be available for your account.';
    document.getElementById('assistant-download').textContent = host === 'claude' ? 'Get Claude' : 'Get ChatGPT';
    document.getElementById('assistant-download').href = host === 'claude' ? 'https://claude.com/download' : 'https://chatgpt.com/download/';
    document.getElementById('plugin-instructions').textContent = host === 'claude'
      ? 'Use the Field Theory plugin in a local Cowork or Code session. Ordinary chat cannot run its local setup tools.'
      : 'Use the Field Theory plugin in a local desktop session. Start a new conversation after installing it so its tools are available.';
    document.getElementById('plugin-install').innerHTML = '<p><a href="/setup/field-theory-plugin.zip" download>Download the preview plugin</a> and unzip it. It needs Node.js 18 or later; <a href="https://nodejs.org/en/download">install Node.js LTS</a> if needed.</p>' + (host === 'claude'
      ? '<p>In Claude Desktop, open Customize → Plugins → Add → Upload plugin and choose the ZIP. Use a local Cowork session. This documented installation route still needs a live test with this preview. For Claude Code, run <code>./install.sh --claude</code> from the extracted folder and follow the printed command.</p>'
      : '<p>For Codex Desktop, open Terminal in the extracted folder and run <code>./install.sh</code>. Restart Codex, enable Field Theory under Personal plugins, and start a new chat. This does not install it into the ChatGPT directory; for ChatGPT, use guided setup until its distribution is approved.</p>') + '<p><a href="/setup/plugin-readme.txt">Read the full installation instructions</a></p>';
  }
  document.querySelectorAll('input[name="host"]').forEach(input => input.addEventListener('change', () => render(input.value)));
  document.getElementById('copy-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      status.textContent = 'Copied. Paste it into a new conversation with your assistant.';
    } catch {
      prompt.closest('details').open = true;
      prompt.focus();
      prompt.select();
      status.textContent = 'Select and copy the prompt below, then paste it into your assistant.';
    }
  });
  render('chatgpt');
})();
