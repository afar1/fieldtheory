const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const host = require('../electron/native/build/ghostty-host.node');

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const RESPONSE_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;
const CODEX_READY_WAIT_MS = 25000;
const SCREEN_LOG_INTERVAL_MS = 15000;

function walkJsonlFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkJsonlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(fullPath);
  }
  return result;
}

function findAssistantResponseInRecentSessions(needle, sinceMs) {
  const candidates = walkJsonlFiles(CODEX_SESSIONS_DIR)
    .map((candidate) => ({ candidate, stat: fs.statSync(candidate) }))
    .filter(({ stat }) => stat.mtimeMs >= sinceMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 12);

  for (const { candidate } of candidates) {
    const content = fs.readFileSync(candidate, 'utf8');
    if (!content.includes(needle)) continue;
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const payload = event.payload;
        if (payload?.type === 'message' && payload.role === 'assistant' && JSON.stringify(payload.content ?? '').includes(needle)) {
          return { ok: true, filePath: candidate };
        }
      } catch {
        // Ignore partial or non-JSON lines while the session is still being written.
      }
    }
  }
  return { ok: false, filePath: null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!host?.probe?.()) throw new Error('Ghostty native host bridge did not load.');

  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 540,
    show: true,
    title: 'Field Theory Ghostty Codex Chat Check',
  });

  const id = `codex-chat-${Date.now()}`;
  const token = `FT_GHOSTTY_STREAM_${Date.now()}`;
  const startedAt = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-codex-chat-'));
  const launcherPath = path.join(tmpDir, 'codex-chat.sh');
  fs.writeFileSync(
    launcherPath,
    [
      '#!/usr/bin/env bash',
      'export TERM="${TERM:-xterm-256color}"',
      'export COLORTERM="${COLORTERM:-truecolor}"',
      `exec codex ${JSON.stringify(`Say exactly ${token} and nothing else.`)}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 900, 540, process.cwd(), launcherPath);
  if (!attached) throw new Error('Ghostty Codex surface did not attach.');

  await sleep(CODEX_READY_WAIT_MS);

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastProgressAt = Date.now();
  let lastScreenLogAt = 0;
  while (Date.now() < deadline) {
    const evidence = findAssistantResponseInRecentSessions(token, startedAt - 1000);
    if (evidence.ok) {
      console.log(JSON.stringify({ ok: true, token, session: evidence.filePath }, null, 2));
      host.detach(id);
      app.exit(0);
      return;
    }
    if (Date.now() - lastProgressAt > 15000) {
      console.error(`Waiting for Codex assistant response. token=${token}`);
      lastProgressAt = Date.now();
    }
    if (typeof host.readText === 'function' && Date.now() - lastScreenLogAt > SCREEN_LOG_INTERVAL_MS) {
      const screen = host.readText(id).replace(/\s+$/g, '');
      if (screen) console.error(`Ghostty screen snapshot:\n${screen.slice(-1200)}`);
      lastScreenLogAt = Date.now();
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const evidence = findAssistantResponseInRecentSessions(token, startedAt - 1000);
  host.detach(id);
  throw new Error(`Timed out waiting for Codex assistant response. token=${token} session=${evidence.filePath ?? 'none'}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
