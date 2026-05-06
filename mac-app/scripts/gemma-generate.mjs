#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1]?.startsWith('--') ? true : argv[i + 1];
    args.set(key, value);
    if (value !== true) i += 1;
  }
  return args;
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function jsonOut(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function jsonError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

function existsExecutable(candidate) {
  return typeof candidate === 'string' && candidate.length > 0 && fs.existsSync(candidate);
}

function findLlamaServer() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.FT_LLAMA_SERVER_PATH,
    path.resolve(scriptDir, '..', 'bin', 'llama-server'),
    path.resolve(process.cwd(), 'resources', 'bin', 'llama-server'),
    '/opt/homebrew/bin/llama-server',
    '/usr/local/bin/llama-server',
    'llama-server',
  ];
  return candidates.find(existsExecutable) ?? 'llama-server';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not allocate local llama-server port'));
      });
    });
  });
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error('llama-server did not become ready');
}

const args = parseArgs(process.argv);
const modelPath = args.get('model');

if (typeof modelPath !== 'string' || modelPath.length === 0) {
  process.stderr.write('Missing --model path\n');
  process.exit(1);
}

const contextSize = numberFromEnv('FT_GEMMA_CONTEXT_SIZE', 32768, 4096, 131072);
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const llamaServerPath = findLlamaServer();
const serverArgs = [
  '-m', modelPath,
  '--host', '127.0.0.1',
  '--port', String(port),
  '--ctx-size', String(contextSize),
  '--jinja',
  '--reasoning', 'off',
  '--no-warmup',
  '--no-webui',
  '--no-slots',
  '--log-disable',
];
const server = spawn(llamaServerPath, serverArgs, {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: process.env,
});
let serverExited = false;
let exiting = false;
let pendingRequests = 0;
let stdinClosed = false;

server.stderr?.on('data', (data) => {
  process.stderr.write(data);
});

server.on('exit', (code, signal) => {
  serverExited = true;
  if (!exiting) {
    process.stderr.write(`llama-server exited early (${signal ?? code})\n`);
    process.exit(code ?? 1);
  }
});

await waitForServer(baseUrl, 120_000);
jsonOut({ ready: true });

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function generate(prompt, options) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: [
            'You run local Field Theory commands.',
            'Return only the final answer requested by the command.',
            'Do not show private reasoning or status text.',
          ].join(' '),
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`llama-server returned ${response.status}`);
  }
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('llama-server response did not include text');
  }
  return text;
}

async function handleMessage(message) {
  if (message?.cmd === 'ping') {
    return { ok: true, text: 'pong' };
  }
  if (message?.cmd !== 'generate' || typeof message.prompt !== 'string') {
    return { ok: false, error: 'Unsupported Gemma command' };
  }

  const maxTokens = Math.max(1, Math.min(8192, Number(message.maxTokens) || 4096));
  const temperature = Math.max(0, Math.min(2, Number(message.temperature) || 0.1));
  return {
    ok: true,
    text: await generate(message.prompt, { maxTokens, temperature }),
  };
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  pendingRequests += 1;
  void (async () => {
    try {
      const message = JSON.parse(line);
      jsonOut(await handleMessage(message));
    } catch (error) {
      jsonOut(jsonError(error));
    } finally {
      pendingRequests -= 1;
      if (stdinClosed && pendingRequests === 0) {
        disposeAndExit();
      }
    }
  })();
});

function disposeAndExit() {
  if (exiting) return;
  exiting = true;
  rl.close();
  if (!serverExited) server.kill('SIGTERM');
  process.exit(0);
}

rl.on('close', () => {
  stdinClosed = true;
  if (pendingRequests === 0) {
    disposeAndExit();
  }
});
process.on('SIGINT', disposeAndExit);
process.on('SIGTERM', disposeAndExit);
