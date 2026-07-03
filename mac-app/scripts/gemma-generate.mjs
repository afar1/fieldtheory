#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DEFAULT_CODEX_MODEL = 'gemma-4-E4B-it-Q4_K_M';
const DIRECT_SYSTEM_PROMPT = [
  'You run local Field Theory commands.',
  'Return only the final answer requested by the command.',
  'Do not show private reasoning or status text.',
  'You cannot use tools, call apply_patch, emit diffs, or edit files yourself.',
].join(' ');
const CODEX_COMPAT_SYSTEM_PROMPT = [
  'You are the local model behind Codex for Field Theory commands.',
  'Return only the final answer requested by the user.',
  'Do not use tools, private reasoning, or status text.',
  'Never emit <|tool_call>, apply_patch, shell commands, or diff patches.',
].join(' ');
const DEFAULT_CODEX_TIMEOUT_MS = 240_000;
const MAX_CHILD_OUTPUT_BYTES = 512 * 1024;
const MAX_COMPAT_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_PROGRESS_DETAIL_CHARS = 180;

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

function emitProgress(kind, message, detailOrOptions) {
  const options = typeof detailOrOptions === 'string'
    ? { detail: detailOrOptions }
    : (detailOrOptions ?? {});
  const payload = {
    event: 'progress',
    kind,
    message,
  };
  if (typeof options.phase === 'string' && options.phase.trim()) {
    payload.phase = options.phase.trim();
  }
  if (typeof options.detail === 'string' && options.detail.trim()) {
    payload.detail = compactProgressDetail(options.detail);
  }
  jsonOut(payload);
}

