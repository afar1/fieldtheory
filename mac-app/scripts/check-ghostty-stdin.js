const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const host = require('../electron/native/build/ghostty-host.node');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!host?.probe?.()) throw new Error('Ghostty native host bridge did not load.');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-stdin-'));
  const outPath = path.join(tmpDir, 'input.txt');
  const recorderPath = path.join(tmpDir, 'record-stdin.sh');
  fs.writeFileSync(
    recorderPath,
    `#!/usr/bin/env bash\nIFS= read -r line\nprintf "%s" "$line" > ${JSON.stringify(outPath)}\nsleep 2\n`,
    { mode: 0o755 },
  );

  await app.whenReady();
  const win = new BrowserWindow({
    width: 600,
    height: 320,
    show: true,
    title: 'Field Theory Ghostty stdin Check',
  });

  const id = `stdin-${Date.now()}`;
  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 600, 320, process.cwd(), recorderPath);
  if (!attached) throw new Error('Ghostty stdin recorder surface did not attach.');

  await sleep(1000);
  const sent = host.sendText(id, 'HELLO_GHOSTTY_STDIN\r');
  if (!sent) throw new Error('Could not send text to Ghostty stdin recorder.');

  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(outPath)) {
      const observed = fs.readFileSync(outPath, 'utf8');
      console.log(JSON.stringify({ ok: observed === 'HELLO_GHOSTTY_STDIN', observed, outPath }, null, 2));
      host.detach(id);
      app.exit(observed === 'HELLO_GHOSTTY_STDIN' ? 0 : 1);
      return;
    }
    await sleep(250);
  }

  host.detach(id);
  throw new Error(`Timed out waiting for Ghostty stdin recorder output at ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
