const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const host = require('../electron/native/build/ghostty-host.node');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!host?.probe?.()) throw new Error('Ghostty native host bridge did not load.');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-detach-'));
  const pidPath = path.join(tmpDir, 'child.pid');
  const sleeperPath = path.join(tmpDir, 'sleep-until-detach.sh');
  fs.writeFileSync(
    sleeperPath,
    `#!/usr/bin/env bash\necho "$$" > ${JSON.stringify(pidPath)}\nsleep 120\n`,
    { mode: 0o755 },
  );

  await app.whenReady();
  const win = new BrowserWindow({
    width: 600,
    height: 320,
    show: true,
    title: 'Field Theory Ghostty detach Check',
  });

  const id = `detach-${Date.now()}`;
  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 600, 320, process.cwd(), sleeperPath);
  if (!attached) throw new Error('Ghostty detach test surface did not attach.');

  let childPid = null;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(pidPath)) {
      childPid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
      break;
    }
    await sleep(250);
  }
  if (!childPid || !Number.isFinite(childPid)) throw new Error(`Timed out waiting for detach test pid at ${pidPath}`);

  const detached = host.detach(id);
  if (!detached) throw new Error('Ghostty detach returned false.');

  for (let i = 0; i < 40; i++) {
    if (!processExists(childPid)) {
      console.log(JSON.stringify({ ok: true, childPid }, null, 2));
      app.exit(0);
      return;
    }
    await sleep(250);
  }

  throw new Error(`Ghostty child process ${childPid} was still alive after detach.`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