function compactProgressDetail(value) {
  const compacted = String(value).replace(/\s+/g, ' ').trim();
  if (compacted.length <= MAX_PROGRESS_DETAIL_CHARS) return compacted;
  return `${compacted.slice(0, MAX_PROGRESS_DETAIL_CHARS - 3)}...`;
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

function findCodex() {
  const candidates = [
    process.env.FT_CODEX_PATH,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    'codex',
  ];
  return candidates.find(existsExecutable) ?? 'codex';
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
const codexModel = String(args.get('codex-model') || process.env.FT_CODEX_LOCAL_MODEL || DEFAULT_CODEX_MODEL);

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
const codexCompat = await createCodexCompatServer({ llamaBaseUrl: baseUrl, model: codexModel });

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

async function generateDirect(prompt, options) {
  emitProgress('status', 'Using direct Gemma runner', { phase: 'direct', detail: path.basename(modelPath) });
  emitProgress('model_output', 'Gemma is generating locally', { phase: 'model', detail: codexModel });
  return completeWithLlama(baseUrl, prompt, options, DIRECT_SYSTEM_PROMPT);
}

async function generateWithCodex(prompt, options) {
  const codexPath = findCodex();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-codex-gemma-'));
  const outputPath = path.join(runDir, 'last-message.txt');
  const commandArgs = [
    '--oss',
    '--local-provider', 'lmstudio',
    '-m', codexModel,
    '-a', 'never',
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--output-last-message', outputPath,
    '-',
  ];

  try {
    emitProgress('status', 'Codex local harness started', { phase: 'codex', detail: codexModel });
    await runChild(codexPath, commandArgs, {
      cwd: runDir,
      input: prompt,
      timeoutMs: numberFromEnv('FT_CODEX_LOCAL_TIMEOUT_MS', DEFAULT_CODEX_TIMEOUT_MS, 10_000, 600_000),
      env: {
        ...process.env,
        CODEX_OSS_BASE_URL: codexCompat.baseUrl,
        CODEX_OSS_PORT: String(codexCompat.port),
        CODEX_HOME: runDir,
      },
      onStdoutLine: emitCodexProgressFromLine,
    });
    if (!fs.existsSync(outputPath)) {
      throw new Error('Codex did not write a final local model response');
    }
    emitProgress('status', 'Codex finished local draft', { phase: 'codex' });
    return fs.readFileSync(outputPath, 'utf8');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function generate(prompt, options, harness) {
  if (harness === 'direct') {
    return generateDirect(prompt, options);
  }
  try {
    return await generateWithCodex(prompt, options);
  } catch (error) {
    if (process.env.FT_LOCAL_LLM_ALLOW_DIRECT_FALLBACK === '0') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    emitProgress('error', 'Codex harness failed; using direct Gemma', { phase: 'fallback', detail: message });
    process.stderr.write(`Codex local harness failed; falling back to direct Gemma generation: ${message}\n`);
    return generateDirect(prompt, options);
  }
}

function emitCodexProgressFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }
  const progress = codexEventToProgress(event);
  if (progress) {
    emitProgress(progress.kind, progress.message, {
      phase: progress.phase,
      detail: progress.detail,
    });
  }
}

function codexEventToProgress(event) {
  const type = firstString(event?.type, event?.event, event?.kind);
  const item = event?.item && typeof event.item === 'object'
    ? event.item
    : event?.response_item && typeof event.response_item === 'object'
      ? event.response_item
      : null;
  const itemType = firstString(item?.type, item?.kind);
  const lowerType = `${type} ${itemType}`.toLowerCase();

  if (lowerType.includes('turn.started') || lowerType.includes('turn_started')) {
    return { kind: 'status', message: 'Codex is preparing the local run', phase: 'codex' };
  }
  if (lowerType.includes('turn.completed') || lowerType.includes('turn_completed')) {
    return { kind: 'status', message: 'Codex completed the local run', phase: 'codex' };
  }
  if (lowerType.includes('response.created')) {
    return { kind: 'model_output', message: 'Local Gemma request opened', phase: 'model' };
  }
  if (lowerType.includes('response.completed')) {
    return { kind: 'model_output', message: 'Local Gemma response completed', phase: 'model' };
  }
  if (lowerType.includes('reasoning') || lowerType.includes('thinking')) {
    return { kind: 'model_output', message: 'Codex is checking the local draft', phase: 'codex' };
  }
  if (lowerType.includes('message')) {
    return { kind: 'model_output', message: 'Codex received local model text', phase: 'codex' };
  }
  if (lowerType.includes('exec') || lowerType.includes('tool') || lowerType.includes('function_call')) {
    const detail = firstString(item?.name, event?.name, item?.command, event?.command);
    return { kind: 'tool_call', message: 'Codex is using its local harness', phase: 'codex', detail };
  }
  if (lowerType.includes('patch') || lowerType.includes('diff')) {
    return { kind: 'file_change', message: 'Codex produced a candidate edit', phase: 'codex' };
  }
  if (lowerType.includes('error')) {
    const detail = firstString(event?.message, event?.error, item?.message, item?.error);
    return { kind: 'error', message: 'Codex reported a harness event', phase: 'codex', detail };
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
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
    text: await generate(message.prompt, { maxTokens, temperature }, message.harness),
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
  codexCompat.close();
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

async function createCodexCompatServer({ llamaBaseUrl, model }) {
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
        if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
          sendJson(res, {
            object: 'list',
            data: [{ id: model, object: 'model' }],
          });
          return;
        }
        if (req.method === 'POST' && (url.pathname === '/v1/responses' || url.pathname === '/responses')) {
          const body = await readJsonBody(req);
          const prompt = responseRequestToPrompt(body);
          emitProgress('model_output', 'Gemma is generating locally', { phase: 'model', detail: model });
          const text = prompt.trim()
            ? await completeWithLlama(llamaBaseUrl, prompt, {
                maxTokens: Math.max(1, Math.min(8192, Number(body.max_output_tokens) || 4096)),
                temperature: Math.max(0, Math.min(2, Number(body.temperature) || 0.1)),
              }, CODEX_COMPAT_SYSTEM_PROMPT)
            : '';
          emitProgress('model_output', 'Gemma returned local text to Codex', { phase: 'model' });
          if (body.stream !== false) {
            sendResponseSse(res, text);
          } else {
            sendJson(res, responseJson(text));
          }
          return;
        }
        sendJson(res, { error: 'Not found' }, 404);
      } catch (error) {
        sendJson(res, jsonError(error), 500);
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => {
      try { server.close(); } catch { /* already closed */ }
    },
  };
}

async function completeWithLlama(llamaBaseUrl, prompt, options, systemContent) {
  const response = await fetch(`${llamaBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: systemContent,
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

function responseRequestToPrompt(body) {
  const parts = [];
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    parts.push(body.instructions.trim());
  }
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (item?.type === 'message') {
      const role = typeof item.role === 'string' ? item.role : 'user';
      const text = responseContentToText(item.content);
      if (text) parts.push(`${role.toUpperCase()}:\n${text}`);
    } else if (item?.type === 'function_call_output') {
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');
      if (output) parts.push(`TOOL OUTPUT:\n${output}`);
    } else if (item) {
      parts.push(JSON.stringify(item));
    }
  }
  return parts.join('\n\n');
}

function responseContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.input_text === 'string') return part.input_text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function responseJson(text) {
  const id = `resp_${Date.now().toString(36)}`;
  return {
    id,
    object: 'response',
    output: [responseMessage(id, text)],
    usage: responseUsage(),
  };
}

function sendResponseSse(res, text) {
  const id = `resp_${Date.now().toString(36)}`;
  const events = [
    { type: 'response.created', response: { id } },
    {
      type: 'response.output_item.done',
      item: responseMessage(id, text),
    },
    {
      type: 'response.completed',
      response: {
        id,
        usage: responseUsage({ includeDetails: true }),
      },
    },
  ];
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

function responseMessage(responseId, text) {
  return {
    type: 'message',
    role: 'assistant',
    id: `msg_${responseId}`,
    content: [{ type: 'output_text', text }],
  };
}

function responseUsage(options = {}) {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  if (options.includeDetails) {
    return {
      input_tokens: 0,
      input_tokens_details: null,
      output_tokens: 0,
      output_tokens_details: null,
      total_tokens: 0,
    };
  }
  return usage;
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_COMPAT_REQUEST_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function runChild(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stdoutLineBuffer = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      reject(new Error(`${path.basename(command)} timed out`));
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (stdout.length > MAX_CHILD_OUTPUT_BYTES) stdout = stdout.slice(-MAX_CHILD_OUTPUT_BYTES);
      if (options.onStdoutLine) {
        stdoutLineBuffer += text;
        const lines = stdoutLineBuffer.split('\n');
        stdoutLineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          options.onStdoutLine(line);
        }
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_CHILD_OUTPUT_BYTES) stderr = stderr.slice(-MAX_CHILD_OUTPUT_BYTES);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.onStdoutLine && stdoutLineBuffer.trim()) {
        options.onStdoutLine(stdoutLineBuffer);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(signal ? `${command} exited with ${signal}` : `${command} exited with code ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(options.input);
  });
}
