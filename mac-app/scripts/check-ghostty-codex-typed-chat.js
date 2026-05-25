const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const host = require('../electron/native/build/ghostty-host.node');

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CODEX_READY_WAIT_MS = 25000;
const RESPONSE_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;

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
  1: 0x12,
  2: 0x13,
  3: 0x14,
  4: 0x15,
  5: 0x17,
  6: 0x16,
  7: 0x1a,
  8: 0x1c,
  9: 0x19,
  0: 0x1d,
  ',': 0x2b,
  '.': 0x2f,
  '/': 0x2c,
  ' ': 0x31,
  _: 0x1b,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        // Ignore partial or non-JSON lines while Codex is still writing.
      }
    }
  }
  return { ok: false, filePath: null };
}

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

async function typeText(id, text) {
  for (const character of text) {
    const upper = character.toUpperCase();
    const keyCode = MAC_KEY_CODES[upper] ?? MAC_KEY_CODES[character] ?? 0;
    const needsShift = (character >= 'A' && character <= 'Z') || character === '_';
    const unshifted = character === '_' ? '-' : character.toLowerCase();
    const codepoint = unshifted.codePointAt(0) ?? 0;
    sendKey(id, {
      action: 'press',
      keyCode,
      text: character,
      unshiftedCodepoint: codepoint,
      shift: needsShift,
    });
    sendKey(id, {
      action: 'release',
      keyCode,
      text: character,
      unshiftedCodepoint: codepoint,
      shift: needsShift,
    });
    await sleep(8);
  }
}

function pressEnter(id) {
  sendKey(id, { action: 'press', keyCode: 0x24, text: '\r', unshiftedCodepoint: 13 });
  sendKey(id, { action: 'release', keyCode: 0x24, text: '\r', unshiftedCodepoint: 13 });
}

async function main() {
  if (!host?.probe?.()) throw new Error('Ghostty native host bridge did not load.');

  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 540,
    show: true,
    title: 'Field Theory Ghostty Codex Typed Chat Check',
  });

  const id = `codex-typed-chat-${Date.now()}`;
  const token = `FT_GHOSTTY_TYPED_${Date.now()}`;
  const startedAt = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghostty-codex-typed-chat-'));
  const launcherPath = path.join(tmpDir, 'codex-typed-chat.sh');
  fs.writeFileSync(
    launcherPath,
    [
      '#!/usr/bin/env bash',
      'export TERM="${TERM:-xterm-256color}"',
      'export COLORTERM="${COLORTERM:-truecolor}"',
      'exec codex',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const attached = host.attachGhostty(id, win.getNativeWindowHandle(), 0, 0, 900, 540, process.cwd(), launcherPath);
  if (!attached) throw new Error('Ghostty Codex typed-chat surface did not attach.');

  await sleep(CODEX_READY_WAIT_MS);
  await typeText(id, `Say exactly ${token} and nothing else.`);
  await sleep(500);
  pressEnter(id);

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const evidence = findAssistantResponseInRecentSessions(token, startedAt - 1000);
    if (evidence.ok) {
      console.log(JSON.stringify({ ok: true, token, session: evidence.filePath }, null, 2));
      host.detach(id);
      app.exit(0);
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const evidence = findAssistantResponseInRecentSessions(token, startedAt - 1000);
  host.detach(id);
  throw new Error(`Timed out waiting for typed Codex assistant response. token=${token} session=${evidence.filePath ?? 'none'}`);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
