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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-native-keydown-'));
  const outPath = path.join(tmpDir, 'input.txt');
  const recorderPath = path.join(tmpDir, 'record-native-keydown.sh');
  fs.writeFileSync(
    recorderPath,
    `#!/usr/bin/env bash\nIFS= read -r line\nprintf "%s" "$line" > ${JSON.stringify(outPath)}\nsleep 2\n`,
    { mode: 0o755 },
  );

  await app.whenReady();
  const win = new BrowserWindow({
    width: 720,
    height: 360,
    show: true,
    title: 'Field Theory Ghostty Native Keydown Check',
  });

  const id = `native-keydown-${Date.now()}`;
  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 720, 360, process.cwd(), recorderPath);
  if (!attached) throw new Error('Ghostty native keydown recorder surface did not attach.');

  await sleep(1000);
  win.focus();
  await sleep(250);
  for (const character of 'HELLO_NATIVE_KEYDOWN\r') {
    const sent = host.sendSyntheticTextForTesting(id, character);
    if (!sent) throw new Error(`Could not send synthetic key event ${JSON.stringify(character)} through Ghostty host view.`);
    await sleep(10);
  }

  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(outPath)) {
      const observed = fs.readFileSync(outPath, 'utf8');
      console.log(JSON.stringify({ ok: observed === 'HELLO_NATIVE_KEYDOWN', observed, outPath }, null, 2));
      host.detach(id);
      app.exit(observed === 'HELLO_NATIVE_KEYDOWN' ? 0 : 1);
      return;
    }
    await sleep(250);
  }

  host.detach(id);
  throw new Error(`Timed out waiting for native keydown recorder output at ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
