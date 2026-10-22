(function () {
  const prompt = document.getElementById('setup-prompt');
  const status = document.getElementById('copy-status');
  prompt.textContent = window.setupPrompt();
  document.getElementById('copy-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt.textContent);
      status.textContent = 'Copied. Paste it into ChatGPT or Claude.';
    } catch {
      prompt.closest('details').open = true;
      prompt.focus();
      const range = document.createRange();
      range.selectNodeContents(prompt);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Select and copy the prompt below, then paste it into your assistant.';
    }
  });
})();
