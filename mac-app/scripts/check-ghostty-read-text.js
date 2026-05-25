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
  if (typeof host.readText !== 'function') throw new Error('Ghostty native host bridge does not expose readText.');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-read-text-'));
  const commandPath = path.join(tmpDir, 'print-screen.sh');
  fs.writeFileSync(
    commandPath,
    [
      '#!/usr/bin/env bash',
      'printf "FIELD_THEORY_GHOSTTY_SCREEN\\n"',
      'sleep 4',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  await app.whenReady();
  const win = new BrowserWindow({
    width: 720,
    height: 360,
    show: true,
    title: 'Field Theory Ghostty readText Check',
  });

  const id = `read-text-${Date.now()}`;
  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 720, 360, process.cwd(), commandPath);
  if (!attached) throw new Error('Ghostty readText surface did not attach.');

  for (let i = 0; i < 60; i++) {
    const text = host.readText(id);
    if (text.includes('FIELD_THEORY_GHOSTTY_SCREEN')) {
      console.log(JSON.stringify({ ok: true, observed: 'FIELD_THEORY_GHOSTTY_SCREEN' }, null, 2));
      host.detach(id);
      app.exit(0);
      return;
    }
    await sleep(250);
  }

  const text = host.readText(id);
  host.detach(id);
  throw new Error(`Timed out waiting for Ghostty readText output. Last text: ${JSON.stringify(text.slice(0, 400))}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
