(function () {
  const prompt = document.getElementById('setup-prompt');
  const status = document.getElementById('copy-status');
  prompt.value = window.setupPrompt();
  document.getElementById('copy-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      status.textContent = 'Copied. Paste it into ChatGPT or Claude.';
    } catch {
      prompt.closest('details').open = true;
      prompt.focus();
      prompt.select();
      status.textContent = 'Select and copy the prompt below, then paste it into your assistant.';
    }
  });
})();
