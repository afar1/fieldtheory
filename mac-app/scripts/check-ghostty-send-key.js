const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const host = require('../electron/native/build/ghostty-host.node');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAC_KEY_CODES = {
  A: 0x00,
  S: 0x01,
  D: 0x02,
  F: 0x03,
  H: 0x04,
  G: 0x05,
  Z: 0x06,
  X: 0x07,
  C: 0x08,
  V: 0x09,
  B: 0x0b,
  Q: 0x0c,
  W: 0x0d,
  E: 0x0e,
  R: 0x0f,
  Y: 0x10,
  T: 0x11,
  O: 0x1f,
  U: 0x20,
  I: 0x22,
  P: 0x23,
  L: 0x25,
  J: 0x26,
  K: 0x28,
  N: 0x2d,
  M: 0x2e,
  _: 0x1b,
};

function sendKey(id, input) {
  const sent = host.sendKey(
    id,
    input.action ?? 'press',
    input.keyCode,
    input.text ?? '',
    input.unshiftedCodepoint ?? 0,
    input.shift === true,
    input.ctrl === true,
    input.alt === true,
    input.meta === true,
    input.caps === true,
  );
  if (!sent) throw new Error(`Ghostty sendKey failed for ${JSON.stringify(input)}`);
}

async function main() {
  if (!host?.probe?.()) throw new Error('Ghostty native host bridge did not load.');
  if (typeof host.sendKey !== 'function') throw new Error('Ghostty native host bridge does not expose sendKey.');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-send-key-'));
  const outPath = path.join(tmpDir, 'input.txt');
  const recorderPath = path.join(tmpDir, 'record-send-key.sh');
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
    title: 'Field Theory Ghostty sendKey Check',
  });

  const id = `send-key-${Date.now()}`;
  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 720, 360, process.cwd(), recorderPath);
  if (!attached) throw new Error('Ghostty sendKey recorder surface did not attach.');

  await sleep(1000);
  for (const character of 'HELLO_SEND_KEY') {
    const codepoint = character.toLowerCase().codePointAt(0);
    const keyCode = MAC_KEY_CODES[character.toUpperCase()] ?? 0;
    sendKey(id, {
      action: 'press',
      keyCode,
      text: character,
      unshiftedCodepoint: codepoint,
      shift: character >= 'A' && character <= 'Z',
    });
    sendKey(id, {
      action: 'release',
      keyCode,
      text: character,
      unshiftedCodepoint: codepoint,
      shift: character >= 'A' && character <= 'Z',
    });
  }
  sendKey(id, { action: 'press', keyCode: 0x24, text: '', unshiftedCodepoint: 0 });
  sendKey(id, { action: 'release', keyCode: 0x24, text: '', unshiftedCodepoint: 0 });

  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(outPath)) {
      const observed = fs.readFileSync(outPath, 'utf8');
      console.log(JSON.stringify({ ok: observed === 'HELLO_SEND_KEY', observed, outPath }, null, 2));
      host.detach(id);
      app.exit(observed === 'HELLO_SEND_KEY' ? 0 : 1);
      return;
    }
    await sleep(250);
  }

  host.detach(id);
  throw new Error(`Timed out waiting for Ghostty sendKey recorder output at ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
